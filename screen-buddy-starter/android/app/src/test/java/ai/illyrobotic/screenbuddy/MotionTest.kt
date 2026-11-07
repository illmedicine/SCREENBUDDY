package ai.illyrobotic.screenbuddy

import ai.illyrobotic.screenbuddy.motion.ActivityGate
import ai.illyrobotic.screenbuddy.motion.MotionMode
import ai.illyrobotic.screenbuddy.motion.SoundGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionTest {
    private fun feed(g: SoundGate, level: Double, from: Long, to: Long, step: Long = 10): Boolean {
        var last = false
        var t = from
        while (t <= to) { last = g.update(level, t); t += step }
        return last
    }

    @Test fun activityGateIsQuietUntilPinged() = assertFalse(ActivityGate().isActive(0))

    @Test fun activityGateHoldsThroughShortPausesThenStops() {
        val g = ActivityGate(700)
        g.ping(1000)
        assertTrue(g.isActive(1699))
        g.ping(1600)
        assertTrue(g.isActive(2299))
        assertFalse(g.isActive(2300))
        g.reset()
        assertFalse(g.isActive(2301))
    }

    @Test fun silenceNeverActivates() {
        val g = SoundGate()
        assertFalse(feed(g, 0.0, 0, 5000))
        assertFalse(feed(g, 0.005, 5000, 10000))
    }

    @Test fun loudSoundActivatesAfterTheAttackAndStopsAfterTheRelease() {
        val g = SoundGate()
        feed(g, 0.0, 0, 1000)
        assertFalse(g.update(0.3, 1010))
        assertTrue(feed(g, 0.3, 1020, 1200))
        assertTrue(feed(g, 0.0, 1210, 1800))     // a gap shorter than the release keeps going
        assertFalse(feed(g, 0.0, 1810, 2000))
    }

    @Test fun aBriefPopIsIgnored() {
        val g = SoundGate()
        feed(g, 0.0, 0, 1000)
        g.update(0.9, 1000); g.update(0.9, 1010)
        assertFalse(feed(g, 0.0, 1020, 1500))
    }

    @Test fun gapsBetweenWordsDoNotStopIt() {
        val g = SoundGate()
        feed(g, 0.0, 0, 1000)
        feed(g, 0.3, 1010, 1300)
        for (i in 0 until 5) {
            feed(g, 0.0, 1310L + i * 800, 1600L + i * 800)
            assertTrue(feed(g, 0.3, 1610L + i * 800, 2100L + i * 800))
        }
    }

    @Test fun aSteadyHumIsLearnedAndIgnoredEvenFromTheVeryStart() {
        val g = SoundGate()
        assertFalse(feed(g, 0.05, 0, 30000))
        assertTrue(g.noiseFloor in 0.04..0.051)
        assertTrue(feed(g, 0.4, 30010, 30300))
        assertFalse(feed(SoundGate(), 0.08, 0, 20000))
    }

    @Test fun garbageReadingsAreIgnored() {
        val g = SoundGate()
        assertFalse(g.update(Double.NaN, 0))
        assertFalse(g.update(Double.POSITIVE_INFINITY, 10))
        assertFalse(g.update(-5.0, 20))
    }

    @Test fun modesRoundTripThroughTheirKeysAndUnknownFallsBackToTouch() {
        for (m in MotionMode.entries) assertEquals(m, MotionMode.fromKey(m.key))
        assertEquals(MotionMode.Touch, MotionMode.fromKey("telepathy"))
        assertEquals(MotionMode.Touch, MotionMode.fromKey(null))
    }
}
