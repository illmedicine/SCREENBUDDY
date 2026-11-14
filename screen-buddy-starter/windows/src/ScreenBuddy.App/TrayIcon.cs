using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Threading;
using ScreenBuddy.Core;
using SkiaSharp;
using WinForms = System.Windows.Forms;

namespace ScreenBuddy.App;

/// <summary>The still tray icon: the brand artwork (app.ico, embedded) at the tray's size for this screen's DPI.</summary>
internal static class TrayIcon
{
    public static Icon Create()
    {
        var size = WinForms.SystemInformation.SmallIconSize;
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("ScreenBuddy.app.ico");
        if (stream is not null) return new Icon(stream, size);
        return (Icon)SystemIcons.Application.Clone();
    }

    /// <summary>Turns a Skia bitmap into an icon that owns its own handle.</summary>
    internal static Icon ToIcon(SKBitmap bmp)
    {
        using var image = SKImage.FromBitmap(bmp);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        using var ms = new MemoryStream(data.ToArray());
        using var bitmap = new Bitmap(ms);
        var hIcon = bitmap.GetHicon();
        try
        {
            using var fromHandle = Icon.FromHandle(hIcon);
            return (Icon)fromHandle.Clone();
        }
        finally
        {
            Win32.Destroy(hIcon);
        }
    }
}

/// <summary>
/// The animated tray icon: every few seconds the next buddy rises out of a glowing phone as a hologram, the same
/// mark as the web logo. Frames are drawn once, up front, on a background thread; the tray just swaps them.
/// Stays on the still icon when Windows animations are turned off.
/// </summary>
internal sealed class TrayAnimator : IDisposable
{
    private const int RiseFrames = 7;
    private static readonly TimeSpan FrameTime = TimeSpan.FromMilliseconds(70);
    private static readonly TimeSpan HoldTime = TimeSpan.FromSeconds(3.4);
    private const int MaxBuddies = 12;

    private readonly WinForms.NotifyIcon _tray;
    private readonly Icon _still;
    private readonly DispatcherTimer _timer = new();
    private List<Icon[]> _sets = new();
    private int _buddy, _frame;
    private bool _disposed;

    public TrayAnimator(WinForms.NotifyIcon tray, Icon still)
    {
        _tray = tray;
        _still = still;
        _timer.Tick += (_, _) => Step();
    }

    /// <summary>True when Windows' "Animation effects" setting is on.</summary>
    private static bool AnimationsOn => System.Windows.SystemParameters.ClientAreaAnimation;

    /// <summary>Starts, or restarts with a new list (the admin hid or added buddies).</summary>
    public void Start(IReadOnlyList<Buddy> buddies)
    {
        if (!AnimationsOn || buddies.Count == 0) { Clear(); return; }
        var px = WinForms.SystemInformation.SmallIconSize.Width;
        var dispatcher = Dispatcher.CurrentDispatcher;
        Task.Run(() =>
        {
            var sets = new List<Icon[]>();
            foreach (var b in buddies.Take(MaxBuddies))
            {
                try { if (LoadBust(b) is { } bust) using (bust) sets.Add(Render(bust, px)); }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
                {
                    // A buddy whose strip won't decode just sits out of the rotation.
                }
            }
            dispatcher.BeginInvoke(() =>
            {
                if (_disposed || sets.Count == 0) { foreach (var s in sets) foreach (var i in s) i.Dispose(); return; }
                Clear();
                _sets = sets;
                _buddy = 0;
                _frame = 0;
                _timer.Interval = FrameTime;
                _timer.Start();
            });
        });
    }

    private void Step()
    {
        var set = _sets[_buddy];
        _tray.Icon = set[_frame];
        if (_frame < set.Length - 1)
        {
            _frame++;
            _timer.Interval = FrameTime;
        }
        else
        {
            _buddy = (_buddy + 1) % _sets.Count;
            _frame = 0;
            _timer.Interval = HoldTime;          // hold the fully risen buddy, then the next one starts rising
        }
    }

    /// <summary>For the self-test: one buddy's tray frame at <paramref name="px"/> pixels, <paramref name="k"/> of the way risen.</summary>
    internal static SKBitmap? Preview(Buddy buddy, int px, float k = 1)
    {
        using var bust = LoadBust(buddy);
        return bust is null ? null : DrawMark(bust, px, k);
    }

    /// <summary>The buddy's standing frame, cut to head and waist, with the bottom dissolving away.</summary>
    private static SKBitmap? LoadBust(Buddy buddy)
    {
        var m = buddy.Manifest;
        if (!m.Clips.TryGetValue(m.StandClip, out var clip)) return null;
        using var stream = buddy.Source.Open(clip.Src);
        using var strip = SKBitmap.Decode(stream);
        if (strip is null) return null;
        var fx = m.StandFrame * m.Cw;
        if (fx + m.Cw > strip.Width || m.Ch > strip.Height) return null;

        var alpha = new byte[m.Cw * m.Ch];
        for (var y = 0; y < m.Ch; y++)
        for (var x = 0; x < m.Cw; x++)
            alpha[y * m.Cw + x] = strip.GetPixel(fx + x, y).Alpha;
        if (BrandMark.BustRect(alpha, m.Cw, m.Ch) is not { } r) return null;

        const int n = 96;
        var bust = new SKBitmap(new SKImageInfo(n, n, SKColorType.Bgra8888, SKAlphaType.Premul));
        using var c = new SKCanvas(bust);
        c.Clear(SKColors.Transparent);
        using (var paint = new SKPaint { IsAntialias = true })
        using (var src = SKImage.FromBitmap(strip))
            c.DrawImage(src, SKRect.Create(fx + r.X, r.Y, r.Size, r.Size), SKRect.Create(0, 0, n, n), new SKSamplingOptions(SKCubicResampler.Mitchell), paint);
        using var fade = new SKPaint
        {
            BlendMode = SKBlendMode.DstIn,
            Shader = SKShader.CreateLinearGradient(new SKPoint(0, 0), new SKPoint(0, n),
                new[] { SKColors.Black, SKColors.Black, SKColors.Transparent }, new[] { 0f, 0.62f, 1f }, SKShaderTileMode.Clamp),
        };
        c.DrawRect(0, 0, n, n, fade);
        return bust;
    }

