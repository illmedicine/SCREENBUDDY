# Turns a dance video into a Screen Buddy package with no hand-picking: the automatic version of the steps in README.md.
# The cloud worker (pipeline/main.py) runs it for every buddy made from the website; you can also run it by hand:
#
#   python autobuddy.py <video file or link> <out dir> [--people N] [--name "Name"] [--author "Creator"] [--from "TikTok"]
#
# What it does, and why it is fast:
#   1. Frames at 10 fps, scaled to 640 px tall. The finished buddy is about 360 px tall, so full-size frames are wasted work.
#   2. Pose landmarks on every frame (cheap, about 30 frames a second). Each frame is scored: all dancers found, body
#      visible, sharp (not motion-blurred), no sudden zoom, nobody leaving the picture.
#   3. The best stretch of up to 12 seconds is kept. Only those frames go through background removal (the slow step),
#      with rembg's people-only model (u2net_human_seg): it works at 320x320, about 10x faster than isnet's 1024x1024,
#      and it ignores furniture behind the dancer.
#   4. The stretch is cut into moves of about 2 seconds, at the calmest frames, so moves start and end cleanly.
#   5. Cell size, crop line and width come from the landmarks, then pack.py does the same packing as every other buddy.
import os, sys, json, re, shutil, subprocess, statistics as st, urllib.request, zipfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FPS, FRAME_H, MAX_SECONDS = 10, 640, 60
MAX_FRAMES, MIN_FRAMES, MOVE_LEN = 120, 25, 22
POSE_MODEL_URL = ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/'
                  'float16/latest/pose_landmarker_full.task')
MOVE_NAMES = ['groove', 'bounce', 'sway', 'step', 'flow', 'vibe', 'shimmy', 'pose']


class Fail(Exception):
    """A problem with the video itself. The message is shown to the person who asked for the buddy."""


def _noop(stage, pct): pass


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return shutil.which('ffmpeg') or 'ffmpeg'


def download(url, work, progress=_noop):
    """Downloads a public video link (TikTok, YouTube, Instagram, …) with yt-dlp. Returns the file path."""
    import yt_dlp
    from yt_dlp.networking.impersonate import ImpersonateTarget
    def hook(d):
        if d.get('status') == 'downloading' and d.get('total_bytes'):
            progress('Downloading the video', round(100 * d.get('downloaded_bytes', 0) / d['total_bytes']))
    opts = {'outtmpl': os.path.join(work, 'video.%(ext)s'), 'format': 'b[height<=1080]/bv*[height<=1080]/b',
            'quiet': True, 'no_warnings': True, 'noprogress': True, 'noplaylist': True,
            'max_filesize': 300 * 1024 * 1024, 'ffmpeg_location': ffmpeg(), 'progress_hooks': [hook]}
    try:
        opts['impersonate'] = ImpersonateTarget.from_str('chrome')     # TikTok rejects plain requests
    except Exception:
        pass
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            y.download([url])
    except Exception as e:
        raise Fail("We couldn't download that video. Check the link is public, or upload the video file instead.") from e
    files = [f for f in os.listdir(work) if f.startswith('video.')]
    if not files: raise Fail("We couldn't download that video. Check the link is public, or upload the video file instead.")
    return os.path.join(work, files[0])


def extract_frames(video, frames_dir):
    os.makedirs(frames_dir, exist_ok=True)
    r = subprocess.run([ffmpeg(), '-v', 'error', '-y', '-i', video, '-t', str(MAX_SECONDS),
                        '-vf', f'fps={FPS},scale=-2:\'min({FRAME_H},ih)\'', '-q:v', '3',
                        os.path.join(frames_dir, 'a%03d.jpg')], capture_output=True, text=True)
    names = sorted(f[:-4] for f in os.listdir(frames_dir) if f.endswith('.jpg'))
    if r.returncode != 0 or len(names) < MIN_FRAMES:
        raise Fail("That file doesn't look like a video we can read, or it's shorter than 3 seconds.")
    return names


