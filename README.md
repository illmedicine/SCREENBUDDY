# Screen Buddy

Turn a short video of you into a realistic, transparent, animated character that lives on your phone.

| Folder | What it is |
|---|---|
| [`screen-buddy-starter/android`](screen-buddy-starter/android) | **The app.** Native Android (Kotlin, Jetpack Compose). Floating overlay, live wallpaper, screensaver. This is the main product. |
| [`screen-buddy-starter/windows`](screen-buddy-starter/windows) | The desktop version. Native .NET/WPF: tray app with a floating overlay across the whole desktop, plus a Windows screensaver. |
| [`screen-buddy-starter/web`](screen-buddy-starter/web) | A separate web player for prototype testing and, later, desktop users. Static files, published to GitHub Pages. Plays the same buddy files. |
| [`screen-buddy-starter/pipeline`](screen-buddy-starter/pipeline) | The Python scripts that turned the Armani videos into buddies. |
| [`screen-buddy-starter/tools`](screen-buddy-starter/tools) | Helpers, including the script that packages the sample buddies. |

The Android app, the Windows app and the web player share only the **buddy package format** (a `.zip` with `manifest.json`, a face picture and one WebP strip per move). None depends on another's code. See [`screen-buddy-starter/README.md`](screen-buddy-starter/README.md) for the full brief.
