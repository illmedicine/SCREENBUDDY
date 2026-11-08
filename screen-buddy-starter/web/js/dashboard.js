// The signed-in dashboard: make a buddy from a video link, see your own buddies, pick one from the collection,
// star creators, and buy more buddies. Everything personal lives in Firestore under users/{uid}; /firestore.rules
// keeps it private and makes every new buddy cost one (the first one is free).
//
// Making a buddy writes users/{uid}/characters/{id} with status 'queued'. The processing worker (pipeline/queue/README.md)
// picks it up, sets 'processing', then 'ready' with packageUrl, or 'failed' with a reason (and refunds the buddy).
import { cloud, onUser, askSignIn, str } from './cloud.js';
import { loadCollection, creatorLine } from './collection.js';
import { walletStore } from './wallet-store.js';
import { mountShop } from './shop.js';
import { newCharacter, newCharacterId, statusLabel, redosLeft, creatorKey, ownKey, cleanText, CREATOR_MAX, MAX_RUNS } from './library.js';

const $ = id => document.getElementById(id);
const SETTINGS = 'sb:settings';

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(k => k != null && k !== ''));
  return n;
};
const say = (id, text, isError = false) => { const m = $(id); m.textContent = text; m.className = `msg ${text ? (isError ? 'err' : 'ok') : ''}`; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let c = null, user = null, store = null, wallet = null;
let mine = [], favorites = new Map(), collection = [];
let stops = [];

const shop = mountShop({ signIn: () => askSignIn() });

// ---- which buddy is in use (this browser, and the profile so other devices follow) ---------------------------------

function usingId() {
  try { return JSON.parse(localStorage.getItem(SETTINGS) ?? '{}').buddyId ?? null; } catch { return null; }
}

async function use(id, name) {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS) ?? '{}');
    localStorage.setItem(SETTINGS, JSON.stringify({ ...s, buddyId: id, visible: true }));
  } catch { /* storage unavailable */ }
  if (user) {
    try { await c.F.updateDoc(c.F.doc(c.db, 'users', user.uid), { buddyId: id, updatedAt: c.F.serverTimestamp() }); }
    catch (e) { console.warn('Could not save the chosen buddy', e); }
  }
  renderCollection();
  renderMine();
  const msg = $('col-msg');
  msg.className = 'msg ok';
  msg.replaceChildren(`${name} is your buddy now. `, el('a', { href: 'player.html' }, 'See it on your screen'), '.');
}

// ---- making a buddy ----------------------------------------------------------------------------------------------

function renderCanMake() {
  const b = wallet?.balance(Date.now());
  const left = b?.total ?? 0;
  const btn = $('make-btn');
  btn.disabled = !wallet || left < 1;
  $('can-make').textContent = !wallet ? 'Loading your balance…'
    : left < 1 ? 'Your free buddy is used. Get more below to make another one.'
      : b.freeLeft ? 'Your first buddy is free.'
        : `You can make ${plural(left, 'more buddy', 'more buddies')}.`;
}

async function make(ev) {
  ev.preventDefault();
  if (!store) return;
  if (!$('consent').checked) { say('make-msg', 'Please confirm the person in the video agreed.', true); return; }
  const r = newCharacter({ videoUrl: $('video').value, name: $('cname').value, creatorName: $('creator').value, creatorLink: $('clink').value });
  if (!r.ok) { say('make-msg', r.error, true); return; }
  const btn = $('make-btn');
  btn.disabled = true;
  say('make-msg', 'Sending…');
  try {
    const res = await store.createCharacter(newCharacterId(), r.value);
    if (!res.ok) {
      say('make-msg', res.code === 'no_credits' ? 'Nothing left to spend. Pick a pack or the Creator plan below.' : "Couldn't start that buddy. Try again.", true);
      return;
    }
    $('make').reset();
    say('make-msg', `Got it. ${r.value.name} is in line to be made; it shows up below when it's ready.`);
  } catch (e) {
    console.warn('Make failed', e);
    say('make-msg', e?.code === 'permission-denied' ? "You don't have a buddy left to spend." : 'Could not send that. Check your connection and try again.', true);
  } finally {
    renderCanMake();
  }
}

async function redo(ch) {
  try {
    await c.F.updateDoc(c.F.doc(c.db, 'users', user.uid, 'characters', ch.id),
      { status: 'queued', runs: ch.runs + 1, updatedAt: c.F.serverTimestamp() });
  } catch (e) { console.warn('Redo failed', e); say('make-msg', "Couldn't start the re-do.", true); }
}

async function remove(ch) {
  if (!confirm(`Delete ${ch.name}? This can't be undone, and making a new buddy costs one from your balance.`)) return;
  try { await c.F.deleteDoc(c.F.doc(c.db, 'users', user.uid, 'characters', ch.id)); }
  catch (e) { console.warn('Delete failed', e); say('make-msg', "Couldn't delete it.", true); }
}

