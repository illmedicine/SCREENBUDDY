import XCTest
@testable import ScreenBuddyCore

/// The website admin's hidden list: parsing Firestore's answer and leaving hidden buddies out of the library.
final class HiddenTests: XCTestCase {
    private let web = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("web/buddies")

    func testParsesTheAdminsHiddenFlags() {
        let json = #"""
        {"documents": [
          {"name": "projects/p/databases/(default)/documents/buddies/body", "fields": {"hidden": {"booleanValue": true}, "name": {"stringValue": "Body"}}},
          {"name": "projects/p/databases/(default)/documents/buddies/claw", "fields": {"hidden": {"booleanValue": true}}},
          {"name": "projects/p/databases/(default)/documents/buddies/kiah", "fields": {"hidden": {"booleanValue": false}}},
          {"name": "projects/p/databases/(default)/documents/buddies/nadi", "fields": {"name": {"stringValue": "Polka Dot"}}}
        ]}
        """#
        XCTAssertEqual(HiddenBuddies.parse(Data(json.utf8)), ["body", "claw"])
    }

    func testEmptyAndBadAnswers() {
        XCTAssertEqual(HiddenBuddies.parse(Data("{}".utf8)), [])                       // nothing set yet
        XCTAssertNil(HiddenBuddies.parse(Data(#"{"error": {"code": 403}}"#.utf8)))       // keep the saved list
        XCTAssertNil(HiddenBuddies.parse(Data("junk".utf8)))
    }

    func testHiddenBuiltInBuddiesAreLeftOut() {
        let all = BuddyLibrary(roots: [web]).list().map(\.id)
        XCTAssertTrue(all.contains("claw") && all.contains("body"))
        let shown = BuddyLibrary(roots: [web], hidden: { ["claw", "body"] }).list().map(\.id)
        XCTAssertFalse(shown.contains("claw"))
        XCTAssertFalse(shown.contains("body"))
        XCTAssertEqual(shown.count, all.count - 2)
    }

    func testTheListIsReadEveryTime() {
        var hidden: Set<String> = ["claw"]
        let lib = BuddyLibrary(roots: [web], hidden: { hidden })
        XCTAssertFalse(lib.list().contains { $0.id == "claw" })
        hidden = []
        XCTAssertTrue(lib.list().contains { $0.id == "claw" })
    }
}
