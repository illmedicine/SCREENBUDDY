package ai.illyrobotic.screenbuddy

import ai.illyrobotic.screenbuddy.buddy.CloudSync
import ai.illyrobotic.screenbuddy.engine.SpriteBanks
import android.app.Application
import android.content.ComponentCallbacks2

class ScreenBuddyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CloudSync.start(this)       // shared buddies added on the website since this release
    }

    @Deprecated("Deprecated in Java")
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        // Keep only the standing frames when the system is running low; poses reload on the next tap.
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) SpriteBanks.trim()
    }
}
