import AppKit
import CryptoKit
import ScreenBuddyCore

/// Keeps a release build current, like the Windows app: 30 s after start and every 6 hours (if "Update automatically"
/// is on), or when the user picks "Check for updates". It downloads the new zip from the GitHub Release, checks its size
/// and SHA-256, unpacks it, swaps the app bundle in place and relaunches. Nothing needs an administrator password,
/// because the installer puts the app in the user's own ~/Applications.
///
/// Builds without Contents/Resources/release.json (`swift run`, scripts/build_app.sh without RELEASE_REPO) never update.
@MainActor
final class Updater {
    private let defaults = UserDefaults.standard
    let current: SemVer? = SemVer(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
    private let config: ReleaseConfig? = Bundle.main.url(forResource: "release", withExtension: "json")
        .flatMap { try? Data(contentsOf: $0) }.flatMap(ReleaseConfig.parse)
    private var timer: Timer?
    private(set) var busy = false

    var enabled: Bool { config != nil && current != nil && Bundle.main.bundleURL.pathExtension == "app" }
    var versionText: String { current.map { "Version \($0)" } ?? "Development build" }

    var automatic: Bool {
        get { defaults.object(forKey: "autoUpdate") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "autoUpdate") }
    }

    func start() {
        announceIfJustUpdated()
        guard enabled else { return }
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 30_000_000_000)
            if self?.automatic == true { self?.check(userAsked: false) }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in
            Task { @MainActor in if self?.automatic == true { self?.check(userAsked: false) } }
        }
    }

    func check(userAsked: Bool) {
        guard enabled, let config, let current else {
            if userAsked { tell("This copy was built from source, so it doesn't update itself. Install Screen Buddy with the installer to get updates.") }
            return
        }
        guard !busy else { if userAsked { tell("Already checking for updates.") }; return }
        busy = true
        Task {
            do {
                let installed = try await Self.update(config: config, current: current)
                busy = false
                if let v = installed { relaunch(after: v) }
                else if userAsked { tell("Screen Buddy is up to date (version \(current)).") }
            } catch {
                busy = false
                if userAsked { tell("Couldn't update: \(error.localizedDescription)") }
            }
        }
    }

    // ---- the work, off the main thread ------------------------------------------------------------------------

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ m: String) { errorDescription = m }
    }

    /// Returns the installed version, or nil when already up to date.
    private nonisolated static func update(config: ReleaseConfig, current: SemVer) async throws -> SemVer? {
        let api = URL(string: "https://api.github.com/repos/\(config.repo)/releases?per_page=30")!
        let releases = try JSONDecoder().decode([GitHubRelease].self, from: try await get(api))
        guard let c = Updates.pick(releases, config: config, current: current) else { return nil }
        let m = try JSONDecoder().decode(UpdateManifest.self, from: try await get(c.manifestURL))
        if let p = Updates.problem(with: m, for: c, config: config) { throw Failure(p) }

        let fm = FileManager.default
        let work = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Screen Buddy/updates", isDirectory: true)
        try? fm.removeItem(at: work)
        try fm.createDirectory(at: work, withIntermediateDirectories: true)

        var req = URLRequest(url: URL(string: m.url)!)
        req.setValue("ScreenBuddy-mac", forHTTPHeaderField: "User-Agent")
        let (tmp, resp) = try await URLSession.shared.download(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw Failure("the download failed") }
        let zip = work.appendingPathComponent("update.zip")
        try fm.moveItem(at: tmp, to: zip)
        let data = try Data(contentsOf: zip)
        guard Int64(data.count) == m.size else { throw Failure("the download is the wrong size") }
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard hash == m.sha256 else { throw Failure("the download didn't match its checksum") }

        let staged = work.appendingPathComponent("staged", isDirectory: true)
        try run("/usr/bin/ditto", ["-x", "-k", zip.path, staged.path])
        let newApp = staged.appendingPathComponent("Screen Buddy.app", isDirectory: true)
        guard let info = Bundle(url: newApp)?.infoDictionary,
              info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
              (info["CFBundleShortVersionString"] as? String).flatMap(SemVer.init) == c.version else {
            throw Failure("the downloaded app isn't Screen Buddy \(c.version)")
        }

        // Swap the bundle in place. The running copy keeps working from memory until it quits.
        let target = Bundle.main.bundleURL
        let parent = target.deletingLastPathComponent()
        guard fm.isWritableFile(atPath: parent.path) else {
            throw Failure("Screen Buddy is in \(parent.path), which you can't change. Install it again with the installer, which puts it in your own Applications folder.")
        }
        _ = try fm.replaceItemAt(target, withItemAt: newApp)
        try? fm.removeItem(at: work)
        return c.version
    }

    private nonisolated static func get(_ url: URL) async throws -> Data {
        var req = URLRequest(url: url)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("ScreenBuddy-mac", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw Failure("GitHub couldn't be reached") }
        return data
    }

    private nonisolated static func run(_ tool: String, _ args: [String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        try p.run()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw Failure("couldn't unpack the update") }
    }

    // ---- after the swap ---------------------------------------------------------------------------------------

    /// Starts the new copy once this one has quit, then quits.
    private func relaunch(after version: SemVer) {
        defaults.set(version.description, forKey: "justUpdatedTo")
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "while /bin/kill -0 \"$1\" 2>/dev/null; do /bin/sleep 0.2; done; /usr/bin/open \"$2\"",
                       "sh", String(ProcessInfo.processInfo.processIdentifier), Bundle.main.bundleURL.path]
        do { try p.run() } catch {
            tell("Screen Buddy \(version) is installed. Quit and open it again to use it.")
            return
        }
        NSApp.terminate(nil)
    }

    private func announceIfJustUpdated() {
        guard let v = defaults.string(forKey: "justUpdatedTo") else { return }
        defaults.removeObject(forKey: "justUpdatedTo")
        if v == current?.description { tell("Screen Buddy updated to version \(v).") }
    }

    private func tell(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Screen Buddy"
        a.informativeText = message
        a.runModal()
    }
}
