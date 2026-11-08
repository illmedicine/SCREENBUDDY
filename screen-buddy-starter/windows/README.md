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
- Tray icon: show/hide, pause, switch buddy, movement, size, transparency, stand on the bottom edge, add/remove buddies, start with Windows.
- **Movement** (tray menu): *Only when I touch it* (default), *Steady* (walks in place all the time), *When I type* (moves while keys are pressed anywhere in Windows, stops about 0.7 s after you stop), *When there's sound* (moves while the microphone hears sound, stops in silence).
  - Typing uses a keyboard hook that only learns that *a* key went down. It never reads which key, and stores and sends nothing. Some security tools flag any keyboard hook; it is only installed while "When I type" is selected.
  - Sound opens the default microphone and keeps only a loudness number; the audio is discarded immediately. The sensitivity follows the room (it measures the background for the first 0.6 s, so start it in a quiet moment), a fan or hum isn't "sound", and a click or pop is ignored. If the buddy never reacts, check Settings > Privacy & security > Microphone > "Let desktop apps access your microphone" (the app warns you after 6 s of pure silence).
- Settings live in `%LOCALAPPDATA%\ScreenBuddy\settings.json`, imported buddies in `%LOCALAPPDATA%\ScreenBuddy\buddies`.
- Crashes in the UI are logged to `%LOCALAPPDATA%\ScreenBuddy\error.log`.

## Screensaver

`scripts/install-screensaver.ps1` publishes a copy into your profile and registers `ScreenBuddy.scr` for your user only
(`-Uninstall` removes it). Command-line modes: `/s` run, `/c` settings note, `/p` preview pane (draws nothing).
Any key, click or mouse movement ends it.

## Tests

```
dotnet test
dotnet run --project src/ScreenBuddy.App -- --selftest out.png
```

`dotnet test` covers the shared logic (manifest validation, animator, layout, zip import safety, settings, movement gates, billing wallet): 73 tests.
`--motiontest` installs the real keyboard hook, presses the unused F24 key and checks the buddy starts and stops in typing and steady modes (it does not touch the microphone).
`--selftest` decodes every bundled buddy, renders its standing frame and a pose over a grey backdrop to `out.png`, and exits
non-zero if anything fails to load or draw.

The overlay window, tray menu, store window and screensaver are not covered by automated tests; check them by eye.

## Layout

- `src/ScreenBuddy.Core`: manifest, animator, library, settings. No UI, no Windows dependencies. Mirrors the Kotlin and JavaScript versions.
- `src/ScreenBuddy.Core/Billing`: price list and wallet, the same engine as the web and Android apps (see `../billing/README.md`).
- `src/ScreenBuddy.App`: WPF app. `Payments.cs` is where PayPal goes; `StoreWindow.cs` is the tray's *Make your own buddies...* window (Debug builds make test payments). SkiaSharp decodes the WebP strips (Windows has no built-in WebP codec).
- `tests/ScreenBuddy.Core.Tests`: xUnit.
