# Screen Buddy branding

`screen-buddy-art.webp` is the master logo artwork: a glass phone glowing teal on deep indigo, with a character stepping
out of its screen as a hologram. Every app icon is generated from it.

## Static icons (app stores, launchers, installers)

Operating systems don't animate app icons, so these use the artwork as it is. The square crop keeps the phone and
character and drops the wordmark, which can't be read at icon sizes. At 32 px and below, a closer crop of the
character's upper body is used.

```
python tools/make_icons.py      # from screen-buddy-starter/, needs Pillow
```

| Platform | Output |
|---|---|
| Windows | `windows/src/ScreenBuddy.App/app.ico` (exe, Setup wizard, taskbar, shortcuts, still tray icon) |
| Android | `android/app/src/main/res/mipmap-*` (adaptive icon on Android 8+, round and legacy PNGs); the status-bar icon is the white silhouette `drawable/ic_stat_buddy.xml` |
| Mac | `macos/Resources/AppIcon.icns`, copied into the bundle by `scripts/build_app.sh` |
| Web | `web/favicon.ico`, `web/icons/` (home screen, PWA, Apple touch) |

For new artwork, replace the file (ideally a square of 1024 px or larger), check the `CROP` and `CLOSE` boxes at the
top of the script, and run it again.

## The animated mark

Where we draw the icon ourselves, it animates. Each buddy takes a turn rising out of the phone, with a hologram
scan-line shimmer while it materialises and sparkles around it. Every buddy in the library joins the rotation, so new
characters appear automatically.

- **Web:** the header logo and the browser-tab favicon (`web/js/holo-logo.js`). It holds still on one buddy when the
  visitor has "reduce motion" turned on.
- **Windows:** the tray icon (`TrayAnimator` in `windows/src/ScreenBuddy.App/TrayIcon.cs`). It stays on the still icon
  when Windows animation effects are turned off. `ScreenBuddy.exe --selftest out.png` also writes `out-tray.png` with
  every buddy's tray frames.

Both cut each buddy's standing frame to head-and-waist the same way (`bustRect` in JS, `BrandMark.BustRect` in C#).
