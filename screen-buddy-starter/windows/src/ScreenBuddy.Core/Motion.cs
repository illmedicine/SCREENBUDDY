using System.Text.Json.Serialization;

namespace ScreenBuddy.Core;

/// <summary>What makes the buddy move on its own (clicking and dragging always work, whatever the mode).</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum MotionMode
{
    /// <summary>Only when you click or drag it.</summary>
    Touch,
    /// <summary>Walks gently in place, all the time.</summary>
    Steady,
    /// <summary>Moves while you type, stops when you stop.</summary>
    Typing,
    /// <summary>Moves while the microphone hears sound, stops in silence.</summary>
    Sound,
}

/// <summary>
/// Turns "something just happened" pings (a key press) into a steady on/off signal: active from a ping until
/// <paramref name="holdMs"/> after the last one, so typing with small pauses reads as one continuous movement.
/// </summary>
public sealed class ActivityGate(long holdMs = 700)
{
    private long? _last;

    public void Ping(long nowMs) => _last = nowMs;

    public bool IsActive(long nowMs) => _last is { } t && nowMs - t < holdMs;

    public void Reset() => _last = null;
}

/// <summary>
/// Decides from a stream of microphone loudness readings (0 to 1) whether there is sound. The threshold follows the
/// room's background level (measured over the first fraction of a second), so a humming fan doesn't keep the buddy moving, and a brief click or pop (shorter than
/// <paramref name="attackMs"/>) doesn't start it. Once going, it keeps moving through the gaps between words and stops
/// <paramref name="releaseMs"/> after the sound ends.
/// </summary>
public sealed class SoundGate(double minThreshold = 0.02, double ratio = 3.0, long attackMs = 80, long releaseMs = 700, long calibrationMs = 600)
{
    private double _floor;
    private long? _aboveSince;
    private long? _startedAt;
    private long _lastLoud;
    private bool _active;

    /// <summary>Background level currently assumed (exposed for tests and diagnostics).</summary>
    public double NoiseFloor => _floor;

    public bool Active => _active;

    /// <summary>Feeds one reading taken at <paramref name="nowMs"/> and returns whether sound is currently detected.</summary>
    public bool Update(double level, long nowMs)
    {
        level = double.IsFinite(level) ? Math.Clamp(level, 0, 1) : 0;
        _startedAt ??= nowMs;
        if (nowMs - _startedAt < calibrationMs)
        {
            // The first moments only measure the room, so a fan that is already running isn't mistaken for sound.
            _floor += (level - _floor) * 0.1;
            return false;
        }
        var threshold = Math.Max(minThreshold, _floor * ratio);
        if (level > threshold)
        {
            _aboveSince ??= nowMs;
            _lastLoud = nowMs;
            if (!_active && nowMs - _aboveSince >= attackMs) _active = true;
        }
        else
        {
            _aboveSince = null;
            if (_active && nowMs - _lastLoud >= releaseMs) _active = false;
            // Learn the background only from quiet readings: drop to a lower level at once, rise towards a higher one slowly.
            if (!_active) _floor = level < _floor ? level : _floor + (level - _floor) * 0.02;
        }
        return _active;
    }

    public void Reset()
    {
        _floor = 0;
        _aboveSince = null;
        _startedAt = null;
        _active = false;
    }
}
