import XCTest
@testable import ScreenBuddyCore

final class ManifestTests: XCTestCase {
    private func manifest(_ edit: (inout [String: Any]) -> Void = { _ in }) -> Data {
        var o: [String: Any] = [
            "id": "demo", "name": "Demo", "author": "Me", "version": 1, "cw": 100, "ch": 200, "fps": 10,
            "stand": ["walk", 2], "scroll": "walk", "poses": ["wave"], "face": "face.webp",
            "clips": ["walk": ["n": 8, "src": "walk.webp"], "wave": ["n": 4, "src": "wave.webp"]],
        ]
        edit(&o)
        return try! JSONSerialization.data(withJSONObject: o)
    }

    func testParsesAGoodManifest() throws {
        let m = try BuddyManifest.parse(manifest())
        XCTAssertEqual(m.id, "demo")
        XCTAssertEqual(m.clips["walk"], Clip(n: 8, src: "walk.webp"))
        XCTAssertEqual(m.standFrame, 2)
        XCTAssertEqual(m.fps, 10)
    }

    func testFpsDefaultsToTen() throws {
        XCTAssertEqual(try BuddyManifest.parse(manifest { $0.removeValue(forKey: "fps") }).fps, 10)
    }

    func testRefusesFilesOutsideThePackage() {
        for bad in ["../x.webp", "a/b.webp", "x.png", ".hidden.webp", "x.webp\\y"] {
            XCTAssertThrowsError(try BuddyManifest.parse(manifest {
                $0["clips"] = ["walk": ["n": 8, "src": bad], "wave": ["n": 4, "src": "wave.webp"]]
            }), bad)
        }
    }

    func testRefusesBadValues() {
        XCTAssertThrowsError(try BuddyManifest.parse(manifest { $0["id"] = "Bad Id" }))
        XCTAssertThrowsError(try BuddyManifest.parse(manifest { $0["cw"] = 8 }))
        XCTAssertThrowsError(try BuddyManifest.parse(manifest { $0["fps"] = 61 }))
        XCTAssertThrowsError(try BuddyManifest.parse(manifest { $0["fps"] = true }))
        XCTAssertThrowsError(try BuddyManifest.parse(manifest { $0["stand"] = ["walk", 8] }))
        XCTAssertThrowsError(try BuddyManifest.parse(manifest { $0["scroll"] = "nope" }))
        XCTAssertThrowsError(try BuddyManifest.parse(manifest { $0["poses"] = ["nope"] }))
        XCTAssertThrowsError(try BuddyManifest.parse(Data("[1,2]".utf8)))
        XCTAssertThrowsError(try BuddyManifest.parse(Data("nonsense".utf8)))
    }
}

final class AnimatorTests: XCTestCase {
    private func buddy() throws -> BuddyManifest {
        try BuddyManifest.parse(try JSONSerialization.data(withJSONObject: [
            "id": "demo", "name": "Demo", "cw": 100, "ch": 200, "fps": 10,
            "stand": ["walk", 2], "scroll": "walk", "poses": ["wave", "spin"], "face": "face.webp",
            "clips": ["walk": ["n": 8, "src": "walk.webp"], "wave": ["n": 4, "src": "wave.webp"],
                      "spin": ["n": 30, "src": "spin.webp"]],
        ] as [String: Any]))
    }

    func testStandsAtFirst() throws {
        XCTAssertEqual(BuddyAnimator(try buddy()).frame, FramePick(move: "walk", frame: 2))
    }

    func testScrubStepsForwardThenBackwardAndSettles() throws {
        let a = BuddyAnimator(try buddy())
        var seen: [Int] = []
        var t: Int64 = 0
        for _ in 0..<40 { a.scrub(BuddyAnimator.stepPx, now: t); seen.append(a.frame.frame); t += 20 }
        XCTAssertEqual(Array(seen.prefix(8)), [1, 2, 3, 4, 5, 6, 7, 6])           // forwards, then back at the end
        XCTAssertTrue(a.animating)
        a.update(now: t + BuddyAnimator.settleMs)
        XCTAssertFalse(a.animating)
        XCTAssertEqual(a.frame, FramePick(move: "walk", frame: 2))
        XCTAssertEqual(a.lean, 0)
    }

    func testLeanIsClamped() throws {
        let a = BuddyAnimator(try buddy())
        a.scrub(1000, now: 0)
        XCTAssertEqual(a.lean, BuddyAnimator.maxLean)
        a.scrub(-1000, now: 1)
        XCTAssertEqual(a.lean, -BuddyAnimator.maxLean)
    }

    func testShortPoseGoesForwardsThenBackwards() throws {
        let a = BuddyAnimator(try buddy(), random: { 0 })      // always the first pose: wave (4 frames)
        XCTAssertTrue(a.tap(now: 0))
        var frames: [Int] = []
        for k in 0..<7 { a.update(now: Int64(k * 100)); frames.append(a.frame.frame) }
        XCTAssertEqual(frames, [0, 1, 2, 3, 2, 1, 0])
        a.update(now: 700)
        XCTAssertFalse(a.posing)
    }

    func testNeverRepeatsThePreviousPoseAndIgnoresTapsWhilePosing() throws {
        let a = BuddyAnimator(try buddy(), random: { 0 })
        XCTAssertTrue(a.tap(now: 0))
        XCTAssertFalse(a.tap(now: 10))
        a.update(now: 5000)
        XCTAssertTrue(a.tap(now: 5000))
        XCTAssertEqual(a.frame.move, "spin")                    // wave is excluded, so the first choice is spin
    }

    func testMovesThatHaveNotLoadedAreNeverChosen() throws {
        let a = BuddyAnimator(try buddy(), random: { 0 }, ready: { $0 == "walk" })
        XCTAssertFalse(a.tap(now: 0))
        XCTAssertFalse(a.play("wave", now: 0))
    }
}

final class LayoutTests: XCTestCase {
    func testFitStandsOnTheBottomEdge() throws {
        let m = try BuddyManifest.parse(try JSONSerialization.data(withJSONObject: [
            "id": "d", "name": "D", "cw": 100, "ch": 200, "stand": ["a", 0], "scroll": "a", "poses": [],
            "face": "f.webp", "clips": ["a": ["n": 1, "src": "a.webp"]],
        ] as [String: Any]))
        let w = BuddyLayout.windowWidth(height: 200, m)
        let r = BuddyLayout.fit(w: w, h: 200, m)
        XCTAssertEqual(r.y + r.h, 200, accuracy: 0.001)
        XCTAssertEqual(r.h, 200, accuracy: 0.5)
        XCTAssertEqual(r.x * 2 + r.w, w, accuracy: 0.001)       // centred
    }
}

/// The real buddies that ship with the web player and every app.
final class ShippedBuddiesTests: XCTestCase {
    func testEveryShippedBuddyLoads() throws {
        let web = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("web/buddies")
        let all = BuddyLibrary(roots: [web]).list()
        XCTAssertGreaterThanOrEqual(all.count, 5)
        let index = try JSONSerialization.jsonObject(with: Data(contentsOf: web.appendingPathComponent("index.json"))) as! [String: Any]
        XCTAssertEqual(Set(all.map(\.id)), Set(index["buddies"] as! [String]))
    }
}
