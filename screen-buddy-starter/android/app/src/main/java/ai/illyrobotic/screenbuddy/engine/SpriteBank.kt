package ai.illyrobotic.screenbuddy.engine

import ai.illyrobotic.screenbuddy.buddy.Buddy
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Holds a buddy's decoded frames. Each strip is decoded once and cut into one bitmap per frame: a whole
 * strip can be thousands of pixels wide, more than many GPUs accept as a single texture.
 *
 * Moves load on a background thread and only count as [ready] once every frame is in memory.
 * Draw and [close] from the main thread.
 */
class SpriteBank(val buddy: Buddy) {
    private val m = buddy.manifest
    private val frames = ConcurrentHashMap<String, Array<Bitmap>>()
    private val requested = ConcurrentHashMap.newKeySet<String>()   // loading, or failed (not retried)
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val pool = Executors.newSingleThreadExecutor { r -> Thread(r, "buddy-${m.id}").apply { isDaemon = true } }
    @Volatile private var closed = false

    fun ready(move: String) = frames.containsKey(move)

    fun frame(move: String, index: Int): Bitmap? = frames[move]?.getOrNull(index)

    /** Called on the loader thread whenever a move finishes loading. */
    fun addListener(l: () -> Unit) { listeners.add(l) }
    fun removeListener(l: () -> Unit) { listeners.remove(l) }

    /** Loads the standing move first, then the scroll move, then the poses. */
    fun loadAll() {
        load(m.standClip)
        load(m.scrollClip)
        m.poses.forEach { load(it) }
    }

    fun load(move: String) {
        if (closed || move !in m.clips || frames.containsKey(move) || !requested.add(move)) return
        try {
            pool.execute {
                val decoded = runCatching { decode(move) }.getOrNull()
                if (decoded != null && !closed) {
                    frames[move] = decoded
                    requested.remove(move)
                }
                listeners.forEach { it() }
            }
        } catch (_: RejectedExecutionException) {
            // closed while we were queuing
        }
    }

    /** Drops everything but the standing move, for when the system is short of memory. */
    fun trimToStand() {
        for (k in frames.keys.toList()) if (k != m.standClip) { frames.remove(k); requested.remove(k) }
    }

    fun close() {
        closed = true
        pool.shutdown()
        frames.clear()
        listeners.clear()
    }

    private fun decode(move: String): Array<Bitmap> {
        val clip = m.clips.getValue(move)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        buddy.source.open(clip.src).use { BitmapFactory.decodeStream(it, null, bounds) }
        check(bounds.outWidth >= clip.n * m.cw && bounds.outHeight >= m.ch) {
            "Strip ${clip.src} is ${bounds.outWidth}x${bounds.outHeight}, expected ${clip.n * m.cw}x${m.ch}"
        }
        check(bounds.outWidth.toLong() * bounds.outHeight <= MAX_STRIP_PIXELS) { "Strip ${clip.src} is too large" }
        val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888; inScaled = false }
        val strip = buddy.source.open(clip.src).use { BitmapFactory.decodeStream(it, null, opts) }
            ?: error("Could not decode ${clip.src}")
        try {
            return Array(clip.n) { i ->
                val cell = Bitmap.createBitmap(strip, i * m.cw, 0, m.cw, m.ch)
                // A one-cell strip comes back as the strip itself, which we're about to free.
                if (cell === strip) strip.copy(Bitmap.Config.ARGB_8888, false) else cell
            }
        } finally {
            strip.recycle()
        }
    }

    private companion object {
        const val MAX_STRIP_PIXELS = 40_000_000L
    }
}

/** Shares one [SpriteBank] per buddy between the app preview, the overlay, the wallpaper and the screensaver. */
object SpriteBanks {
    private class Entry(val bank: SpriteBank) { var refs = 0 }

    private val entries = HashMap<ai.illyrobotic.screenbuddy.buddy.BuddyManifest, Entry>()

    @Synchronized
    fun acquire(buddy: Buddy): SpriteBank {
        val e = entries.getOrPut(buddy.manifest) { Entry(SpriteBank(buddy)) }
        e.refs++
        return e.bank
    }

    @Synchronized
    fun release(bank: SpriteBank) {
        val e = entries[bank.buddy.manifest] ?: return
        if (e.bank !== bank) return
        if (--e.refs <= 0) {
            entries.remove(bank.buddy.manifest)
            bank.close()
        }
    }

    @Synchronized
    fun trim() = entries.values.forEach { it.bank.trimToStand() }
}
