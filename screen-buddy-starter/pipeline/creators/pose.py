# Finds body landmarks (nose, shoulders, hips, knees) in every frame with MediaPipe Pose, for any outfit.
# This replaces the outfit-colour measure (skirt.py) used for Armani.
#
# Usage: python pose.py <frames dir of a%03d.jpg> <pose_landmarker_full.task> <out.json>
# Model: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
import sys, os, glob, json
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

src, model, out = sys.argv[1:4]
KEEP = {'nose': 0, 'ls': 11, 'rs': 12, 'lh': 23, 'rh': 24, 'lk': 25, 'rk': 26}
opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=model),
                                    running_mode=vision.RunningMode.VIDEO, num_poses=1)
res = {}
with vision.PoseLandmarker.create_from_options(opts) as det:
    for f in sorted(glob.glob(os.path.join(src, '*.jpg'))):
        name = os.path.basename(f)[:-4]
        im = mp.Image.create_from_file(f)
        r = det.detect_for_video(im, int(name[1:]) * 100)          # frames are 10 fps
        if not r.pose_landmarks: continue
        lm = r.pose_landmarks[0]
        res[name] = {k: [round(lm[i].x * im.width, 1), round(lm[i].y * im.height, 1), round(lm[i].visibility, 2)]
                     for k, i in KEEP.items()} | {'w': im.width, 'h': im.height}
json.dump(res, open(out, 'w'), indent=0)
print(f'{len(res)} frames with a pose -> {out}')
