package ai.illyrobotic.screenbuddy.overlay

import ai.illyrobotic.screenbuddy.Prefs
import ai.illyrobotic.screenbuddy.R
import ai.illyrobotic.screenbuddy.buddy.BuddyStore
import ai.illyrobotic.screenbuddy.engine.BuddyLayout
import ai.illyrobotic.screenbuddy.engine.BuddyView
import ai.illyrobotic.screenbuddy.motion.MotionDriver
import ai.illyrobotic.screenbuddy.motion.MotionMode
import ai.illyrobotic.screenbuddy.ui.MainActivity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.Manifest
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Toast
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.roundToInt

/**
 * Keeps the buddy floating over other apps. A foreground service owns one small overlay window that is
 * exactly the buddy's size (never full screen, so touches elsewhere reach the app underneath).
 *
 * Tap the buddy for a pose, drag it to move it, long-press for Hide / Switch buddy / Settings.
 */
class OverlayService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var wm: WindowManager
    private lateinit var prefs: Prefs
    private lateinit var store: BuddyStore
    private var view: BuddyView? = null
    private var params: WindowManager.LayoutParams? = null
    private var menu: View? = null
    private var paused = false
    private var motion: MotionDriver? = null
    private var notification: Notification? = null
    private var micType = false

    private val prefsListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        when (key) {
            Prefs.KEY_BUDDY, Prefs.KEY_SIZE -> handler.post { rebuild() }
            Prefs.KEY_ALPHA -> handler.post { view?.alpha = prefs.overlayAlphaPercent / 100f }
            Prefs.KEY_MOTION -> handler.post { applyMotion() }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        prefs = Prefs(this)
        store = BuddyStore(this)
        // Must happen right away, or a startForegroundService() call crashes the app.
        enterForeground()
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return }
        _running.value = true
        prefs.register(prefsListener)
        show()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HIDE) stopSelf()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        _running.value = false
        prefs.unregister(prefsListener)
        handler.removeCallbacksAndMessages(null)
        dismissMenu()
        removeView()
        super.onDestroy()
    }

    // ---- the buddy window ----------------------------------------------------------------------

    private fun show() {
        val buddy = store.find(prefs.buddyId) ?: run { stopSelf(); return }
        val density = resources.displayMetrics.density
        val h = (prefs.overlayHeightDp * density).roundToInt()
        val w = BuddyLayout.windowWidth(h, buddy.manifest)
        val screen = resources.displayMetrics
        val saved = prefs.overlayPosition
        val lp = WindowManager.LayoutParams(
            w, h,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            title = "Screen Buddy"
            x = (saved?.first ?: (screen.widthPixels - w - (12 * density).roundToInt())).coerceIn(0, (screen.widthPixels - w).coerceAtLeast(0))
            y = (saved?.second ?: (screen.heightPixels - h - (96 * density).roundToInt())).coerceIn(0, (screen.heightPixels - h).coerceAtLeast(0))
        }
        val v = BuddyView(this, buddy)
        v.alpha = prefs.overlayAlphaPercent / 100f
        v.player.paused = paused
        v.host = object : BuddyView.Host {
            override fun onDrag(dx: Int, dy: Int) {
                dismissMenu()
                lp.x = (lp.x + dx).coerceIn(0, (screen.widthPixels - lp.width).coerceAtLeast(0))
                lp.y = (lp.y + dy).coerceIn(0, (screen.heightPixels - lp.height).coerceAtLeast(0))
                runCatching { wm.updateViewLayout(v, lp) }
            }
            override fun onDragEnd() { prefs.overlayPosition = lp.x to lp.y }
            override fun onLongPress() = showMenu()
        }
        runCatching { wm.addView(v, lp) }.onFailure { stopSelf(); return }
        view = v; params = lp
        applyMotion()
    }

    private fun removeView() {
        stopMotion()
        view?.let { v ->
            runCatching { wm.removeViewImmediate(v) }
            v.release()
        }
        view = null; params = null
    }

    private fun rebuild() {
        if (!_running.value) return
        dismissMenu()
        removeView()
        show()
    }

    // ---- long-press menu -----------------------------------------------------------------------

    private fun showMenu() {
        val anchor = params ?: return
        dismissMenu()
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).roundToInt()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply { cornerRadius = 14 * d; setColor(0xF02A1F3D.toInt()) }
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        fun item(label: String, action: () -> Unit) = TextView(this).apply {
            text = label
            setTextColor(Color.WHITE)
            textSize = 16f
            gravity = Gravity.CENTER_VERTICAL
            minHeight = dp(48)
            setPadding(dp(18), 0, dp(18), 0)
            setOnClickListener { dismissMenu(); action() }
        }.also { box.addView(it, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
        item(getString(if (paused) R.string.action_resume else R.string.action_pause)) {
            paused = !paused
            view?.let { it.player.paused = paused; it.postInvalidateOnAnimation() }
            applyMotion()      // a paused buddy also stops listening
        }
        item(getString(R.string.action_hide)) { stopSelf() }
        item(getString(R.string.action_switch)) { switchBuddy() }
        item(getString(R.string.action_settings)) {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        box.setOnTouchListener { _, e -> if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) { dismissMenu(); true } else false }

        box.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
        val screen = resources.displayMetrics
        val mw = box.measuredWidth
        val mh = box.measuredHeight
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (anchor.x + anchor.width / 2 - mw / 2).coerceIn(dp(8), (screen.widthPixels - mw - dp(8)).coerceAtLeast(dp(8)))
            val above = anchor.y - mh - dp(8)
            y = if (above >= dp(8)) above else (anchor.y + anchor.height + dp(8)).coerceAtMost((screen.heightPixels - mh).coerceAtLeast(0))
        }
        if (runCatching { wm.addView(box, lp) }.isSuccess) {
            menu = box
            handler.postDelayed({ dismissMenu() }, MENU_TIMEOUT_MS)
        }
    }

    private fun dismissMenu() {
        menu?.let { runCatching { wm.removeViewImmediate(it) } }
        menu = null
    }

    private fun switchBuddy() {
        val all = store.list()
        if (all.size < 2) return
        val i = all.indexOfFirst { it.id == (view?.player?.manifest?.id ?: prefs.buddyId) }
        prefs.buddyId = all[(i + 1).mod(all.size)].id      // the prefs listener rebuilds the window
    }

    // ---- notification --------------------------------------------------------------------------

    private fun enterForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.overlay_channel), NotificationManager.IMPORTANCE_LOW)
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val hide = PendingIntent.getService(
            this, 1, Intent(this, OverlayService::class.java).setAction(ACTION_HIDE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(getString(R.string.overlay_notification))
            .setContentText(getString(R.string.overlay_notification_text))
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, getString(R.string.action_hide), hide).build())
            .setOngoing(true)
            .build()
        notification = n
        promote(micType)
    }

    /** (Re)declares what the foreground service is doing. The microphone type is only claimed while listening. */
    private fun promote(withMic: Boolean) {
        val n = notification ?: return
        if (Build.VERSION.SDK_INT >= 34) {
            val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or
                if (withMic) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
            startForeground(NOTIFICATION_ID, n, type)
        } else if (Build.VERSION.SDK_INT >= 30 && withMic) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, n)
        }
        micType = withMic
    }

    // ---- movement modes (steady / typing / sound) -----------------------------------------------

    private fun stopMotion() {
        motion?.stop()
        motion = null
        if (micType) runCatching { promote(false) }
    }

    /** Starts whatever drives the buddy for the chosen mode. While paused (or with no buddy) nothing runs and the mic is released. */
    private fun applyMotion() {
        stopMotion()
        val mode = prefs.motion
        if (view == null || paused || mode == MotionMode.Touch) return
        if (mode == MotionMode.Sound) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                return motionProblem("Allow the microphone in Screen Buddy's settings to use sound movement.")
            }
            // Android only lets a foreground service use the microphone if it says so; it can refuse when we aren't in view.
            if (runCatching { promote(true) }.isFailure) {
                return motionProblem("Android wouldn't let Screen Buddy listen right now. Open the app and try again.")
            }
        }
        val driver = MotionDriver(mode, { view }) { motionProblem(it) }
        motion = driver
        if (!driver.start()) { motion = null; if (micType) runCatching { promote(false) } }
    }

    private fun motionProblem(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        motion?.stop()
        motion = null
        if (micType) runCatching { promote(false) }
        prefs.motion = MotionMode.Touch
    }

    companion object {
        private const val CHANNEL = "overlay"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_HIDE = "ai.illyrobotic.screenbuddy.HIDE"
        private const val MENU_TIMEOUT_MS = 8000L

        private val _running = MutableStateFlow(false)
        /** True while the floating buddy is on screen. */
        val running: StateFlow<Boolean> = _running

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, OverlayService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, OverlayService::class.java))
        }
    }
}
