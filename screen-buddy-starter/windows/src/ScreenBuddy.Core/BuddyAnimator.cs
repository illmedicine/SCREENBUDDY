namespace ScreenBuddy.Core;

/// <summary>A single frame to show: <see cref="Frame"/> of the strip called <see cref="Move"/>.</summary>
public readonly record struct FramePick(string Move, int Frame);

/// <summary>
/// Decides which frame the buddy shows. The same behaviour as the Android player and the web player, with no UI.
///  - Idle:  stands on one chosen frame.
///  - Scrub: movement (a drag) steps through the scroll move, <see cref="StepPx"/> per frame, forwards then backwards
///           so it never snaps; the buddy leans up to <see cref="MaxLean"/> degrees; <see cref="SettleMs"/> after the
///           last movement it goes back to standing.
///  - Pose:  plays a random pose that isn't the one before. Short poses play forwards then backwards.
/// All times are caller-supplied milliseconds on any monotonic clock. <paramref name="ready"/> says whether a move's
/// frames have loaded; moves that haven't are never chosen.
/// </summary>
public sealed class BuddyAnimator
{
    public const float StepPx = 28f;
    public const float MaxLean = 5f;
    public const float LeanDiv = 8f;
    public const long SettleMs = 450;
    public const int LoopBelow = 24;

    private readonly BuddyManifest _m;
    private readonly Func<double> _random;
    private readonly Func<string, bool> _ready;
    private float _travel;
    private long _lastMoveAt;
    private bool _scrubbing;
    private string? _pose;
    private long _poseStart;
    private int _poseTotal;
    private string _lastPose = "";
    private FramePick _current;

    public BuddyAnimator(BuddyManifest manifest, Func<double>? random = null, Func<string, bool>? ready = null)
    {
        _m = manifest;
        _random = random ?? Random.Shared.NextDouble;
        _ready = ready ?? (_ => true);
        _current = new FramePick(manifest.StandClip, manifest.StandFrame);
    }

    public float Lean { get; private set; }
    public bool Posing => _pose is not null;
    /// <summary>True while something is moving and the host should keep redrawing.</summary>
    public bool Animating => Posing || _scrubbing;
    public FramePick Frame => _current;

    /// <summary>Movement of <paramref name="dy"/> pixels (signed; the sign leans the buddy). Ignored while posing, except the lean.</summary>
    public void Scrub(float dy, long now)
    {
        Lean = Math.Clamp(dy / LeanDiv, -MaxLean, MaxLean);
        _lastMoveAt = now;
        if (Posing) return;
        _scrubbing = true;
        if (!_ready(_m.Scroll)) return;
        _travel += Math.Abs(dy);
        var n = _m.Clips[_m.Scroll].N;
        if (n == 1) { _current = new FramePick(_m.Scroll, 0); return; }
        var cycle = 2 * n - 2;
        var k = (int)(_travel / StepPx) % cycle;
        _current = new FramePick(_m.Scroll, k < n ? k : cycle - k);
    }

    /// <summary>Starts a random ready pose, never the same as the last. False if one is playing or none has loaded.</summary>
    public bool Tap(long now)
    {
        if (Posing) return false;
        var choices = _m.Poses.Where(p => _ready(p) && p != _lastPose).ToList();
        if (choices.Count == 0) choices = _m.Poses.Where(_ready).ToList();
        if (choices.Count == 0) return false;
        Start(choices[(int)(_random() * choices.Count)], now);
        return true;
    }

    /// <summary>Plays a specific move as a pose (the screensaver showcase uses this).</summary>
    public bool Play(string move, long now)
    {
        if (Posing || !_m.Clips.ContainsKey(move) || !_ready(move)) return false;
        Start(move, now);
        return true;
    }

    private void Start(string move, long now)
    {
        var n = _m.Clips[move].N;
        _pose = move; _lastPose = move; _poseStart = now;
        _poseTotal = n < LoopBelow ? 2 * n - 1 : n;
        _scrubbing = false;
        _current = new FramePick(move, 0);
    }

    /// <summary>Advances time-driven state. Call once per drawn frame.</summary>
    public void Update(long now)
    {
        if (_pose is { } p)
        {
            var n = _m.Clips[p].N;
            var k = (int)((now - _poseStart) * _m.Fps / 1000);
            if (k >= _poseTotal) { _pose = null; Stand(); }
            else _current = new FramePick(p, k < n ? k : 2 * n - 2 - k);
        }
        else if (_scrubbing && now - _lastMoveAt >= SettleMs)
        {
            _scrubbing = false;
            Stand();
        }
    }

    /// <summary>Drops whatever is playing and goes back to standing (used when the user pauses the buddy).</summary>
    public void Stop()
    {
        _pose = null;
        _scrubbing = false;
        Stand();
    }

    private void Stand()
    {
        Lean = 0;
        _current = new FramePick(_m.StandClip, _m.StandFrame);
    }
}

/// <summary>Where to draw a buddy inside a window. The lean swings the head sideways, so the window is a little wider than the buddy.</summary>
public static class BuddyLayout
{
    /// <summary>sin(5 degrees): how far the head swings sideways at full lean, as a fraction of the drawn height.</summary>
    public const double Lean = 0.0872;

    /// <summary>Width of a window that fits a buddy <paramref name="height"/> tall, with room for the lean on both sides.</summary>
    public static double WindowWidth(double height, BuddyManifest m) =>
        Math.Ceiling(height * ((double)m.Cw / m.Ch + 2 * Lean));

    /// <summary>Fits the buddy into a <paramref name="w"/> x <paramref name="h"/> area, standing on the bottom edge, centred.</summary>
    public static (double X, double Y, double W, double H) Fit(double w, double h, BuddyManifest m)
    {
        var scale = Math.Min(w / (m.Cw + 2 * Lean * m.Ch), h / m.Ch);
        var dw = m.Cw * scale;
        var dh = m.Ch * scale;
        return ((w - dw) / 2, h - dh, dw, dh);
    }
}
