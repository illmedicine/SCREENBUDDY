# Finds body landmarks (nose, shoulders, hips, knees) in every frame with MediaPipe Pose, for any outfit.
# This replaces the outfit-colour measure (skirt.py) used for Armani.
#
# Usage: python pose.py <frames dir of a%03d.jpg> <pose_landmarker_full.task> <out.json> [people]
#   people: how many dancers are in the video (default 1). For a group buddy, every frame lists each
#   person found, left to right, under "people".
# Model: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
import sys, os, glob, json
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

src, model, out = sys.argv[1:4]
people = int(sys.argv[4]) if len(sys.argv) > 4 else 1
KEEP = {'nose': 0, 'ls': 11, 'rs': 12, 'le': 13, 're': 14, 'lw': 15, 'rw': 16,
        'lh': 23, 'rh': 24, 'lk': 25, 'rk': 26, 'la': 27, 'ra': 28, 'lf': 31, 'rf': 32}
# One dancer: video mode tracks her smoothly from frame to frame. A group: image mode, because video mode
# keeps following the first person it found and rarely picks up the others.
mode = vision.RunningMode.VIDEO if people == 1 else vision.RunningMode.IMAGE
opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=model),
                                    running_mode=mode, num_poses=people)
res = {}
with vision.PoseLandmarker.create_from_options(opts) as det:
    for f in sorted(glob.glob(os.path.join(src, '*.jpg'))):
        name = os.path.basename(f)[:-4]
        im = mp.Image.create_from_file(f)
        r = det.detect_for_video(im, int(name[1:]) * 100) if people == 1 else det.detect(im)   # 10 fps
        if not r.pose_landmarks: continue
        found = [{k: [round(lm[i].x * im.width, 1), round(lm[i].y * im.height, 1), round(lm[i].visibility, 2)]
                  for k, i in KEEP.items()} for lm in r.pose_landmarks]
        found.sort(key=lambda p: (p['lh'][0] + p['rh'][0]) / 2)   # left to right
        res[name] = (found[0] if people == 1 else {'people': found}) | {'w': im.width, 'h': im.height}
json.dump(res, open(out, 'w'), indent=0)
full = sum(1 for v in res.values() if len(v.get('people', [v])) == people)
print(f'{len(res)} frames with a pose, {full} with all {people} -> {out}')
