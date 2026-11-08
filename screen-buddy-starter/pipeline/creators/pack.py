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
#
# Group buddies ("people": N in the config, pose.py run with the same N): every person is kept, the scale
# comes from their average torso, the average hip line is pinned and the group is centred as a whole.
# Frames where pose detection didn't find all N people are dropped.
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

PEOPLE = C.get('people', 1)

def mid(p, a, b): return ((p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2)
def torso1(p):
    (sx, sy), (hx, hy) = mid(p, 'ls', 'rs'), mid(p, 'lh', 'rh')
    return float(np.hypot(sx - hx, sy - hy))
def persons(f): return P[f].get('people', [P[f]])
def torso(f): return st.mean(torso1(p) for p in persons(f))
def hip_y(f): return st.mean(mid(p, 'lh', 'rh')[1] for p in persons(f))
def centre_x(f): return st.mean((mid(p, 'ls', 'rs')[0] + mid(p, 'lh', 'rh')[0]) / 2 for p in persons(f))
def nose(f): return [st.mean(p['nose'][i] for p in persons(f)) for i in (0, 1)]

STATIC = C.get('static', False)

def clean(im, ps):
    if STATIC: return clean1(im, None)
    a = np.array(im); al = np.zeros(a.shape[:2], np.uint8)
    for p in ps:
        one = clean1(im, p)
        if one is not None: al = np.maximum(al, np.array(one)[:, :, 3])
    if not al.any(): return None
    a[:, :, 3] = al
    return Image.fromarray(a)

def clean1(im, p):
    """Keep only her: the solid shape her torso is in (else the largest), then every confident pixel
    connected to it (fingers, nails, hair), plus a thin soft edge. Captions, background people, props
    and the faint half-transparent 'ghosts' rembg leaves of furniture behind her are dropped."""
    a = np.array(im); al = a[:, :, 3]
    core = nd.binary_opening(al > 200, structure=np.ones((9, 9)))
    lab, n = nd.label(core)
    if not n: return None
    sizes = nd.sum(core, lab, range(1, n + 1))
    if p is None:   # static group: every large piece is a dancer (pose detection may have missed some)
        keep = np.isin(lab, np.flatnonzero(sizes >= .15 * sizes.max()) + 1)
    else:           # motion blur can split her into pieces, so keep every piece a body landmark lands on
        (sx, sy), (hx, hy) = mid(p, 'ls', 'rs'), mid(p, 'lh', 'rh')
        pts = [((sx + hx) / 2, (sy + hy) / 2), (sx, sy), (hx, hy)] + [p[q][:2] for q in ('nose', 'ls', 'rs', 'lh', 'rh', 'lk', 'rk')]
        ids = {lab[min(max(int(y), 0), lab.shape[0] - 1), min(max(int(x), 0), lab.shape[1] - 1)] for x, y in pts} - {0}
        keep = np.isin(lab, list(ids)) if ids else lab == np.argmax(sizes) + 1
    k = im.width / 1080
    near = nd.binary_dilation(keep, iterations=max(6, round(16 * k)))
    solid, m = nd.label((al >= 140) & near)                      # confident pixels close to her...
    touching = np.unique(solid[keep & (solid > 0)])              # ...that are connected to her body
    body = np.isin(solid, touching) | keep
    al = np.where(nd.binary_dilation(body, iterations=max(2, round(4 * k))), al, 0)   # soft edge
    if C.get('drop_dark') and p is not None: al = drop_dark(a, al, p)
    if C.get('skeleton') and p is not None and 'la' in p: al = np.where(skeleton_mask(p, al.shape), al, 0)
    a[:, :, 3] = al
    return Image.fromarray(a)

def skeleton_mask(p, shape):
    """Opt-in (config "skeleton": {"arm": .., "leg": .., "head": ..}, widths in torso lengths): a generous
    outline of her body drawn from the pose landmarks, e.g. to cut away a chair that sits right behind
    her on a fixed camera. Anything the cut-out model kept outside this outline is removed."""
    from PIL import ImageDraw
    t = torso1(p); k = C['skeleton']; img = Image.new('L', (shape[1], shape[0]), 0); d = ImageDraw.Draw(img)
    xy = lambda q: tuple(p[q][:2])
    def limb(*qs, w):
        d.line([xy(q) for q in qs], fill=255, width=max(2, round(w * t)), joint='curve')
        for q in qs: r = w * t / 2; d.ellipse((p[q][0] - r, p[q][1] - r, p[q][0] + r, p[q][1] + r), fill=255)
    d.polygon([xy('ls'), xy('rs'), xy('rh'), xy('lh')], fill=255)
    limb('ls', 'rs', w=k.get('arm', .45)); limb('lh', 'rh', w=k.get('leg', .7))
    for s in 'lr':
        limb(f'{s}s', f'{s}e', f'{s}w', w=k.get('arm', .45))
        limb(f'{s}h', f'{s}k', f'{s}a', f'{s}f', w=k.get('leg', .7))
    if k.get('hand'):   # whatever she holds, e.g. pom-poms
        for q in ('lw', 'rw'): r = k['hand'] * t / 2; d.ellipse((p[q][0] - r, p[q][1] - r, p[q][0] + r, p[q][1] + r), fill=255)
    nx, ny = p['nose'][:2]; r = k.get('head', .8) * t
    d.ellipse((nx - r, ny - r * 1.15, nx + r, ny + r * .85), fill=255)                  # head and hair
    limb('nose', 'ls', w=k.get('arm', .45)); limb('nose', 'rs', w=k.get('arm', .45))   # neck
    return nd.binary_dilation(np.array(img) > 0, iterations=max(2, round(.08 * t)))

def drop_dark(a, al, p):
    """Opt-in (config "drop_dark"): removes large near-black, colourless patches beside her body below
    the shoulders, e.g. a black car tyre right behind her hand that the cut-out model counts as part of
    her. Her face and hair (above the shoulders), dark clothing on her torso and hips, and small dark
    bits such as nails and bracelets are kept."""
    rgb = a[:, :, :3].astype(np.int16); v = rgb.max(2); sat = (v - rgb.min(2)) / np.maximum(v, 1)
    t = torso1(p); h, w = al.shape
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
    return [f for f in ids if f not in skip and f in P and (STATIC or len(persons(f)) == PEOPLE)
            and os.path.exists(os.path.join(cut, f + '.png'))]

# One scale per move from its torso length; upright frames set it, not crouches. A move that is mostly
# crouching (torso foreshortened) borrows the scale of a neighbouring upright move ("scale_like").
SCALE = {n: T / float(np.percentile([torso(f) for f in frame_ids(n)], 70)) for n in C['clips']}
SCALE |= {n: SCALE[other] for n, other in C.get('scale_like', {}).items()}

clips, stand_info, first_info = {}, None, {}
for name in C['clips']:
    ids = frame_ids(name); s = SCALE[name]
    frames, dropped = [], 0
    for f in ids:
        hy0 = hip_y(f)
        if (P[f]['h'] - hy0) * s < (C['legs'] - .04) * T: dropped += 1; continue      # legs end too high
        im = clean(Image.open(os.path.join(cut, f + '.png')).convert('RGBA'), persons(f))
        if im is None: dropped += 1; continue
        frames.append((f, im, hy0, centre_x(f), nose(f)))
    if not frames: print(f'{name}: no usable frames, skipped'); continue
    # A frame whose cut-out is far smaller than the rest of the move lost part of her: drop it.
    area = [(np.array(im)[:, :, 3] > 60).sum() for _, im, *_ in frames]; med = st.median(area)
    keep_n = [i for i, ar in enumerate(area) if ar >= .6 * med]
    dropped += len(frames) - len(keep_n); frames = [frames[i] for i in keep_n]
    if STATIC:   # tripod shot: one placement for the whole move, centred on the cut-out itself
        xs = [np.average(np.arange(im.width), weights=(np.array(im)[:, :, 3] > 60).sum(0) + 1e-6) for _, im, *_ in frames]
        hy = [st.median(h for _, _, h, _, _ in frames)] * len(frames); cx = [st.median(xs)] * len(frames)
    else:
        hy = smooth([h for _, _, h, _, _ in frames], 1); cx = smooth([c for *_, c, _ in frames], 2)
    # The camera zooms during the move (torso size drifts over 12%): follow it, smoothed, instead of one scale,
    # so she keeps her size. Crouches are short dips, which the wide smoothing window mostly ignores.
    ts = [torso(f) for f, *_ in frames]
    zoom = not STATIC and len(ts) > 4 and max(smooth(ts, 4)) > 1.12 * min(smooth(ts, 4))
    scales = [T / t for t in smooth(ts, 4)] if zoom else [s] * len(frames)
    strip = Image.new('RGBA', (CW * len(frames), CH), (0, 0, 0, 0)); clipped = 0
    for i, (f, im, _, _, nz) in enumerate(frames):
        s = scales[i]
        sm = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        ox = round(CW / 2 - cx[i] * s); oy = round(HIP_Y - hy[i] * s)
        cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0)); cell.paste(sm, (ox, oy), sm)
        ca = np.array(cell)
        sa = np.array(sm)[:, :, 3] > 60
        tot = sa[max(0, -oy): max(0, CH - oy)].sum(); inside = (ca[:, :, 3] > 60).sum()
        if tot and inside / tot < .985: clipped += 1
        ca[:, :, 3] = (ca[:, :, 3] * FADE[:, None]).astype(np.uint8)
        strip.paste(Image.fromarray(ca), (i * CW, 0))
        if [name, i] == C['stand'] or i == 0:
            spread = max(p['nose'][0] for p in persons(f)) - min(p['nose'][0] for p in persons(f))
            info = (Image.fromarray(ca), ox + nz[0] * s, oy + nz[1] * s, spread * s)
            if i == 0: first_info[name] = info
            if [name, i] == C['stand']: stand_info = info
    strip.save(os.path.join(out, name + '.webp'), 'WEBP', quality=80, alpha_quality=85, method=6)
    clips[name] = dict(n=len(frames), src=f'{name}.webp')
    print(f'{name}: {len(frames)} frames ({dropped} dropped), scale {s:.3f}, '
          f'{os.path.getsize(os.path.join(out, name + ".webp")) // 1024} KB, {clipped} clipped at cell edge')