    /// <summary>The rise frames for one buddy at <paramref name="px"/> pixels; the last frame is the one held.</summary>
    private static Icon[] Render(SKBitmap bust, int px)
    {
        var icons = new Icon[RiseFrames];
        for (var i = 0; i < RiseFrames; i++)
        {
            var k = 1 - Math.Pow(1 - (i + 1) / (double)RiseFrames, 3);       // ease out
            using var bmp = DrawMark(bust, px, (float)k);
            icons[i] = TrayIcon.ToIcon(bmp);
        }
        return icons;
    }

    /// <summary>Draws at 4x and scales down, so the small tray sizes stay smooth.</summary>
    private static SKBitmap DrawMark(SKBitmap bust, int px, float k)
    {
        var s = px * 4f;
        using var big = new SKBitmap(new SKImageInfo((int)s, (int)s, SKColorType.Bgra8888, SKAlphaType.Premul));
        using (var c = new SKCanvas(big))
        {
            c.Clear(SKColors.Transparent);
            using var tile = new SKRoundRect(SKRect.Create(0, 0, s, s), s * 0.24f);
            c.ClipRoundRect(tile, antialias: true);

            using (var bg = new SKPaint { Shader = SKShader.CreateLinearGradient(new SKPoint(0, 0), new SKPoint(0, s),
                       new[] { new SKColor(0x2A, 0x1D, 0x78), new SKColor(0x0A, 0x10, 0x29) }, SKShaderTileMode.Clamp) })
                c.DrawRect(0, 0, s, s, bg);
            using (var glow = new SKPaint { Shader = SKShader.CreateRadialGradient(new SKPoint(s * 0.52f, s * 0.72f), s * 0.62f,
                       new[] { new SKColor(0x2D, 0xE3, 0xB8, 140), new SKColor(0x2D, 0xE3, 0xB8, 0) }, SKShaderTileMode.Clamp) })
                c.DrawRect(0, 0, s, s, glow);

            // the phone: tilted, a teal-to-violet glass edge
            var phone = SKRect.Create(-s * 0.2f, -s * 0.29f, s * 0.4f, s * 0.66f);
            c.Save();
            c.Translate(s * 0.52f, s * 0.66f);
            c.RotateDegrees(-9.7f);
            using (var edge = new SKPaint
                   {
                       IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = Math.Max(4, s * 0.06f),
                       Shader = SKShader.CreateLinearGradient(new SKPoint(0, phone.Top), new SKPoint(0, phone.Bottom),
                           new[] { new SKColor(0x7F, 0xF5, 0xE6), new SKColor(0xA0, 0x78, 0xFF), new SKColor(0x2D, 0xE3, 0xB8) }, SKShaderTileMode.Clamp),
                   })
                c.DrawRoundRect(phone, s * 0.09f, s * 0.09f, edge);
            c.Restore();

            // the buddy rising out of the screen, with a teal halo
            var size = s * 0.7f;
            var y = s * 0.05f + (1 - k) * s * 0.34f;
            using (var p = new SKPaint
                   {
                       IsAntialias = true,
                       Color = SKColors.White.WithAlpha((byte)(255 * k)),
                       ImageFilter = SKImageFilter.CreateDropShadow(0, 0, s * 0.03f, s * 0.03f, new SKColor(0x2D, 0xE3, 0xB8, 220)),
                   })
            using (var img = SKImage.FromBitmap(bust))
                c.DrawImage(img, SKRect.Create((s - size) / 2, y, size, size), new SKSamplingOptions(SKCubicResampler.Mitchell), p);

            // a sparkle, once it's big enough to see
            if (px >= 20)
                using (var star = new SKPaint { IsAntialias = true, Color = new SKColor(0xE9, 0xFF, 0xFB, (byte)(230 * k)) })
                    c.DrawCircle(s * 0.82f, s * 0.22f, s * 0.035f, star);
        }

        var small = new SKBitmap(new SKImageInfo(px, px, SKColorType.Bgra8888, SKAlphaType.Premul));
        big.ScalePixels(small, new SKSamplingOptions(SKCubicResampler.Mitchell));
        return small;
    }

    /// <summary>Back to the still icon, freeing the frames.</summary>
    private void Clear()
    {
        _timer.Stop();
        _tray.Icon = _still;
        foreach (var set in _sets) foreach (var icon in set) icon.Dispose();
        _sets = new List<Icon[]>();
    }

    public void Dispose()
    {
        _disposed = true;
        Clear();
    }
}
