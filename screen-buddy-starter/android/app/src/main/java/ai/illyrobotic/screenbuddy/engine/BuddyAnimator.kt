package ai.illyrobotic.screenbuddy.engine

import ai.illyrobotic.screenbuddy.buddy.BuddyManifest
import kotlin.math.abs
import kotlin.random.Random

/** A single frame to show: [frame] of the strip called [move]. */
data class FramePick(val move: String, val frame: Int)

/**
 * Decides which frame the buddy shows. This is the web player's behaviour (walker.js) with no Android
 * dependencies, so the same logic drives the overlay, the wallpaper and the screensaver, and is unit-tested.
 *
 *  - Idle: stands on one chosen frame.
 *  - Scrub: movement (a page swipe, a drag) steps through the scroll move, [STEP_PX] per frame, forwards then
 *    backwards so it never snaps; the buddy leans up to [MAX_LEAN] degrees; [SETTLE_MS] after the last
 *    movement it goes back to standing.
 *  - Pose: plays a random pose that isn't the one before. Short poses play forwards then backwards.
 *
 * All times are caller-supplied milliseconds on any monotonic clock.
 * [ready] says whether a move's frames are loaded; moves that aren't are never chosen.
 */
class BuddyAnimator(
    private val m: BuddyManifest,
    private val random: Random = Random.Default,
    private val ready: (String) -> Boolean = { true },
) {
    var lean = 0f
        private set

    private var travel = 0f
    private var lastMoveAt = 0L
    private var scrubbing = false
    private var pose: String? = null
    private var poseStart = 0L
    private var poseTotal = 0
    private var lastPose = ""
    private var current = FramePick(m.standClip, m.standFrame)

    val posing get() = pose != null

    /** True while something is moving and the host should keep redrawing. */
    val animating get() = posing || scrubbing

    fun frame(): FramePick = current

    /** Movement of [dy] pixels (any direction) at time [now]. The lean follows it even during a pose. */
    fun scrub(dy: Float, now: Long) {
        lean = (dy / LEAN_DIV).coerceIn(-MAX_LEAN, MAX_LEAN)
        lastMoveAt = now
        if (posing) return
        scrubbing = true
        if (!ready(m.scrollClip)) return
        travel += abs(dy)
        val n = m.clips.getValue(m.scrollClip).n
        current = if (n == 1) FramePick(m.scrollClip, 0) else {
            val cycle = 2 * n - 2
            val k = (travel / STEP_PX).toInt() % cycle
            FramePick(m.scrollClip, if (k < n) k else cycle - k)
        }
    }

    /** Starts a random ready pose, never the same as the last. False if one is playing or none is loaded. */
    fun tap(now: Long): Boolean {
        if (posing) return false
        val choices = m.poses.filter { ready(it) && it != lastPose }
            .ifEmpty { m.poses.filter { ready(it) } }
        if (choices.isEmpty()) return false
        startPose(choices[random.nextInt(choices.size)], now)
        return true
    }

    /** Plays a specific move as a pose (the screensaver showcase uses this). */
    fun play(move: String, now: Long): Boolean {
        if (posing || move !in m.clips || !ready(move)) return false
        startPose(move, now)
        return true
    }

    private fun startPose(move: String, now: Long) {
        val n = m.clips.getValue(move).n
        pose = move; lastPose = move; poseStart = now
        poseTotal = if (n < LOOP_BELOW) 2 * n - 1 else n
        scrubbing = false
        current = FramePick(move, 0)
    }

    /** Advances time-driven state. Call once per drawn frame. */
    fun update(now: Long) {
        val p = pose
        if (p != null) {
            val n = m.clips.getValue(p).n
            val k = ((now - poseStart) * m.fps / 1000L).toInt()
            if (k >= poseTotal) {
                pose = null
                stand()
            } else {
                current = FramePick(p, if (k < n) k else 2 * n - 2 - k)
            }
        } else if (scrubbing && now - lastMoveAt >= SETTLE_MS) {
            scrubbing = false
            stand()
        }
    }

    /** Drops whatever is playing and goes back to standing (used when the user pauses the buddy). */
    fun stop() {
        pose = null
        scrubbing = false
        stand()
    }

    private fun stand() {
        lean = 0f
        current = FramePick(m.standClip, m.standFrame)
    }

    companion object {
        const val STEP_PX = 28f
        const val MAX_LEAN = 5f
        const val LEAN_DIV = 8f
        const val SETTLE_MS = 450L
        const val LOOP_BELOW = 24
    }
}
