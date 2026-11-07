package ai.illyrobotic.screenbuddy.motion

import ai.illyrobotic.screenbuddy.engine.BuddyAnimator
import ai.illyrobotic.screenbuddy.engine.BuddyView
import android.os.Handler
import android.os.Looper
import android.os.SystemClock

/**
 * Makes the floating buddy walk on the spot according to the chosen [MotionMode]: all the time, while you type, or
 * while the microphone hears sound. Use from the main thread. Taps and drags keep working in every mode.
 */
class MotionDriver(
    private val mode: MotionMode,
    private val view: () -> BuddyView?,
    private val onProblem: (String) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val typing = ActivityGate()
    private val sound = SoundGate()
    private var mic: MicLevel? = null
    private var seenTyping = TypingSignal.lastAt
    private var last = 0L
    private var running = false

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            step()
            handler.postDelayed(this, FRAME_MS)
        }
    }

    /** Starts driving. Returns false (after calling [onProblem]) if the source can't be used. */
    fun start(): Boolean {
        if (mode == MotionMode.Touch) return true
        if (mode == MotionMode.Sound) {
            val m = MicLevel(
                onFailed = { msg -> handler.post { onProblem("The microphone stopped working ($msg).") } },
                onLooksBlocked = {
                    handler.post { onProblem("The microphone isn't giving Screen Buddy any sound. Check the microphone privacy switch in Quick Settings and Privacy settings.") }
                },
            )
            try { m.start() } catch (e: Exception) {
                onProblem("Couldn't listen to the microphone: ${e.message}")
                return false
            }
            mic = m
        }
        last = SystemClock.uptimeMillis()
        running = true
        handler.post(tick)
        return true
    }

    private fun step() {
        val now = SystemClock.uptimeMillis()
        val dt = minOf(now - last, 100L) / 1000.0     // a stall must not make the buddy lurch
        last = now
        val active = when (mode) {
            MotionMode.Steady -> true
            MotionMode.Typing -> {
                val at = TypingSignal.lastAt
                if (at != seenTyping) { seenTyping = at; typing.ping(now) }
                typing.isActive(now)
            }
            MotionMode.Sound -> mic?.let { sound.update(it.takePeak(), now) } ?: false
            MotionMode.Touch -> false
        }
        if (!active) return
        val v = view() ?: return
        if (v.player.paused || v.player.posing) return
        val factor = if (mode == MotionMode.Steady) STEADY_FACTOR else 1.0
        v.player.scrub((NATURAL_PX_PER_SEC * factor * dt).toFloat())
        v.postInvalidateOnAnimation()
    }

    fun stop() {
        running = false
        handler.removeCallbacksAndMessages(null)
        mic?.stop()
        mic = null
    }

    private companion object {
        const val FRAME_MS = 16L
        // Scrubbing moves the walk cycle by 28 px per frame and the sample buddies run at 10 frames/s.
        const val NATURAL_PX_PER_SEC = BuddyAnimator.STEP_PX * 10.0
        const val STEADY_FACTOR = 0.6
    }
}
