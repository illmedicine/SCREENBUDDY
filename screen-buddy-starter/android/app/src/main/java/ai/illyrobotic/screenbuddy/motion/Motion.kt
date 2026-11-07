package ai.illyrobotic.screenbuddy.motion

/**
 * What makes the buddy move on its own (tapping and dragging always work, whatever the mode).
 * Same four modes and gate logic as the Windows app (ScreenBuddy.Core/Motion.cs) and the web player (js/motion.js).
 */
enum class MotionMode(val key: String) {
    /** Only when you tap or drag it. */
    Touch("touch"),
    /** Walks gently in place, all the time. */
    Steady("steady"),
    /** Moves while you type (in any app), stops when you stop. */
    Typing("typing"),
    /** Moves while the microphone hears sound, stops in silence. */
    Sound("sound");

    companion object {
        fun fromKey(key: String?): MotionMode = entries.firstOrNull { it.key == key } ?: Touch
    }
}

/**
 * Turns "something just happened" pings (a character typed) into a steady on/off signal: active from a ping until
 * [holdMs] after the last one, so typing with small pauses reads as one continuous movement.
 */
class ActivityGate(private val holdMs: Long = 700) {
    private var last: Long? = null
    fun ping(nowMs: Long) { last = nowMs }
    fun isActive(nowMs: Long): Boolean = last?.let { nowMs - it < holdMs } ?: false
    fun reset() { last = null }
}

/**
 * Decides from a stream of microphone loudness readings (0 to 1) whether there is sound. The first moments only
 * measure the room, the threshold then follows the room's background level (so a fan isn't "sound"), a pop shorter
 * than [attackMs] is ignored, and once going it keeps moving through gaps between words until [releaseMs] after the
 * sound ends.
 */
class SoundGate(
    private val minThreshold: Double = 0.02,
    private val ratio: Double = 3.0,
    private val attackMs: Long = 80,
    private val releaseMs: Long = 700,
    private val calibrationMs: Long = 600,
) {
    var noiseFloor = 0.0
        private set
    var active = false
        private set
    private var aboveSince: Long? = null
    private var startedAt: Long? = null
    private var lastLoud = 0L

    /** Feeds one reading taken at [nowMs] and returns whether sound is currently detected. */
    fun update(rawLevel: Double, nowMs: Long): Boolean {
        val level = if (rawLevel.isFinite()) rawLevel.coerceIn(0.0, 1.0) else 0.0
        val start = startedAt ?: nowMs.also { startedAt = it }
        if (nowMs - start < calibrationMs) {
            noiseFloor += (level - noiseFloor) * 0.1       // the first moments only measure the room
            return false
        }
        val threshold = maxOf(minThreshold, noiseFloor * ratio)
        if (level > threshold) {
            val since = aboveSince ?: nowMs.also { aboveSince = it }
            lastLoud = nowMs
            if (!active && nowMs - since >= attackMs) active = true
        } else {
            aboveSince = null
            if (active && nowMs - lastLoud >= releaseMs) active = false
            // Learn the background only from quiet readings: drop to a lower level at once, rise towards a higher one slowly.
            if (!active) noiseFloor = if (level < noiseFloor) level else noiseFloor + (level - noiseFloor) * 0.02
        }
        return active
    }

    fun reset() {
        noiseFloor = 0.0
        aboveSince = null
        startedAt = null
        active = false
    }
}
