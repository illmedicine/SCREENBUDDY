package ai.illyrobotic.screenbuddy

import ai.illyrobotic.screenbuddy.engine.SpriteBanks
import android.app.Application
import android.content.ComponentCallbacks2

class ScreenBuddyApp : Application() {
    @Deprecated("Deprecated in Java")
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        // Keep only the standing frames when the system is running low; poses reload on the next tap.
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) SpriteBanks.trim()
    }
}
