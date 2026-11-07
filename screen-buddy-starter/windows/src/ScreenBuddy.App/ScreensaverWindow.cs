using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using ScreenBuddy.Core;
using WinForms = System.Windows.Forms;

namespace ScreenBuddy.App;

/// <summary>
/// One black full-screen window per monitor. The buddy strolls along the lower part of the primary screen, striking a
/// pose now and then, and any key press, click or real mouse movement ends the screensaver.
/// </summary>
internal sealed class ScreensaverWindow : Window
{
    private const double WalkSpeedPxPerSec = 90;
    private static readonly TimeSpan PoseEvery = TimeSpan.FromSeconds(9);
    private const double MouseSlopPx = 12;

    private readonly WinForms.Screen _screen;
    private readonly BuddyElement? _el;
    private readonly Canvas? _canvas;
    private double _x;
    private long _lastTick;
    private long _lastPose;
    private Point? _mouseStart;
    private bool _closing;

    public ScreensaverWindow(WinForms.Screen screen, SpriteBank? bank)
    {
        _screen = screen;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Topmost = true;
        Background = Brushes.Black;
        Cursor = Cursors.None;
        WindowStartupLocation = WindowStartupLocation.Manual;

        if (bank is not null)
        {
            _canvas = new Canvas { ClipToBounds = true };
            _el = new BuddyElement(bank) { IsHitTestVisible = false };
            _canvas.Children.Add(_el);
            Content = _canvas;
        }

        SourceInitialized += (_, _) => PlaceOnScreen();
        Loaded += (_, _) => StartWalking();
        KeyDown += (_, _) => End();
        MouseDown += (_, _) => End();
        MouseMove += OnMouseMove;
    }

    /// <summary>Exactly covers the monitor, whatever its scale: the rectangle is given to Windows in device pixels.</summary>
    private void PlaceOnScreen()
    {
        var b = _screen.Bounds;
        Win32.PlaceTopmost(new WindowInteropHelper(this).Handle, b.Left, b.Top, b.Width, b.Height);
    }

    private void StartWalking()
    {
        if (_el is null || _canvas is null) return;
        var heightDip = Math.Min(ActualHeight * 0.5, 520);
        _el.Height = heightDip;
        _el.Width = BuddyLayout.WindowWidth(heightDip, _el.Manifest);
        _x = -_el.Width;
        Canvas.SetTop(_el, ActualHeight - heightDip - ActualHeight * 0.12);
        Canvas.SetLeft(_el, _x);
        _lastTick = _lastPose = Environment.TickCount64;
        CompositionTarget.Rendering += OnFrame;
    }

    private void OnFrame(object? sender, EventArgs e)
    {
        if (_el is null || _closing) return;
        var now = Environment.TickCount64;
        var dt = Math.Min(now - _lastTick, 100) / 1000.0;     // a hiccup must not teleport the buddy
        _lastTick = now;

        if (_el.Posing)
        {
            _el.Tick();                                       // stand still while posing
            return;
        }
        if (now - _lastPose > PoseEvery.TotalMilliseconds)
        {
            _lastPose = now;
            if (_el.Pose()) return;
        }
        var step = WalkSpeedPxPerSec * dt;
        _x += step;
        if (_x > ActualWidth) _x = -_el.Width;                // walk off one side, come back on the other
        Canvas.SetLeft(_el, _x);
        _el.Scrub((float)step);
        _el.Tick();
    }

    private void OnMouseMove(object? sender, MouseEventArgs e)
    {
        var p = e.GetPosition(this);
        _mouseStart ??= p;                                    // the first event only tells us where the mouse already was
        if ((p - _mouseStart.Value).Length > MouseSlopPx) End();
    }

    private void End()
    {
        if (_closing) return;
        _closing = true;
        CompositionTarget.Rendering -= OnFrame;
        System.Windows.Application.Current.Shutdown();
    }
}
