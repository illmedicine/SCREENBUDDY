import AppKit
import ScreenBuddyCore

/// A menu item that runs a closure.
final class BlockItem: NSMenuItem {
    private let block: () -> Void
    init(_ title: String, checked: Bool = false, _ block: @escaping () -> Void) {
        self.block = block
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
        state = checked ? .on : .off
    }
    required init(coder: NSCoder) { fatalError("not used") }
    @objc private func fire() { block() }
}

/// The menu-bar icon and its menu. The same menu opens when you right-click the buddy.
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var overlay: OverlayController!
    private var updater: Updater!

    func applicationDidFinishLaunching(_ notification: Notification) {
        overlay = OverlayController(library: makeLibrary())
        overlay.start()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            let icon = NSImage(systemSymbolName: "figure.dance", accessibilityDescription: "Screen Buddy")
            icon?.isTemplate = true
            if let icon { button.image = icon } else { button.title = "SB" }
        }
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        let context = NSMenu()
        context.delegate = self
        overlay.contextMenu = context

        updater = Updater()
        updater.start()
    }

    func menuNeedsUpdate(_ menu: NSMenu) { fill(menu) }

    private func fill(_ menu: NSMenu) {
        menu.removeAllItems()
        let o: OverlayController = overlay
        let s = o.settings

        menu.addItem(BlockItem("Show buddy", checked: s.visible) { [o] in o.setVisible(!s.visible) })
        menu.addItem(BlockItem("Strike a pose") { [o] in o.pose() })
        menu.addItem(BlockItem("Pause", checked: s.paused) { [o] in o.setPaused(!s.paused) })
        menu.addItem(.separator())

        let buddies = NSMenu()
        for b in o.library.list() {
            buddies.addItem(BlockItem(b.manifest.name, checked: b.id == o.buddy?.id) { [o] in o.select(b) })
        }
        menu.addItem(submenu("Buddy", buddies))

        let sizes = NSMenu()
        for (title, h) in [("Small", 160.0), ("Medium", 240.0), ("Large", 340.0), ("Huge", 480.0)] {
            sizes.addItem(BlockItem(title, checked: s.height == h) { [o] in o.setHeight(h) })
        }
        menu.addItem(submenu("Size", sizes))

        let see = NSMenu()
        for pct in [100, 80, 60, 40] {
            see.addItem(BlockItem("\(pct)%", checked: Int((s.opacity * 100).rounded()) == pct) { [o] in
                o.setOpacity(Double(pct) / 100)
            })
        }
        menu.addItem(submenu("Transparency", see))

        let moves = NSMenu()
        moves.addItem(BlockItem("Only when I touch it", checked: s.motion == .touch) { [o] in o.setMotion(.touch) })
        moves.addItem(BlockItem("Steadily", checked: s.motion == .steady) { [o] in o.setMotion(.steady) })
        menu.addItem(submenu("Moves", moves))

        menu.addItem(BlockItem("Reset position") { [o] in o.resetPosition() })
        menu.addItem(.separator())
        menu.addItem(BlockItem("Open my buddies folder") {
            let dir = userBuddiesFolder()
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            NSWorkspace.shared.open(dir)
        })
        menu.addItem(.separator())
        let u: Updater = updater
        let version = NSMenuItem(title: u.versionText, action: nil, keyEquivalent: "")
        version.isEnabled = false
        menu.addItem(version)
        menu.addItem(BlockItem(u.busy ? "Checking for updates..." : "Check for updates") { [u] in u.check(userAsked: true) })
        if u.enabled {
            menu.addItem(BlockItem("Update automatically", checked: u.automatic) { [u] in u.automatic.toggle() })
        }
        menu.addItem(BlockItem("Quit Screen Buddy") { NSApp.terminate(nil) })
    }

    private func submenu(_ title: String, _ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }
}

/// `~/Library/Application Support/Screen Buddy/buddies`: buddies the user added by hand.
func userBuddiesFolder() -> URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Screen Buddy/buddies", isDirectory: true)
}

/// The sample buddies that ship inside the app. When run from source (`swift run`), falls back to the web player's folder.
func bundledBuddiesFolder() -> URL? {
    let fm = FileManager.default
    var candidates: [URL] = []
    if let i = CommandLine.arguments.firstIndex(of: "--buddies"), i + 1 < CommandLine.arguments.count {
        candidates.append(URL(fileURLWithPath: CommandLine.arguments[i + 1]))
    }
    if let r = Bundle.main.resourceURL { candidates.append(r.appendingPathComponent("buddies", isDirectory: true)) }
    let cwd = URL(fileURLWithPath: fm.currentDirectoryPath)
    candidates.append(cwd.appendingPathComponent("../web/buddies"))
    candidates.append(cwd.appendingPathComponent("web/buddies"))
    return candidates.first {
        var isDir: ObjCBool = false
        return fm.fileExists(atPath: $0.path, isDirectory: &isDir) && isDir.boolValue
    }
}

func makeLibrary() -> BuddyLibrary {
    BuddyLibrary(roots: [bundledBuddiesFolder(), userBuddiesFolder()].compactMap { $0 })
}
