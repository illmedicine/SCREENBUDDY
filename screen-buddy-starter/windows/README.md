# Screen Buddy for Windows

The desktop equivalent of the Android app: your buddy floats over everything on your desktop, and the same program is a
Windows screensaver. Native .NET 8 / WPF, no browser needed.

| Android | Windows |
|---|---|
| Floating overlay | Transparent always-on-top window. Only the buddy's own pixels take clicks; the rest of the desktop is untouched. |
| Pause / transparency / size | Tray icon menu (right-click the buddy or the tray icon). |
| Live wallpaper / screensaver | Screensaver mode: the buddy walks across the primary screen, other monitors stay black. |
| Import buddy | "Add a buddy (.zip)" in the tray menu. Same package format and safety checks as Android and web. |

## Use it

Needs the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) to build.

```
dotnet run --project src/ScreenBuddy.App
```

- Click the buddy: it strikes a pose. Drag it: it walks as you move it. Right-click or long-press: menu.
- Tray icon: show/hide, pause, switch buddy, movement, size, transparency, stand on the bottom edge, add/remove buddies, start with Windows,
  desktop shortcut, check for updates, update automatically.
- **Movement** (tray menu): *Only when I touch it* (default), *Steady* (walks in place all the time), *When I type* (moves while keys are pressed anywhere in Windows, stops about 0.7 s after you stop), *When there's sound* (moves while the microphone hears sound, stops in silence).
  - Typing uses a keyboard hook that only learns that *a* key went down. It never reads which key, and stores and sends nothing. Some security tools flag any keyboard hook; it is only installed while "When I type" is selected.
  - Sound opens the default microphone and keeps only a loudness number; the audio is discarded immediately. The sensitivity follows the room (it measures the background for the first 0.6 s, so start it in a quiet moment), a fan or hum isn't "sound", and a click or pop is ignored. If the buddy never reacts, check Settings > Privacy & security > Microphone > "Let desktop apps access your microphone" (the app warns you after 6 s of pure silence).
- Settings live in `%LOCALAPPDATA%\ScreenBuddy\settings.json`, imported buddies in `%LOCALAPPDATA%\ScreenBuddy\buddies`.
- Crashes in the UI are logged to `%LOCALAPPDATA%\ScreenBuddy\error.log`.

## Install a release