def pose_model(cache):
    path = os.path.join(cache, 'pose_landmarker_full.task')
    if not os.path.exists(path):
        os.makedirs(cache, exist_ok=True)
        urllib.request.urlretrieve(POSE_MODEL_URL, path + '.part')
        os.replace(path + '.part', path)
    return path


def mid(p, a, b): return ((p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2)
def torso1(p): (sx, sy), (hx, hy) = mid(p, 'ls', 'rs'), mid(p, 'lh', 'rh'); return float(np.hypot(sx - hx, sy - hy))


def sharpness(path):
    g = np.asarray(Image.open(path).convert('L').reduce(2), dtype=np.float32)
    lap = 4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.var())


def analyse(P, names, frames_dir, people):
    """One row per frame with what the choices below need. Groups too small for pose detection to find everyone
    (3 or more dancers, all found in under half the frames) switch to static mode: every frame with anyone counts."""
    def persons(n): v = P.get(n); return [] if v is None else v.get('people', [v])
    static = people >= 3 and sum(len(persons(n)) == people for n in names) < .5 * len(names)
    rows = []
    for n in names:
        ps = persons(n)
        r = {'name': n, 'n': len(ps), 'sharp': sharpness(os.path.join(frames_dir, n + '.jpg'))}
        if ps:
            w, h = P[n]['w'], P[n]['h']; t = st.mean(torso1(p) for p in ps)
            r.update(torso=t, hip=st.mean(mid(p, 'lh', 'rh')[1] for p in ps), w=w, h=h,
                     vis=min(min(p[q][2] for q in ('ls', 'rs', 'lh', 'rh')) for p in ps),
                     cx=[(mid(p, 'ls', 'rs')[0] + mid(p, 'lh', 'rh')[0]) / 2 for p in ps], ps=ps)
            r['below'] = (h - r['hip']) / t if t > 1 else 0
        rows.append(r)
    sharp_med = st.median(r['sharp'] for r in rows) or 1
    torsos = [r.get('torso', 0) for r in rows]
    for i, r in enumerate(rows):
        near = [t for t in torsos[max(0, i - 10): i + 11] if t]
        r['good'] = bool(r['n'] and (r['n'] >= 1 if static else r['n'] == people) and r['vis'] > .5 and r['torso'] > 8
                         and r['sharp'] >= .45 * sharp_med and near and .75 <= r['torso'] / st.median(near) <= 1.35
                         and all(.06 * r['w'] < x < .94 * r['w'] for x in r['cx']))
    return rows, static


def best_window(rows):
    """The longest stretch of good frames, allowing gaps of up to 2 bad frames (they are skipped later)."""
    best, start, bad = (0, 0, 0), None, 0
    for i, r in enumerate(rows + [{'good': False}] * 3):
        if r['good']:
            start = i if start is None else start; bad = 0
        elif start is not None:
            bad += 1
            if bad > 2:
                end = i - bad + 1
                good = sum(x['good'] for x in rows[start:end])
                if good > best[0]: best = (good, start, end)
                start, bad = None, 0
    good, a, b = best
    if good < MIN_FRAMES:
        raise Fail("We couldn't find 3 seconds where every dancer is clearly in the picture. Try a video where the "
                   "camera stays still and everyone stays in frame.")
    return a, min(b, a + MAX_FRAMES)


def split_moves(rows, a, b):
    """Cuts frames a..b into moves of about MOVE_LEN frames, each cut at the calmest nearby frame."""
    def energy(i):
        r0, r1 = rows[i - 1], rows[i]
        if not (r0.get('ps') and r1.get('ps')) or len(r0['ps']) != len(r1['ps']): return 1.0
        d = [np.hypot(p1[q][0] - p0[q][0], p1[q][1] - p0[q][1]) / max(r1['torso'], 1)
             for p0, p1 in zip(r0['ps'], r1['ps']) for q in ('lw', 'rw', 'le', 're', 'lk', 'rk') if q in p1 and q in p0]
        return float(np.mean(d)) if d else 1.0
    n = b - a; k = max(1, round(n / MOVE_LEN)); cuts = [a]
    for j in range(1, k):
        c = a + round(j * n / k)
        lo, hi = max(cuts[-1] + 10, c - 4), min(b - 10, c + 4)
        cuts.append(min(range(lo, hi + 1), key=energy) if lo <= hi else c)
    cuts.append(b)
    return [(cuts[i], cuts[i + 1] - 1) for i in range(len(cuts) - 1) if cuts[i + 1] - cuts[i] >= 8]


