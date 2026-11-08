// The Screen Buddy web player page: the library, the floating buddy and its controls.

import { mountBuddy } from './buddy-view.js';
import { loadBundled, loadImported, importZip, removeImported } from './store.js';
import { InvalidBuddy } from './manifest.js';
import { startMotion, MODES } from './motion.js';
import { loadSettings, creatorLine } from './collection.js';
import { cloud, onUser, str } from './cloud.js';
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

const bundledIds = () => new Set(buddies.filter(b => b.bundled).map(b => b.manifest.id));
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
    by.textContent = author || from || (b.bundled ? 'Sample' : 'Imported');
    card.append(face, label, by);
    card.addEventListener('click', () => select(id));
    wrap.append(card);
    if (b.creatorLink) wrap.append(creatorLine({ creatorName: b.creatorName || author, creatorLink: b.creatorLink }));
    if (!b.bundled && !b.account) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'remove';
      rm.textContent = '×';
      rm.setAttribute('aria-label', `Remove ${name}`);
      rm.addEventListener('click', async () => {
        await removeImported(id);
        b.revoke?.();
        buddies = buddies.filter(x => x !== b);
        if (settings.buddyId === id) settings.buddyId = buddies[0]?.manifest.id ?? null;
        save();
        renderPicker();
        mount();
        say(`Removed ${name}.`);
      });
      wrap.append(rm);
    }
    picker.append(wrap);
  }
  const list = $('downloads');
  list.replaceChildren();
  for (const b of buddies.filter(x => x.zip)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'btn small';
    a.href = b.zip;
    a.download = `${b.manifest.id}.zip`;
    a.textContent = `${b.manifest.name}.zip`;
    li.append(a);
    list.append(li);
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
  const el = $('import-msg');
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

// ---- importing a buddy.zip -------------------------------------------------------------------------

async function handleFile(file) {
  if (!file) return;
  try {
    if (file.size > 40 * 1024 * 1024) throw new InvalidBuddy('That file is too large.');
    const buddy = await importZip(await file.arrayBuffer(), bundledIds());
    const old = buddies.find(b => b.manifest.id === buddy.manifest.id);
    if (old) { old.revoke?.(); buddies = buddies.filter(b => b !== old); }
    buddies.push(buddy);
    say(`Added ${buddy.manifest.name}.`);
    select(buddy.manifest.id);
  } catch (err) {
    say(err instanceof InvalidBuddy ? `Couldn't add that buddy: ${err.message}` : "Couldn't read that file.", true);
  }
}

function bindImport() {
  const input = $('import'), drop = input.closest('.drop');
  input.addEventListener('change', async () => { await handleFile(input.files[0]); input.value = ''; });
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
}

// ---- stats: selections and time on screen ------------------------------------------------------------------------
// Counted per character in memory and written at most once a minute (and when the tab is hidden) as small increments
// to stats/{key}, which only the admin can read. Imported .zip buddies aren't counted. Other apps report the same way:
// see pipeline/queue/README.md, "Stats".

const tally = new StatsTally();
const TICK = 5000;

/** The stats key of a buddy: the site's id, "<uid>__<id>" for the person's own, null for imported files. */
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
  const base = cleanUrl(x.packageUrl)?.replace(/\/+$/, '');
  if (!base) return null;
  const json = await (await fetch(`${base}/${MANIFEST_FILE}`)).json();
  const key = ownKey(uid, id);
  const manifest = { ...parseManifest(json), id: key, name: str(x.name, 40) || json.name };
  return { manifest, bundled: false, account: true, statKey: key, url: file => `${base}/${file}`,
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
  renderPicker();
  mount();
  applyMotion();
}

// ---- start -------------------------------------------------------------------------------------

bindControls();
bindImport();
buddies = [...(await loadBundled()).map(b => ({ ...b, statKey: b.manifest.id })), ...await loadImported()];
await applyCollectionSettings();
renderPicker();
mount();
applyMotion();
if (!buddies.length) say('No buddies found. Check that the buddies folder was published.', true);
onUser(signedIn);
