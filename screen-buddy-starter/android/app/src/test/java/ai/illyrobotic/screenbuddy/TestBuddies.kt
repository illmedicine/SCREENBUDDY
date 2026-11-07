package ai.illyrobotic.screenbuddy

import ai.illyrobotic.screenbuddy.buddy.BuddyManifest

/** The Clawmontana manifest, as shipped, for tests. */
object TestBuddies {
    fun json(
        stand: String = "[\"hips\", 0]",
        poses: String = "[\"hips\", \"arms\", \"wave\", \"flip\"]",
        stripSrc: String = "strut.webp",
    ) = """
        {
          "id": "claw", "name": "Clawmontana", "author": "Armani West", "version": 1,
          "cw": 190, "ch": 376, "fps": 10,
          "stand": $stand, "scroll": "strut", "poses": $poses, "face": "face.webp",
          "clips": {
            "strut": {"n": 10, "src": "$stripSrc"},
            "hips":  {"n": 17, "src": "hips.webp"},
            "arms":  {"n": 10, "src": "arms.webp"},
            "wave":  {"n": 40, "src": "wave.webp"},
            "flip":  {"n": 9,  "src": "flip.webp"}
          }
        }
    """.trimIndent()

    val claw: BuddyManifest get() = BuddyManifest.parse(json())
}