def geometry(rows, a, b, people, static, cut_dir):
    good = [r for r in rows[a:b] if r['good']]
    t = st.median(r['torso'] for r in good)
    legs = float(np.clip(np.percentile([r['below'] for r in good], 20) - .06, .22, 1.4))
    raised = np.mean([any(p[q][1] < p['nose'][1] - .3 * torso1(p) for p in r['ps'] for q in ('lw', 'rw') if q in p) for r in good])
    head = 2.6 if raised > .2 else 2.4
    if static:   # landmarks miss some dancers: measure the cut-outs instead
        spans = []
        for r in good[::3]:
            m = np.asarray(Image.open(os.path.join(cut_dir, r['name'] + '.png')))[:, :, 3] > 60
            xs = np.flatnonzero(m.any(0))
            if len(xs): spans.append((xs[-1] - xs[0]) / t)
        width = float(np.clip(np.percentile(spans, 85) + .4, 3.4, 7.0)) if spans else 5.4
    else:
        spans = [(max(p[q][0] for p in r['ps'] for q in ('lw', 'rw', 'le', 're', 'ls', 'rs') if q in p)
                  - min(p[q][0] for p in r['ps'] for q in ('lw', 'rw', 'le', 're', 'ls', 'rs') if q in p)) / r['torso'] for r in good]
        width = float(np.clip(np.percentile(spans, 85) + (.8 if people == 1 else 1.0), 1.9, 2.6 if people == 1 else 7.0))
    return dict(torso=round(360 / (head + legs)), head=head, legs=round(legs, 2), width=round(width, 2))


SEGMENTER_URL = ('https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/'
                 'float32/latest/selfie_multiclass_256x256.tflite')


def cut_out(frames_dir, names, cut_dir, cache, quality=False, progress=_noop):
    """Background removal on the chosen frames only.
    Default (fast): MediaPipe's person segmenter, built for live video: a fraction of a second per frame. Its faint
    background haze is sharpened away here and pack.py's clean-up removes the rest.
    quality=True: rembg's people-only model (u2net_human_seg). Crisper hair, but several seconds per frame on a CPU."""
    os.makedirs(cut_dir, exist_ok=True)
    if quality:
        os.environ.setdefault('U2NET_HOME', os.path.join(cache, 'u2net'))
        from rembg import new_session, remove
        session = new_session('u2net_human_seg')
        for i, n in enumerate(names):
            remove(Image.open(os.path.join(frames_dir, n + '.jpg')).convert('RGB'), session=session).save(os.path.join(cut_dir, n + '.png'))
            progress('Cutting out the dancers', round(100 * (i + 1) / len(names)))
        return
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision
    model = os.path.join(cache, 'selfie_multiclass_256x256.tflite')
    if not os.path.exists(model):
        os.makedirs(cache, exist_ok=True); urllib.request.urlretrieve(SEGMENTER_URL, model + '.part'); os.replace(model + '.part', model)
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=model), output_confidence_masks=True))
    for i, n in enumerate(names):
        rgb = np.asarray(Image.open(os.path.join(frames_dir, n + '.jpg')).convert('RGB'))
        bg = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)).confidence_masks[0].numpy_view()
        alpha = (np.clip(((1 - bg) - .3) / .4, 0, 1) * 255).astype(np.uint8)      # sharpen the edge, drop the haze
        Image.fromarray(np.dstack([rgb, alpha])).save(os.path.join(cut_dir, n + '.png'))
        progress('Cutting out the dancers', round(100 * (i + 1) / len(names)))