Download `ScreenBuddy-win-x64-<version>.zip` from the repository's
[Releases](https://github.com/illmedicine/SCREENBUDDY/releases) page (tags named `windows-v…`). Unzip it into a folder you
own, such as `%LOCALAPPDATA%\Programs\ScreenBuddy`, and run `ScreenBuddy.exe`. It is self-contained, so no .NET install
is needed. Don't put it under `Program Files`: the app updates itself in place and needs to be able to write there.

The first time a release build runs, it adds a **Screen Buddy** shortcut to your desktop and Start menu, so you can start
it again after *Exit*. *Desktop shortcut* in the tray menu adds or removes the desktop one. A shortcut you delete stays
deleted, and if you move the folder, the next start re-points the remaining shortcuts. Starting Screen Buddy while it's
already running shows the buddy (and un-pauses it) instead of opening a second copy.

## Updates

Release builds keep themselves current. New built-in buddies ship inside the app (`buddies/<id>/`), so a new release
also delivers new characters.

- **When:** 30 seconds after start, then every 6 hours while it runs, if *Update automatically* is ticked (the default).
  You can also pick *Check for updates* from the tray menu at any time. Its tooltip shows the running version.
- **Where it looks:** `release.json` next to the exe names the GitHub repo and tag prefix. The app lists that repo's
  releases through the GitHub API and takes the highest `windows-v<version>` release that is not a draft or
  pre-release and has an `update.json` asset. Releases for other platforms, such as Android, are ignored.
- **What it checks:** `update.json` holds `version`, `url`, `size` and `sha256`. The version must match the release tag,
  and the URL must be `https://github.com/…`. The zip goes to `%LOCALAPPDATA%\ScreenBuddy\updates` and is only used if
  its size and SHA-256 match.
- **How it swaps:** a running exe can't overwrite itself, so the app unpacks the new version to
  `updates\staged\<version>` and starts *that* copy with `--apply-update <install folder> <pid>`, then exits. The new copy
  waits for the old process to exit, moves the old files into a backup folder inside the install folder, copies itself
  in, and starts the updated app, which reports "Updated to version X". If any copy fails, the backup is moved back
  and the old version starts again with a warning. A `ScreenBuddy.scr` screensaver copy in the install folder is kept
  and refreshed.
- **What survives:** everything in `%LOCALAPPDATA%\ScreenBuddy` (settings, window position, imported buddies, the
  update preference in `updates.json`). None of it lives in the install folder.
- **Dev builds don't update.** `dotnet run`, `dotnet publish` and `scripts/install-screensaver.ps1` don't write
  `release.json`, so those copies never replace themselves. *Check for updates* says so.

Keep the `--apply-update <install folder> <pid>` arguments stable: an older installed version uses them to start the
newer one.

### Cut a release

1. Make sure `dotnet test` passes and the new buddies are in `src/ScreenBuddy.App/buddies/`.
2. Pick a version higher than the last `windows-v…` tag (`major.minor.patch`). The tag sets the app version, so the
   `<Version>` in the csproj is only the default for dev builds. Bumping it to match keeps things tidy.
3. Tag the commit and push the tag:

   ```
   git tag windows-v1.2.0
   git push origin windows-v1.2.0
   ```

4. `.github/workflows/windows-release.yml` runs on Windows. It runs the tests, publishes a self-contained win-x64 build
   with that version, writes `release.json` into it, runs `--selftest` on the published exe, zips it, writes
   `update.json` with the zip's size and SHA-256, and creates the GitHub Release with both files attached.
5. Installed copies pick it up at their next check. To verify, run an older release and use *Check for updates*.

To pull a bad release, delete it or mark it as a pre-release. Clients only ever move forward, so the fix is a new,
higher version. The repo's Actions settings must allow the workflow token to write (`contents: write` is set in the
workflow).

## Screensaver

`scripts/install-screensaver.ps1` publishes a copy into your profile and registers `ScreenBuddy.scr` for your user only
(`-Uninstall` removes it). Command-line modes: `/s` run, `/c` settings note, `/p` preview pane (draws nothing).
Any key, click or mouse movement ends it. To use a release build as the screensaver, copy its `ScreenBuddy.exe` to
`ScreenBuddy.scr` in the same folder and register it the way the script does (it sets `SCRNSAVE.EXE` under
`HKCU\Control Panel\Desktop`). Updates keep that copy current.

## Tests

```
dotnet test
dotnet run --project src/ScreenBuddy.App -- --selftest out.png
```

`dotnet test` covers the shared logic: manifest validation, animator, layout, zip import safety, settings, movement
gates, and for updates, version ordering, `update.json`/`release.json` parsing, release selection and the
install-folder swap with rollback.
`--motiontest` installs the real keyboard hook, presses the unused F24 key and checks the buddy starts and stops in typing and steady modes (it does not touch the microphone).
`--selftest` decodes every bundled buddy, renders its standing frame and a pose over a grey backdrop to `out.png`, and exits
non-zero if anything fails to load or draw.

The overlay window, tray menu and screensaver are not covered by automated tests; check them by eye.

## Layout

- `src/ScreenBuddy.Core`: manifest, animator, library, settings. No UI, no Windows dependencies. Mirrors the Kotlin and JavaScript versions.
- `src/ScreenBuddy.App`: WPF app. SkiaSharp decodes the WebP strips (Windows has no built-in WebP codec).
- `tests/ScreenBuddy.Core.Tests`: xUnit.
