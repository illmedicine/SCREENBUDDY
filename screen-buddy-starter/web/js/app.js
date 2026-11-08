// The Screen Buddy web player page: the library, the floating buddy and its controls.

import { mountBuddy } from './buddy-view.js';
import { loadBundled } from './store.js';
import { startMotion, MODES } from './motion.js';
import { loadSettings, loadCloudBuddies, storageUrl, creatorLine } from './collection.js';
import { cloud, onUser, str, askSignIn } from './cloud.js';
import { StatsTally, ownKey, cleanUrl, mergeCollection } from './library.js';
import { parseManifest, MANIFEST_FILE } from './manifest.js';

const KEY = 'sb:settings';
const $ = id => document.getElementById(id);

const defaults = () => ({
  buddyId: null,
  height: Math.round(Math.min(280, Math.max(160, innerHeight * 0.4))),
  opacity: 100,
  visible: true,
  anchor: 'free',
  pos: null,
  paused: false,
  motion: 'touch',
});
const settings = (() => {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return defaults(); }
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable: settings last for this visit */ } };

if (!MODES.includes(settings.motion)) settings.motion = 'touch';

let buddies = [];
let view = null;
let driver = null;
let menu = null;

const current = () => buddies.find(b => b.manifest.id === settings.buddyId) ?? buddies[0];

// ---- the floating buddy ------------------------------------------------------------------------

function mount() {
  view?.destroy();
  view = null;
  closeMenu();
  const buddy = current();
  if (!buddy || !settings.visible) return;
  settings.buddyId = buddy.manifest.id;
  view = mountBuddy(buddy, settings, {
    onMoved: pos => { settings.pos = pos; save(); },
    onMenu: openMenu,
    onError: () => say('That buddy could not be loaded.', true),
  });
}

// ---- movement modes (steady / typing / sound) --------------------------------------------------------

function sayMotion(text, isError = false) {
  const el = $('motion-msg');
  el.textContent = text;
  el.className = `msg ${text ? (isError ? 'err' : 'ok') : ''}`;
}

/** (Re)starts whatever drives the buddy. Stops it while hidden or paused, which also releases the microphone. */
function applyMotion() {
  driver?.stop();
  driver = null;
  sayMotion('');
  if (!view || !settings.visible || settings.paused || settings.motion === 'touch') return;
  const mode = settings.motion;
  driver = startMotion(mode, {
    scrub: px => view?.walk(px),
    onProblem: message => {
      if (settings.motion !== mode) return;
      settings.motion = 'touch';
      save();
      for (const r of document.querySelectorAll('input[name="motion"]')) r.checked = r.value === 'touch';
      driver?.stop();
      driver = null;
      sayMotion(message, true);
    },
  });
  if (mode === 'sound') sayMotion('Listening for sound. Nothing is recorded.');
}

function select(id, { counted = true } = {}) {
  if (counted && id !== settings.buddyId) tally.select(statKey(buddies.find(b => b.manifest.id === id)));
  settings.buddyId = id;
  save();
  renderPicker();
  mount();
}

// ---- picker ------------------------------------------------------------------------------------

function renderPicker() {
  const picker = $('picker');
  picker.replaceChildren();
  for (const b of buddies) {
    const { id, name, author, from } = b.manifest;
    const wrap = document.createElement('div');
    wrap.className = 'card-wrap';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.setAttribute('aria-pressed', String(id === current()?.manifest.id));
    const face = new Image();
    face.src = b.url(b.manifest.face);
    face.alt = '';
    face.width = face.height = 72;
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;
    const by = document.createElement('span');
    by.className = 'by';
    by.textContent = author || from || (b.account ? 'Yours' : 'Sample');
    card.append(face, label, by);
    card.addEventListener('click', () => select(id));
    wrap.append(card);
    if (b.creatorLink) wrap.append(creatorLine({ creatorName: b.creatorName || author, creatorLink: b.creatorLink }));
    picker.append(wrap);
  }
}

// ---- long-press menu ---------------------------------------------------------------------------

