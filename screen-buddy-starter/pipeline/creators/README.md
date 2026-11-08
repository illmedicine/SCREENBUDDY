# Creator buddies

This turns a creator's public dance video into a built-in buddy for every app. It is the general version of `../armani-originals/`. Body size and position come from pose landmarks (MediaPipe), so it works for any outfit. It also works for duos and groups: a group buddy is one wide character with everyone in it.

| id | Name | Creator | Source | Moves (scroll first) |
|---|---|---|---|---|
| `nadi` | Polka Dot | Nadi (@nadiluvvs) | [TikTok](https://www.tiktok.com/@nadiluvvs/video/7705520132679830814) | groove, kick, sway, hips, point |
| `kaylab` | What I Say | Kaylab (@kayylaab) | [TikTok](https://www.tiktok.com/@kayylaab/video/7673249253694639374) | cross, fist, reach, swing, wave |
| `kiah` | Puppy Love | Kiah | [TikTok](https://www.tiktok.com/@chinksgotthejuice/video/7144900940670176555) | bounce, jump, scoop, cuddle |
| `nadi-wiggles` | Wiggles (beta) | Nadi (@nadiluvvs) | [TikTok](https://www.tiktok.com/@nadiluvvs/video/7699178905780882718) | groove, jump, kick, flail, bop |
| `kenna` | Country Kenna (beta) | Kenna (@kennabeann14) | [TikTok](https://www.tiktok.com/@kennabeann14/video/7463594030362856750) | groove, step, arms, sway, pose, strut |
| `queen-aono` | Camo Queen (beta) | Queen Aono (@queenaono) | [TikTok](https://www.tiktok.com/@queenaono/video/7487166711980936453) | groove, bop, flip, step, kick, hands |
| `ansell` | AA Remix (beta) | Ansell (@anseaae) | [TikTok](https://www.tiktok.com/@anseaae/video/7587245141614660865) | hips, arms, lean, hair, pose |
| `pariya` | Started It All (beta, duo) | Pariya & Pardiss (@pariyac) | [TikTok](https://www.tiktok.com/@pariyac/video/7540079753848524088) | bounce, intro, sync, shimmy |
| `jessie-jessica` | Bedrock (beta, duo) | Jessie & Jessica (@jessieandjessicax) | [TikTok](https://www.tiktok.com/@jessieandjessicax/video/7217034472703773958) | sway, step, hair, point, pose |
| `jessie-jessica-cheer` | Fuego (duo, **not shipped yet**: the stadium stands behind them cut out as part of the twins) | Jessie & Jessica (@jessieandjessicax) | [TikTok](https://www.tiktok.com/@jessieandjessicax/video/7684682952734887190) | shake, cheer, dip, kick, hips, jump |
| `roseylucci` | UK Girls (beta, group of 4) | Roseylucci & friends (@roseylucci) | [TikTok](https://www.tiktok.com/@roseylucci/video/7499543657528216854) | step, groove, dip, shimmy |

**Automatic:** `python autobuddy.py <video file or link> <out dir> --people N --name "…"` does every step below by itself (best 12 seconds, moves split at the calmest frames, MediaPipe cut-out, about 2 minutes on a laptop; `--quality` uses the slower rembg model). The cloud worker (`../main.py`) runs exactly this. The hand-made configs below are for when you want to choose moves yourself.

Each creator has a config, `<id>.json`. It holds the manifest text, the cell geometry and the frame range of each move.

## Steps

You need Python 3.12 with `rembg`, `mediapipe`, `scipy`, `numpy` and `pillow`. You also need ffmpeg, and yt-dlp with `curl_cffi` (TikTok rejects plain requests).

```bash
# 1. Download, then pull frames at 10 fps
python -m yt_dlp --impersonate chrome -o in.mp4 <tiktok url>
ffmpeg -i in.mp4 -vf fps=10 -q:v 2 frames/a%03d.jpg

# 2. Cut the dancers out of every frame (rembg; isnet-general-use unless the config names a cut_model)
python ../armani-originals/cut.py frames cut [u2net_human_seg]

# 3. Body landmarks per frame (model: pose_landmarker_full.task, link in pose.py). Last number: how many dancers
python pose.py frames pose_landmarker_full.task pose.json 1

# 4. Pack strips, face and manifest into a package folder
python pack.py <id>.json cut pose.json out/<id>

# 5. Copy into web, Android and Windows (add --replace when updating a buddy)
python ../../tools/publish_buddy.py out/<id>
```

Then update the bundled-buddy count and list in `windows/tests/ScreenBuddy.Core.Tests/CoreTests.cs` (`EveryShippedBuddyParsesAndItsFilesExist`, `ListsTheBundledBuddies`).

rembg and MediaPipe both use a lot of memory. Running more than two of them at once on a normal PC can make MediaPipe fail to load (exit code 127, no output). Rerun it when the others are done.

## Config fields

- `torso`: shoulder-to-hip length in the cell, in px. Everything else is measured in torso lengths. Pick it so the cell is about 360 px tall: `torso × (head + legs) ≈ 360`.
- `head`: space above the hip line, in torso lengths. It covers the head plus raised arms (2.6 for pom-poms in the air).
- `legs`: how far below the hip the cell is cut off, with a soft fade. Frames whose video ends higher than this are dropped. Nadi is cut just above the knee (0.85), Kaylab at mid-thigh (0.45, as far as her video shows), Ansell at the hips (0.22) and the full-body videos below the knee (1.4).
- `width`: cell width, in torso lengths. About 2 for one dancer, 4 to 5 for a duo, 5.4 for a group of four.
- `clips`: `{move: [first frame, last frame]}`. Pick clean stretches by eye: no turning away, heavy blur, people walking through, or a dancer leaving the frame.
- `drop`: `{move: [frames]}` to skip single bad frames.
- `scale_like`: `{move: other}`. For a move that is mostly crouching, which shortens the torso and would make her balloon, take the other move's scale.
- `drop_dark`: removes large black patches beside her body below the shoulders. Use it when a dark object, such as Kaylab's black truck tyre, sits behind her hand.
- `skeleton`: `{"arm", "leg", "head", "hand"}` widths in torso lengths. Keeps only what lies inside a generous outline drawn from the pose (shoulders, elbows, wrists, hips, knees, ankles, feet, head). Use it when the cut-out model keeps an object right behind her, like Kenna's wicker chair or the stadium railing behind the cheer twins. `hand` adds a circle around each wrist for things she holds, such as pom-poms.
- `cut_model`: a note of which rembg model step 2 used, when it isn't the default. `u2net_human_seg` only looks for people, so it drops more furniture.
- `people`: how many dancers (default 1). Run `pose.py` with the same number. A frame is used only if pose detection found all of them.
- `static`: for a group shot on a tripod where pose detection can't find everyone (small, far-away dancers). Every frame is used, every large cut-out piece is kept as a dancer, and each move gets one fixed placement.
- `stand`, `scroll`, `poses`, `name`, `author`, `from`: copied into the manifest, same meaning as in the main README. New buddies start their `from` with "Beta".

## What `pack.py` does with every frame

1. It keeps only the dancers. It takes every solid piece a body landmark lands on, then confident pixels connected to those pieces (hair, fingers), plus a thin soft edge. Captions, passers-by, the puppy on the floor and rembg's faint "ghosts" of furniture are dropped. For a group this runs once per dancer and the results are combined.
2. It sets one scale per move from the torso length (a group: the dancers' average), using the 70th percentile so crouches don't count. The hip line is pinned to the same height and the dancers are centred. Both are smoothed over neighbouring frames.
3. It drops frames whose cut-out is much smaller than the rest of the move. Those are frames where blur cost part of her body.
4. Strips are WebP with quality 80 and alpha quality 85. The face is a 96×96 crop around the nose in the standing frame. For a group it is a strip of all their faces, letterboxed on a dark square.
