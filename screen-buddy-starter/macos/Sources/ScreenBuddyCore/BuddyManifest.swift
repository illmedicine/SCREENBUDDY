import Foundation

/// One move: `n` frames laid out side by side in the strip file `src`.
public struct Clip: Equatable {
    public let n: Int
    public let src: String
}

public struct InvalidBuddy: Error, Equatable, CustomStringConvertible {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var description: String { message }
}

/// Describes a buddy package. The same rules as the Windows app, the Android app and the web player, so one package
/// works everywhere. Packages can come from anyone, so nothing in a manifest may name a file outside the package.
public struct BuddyManifest: Equatable {
    public static let fileName = "manifest.json"

    public let id: String
    public let name: String
    public let author: String
    public let version: Int
    public let from: String
    public let cw: Int
    public let ch: Int
    public let fps: Int
    public let standClip: String
    public let standFrame: Int
    public let scroll: String
    public let poses: [String]
    public let face: String
    public let clips: [String: Clip]

    private static func matches(_ pattern: String, _ s: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }
    private static func isId(_ s: String) -> Bool { matches("^[a-z0-9][a-z0-9_-]{0,63}$", s) }
    private static func isMove(_ s: String) -> Bool { matches("^[A-Za-z0-9_-]{1,32}$", s) }
    private static func isFile(_ s: String) -> Bool { matches("^[A-Za-z0-9_-]{1,64}\\.webp$", s) }

    private static func text(_ o: [String: Any], _ key: String) throws -> String {
        guard let v = o[key] as? String, !v.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw InvalidBuddy("Missing \(key)")
        }
        return v
    }

    private static func int(_ o: [String: Any], _ key: String, _ lo: Int, _ hi: Int, _ what: String) throws -> Int {
        // JSONSerialization hands numbers back as NSNumber; booleans are NSNumber too and must not count.
        guard let n = o[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              n.doubleValue == n.doubleValue.rounded(), n.intValue >= lo, n.intValue <= hi else {
            throw InvalidBuddy("Bad \(what)")
        }
        return n.intValue
    }

    public static func parse(_ data: Data) throws -> BuddyManifest {
        guard let root = try? JSONSerialization.jsonObject(with: data), let o = root as? [String: Any] else {
            throw InvalidBuddy("Not a valid buddy manifest")
        }
        let id = try text(o, "id")
        guard isId(id) else { throw InvalidBuddy("Bad id '\(id)'") }

        guard let clipsJson = o["clips"] as? [String: Any] else { throw InvalidBuddy("Missing clips") }
        var clips: [String: Clip] = [:]
        for (name, value) in clipsJson {
            guard isMove(name) else { throw InvalidBuddy("Bad move name '\(name)'") }
            guard let c = value as? [String: Any] else { throw InvalidBuddy("Bad clip '\(name)'") }
            let src = try text(c, "src")
            guard isFile(src) else { throw InvalidBuddy("Bad clip file '\(src)'") }
            clips[name] = Clip(n: try int(c, "n", 1, 400, "frame count of '\(name)'"), src: src)
        }
        func known(_ name: Any?) throws -> String {
            guard let s = name as? String, clips[s] != nil else { throw InvalidBuddy("Unknown move '\(name ?? "")'") }
            return s
        }

        guard let stand = o["stand"] as? [Any], stand.count == 2 else { throw InvalidBuddy("Bad stand") }
        let standClip = try known(stand[0])
        guard let sf = stand[1] as? NSNumber, CFGetTypeID(sf) != CFBooleanGetTypeID(),
              sf.intValue >= 0, sf.intValue < clips[standClip]!.n else {
            throw InvalidBuddy("Stand frame is outside '\(standClip)'")
        }
        let scroll = try known(o["scroll"])
        guard let posesJson = o["poses"] as? [Any] else { throw InvalidBuddy("Bad poses") }
        let poses = try posesJson.map { try known($0) }
        let face = try text(o, "face")
        guard isFile(face) else { throw InvalidBuddy("Bad face file '\(face)'") }

        let name = try text(o, "name")
        let cw = try int(o, "cw", 16, 2048, "cell width")
        let ch = try int(o, "ch", 16, 2048, "cell height")
        let fps = try (o["fps"] == nil ? 10 : int(o, "fps", 1, 60, "fps"))
        return BuddyManifest(
            id: id, name: name,
            author: o["author"] as? String ?? "",
            version: (o["version"] as? NSNumber)?.intValue ?? 1,
            from: o["from"] as? String ?? "",
            cw: cw, ch: ch, fps: fps,
            standClip: standClip, standFrame: sf.intValue, scroll: scroll, poses: poses, face: face, clips: clips)
    }
}
