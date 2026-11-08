// The admin view. Only the owner's Google account may use it: the page checks, and /firestore.rules refuses every
// admin read and write from anyone else, so the check here is only for showing the right screen.
import { cloud, onUser, isAdmin, askSignIn, str } from './cloud.js';
import { loadCollection } from './collection.js';
import { cleanLink, cleanText, formatDuration, CREATOR_MAX, NAME_MAX } from './library.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter(k => k != null && k !== ''));
  return n;
};
const say = (id, text, isError = false) => { const m = $(id); m.textContent = text; m.className = `msg ${text ? (isError ? 'err' : 'ok') : ''}`; };
const td = (label, ...kids) => { const n = el('td', {}, ...kids); if (label) n.dataset.label = label; return n; };

let c = null;
let stats = new Map();

async function loadStats() {
  const snap = await c.F.getDocs(c.F.collection(c.db, 'stats'));
  stats = new Map(snap.docs.map(d => [d.id, { selections: d.data().selections | 0, seconds: d.data().seconds | 0 }]));
}
const statCells = key => {
  const s = stats.get(key) ?? { selections: 0, seconds: 0 };
  return [td('Selected', String(s.selections)), td('On screen', formatDuration(s.seconds))].map(x => { x.className = 'num'; return x; });
};

async function showSite() {
  const { items, site } = await loadCollection({ includeHidden: true });
  const sel = $('featured');
  sel.replaceChildren(el('option', { value: '' }, 'The first visible buddy'),
    ...items.map(i => el('option', { value: i.id, selected: i.id === site.featured }, `${i.name}${i.hidden ? ' (hidden)' : ''}`)));
  $('receipts').checked = site.clientReceipts === true;
  $('site-form').onsubmit = async ev => {
    ev.preventDefault();
    try {
      await c.F.setDoc(c.F.doc(c.db, 'config', 'site'), { featured: sel.value, clientReceipts: $('receipts').checked, updatedAt: c.F.serverTimestamp() });
      say('site-msg', 'Saved.');
    } catch (e) { console.warn(e); say('site-msg', 'Could not save.', true); }
  };

  const rows = $('shared-rows');
  rows.replaceChildren();
  for (const item of items) {
    const name = el('input', { type: 'text', value: item.name, maxLength: NAME_MAX, ariaLabel: `Name of ${item.name}` });
    const creator = el('input', { type: 'text', value: item.creatorName, maxLength: CREATOR_MAX, ariaLabel: `Creator of ${item.name}` });
    const link = el('input', { type: 'url', value: item.creatorLink, maxLength: 300, placeholder: 'https://…', ariaLabel: `Social link for ${item.name}` });
    const hidden = el('input', { type: 'checkbox', checked: item.hidden, ariaLabel: `Hide ${item.name}` });
    const save = el('button', { type: 'button', className: 'btn small' }, 'Save');
    save.onclick = async () => {
      const l = cleanLink(link.value);
      if (l === null) { say('shared-msg', `The social link for ${item.name} isn't a web address.`, true); return; }
      try {
        await c.F.setDoc(c.F.doc(c.db, 'buddies', item.id), {
          name: cleanText(name.value, NAME_MAX), creatorName: cleanText(creator.value, CREATOR_MAX), creatorLink: l,
          hidden: hidden.checked, updatedAt: c.F.serverTimestamp(),
        });
        say('shared-msg', `Saved ${item.id}.`);
      } catch (e) { console.warn(e); say('shared-msg', `Could not save ${item.id}.`, true); }
    };
    rows.append(el('tr', {}, td('Buddy', name, el('div', { className: 'hint' }, item.id)), td('Creator', creator), td('Social link', link),
      td('Hidden', hidden), ...statCells(item.id), td('', save)));
  }
}

async function showPeople() {
  const snap = await c.F.getDocs(c.F.collectionGroup(c.db, 'characters'));
  const rows = $('people-rows');
  rows.replaceChildren();
  if (snap.empty) { rows.append(el('tr', {}, el('td', { colSpan: 7, className: 'hint' }, 'Nobody has made a buddy yet.'))); return; }
  for (const d of snap.docs) {
    const x = d.data();
    const uid = d.ref.parent.parent.id;
    const off = el('input', { type: 'checkbox', checked: x.disabled === true, ariaLabel: `Switch off ${str(x.name, 40)}` });
    off.onchange = async () => {
      try {
        await c.F.updateDoc(d.ref, { disabled: off.checked, updatedAt: c.F.serverTimestamp() });
        say('people-msg', `${str(x.name, 40)} is ${off.checked ? 'off' : 'on'}.`);
      } catch (e) { console.warn(e); off.checked = !off.checked; say('people-msg', 'Could not change it.', true); }
    };
    const video = str(x.videoUrl, 500);
    rows.append(el('tr', {},
      td('Buddy', str(x.name, 40), x.creatorLink ? el('div', {}, el('a', { href: str(x.creatorLink), target: '_blank', rel: 'noopener nofollow' }, str(x.creatorName, 60) || 'creator')) : ''),
      td('Owner', el('code', {}, uid.slice(0, 8))),
      td('Video', video ? el('a', { href: video, target: '_blank', rel: 'noopener nofollow' }, str(x.platform, 20) || 'link') : ''),
      td('Status', str(x.status, 20)),
      ...statCells(`${uid}__${d.id}`),
      td('Off', off)));
  }
}

async function show(user) {
  const gate = $('gate');
  $('admin-body').hidden = true;
  if (!user) {
    gate.replaceChildren('Sign in with the admin Google account. ', el('button', { type: 'button', className: 'btn small', onclick: () => askSignIn() }, 'Sign in'));
    return;
  }
  if (!isAdmin(user)) { gate.textContent = 'This page is only for the Screen Buddy admin.'; return; }
  gate.textContent = 'Loading…';
  try {
    await loadStats();
    await Promise.all([showSite(), showPeople()]);
    $('admin-body').hidden = false;
    gate.textContent = `Signed in as ${user.email}.`;
  } catch (e) {
    console.warn('Admin load failed', e);
    gate.textContent = 'Could not load the admin data. Check that the Firestore rules are deployed.';
  }
}

c = await cloud();
if (!c) $('gate').textContent = 'Sign-in is not available.';
else onUser(show);
