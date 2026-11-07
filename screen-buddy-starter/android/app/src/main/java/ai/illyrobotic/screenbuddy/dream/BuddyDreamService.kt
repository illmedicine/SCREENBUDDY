package ai.illyrobotic.screenbuddy.dream

import ai.illyrobotic.screenbuddy.Prefs
import ai.illyrobotic.screenbuddy.buddy.BuddyStore
import ai.illyrobotic.screenbuddy.engine.BuddyView
import android.animation.ValueAnimator
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.service.dreams.DreamService
import android.view.Gravity
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout

/**
 * The screensaver (Settings > Display > Screen saver), shown while charging or docked: a slow showcase that
 * plays every pose in turn. The buddy drifts side to side so no pixel stays lit for long.
 */
class BuddyDreamService : DreamService() {
    private val handler = Handler(Looper.getMainLooper())
    private var buddyView: BuddyView? = null
    private var drift: ValueAnimator? = null
    private var next = 0

    private val showcase = object : Runnable {
        override fun run() {
            val v = buddyView ?: return
            val poses = v.player.manifest.poses
            if (poses.isNotEmpty() && !v.player.animating) {
                if (v.player.play(poses[next % poses.size])) { next++; v.postInvalidateOnAnimation() }
            }
            handler.postDelayed(this, TICK_MS)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false       // any touch wakes the phone
        isFullscreen = true
        val buddy = BuddyStore(this).find(Prefs(this).buddyId) ?: run { finish(); return }
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val height = (resources.displayMetrics.heightPixels * 0.6f).toInt()
        val v = BuddyView(this, buddy)
        val width = ai.illyrobotic.screenbuddy.engine.BuddyLayout.windowWidth(height, buddy.manifest)
        root.addView(v, FrameLayout.LayoutParams(width, height, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = (resources.displayMetrics.heightPixels * 0.12f).toInt()
        })
        setContentView(root)
        buddyView = v
        val travel = (resources.displayMetrics.widthPixels - width) / 2f * 0.8f
        drift = ValueAnimator.ofFloat(-travel, travel).apply {
            duration = DRIFT_MS
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            addUpdateListener { v.translationX = it.animatedValue as Float }
            start()
        }
        handler.postDelayed(showcase, FIRST_POSE_MS)
    }

    override fun onDetachedFromWindow() {
        handler.removeCallbacksAndMessages(null)
        drift?.cancel(); drift = null
        buddyView?.release(); buddyView = null
        super.onDetachedFromWindow()
    }

    private companion object {
        const val TICK_MS = 2500L
        const val FIRST_POSE_MS = 1500L
        const val DRIFT_MS = 90_000L
    }
}
