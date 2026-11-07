package ai.illyrobotic.screenbuddy.motion

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager

/** When something was last typed, anywhere on the phone. Only a time: never what was typed. */
object TypingSignal {
    @Volatile var lastAt: Long = 0L
        private set

    fun ping() { lastAt = SystemClock.uptimeMillis() }
}

/**
 * Lets the buddy notice that you are typing in any app. Android has no other way to see this, so it is an accessibility
 * service that the user must switch on themselves. It asks for only one event type (a text field changed), cannot
 * read window contents, and never looks at the event's text: it records the moment the event happened and nothing else.
 */
class TypingService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) TypingSignal.ping()
    }

    override fun onInterrupt() = Unit

    companion object {
        /** True when the user has switched the typing service on in the system's Accessibility settings. */
        fun isEnabled(context: Context): Boolean {
            val am = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
            val me = ComponentName(context, TypingService::class.java)
            return am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any {
                it.resolveInfo.serviceInfo.let { s -> ComponentName(s.packageName, s.name) } == me
            }
        }
    }
}
