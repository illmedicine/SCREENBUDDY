import XCTest
@testable import ScreenBuddyCore

final class UpdateTests: XCTestCase {
    private let config = ReleaseConfig.parse(Data(#"{"repo":"me/app","tagPrefix":"macos-v"}"#.utf8))!
    private let dl = "https://github.com/me/app/releases/download/"

    private func release(_ tag: String, draft: Bool = false, pre: Bool = false, manifest: Bool = true) -> GitHubRelease {
        GitHubRelease(tag: tag, draft: draft, prerelease: pre,
                      assets: manifest ? [GitHubAsset(name: "update.json", url: dl + tag + "/update.json")] : [])
    }

    func testVersionsParseAndOrder() {
        XCTAssertEqual(SemVer("1.2.3")?.description, "1.2.3")
        for bad in ["", "1.2", "1.2.3.4", "1.2.x", "v1.2.3", "1.2.3-beta", "1..3", "-1.2.3"] { XCTAssertNil(SemVer(bad), bad) }
        XCTAssertLessThan(SemVer("0.9.10")!, SemVer("0.10.0")!)
        XCTAssertLessThan(SemVer("1.2.3")!, SemVer("1.2.4")!)
    }

    func testReleaseConfigIsChecked() {
        XCTAssertEqual(config.downloadPrefix, dl)
        XCTAssertNil(ReleaseConfig.parse(Data(#"{"repo":"no-slash","tagPrefix":"macos-v"}"#.utf8)))
        XCTAssertNil(ReleaseConfig.parse(Data(#"{"repo":"a/b/c","tagPrefix":"macos-v"}"#.utf8)))
        XCTAssertNil(ReleaseConfig.parse(Data("junk".utf8)))
    }

    func testPicksTheHighestNewerMacRelease() {
        let rs = [release("macos-v0.2.0"), release("windows-v9.0.0"), release("macos-v0.4.0", draft: true),
                  release("macos-v0.5.0", pre: true), release("macos-v0.3.0"), release("macos-v0.9.0", manifest: false),
                  release("macos-v0.1.0")]
        let c = Updates.pick(rs, config: config, current: SemVer("0.1.0")!)
        XCTAssertEqual(c?.tag, "macos-v0.3.0")
        XCTAssertEqual(c?.manifestURL.absoluteString, dl + "macos-v0.3.0/update.json")
        XCTAssertNil(Updates.pick(rs, config: config, current: SemVer("0.3.0")!))
    }

    func testIgnoresManifestsHostedElsewhere() {
        let r = GitHubRelease(tag: "macos-v1.0.0", assets: [GitHubAsset(name: "update.json", url: "https://evil.example/update.json")])
        XCTAssertNil(Updates.pick([r], config: config, current: SemVer("0.1.0")!))
    }

    func testChecksTheManifest() {
        let c = UpdateCandidate(version: SemVer("0.3.0")!, tag: "macos-v0.3.0", manifestURL: URL(string: dl + "macos-v0.3.0/update.json")!)
        func m(version: String = "0.3.0", url: String? = nil, sha: String = String(repeating: "a", count: 64), size: Int64 = 1000) -> UpdateManifest {
            let json: [String: Any] = ["version": version, "url": url ?? dl + "macos-v0.3.0/ScreenBuddy-mac-0.3.0.zip", "sha256": sha, "size": size]
            return try! JSONDecoder().decode(UpdateManifest.self, from: JSONSerialization.data(withJSONObject: json))
        }
        XCTAssertNil(Updates.problem(with: m(), for: c, config: config))
        XCTAssertNotNil(Updates.problem(with: m(version: "0.4.0"), for: c, config: config))
        XCTAssertNotNil(Updates.problem(with: m(url: "https://evil.example/x.zip"), for: c, config: config))
        XCTAssertNotNil(Updates.problem(with: m(url: dl + "macos-v0.2.0/x.zip"), for: c, config: config))
        XCTAssertNotNil(Updates.problem(with: m(sha: "ABC"), for: c, config: config))
        XCTAssertNotNil(Updates.problem(with: m(size: 0), for: c, config: config))
        XCTAssertNotNil(Updates.problem(with: m(size: Updates.maxBytes + 1), for: c, config: config))
    }
}
