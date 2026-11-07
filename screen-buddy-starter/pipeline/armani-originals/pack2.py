# Packs the "Body" Snapchat dance (static camera, plain wall) into transparent WebP strips.
# The camera doesn't move in the wide shots, so every frame shares one scale and one floor line:
# her jumps and kicks stay real and she never jitters. Each frame is centred on her hips.
import sys, os, glob, json, statistics as st
import numpy as np
from PIL import Image
from scipy import ndimage as nd

cut, out_dir = sys.argv[1], sys.argv[2]
TH = 300                              # standing height in the cell, px
CH = round(TH * 1.22); CW = round(TH * 0.80)
FLOOR = CH - 4

from PIL import ImageEnhance
def overlay_mask(paths):
    """Snapchat's "Snapchat @armaniwesttt" watermark is the only thing near the top that stays exactly
    the same through a whole section (the camera is still, she keeps moving): find those pixels."""
    stack = np.stack([np.array(Image.open(p).convert('RGBA')).astype(np.float32) for p in paths])
    H, W = stack.shape[1:3]
    fg = (stack[..., 3] > 60).mean(0)
    sd = stack[..., :3].std(0).mean(-1)
    zone = np.zeros((H, W), bool); zone[: int(H * .26), int(W * .08): int(W * .60)] = True
    return nd.binary_dilation(zone & (fg > .6) & (sd < 16), iterations=2) & zone

def unmark(im, _=None):
    """Remove Snapchat's "Snapchat @armaniwesttt" watermark: find its bright white lettering near the
    top, box the whole block, clear the box, and redraw her only where her arm or hair clearly runs
    through it (bridged from her pixels on either side). Then lift the dim video."""
    a = np.array(im).astype(int); H, W = a.shape[:2]
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    zone = np.zeros((H, W), bool); zone[: int(H * .30), int(W * .05): int(W * .65)] = True
    core = zone & (mn > 205) & (mx - mn < 35)
    lab, n = nd.label(nd.binary_dilation(core, iterations=5))
    box = np.zeros((H, W), bool)
    for sl in nd.find_objects(lab):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if w >= 16 or h >= 14:
            box[max(0, sl[0].start - 6): sl[0].stop + 6, max(0, sl[1].start - 6): sl[1].stop + 6] = True
    if box.any():
        # Inside the box: letters = white strokes plus their dark outline; wall = light beige; the rest is her.
        letters = nd.binary_dilation(core, iterations=3) & box
        # the letters' soft shadow on the wall: colourless grey right next to a letter
        shade = (mx - mn < 26) & (mn > 60) & nd.binary_dilation(letters, iterations=5)
        wall = box & (((mn > 150) & (mx - mn < 70)) | shade) & ~letters
        her = (a[:, :, 3] > 60) & ~letters & ~(wall)
        redraw = nd.binary_closing(her, structure=np.ones((3, 3)), iterations=5) & letters
        idx = nd.distance_transform_edt(~her, return_indices=True)[1]
        for c in range(4): a[:, :, c] = np.where(redraw, a[:, :, c][idx[0], idx[1]], a[:, :, c])
        a[:, :, 3] = np.where(box & ~(her | redraw), 0, a[:, :, 3])
    out = Image.fromarray(a.astype(np.uint8))
    rgb, al = out.convert('RGB'), out.getchannel('A')
    rgb = Image.eval(rgb, lambda v: int(255 * (v / 255) ** .78))            # open up the shadows
    rgb = ImageEnhance.Color(ImageEnhance.Contrast(rgb).enhance(1.06)).enhance(1.12)
    out = rgb.convert('RGBA'); out.putalpha(al)
    return out

def clean(im, mark=None):
    im = unmark(im, mark)
    a = np.array(im); al = a[:, :, 3]
    core = nd.binary_opening(al > 60, structure=np.ones((5, 5)))
    lab, n = nd.label(core)
    if not n: return im, None
    keep = lab == (np.argmax(nd.sum(core, lab, range(1, n + 1))) + 1)
    al = np.where(nd.binary_dilation(keep, iterations=10), al, 0)
    a[:, :, 3] = al
    return Image.fromarray(a), al > 60

frames = {}
paths = sorted(glob.glob(os.path.join(cut, '*.png')))
marks = {n: overlay_mask([p for p in paths if os.path.basename(p).startswith(n + '_')])
         for n in {os.path.basename(p).split('_')[0] for p in paths}}
for p in paths:
    name, num = os.path.basename(p)[:-4].split('_')
    im, m = clean(Image.open(p).convert('RGBA'), marks[name])
    if m is None or not m.any(): continue
    ys = np.where(m.any(1))[0]
    frames.setdefault(name, []).append(dict(num=int(num), im=im, m=m, top=int(ys[0]), bot=int(ys[-1])))

allf = [f for v in frames.values() for f in v]
floor = st.median([f['bot'] for f in allf])
H0 = st.median([f['bot'] - f['top'] for f in frames['groove']])
s = TH / H0
print(f'floor y={floor}, standing height={H0}px, scale={s:.3f}, frames={len(allf)}')

meta = {}
os.makedirs(out_dir, exist_ok=True)
for name, fs in frames.items():
    fs.sort(key=lambda f: f['num'])
    cx = []
    for f in fs:
        band = f['m'][int(floor - .62 * H0): int(floor - .40 * H0)]
        cx.append(float(np.average(np.arange(band.shape[1]), weights=band.sum(0) + 1e-6)))
    cx = [st.mean(cx[max(0, i - 2): i + 3]) for i in range(len(cx))]
    strip = Image.new('RGBA', (CW * len(fs), CH), (0, 0, 0, 0)); clipped = 0
    for i, f in enumerate(fs):
        sm = f['im'].resize((round(f['im'].width * s), round(f['im'].height * s)), Image.LANCZOS)
        ox = round(CW / 2 - cx[i] * s); oy = round(FLOOR - floor * s)
        cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0)); cell.paste(sm, (ox, oy), sm)
        if (np.array(cell)[:, :, 3] > 60).sum() < .98 * (np.array(sm)[:, :, 3] > 60).sum(): clipped += 1
        strip.paste(cell, (i * CW, 0))
    p = os.path.join(out_dir, name + '.webp')
    strip.save(p, 'WEBP', quality=82, alpha_quality=88, method=6)
    meta[name] = dict(n=len(fs), src=p.replace('\\', '/').split('ArmaniWest/')[-1])
    print(f'{name}: {len(fs)} frames, {os.path.getsize(p)//1024} KB, {clipped} clipped at cell edge')
json.dump(dict(cw=CW, ch=CH, fps=10, clips=meta), open(os.path.join(out_dir, 'meta.json'), 'w'))
