import AppKit
import ScreenBuddyCore

/// A window that never takes focus, so clicking the buddy does not pull you out of what you are typing.
final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Owns the floating buddy: the window, the sprites, the animator and the timer that drives them.
final class OverlayController {
    private static let steadyPxPerTick = 9.0      // about one frame every three ticks at 30 ticks a second
    private static let tickInterval = 1.0 / 30.0

    private(set) var settings = Settings()
    private(set) var buddy: Buddy?
    private var bank: SpriteBank?
    private var animator: BuddyAnimator?
    private let panel: OverlayPanel
    private let view = BuddyView()
    private var timer: Timer?

    let library: BuddyLibrary
    /// The menu that opens when the buddy is right-clicked.
    var contextMenu: NSMenu? { didSet { view.menu = contextMenu } }
    /// Called when something the menu shows has changed.
    var onChange: (() -> Void)?

    init(library: BuddyLibrary) {
        self.library = library
        panel = OverlayPanel(contentRect: NSRect(x: 0, y: 0, width: 200, height: 300),
                             styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.contentView = view

        view.onTap = { [weak self] in self?.pose() }
        view.onDrag = { [weak self] dy in self?.dragged(dy) }
        view.onDragEnd = { [weak self] in self?.savePosition() }
    }

    func start() {
        let all = library.list()
        select(all.first { $0.id == settings.buddyId } ?? all.first, keepPosition: settings.position != nil)
        apply()
    }

    // MARK: choices

    func select(_ b: Buddy?, keepPosition: Bool = true) {
        buddy = b
        guard let b else { bank = nil; animator = nil; return }
        settings.buddyId = b.id
        bank = SpriteBank(b)
        let bank = self.bank!
        animator = BuddyAnimator(b.manifest, ready: { bank.has($0) })
        view.bank = bank
        layout(keepPosition: keepPosition)
        refresh()
        ensureTimer()
        onChange?()
    }

    func setHeight(_ h: Double) { settings.height = h; layout(keepPosition: true); onChange?() }
    func setOpacity(_ o: Double) { settings.opacity = o; refresh(); onChange?() }
    func setMotion(_ m: Motion) { settings.motion = m; ensureTimer(); onChange?() }

    func setVisible(_ on: Bool) {
        settings.visible = on
        apply()
        onChange?()
    }

    func setPaused(_ on: Bool) {
        settings.paused = on
        if on { animator?.stop(); refresh() }
        ensureTimer()
        onChange?()
    }

    func resetPosition() {
        settings.position = nil
        layout(keepPosition: false)
    }

    func pose() {
        guard !settings.paused else { return }
        animator?.tap(now: now())
        ensureTimer()
    }

    // MARK: window

    private func apply() {
        if settings.visible && buddy != nil { panel.orderFrontRegardless() } else { panel.orderOut(nil) }
    }

    /// Sizes the window for the chosen height and puts it back where it was (or bottom-right).
    private func layout(keepPosition: Bool) {
        guard let m = buddy?.manifest else { return }
        let h = settings.height
        let w = BuddyLayout.windowWidth(height: h, m)
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var origin: NSPoint
        if keepPosition, let p = settings.position {
            origin = NSPoint(x: p.x, y: p.y)
        } else {
            origin = NSPoint(x: screen.maxX - w - 16, y: screen.minY + 8)
        }
        // keep it on a screen that still exists
        let union = NSScreen.screens.map(\.visibleFrame).reduce(NSRect.null) { $0.union($1) }
        if !union.isNull {
            origin.x = min(max(origin.x, union.minX), max(union.minX, union.maxX - w))
            origin.y = min(max(origin.y, union.minY), max(union.minY, union.maxY - h))
        }
        panel.setFrame(NSRect(x: origin.x, y: origin.y, width: w, height: h), display: true)
        view.needsDisplay = true
    }

    private func savePosition() {
        let o = panel.frame.origin
        settings.position = (Double(o.x), Double(o.y))
    }

    // MARK: animation

    private func now() -> Int64 { Int64(ProcessInfo.processInfo.systemUptime * 1000) }

    private func dragged(_ dy: Double) {
        guard !settings.paused else { return }
        animator?.scrub(dy, now: now())
        ensureTimer()
        refresh()
    }

    private func refresh() {
        guard let a = animator else { return }
        view.pick = a.frame
        view.lean = a.lean
        view.opacity = CGFloat(settings.opacity)
        view.needsDisplay = true
    }

    private var needsTimer: Bool {
        guard let a = animator, !settings.paused else { return false }
        return a.animating || settings.motion == .steady
    }

    private func ensureTimer() {
        if needsTimer {
            guard timer == nil else { return }
            let t = Timer(timeInterval: Self.tickInterval, repeats: true) { [weak self] _ in self?.tick() }
            RunLoop.main.add(t, forMode: .common)
            timer = t
        } else {
            timer?.invalidate()
            timer = nil
        }
    }

    private func tick() {
        guard let a = animator else { return }
        let t = now()
        if settings.motion == .steady && !a.posing { a.scrub(Self.steadyPxPerTick, now: t) }
        a.update(now: t)
        refresh()
        if !needsTimer { ensureTimer() }
    }
}
