# Screen Buddy for Android

Native Android app: Kotlin, Jetpack Compose for screens, plain Views and Canvas for the overlay, wallpaper and screensaver.

## Build and test

Needs Android Studio (or JDK 17+ and the Android SDK, API 36). From this folder:

```bash
./gradlew testDebugUnitTest      # unit tests
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
```

Create `local.properties` with `sdk.dir=<path to your Android SDK>` (Android Studio does this for you; use forward slashes on Windows).

## What it does

| Surface | Implementation |
|---|---|
| Over other apps | `overlay/OverlayService`: a foreground service with one small overlay window. Tap for a pose, drag to move, long-press for Pause / Hide / Switch buddy / Settings. Size and transparency in the app. |
| Home and lock screen | `wallpaper/BuddyWallpaperService`: a live wallpaper. Swiping home pages drives the walk move; taps arrive as `COMMAND_TAP`. |
| Screensaver | `dream/BuddyDreamService`: a slow showcase of every pose. |

Shared pieces:

- `buddy/`: the package format (`BuddyManifest`), the library (`BuddyStore`, including safe `.zip` import).
- `engine/`: `BuddyAnimator` (pure logic, unit tested), `SpriteBank` (decodes each strip into per-frame bitmaps), `BuddyPlayer`, `BuddyView`.

Sample buddies live in `app/src/main/assets/buddies/`. Regenerate them with `tools/make_sample_buddies.py`.

## Not built yet

Capture and Studio (cut-out, trim, edge feathering), server processing, accounts, the community library and publishing, gravity and anchor modes, battery rules. See the brief in `../README.md`.
