package ai.illyrobotic.screenbuddy.motion

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import kotlin.math.abs

/**
 * Listens to the microphone and keeps only a loudness number. Each buffer is looked at once, to find its peak, and
 * dropped: nothing is recorded, saved or sent. The caller must hold the RECORD_AUDIO permission.
 */
class MicLevel(
    /** Called from the reader thread if the microphone stops working. */
    private val onFailed: (String) -> Unit,
    /** Called once, from the reader thread, after several seconds of pure digital silence (usually the system's microphone privacy switch). */
    private val onLooksBlocked: () -> Unit,
) {
    private val lock = Any()
    private var peak = 0.0
    private var record: AudioRecord? = null
    private var thread: Thread? = null
    @Volatile private var running = false

    /** Starts listening. Throws [IllegalStateException] if the microphone can't be opened. */
    @SuppressLint("MissingPermission")     // checked by the caller before starting
    fun start() {
        if (running) return
        val minBuf = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minBuf > 0) { "This device has no usable microphone." }
        val rec = AudioRecord(
            MediaRecorder.AudioSource.MIC, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minBuf * 2,
        )
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); error("The microphone is busy or unavailable.") }
        rec.startRecording()
        record = rec
        running = true
        thread = Thread({ read(rec, minBuf) }, "buddy-mic").also { it.isDaemon = true; it.start() }
    }

    private fun read(rec: AudioRecord, bufSize: Int) {
        val buf = ShortArray(bufSize / 2)
        var zeroSince = -1L
        var warned = false
        while (running) {
            val n = rec.read(buf, 0, buf.size)
            if (n < 0) { if (running) onFailed("error $n"); break }
            var p = 0.0
            for (i in 0 until n) p = maxOf(p, abs(buf[i] / 32768.0))
            synchronized(lock) { peak = maxOf(peak, p) }
            val now = SystemClock.uptimeMillis()
            if (p > 0) zeroSince = -1
            else if (zeroSince < 0) zeroSince = now
            else if (!warned && now - zeroSince > BLOCKED_AFTER_MS) { warned = true; onLooksBlocked() }
        }
    }

    /** The loudest reading (0 to 1) since the last call. */
    fun takePeak(): Double = synchronized(lock) { val p = peak; peak = 0.0; p }

    fun stop() {
        running = false
        val rec = record
        record = null
        runCatching { rec?.stop() }
        thread?.let { runCatching { it.join(300) } }
        thread = null
        rec?.release()
    }

    private companion object {
        const val RATE = 16_000
        const val BLOCKED_AFTER_MS = 6_000L
    }
}
