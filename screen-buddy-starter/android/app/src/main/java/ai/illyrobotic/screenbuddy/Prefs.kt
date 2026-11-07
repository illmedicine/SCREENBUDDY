package ai.illyrobotic.screenbuddy

import android.content.Context
import android.content.SharedPreferences

/** The few settings every surface shares: which buddy is chosen, and where/how big the floating one is. */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.applicationContext.getSharedPreferences("screenbuddy", Context.MODE_PRIVATE)

    var buddyId: String?
        get() = sp.getString(KEY_BUDDY, null)
        set(v) = sp.edit().putString(KEY_BUDDY, v).apply()

    /** Floating buddy's height in dp. */
    var overlayHeightDp: Int
        get() = sp.getInt(KEY_SIZE, DEFAULT_HEIGHT_DP)
        set(v) = sp.edit().putInt(KEY_SIZE, v.coerceIn(MIN_HEIGHT_DP, MAX_HEIGHT_DP)).apply()

    /** Floating buddy's opacity, 20 to 100 percent, so it can be made see-through over text. */
    var overlayAlphaPercent: Int
        get() = sp.getInt(KEY_ALPHA, 100)
        set(v) = sp.edit().putInt(KEY_ALPHA, v.coerceIn(MIN_ALPHA_PERCENT, 100)).apply()

    /** Top-left of the floating window in px, or null to use the default corner. */
    var overlayPosition: Pair<Int, Int>?
        get() = if (sp.contains(KEY_X)) sp.getInt(KEY_X, 0) to sp.getInt(KEY_Y, 0) else null
        set(v) {
            val e = sp.edit()
            if (v == null) e.remove(KEY_X).remove(KEY_Y) else e.putInt(KEY_X, v.first).putInt(KEY_Y, v.second)
            e.apply()
        }

    fun register(l: SharedPreferences.OnSharedPreferenceChangeListener) = sp.registerOnSharedPreferenceChangeListener(l)
    fun unregister(l: SharedPreferences.OnSharedPreferenceChangeListener) = sp.unregisterOnSharedPreferenceChangeListener(l)

    companion object {
        const val KEY_BUDDY = "buddy"
        const val KEY_SIZE = "overlay_height_dp"
        const val KEY_ALPHA = "overlay_alpha"
        const val MIN_ALPHA_PERCENT = 20
        private const val KEY_X = "overlay_x"
        private const val KEY_Y = "overlay_y"
        const val DEFAULT_HEIGHT_DP = 180
        const val MIN_HEIGHT_DP = 100
        const val MAX_HEIGHT_DP = 320
    }
}
