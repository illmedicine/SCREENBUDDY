import AppKit
import ScreenBuddyCore

/// Draws the current frame and turns the mouse into taps and drags.
///  - click: strike a pose
///  - drag: move the buddy (and make it walk)
///  - right-click / control-click: the menu
final class BuddyView: NSView {
    var bank: SpriteBank?
    var pick: FramePick?
    var lean: Double = 0
    var opacity: CGFloat = 1

    var onTap: (() -> Void)?
    /// Called while dragging with the vertical movement since the last event (points, positive = up).
    var onDrag: ((Double) -> Void)?
    var onDragEnd: (() -> Void)?

    private static let slop: CGFloat = 6
    private var downAt = NSPoint.zero
    private var originAtDown = NSPoint.zero
    private var lastY: CGFloat = 0
    private var dragging = false

    override var isFlipped: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var acceptsFirstResponder: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        guard let m = bank?.buddy.manifest, let pick, let img = bank?.frame(pick),
              let ctx = NSGraphicsContext.current?.cgContext else { return }
        let fit = BuddyLayout.fit(w: bounds.width, h: bounds.height, m)
        let rect = CGRect(x: fit.x, y: 0, width: fit.w, height: fit.h)     // standing on the bottom edge
        ctx.saveGState()
        ctx.setAlpha(opacity)
        ctx.interpolationQuality = .high
        // lean about the feet
        ctx.translateBy(x: rect.midX, y: 0)
        ctx.rotate(by: CGFloat(-lean * .pi / 180))
        ctx.translateBy(x: -rect.midX, y: 0)
        ctx.draw(img, in: rect)
        ctx.restoreGState()
    }

    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation
        lastY = downAt.y
        originAtDown = window?.frame.origin ?? .zero
        dragging = false
    }

    override func mouseDragged(with event: NSEvent) {
        let p = NSEvent.mouseLocation
        let dx = p.x - downAt.x, dy = p.y - downAt.y
        if !dragging {
            guard hypot(dx, dy) > Self.slop else { return }
            dragging = true
        }
        window?.setFrameOrigin(NSPoint(x: originAtDown.x + dx, y: originAtDown.y + dy))
        onDrag?(Double(p.y - lastY))
        lastY = p.y
    }

    override func mouseUp(with event: NSEvent) {
        if dragging { onDragEnd?() } else { onTap?() }
        dragging = false
    }
}
