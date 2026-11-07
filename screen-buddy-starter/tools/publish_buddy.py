"""Publishes a finished buddy package into every Screen Buddy platform, from inside this repo.

Usage:
  python tools/publish_buddy.py <package folder or .zip> [--replace] [--only web android windows] [--root <repo root>]

A package is a folder (or zip) holding manifest.json, face.webp and one <move>.webp strip per move: what the pipeline
in pipeline/creators produces. This script checks it with the same rules the apps use, then copies it to

  web/buddies/<id>/ (+ <id>.zip, and the id is added to web/buddies/index.json)
  android/app/src/main/assets/buddies/<id>/
  windows/src/ScreenBuddy.App/buddies/<id>/

so all platforms always have the same characters. It never touches any other repo and does not run git:
commit and push the result yourself (pushing main redeploys the web player).
"""
import argparse, json, re, shutil, sys, tempfile, zipfile
from pathlib import Path

ID = re.compile(r'^[a-z0-9][a-z0-9_-]{0,63}$')
MOVE = re.compile(r'^[A-Za-z0-9_-]{1,32}$')
FILE = re.compile(r'^[A-Za-z0-9_-]{1,64}\.webp$')
MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES = 40, 8 * 1024 * 1024, 40 * 1024 * 1024

TARGETS = {
    'web': 'web/buddies',
    'android': 'android/app/src/main/assets/buddies',
    'windows': 'windows/src/ScreenBuddy.App/buddies',
}


def fail(msg):
    sys.exit(f'publish_buddy: {msg}')


def validate(folder: Path) -> dict:
    """Same limits as BuddyManifest / BuddyLibrary in the apps. Returns the manifest."""
    mf = folder / 'manifest.json'
    if not mf.is_file(): fail('manifest.json is missing')
    try: m = json.loads(mf.read_text(encoding='utf-8'))
    except ValueError as e: fail(f'manifest.json is not valid JSON: {e}')
    files = [p for p in folder.iterdir()]
    if any(p.is_dir() for p in files): fail('the package must be flat (no sub-folders)')
    if len(files) > MAX_FILES: fail(f'more than {MAX_FILES} files')
    if sum(p.stat().st_size for p in files) > MAX_TOTAL_BYTES: fail('package is larger than 40 MB')

    def need(cond, msg):
        if not cond: fail(msg)

    need(isinstance(m.get('id'), str) and ID.match(m['id']), 'id must be lowercase letters, digits, - or _ (max 64)')
    need(isinstance(m.get('name'), str) and m['name'].strip(), 'name is missing')
    for k, lo, hi in (('cw', 16, 2048), ('ch', 16, 2048), ('fps', 1, 60)):
        need(isinstance(m.get(k), int) and lo <= m[k] <= hi, f'{k} must be a whole number from {lo} to {hi}')
    clips = m.get('clips')
    need(isinstance(clips, dict) and clips, 'clips is missing')
    for move, c in clips.items():
        need(MOVE.match(move), f'bad move name {move!r}')
        need(isinstance(c, dict) and isinstance(c.get('n'), int) and 1 <= c['n'] <= 400, f'{move}: n must be 1 to 400')
        need(isinstance(c.get('src'), str) and FILE.match(c['src']), f'{move}: src must be a bare name like walk.webp')
    for key in ('scroll',):
        need(m.get(key) in clips, f'{key} must name a move')
    need(isinstance(m.get('poses'), list) and all(p in clips for p in m['poses']), 'poses must name moves')
    stand = m.get('stand')
    need(isinstance(stand, list) and len(stand) == 2 and stand[0] in clips and isinstance(stand[1], int)
         and 0 <= stand[1] < clips[stand[0]]['n'], 'stand must be [move, frame] with the frame in range')
    face = m.get('face')
    names = {c['src'] for c in clips.values()} | ({face} if face else set())
    for n in names:
        need(FILE.match(n), f'bad file name {n!r}')
        p = folder / n
        need(p.is_file(), f'{n} is listed but missing')
        need(p.stat().st_size <= MAX_FILE_BYTES, f'{n} is larger than 8 MB')
        h = p.read_bytes()[:12]
        need(h[:4] == b'RIFF' and h[8:12] == b'WEBP', f'{n} is not a WebP image')
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('package')
    ap.add_argument('--replace', action='store_true', help='overwrite a buddy that is already published')
    ap.add_argument('--only', nargs='+', choices=sorted(TARGETS), help='publish to these platforms only (default: all)')
    ap.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1],
                    help='the screen-buddy-starter folder (default: this repo)')
    a = ap.parse_args()

    src = Path(a.package)
    tmp = None
    if src.is_file() and src.suffix.lower() == '.zip':
        tmp = tempfile.TemporaryDirectory()
        with zipfile.ZipFile(src) as z:
            for info in z.infolist():
                if '/' in info.filename or '\\' in info.filename or info.filename.startswith('.'):
                    fail(f'unsafe path in zip: {info.filename}')
                if info.file_size > MAX_FILE_BYTES: fail(f'{info.filename} is larger than 8 MB')
            z.extractall(tmp.name)
        src = Path(tmp.name)
    if not src.is_dir(): fail('give a package folder or a .zip')
    m = validate(src)
    bid = m['id']

    platforms = a.only or sorted(TARGETS)
    for p in platforms:
        dest = a.root / TARGETS[p] / bid
        if dest.exists() and not a.replace:
            fail(f'{bid} is already published to {p} ({dest}). Use --replace to overwrite it.')
    for p in platforms:
        base = a.root / TARGETS[p]
        dest = base / bid
        if dest.exists(): shutil.rmtree(dest)
        base.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dest)
        if p == 'web':
            with zipfile.ZipFile(base / f'{bid}.zip', 'w', zipfile.ZIP_STORED) as z:
                for f in sorted(dest.iterdir()): z.write(f, f.name)
            idx = base / 'index.json'
            ids = set(json.loads(idx.read_text(encoding='utf-8')).get('buddies', [])) if idx.exists() else set()
            ids.add(bid)
            idx.write_text(json.dumps(dict(buddies=sorted(ids))), encoding='utf-8')
        print(f'{bid}: published to {p} -> {dest}')
    if tmp: tmp.cleanup()
    print('Done. Review with git status, then commit and push.')


if __name__ == '__main__':
    main()
