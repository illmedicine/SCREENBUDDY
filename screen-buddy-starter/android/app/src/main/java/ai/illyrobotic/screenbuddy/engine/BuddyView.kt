package ai.illyrobotic.screenbuddy.engine

import ai.illyrobotic.screenbuddy.buddy.Buddy
import android.content.Context
import android.graphics.Canvas
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.hypot
import kotlin.math.sign

/**
 * Draws one buddy and handles its touches: tap for a pose, drag to scrub the walk (and, when a [host] is
 * set, to move the window it lives in), long-press for the host's menu.
 */
class BuddyView(context: Context, buddy: Buddy) : View(context) {
    interface Host {
        fun onDrag(dx: Int, dy: Int)
        fun onDragEnd()
        fun onLongPress()
    }

    var host: Host? = null
    val player = BuddyPlayer(buddy) { postInvalidateOnAnimation() }

    private val dst = RectF()
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var lastX = 0f
    private var lastY = 0f
    private var downX = 0f
    private var downY = 0f
    private var dragging = false
    private var longPressed = false
    private val longPress = Runnable {
        if (!dragging) { longPressed = true; host?.onLongPress() }
    }

    init {
        contentDescription = "${buddy.manifest.name}. Tap for a pose"
    }

    override fun onDraw(canvas: Canvas) {
        player.step()
        BuddyLayout.fit(width.toFloat(), height.toFloat(), player.manifest, dst)
        player.draw(canvas, dst)
        if (player.animating) postInvalidateOnAnimation()
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.rawX; downY = e.rawY; lastX = downX; lastY = downY
                dragging = false; longPressed = false
                if (host != null) postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
            }
            MotionEvent.ACTION_MOVE -> {
                if (!dragging && hypot(e.rawX - downX, e.rawY - downY) > slop) {
                    dragging = true
                    removeCallbacks(longPress)
                }
                if (dragging) {
                    val dx = e.rawX - lastX
                    val dy = e.rawY - lastY
                    lastX = e.rawX; lastY = e.rawY
                    host?.onDrag(dx.toInt(), dy.toInt())
                    val dist = hypot(dx, dy)
                    player.scrub(if (dx != 0f) sign(dx) * dist else sign(dy) * dist)
                    postInvalidateOnAnimation()
                }
            }
            MotionEvent.ACTION_UP -> {
                removeCallbacks(longPress)
                if (dragging) host?.onDragEnd()
                else if (!longPressed) { player.tap(); postInvalidateOnAnimation(); performClick() }
            }
            MotionEvent.ACTION_CANCEL -> {
                removeCallbacks(longPress)
                if (dragging) host?.onDragEnd()
            }
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    /** Frees the buddy's frames when nothing else is using them. Call once, from the main thread. */
    fun release() {
        removeCallbacks(longPress)
        host = null
        player.close()
    }
}
