// The shared collection as every page sees it: the site's buddies (buddies/index.json) with the admin's settings from
// Firestore (buddies/{id}: hidden, creator link) and the site settings (config/site: featured buddy). Works without
// Firestore too: then nothing is hidden and the first buddy is featured.
import { cloud } from './cloud.js';
import { firebaseConfig } from './firebase-config.js';
import { parseManifest, MANIFEST_FILE } from './manifest.js';
import { mergeCollection } from './library.js';

/** A public file in Cloud Storage (buddies the processing worker published), by its path in the bucket. */
export const storageUrl = path =>
  `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;

/** @returns {Promise<{id: string, manifest: object, url: (file: string) => string}[]>} the site's own buddies */
export async function loadManifests() {
  try {
    const { buddies } = await (await fetch('buddies/index.json')).json();
    const all = await Promise.all(buddies.map(async id => {
      try { return { id, manifest: parseManifest(await (await fetch(`buddies/${id}/${MANIFEST_FILE}`)).json()), url: f => `buddies/${id}/${f}` }; }
      catch { return null; }
    }));
    return all.filter(Boolean);
  } catch { return []; }
}

/**
 * Shared buddies added from the admin page after the site was built (Firestore catalog/{id}, files in Storage under
 * its prefix). They appear on every page and in every app straight away, with no new release.
 * @returns {Promise<{id: string, manifest: object, url: (file: string) => string, version: number}[]>}
 */
export async function loadCloudBuddies(waitMs = 3000) {
  const work = (async () => {
    const c = await cloud();
    if (!c) return [];
    const snap = await c.F.getDocs(c.F.collection(c.db, 'catalog'));
    const all = await Promise.all(snap.docs.map(async d => {
      const x = d.data();
      if (typeof x.prefix !== 'string' || !x.prefix.startsWith('buddies/')) return null;
      const url = f => storageUrl(x.prefix + f);
      try { return { id: d.id, manifest: { ...parseManifest(await (await fetch(url(MANIFEST_FILE))).json()), id: d.id }, url, version: x.version | 0 }; }
      catch { return null; }
    }));
    return all.filter(Boolean);
  })().catch(e => { console.warn('Cloud buddies unavailable', e); return []; });
  return Promise.race([work, new Promise(res => setTimeout(() => res([]), waitMs))]);
}

/** Admin settings and site settings, or empty ones when Firestore can't be reached within `waitMs`. */
export async function loadSettings(waitMs = 2500) {
  const empty = { overlays: {}, site: {} };
  const work = (async () => {
    const c = await cloud();
    if (!c) return empty;
    const { F, db } = c;
    const [list, site] = await Promise.all([F.getDocs(F.collection(db, 'buddies')), F.getDoc(F.doc(db, 'config', 'site'))]);
    const overlays = {};
    list.forEach(d => { overlays[d.id] = d.data(); });
    return { overlays, site: site.exists() ? site.data() : {} };
  })().catch(e => { console.warn('Collection settings unavailable', e); return empty; });
  return Promise.race([work, new Promise(res => setTimeout(() => res(empty), waitMs))]);
}

/** Everything a page needs: [{id, name, creatorName, creatorLink, hidden, manifest, url, cloud}], plus the featured id. */
export async function loadCollection({ includeHidden = false } = {}) {
  const [own, extra, { overlays, site }] = await Promise.all([loadManifests(), loadCloudBuddies(), loadSettings()]);
  const ownIds = new Set(own.map(m => m.id));
  const manifests = [...own, ...extra.filter(m => !ownIds.has(m.id)).map(m => ({ ...m, cloud: true }))];
  const byId = new Map(manifests.map(m => [m.id, m]));
  const items = mergeCollection(manifests.map(m => m.manifest), overlays, { includeHidden })
    .map(item => ({ ...item, manifest: byId.get(item.id).manifest, url: byId.get(item.id).url, cloud: byId.get(item.id).cloud === true }));
  return { items, featured: typeof site.featured === 'string' ? site.featured : '', site, overlays };
}

/** A small "by <creator>" line with the creator's social link when there is one. Text only, never HTML. */
export function creatorLine(item, className = 'by') {
  const p = document.createElement('p');
  p.className = `${className} creator`;
  if (!item.creatorName && !item.creatorLink) return p;
  p.append('by ');
  if (item.creatorLink) {
    const a = document.createElement('a');
    a.href = item.creatorLink;
    a.target = '_blank';
    a.rel = 'noopener nofollow';
    a.textContent = item.creatorName || new URL(item.creatorLink).hostname.replace(/^www\./, '');
    p.append(a);
  } else {
    p.append(item.creatorName);
  }
  return p;
}
