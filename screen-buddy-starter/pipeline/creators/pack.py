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
    """Keep only her: the solid shape her torso is in (else the largest), then every confident pixel
    connected to it (fingers, nails, hair), plus a thin soft edge. Captions, background people, props
    and the faint half-transparent 'ghosts' rembg leaves of furniture behind her are dropped."""
    a = np.array(im); al = a[:, :, 3]
    core = nd.binary_opening(al > 200, structure=np.ones((9, 9)))
    lab, n = nd.label(core)
    if not n: return None
    # Motion blur can split her into pieces, so keep every piece a body landmark lands on.
    (sx, sy), (hx, hy) = mid(p, 'ls', 'rs'), mid(p, 'lh', 'rh')
    pts = [((sx + hx) / 2, (sy + hy) / 2), (sx, sy), (hx, hy)] + [p[q][:2] for q in ('nose', 'ls', 'rs', 'lh', 'rh', 'lk', 'rk')]
    ids = {lab[min(max(int(y), 0), lab.shape[0] - 1), min(max(int(x), 0), lab.shape[1] - 1)] for x, y in pts} - {0}
    keep = np.isin(lab, list(ids)) if ids else lab == np.argmax(nd.sum(core, lab, range(1, n + 1))) + 1
    k = im.width / 1080
    near = nd.binary_dilation(keep, iterations=max(6, round(16 * k)))
    solid, m = nd.label((al >= 140) & near)                      # confident pixels close to her...
    touching = np.unique(solid[keep & (solid > 0)])              # ...that are connected to her body
    body = np.isin(solid, touching) | keep
    al = np.where(nd.binary_dilation(body, iterations=max(2, round(4 * k))), al, 0)   # soft edge
    if C.get('drop_dark'): al = drop_dark(a, al, p)
    a[:, :, 3] = al
    return Image.fromarray(a)

def drop_dark(a, al, p):
    """Opt-in (config "drop_dark"): removes large near-black, colourless patches beside her body below
    the shoulders, e.g. a black car tyre right behind her hand that the cut-out model counts as part of
    her. Her face and hair (above the shoulders), dark clothing on her torso and hips, and small dark
    bits such as nails and bracelets are kept."""
    rgb = a[:, :, :3].astype(np.int16); v = rgb.max(2); sat = (v - rgb.min(2)) / np.maximum(v, 1)
    t = torso(p); h, w = al.shape
    sy = int(min(p['ls'][1], p['rs'][1])); hy = int(max(p['lh'][1], p['rh'][1]))
    xs = [p[q][0] for q in ('ls', 'rs', 'lh', 'rh')]; hx = [p['lh'][0], p['rh'][0]]
    body = np.zeros((h, w), bool)                                    # where her clothes can be
    body[:max(0, sy), :] = True                                      # head and hair: never touched
    body[max(0, sy): max(0, hy), max(0, int(min(xs) - .15 * t)): max(0, int(max(xs) + .15 * t))] = True
    body[max(0, hy):, max(0, int(min(hx) - .45 * t)): max(0, int(max(hx) + .45 * t))] = True
    lab, n = nd.label((v < 80) & (sat < .4) & (al > 0) & ~body)
    if not n: return al
    big = np.flatnonzero(nd.sum(np.ones_like(lab), lab, range(1, n + 1)) > (.15 * t) ** 2) + 1
    return np.where(nd.binary_dilation(np.isin(lab, big), iterations=3), 0, al)

def smooth(v, r): return [st.mean(v[max(0, i - r): i + r + 1]) for i in range(len(v))]

if os.path.exists(out): shutil.rmtree(out)
os.makedirs(out)
def frame_ids(name):
    a, b = C['clips'][name]; skip = set(C.get('drop', {}).get(name, []))
    ids = [f'a{i:03d}' for i in range(int(a[1:]), int(b[1:]) + 1)]
    return [f for f in ids if f not in skip and f in P and os.path.exists(os.path.join(cut, f + '.png'))]

# One scale per move from its torso length; upright frames set it, not crouches. A move that is mostly
# crouching (torso foreshortened) borrows the scale of a neighbouring upright move ("scale_like").
SCALE = {n: T / float(np.percentile([torso(P[f]) for f in frame_ids(n)], 70)) for n in C['clips']}
SCALE |= {n: SCALE[other] for n, other in C.get('scale_like', {}).items()}

clips, stand_info = {}, None
for name in C['clips']:
    ids = frame_ids(name); s = SCALE[name]
    frames, dropped = [], 0
    for f in ids:
        p = P[f]; hip = mid(p, 'lh', 'rh')
        if (p['h'] - hip[1]) * s < (C['legs'] - .04) * T: dropped += 1; continue      # legs end too high
        im = clean(Image.open(os.path.join(cut, f + '.png')).convert('RGBA'), p)
        if im is None: dropped += 1; continue
        cx = (mid(p, 'ls', 'rs')[0] + hip[0]) / 2
        frames.append((f, im, hip[1], cx, p['nose']))
    # A frame whose cut-out is far smaller than the rest of the move lost part of her: drop it.
    area = [(np.array(im)[:, :, 3] > 60).sum() for _, im, *_ in frames]; med = st.median(area)
    keep_n = [i for i, ar in enumerate(area) if ar >= .6 * med]
    dropped += len(frames) - len(keep_n); frames = [frames[i] for i in keep_n]
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
