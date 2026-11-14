package ai.illyrobotic.screenbuddy.buddy

import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.zip.ZipInputStream

/**
 * The user's library: sample buddies shipped in the APK (assets/buddies/<id>/) plus buddies imported
 * from a buddy.zip, which are unpacked to filesDir/buddies/<id>/.
 */
class BuddyStore(private val context: Context) {
    private val installedRoot = File(context.filesDir, "buddies")

    fun list(): List<Buddy> {
        val out = LinkedHashMap<String, Buddy>()
        val assets = context.assets
        for (dir in assets.list(ASSET_DIR).orEmpty().sorted()) {
            runCatching {
                val src = AssetBuddySource(assets, "$ASSET_DIR/$dir")
                val m = BuddyManifest.parse(src.open(BuddyManifest.FILE).use { it.readBytes().decodeToString() })
                out[m.id] = Buddy(m, src, bundled = true)
            }
        }
        for (dir in installedRoot.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }.orEmpty().sortedBy { it.name }) {
            runCatching {
                val src = FileBuddySource(dir)
                val m = BuddyManifest.parse(src.open(BuddyManifest.FILE).use { it.readBytes().decodeToString() })
                if (m.id !in out) out[m.id] = Buddy(m, src, bundled = false)
            }
        }
        val hidden = hiddenIds(context)
        return out.values.filter { it.id !in hidden }     // the website admin's hidden buddies, built-in ones too
    }

    /** The buddy with [id], or the first one in the library if that id is gone (or null). */
    fun find(id: String?): Buddy? = list().let { all -> all.firstOrNull { it.id == id } ?: all.firstOrNull() }

    /**
     * Imports a buddy.zip. The archive is untrusted: only flat, size-limited files are accepted, every file the
     * manifest names must be present and be a WebP image, and nothing is kept unless the whole package is valid.
     */
    fun importZip(input: InputStream): Result<Buddy> = runCatching {
        val files = HashMap<String, ByteArray>()
        var total = 0L
        ZipInputStream(input.buffered()).use { zip ->
            while (true) {
                val e = zip.nextEntry ?: break
                if (e.isDirectory) continue
                val name = e.name
                if ('/' in name || '\\' in name || name.startsWith(".")) {
                    throw BuddyManifest.Invalid("Unexpected path '$name' in zip")
                }
                if (files.size >= MAX_FILES) throw BuddyManifest.Invalid("Too many files in zip")
                val bytes = zip.readLimited(MAX_FILE_BYTES)
                total += bytes.size
                if (total > MAX_TOTAL_BYTES) throw BuddyManifest.Invalid("Zip is too large")
                files[name] = bytes
            }
        }
        val manifest = BuddyManifest.parse(
            (files[BuddyManifest.FILE] ?: throw BuddyManifest.Invalid("No ${BuddyManifest.FILE} in zip")).decodeToString()
        )
        val needed = manifest.clips.values.map { it.src } + manifest.face
        for (f in needed) {
            val b = files[f] ?: throw BuddyManifest.Invalid("Missing file $f")
            if (!isWebp(b)) throw BuddyManifest.Invalid("$f is not a WebP image")
        }
        installedRoot.mkdirs()
        val dest = File(installedRoot, manifest.id)
        val tmp = File(installedRoot, ".${manifest.id}.tmp")
        tmp.deleteRecursively(); tmp.mkdirs()
        (needed.toSet() + BuddyManifest.FILE).forEach { File(tmp, it).writeBytes(files.getValue(it)) }
        dest.deleteRecursively()
        check(tmp.renameTo(dest)) { "Could not save buddy" }
        Buddy(manifest, FileBuddySource(dest), bundled = false)
    }

    fun delete(buddy: Buddy) {
        if (!buddy.bundled) File(installedRoot, buddy.id).deleteRecursively()
    }

    private fun InputStream.readLimited(limit: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            if (out.size() > limit) throw BuddyManifest.Invalid("A file in the zip is too large")
        }
        return out.toByteArray()
    }

    private fun isWebp(b: ByteArray) = b.size > 12 &&
        b.decodeToString(0, 4) == "RIFF" && b.decodeToString(8, 12) == "WEBP"

    companion object {
        const val ASSET_DIR = "buddies"
        private const val HIDDEN_PREFS = "hidden"
        private const val HIDDEN_IDS = "ids"

        /**
         * Ids the website's admin hid (Firestore buddies/{id}.hidden), as [CloudSync] last saw them. Kept on the device
         * so they stay hidden offline, in the screensaver and in the live wallpaper.
         */
        fun hiddenIds(context: Context): Set<String> =
            context.getSharedPreferences(HIDDEN_PREFS, Context.MODE_PRIVATE).getStringSet(HIDDEN_IDS, null)?.toSet().orEmpty()

        /** Saves the admin's hidden list. */
        fun saveHidden(context: Context, ids: Set<String>) {
            if (ids == hiddenIds(context)) return
            context.getSharedPreferences(HIDDEN_PREFS, Context.MODE_PRIVATE).edit().putStringSet(HIDDEN_IDS, ids.toSet()).apply()
        }
        private const val MAX_FILES = 40
        private const val MAX_FILE_BYTES = 8 * 1024 * 1024
        private const val MAX_TOTAL_BYTES = 40L * 1024 * 1024
    }
}
