import Foundation

/// A buddy on disk: a folder holding manifest.json, face.webp and the strips.
public struct Buddy {
    public let manifest: BuddyManifest
    public let directory: URL
    public var id: String { manifest.id }

    /// URL of a file the manifest named. File names were validated by the manifest, so they stay inside the folder.
    public func url(_ fileName: String) -> URL { directory.appendingPathComponent(fileName) }
}

/// The library: sample buddies shipped inside the app (`buddies/<id>/`) plus buddies the user dropped into
/// `~/Library/Application Support/Screen Buddy/buddies/`.
public struct BuddyLibrary {
    public static let maxFiles = 40
    public static let maxFileBytes = 8 * 1024 * 1024

    private let roots: [URL]
    private let hidden: () -> Set<String>

    /// - Parameter hidden: ids the website admin hid (see `HiddenBuddies`); read on every `list()`, so a change
    ///   applies straight away.
    public init(roots: [URL], hidden: @escaping () -> Set<String> = { [] }) {
        self.roots = roots
        self.hidden = hidden
    }

    /// Every valid buddy that isn't hidden. A broken folder is skipped. The first root wins when two folders share an id.
    public func list() -> [Buddy] {
        let hiddenIds = hidden()
        var seen = Set<String>()
        var out: [Buddy] = []
        let fm = FileManager.default
        for root in roots {
            let dirs = ((try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])) ?? [])
                .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
            for dir in dirs {
                guard let buddy = Self.load(dir), seen.insert(buddy.id).inserted else { continue }
                if hiddenIds.contains(buddy.id) { continue }
                out.append(buddy)
            }
        }
        return out
    }

    /// Reads and checks one folder: valid manifest, every file it names present, small, and a real WebP image.
    public static func load(_ dir: URL) -> Buddy? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(BuddyManifest.fileName)),
              let m = try? BuddyManifest.parse(data) else { return nil }
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        guard files.count <= maxFiles else { return nil }
        let named = Set(m.clips.values.map(\.src)).union([m.face])
        for name in named {
            let url = dir.appendingPathComponent(name)
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                  let size = attrs[.size] as? Int, size <= maxFileBytes,
                  let head = try? FileHandle(forReadingFrom: url).read(upToCount: 12),
                  head.count == 12, head.prefix(4) == Data("RIFF".utf8), head.suffix(4) == Data("WEBP".utf8)
            else { return nil }
        }
        return Buddy(manifest: m, directory: dir)
    }
}
