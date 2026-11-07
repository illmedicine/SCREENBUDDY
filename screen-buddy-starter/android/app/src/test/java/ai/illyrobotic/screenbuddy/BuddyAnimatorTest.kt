package ai.illyrobotic.screenbuddy

import ai.illyrobotic.screenbuddy.engine.BuddyAnimator
import ai.illyrobotic.screenbuddy.engine.FramePick
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class BuddyAnimatorTest {
    private val m = TestBuddies.claw
    private fun animator(ready: (String) -> Boolean = { true }, seed: Int = 1) = BuddyAnimator(m, Random(seed), ready)

    @Test fun startsOnTheStandingFrame() {
        val a = animator()
        assertEquals(FramePick("hips", 0), a.frame())
        assertFalse(a.animating)
    }

    @Test fun scrollingStepsThroughTheWalkOneFramePerStep() {
        val a = animator()
        a.scrub(28f, 0)
        assertEquals(FramePick("strut", 1), a.frame())
        a.scrub(28f * 8, 10)                 // travel is now 9 steps: the last frame
        assertEquals(FramePick("strut", 9), a.frame())
    }

    @Test fun scrollingPlaysBackwardsAtTheEndInsteadOfSnapping() {
        val a = animator()
        a.scrub(28f * 10, 0)                 // 10 steps of an 18-step cycle: coming back, frame 8
        assertEquals(FramePick("strut", 8), a.frame())
        a.scrub(28f * 8, 10)                 // 18 steps: back at the start
        assertEquals(FramePick("strut", 0), a.frame())
    }

    @Test fun leanFollowsMovementAndIsClamped() {
        val a = animator()
        a.scrub(16f, 0)
        assertEquals(2f, a.lean, 0.001f)
        a.scrub(-500f, 1)
        assertEquals(-5f, a.lean, 0.001f)
    }

    @Test fun goesBackToStandingOnceMovementStops() {
        val a = animator()
        a.scrub(60f, 1000)
        assertTrue(a.animating)
        a.update(1000 + 449)
        assertTrue(a.animating)
        a.update(1000 + 450)
        assertFalse(a.animating)
        assertEquals(FramePick("hips", 0), a.frame())
        assertEquals(0f, a.lean, 0f)
    }

    @Test fun tapStartsAPoseAndNeverRepeatsTheLastOne() {
        val a = animator()
        var last = ""
        var t = 0L
        repeat(30) {
            assertTrue(a.tap(t))
            val move = a.frame().move
            assertTrue(move in m.poses)
            assertTrue("repeated $move", move != last)
            last = move
            t += 10_000                      // long enough for any pose to finish
            a.update(t)
            assertFalse(a.posing)
        }
    }

    @Test fun aSecondTapDuringAPoseIsIgnored() {
        val a = animator()
        assertTrue(a.tap(0))
        assertFalse(a.tap(100))
    }

    @Test fun shortPosesPlayForwardsThenBackwards() {
        val a = animator()
        assertTrue(a.play("hips", 0))        // 17 frames: 33 steps there and back
        a.update(0);    assertEquals(FramePick("hips", 0), a.frame())
        a.update(1600); assertEquals(FramePick("hips", 16), a.frame())
        a.update(1700); assertEquals(FramePick("hips", 15), a.frame())
        a.update(3200); assertEquals(FramePick("hips", 0), a.frame())
        assertTrue(a.posing)
        a.update(3300)                       // 33 steps done: back to standing
        assertFalse(a.posing)
        assertEquals(FramePick("hips", 0), a.frame())
    }

    @Test fun longPosesPlayOnce() {
        val a = animator()
        assertTrue(a.play("wave", 0))        // 40 frames, at 10 fps = 4 s
        a.update(3900); assertEquals(FramePick("wave", 39), a.frame())
        assertTrue(a.posing)
        a.update(4000)
        assertFalse(a.posing)
        assertEquals(FramePick("hips", 0), a.frame())
    }

    @Test fun movementDuringAPoseDoesNotInterruptIt() {
        val a = animator()
        a.play("wave", 0)
        a.update(500)
        val before = a.frame()
        a.scrub(200f, 600)
        assertEquals(before, a.frame())
        assertTrue(a.posing)
    }

    @Test fun neverChoosesAMoveThatHasNotLoaded() {
        val a = animator(ready = { it == "arms" })
        repeat(10) {
            assertTrue(a.tap(it * 10_000L))
            assertEquals("arms", a.frame().move)
            a.update(it * 10_000L + 9_999)
        }
    }

    @Test fun tapDoesNothingWhenNoPoseHasLoaded() {
        val a = animator(ready = { false })
        assertFalse(a.tap(0))
        a.scrub(100f, 0)                     // the walk isn't loaded either: it keeps standing
        assertEquals(FramePick("hips", 0), a.frame())
    }
}
