import AppKit
import ImageIO
import ScreenBuddyCore

/// A buddy's strips, decoded once. A move whose picture is missing or the wrong size is left out, so it is never chosen.
final class SpriteBank {
    let buddy: Buddy
    private var strips: [String: CGImage] = [:]

    init(_ buddy: Buddy) {
        self.buddy = buddy
        let m = buddy.manifest
        for (move, clip) in m.clips {
            guard let src = CGImageSourceCreateWithURL(buddy.url(clip.src) as CFURL, nil),
                  let img = CGImageSourceCreateImageAtIndex(src, 0, nil),
                  img.width == clip.n * m.cw, img.height == m.ch else { continue }
            strips[move] = img
        }
    }

    func has(_ move: String) -> Bool { strips[move] != nil }

    /// One frame cut out of its strip (pixel coordinates, origin top-left).
    func frame(_ pick: FramePick) -> CGImage? {
        let m = buddy.manifest
        guard let strip = strips[pick.move] else { return nil }
        return strip.cropping(to: CGRect(x: pick.frame * m.cw, y: 0, width: m.cw, height: m.ch))
    }
}
