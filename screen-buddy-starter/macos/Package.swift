// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ScreenBuddy",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "ScreenBuddy", targets: ["ScreenBuddy"])],
    targets: [
        // Buddy files, the animator and the library. No UI, so it is easy to test.
        .target(name: "ScreenBuddyCore"),
        // The menu-bar app and the floating overlay.
        .executableTarget(name: "ScreenBuddy", dependencies: ["ScreenBuddyCore"]),
        .testTarget(name: "ScreenBuddyCoreTests", dependencies: ["ScreenBuddyCore"]),
    ]
)
