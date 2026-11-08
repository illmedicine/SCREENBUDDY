# The processing worker: Firebase Functions (Python, 2nd gen) that turn queued videos into buddies.
# Deployed from this folder (firebase.json "functions"), so creators/autobuddy.py, pose.py and pack.py are the very same
# code used by hand. See queue/README.md for the data contract.
#
#   jobs/{jobId}                    the admin's "Add buddy" form (shared buddies). On success the package goes to
#                                   Storage buddies/shared/{buddyId}/ and catalog/{buddyId} lists it, so every app picks
#                                   it up without a new release.
#   users/{uid}/characters/{cid}    a person's own buddy (status 'queued'). On success the package goes to
#                                   buddies/{uid}/{cid}/ and the character gets packagePath. On failure the buddy they
#                                   paid for is refunded.
#
# Both write progress: {stage, pct} while they work, so the admin page and the dashboard show a live progress bar.
import os, re, sys, time, shutil, tempfile, traceback, json, urllib.request
from firebase_functions import firestore_fn, options
from firebase_admin import initialize_app, firestore, storage

initialize_app()
BUCKET = 'screen-buddy-f968b.firebasestorage.app'
SITE = 'https://screenbuddy.web.app'
CACHE = '/tmp/sb-models'          # models download once per instance
RUN = dict(region='us-central1', memory=options.MemoryOption.GB_8, cpu=4, timeout_sec=540,
           max_instances=3, concurrency=1)
CONTENT = {'.json': 'application/json', '.webp': 'image/webp', '.zip': 'application/zip'}


def _auto():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'creators'))
    import autobuddy
    return autobuddy


class Progress:
    """Writes {stage, pct} to the document at most every 2.5 seconds (and always when the stage changes)."""
    def __init__(self, ref):
        self.ref, self.last, self.stage = ref, 0.0, None
    def __call__(self, stage, pct):
        now = time.time()
        if stage != self.stage or now - self.last > 2.5 or pct >= 100:
            self.ref.update({'progress': {'stage': stage, 'pct': int(max(0, min(100, pct)))}, 'updatedAt': firestore.SERVER_TIMESTAMP})
            self.stage, self.last = stage, now


def claim(ref):
    """queued -> processing in a transaction, so a document is only ever worked on once."""
    db = firestore.client()
    @firestore.transactional
    def go(tx):
        snap = ref.get(transaction=tx)
        d = snap.to_dict() or {}
        if d.get('status') != 'queued' or d.get('disabled'): return None
        tx.update(ref, {'status': 'processing', 'progress': {'stage': 'Starting', 'pct': 0}, 'error': firestore.DELETE_FIELD,
                        'updatedAt': firestore.SERVER_TIMESTAMP})
        return d
    return go(db.transaction())


def upload(out_dir, prefix):
    bucket = storage.bucket(BUCKET)
    for f in os.listdir(out_dir):
        blob = bucket.blob(prefix + f)
        blob.cache_control = 'public, max-age=3600'
        blob.upload_from_filename(os.path.join(out_dir, f), content_type=CONTENT.get(os.path.splitext(f)[1], 'application/octet-stream'))


def platform_of(url):
    host = re.sub(r'^www\.', '', (re.match(r'https?://([^/]+)', url or '') or [None, ''])[1].lower())
    for key, name in (('tiktok', 'TikTok'), ('youtu', 'YouTube'), ('instagram', 'Instagram'), ('facebook', 'Facebook'),
                      ('x.com', 'X'), ('twitter', 'X'), ('snapchat', 'Snapchat'), ('vimeo', 'Vimeo'), ('twitch', 'Twitch')):
        if key in host: return name
    return 'Upload' if 'firebasestorage' in host else 'Web'


def video_source(d, work):
    """An uploaded file in Storage (downloaded here) or a public link (autobuddy downloads it)."""
    path = d.get('storagePath')
    if path:
        local = os.path.join(work, 'video' + (os.path.splitext(path)[1] or '.mp4'))
        storage.bucket(BUCKET).blob(path).download_to_filename(local)
        return local, path
    return d.get('videoUrl', ''), None


def taken_ids():
    ids = {d.id for d in firestore.client().collection('catalog').select([]).stream()}
    try:
        with urllib.request.urlopen(f'{SITE}/buddies/index.json', timeout=10) as r: ids |= set(json.load(r)['buddies'])
    except Exception: pass
    return ids


