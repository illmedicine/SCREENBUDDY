using System;
using System.Drawing;
using System.IO;
using SkiaSharp;

namespace ScreenBuddy.App;

/// <summary>The tray icon, drawn in code (navy disc, teal ring, violet eyes) so the app needs no .ico file.</summary>
internal static class TrayIcon
{
    public static Icon Create()
    {
        const int size = 32;
        using var surface = SKSurface.Create(new SKImageInfo(size, size, SKColorType.Bgra8888, SKAlphaType.Premul));
        var c = surface.Canvas;
        c.Clear(SKColors.Transparent);
        using var navy = new SKPaint { Color = new SKColor(0x0B, 0x1F, 0x3A), IsAntialias = true };
        using var teal = new SKPaint { Color = new SKColor(0x14, 0xB8, 0xA6), IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 3 };
        using var violet = new SKPaint { Color = new SKColor(0x8B, 0x5C, 0xF6), IsAntialias = true };
        using var smile = new SKPaint { Color = SKColors.White, IsAntialias = true, Style = SKPaintStyle.Stroke, StrokeWidth = 2.2f, StrokeCap = SKStrokeCap.Round };
        c.DrawCircle(16, 16, 15, navy);
        c.DrawCircle(16, 16, 14, teal);
        c.DrawCircle(11, 13, 2.4f, violet);
        c.DrawCircle(21, 13, 2.4f, violet);
        using var path = new SKPath();
        path.MoveTo(9.5f, 19.5f);
        path.QuadTo(16, 26, 22.5f, 19.5f);
        c.DrawPath(path, smile);

        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        using var ms = new MemoryStream(data.ToArray());
        using var bitmap = new Bitmap(ms);
        var hIcon = bitmap.GetHicon();
        try
        {
            using var fromHandle = Icon.FromHandle(hIcon);
            return (Icon)fromHandle.Clone();           // the clone owns its own copy, so the handle can be released
        }
        finally
        {
            Win32.Destroy(hIcon);
        }
    }
}
