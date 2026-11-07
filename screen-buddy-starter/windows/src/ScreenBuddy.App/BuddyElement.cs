using System;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using ScreenBuddy.Core;

namespace ScreenBuddy.App;

/// <summary>
/// Draws one buddy and handles its mouse: click for a pose, drag to move it (and make it walk), right-click or
/// long-press for the menu. The hosting window moves itself in response to <see cref="DragDelta"/>.
/// </summary>
internal sealed class BuddyElement : FrameworkElement
{
    private const double DragSlopPx = 6;
    private static readonly TimeSpan LongPress = TimeSpan.FromMilliseconds(600);

    private readonly SpriteBank _bank;
    private readonly BuddyAnimator _anim;
    private readonly DispatcherTimer _longPress;
    private bool _rendering;
    private bool _pressed, _moved, _long;
    private Point _start, _last;
    private bool _paused;

    public BuddyElement(SpriteBank bank)
    {
        _bank = bank;
        _anim = new BuddyAnimator(bank.Manifest, ready: bank.Ready);
        _longPress = new DispatcherTimer(LongPress, DispatcherPriority.Input, OnLongPress, Dispatcher);
        _longPress.Stop();
        RenderOptions.SetBitmapScalingMode(this, BitmapScalingMode.HighQuality);
        Focusable = false;
        Cursor = Cursors.Hand;
        _bank.Loaded += OnBankLoaded;
        Unloaded += (_, _) => { _bank.Loaded -= OnBankLoaded; StopRendering(); };
        _bank.LoadAll();
    }

    /// <summary>The clock the animation runs on (milliseconds). Tests replace it with a fixed one.</summary>
    public Func<long> Clock { get; set; } = () => Environment.TickCount64;

    /// <summary>Screen pixels moved since the last event, while dragging.</summary>
    public event Action<double, double>? DragDelta;
    public event Action? DragCompleted;
    public event Action? MenuRequested;

    public FramePick Picked => _anim.Frame;

    /// <summary>While paused the buddy holds its standing frame and ignores clicks and movement.</summary>
    public bool Paused
    {
        get => _paused;
        set
        {
            _paused = value;
            if (value) _anim.Stop();
            InvalidateVisual();
        }
    }

    public bool Pose()
    {
        if (_paused || !_anim.Tap(Clock())) return false;
        Kick();
        return true;
    }

    public bool Play(string move)
    {
        if (_paused || !_anim.Play(move, Clock())) return false;
        Kick();
        return true;
    }

    /// <summary>Movement of <paramref name="dy"/> device-independent pixels (signed: the sign leans the buddy).</summary>
    public void Scrub(float dy)
    {
        if (_paused) return;
        _anim.Scrub(dy, Clock());
        Kick();
    }

    public bool Animating => _anim.Animating;
    public bool Posing => _anim.Posing;
    public BuddyManifest Manifest => _bank.Manifest;

    /// <summary>Advances the animation to the current clock and redraws.</summary>
    public void Tick()
    {
        _anim.Update(Clock());
        InvalidateVisual();
    }

    private void OnBankLoaded() => Dispatcher.BeginInvoke(InvalidateVisual);

    private void Kick()
    {
        if (_rendering) return;
        _rendering = true;
        CompositionTarget.Rendering += OnFrame;
    }

    private void StopRendering()
    {
        if (!_rendering) return;
        _rendering = false;
        CompositionTarget.Rendering -= OnFrame;
    }

    private void OnFrame(object? sender, EventArgs e)
    {
        Tick();
        if (!_anim.Animating) StopRendering();
    }

    protected override void OnRender(DrawingContext dc)
    {
        var w = ActualWidth;
        var h = ActualHeight;
        if (w <= 0 || h <= 0) return;
        var m = _bank.Manifest;
        var pick = _anim.Frame;
        var bmp = _bank.Frame(pick.Move, pick.Frame) ?? _bank.Frame(m.StandClip, m.StandFrame);
        if (bmp is null) return;
        var (x, y, dw, dh) = BuddyLayout.Fit(w, h, m);
        var rect = new Rect(x, y, dw, dh);
        dc.PushTransform(new RotateTransform(_anim.Lean, rect.X + rect.Width / 2, rect.Bottom));
        dc.DrawImage(bmp, rect);
        dc.Pop();
    }

    // ---- mouse -------------------------------------------------------------------------------------

    private double Dpi => VisualTreeHelper.GetDpi(this).DpiScaleX;
    private Point ScreenPoint(MouseEventArgs e) => PointToScreen(e.GetPosition(this));

    protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e)
    {
        CaptureMouse();
        _pressed = true; _moved = false; _long = false;
        _start = _last = ScreenPoint(e);
        _longPress.Start();
        e.Handled = true;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (!_pressed) return;
        var p = ScreenPoint(e);
        if (!_moved && (p - _start).Length > DragSlopPx)
        {
            _moved = true;
            _longPress.Stop();
        }
        if (!_moved) return;
        var dx = p.X - _last.X;
        var dy = p.Y - _last.Y;
        _last = p;
        DragDelta?.Invoke(dx, dy);
        var dist = Math.Sqrt(dx * dx + dy * dy) / Dpi;
        Scrub((float)(dx != 0 ? Math.Sign(dx) * dist : Math.Sign(dy) * dist));
    }

    protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e)
    {
        if (!_pressed) return;
        _pressed = false;
        _longPress.Stop();
        ReleaseMouseCapture();
        if (_moved) DragCompleted?.Invoke();
        else if (!_long) Pose();
        e.Handled = true;
    }

    protected override void OnMouseRightButtonUp(MouseButtonEventArgs e)
    {
        MenuRequested?.Invoke();
        e.Handled = true;
    }

    private void OnLongPress(object? sender, EventArgs e)
    {
        _longPress.Stop();
        if (!_pressed || _moved) return;
        _long = true;
        MenuRequested?.Invoke();
    }
}