def make_buddy(video, out_dir, *, people=1, buddy_id='buddy', name='My buddy', author='', source_from='',
               quality=False, work=None, cache=None, progress=_noop):
    """video: a file path or an https link. Writes the package (manifest.json, face.webp, strips, buddy.zip) to out_dir
    and returns the manifest. Raises Fail with a readable reason when the video can't make a good buddy."""
    work = work or os.path.join(out_dir + '.work'); cache = cache or os.path.join(work, 'cache')
    os.makedirs(work, exist_ok=True)
    if re.match(r'https?://', str(video)):
        progress('Downloading the video', 0)
        video = download(video, work, progress)
    progress('Reading the video', 0)
    frames_dir = os.path.join(work, 'frames')
    names = extract_frames(video, frames_dir)

    progress('Finding the dancers', 0)
    pose_json = os.path.join(work, 'pose.json')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'pose.py'), frames_dir, pose_model(cache), pose_json, str(people)],
                       capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(f'pose.py failed: {r.stderr[-800:]}')
    P = json.load(open(pose_json))
    if not P: raise Fail("We couldn't find a person in that video.")
    rows, static = analyse(P, names, frames_dir, people)
    a, b = best_window(rows)
    moves = split_moves(rows, a, b)

    keep = [r['name'] for r in rows[a:b]]
    cut_dir = os.path.join(work, 'cut')
    cut_out(frames_dir, keep, cut_dir, cache, quality, progress)

    progress('Packing the moves', 0)
    clips, drop = {}, {}
    for i, (s, e) in enumerate(moves):
        mv = MOVE_NAMES[i % len(MOVE_NAMES)] + ('' if i < len(MOVE_NAMES) else str(i // len(MOVE_NAMES) + 1))
        clips[mv] = [rows[s]['name'], rows[e]['name']]
        bad = [r['name'] for r in rows[s:e + 1] if not r['good']]
        if bad: drop[mv] = bad
    names_mv = list(clips)
    scroll = max(names_mv, key=lambda m: int(clips[m][1][1:]) - int(clips[m][0][1:]))
    s, e = moves[0]                                    # stand on the sharpest good frame of the first move
    firsts = [r for r in rows[s:e + 1] if r['good']]
    stand_i = max(range(len(firsts)), key=lambda i: firsts[i]['sharp'] * firsts[i]['vis']) if firsts else 0
    cfg = dict(id=buddy_id, name=name[:40] or 'My buddy', author=author[:60], **{'from': source_from[:60]},
               people=people, static=static, clips=clips, drop=drop,
               stand=[names_mv[0], stand_i], scroll=scroll, poses=[m for m in names_mv if m != scroll] or [scroll],
               **geometry(rows, a, b, people, static, cut_dir))
    cfg_path = os.path.join(work, 'config.json')
    json.dump(cfg, open(cfg_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'pack.py'), cfg_path, cut_dir, pose_json, out_dir],
                       capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(f'pack.py failed: {r.stderr[-800:]}')
    manifest = json.load(open(os.path.join(out_dir, 'manifest.json'), encoding='utf-8'))
    files = ['manifest.json', manifest['face']] + [c['src'] for c in manifest['clips'].values()]
    with zipfile.ZipFile(os.path.join(out_dir, 'buddy.zip'), 'w', zipfile.ZIP_STORED) as z:
        for f in sorted(files): z.write(os.path.join(out_dir, f), f)
    progress('Packing the moves', 100)
    return manifest


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description='Make a Screen Buddy package from a dance video, automatically.')
    ap.add_argument('video'); ap.add_argument('out')
    ap.add_argument('--people', type=int, default=1); ap.add_argument('--id', default='buddy')
    ap.add_argument('--name', default='My buddy'); ap.add_argument('--author', default=''); ap.add_argument('--from', dest='src', default='')
    ap.add_argument('--quality', action='store_true', help='slower, crisper background removal')
    a = ap.parse_args()
    try:
        m = make_buddy(a.video, a.out, people=a.people, buddy_id=a.id, name=a.name, author=a.author, source_from=a.src, quality=a.quality,
                       progress=lambda s, p: print(f'{s} {p}%', flush=True))
        print('done:', m['id'], {k: v['n'] for k, v in m['clips'].items()})
    except Fail as e:
        sys.exit(f'failed: {e}')