function openMenu(rect) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'sb-menu';
  m.setAttribute('role', 'menu');
  const item = (label, action) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    b.addEventListener('click', () => { closeMenu(); action(); });
    m.append(b);
  };
  item(view?.paused ? 'Resume' : 'Pause', () => setPaused(!view?.paused));
  item('Switch buddy', () => {
    if (buddies.length < 2) return;
    const i = buddies.indexOf(current());
    select(buddies[(i + 1) % buddies.length].manifest.id);
  });
  item('Hide', () => { $('show').checked = false; setVisible(false); });
  document.body.append(m);
  const w = m.offsetWidth, h = m.offsetHeight;
  const x = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), innerWidth - w - 8);
  const above = rect.top - h - 8;
  m.style.left = `${x}px`;
  m.style.top = `${above >= 8 ? above : Math.min(rect.bottom + 8, innerHeight - h - 8)}px`;
  m.querySelector('button').focus();
  const onKey = e => { if (e.key === 'Escape') { closeMenu(); view?.focus(); } };
  const onDown = e => { if (!m.contains(e.target)) closeMenu(); };
  addEventListener('keydown', onKey);
  setTimeout(() => addEventListener('pointerdown', onDown), 0);
  menu = { m, cleanup: () => { removeEventListener('keydown', onKey); removeEventListener('pointerdown', onDown); } };
}
function closeMenu() { menu?.cleanup(); menu?.m.remove(); menu = null; }

// ---- controls ----------------------------------------------------------------------------------

function setVisible(on) {
  settings.visible = on;
  save();
  mount();
  applyMotion();
}
function setPaused(on) {
  settings.paused = on;
  view?.setPaused(on);
  applyMotion();
  $('pause').setAttribute('aria-pressed', String(on));
  $('pause').textContent = on ? 'Resume' : 'Pause';
  save();
}
function say(text, isError = false) {
  const el = $('picker-msg');
  el.textContent = text;
  el.className = `msg ${isError ? 'err' : 'ok'}`;
}

function bindControls() {
  const size = $('size'), opacity = $('opacity');
  size.value = settings.height;
  opacity.value = settings.opacity;
  const showSize = () => { $('size-out').textContent = `${size.value}px`; };
  const showOpacity = () => { $('opacity-out').textContent = `${opacity.value}%`; };
  showSize(); showOpacity();
  size.addEventListener('input', () => { settings.height = +size.value; showSize(); view?.setHeight(settings.height); });
  size.addEventListener('change', save);
  opacity.addEventListener('input', () => { settings.opacity = +opacity.value; showOpacity(); view?.setOpacity(settings.opacity); });
  opacity.addEventListener('change', save);

  for (const r of document.querySelectorAll('input[name="anchor"]')) {
    r.checked = r.value === settings.anchor;
    r.addEventListener('change', () => { if (r.checked) { settings.anchor = r.value; view?.setAnchor(r.value); save(); } });
  }

  for (const r of document.querySelectorAll('input[name="motion"]')) {
    r.checked = r.value === settings.motion;
    r.addEventListener('change', () => { if (r.checked) { settings.motion = r.value; save(); applyMotion(); } });
  }

  $('show').checked = settings.visible;
  $('show').addEventListener('change', e => setVisible(e.target.checked));
  $('pose').addEventListener('click', () => { if (!settings.visible) { $('show').checked = true; setVisible(true); } view?.pose(); });
  $('pause').addEventListener('click', () => setPaused(!settings.paused));
  $('reset').addEventListener('click', () => { settings.pos = null; save(); mount(); });
  setPaused(settings.paused);

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) $('reduced').hidden = false;
}

// ---- stats: selections and time on screen ------------------------------------------------------------------------
// Counted per character in memory and written at most once a minute (and when the tab is hidden) as small increments
// to stats/{key}, which only the admin can read. Other apps report the same way:
// see pipeline/queue/README.md, "Stats".

const tally = new StatsTally();
const TICK = 5000;

/** The stats key of a buddy: the site's id, "<uid>__<id>" for the person's own. */
function statKey(b) { return b?.statKey ?? null; }

setInterval(() => {
  if (view && settings.visible && !document.hidden) tally.tick(statKey(current()), TICK);
}, TICK);

