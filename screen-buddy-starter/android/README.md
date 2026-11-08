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
| Over other apps | `overlay/OverlayService`: a foreground service with one small overlay window. Tap for a pose, drag to move, long-press for Pause / Hide / Switch buddy / Settings. Size, transparency and movement in the app. |
| Home and lock screen | `wallpaper/BuddyWallpaperService`: a live wallpaper. Swiping home pages drives the walk move; taps arrive as `COMMAND_TAP`. |
| Screensaver | `dream/BuddyDreamService`: a slow showcase of every pose. |

Movement modes for the floating buddy (same four as the Windows app and web player; the wallpaper and screensaver keep their own behaviour):

- **Only when I touch it** (default), **Steadily** (walks in place), **While I type**, **When there is sound**. Code in `motion/`; the gate logic mirrors `windows/.../Motion.cs` and `web/js/motion.js`.
- *While I type* needs `motion/TypingService`, an accessibility service the user switches on in Android's Accessibility settings (Android has no other way to see typing in other apps). It asks for one event type (a text field changed), has `canRetrieveWindowContent=false` and never reads the event's text: it keeps a timestamp and nothing else.
- *When there is sound* asks for the `RECORD_AUDIO` permission and uses `MicLevel`, which keeps only a loudness number (no audio is stored or sent). The overlay's foreground service claims the `microphone` type only while listening, and Android may refuse that when the app isn't in view; the app then falls back to touch-only with a message.
- Pausing the buddy or hiding it stops the microphone.
- Needs on-device testing: the modes are covered by unit tests of the gates only; the accessibility service and microphone path have not been run on a device or emulator yet.

Store (the *Make your own* card in the app): `billing/Wallet.kt` is the price list and wallet, `billing/Payments.kt` is where PayPal goes, `ui/StoreCard.kt` is the card. Debuggable builds make test payments. See `../billing/README.md`, including the note on Google Play Billing.

Shared pieces:

- `buddy/`: the package format (`BuddyManifest`), the library (`BuddyStore`, including safe `.zip` import).
- `engine/`: `BuddyAnimator` (pure logic, unit tested), `SpriteBank` (decodes each strip into per-frame bitmaps), `BuddyPlayer`, `BuddyView`.

Sample buddies live in `app/src/main/assets/buddies/`. Regenerate the Armani ones with `tools/make_sample_buddies.py`; creator buddies are added with `tools/publish_buddy.py` (see `pipeline/creators/README.md`).

## Not built yet

Capture and Studio (cut-out, trim, edge feathering), server processing, accounts, the community library and publishing, gravity and anchor modes, battery rules. See the brief in `../README.md`.
