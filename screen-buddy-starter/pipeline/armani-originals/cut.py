import sys, os, glob, time
from rembg import remove, new_session
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
s = new_session(sys.argv[3] if len(sys.argv) > 3 else 'isnet-general-use')
fs = sorted(glob.glob(os.path.join(src, '*.jpg'))); t0 = time.time()
for i, f in enumerate(fs):
    o = os.path.join(dst, os.path.basename(f)[:-4] + '.png')
    if os.path.exists(o): continue
    remove(Image.open(f).convert('RGB'), session=s).save(o)
    if i % 10 == 0: print(i, len(fs), round(time.time() - t0), flush=True)
print('done', round(time.time() - t0), flush=True)
