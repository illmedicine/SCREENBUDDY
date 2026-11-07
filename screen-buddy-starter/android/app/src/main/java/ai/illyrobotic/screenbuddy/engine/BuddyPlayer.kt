package ai.illyrobotic.screenbuddy.engine

import ai.illyrobotic.screenbuddy.buddy.Buddy
import ai.illyrobotic.screenbuddy.buddy.BuddyManifest
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import kotlin.math.ceil
import kotlin.math.min

/** Where to draw a buddy inside a surface. */
object BuddyLayout {
    /** sin(5°): how far the head swings sideways at full lean, as a fraction of the drawn height. */
    private const val LEAN = 0.0872f

    /** Width of a window that fits a buddy [heightPx] tall, with room for the lean on both sides. */
    fun windowWidth(heightPx: Int, m: BuddyManifest): Int =
        ceil(heightPx * (m.cw.toFloat() / m.ch + 2 * LEAN)).toInt()

    /** Fits the buddy into a [w] x [h] area, standing on the bottom edge, centred. */
    fun fit(w: Float, h: Float, m: BuddyManifest, out: RectF) {
        val scale = min(w / (m.cw + 2 * LEAN * m.ch), h / m.ch)
        val dw = m.cw * scale
        out.set((w - dw) / 2f, h - m.ch * scale, (w + dw) / 2f, h)
    }
}

/**
 * One buddy being played: its frames ([SpriteBank]), its behaviour ([BuddyAnimator]) and drawing.
 * The overlay, wallpaper and screensaver each own one and call [step] then [draw] on every frame.
 * Use from the main thread. [onChange] may be called from any thread when new frames are loaded.
 */
class BuddyPlayer(buddy: Buddy, private val onChange: () -> Unit) {
    val manifest: BuddyManifest = buddy.manifest
    private val bank = SpriteBanks.acquire(buddy)
    private val animator = BuddyAnimator(manifest, ready = bank::ready)
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val loaded = { onChange() }
    private var closed = false

    init {
        bank.addListener(loaded)
        bank.loadAll()
    }

    val animating get() = animator.animating
    val posing get() = animator.posing

    private fun now() = SystemClock.uptimeMillis()

    /** While paused the buddy holds its standing frame and ignores taps and movement. */
    var paused = false
        set(v) {
            field = v
            if (v) animator.stop()
        }

    fun tap(): Boolean {
        if (paused) return false
        bank.loadAll()           // after a low-memory trim, bring the poses back
        return animator.tap(now())
    }

    fun play(move: String): Boolean = !paused && animator.play(move, now())

    /** [dy] pixels of movement, signed (the sign leans her). */
    fun scrub(dy: Float) { if (!paused) animator.scrub(dy, now()) }

    /** Advances the animation clock. Call once per drawn frame, before [draw]. */
    fun step() { if (!closed) animator.update(now()) }

    /** Draws the current frame into [dst], leaning about the bottom centre. Draws nothing until the standing move has loaded. */
    fun draw(canvas: Canvas, dst: RectF) {
        if (closed) return
        val pick = animator.frame()
        val bmp = bank.frame(pick.move, pick.frame)
            ?: bank.frame(manifest.standClip, manifest.standFrame)
            ?: return
        canvas.save()
        canvas.rotate(animator.lean, dst.centerX(), dst.bottom)
        canvas.drawBitmap(bmp, null, dst, paint)
        canvas.restore()
    }

    fun close() {
        if (closed) return
        closed = true
        bank.removeListener(loaded)
        SpriteBanks.release(bank)
    }
}
