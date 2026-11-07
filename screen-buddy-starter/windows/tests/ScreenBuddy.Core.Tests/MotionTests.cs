using System.IO;
using ScreenBuddy.Core;
using Xunit;

namespace ScreenBuddy.Core.Tests;

public class MotionTests
{
    [Fact]
    public void ActivityGate_is_quiet_until_pinged()
    {
        var g = new ActivityGate(700);
        Assert.False(g.IsActive(0));
    }

    [Fact]
    public void ActivityGate_stays_active_through_short_pauses_then_stops()
    {
        var g = new ActivityGate(700);
        g.Ping(1000);
        Assert.True(g.IsActive(1000));
        Assert.True(g.IsActive(1699));
        g.Ping(1600);                      // typing again before the hold ran out
        Assert.True(g.IsActive(2299));
        Assert.False(g.IsActive(2300));
    }

    [Fact]
    public void ActivityGate_reset_clears()
    {
        var g = new ActivityGate();
        g.Ping(0);
        g.Reset();
        Assert.False(g.IsActive(1));
    }

    private static bool Feed(SoundGate g, double level, long fromMs, long toMs, long stepMs = 10)
    {
        var last = false;
        for (var t = fromMs; t <= toMs; t += stepMs) last = g.Update(level, t);
        return last;
    }

    [Fact]
    public void SoundGate_silence_never_activates()
    {
        var g = new SoundGate();
        Assert.False(Feed(g, 0.0, 0, 5000));
        Assert.False(Feed(g, 0.005, 5000, 10000));
    }

    [Fact]
    public void SoundGate_hum_present_from_the_very_start_is_not_sound()
    {
        var g = new SoundGate();
        Assert.False(Feed(g, 0.08, 0, 20000));
    }

    [Fact]
    public void SoundGate_loud_sound_activates_after_attack_and_stops_after_release()
    {
        var g = new SoundGate(attackMs: 80, releaseMs: 700);
        Feed(g, 0.0, 0, 1000);
        Assert.False(g.Update(0.3, 1010));         // just started: not yet
        Assert.True(Feed(g, 0.3, 1020, 1200));
        Assert.True(Feed(g, 0.0, 1210, 1800));     // a gap shorter than the release keeps going
        Assert.False(Feed(g, 0.0, 1810, 2000));    // the silence has outlasted the release
    }

    [Fact]
    public void SoundGate_ignores_a_brief_pop()
    {
        var g = new SoundGate(attackMs: 80);
        Feed(g, 0.0, 0, 1000);
        g.Update(0.9, 1000);
        g.Update(0.9, 1010);
        Assert.False(Feed(g, 0.0, 1020, 1500));
    }

    [Fact]
    public void SoundGate_gaps_between_words_do_not_stop_it()
    {
        var g = new SoundGate(attackMs: 80, releaseMs: 700);
        Feed(g, 0.0, 0, 1000);
        Feed(g, 0.3, 1010, 1300);
        for (var i = 0; i < 5; i++)
        {
            Feed(g, 0.0, 1310 + i * 800, 1600 + i * 800);        // 300 ms between words
            Assert.True(Feed(g, 0.3, 1610 + i * 800, 2100 + i * 800));
        }
    }

    [Fact]
    public void SoundGate_steady_background_hum_is_learned_and_ignored()
    {
        var g = new SoundGate(minThreshold: 0.02, ratio: 3.0);
        // A fan at a level of 0.05 is above the fixed minimum but is the room's normal sound.
        var active = false;
        for (long t = 0; t < 30000; t += 10) active = g.Update(0.05, t);
        Assert.False(active);
        Assert.InRange(g.NoiseFloor, 0.04, 0.051);
    }

    [Fact]
    public void SoundGate_speech_over_a_hum_still_activates()
    {
        var g = new SoundGate();
        Feed(g, 0.05, 0, 30000);
        Assert.False(g.Active);
        Assert.True(Feed(g, 0.4, 30010, 30300));
    }

    [Fact]
    public void SoundGate_ignores_garbage_readings()
    {
        var g = new SoundGate();
        Assert.False(g.Update(double.NaN, 0));
        Assert.False(g.Update(double.PositiveInfinity, 10));
        Assert.False(g.Update(-5, 20));
    }

    [Fact]
    public void Settings_motion_defaults_to_touch_and_round_trips_as_text()
    {
        var path = Path.Combine(Path.GetTempPath(), "sb-motion-" + Path.GetRandomFileName() + ".json");
        try
        {
            var store = new SettingsStore(path);
            Assert.Equal(MotionMode.Touch, store.Load().Motion);
            store.Save(new AppSettings { Motion = MotionMode.Sound });
            Assert.Contains("\"Sound\"", File.ReadAllText(path));
            Assert.Equal(MotionMode.Sound, store.Load().Motion);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Settings_with_an_unknown_motion_value_fall_back_to_defaults()
    {
        var path = Path.Combine(Path.GetTempPath(), "sb-motion-" + Path.GetRandomFileName() + ".json");
        try
        {
            File.WriteAllText(path, "{\"Motion\":\"Telepathy\"}");
            Assert.Equal(MotionMode.Touch, new SettingsStore(path).Load().Motion);
        }
        finally { File.Delete(path); }
    }
}
