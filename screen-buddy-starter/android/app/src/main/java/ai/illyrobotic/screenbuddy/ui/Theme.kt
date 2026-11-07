package ai.illyrobotic.screenbuddy.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Scheme = darkColorScheme(
    primary = Color(0xFFB07CFF),
    onPrimary = Color(0xFF1B0B33),
    secondary = Color(0xFFFFD7B5),
    onSecondary = Color(0xFF3A2410),
    background = Color(0xFF14101C),
    onBackground = Color(0xFFEDE6F7),
    surface = Color(0xFF1E1830),
    onSurface = Color(0xFFEDE6F7),
    surfaceVariant = Color(0xFF2A2140),
    onSurfaceVariant = Color(0xFFC9BEDB),
    outline = Color(0xFF5B4D78),
)

/** Screen Buddy is always dark: the buddies are cut-outs meant to sit on a dark backdrop. */
@Composable
fun ScreenBuddyTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}
