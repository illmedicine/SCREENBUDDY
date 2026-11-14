package ai.illyrobotic.screenbuddy.buddy

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Installs shared buddies added on the website after this release. Firestore lists them (catalog/{id}: Storage prefix
 * and version, public to read) and each one's buddy.zip lives in Cloud Storage. Zips go through [BuddyStore.importZip],
 * so they get the same checks as any import. Remembers the installed version of each, so a zip downloads once.
 * Runs on a background thread when the app starts; offline it just tries again next start.
 */
object CloudSync {
    private const val PROJECT = "screen-buddy-f968b"
    private const val BUCKET = "screen-buddy-f968b.firebasestorage.app"
    private const val API_KEY = "AIzaSyBQi0TVrDIWQ4hclgFox9SMzRsGQSwC8CU"   // the website's public web key
    private val ID = Regex("[a-z0-9][a-z0-9_-]{0,63}")

    data class Entry(val id: String, val prefix: String, val version: Long)

    fun start(context: Context) {
        val app = context.applicationContext
        Thread({ runCatching { sync(app) } }, "cloud-sync").apply { isDaemon = true }.start()
    }

    fun sync(context: Context) {
        val store = BuddyStore(context)
        val prefs = context.getSharedPreferences("cloud", Context.MODE_PRIVATE)
        // The admin's hidden list first: it applies to every buddy, built-in ones too (BuddyStore.list leaves them out).
        val hidden = parseHidden(get(listUrl("buddies")))
        BuddyStore.saveHidden(context, hidden)
        val entries = parse(get(listUrl("catalog")))
        for (e in entries) {
            if (e.id in hidden) continue     // not downloaded while hidden; one already installed just isn't listed
            val installed = store.list().any { it.id == e.id }
            if (installed && prefs.getLong(e.id, -1) >= e.version) continue
            runCatching {
                open(fileUrl(e.prefix + "buddy.zip")).use { store.importZip(it).getOrThrow() }
                prefs.edit().putLong(e.id, e.version).apply()
            }
        }
    }

    fun listUrl(collection: String) =
        "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents/$collection?pageSize=300&key=$API_KEY"

    fun fileUrl(path: String) =
        "https://firebasestorage.googleapis.com/v0/b/$BUCKET/o/${URLEncoder.encode(path, "UTF-8").replace("+", "%20")}?alt=media"

    fun parse(json: String): List<Entry> {
        val docs = JSONObject(json).optJSONArray("documents") ?: return emptyList()
        return (0 until docs.length()).mapNotNull { i ->
            val d = docs.getJSONObject(i)
            val id = d.optString("name").substringAfterLast('/')
            val f = d.optJSONObject("fields") ?: return@mapNotNull null
            val prefix = f.optJSONObject("prefix")?.optString("stringValue") ?: return@mapNotNull null
            if (!ID.matches(id) || !prefix.startsWith("buddies/") || ".." in prefix) return@mapNotNull null
            Entry(id, prefix, f.optJSONObject("version")?.optString("integerValue")?.toLongOrNull() ?: 0L)
        }
    }

    fun parseHidden(json: String): Set<String> {
        val docs = JSONObject(json).optJSONArray("documents") ?: return emptySet()
        return (0 until docs.length()).mapNotNull { i ->
            val d = docs.getJSONObject(i)
            val hidden = d.optJSONObject("fields")?.optJSONObject("hidden")?.optBoolean("booleanValue") == true
            if (hidden) d.optString("name").substringAfterLast('/') else null
        }.toSet()
    }

    private fun open(url: String) = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000; readTimeout = 60_000
    }.inputStream

    private fun get(url: String) = open(url).use { it.readBytes().decodeToString() }
}
