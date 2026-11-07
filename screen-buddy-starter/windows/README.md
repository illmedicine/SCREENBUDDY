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
- Tray icon: show/hide, pause, switch buddy, size, transparency, stand on the bottom edge, add/remove buddies, start with Windows.
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

`dotnet test` covers the shared logic (manifest validation, animator, layout, zip import safety, settings): 38 tests.
`--selftest` decodes every bundled buddy, renders its standing frame and a pose over a grey backdrop to `out.png`, and exits
non-zero if anything fails to load or draw.

The overlay window, tray menu and screensaver are not covered by automated tests; check them by eye.

## Layout

- `src/ScreenBuddy.Core`: manifest, animator, library, settings. No UI, no Windows dependencies. Mirrors the Kotlin and JavaScript versions.
- `src/ScreenBuddy.App`: WPF app. SkiaSharp decodes the WebP strips (Windows has no built-in WebP codec).
- `tests/ScreenBuddy.Core.Tests`: xUnit.
