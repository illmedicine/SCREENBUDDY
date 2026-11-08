# Screen Buddy for Mac

A menu-bar app (no Dock icon) that floats a buddy over your windows. Same buddy files as the web player, Android and
Windows: the sample buddies are the ones in `../web/buddies`, so a character published with `tools/publish_buddy.py`
reaches the Mac app on its next build.

**Status: first slice.** It builds and tests on GitHub's Mac servers, but nobody has run it on a real Mac yet. Treat it as
a prototype until it has been tried by hand.

## What works

- A transparent, always-on-top buddy that stays on every Space and over full-screen apps, and never takes focus.
- Click it for a pose. Drag it to move it (it walks while you drag). Right-click for the menu.
- Menu-bar icon with: show/hide, strike a pose, pause, choose a buddy, size, transparency, "only when I touch it" or
  "steadily", reset position, open your buddies folder.
- Your own buddies: drop a buddy folder into `~/Library/Application Support/Screen Buddy/buddies/` (same package format
  as everywhere else; it is checked with the same rules as on the other platforms).
- Choices are remembered between runs.

## Not yet

- Moving while you type or when there is sound (the Windows app has these). They need the Accessibility and Microphone
  permissions, so they come after the basics are proven.
- The screensaver, the store and buying buddies, and self-update.
- Clicks on the see-through part of the buddy's window are caught by the buddy instead of the window underneath.
- Signing with a Developer ID and notarising. Until then, the first launch on another Mac needs right-click, **Open**.

## Build and run

Needs macOS 13+ and Xcode (or the command line tools).

```bash
cd screen-buddy-starter/macos
swift test                      # animator, manifest and library tests, plus every shipped buddy loads
swift run ScreenBuddy           # runs from source, using ../web/buddies
swift run ScreenBuddy --selftest   # decodes every buddy and exits, no window
scripts/build_app.sh            # dist/Screen Buddy.app and dist/ScreenBuddy-mac-<version>.zip (universal)
```

## Code

- `Sources/ScreenBuddyCore`: `BuddyManifest`, `BuddyAnimator` and `BuddyLibrary`. No UI. Ports of the Windows `ScreenBuddy.Core`
  with the same limits and the same animation rules.
- `Sources/ScreenBuddy`: `OverlayController` (the floating window and the timer), `BuddyView` (drawing, click and drag),
  `AppDelegate` (menu-bar icon and menus), `SpriteBank` (decodes the strips), `SelfTest`.
- `Tests/ScreenBuddyCoreTests`: XCTest.

## Releases

`.github/workflows/macos.yml` builds and tests on every change. Pushing a tag such as `macos-v0.1.0` also publishes the zip
as a GitHub Release. It is marked "not latest" so the Windows release stays what the website's download link points at.
