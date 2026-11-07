# Packs cut-out video frames into fixed-size transparent WebP sprite strips for the walking figure.
# Every frame is scaled by one body measure (top of head to top of skirt) and placed so the skirt
# sits on the same line, so she keeps her size and position across moves. The screen's bottom edge
# crops her just below the knee, the same way in every frame.
import sys, os, json, statistics as st
import numpy as np
from PIL import Image
from scipy import ndimage as nd

cut, out_img, out_js, skirt_json = sys.argv[1:5]
SK = json.load(open(skirt_json))
D = 200                  # head-top to skirt-top, px, in the packed cells
L0 = 0.52                # how much leg shows below the skirt (in units of D)
HEAD = 0.36              # headroom above the head for raised arms (units of D)
CH = round(D * (HEAD + 1 + L0)); CW = round(D * 0.95)
SKIRT_Y = CH - round(L0 * D)
FADE = np.clip(np.linspace(CH, 0, CH) / (CH * .06), 0, 1) ** 1.3
rng = lambda p, a, b: [f'{p}{i:03d}' for i in range(a, b + 1)]
CLIPS = {
    'strut': rng('a', 57, 66),
    'hips':  rng('a', 25, 41),
    'arms':  rng('a', 74, 92),
    'wave':  rng('b', 121, 160),
    'flip':  rng('b', 161, 189),
}

def clean(im):
    """Keep only her: the largest solid shape plus thin bits (fingers, nails, hair) close to it,
    then trim anything pole-thin sticking up above her head."""
    a = np.array(im); al = a[:, :, 3]
    core = nd.binary_opening(al > 60, structure=np.ones((9, 9)))
    lab, n = nd.label(core)
    if not n: return im
    keep = lab == (np.argmax(nd.sum(core, lab, range(1, n + 1))) + 1)
    al = np.where(nd.binary_dilation(keep, iterations=16), al, 0)
    a[:, :, 3] = al
    return Image.fromarray(a)

def trim_above(im, chest):
    """Walk up from her chest; once the shape gets thinner than a neck or arm for a stretch, it's no
    longer her (a light pole), so clear everything above that point."""
    a = np.array(im); al = a[:, :, 3]; cnt = (al > 60).sum(1)
    thin = 0
    for y in range(int(chest), -1, -1):
        thin = thin + 1 if cnt[y] < 34 else 0
        if thin >= 8: al[:y + 8] = 0; break
    a[:, :, 3] = al
    return Image.fromarray(a)

def centre_x(al, top, bot):
    m = al > 60
    band = m[top + int((bot - top) * .30): top + int((bot - top) * .62)]
    return float(np.average(np.arange(m.shape[1]), weights=band.sum(0) + 1e-6))

meta = {}
for name, ids in CLIPS.items():
    good = [(i, SK[f]) for i, f in enumerate(ids) if SK.get(f) and SK[f].get('skirt')]
    mt = st.median([r['top'] for _, r in good])
    d_clip = st.median([r['skirt'] - r['top'] for _, r in good if r['top'] > mt - 90])
    s = D / d_clip
    # skirt and crop-top lines for frames where they weren't detected: fill in from neighbouring frames
    xi = [i for i, _ in good]
    skirt_all = np.interp(range(len(ids)), xi, [r['skirt'] for _, r in good])
    chest_all = np.interp(range(len(ids)), xi, [r['pinktop'] for _, r in good])
    frames, dropped = [], 0
    for i, f in enumerate(ids):
        r = dict(skirt=float(skirt_all[i]))
        if (1280 - r['skirt']) * s < (L0 - .04) * D: dropped += 1; continue      # legs end too high
        im = trim_above(clean(Image.open(os.path.join(cut, f + '.png')).convert('RGBA')), chest_all[i])
        al = np.array(im)[:, :, 3]; ys = np.where((al > 60).any(1))[0]
        if not len(ys): dropped += 1; continue
        frames.append((f, im, r, centre_x(al, int(ys[0]), int(r['skirt']) + 200)))
    sk = [r['skirt'] for _, _, r, _ in frames]; sk = [st.mean(sk[max(0, i - 1): i + 2]) for i in range(len(sk))]
    cx = [c for *_, c in frames]; cx = [st.mean(cx[max(0, i - 2): i + 3]) for i in range(len(cx))]
    strip = Image.new('RGBA', (CW * len(frames), CH), (0, 0, 0, 0)); clipped = 0
    for i, (f, im, r, _) in enumerate(frames):
        sm = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        ox = round(CW / 2 - cx[i] * s); oy = round(SKIRT_Y - sk[i] * s)
        cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0)); cell.paste(sm, (ox, oy), sm)
        ca = np.array(cell)
        # count only what falls outside the cell above the leg line (legs below the cell are cropped on purpose)
        sa = np.array(sm)[:, :, 3] > 60
        tot = sa[max(0, -oy): max(0, CH - oy)].sum(); inside = (ca[:, :, 3] > 60).sum()
        if tot and inside / tot < .985: clipped += 1
        ca[:, :, 3] = (ca[:, :, 3] * FADE[:, None]).astype(np.uint8)
        strip.paste(Image.fromarray(ca), (i * CW, 0))
    p = os.path.join(out_img, name + '.webp')
    strip.save(p, 'WEBP', quality=80, alpha_quality=85, method=6)
    meta[name] = dict(n=len(frames), src=f'assets/img/walker/{name}.webp')
    print(f'{name}: {len(frames)} frames ({dropped} dropped), scale {s:.3f}, {os.path.getsize(p)//1024} KB, {clipped} clipped at cell edge')

with open(out_js, 'w', encoding='utf-8') as f:
    f.write('// Generated from her CLAWMONTANA TikTok (Oct 30, 2026): cut-out frames at 10 fps, one strip per move.\n')
    f.write('export const WALK = ' + json.dumps(dict(cw=CW, ch=CH, fps=10, clips=meta)) + ';\n')
print('wrote', out_js)
