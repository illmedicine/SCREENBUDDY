package ai.illyrobotic.screenbuddy

import ai.illyrobotic.screenbuddy.buddy.BuddyManifest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BuddyManifestTest {
    @Test fun parsesAShippedManifest() {
        val m = TestBuddies.claw
        assertEquals("claw", m.id)
        assertEquals(190, m.cw)
        assertEquals(376, m.ch)
        assertEquals("hips", m.standClip)
        assertEquals(0, m.standFrame)
        assertEquals("strut", m.scrollClip)
        assertEquals(listOf("hips", "arms", "wave", "flip"), m.poses)
        assertEquals(40, m.clips.getValue("wave").n)
    }

    @Test fun rejectsClipFilesThatEscapeThePackage() {
        listOf("../strut.webp", "/etc/passwd", "a/b.webp", "strut.png").forEach { src ->
            assertThrows(src, BuddyManifest.Invalid::class.java) { BuddyManifest.parse(TestBuddies.json(stripSrc = src)) }
        }
    }

    @Test fun rejectsUnknownMoves() {
        assertThrows(BuddyManifest.Invalid::class.java) { BuddyManifest.parse(TestBuddies.json(poses = "[\"moonwalk\"]")) }
        assertThrows(BuddyManifest.Invalid::class.java) { BuddyManifest.parse(TestBuddies.json(stand = "[\"moonwalk\", 0]")) }
    }

    @Test fun rejectsAStandFrameOutsideItsClip() {
        assertThrows(BuddyManifest.Invalid::class.java) { BuddyManifest.parse(TestBuddies.json(stand = "[\"hips\", 17]")) }
    }

    @Test fun rejectsGarbage() {
        assertThrows(BuddyManifest.Invalid::class.java) { BuddyManifest.parse("not json") }
        assertThrows(BuddyManifest.Invalid::class.java) { BuddyManifest.parse("{}") }
    }
}
