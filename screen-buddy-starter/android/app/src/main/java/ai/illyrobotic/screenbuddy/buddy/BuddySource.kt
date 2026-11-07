package ai.illyrobotic.screenbuddy.buddy

import android.content.res.AssetManager
import java.io.File
import java.io.InputStream

/** Where a buddy's files are read from. */
interface BuddySource {
    fun open(fileName: String): InputStream
}

class AssetBuddySource(private val assets: AssetManager, private val dir: String) : BuddySource {
    override fun open(fileName: String): InputStream = assets.open("$dir/$fileName")
}

class FileBuddySource(private val dir: File) : BuddySource {
    override fun open(fileName: String): InputStream = File(dir, fileName).inputStream()
}

/** A buddy that is ready to play: its manifest, where its files are, and whether it ships with the app. */
data class Buddy(val manifest: BuddyManifest, val source: BuddySource, val bundled: Boolean) {
    val id get() = manifest.id
}
