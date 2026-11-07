package ai.illyrobotic.screenbuddy.wallpaper

import ai.illyrobotic.screenbuddy.Prefs
import ai.illyrobotic.screenbuddy.buddy.BuddyStore
import ai.illyrobotic.screenbuddy.engine.BuddyLayout
import ai.illyrobotic.screenbuddy.engine.BuddyPlayer
import android.app.WallpaperManager
import android.content.SharedPreferences
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.view.Choreographer
import android.view.SurfaceHolder

/**
 * The buddy as a live wallpaper, so it shows on the home screen (and on the lock screen where the phone
 * allows a live wallpaper there).
 *
 * Swiping between home pages arrives as [Engine.onOffsetsChanged] and makes the buddy dance, like page scroll
 * on the web. Taps arrive as [WallpaperManager.COMMAND_TAP] and make it strike a pose.
 */
class BuddyWallpaperService : WallpaperService() {
    override fun onCreateEngine(): Engine = BuddyEngine()

    private inner class BuddyEngine : Engine() {
        private val handler = Handler(Looper.getMainLooper())
        private val store = BuddyStore(this@BuddyWallpaperService)
        private val prefs = Prefs(this@BuddyWallpaperService)
        private val bg = Paint()
        private val dst = RectF()
        private var player: BuddyPlayer? = null
        private var width = 0
        private var height = 0
        private var visible = false
        private var queued = false
        private var lastXOffset = -1f

        private val frame = Choreographer.FrameCallback { queued = false; draw() }
        private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == Prefs.KEY_BUDDY) handler.post { loadBuddy(); requestDraw() }
        }

        override fun onCreate(holder: SurfaceHolder) {
            super.onCreate(holder)
            setTouchEventsEnabled(false)       // launchers send taps as commands, not touch events
            prefs.register(prefsListener)
            loadBuddy()
        }

        override fun onDestroy() {
            prefs.unregister(prefsListener)
            Choreographer.getInstance().removeFrameCallback(frame)
            handler.removeCallbacksAndMessages(null)
            player?.close(); player = null
            super.onDestroy()
        }

        private fun loadBuddy() {
            player?.close()
            player = store.find(prefs.buddyId)?.let { BuddyPlayer(it) { handler.post { requestDraw() } } }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) {
            super.onSurfaceChanged(holder, format, w, h)
            width = w; height = h
            bg.shader = LinearGradient(0f, 0f, 0f, h.toFloat(), 0xFF241A38.toInt(), 0xFF0C0813.toInt(), Shader.TileMode.CLAMP)
            requestDraw()
        }

        override fun onVisibilityChanged(visible: Boolean) {
            this.visible = visible
            if (visible) requestDraw() else Choreographer.getInstance().removeFrameCallback(frame).also { queued = false }
        }

        override fun onOffsetsChanged(
            xOffset: Float, yOffset: Float, xOffsetStep: Float, yOffsetStep: Float, xPixelOffset: Int, yPixelOffset: Int,
        ) {
            // One home page is xOffsetStep of the 0..1 range, and one swipe moves the screen by its width.
            if (lastXOffset >= 0f && width > 0) {
                val pages = if (xOffsetStep > 0f) 1f / xOffsetStep else 1f
                player?.scrub((xOffset - lastXOffset) * pages * width)
                requestDraw()
            }
            lastXOffset = xOffset
        }

        override fun onCommand(action: String?, x: Int, y: Int, z: Int, extras: Bundle?, resultRequested: Boolean): Bundle? {
            if (action == WallpaperManager.COMMAND_TAP) {
                layout()
                val pad = resources.displayMetrics.density * 24f
                if (dst.width() > 0f && RectF(dst).apply { inset(-pad, -pad) }.contains(x.toFloat(), y.toFloat())) {
                    if (player?.tap() == true) requestDraw()
                }
            }
            return super.onCommand(action, x, y, z, extras, resultRequested)
        }

        /** Bottom-right, like she stands on the web, about a third of the screen tall. */
        private fun layout() {
            val p = player ?: return
            val h = height * 0.34f
            val w = BuddyLayout.windowWidth(h.toInt(), p.manifest).toFloat()
            val margin = resources.displayMetrics.density * 8f
            val area = RectF(width - w - margin, height - h - height * 0.1f, width - margin, height - height * 0.1f)
            val inner = RectF()
            BuddyLayout.fit(area.width(), area.height(), p.manifest, inner)
            dst.set(inner.left + area.left, inner.top + area.top, inner.right + area.left, inner.bottom + area.top)
        }

        private fun requestDraw() {
            if (!visible || queued || width == 0) return
            queued = true
            Choreographer.getInstance().postFrameCallback(frame)
        }

        private fun draw() {
            val holder = surfaceHolder
            val p = player
            p?.step()
            val canvas: Canvas = runCatching { holder.lockHardwareCanvas() }.getOrNull() ?: holder.lockCanvas() ?: return
            try {
                canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bg)
                if (p != null) { layout(); p.draw(canvas, dst) }
            } finally {
                holder.unlockCanvasAndPost(canvas)
            }
            if (p?.animating == true) requestDraw()
        }
    }
}
