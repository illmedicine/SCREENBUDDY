using System;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace ScreenBuddy.App;

/// <summary>
/// Tells us that a key was pressed anywhere in Windows, so the buddy can move while you type. The hook reports only
/// "a key went down": it never looks at which key, never stores anything and never sends anything anywhere.
/// </summary>
internal sealed class KeyboardActivity : IDisposable
{
    private readonly Win32.HookProc _proc;      // kept in a field so the garbage collector can't free the callback
    private IntPtr _hook;

    public KeyboardActivity() => _proc = OnHook;

    /// <summary>Raised on the UI thread each time a key goes down (including auto-repeat).</summary>
    public event Action? KeyDown;

    public void Start()
    {
        if (_hook != IntPtr.Zero) return;
        _hook = Win32.InstallKeyboardHook(_proc);
        if (_hook == IntPtr.Zero)
            throw new InvalidOperationException("Windows would not let Screen Buddy watch for typing (error " + Marshal.GetLastWin32Error() + ").");
    }

    private IntPtr OnHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var msg = wParam.ToInt32();
            if (msg is Win32.WM_KEYDOWN or Win32.WM_SYSKEYDOWN)
            {
                try { KeyDown?.Invoke(); }
                catch (Exception) { /* a hook callback must never throw into Windows */ }
            }
        }
        return Win32.CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (_hook == IntPtr.Zero) return;
        Win32.RemoveHook(_hook);
        _hook = IntPtr.Zero;
    }
}

/// <summary>
/// Listens to the default microphone and keeps only a loudness number. The audio itself is looked at once, to find
/// its peak, and thrown away: nothing is recorded, saved or sent.
/// </summary>
internal sealed class MicLevel : IDisposable
{
    private static readonly TimeSpan BlockedAfter = TimeSpan.FromSeconds(6);
    private readonly object _gate = new();
    private WasapiCapture? _capture;
    private WaveFormat? _format;
    private double _peak;
    private long _zeroSince = -1;
    private bool _warned;

    /// <summary>The microphone stopped working (unplugged, taken away). Raised on a background thread.</summary>
    public event Action<string>? Failed;

    /// <summary>The mic has delivered nothing but digital silence for several seconds: usually Windows' microphone privacy switch. Background thread.</summary>
    public event Action? LooksBlocked;

    public void Start()
    {
        if (_capture is not null) return;
        using var enumerator = new MMDeviceEnumerator();
        MMDevice device;
        try { device = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications); }
        catch (COMException) { device = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console); }

        var capture = new WasapiCapture(device);
        var format = capture.WaveFormat;
        var supported = (format.Encoding == WaveFormatEncoding.IeeeFloat && format.BitsPerSample == 32)
                        || (format.Encoding == WaveFormatEncoding.Pcm && format.BitsPerSample == 16);
        if (!supported)
        {
            capture.Dispose();
            throw new InvalidOperationException($"The microphone uses a format Screen Buddy can't read ({format}).");
        }
        _format = format;
        capture.DataAvailable += OnData;
        capture.RecordingStopped += (_, e) => { if (e.Exception is not null) Failed?.Invoke(e.Exception.Message); };
        capture.StartRecording();
        _capture = capture;
    }

    /// <summary>The loudest reading (0 to 1) since the last call.</summary>
    public double TakePeak()
    {
        lock (_gate)
        {
            var p = _peak;
            _peak = 0;
            return p;
        }
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        var peak = 0.0;
        var span = new ReadOnlySpan<byte>(e.Buffer, 0, e.BytesRecorded);
        if (_format?.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            foreach (var f in MemoryMarshal.Cast<byte, float>(span)) peak = Math.Max(peak, Math.Abs(f));
        }
        else
        {
            foreach (var s in MemoryMarshal.Cast<byte, short>(span)) peak = Math.Max(peak, Math.Abs(s / 32768.0));
        }
        peak = Math.Min(peak, 1.0);
        lock (_gate) _peak = Math.Max(_peak, peak);

        var now = Environment.TickCount64;
        if (peak > 0) _zeroSince = -1;
        else if (_zeroSince < 0) _zeroSince = now;
        else if (!_warned && now - _zeroSince > BlockedAfter.TotalMilliseconds)
        {
            _warned = true;
            LooksBlocked?.Invoke();
        }
    }

    public void Dispose()
    {
        var c = _capture;
        _capture = null;
        if (c is null) return;
        try { c.StopRecording(); } catch (Exception) { }
        c.Dispose();
    }
}
