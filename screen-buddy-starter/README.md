# Screen Buddy

**Status:** project brief, November 2026.

Screen Buddy is an Android app that turns a short video of you into a realistic, transparent, animated character. The character lives on your phone:

- floating over your apps,
- as your home and lock screen wallpaper,
- as your screensaver.

You keep a library of your characters. You can choose to publish one so other people can download it and use it as their own buddy.

This brief has two parts:

1. **Proven:** what was built and shipped for armaniwest (the walking Armani characters on illmedicine.github.io/ArmaniWest).
2. **Plan:** how that maps to the Android app.

The scripts that made the Armani characters are in `pipeline/armani-originals/`. The web player is in `web-runtime/`.

---

## Part 1: Video to on-screen character (what was built)

### The result

Each character is a set of **moves**. A move is a short run of frames cut out of the video with a transparent background. Each move is packed into one horizontal **WebP sprite strip**, and a small manifest describes the whole character.

Armani has two characters:

| Character | Source | Moves | Frames per move |
|---|---|---|---|
| Clawmontana | TikTok | strut, hips, arms, wave, flip | 9–40 |
| Body | Snapchat | groove, arms, hips, dance, kick, sway | 15–28 |

Each character is about 1–1.5 MB in total.

### The pipeline, step by step

1. **Pull frames at 10 fps** with ffmpeg:
   ```bash
   ffmpeg -i in.mp4 -vf fps=10 -q:v 2 frames/a%03d.jpg
   ```
   10 fps is plenty. The figure is small on screen, and more frames only add weight.

2. **Cut the person out of every frame.** This uses rembg with the `isnet-general-use` model (`cut.py`).
   - `birefnet-general` is sharper but ran out of memory on a normal PC.
   - isnet was the right balance of quality and speed.

3. **Clean each cut-out** (`clean()` in `pack.py`).
   - Keep only the largest solid shape.
   - Grow that shape by about 16 px, and keep thin bits inside it, such as fingers, nails and hair.
   - That drops background people, props and floor marks.
   - Then `trim_above()` walks up from the chest. If the shape turns thinner than a neck for several rows (a light pole behind her head), everything above that point is removed.

4. **Find a body measure in every frame.**
   - For Armani, `skirt.py` found the top of the head, the top of the skirt and the top of the crop top, using the colours of her outfit.
   - **For the app, use pose landmarks instead.** ML Kit Pose Detection or MediaPipe Pose return head, shoulders, hips and knees for any outfit.

5. **Normalise size and position.** This was the biggest quality win.
   - Scaling each frame to fit its own box made her jump in size from frame to frame.
   - Instead, for each move:
     - Compute **one scale** from the median head-to-waist distance in that move.
     - Pin the waistline to a fixed height in the cell.
     - Centre her horizontally on her torso, not on her arms.
     - Smooth the waist and centre over neighbouring frames to remove jitter.
   - Result: every move has the same size and the same footing, so switching moves never pops.

6. **Crop below the knee with a soft fade at the bottom.**
   - Feet are the hardest part to cut out cleanly: shadows, floor and blur.
   - The figure stands on the bottom edge of the screen, so a fade there reads as natural.

7. **Choose clean frame ranges for each move** by hand.
   - Drop frames where she leaves the frame, something passes in front of her, or motion blur is heavy.
   - One whole move ("exit") was dropped for blur.

8. **Pack the strips** (`pack.py` / `pack2.py`).
   - Fixed cell size per character: 190×376 for Clawmontana, 240×366 for Body.
   - Frames sit side by side in one strip per move.
   - Saved as WebP with quality 80 and alpha quality 85.

9. **Write the manifest and the face thumbnail** (`assemble.py`). The manifest is `walker-data.js`, with this shape:
   ```json
   {
     "name": "Body",
     "cw": 240,
     "ch": 366,
     "fps": 10,
     "stand": ["groove", 0],
     "scroll": "groove",
     "poses": ["arms", "hips", "dance", "kick", "sway"],
     "face": "face.webp",
     "clips": {
       "groove": { "n": 20, "src": "groove.webp" }
     }
   }
   ```
   `clips` lists every move; only `groove` is shown here. The face thumbnail is a 96×96 crop around the top of the head of the standing frame. It is used in the character picker.

**One-off cleanup in `pack2.py`.** It includes `unmark()`, which repaints the Snapchat caption letters that sat over her body in that one video. Keep it out of the product. Users should capture in the app or upload their own original camera footage.

### How the character behaves (`web-runtime/walker.js`)

- **Idle:** she stands on one chosen frame (`stand`) in the bottom-right corner and does not wander off.
- **Scroll:** the scroll position scrubs the `scroll` move, one frame per 28 px. It plays forwards then backwards, so it never snaps back to the start. She also leans up to ±5° with the scroll speed. About 0.45 s after scrolling stops, she returns to standing.
- **Tap, or Enter on a keyboard:** she plays a random pose, never the same pose twice in a row.
  - Poses shorter than 24 frames play forwards then backwards.
  - Longer poses play once.
  - Then she returns to standing.
