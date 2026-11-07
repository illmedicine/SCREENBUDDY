package ai.illyrobotic.screenbuddy.buddy

import org.json.JSONObject

/** One move: [n] frames laid out side by side in the strip file [src]. */
data class Clip(val n: Int, val src: String)

/**
 * Describes a buddy package. Same shape as the web player's walker-data.js, plus id/author/version,
 * so one character works on both.
 */
data class BuddyManifest(
    val id: String,
    val name: String,
    val author: String,
    val version: Int,
    val cw: Int,
    val ch: Int,
    val fps: Int,
    val standClip: String,
    val standFrame: Int,
    val scrollClip: String,
    val poses: List<String>,
    val face: String,
    val clips: Map<String, Clip>,
) {
    class Invalid(message: String) : Exception(message)

    companion object {
        const val FILE = "manifest.json"
        private val ID = Regex("[a-z0-9][a-z0-9_-]{0,63}")
        private val FILE_NAME = Regex("[A-Za-z0-9_-]{1,64}\\.webp")

        fun parse(json: String): BuddyManifest = try {
            parseUnchecked(JSONObject(json))
        } catch (e: Invalid) {
            throw e
        } catch (e: Exception) {
            throw Invalid("Not a valid buddy manifest: ${e.message}")
        }

        private fun parseUnchecked(o: JSONObject): BuddyManifest {
            val id = o.getString("id")
            if (!ID.matches(id)) throw Invalid("Bad id '$id'")
            val clipsJson = o.getJSONObject("clips")
            val clips = LinkedHashMap<String, Clip>()
            for (k in clipsJson.keys()) {
                val c = clipsJson.getJSONObject(k)
                val src = c.getString("src")
                // Clip files live inside the package: plain file names only, so a zip can't reach elsewhere.
                if (!FILE_NAME.matches(src)) throw Invalid("Bad clip file '$src'")
                val n = c.getInt("n")
                if (n < 1 || n > 400) throw Invalid("Clip '$k' has $n frames")
                clips[k] = Clip(n, src)
            }
            val stand = o.getJSONArray("stand")
            val standClip = stand.getString(0)
            val standFrame = stand.getInt(1)
            val scroll = o.getString("scroll")
            val poses = o.getJSONArray("poses").let { a -> List(a.length()) { a.getString(it) } }
            val face = o.getString("face")
            if (!FILE_NAME.matches(face)) throw Invalid("Bad face file '$face'")
            val cw = o.getInt("cw")
            val ch = o.getInt("ch")
            if (cw !in 16..2048 || ch !in 16..2048) throw Invalid("Bad cell size ${cw}x$ch")
            val fps = o.optInt("fps", 10)
            if (fps !in 1..60) throw Invalid("Bad fps $fps")
            val clipOf = { name: String -> clips[name] ?: throw Invalid("Unknown move '$name'") }
            val standMove = clipOf(standClip)
            if (standFrame !in 0 until standMove.n) throw Invalid("Stand frame $standFrame is outside '$standClip'")
            clipOf(scroll)
            poses.forEach { clipOf(it) }
            return BuddyManifest(
                id = id,
                name = o.getString("name"),
                author = o.optString("author", ""),
                version = o.optInt("version", 1),
                cw = cw, ch = ch, fps = fps,
                standClip = standClip, standFrame = standFrame,
                scrollClip = scroll, poses = poses, face = face, clips = clips,
            )
        }
    }
}
