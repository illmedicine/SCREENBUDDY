import sys, glob, os, json, colorsys
import numpy as np
from PIL import Image
sys.argv = ['x', 'cut', '.', '.']
from scipy import ndimage as nd
src=open('bin/pack.py', encoding='utf-8').read()
exec(src[src.index('def clean'):src.index('def centre_x')])
def measure(al):
    m = al > 60; ys = np.where(m.any(1))[0]
    top, bot = ys[0], ys[-1]
    band = m[top + int((bot - top) * .30): top + int((bot - top) * .62)]
    return dict(top=int(top), cx=float(np.average(np.arange(m.shape[1]), weights=band.sum(0) + 1e-6)))
out = {}
for p in sorted(glob.glob('cut/*.png')):
    fid = os.path.basename(p)[:-4]
    im = clean(Image.open(p).convert('RGBA')); a = np.array(im); al = a[:, :, 3] > 60
    m = measure(a[:, :, 3])
    hsv = np.array(im.convert('RGB').convert('HSV')).astype(int)
    purple = (hsv[:, :, 0] > 165) & (hsv[:, :, 0] < 200) & (hsv[:, :, 1] > 70) & al   # PIL hue 0-255: purple ~ 180
    pink = ((hsv[:, :, 0] > 210) | (hsv[:, :, 0] < 8)) & (hsv[:, :, 1] > 60) & (hsv[:, :, 2] > 120) & al
    cx = int(m['cx']); band = slice(max(0, cx - 50), cx + 50)
    pr = purple[:, band].mean(1); kr = pink[:, band].mean(1)
    # crop top = lowest row band with lots of pink; skirt top = first row below it that is mostly purple
    pinks = np.where(kr > .35)[0]
    if not len(pinks): out[fid] = None; continue
    ptop = int(pinks[0]); gaps = np.where(np.diff(pinks) > 25)[0]
    pbot = int(pinks[gaps[0]] if len(gaps) else pinks[-1])
    if pbot - ptop < 40: out[fid] = None; continue
    sk = [y for y in range(pbot, 1280) if pr[y] > .5]
    out[fid] = dict(top=m['top'], pinktop=ptop, pinkbot=pbot, skirt=int(sk[0]) if sk else None)
json.dump(out, open('skirt.json', 'w'))
for k, v in out.items(): print(k, v)
