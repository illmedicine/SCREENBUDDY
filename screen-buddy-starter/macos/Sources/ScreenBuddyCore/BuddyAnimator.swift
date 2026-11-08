import Foundation

/// A single frame to show: `frame` of the strip called `move`.
public struct FramePick: Equatable {
    public let move: String
    public let frame: Int
    public init(move: String, frame: Int) { self.move = move; self.frame = frame }
}

/// Decides which frame the buddy shows. The same behaviour as the Windows app, the Android player and the web player.
///  - Idle:  stands on one chosen frame.
///  - Scrub: movement (a drag) steps through the scroll move, `stepPx` per frame, forwards then backwards so it never
///           snaps; the buddy leans up to `maxLean` degrees; `settleMs` after the last movement it goes back to standing.
///  - Pose:  plays a random pose that isn't the one before. Short poses play forwards then backwards.
/// All times are caller-supplied milliseconds on any monotonic clock. `ready` says whether a move's frames have loaded;
/// moves that haven't are never chosen.
public final class BuddyAnimator {
    public static let stepPx: Double = 28
    public static let maxLean: Double = 5
    public static let leanDiv: Double = 8
    public static let settleMs: Int64 = 450
    public static let loopBelow = 24

    private let m: BuddyManifest
    private let random: () -> Double
    private let ready: (String) -> Bool
    private var travel: Double = 0
    private var lastMoveAt: Int64 = 0
    private var scrubbing = false
    private var pose: String?
    private var poseStart: Int64 = 0
    private var poseTotal = 0
    private var lastPose = ""

    public private(set) var lean: Double = 0
    public private(set) var frame: FramePick

    public init(_ manifest: BuddyManifest, random: @escaping () -> Double = { Double.random(in: 0..<1) },
                ready: @escaping (String) -> Bool = { _ in true }) {
        m = manifest
        self.random = random
        self.ready = ready
        frame = FramePick(move: manifest.standClip, frame: manifest.standFrame)
    }

    public var posing: Bool { pose != nil }
    /// True while something is moving and the host should keep redrawing.
    public var animating: Bool { posing || scrubbing }

    /// Movement of `dy` points (signed; the sign leans the buddy). Ignored while posing, except the lean.
    public func scrub(_ dy: Double, now: Int64) {
        lean = min(max(dy / Self.leanDiv, -Self.maxLean), Self.maxLean)
        lastMoveAt = now
        if posing { return }
        scrubbing = true
        guard ready(m.scroll) else { return }
        travel += abs(dy)
        let n = m.clips[m.scroll]!.n
        if n == 1 { frame = FramePick(move: m.scroll, frame: 0); return }
        let cycle = 2 * n - 2
        let k = Int(travel / Self.stepPx) % cycle
        frame = FramePick(move: m.scroll, frame: k < n ? k : cycle - k)
    }

    /// Starts a random ready pose, never the same as the last. False if one is playing or none has loaded.
    @discardableResult
    public func tap(now: Int64) -> Bool {
        if posing { return false }
        var choices = m.poses.filter { ready($0) && $0 != lastPose }
        if choices.isEmpty { choices = m.poses.filter { ready($0) } }
        if choices.isEmpty { return false }
        start(choices[min(Int(random() * Double(choices.count)), choices.count - 1)], now: now)
        return true
    }

    /// Plays a specific move as a pose.
    @discardableResult
    public func play(_ move: String, now: Int64) -> Bool {
        if posing || m.clips[move] == nil || !ready(move) { return false }
        start(move, now: now)
        return true
    }

    private func start(_ move: String, now: Int64) {
        let n = m.clips[move]!.n
        pose = move; lastPose = move; poseStart = now
        poseTotal = n < Self.loopBelow ? 2 * n - 1 : n
        scrubbing = false
        frame = FramePick(move: move, frame: 0)
    }

    /// Advances time-driven state. Call once per drawn frame.
    public func update(now: Int64) {
        if let p = pose {
            let n = m.clips[p]!.n
            let k = Int((now - poseStart) * Int64(m.fps) / 1000)
            if k >= poseTotal { pose = nil; stand() }
            else { frame = FramePick(move: p, frame: k < n ? k : 2 * n - 2 - k) }
        } else if scrubbing && now - lastMoveAt >= Self.settleMs {
            scrubbing = false
            stand()
        }
    }

    /// Drops whatever is playing and goes back to standing (used when the user pauses the buddy).
    public func stop() {
        pose = nil
        scrubbing = false
        stand()
    }

    private func stand() {
        lean = 0
        frame = FramePick(move: m.standClip, frame: m.standFrame)
    }
}

/// Where to draw a buddy inside a window. The lean swings the head sideways, so the window is a little wider than the buddy.
public enum BuddyLayout {
    /// sin(5 degrees): how far the head swings sideways at full lean, as a fraction of the drawn height.
    public static let lean = 0.0872

    /// Width of a window that fits a buddy `height` tall, with room for the lean on both sides.
    public static func windowWidth(height: Double, _ m: BuddyManifest) -> Double {
        (height * (Double(m.cw) / Double(m.ch) + 2 * lean)).rounded(.up)
    }

    /// Fits the buddy into a `w` x `h` area, standing on the bottom edge, centred. y is measured from the top.
    public static func fit(w: Double, h: Double, _ m: BuddyManifest) -> (x: Double, y: Double, w: Double, h: Double) {
        let scale = min(w / (Double(m.cw) + 2 * lean * Double(m.ch)), h / Double(m.ch))
        let dw = Double(m.cw) * scale
        let dh = Double(m.ch) * scale
        return ((w - dw) / 2, h - dh, dw, dh)
    }
}