function renderMine() {
  const list = $('my-list');
  list.replaceChildren();
  if (!mine.length) { list.append(el('li', { className: 'hint' }, "You haven't made a buddy yet.")); return; }
  const inUse = usingId();
  for (const ch of mine) {
    const key = ownKey(user.uid, ch.id);
    const chip = el('span', { className: `chip ${ch.disabled ? 'off' : ch.status}` }, ch.disabled ? 'Switched off' : statusLabel(ch.status));
    const btns = el('div', { className: 'row-btns' });
    if (ch.status === 'ready' && !ch.disabled) btns.append(el('button', { type: 'button', className: 'btn small primary', onclick: () => use(key, ch.name) }, key === inUse ? 'In use' : 'Use'));
    const left = redosLeft(ch);
    if (left) btns.append(el('button', { type: 'button', className: 'btn small', onclick: () => redo(ch) }, `Re-do (${left} left)`));
    btns.append(el('button', { type: 'button', className: 'btn small ghost', onclick: () => remove(ch) }, 'Delete'));
    const video = el('a', { href: ch.videoUrl, target: '_blank', rel: 'noopener nofollow' }, `Video on ${ch.platform || 'the web'}`);
    list.append(el('li', { className: `d-card${key === inUse ? ' using' : ''}` },
      el('h3', {}, ch.name), chip, creatorLine(ch), el('p', {}, video),
      ch.status === 'failed' && ch.error ? el('p', {}, ch.error) : '',
      el('p', {}, `Runs used: ${ch.runs} of ${MAX_RUNS}`),
      btns));
  }
}

// ---- the collection and favorites --------------------------------------------------------------------------------

async function toggleFavorite(item) {
  if (!user) { askSignIn(); return; }
  const id = creatorKey(item.creatorLink);
  if (!id) return;
  const ref = c.F.doc(c.db, 'users', user.uid, 'favorites', id);
  try {
    if (favorites.has(id)) await c.F.deleteDoc(ref);
    else await c.F.setDoc(ref, { name: cleanText(item.creatorName, CREATOR_MAX), link: item.creatorLink, createdAt: c.F.serverTimestamp() });
  } catch (e) { console.warn('Favorite failed', e); say('col-msg', "Couldn't save that favorite.", true); }
}

function renderCollection() {
  const list = $('col-list');
  list.replaceChildren();
  if (!collection.length) { list.append(el('li', { className: 'hint' }, 'No buddies to show right now.')); return; }
  const inUse = usingId();
  for (const item of collection) {
    const face = el('img', { className: 'face', src: `${item.dir}/${item.manifest.face}`, alt: '', width: 72, height: 72, loading: 'lazy' });
    const btns = el('div', { className: 'row-btns' },
      el('button', { type: 'button', className: 'btn small primary', onclick: () => use(item.id, item.name) }, item.id === inUse ? 'In use' : 'Use'));
    if (item.creatorLink) {
      const fav = favorites.has(creatorKey(item.creatorLink));
      btns.append(el('button', {
        type: 'button', className: 'star', textContent: fav ? '★' : '☆', title: fav ? 'Remove from favorites' : 'Favorite this creator',
        ariaLabel: `${fav ? 'Remove' : 'Add'} ${item.creatorName || 'this creator'} ${fav ? 'from' : 'to'} favorites`,
        ariaPressed: String(fav), onclick: () => toggleFavorite(item),
      }));
    }
    list.append(el('li', { className: `d-card${item.id === inUse ? ' using' : ''}` },
      face, el('h3', {}, item.name), creatorLine(item), item.from ? el('p', {}, item.from) : '', btns));
  }
}

function renderFavorites() {
  $('favorites').hidden = !user || !favorites.size;
  const list = $('fav-list');
  list.replaceChildren();
  for (const [id, f] of favorites) {
    list.append(el('li', {},
      el('a', { href: f.link, target: '_blank', rel: 'noopener nofollow' }, f.name || new URL(f.link).hostname),
      el('button', { type: 'button', className: 'remove', ariaLabel: `Remove ${f.name || 'creator'} from favorites`, textContent: '×',
        onclick: () => c.F.deleteDoc(c.F.doc(c.db, 'users', user.uid, 'favorites', id)) })));
  }
}

// ---- signing in and out --------------------------------------------------------------------------------------------

function signedIn(u) {
  stops.forEach(s => s());
  stops = [];
  user = u;
  store = u && c ? walletStore(c, u.uid) : null;
  wallet = null;
  mine = [];
  favorites = new Map();
  $('signed-out').hidden = Boolean(u);
  $('mine').hidden = !u;
  shop.setAccount(null);
  if (!u) { renderCollection(); renderFavorites(); return; }

  const { F, db } = c;
  renderCanMake();
  stops.push(store.watch(w => { wallet = w; shop.setAccount(store, w); renderCanMake(); },
    e => { console.warn('Wallet unavailable', e); $('can-make').textContent = "Couldn't load your balance."; }));
  stops.push(F.onSnapshot(F.query(F.collection(db, 'users', u.uid, 'characters'), F.orderBy('createdAt', 'desc')), snap => {
    mine = snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, name: str(x.name, 40), videoUrl: str(x.videoUrl, 500), platform: str(x.platform, 20), creatorName: str(x.creatorName, 60),
        creatorLink: str(x.creatorLink), status: str(x.status, 20), runs: Number.isInteger(x.runs) ? x.runs : 1, disabled: x.disabled === true, error: str(x.error, 200) };
    });
    renderMine();
  }, e => console.warn('Characters unavailable', e)));
  stops.push(F.onSnapshot(F.collection(db, 'users', u.uid, 'favorites'), snap => {
    favorites = new Map(snap.docs.map(d => [d.id, { name: str(d.data().name, 60), link: str(d.data().link) }]));
    renderFavorites();
    renderCollection();
  }, e => console.warn('Favorites unavailable', e)));
}

async function main() {
  $('make').addEventListener('submit', make);
  $('signin-big').addEventListener('click', () => askSignIn());
  collection = (await loadCollection()).items;
  renderCollection();
  c = await cloud();
  if (!c) { $('signed-out').hidden = false; $('signin-big').disabled = true; return; }
  onUser(signedIn);
}

main();
