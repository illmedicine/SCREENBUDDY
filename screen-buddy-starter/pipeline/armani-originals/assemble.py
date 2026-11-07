# Builds assets/js/walker-data.js (all on-page characters) and a face thumbnail for each.
import json, re, sys
import numpy as np
from PIL import Image
old = json.loads(re.search(r'= (\{.*\});', open('assets/js/walker-data.js', encoding='utf-8').read()).group(1)) if 'WALK =' in open('assets/js/walker-data.js', encoding='utf-8').read() else None
claw = old or json.load(open('assets/img/walker/claw/meta.json'))
for k, c in claw['clips'].items(): c['src'] = f'assets/img/walker/claw/{k}.webp'
json.dump(claw, open('assets/img/walker/claw/meta.json', 'w'))
body = json.load(open('assets/img/walker/body/meta.json'))
CH = {
  'claw': dict(name='Clawmontana', **{'from': 'Monster High · TikTok'}, stand=['hips', 0], scroll='strut', poses=['hips', 'arms', 'wave', 'flip'], **claw),
  'body': dict(name='Body', **{'from': 'Dance studio · Snapchat'}, stand=[sys.argv[1], int(sys.argv[2])], scroll=sys.argv[3], poses=sys.argv[4].split(','), **body),
}
for k, c in CH.items():
    clip, i = c['stand']; s = Image.open(c['clips'][clip]['src']); cw, ch = c['cw'], c['ch']
    cell = s.crop((i * cw, 0, i * cw + cw, ch)); a = np.array(cell)[:, :, 3] > 60
    ys = np.where(a.any(1))[0]; top = ys[0]; xs = np.where(a[top: top + int(ch * .12)].any(0))[0]; cx = int(xs.mean())
    side = int(ch * .19); box = (cx - side // 2, max(0, top - 4), cx + side // 2, max(0, top - 4) + side)
    face = Image.new('RGBA', (side, side), (28, 22, 36, 255)); crop = cell.crop(box); face.alpha_composite(crop)
    face.resize((96, 96), Image.LANCZOS).save(f'assets/img/walker/{k}/face.webp', quality=85)
    c['face'] = f'assets/img/walker/{k}/face.webp'
with open('assets/js/walker-data.js', 'w', encoding='utf-8') as f:
    f.write('// The on-page Armani characters, cut out of her own videos at 10 fps (one transparent strip per move).\n')
    f.write('// claw: her CLAWMONTANA TikTok (Oct 30, 2026). body: her "Body" dance Snapchat.\n')
    f.write('export const CHARACTERS = ' + json.dumps(CH, ensure_ascii=False, indent=1) + ';\n')
print({k: (c['stand'], c['scroll'], c['poses']) for k, c in CH.items()})
