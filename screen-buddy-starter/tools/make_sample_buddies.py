"""Converts the two ArmaniWest web characters into Screen Buddy packages.

Usage: python tools/make_sample_buddies.py <ArmaniWest repo> <output dir> [--web]

Writes <output dir>/<id>/{manifest.json, face.webp, <move>.webp}. With --web (for the website) it also writes
a matching <id>.zip next to each folder, and an index.json listing the ids.
The strips are copied byte for byte; only the manifest is new (same shape as walker-data.js, plus
id / author / version, and `src` is the bare file name inside the package).
"""
import json, re, shutil, sys, zipfile
from pathlib import Path

repo, out = Path(sys.argv[1]), Path(sys.argv[2])
web = '--web' in sys.argv[3:]
text = (repo / 'assets/js/walker-data.js').read_text(encoding='utf-8')
chars = json.loads(re.search(r'CHARACTERS = (\{.*\});', text, re.S).group(1))

for key, c in chars.items():
    d = out / key
    if d.exists(): shutil.rmtree(d)
    d.mkdir(parents=True)
    clips = {}
    for move, clip in c['clips'].items():
        shutil.copy(repo / clip['src'], d / f'{move}.webp')
        clips[move] = dict(n=clip['n'], src=f'{move}.webp')
    shutil.copy(repo / c['face'], d / 'face.webp')
    manifest = dict(
        id=key, name=c['name'], author='Armani West', version=1, **{'from': c['from']},
        cw=c['cw'], ch=c['ch'], fps=c['fps'], stand=c['stand'], scroll=c['scroll'],
        poses=c['poses'], face='face.webp', clips=clips)
    (d / 'manifest.json').write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding='utf-8')
    if web:   # the website also offers each package as a downloadable .zip and lists them in index.json
        with zipfile.ZipFile(out / f'{key}.zip', 'w', zipfile.ZIP_STORED) as z:
            for f in sorted(d.iterdir()): z.write(f, f.name)
    print(key, c['name'], sum(f.stat().st_size for f in d.iterdir()) // 1024, 'KB')
if web:
    (out / 'index.json').write_text(json.dumps(dict(buddies=sorted(chars))), encoding='utf-8')