# Face thumbnail for the picker: a square around her head (a group: around all their heads) in the
# standing frame, on a dark backdrop.
if not clips: sys.exit('No move has any usable frames.')
if stand_info is None:   # its frame was dropped: stand on the first frame of that move (or of the first move left)
    C['stand'] = [C['stand'][0] if C['stand'][0] in clips else next(iter(clips)), 0]
    stand_info = first_info[C['stand'][0]]
C['scroll'] = C['scroll'] if C['scroll'] in clips else C['stand'][0]
C['poses'] = [m for m in C['poses'] if m in clips] or [C['scroll']]
cell, nx, ny, spread = stand_info
side = round(T * C.get('face', .95) + spread); x0 = round(nx - side / 2); y0 = max(0, round(ny - side * .55))
if PEOPLE > 1:   # a strip of all their faces: the band below the top of the tallest head, letterboxed
    m = np.array(cell)[:, :, 3] > 60; top = int(np.flatnonzero(m.any(1))[0])
    band = np.flatnonzero(m[top: top + round(T * 1.2)].any(0))
    x0, x1 = int(band[0] - T * .15), int(band[-1] + T * .15); y0 = max(0, top - round(T * .1))
    strip_ = cell.crop((x0, y0, x1, y0 + round(T * 1.7)))   # tall enough for the shortest one's face
    strip_ = strip_.resize((96, max(1, round(96 * strip_.height / strip_.width))), Image.LANCZOS)
    face = Image.new('RGBA', (96, 96), (28, 22, 36, 255)); face.alpha_composite(strip_, (0, (96 - strip_.height) // 2))
else:
    face = Image.new('RGBA', (side, side), (28, 22, 36, 255)); face.alpha_composite(cell.crop((x0, y0, x0 + side, y0 + side)))
    face = face.resize((96, 96), Image.LANCZOS)
face.save(os.path.join(out, 'face.webp'), quality=85)

manifest = dict(id=C['id'], name=C['name'], author=C['author'], version=C.get('version', 1), **{'from': C['from']},
                cw=CW, ch=CH, fps=C.get('fps', 10), stand=C['stand'], scroll=C['scroll'], poses=C['poses'],
                face='face.webp', clips=dict(sorted(clips.items())))
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f"{C['id']}: {CW}x{CH}, {sum(f.stat().st_size for f in os.scandir(out)) // 1024} KB")