def new_buddy_id(name):
    base = re.sub(r'[^a-z0-9]+', '-', (name or '').lower()).strip('-')[:40] or 'buddy'
    taken = taken_ids(); bid, n = base, 2
    while bid in taken: bid, n = f'{base}-{n}', n + 1
    return bid


def run(d, ref, prefix_for, buddy_id, work):
    auto = _auto()
    video, stored = video_source(d, work)
    out = os.path.join(work, 'out')
    people = int(d.get('people') or 1)
    src = d.get('platform') or platform_of(d.get('videoUrl', ''))
    manifest = auto.make_buddy(video, out, people=max(1, min(people, 6)), buddy_id=buddy_id, name=d.get('name') or 'My buddy',
                               author=d.get('creatorName', ''), source_from=f"Beta · {src}" if src not in ('Upload', 'Web') else 'Beta',
                               quality=d.get('quality') is True, work=os.path.join(work, 'w'), cache=CACHE, progress=Progress(ref))
    Progress(ref)('Publishing', 0)
    prefix = prefix_for(manifest)
    upload(out, prefix)
    if stored:
        try: storage.bucket(BUCKET).blob(stored).delete()
        except Exception: pass
    return manifest, prefix


@firestore_fn.on_document_created(document='jobs/{jobId}', **RUN)
def process_job(event: firestore_fn.Event[firestore_fn.DocumentSnapshot]) -> None:
    ref = event.data.reference
    d = claim(ref)
    if d is None: return
    work = tempfile.mkdtemp(prefix='job-')
    try:
        bid = new_buddy_id(d.get('name'))
        manifest, prefix = run(d, ref, lambda m: f'buddies/shared/{bid}/', bid, work)
        firestore.client().collection('catalog').document(bid).set({
            'name': manifest['name'], 'author': manifest.get('author', ''), 'from': manifest.get('from', ''),
            'creatorLink': d.get('creatorLink', ''), 'prefix': prefix, 'version': int(time.time()),
            'people': int(d.get('people') or 1), 'jobId': ref.id, 'addedAt': firestore.SERVER_TIMESTAMP})
        ref.update({'status': 'ready', 'buddyId': bid, 'progress': {'stage': 'Done', 'pct': 100}, 'updatedAt': firestore.SERVER_TIMESTAMP})
    except Exception as e:
        fail(ref, e)
    finally:
        shutil.rmtree(work, ignore_errors=True)


@firestore_fn.on_document_written(document='users/{uid}/characters/{cid}', **RUN)
def process_character(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    after = event.data.after
    if after is None or not after.exists: return
    if (after.to_dict() or {}).get('status') != 'queued': return
    ref = after.reference
    uid, cid = event.params['uid'], event.params['cid']
    d = claim(ref)
    if d is None: return
    work = tempfile.mkdtemp(prefix='chr-')
    try:
        bid = re.sub(r'[^a-z0-9_-]', '', cid.lower())[:60] or 'buddy'
        manifest, prefix = run(d, ref, lambda m: f'buddies/{uid}/{cid}/', bid, work)
        ref.update({'status': 'ready', 'packagePath': prefix, 'progress': {'stage': 'Done', 'pct': 100},
                    'updatedAt': firestore.SERVER_TIMESTAMP})
    except Exception as e:
        fail(ref, e)
        refund(uid, cid)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def fail(ref, e):
    auto = _auto()
    reason = str(e) if isinstance(e, auto.Fail) else 'Something went wrong on our side while making this buddy.'
    if not isinstance(e, auto.Fail): traceback.print_exc()
    ref.update({'status': 'failed', 'error': reason[:200], 'progress': firestore.DELETE_FIELD, 'updatedAt': firestore.SERVER_TIMESTAMP})


def refund(uid, cid):
    """Gives back the buddy this character spent (web/js/billing.js refundCreation, simplified: a plan buddy comes back
    as a credit, which never expires, so the person never loses out)."""
    db = firestore.client(); wref = db.document(f'users/{uid}/wallet/main')
    @firestore.transactional
    def go(tx):
        w = (wref.get(transaction=tx).to_dict()) or {}
        c = (w.get('creations') or {}).get(cid)
        if not c or c.get('refunded'): return
        c['refunded'] = True
        if c.get('source') == 'free': w['freeUsed'] = max(0, int(w.get('freeUsed') or 0) - 1)
        else: w['credits'] = int(w.get('credits') or 0) + 1
        tx.set(wref, w)
    try: go(db.transaction())
    except Exception: traceback.print_exc()
