package ai.illyrobotic.screenbuddy.ui

import ai.illyrobotic.screenbuddy.Prefs
import ai.illyrobotic.screenbuddy.buddy.Buddy
import ai.illyrobotic.screenbuddy.buddy.BuddyStore
import ai.illyrobotic.screenbuddy.dream.BuddyDreamService
import ai.illyrobotic.screenbuddy.engine.BuddyView
import ai.illyrobotic.screenbuddy.overlay.OverlayService
import ai.illyrobotic.screenbuddy.wallpaper.BuddyWallpaperService
import android.Manifest
import android.app.WallpaperManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { ScreenBuddyTheme { MainScreen() } }
    }
}

@Composable
private fun MainScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember { BuddyStore(context) }
    val prefs = remember { Prefs(context) }
    val snackbar = remember { SnackbarHostState() }

    var buddies by remember { mutableStateOf(store.list()) }
    var selectedId by remember { mutableStateOf(prefs.buddyId) }
    val selected = buddies.firstOrNull { it.id == selectedId } ?: buddies.firstOrNull()
    val overlayOn by OverlayService.running.collectAsStateWithLifecycle()
    var wantOverlay by remember { mutableStateOf(false) }
    var sizeDp by remember { mutableFloatStateOf(prefs.overlayHeightDp.toFloat()) }
    var alphaPercent by remember { mutableFloatStateOf(prefs.overlayAlphaPercent.toFloat()) }

    // Back from the system "display over other apps" page: finish what the switch started.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && wantOverlay) {
                wantOverlay = false
                if (Settings.canDrawOverlays(context)) OverlayService.start(context)
            }
        }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }

    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        // The floating buddy works either way; without the permission its "on screen" notification is just hidden.
        OverlayService.start(context)
    }
    fun startOverlay() {
        if (!Settings.canDrawOverlays(context)) {
            wantOverlay = true
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:${context.packageName}".toUri())
            )
        } else if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            OverlayService.start(context)
        }
    }

    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val result = withContext(Dispatchers.IO) {
                context.contentResolver.openInputStream(uri)?.use { store.importZip(it) }
                    ?: Result.failure(IllegalStateException("Could not open that file"))
            }
            result.onSuccess {
                buddies = store.list()
                selectedId = it.id; prefs.buddyId = it.id
                snackbar.showSnackbar("Added ${it.manifest.name}")
            }.onFailure { snackbar.showSnackbar("Couldn't add that buddy: ${it.message}") }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { inner ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(inner),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Text("Screen Buddy", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(
                    "Your character, on your phone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        if (selected != null) {
                            key(selected.manifest) {
                                AndroidView(
                                    factory = { BuddyView(it, selected) },
                                    onRelease = { it.release() },
                                    modifier = Modifier.fillMaxWidth().height(300.dp),
                                )
                            }
                            Text(selected.manifest.name, style = MaterialTheme.typography.titleMedium)
                            Text(
                                "Tap for a pose. Drag to make it walk.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else {
                            Text("No buddies yet. Import one to get started.")
                        }
                    }
                }
            }

            item { SectionTitle("Your buddies") }
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(buddies, key = { it.id }) { b ->
                        BuddyChip(b, selected = b.id == selected?.id) { selectedId = b.id; prefs.buddyId = b.id }
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        importer.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream"))
                    }) { Text("Import buddy (.zip)") }
                    if (selected != null && !selected.bundled) {
                        TextButton(onClick = {
                            store.delete(selected)
                            buddies = store.list()
                            selectedId = buddies.firstOrNull()?.id; prefs.buddyId = selectedId
                        }) { Text("Remove") }
                    }
                }
            }

            item { SectionTitle("Put it on your screen") }
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Float over apps", style = MaterialTheme.typography.titleSmall)
                                Text(
                                    "Drag it anywhere. Long-press for hide, switch and settings.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(
                                checked = overlayOn,
                                onCheckedChange = { on -> if (on) startOverlay() else OverlayService.stop(context) },
                            )
                        }
                        Text("Size", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Slider(
                            value = sizeDp,
                            onValueChange = { sizeDp = it },
                            onValueChangeFinished = { prefs.overlayHeightDp = sizeDp.toInt() },
                            valueRange = Prefs.MIN_HEIGHT_DP.toFloat()..Prefs.MAX_HEIGHT_DP.toFloat(),
                        )
                        Text("Transparency", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Slider(
                            value = alphaPercent,
                            onValueChange = { alphaPercent = it; prefs.overlayAlphaPercent = it.toInt() },
                            valueRange = Prefs.MIN_ALPHA_PERCENT.toFloat()..100f,
                        )
                    }
                }
            }
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Home and lock screen", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "A live wallpaper. Swipe between home pages and your buddy dances; tap it for a pose. " +
                                "Whether it also shows on the lock screen depends on your phone.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Button(onClick = { openWallpaperPicker(context) }) { Text("Set as wallpaper") }
                    }
                }
            }
            item {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Screensaver", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "Shows every pose in turn while your phone charges. Pick Screen Buddy showcase in the list.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(onClick = { openScreensaverSettings(context) }) { Text("Screensaver settings") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) =
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)

@Composable
private fun BuddyChip(buddy: Buddy, selected: Boolean, onClick: () -> Unit) {
    val face by produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, buddy.manifest) {
        value = withContext(Dispatchers.IO) {
            runCatching { buddy.source.open(buddy.manifest.face).use { BitmapFactory.decodeStream(it) }?.asImageBitmap() }.getOrNull()
        }
    }
    val ring = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
    Column(
        modifier = Modifier
            .width(88.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        androidx.compose.material3.Surface(
            shape = CircleShape,
            border = BorderStroke(if (selected) 3.dp else 1.dp, ring),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.size(72.dp),
        ) {
            face?.let { Image(it, contentDescription = null, modifier = Modifier.fillMaxSize().clip(CircleShape)) }
        }
        Text(
            buddy.manifest.name,
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

private fun openWallpaperPicker(context: Context) {
    val component = ComponentName(context, BuddyWallpaperService::class.java)
    val direct = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
        .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
    try {
        context.startActivity(direct)
    } catch (_: ActivityNotFoundException) {
        // Some phones don't have the one-tap preview; fall back to the full wallpaper list.
        runCatching { context.startActivity(Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER)) }
    }
}

private fun openScreensaverSettings(context: Context) {
    val opts = listOf(
        Intent(Settings.ACTION_DREAM_SETTINGS),
        Intent(Settings.ACTION_DISPLAY_SETTINGS),
    )
    for (i in opts) {
        try { context.startActivity(i); return } catch (_: ActivityNotFoundException) { }
    }
}