async function flushStats() {
  const batch = tally.drain();
  if (!batch.length) return;
  const c = await cloud();
  if (!c) return;
  const { F, db } = c;
  for (const { key, selections, seconds } of batch) {
    F.setDoc(F.doc(db, 'stats', key), { selections: F.increment(selections), seconds: F.increment(seconds), updatedAt: F.serverTimestamp() }, { merge: true })
      .catch(e => console.warn('Stats not saved', e));
  }
}
setInterval(flushStats, 60_000);
addEventListener('visibilitychange', () => { if (document.hidden) flushStats(); });

// ---- the admin's settings, and the signed-in person's own buddies ------------------------------------------------------

async function applyCollectionSettings() {
  const { overlays } = await loadSettings();
  const shown = new Map(mergeCollection(buddies.filter(b => b.bundled).map(b => b.manifest), overlays).map(i => [i.id, i]));
  buddies = buddies.filter(b => !b.bundled || shown.has(b.manifest.id));
  for (const b of buddies) {
    const i = shown.get(b.manifest.id);
    if (b.bundled && i) Object.assign(b, { creatorName: i.creatorName, creatorLink: i.creatorLink });
  }
}

/** A ready character from the account: its package (manifest.json and strips) lives at packageUrl. */
async function accountBuddy(uid, id, x) {
  // The worker publishes to Storage (packagePath); packageUrl is an https folder (the original contract).
  const path = typeof x.packagePath === 'string' && x.packagePath.startsWith('buddies/') ? x.packagePath : '';
  const base = path ? '' : cleanUrl(x.packageUrl)?.replace(/\/+$/, '');
  if (!path && !base) return null;
  const fileUrl = file => (path ? storageUrl(path + file) : `${base}/${file}`);
  const json = await (await fetch(fileUrl(MANIFEST_FILE))).json();
  const key = ownKey(uid, id);
  const manifest = { ...parseManifest(json), id: key, name: str(x.name, 40) || json.name };
  return { manifest, bundled: false, account: true, statKey: key, url: fileUrl,
    creatorName: str(x.creatorName, 60), creatorLink: cleanUrl(x.creatorLink, 300) };
}

async function signedIn(u) {
  buddies = buddies.filter(b => !b.account);
  if (u) {
    const c = await cloud();
    const { F, db } = c;
    try {
      const [snap, profile] = await Promise.all([
        F.getDocs(F.collection(db, 'users', u.uid, 'characters')), F.getDoc(F.doc(db, 'users', u.uid)),
      ]);
      const ready = snap.docs.filter(d => d.data().status === 'ready' && d.data().disabled !== true);
      const mine = await Promise.all(ready.map(d => accountBuddy(u.uid, d.id, d.data()).catch(() => null)));
      buddies.push(...mine.filter(Boolean));
      const chosen = profile.exists() ? profile.data().buddyId : null;
      if (typeof chosen === 'string' && chosen !== settings.buddyId && buddies.some(b => b.manifest.id === chosen)) settings.buddyId = chosen;
    } catch (e) { console.warn('Could not load your buddies', e); }
  }
  for (const a of document.querySelectorAll('[data-make]')) {
    if (a.hasAttribute('href') && a.classList.contains('btn')) a.textContent = u ? 'Open my dashboard' : 'Sign in with Google to make your own';
    a.onclick = u ? null : e => { e.preventDefault(); askSignIn('dashboard.html'); };
  }
  renderPicker();
  mount();
  applyMotion();
}

// ---- start -------------------------------------------------------------------------------------

bindControls();
const siteBuddies = await loadBundled();
const siteIds = new Set(siteBuddies.map(b => b.manifest.id));
const cloudBuddies = (await loadCloudBuddies()).filter(b => !siteIds.has(b.id))   // added from the admin page
  .map(b => ({ manifest: b.manifest, bundled: true, cloud: true, url: b.url }));
buddies = [...siteBuddies, ...cloudBuddies].map(b => ({ ...b, statKey: b.manifest.id }));
await applyCollectionSettings();
renderPicker();
mount();
applyMotion();
if (!buddies.length) say('No buddies found. Check that the buddies folder was published.', true);
onUser(signedIn);
