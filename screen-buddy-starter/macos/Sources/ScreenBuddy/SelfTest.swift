import AppKit
import ScreenBuddyCore

/// Loads every buddy the app can see, decodes every strip and draws the standing frame into a bitmap.
/// Prints one line per buddy and returns 0 when all of them pass.
enum SelfTest {
    static func run() -> Int32 {
        guard let folder = bundledBuddiesFolder() else {
            print("FAIL no buddies folder found")
            return 1
        }
        let buddies = BuddyLibrary(roots: [folder]).list()
        print("buddies folder: \(folder.path)")
        print("buddies found: \(buddies.count)")
        var failed = buddies.isEmpty
        for b in buddies {
            let m = b.manifest
            let bank = SpriteBank(b)
            let missing = m.clips.keys.filter { !bank.has($0) }.sorted()
            let stand = FramePick(move: m.standClip, frame: m.standFrame)
            var visible = false
            if let img = bank.frame(stand), let ctx = CGContext(
                data: nil, width: m.cw, height: m.ch, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
                ctx.draw(img, in: CGRect(x: 0, y: 0, width: m.cw, height: m.ch))
                if let data = ctx.data {
                    let px = data.bindMemory(to: UInt8.self, capacity: ctx.bytesPerRow * m.ch)
                    var opaque = 0
                    for y in 0..<m.ch { for x in 0..<m.cw where px[y * ctx.bytesPerRow + x * 4 + 3] > 0 { opaque += 1 } }
                    visible = opaque > m.cw * m.ch / 50           // at least 2% of the frame is the buddy
                }
            }
            let ok = missing.isEmpty && visible
            if !ok { failed = true }
            print("\(ok ? "ok  " : "FAIL") \(m.id) (\(m.name)): \(m.clips.count) moves"
                  + (missing.isEmpty ? "" : ", could not load: \(missing.joined(separator: ", "))")
                  + (visible ? "" : ", standing frame is empty"))
        }
        print(failed ? "SELFTEST FAILED" : "SELFTEST OK")
        return failed ? 1 : 0
    }
}
