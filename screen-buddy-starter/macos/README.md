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
- The screensaver, and the store for buying buddies.
- Clicks on the see-through part of the buddy's window are caught by the buddy instead of the window underneath.
- Signing with a Developer ID and notarising. Until then, the first launch on another Mac needs right-click, **Open**.

## Install

No administrator password is needed either way. The app goes into your own `~/Applications` folder (the same idea as the
Windows installer, which installs into your own `AppData`), so it can also update itself there.

- **Installer:** download `ScreenBuddy-Mac-Installer-<version>.pkg` from the website or the
  [Releases](https://github.com/illmedicine/SCREENBUDDY/releases) page (tags named `macos-v…`) and open it. It installs
  "for me only" and opens Screen Buddy at the end. The installer isn't signed or notarised yet, so the first time macOS
  may refuse to open it: open **System Settings > Privacy & Security**, scroll down and click **Open Anyway**.
- **Terminal, one line:** downloads the newest release, checks its SHA-256, installs it and opens it. Files that `curl`
  downloads aren't quarantined, so there's no Gatekeeper prompt.

  ```bash
  curl -fsSL https://raw.githubusercontent.com/illmedicine/SCREENBUDDY/main/screen-buddy-starter/macos/scripts/install.sh | bash
  ```

To uninstall: quit it from the menu-bar icon and drag `~/Applications/Screen Buddy.app` to the Trash. Your choices
stay in its preferences and your own buddies in `~/Library/Application Support/Screen Buddy`.

## Updates

Release builds keep themselves current, using the same rules as the Windows app:

- 30 seconds after start, then every 6 hours, if **Update automatically** is ticked (the default). **Check for
  updates** in the menu checks right away; the menu also shows the running version.
- `Contents/Resources/release.json` (only in release builds) names the repo. The app takes the highest
  `macos-v<version>` release that isn't a draft or pre-release and has an `update.json`. The version must match the
  tag, the zip must come from that release, and its size and SHA-256 must match before anything is replaced.
- It unpacks the zip in `~/Library/Caches/Screen Buddy/updates`, checks that it's Screen Buddy at that version, swaps the
  app bundle in place, quits and reopens, then says "updated to version X". If the app sits in a folder you can't write
  to (for example `/Applications` on a Mac where you aren't an administrator), it tells you to reinstall with the
  installer instead.
- Builds from source (`swift run`, `scripts/build_app.sh` without `RELEASE_REPO`) never update themselves.

### Cut a release

```bash
git tag macos-v0.1.0
git push origin macos-v0.1.0
```

`.github/workflows/macos.yml` runs the tests, builds the universal app with `release.json`, builds the installer
(`scripts/build_pkg.sh`), installs it as a normal user without `sudo`, self-tests the installed copy, writes `update.json`
and publishes the release with the installer, the zip and `update.json`. Every push to `main` runs the same steps
except the release.

## Build and run

Needs macOS 13+ and Xcode (or the command line tools).

```bash
cd screen-buddy-starter/macos
swift test                      # animator, manifest and library tests, plus every shipped buddy loads
swift run ScreenBuddy           # runs from source, using ../web/buddies
swift run ScreenBuddy --selftest   # decodes every buddy and exits, no window
scripts/build_app.sh            # dist/Screen Buddy.app and dist/ScreenBuddy-mac-<version>.zip (universal)
scripts/build_pkg.sh            # dist/ScreenBuddy-Mac-Installer-<version>.pkg (per-user, no password)
```

## Code

- `Sources/ScreenBuddyCore`: `BuddyManifest`, `BuddyAnimator` and `BuddyLibrary`. No UI. Ports of the Windows `ScreenBuddy.Core`
  with the same limits and the same animation rules.
- `Sources/ScreenBuddy`: `OverlayController` (the floating window and the timer), `BuddyView` (drawing, click and drag),
  `AppDelegate` (menu-bar icon and menus), `Updater` (self-update), `SpriteBank` (decodes the strips), `SelfTest`.
- `Sources/ScreenBuddyCore/Updates.swift`: version and release rules for self-update, tested without a network.
- `Tests/ScreenBuddyCoreTests`: XCTest.
