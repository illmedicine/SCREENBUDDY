// The shared collection as every page sees it: the site's buddies (buddies/index.json) with the admin's settings from
// Firestore (buddies/{id}: hidden, creator link) and the site settings (config/site: featured buddy). Works without
// Firestore too: then nothing is hidden and the first buddy is featured.
import { cloud } from './cloud.js';
import { parseManifest, MANIFEST_FILE } from './manifest.js';
import { mergeCollection } from './library.js';

/** @returns {Promise<{id: string, manifest: object, dir: string}[]>} the site's buddies with valid manifests */
export async function loadManifests() {
  try {
    const { buddies } = await (await fetch('buddies/index.json')).json();
    const all = await Promise.all(buddies.map(async id => {
      try { return { id, manifest: parseManifest(await (await fetch(`buddies/${id}/${MANIFEST_FILE}`)).json()), dir: `buddies/${id}` }; }
      catch { return null; }
    }));
    return all.filter(Boolean);
  } catch { return []; }
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

/** Everything a page needs: [{id, name, creatorName, creatorLink, hidden, manifest, dir}], plus the featured id. */
export async function loadCollection({ includeHidden = false } = {}) {
  const [manifests, { overlays, site }] = await Promise.all([loadManifests(), loadSettings()]);
  const byId = new Map(manifests.map(m => [m.id, m]));
  const items = mergeCollection(manifests.map(m => m.manifest), overlays, { includeHidden })
    .map(item => ({ ...item, manifest: byId.get(item.id).manifest, dir: byId.get(item.id).dir }));
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
