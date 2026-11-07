using System;
using System.Windows.Threading;
using ScreenBuddy.Core;

namespace ScreenBuddy.App;

/// <summary>
/// Makes the buddy walk on the spot according to the chosen <see cref="MotionMode"/>: all the time, while you type, or
/// while the microphone hears sound. Clicking and dragging keep working in every mode.
/// </summary>
internal sealed class MotionDriver : IDisposable
{
    // Scrubbing moves the walk cycle by 28 px per frame, so px/s divided by 28 is frames per second.
    private static readonly double NaturalPxPerSec = BuddyAnimator.StepPx * 10;     // the sample buddies are 10 fps
    private const double SteadyFactor = 0.6;                                          // steady is the relaxed pace
    private const double ReactiveFactor = 1.0;

    private readonly BuddyElement _el;
    private readonly MotionMode _mode;
    private readonly DispatcherTimer _timer;
    private readonly ActivityGate _typing = new();
    private readonly SoundGate _sound = new();
    private KeyboardActivity? _keys;
    private MicLevel? _mic;
    private long _last;

    /// <summary>Raised on the UI thread when the source of movement can't be used. The message is meant for the user.</summary>
    public event Action<string>? Problem;

    public MotionDriver(BuddyElement element, MotionMode mode)
    {
        _el = element;
        _mode = mode;
        _timer = new DispatcherTimer(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(16) };
        _timer.Tick += (_, _) => Step();
    }

    public MotionMode Mode => _mode;

    public void Start()
    {
        if (_mode == MotionMode.Touch) return;
        try
        {
            switch (_mode)
            {
                case MotionMode.Typing:
                    _keys = new KeyboardActivity();
                    _keys.KeyDown += () => _typing.Ping(Environment.TickCount64);
                    _keys.Start();
                    break;
                case MotionMode.Sound:
                    _mic = new MicLevel();
                    var dispatcher = _el.Dispatcher;
                    _mic.Failed += msg => dispatcher.BeginInvoke(() => Problem?.Invoke("The microphone stopped working: " + msg));
                    _mic.LooksBlocked += () => dispatcher.BeginInvoke(() => Problem?.Invoke(
                        "The microphone isn't giving Screen Buddy any sound. Check Settings > Privacy & security > Microphone, and turn on \"Let desktop apps access your microphone\"."));
                    _mic.Start();
                    break;
            }
        }
        catch (Exception e)
        {
            Dispose();
            Problem?.Invoke(_mode == MotionMode.Sound
                ? "Couldn't listen to the microphone: " + e.Message
                : "Couldn't watch for typing: " + e.Message);
            return;
        }
        _last = Environment.TickCount64;
        _timer.Start();
    }

    private void Step()
    {
        var now = Environment.TickCount64;
        var dt = Math.Min(now - _last, 100) / 1000.0;      // a stall must not make the buddy lurch
        _last = now;
        var active = _mode switch
        {
            MotionMode.Steady => true,
            MotionMode.Typing => _typing.IsActive(now),
            MotionMode.Sound => _mic is not null && _sound.Update(_mic.TakePeak(), now),
            _ => false,
        };
        if (!active || _el.Paused || _el.Posing) return;
        var factor = _mode == MotionMode.Steady ? SteadyFactor : ReactiveFactor;
        _el.Scrub((float)(NaturalPxPerSec * factor * dt));
    }

    public void Dispose()
    {
        _timer.Stop();
        _keys?.Dispose();
        _mic?.Dispose();
        _keys = null;
        _mic = null;
    }
}
