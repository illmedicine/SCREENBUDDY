using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using ScreenBuddy.Core;
using SkiaSharp;

namespace ScreenBuddy.App;

/// <summary>
/// Holds a buddy's decoded frames. Each WebP strip is decoded once (by SkiaSharp; Windows has no built-in WebP
/// codec we can count on) and cut into one frozen bitmap per frame. Moves load on thread-pool threads and only count
/// as <see cref="Ready"/> once every frame is in memory.
/// </summary>
internal sealed class SpriteBank
{
    private const long MaxStripPixels = 40_000_000;
    private readonly Buddy _buddy;
    private readonly ConcurrentDictionary<string, BitmapSource[]> _frames = new();
    private readonly ConcurrentDictionary<string, byte> _requested = new();   // loading, or failed (not retried)

    public SpriteBank(Buddy buddy) => _buddy = buddy;

    public BuddyManifest Manifest => _buddy.Manifest;
    public Buddy Buddy => _buddy;

    /// <summary>Raised on a thread-pool thread whenever a move finishes loading.</summary>
    public event Action? Loaded;

    public bool Ready(string move) => _frames.ContainsKey(move);

    public BitmapSource? Frame(string move, int index) =>
        _frames.TryGetValue(move, out var a) && index >= 0 && index < a.Length ? a[index] : null;

    /// <summary>Loads the standing move first, then the scroll move, then the poses.</summary>
    public void LoadAll()
    {
        Load(Manifest.StandClip);
        Load(Manifest.Scroll);
        foreach (var p in Manifest.Poses) Load(p);
    }

    public void Load(string move)
    {
        if (!Manifest.Clips.ContainsKey(move) || _frames.ContainsKey(move) || !_requested.TryAdd(move, 0)) return;
        Task.Run(() =>
        {
            try
            {
                _frames[move] = Decode(move);
                _requested.TryRemove(move, out _);
            }
            catch (Exception)
            {
                // A strip that won't decode stays in _requested, so it isn't retried; the buddy just never uses that move.
            }
            Loaded?.Invoke();
        });
    }

    private BitmapSource[] Decode(string move)
    {
        var m = Manifest;
        var clip = m.Clips[move];
        using var stream = _buddy.Source.Open(clip.Src);
        using var codec = SKCodec.Create(stream) ?? throw new InvalidOperationException($"Can't decode {clip.Src}");
        var info = codec.Info;
        if (info.Width < clip.N * m.Cw || info.Height < m.Ch)
            throw new InvalidOperationException($"Strip {clip.Src} is {info.Width}x{info.Height}, expected {clip.N * m.Cw}x{m.Ch}");
        if ((long)info.Width * info.Height > MaxStripPixels) throw new InvalidOperationException($"Strip {clip.Src} is too large");

        // WPF's Pbgra32 is premultiplied BGRA, which is exactly what we ask Skia to produce.
        using var bmp = SKBitmap.Decode(codec, new SKImageInfo(info.Width, info.Height, SKColorType.Bgra8888, SKAlphaType.Premul))
                        ?? throw new InvalidOperationException($"Can't decode {clip.Src}");
        var pixels = bmp.GetPixelSpan();
        var stride = bmp.RowBytes;
        var rowBytes = m.Cw * 4;
        var result = new BitmapSource[clip.N];
        for (var i = 0; i < clip.N; i++)
        {
            var buf = new byte[rowBytes * m.Ch];
            for (var row = 0; row < m.Ch; row++)
                pixels.Slice(row * stride + i * rowBytes, rowBytes).CopyTo(buf.AsSpan(row * rowBytes, rowBytes));
            var frame = BitmapSource.Create(m.Cw, m.Ch, 96, 96, PixelFormats.Pbgra32, null, buf, rowBytes);
            frame.Freeze();                                   // frozen bitmaps can be used from any thread
            result[i] = frame;
        }
        return result;
    }
}