- **Drawing a frame:** each frame is shown by moving the strip's `background-position`, so there is no video decoding. Strips load lazily, and a move is only used once its strip has loaded.
- **Reduced motion:** if the phone or browser asks for reduced motion, she shows a still frame only.
- **Picker:** a header switch offers Clawmontana, Body or Off, like a light/dark theme toggle. The choice is saved per device.

---

## Part 2: The Android app (plan)

### Where the buddy can appear

| Surface | Android feature | Notes |
|---|---|---|
| Over all apps | Overlay window (`SYSTEM_ALERT_WINDOW`, `TYPE_APPLICATION_OVERLAY`) kept alive by a foreground service | See "Overlay rules" below |
| Home screen | Live wallpaper (`WallpaperService`) | `onOffsetsChanged` fires when you swipe between home pages, so it can drive the "scroll" move exactly like page scroll on the web. Taps arrive through `onCommand(WallpaperManager.COMMAND_TAP)` and trigger a pose. |
| Lock screen | The same live wallpaper | No third-party app can draw an overlay on top of the lock screen. The wallpaper is the supported path. Whether a live wallpaper shows on the lock screen, and whether it can differ from the home screen, depends on the Android version and phone maker, so test on Samsung and Pixel early. |
| Screensaver | `DreamService` (Settings → Display → Screen saver) | Runs while charging or docked. A good place for a slow "showcase" loop of every pose. |

#### Overlay rules

- The user grants the overlay permission once in Settings. Then a foreground service keeps the overlay alive.
- Android 14 and later require a declared foreground-service type. Google Play will ask why the app needs it.
- Size the overlay window to the buddy only, not the full screen. Since Android 12, touches that pass through a large overlay to the app underneath are blocked.
- Tap the buddy for a pose. Drag the buddy to move it. Long-press the buddy for a menu with Hide, Switch buddy and Settings.

### Buddy package format

Reuse the web format so the same character works on both:

```
buddy.zip
  manifest.json      # same shape as walker-data.js, plus id, author and version
  face.webp
  <move>.webp        # one sprite strip per move
```

Draw each frame on Android by decoding the strip once and drawing the frame's rectangle to a Canvas. That works in an overlay, a wallpaper and a screensaver alike.

**Memory:** a 25-frame strip at 240×366 is about 9 MB once decoded. Keep only the current move and the standing move in memory, and load the others when they are needed.

### Making a buddy in the app

1. **Capture or upload.**
   - Capture uses CameraX video, 5–20 seconds, portrait.
   - Upload accepts a video from the camera roll.
2. **Assisted capture checks**, live while recording. These checks are what make results consistent:
   - Whole body in frame, from head to below the knee, using pose landmarks.
   - Distance: the person fills 60–80% of the frame height.
   - Background contrast warning: hair or outfit the same colour as the wall.
   - Lighting warning when the scene is too dark, since dark frames give fuzzy edges.
   - Phone held still, using the gyroscope. On-screen tip: "lean it on something".
   - Prompts for each move: "walk toward the camera", "strike a pose", "wave".
3. **Process.**
   - Steps 1–9 from Part 1, with pose landmarks for the body measure in step 4.
   - Pick clean frame ranges automatically: score each frame on blur, cut-out quality and whether the whole body is in shot, then keep the best continuous runs.
4. **Review.** Preview each move. Lets users trim frames, rename moves, and pick the standing frame and the scroll move.
5. **Save to the user's character library.**

#### Where processing runs

| Option | Pros | Cons |
|---|---|---|
| Server (recommended for v1) | Reuses this Python pipeline almost as is (rembg, scipy, Pillow) in a Cloud Run or Cloud Functions job. Best quality. | Costs money per buddy, and uploads a video of the user. |
| On device (later) | Private and free to run. | MediaPipe Image Segmenter or ML Kit Subject Segmentation are faster but edges are rougher than isnet. |
| Hybrid | Instant on-device preview while the high-quality version renders on the server. | Two pipelines to maintain. |

### Sharing and the public gallery

- Firebase is a natural fit: Auth for accounts, Storage for buddy zips, Firestore for listings, likes and downloads. The armaniwest site is already set up for Firebase.
- Every buddy is **private by default**. Publishing is an explicit opt-in, and an owner can unpublish at any time.
- Gallery: browse, preview the animation in place, download to your library, then select it as your buddy.

**Likeness and safety.** Plan for these from day one, because the content is real people's bodies:

- Publishing should be limited to buddies of yourself. For example, do a selfie face check against the buddy's face at publish time.
- Age gate. No public sharing for minors.
- Automated nudity and violence screening on publish, plus a report button and takedown flow.
- Delete source videos after processing unless the user keeps them. Say so in the privacy policy.

### Suggested first milestones

1. **Player.** Load a buddy zip and render it in an overlay (tap = pose, drag = move). Start with Armani's two characters as test packs.
2. **Live wallpaper and screensaver** from the same renderer, with home-page swipes driving the scroll move.
3. **Server pipeline:** upload a video and get a buddy zip back.
4. **In-app capture** with the assisted checks, plus the review screen.
5. **Accounts, character library and the public gallery** with the safety steps above.

Suggested stack: Kotlin and Jetpack Compose for app screens; plain Views and Canvas inside the overlay, wallpaper and screensaver; CameraX; ML Kit Pose; Firebase.
