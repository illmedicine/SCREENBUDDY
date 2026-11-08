import AppKit

// `ScreenBuddy --selftest` checks every buddy without opening any window, so a build can be verified on a server.
if CommandLine.arguments.contains("--selftest") {
    exit(SelfTest.run())
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)        // menu-bar app: no Dock icon
let delegate = AppDelegate()
app.delegate = delegate
app.run()
