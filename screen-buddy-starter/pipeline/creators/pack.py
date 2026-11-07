# Packs a creator's cut-out frames into a Screen Buddy package: one transparent WebP strip per move,
# a face thumbnail and manifest.json. It is the outfit-independent version of armani-originals/pack.py:
# body size and position come from pose landmarks (pose.py) instead of outfit colours.
#
# Usage: python pack.py <config.json> <cut dir of a%03d.png> <pose.json> <out package dir>
#
# Per move:
#   - one scale from the move's torso length (shoulders to hips), so she keeps her size across moves,
#   - the hip line is pinned to the same height in every cell, and she is centred on her torso,
#   - hip line and centre are smoothed over neighbouring frames to remove jitter,
#   - the cell's bottom edge crops her `legs` torso lengths below the hip, with a soft fade.
import sys, os, json, shutil, statistics as st
import numpy as np
from PIL import Image
from scipy import ndimage as nd

cfg_path, cut, pose_path, out = sys.argv[1:5]
C = json.load(open(cfg_path, encoding='utf-8'))
P = json.load(open(pose_path))
T = C['torso']                                  # shoulder-to-hip length in the packed cells, px
CH = round(T * (C['head'] + C['legs'])); CW = round(T * C['width'])
HIP_Y = round(T * C['head'])
FADE = np.clip(np.linspace(CH, 0, CH) / (CH * .06), 0, 1) ** 1.3

def mid(p, a, b): return ((p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2)
def torso(p):
    (sx, sy), (hx, hy) = mid(p, 'ls', 'rs'), mid(p, 'lh', 'rh')
    return float(np.hypot(sx - hx, sy - hy))

def clean(im, p):
    """Keep only her: the solid shape her torso is in (else the largest), plus thin bits close to it
    (fingers, nails, hair). Drops captions, background people and props that aren't touching her."""
    a = np.array(im); al = a[:, :, 3]
    core = nd.binary_opening(al > 60, structure=np.ones((9, 9)))
    lab, n = nd.label(core)
    if not n: return None
    (sx, sy), (hx, hy) = mid(p, 'ls', 'rs'), mid(p, 'lh', 'rh')
    ids = [lab[min(int(y), lab.shape[0] - 1), min(int(x), lab.shape[1] - 1)]
           for x, y in [((sx + hx) / 2, (sy + hy) / 2), (sx, sy), (hx, hy)]]
    ids = [i for i in ids if i]
    keep_id = st.mode(ids) if ids else np.argmax(nd.sum(core, lab, range(1, n + 1))) + 1
    grow = max(6, round(16 * im.width / 1080))
    al = np.where(nd.binary_dilation(lab == keep_id, iterations=grow), al, 0)
    a[:, :, 3] = al
    return Image.fromarray(a)

def smooth(v, r): return [st.mean(v[max(0, i - r): i + r + 1]) for i in range(len(v))]

if os.path.exists(out): shutil.rmtree(out)
os.makedirs(out)
clips, stand_info = {}, None
for name, (a, b) in C['clips'].items():
    skip = set(C.get('drop', {}).get(name, []))
    ids = [f'a{i:03d}' for i in range(int(a[1:]), int(b[1:]) + 1)]
    ids = [f for f in ids if f not in skip and f in P and os.path.exists(os.path.join(cut, f + '.png'))]
    s = T / float(np.percentile([torso(P[f]) for f in ids], 70))   # upright frames set the scale, not crouches
    frames, dropped = [], 0
    for f in ids:
        p = P[f]; hip = mid(p, 'lh', 'rh')
        if (p['h'] - hip[1]) * s < (C['legs'] - .04) * T: dropped += 1; continue      # legs end too high
        im = clean(Image.open(os.path.join(cut, f + '.png')).convert('RGBA'), p)
        if im is None: dropped += 1; continue
        cx = (mid(p, 'ls', 'rs')[0] + hip[0]) / 2
        frames.append((f, im, hip[1], cx, p['nose']))
    hy = smooth([h for _, _, h, _, _ in frames], 1); cx = smooth([c for *_, c, _ in frames], 2)
    strip = Image.new('RGBA', (CW * len(frames), CH), (0, 0, 0, 0)); clipped = 0
    for i, (f, im, _, _, nose) in enumerate(frames):
        sm = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        ox = round(CW / 2 - cx[i] * s); oy = round(HIP_Y - hy[i] * s)
        cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0)); cell.paste(sm, (ox, oy), sm)
        ca = np.array(cell)
        sa = np.array(sm)[:, :, 3] > 60
        tot = sa[max(0, -oy): max(0, CH - oy)].sum(); inside = (ca[:, :, 3] > 60).sum()
        if tot and inside / tot < .985: clipped += 1
        ca[:, :, 3] = (ca[:, :, 3] * FADE[:, None]).astype(np.uint8)
        strip.paste(Image.fromarray(ca), (i * CW, 0))
        if [name, i] == C['stand']: stand_info = (Image.fromarray(ca), ox + nose[0] * s, oy + nose[1] * s)
    strip.save(os.path.join(out, name + '.webp'), 'WEBP', quality=80, alpha_quality=85, method=6)
    clips[name] = dict(n=len(frames), src=f'{name}.webp')
    print(f'{name}: {len(frames)} frames ({dropped} dropped), scale {s:.3f}, '
          f'{os.path.getsize(os.path.join(out, name + ".webp")) // 1024} KB, {clipped} clipped at cell edge')

# Face thumbnail for the picker: a square around her head in the standing frame, on a dark backdrop.
cell, nx, ny = stand_info
side = round(T * C.get('face', .95)); x0 = round(nx - side / 2); y0 = max(0, round(ny - side * .55))
face = Image.new('RGBA', (side, side), (28, 22, 36, 255)); face.alpha_composite(cell.crop((x0, y0, x0 + side, y0 + side)))
face.resize((96, 96), Image.LANCZOS).save(os.path.join(out, 'face.webp'), quality=85)

manifest = dict(id=C['id'], name=C['name'], author=C['author'], version=C.get('version', 1), **{'from': C['from']},
                cw=CW, ch=CH, fps=C.get('fps', 10), stand=C['stand'], scroll=C['scroll'], poses=C['poses'],
                face='face.webp', clips=dict(sorted(clips.items())))
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"{C['id']}: {CW}x{CH}, {sum(f.stat().st_size for f in os.scandir(out)) // 1024} KB")
