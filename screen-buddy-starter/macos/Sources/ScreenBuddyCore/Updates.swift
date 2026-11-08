import Foundation

// Self-update rules, kept free of UI and networking so they can be tested. Same rules as the Windows app
// (windows/src/ScreenBuddy.Core/Updates.cs): releases are GitHub Releases tagged `<tagPrefix><major>.<minor>.<patch>`
// that carry an `update.json` asset, and only a strictly newer, non-draft, non-pre-release version is taken.

/// A `major.minor.patch` version. Anything else (suffixes, missing parts) is not a version.
public struct SemVer: Comparable, CustomStringConvertible, Sendable {
    public let major: Int, minor: Int, patch: Int

    public init?(_ text: String) {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var n: [Int] = []
        for p in parts {
            guard !p.isEmpty, p.count <= 9, p.allSatisfy({ $0 >= "0" && $0 <= "9" }), let v = Int(p) else { return nil }
            n.append(v)
        }
        major = n[0]
        minor = n[1]
        patch = n[2]
    }

    public static func < (a: SemVer, b: SemVer) -> Bool {
        (a.major, a.minor, a.patch) < (b.major, b.minor, b.patch)
    }

    public var description: String { "\(major).\(minor).\(patch)" }
}

/// `release.json` inside a release build's Resources: which repo to look in. Builds without it never update.
public struct ReleaseConfig: Decodable, Equatable, Sendable {
    public let repo: String
    public let tagPrefix: String

    public static func parse(_ data: Data) -> ReleaseConfig? {
        guard let c = try? JSONDecoder().decode(ReleaseConfig.self, from: data) else { return nil }
        let name = "[A-Za-z0-9_.-]+"
        guard c.repo.range(of: "^\(name)/\(name)$", options: .regularExpression) != nil,
              c.tagPrefix.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil else { return nil }
        return c
    }

    /// Every download must come from this repo's release files.
    public var downloadPrefix: String { "https://github.com/\(repo)/releases/download/" }
}

public struct GitHubAsset: Decodable, Sendable {
    public let name: String
    public let url: String
    enum CodingKeys: String, CodingKey { case name, url = "browser_download_url" }
    public init(name: String, url: String) { self.name = name; self.url = url }
}

public struct GitHubRelease: Decodable, Sendable {
    public let tag: String
    public let draft: Bool
    public let prerelease: Bool
    public let assets: [GitHubAsset]
    enum CodingKeys: String, CodingKey { case tag = "tag_name", draft, prerelease, assets }
    public init(tag: String, draft: Bool = false, prerelease: Bool = false, assets: [GitHubAsset]) {
        self.tag = tag
        self.draft = draft
        self.prerelease = prerelease
        self.assets = assets
    }
}

/// `update.json`, attached to every release: where the new app's zip is and how to check it.
public struct UpdateManifest: Decodable, Sendable {
    public let version: String
    public let url: String
    public let sha256: String
    public let size: Int64
    public let notes: String?
}

public struct UpdateCandidate: Equatable, Sendable {
    public let version: SemVer
    public let tag: String
    public let manifestURL: URL
}

public enum Updates {
    /// Largest download accepted, so a bad manifest can't fill the disk.
    public static let maxBytes: Int64 = 512 * 1024 * 1024

    /// The highest release newer than `current`, or nil when up to date.
    public static func pick(_ releases: [GitHubRelease], config: ReleaseConfig, current: SemVer) -> UpdateCandidate? {
        var best: UpdateCandidate?
        for r in releases where !r.draft && !r.prerelease && r.tag.hasPrefix(config.tagPrefix) {
            guard let v = SemVer(String(r.tag.dropFirst(config.tagPrefix.count))), v > current,
                  let asset = r.assets.first(where: { $0.name == "update.json" }),
                  asset.url.hasPrefix(config.downloadPrefix), let url = URL(string: asset.url) else { continue }
            if best == nil || v > best!.version { best = UpdateCandidate(version: v, tag: r.tag, manifestURL: url) }
        }
        return best
    }

    /// Nil when the manifest is fine for `candidate`; otherwise why not.
    public static func problem(with m: UpdateManifest, for candidate: UpdateCandidate, config: ReleaseConfig) -> String? {
        guard let v = SemVer(m.version), v == candidate.version else { return "update.json is for version \(m.version), not \(candidate.version)" }
        guard m.url.hasPrefix(config.downloadPrefix + candidate.tag + "/"), URL(string: m.url) != nil else { return "update.json points outside the release" }
        guard m.sha256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { return "update.json has no valid SHA-256" }
        guard m.size > 0, m.size <= maxBytes else { return "update.json has an unlikely size" }
        return nil
    }
}
