using System;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using ScreenBuddy.Core;
using WinForms = System.Windows.Forms;

namespace ScreenBuddy.App;

/// <summary>
/// The buddy floating over everything on the desktop. A borderless, transparent, always-on-top window that is only as
/// big as the buddy, so the rest of the desktop is untouched. Because it is a per-pixel-alpha window, clicks on its
/// see-through pixels go straight to whatever is underneath: only the buddy's own silhouette can be clicked.
/// </summary>
internal sealed class OverlayWindow : Window
{
    private const double EdgeGap = 16;
    private readonly BuddyElement _el;
    private AppSettings _s;

    public OverlayWindow(SpriteBank bank, AppSettings settings)
    {
        _s = settings;
        AllowsTransparency = true;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Topmost = true;
        ShowActivated = false;
        Background = Brushes.Transparent;
        Title = "Screen Buddy";
        WindowStartupLocation = WindowStartupLocation.Manual;
        Content = _el = new BuddyElement(bank);

        SourceInitialized += (_, _) =>
            Win32.AddExStyle(new WindowInteropHelper(this).Handle, Win32.WS_EX_TOOLWINDOW | Win32.WS_EX_NOACTIVATE);
        _el.DragDelta += OnDrag;
        _el.DragCompleted += () => Moved?.Invoke(Left, Top);
        _el.MenuRequested += () => MenuRequested?.Invoke();
        Apply(settings);
    }

    public BuddyElement Element => _el;

    /// <summary>The user dropped the buddy somewhere: left and top, in device-independent pixels.</summary>
    public event Action<double, double>? Moved;
    public event Action? MenuRequested;

    /// <summary>Applies size, transparency, pause and position from the settings.</summary>
    public void Apply(AppSettings s)
    {
        _s = s;
        var m = _el.Manifest;
        Height = s.Height;
        Width = BuddyLayout.WindowWidth(s.Height, m);
        Opacity = s.Opacity / 100.0;
        _el.Paused = s.Paused;
        Place();
    }

    private void Place()
    {
        var probeX = _s.X is { } sx ? sx + Width / 2 : SystemParameters.PrimaryScreenWidth - Width / 2;
        var probeY = _s.Y is { } sy ? sy + Height / 2 : SystemParameters.PrimaryScreenHeight - Height / 2;
        var area = WorkArea(probeX, probeY);
        var x = _s.X ?? area.Right - Width - EdgeGap;
        var y = _s.StayOnBottom ? area.Bottom - Height : _s.Y ?? area.Bottom - Height - EdgeGap;
        (Left, Top) = Clamp(x, y);
    }

    private void OnDrag(double dxPx, double dyPx)
    {
        var dpi = VisualTreeHelper.GetDpi(this);
        var x = Left + dxPx / dpi.DpiScaleX;
        var y = _s.StayOnBottom ? Top : Top + dyPx / dpi.DpiScaleY;
        (x, y) = Clamp(x, y);
        if (_s.StayOnBottom) y = WorkArea(x + Width / 2, y + Height / 2).Bottom - Height;      // keep standing on the edge
        Left = x;
        Top = y;
    }

    /// <summary>Keeps the whole window on the desktop (all monitors together).</summary>
    private (double X, double Y) Clamp(double x, double y) => (
        Math.Clamp(x, SystemParameters.VirtualScreenLeft, Math.Max(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - Width)),
        Math.Clamp(y, SystemParameters.VirtualScreenTop, Math.Max(SystemParameters.VirtualScreenTop, SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - Height)));

    /// <summary>The usable area (screen minus taskbar) of the monitor holding the point, in device-independent pixels.</summary>
    private Rect WorkArea(double x, double y)
    {
        var dpi = VisualTreeHelper.GetDpi(this);
        var screen = WinForms.Screen.FromPoint(new System.Drawing.Point((int)(x * dpi.DpiScaleX), (int)(y * dpi.DpiScaleY)));
        var w = screen.WorkingArea;
        return new Rect(w.Left / dpi.DpiScaleX, w.Top / dpi.DpiScaleY, w.Width / dpi.DpiScaleX, w.Height / dpi.DpiScaleY);
    }
}
