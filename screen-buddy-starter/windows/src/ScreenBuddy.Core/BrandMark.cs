namespace ScreenBuddy.Core;

/// <summary>A square region of an image, in pixels.</summary>
public readonly record struct SquareCrop(int X, int Y, int Size);

/// <summary>
/// Shared logic for the animated brand mark (the tray icon on Windows; the web logo in web/js/holo-logo.js does the
/// same): each buddy, cut to head and waist, takes a turn rising out of a glowing phone.
/// </summary>
public static class BrandMark
{
    /// <summary>
    /// Where a buddy's head to waist is within one sprite frame, as a square crop centred on the head.
    /// <paramref name="alpha"/> holds one alpha value per pixel, row by row. Null if the frame is empty.
    /// </summary>
    public static SquareCrop? BustRect(ReadOnlySpan<byte> alpha, int w, int h, byte threshold = 40)
    {
        if (w <= 0 || h <= 0 || alpha.Length < w * h) return null;
        int top = h, bottom = -1, left = w, right = -1;
        for (var y = 0; y < h; y++)
        for (var x = 0; x < w; x++)
        {
            if (alpha[y * w + x] <= threshold) continue;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
        }
        if (bottom < 0) return null;

        var bodyH = bottom - top + 1;
        var headRows = Math.Max(1, (int)Math.Round(bodyH / 8.0));
        double sum = 0;
        var count = 0;
        for (var y = top; y < top + headRows; y++)
        for (var x = left; x <= right; x++)
            if (alpha[y * w + x] > threshold) { sum += x; count++; }
        var cx = count > 0 ? sum / count : (left + right) / 2.0;

        var size = Math.Max(1, Math.Min(Math.Min(w, h), (int)Math.Round(bodyH * 0.56)));
        var sx = (int)Math.Round(Math.Clamp(cx - size / 2.0, 0, w - size));
        var sy = (int)Math.Round(Math.Clamp(top - size * 0.05, 0, h - size));
        return new SquareCrop(sx, sy, size);
    }
}
