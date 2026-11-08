# Creator buddies

This turns a creator's public dance video into a built-in buddy for every app. It is the general version of `../armani-originals/`. Body size and position come from pose landmarks (MediaPipe), so it works for any outfit, not just one.

| id | Name | Creator | Source | Moves |
|---|---|---|---|---|
| `nadi` | Polka Dot | Nadi (@nadiluvvs) | [TikTok](https://www.tiktok.com/@nadiluvvs/video/7705520132679830814) | groove (scroll), kick, sway, hips, point |
| `kaylab` | What I Say | Kaylab (@kayylaab) | [TikTok](https://www.tiktok.com/@kayylaab/video/7673249253694639374) | cross (scroll), fist, reach, swing, wave |
| `kiah` | Puppy Love | Kiah | [TikTok](https://www.tiktok.com/@chinksgotthejuice/video/7144900940670176555) | bounce (scroll), jump, scoop, cuddle |

Each creator has a config, `<id>.json`. It holds the manifest text, the cell geometry and the frame range of each move.

## Steps

You need Python 3.12 with `rembg`, `mediapipe`, `scipy`, `numpy` and `pillow`. You also need ffmpeg, and yt-dlp with `curl_cffi` (TikTok rejects plain requests).

```bash
# 1. Download, then pull frames at 10 fps
python -m yt_dlp --impersonate chrome -o in.mp4 <tiktok url>
ffmpeg -i in.mp4 -vf fps=10 -q:v 2 frames/a%03d.jpg

# 2. Cut her out of every frame (rembg, isnet-general-use)
python ../armani-originals/cut.py frames cut

# 3. Body landmarks per frame (model: pose_landmarker_full.task, link in pose.py)
python pose.py frames pose_landmarker_full.task pose.json

# 4. Pack strips, face and manifest into a package folder
python pack.py <id>.json cut pose.json out/<id>

# 5. Copy into web, Android and Windows (add --replace when updating a buddy)
python ../../tools/publish_buddy.py out/<id>
```

Then update the bundled-buddy list in `windows/tests/ScreenBuddy.Core.Tests/CoreTests.cs` (`ListsTheBundledBuddies`).

## Config fields

- `torso`: shoulder-to-hip length in the cell, in px. Everything else is measured in torso lengths.
- `head`: space above the hip line, in torso lengths. It covers the head plus raised arms.
- `legs`: how far below the hip the cell is cut off, with a soft fade. Frames whose video ends higher than this are dropped. Nadi is cut just above the knee (0.85), Kaylab at mid-thigh (0.45, as far as her video shows) and Kiah below the knee (1.4).
- `width`: cell width, in torso lengths.
- `clips`: `{move: [first frame, last frame]}`. Pick clean stretches by eye: no turning away, heavy blur, or people walking through.
- `drop`: `{move: [frames]}` to skip single bad frames.
- `scale_like`: `{move: other}`. For a move that is mostly crouching, which shortens the torso and would make her balloon, take the other move's scale.
- `drop_dark`: removes large black patches beside her body below the shoulders. Use it when a dark object, such as Kaylab's black truck tyre, sits behind her hand.
- `stand`, `scroll`, `poses`, `name`, `author`, `from`: copied into the manifest, same meaning as in the main README.

## What `pack.py` does with every frame

1. It keeps only her. It takes every solid piece a body landmark lands on, then confident pixels connected to those pieces (hair, fingers), plus a thin soft edge. Captions, other people, the puppy on the floor and rembg's faint "ghosts" of furniture are dropped.
2. It sets one scale per move from the torso length, using the 70th percentile so crouches don't count. The hip line is pinned to the same height and she is centred on her torso. Both are smoothed over neighbouring frames.
3. It drops frames whose cut-out is much smaller than the rest of the move. Those are frames where blur cost part of her body.
4. Strips are WebP with quality 80 and alpha quality 85. The face is a 96×96 crop around the nose in the standing frame.
