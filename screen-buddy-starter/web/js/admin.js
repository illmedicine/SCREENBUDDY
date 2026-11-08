// The admin view. Only the owner's Google account may use it: the page checks, and /firestore.rules refuses every
// admin read and write from anyone else, so the check here is only for showing the right screen.
import { cloud, storage, onUser, isAdmin, askSignIn, str } from './cloud.js';
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

// ---- visitors ----------------------------------------------------------------------------------------------------------

const dayOf = offset => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

async function showVisits() {
  const from = dayOf(29);
  const snap = await c.F.getDocs(c.F.query(c.F.collection(c.db, 'visits'), c.F.where(c.F.documentId(), '>=', from)));
  const byDay = new Map(snap.docs.map(d => [d.id, { views: d.data().views | 0, uniques: d.data().uniques | 0 }]));
  const sum = days => days.reduce((t, d) => { const v = byDay.get(d); return v ? { views: t.views + v.views, uniques: t.uniques + v.uniques } : t; }, { views: 0, uniques: 0 });
  const last = n => Array.from({ length: n }, (_, i) => dayOf(i));
  const tile = (label, v) => el('div', { className: 'panel visit-tile' },
    el('p', { className: 'hint' }, label), el('p', { className: 'big' }, String(v.views)), el('p', { className: 'hint' }, `${v.uniques} unique`));
  $('visit-totals').replaceChildren(tile('Today', sum(last(1))), tile('Last 7 days', sum(last(7))), tile('Last 30 days', sum(last(30))));
  $('visit-rows').replaceChildren(...last(14).map(d => {
    const v = byDay.get(d) ?? { views: 0, uniques: 0 };
    return el('tr', {}, td('Day', d), td('Views', String(v.views)), td('Unique visitors', String(v.uniques)));
  }));
}

// ---- add a buddy (the cloud worker makes it) -----------------------------------------------------------------------------

const UPLOAD_MAX = 300 * 1024 * 1024;   // storage.rules: uploads/admin/...
const jobId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

function bindAddForm() {
  $('add-form').onsubmit = async ev => {
    ev.preventDefault();
    const link = cleanLink($('add-link').value.trim()), file = $('add-file').files[0];
    const name = cleanText($('add-name').value, NAME_MAX);
    if (!name) return say('add-msg', 'Give the buddy a name.', true);
    if (!link && !file) return say('add-msg', 'Paste a video link or choose a video file.', true);
    if (file && (!file.type.startsWith('video/') || file.size > UPLOAD_MAX)) return say('add-msg', 'Choose a video file up to 300 MB.', true);
    const id = jobId(), btn = ev.submitter;
    const job = { name, creatorName: cleanText($('add-creator').value, CREATOR_MAX), creatorLink: cleanLink($('add-creator-link').value.trim()) || '',
      people: Number($('add-people').value) || 1, quality: $('add-quality').checked, status: 'queued', createdAt: c.F.serverTimestamp() };
    btn.disabled = true;
    try {
      if (file) {
        const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
        const { S, storage: st } = await storage();
        const path = `uploads/admin/${id}/video.${ext.length >= 2 ? ext : 'mp4'}`;
        const bar = $('add-upload'); bar.hidden = false; bar.value = 0;
        await new Promise((res, rej) => {
          const task = S.uploadBytesResumable(S.ref(st, path), file, { contentType: file.type });
          task.on('state_changed', s => { bar.value = Math.round(100 * s.bytesTransferred / s.totalBytes); say('add-msg', `Uploading… ${bar.value}%`); }, rej, res);
        });
        bar.hidden = true;
        job.storagePath = path;
      } else {
        job.videoUrl = link;
      }
      await c.F.setDoc(c.F.doc(c.db, 'jobs', id), job);
      $('add-form').reset();
      say('add-msg', 'Queued. Progress shows below; you can close this page.');
    } catch (e) {
      console.warn(e); say('add-msg', 'Could not queue it. Check the link (https) and try again.', true);
    } finally { btn.disabled = false; }
  };
}

let stopJobs = null;
function watchJobs() {
  stopJobs?.();
  stopJobs = c.F.onSnapshot(c.F.query(c.F.collection(c.db, 'jobs'), c.F.orderBy('createdAt', 'desc'), c.F.limit(15)), snap => {
    const list = $('jobs');
    if (snap.empty) { list.replaceChildren(el('li', { className: 'hint' }, 'Nothing yet.')); return; }
    list.replaceChildren(...snap.docs.map(d => {
      const j = d.data(), status = str(j.status, 20), p = j.progress ?? {};
      const label = { queued: 'Waiting to start', processing: str(p.stage, 60) || 'Working', ready: 'Live', failed: 'Failed' }[status] ?? status;
      const row = el('li', { className: 'panel job' },
        el('div', { className: 'job-head' }, el('b', {}, str(j.name, 40)), el('span', { className: `chip ${status}` }, label)));
      if (status === 'processing' || status === 'queued') row.append(el('progress', { max: 100, value: status === 'queued' ? 0 : (p.pct | 0) }));
      if (status === 'ready') row.append(el('p', { className: 'hint' }, `On the site and in the apps as "${str(j.name, 40)}".`));
      if (status === 'failed') row.append(el('p', { className: 'hint' }, str(j.error, 200)));
      row.append(el('button', { type: 'button', className: 'btn small', onclick: () => c.F.deleteDoc(d.ref) }, 'Remove from list'));
      return row;
    }));
  }, e => console.warn('Jobs unavailable', e));
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
    await Promise.all([showSite(), showPeople(), showVisits().catch(e => console.warn('Visits unavailable', e))]);
    bindAddForm();
    watchJobs();
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
