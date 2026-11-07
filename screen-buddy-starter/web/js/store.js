// The buddy library: sample buddies shipped with the site (buddies/<id>/) plus buddies the visitor imported
// from a buddy.zip, kept in this browser's IndexedDB (they never leave the device).

import { InvalidBuddy, MANIFEST_FILE, parseManifest } from './manifest.js';
import { isWebp, readZip } from './zip.js';

/** @typedef {{manifest: ReturnType<typeof parseManifest>, bundled: boolean, url: (file: string) => string}} Buddy */

const DB_NAME = 'screenbuddy';
const STORE = 'buddies';
const memory = new Map();          // used when IndexedDB isn't available (some private windows): lasts until reload
let dbPromise;

const request = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } catch (e) { reject(e); }
  }).catch(() => null);
  return dbPromise;
}

async function getAll() {
  const d = await db();
  return d ? request(d.transaction(STORE).objectStore(STORE).getAll()) : [...memory.values()];
}
async function put(record) {
  const d = await db();
  if (!d) { memory.set(record.id, record); return; }
  const t = d.transaction(STORE, 'readwrite');
  t.objectStore(STORE).put(record);
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}
async function del(id) {
  const d = await db();
  if (!d) { memory.delete(id); return; }
  const t = d.transaction(STORE, 'readwrite');
  t.objectStore(STORE).delete(id);
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
}

/** Imported files are Blobs; give the page object URLs for them. */
function importedBuddy(record) {
  const urls = new Map(Object.entries(record.files).map(([name, blob]) => [name, URL.createObjectURL(blob)]));
  return { manifest: parseManifest(record.manifest), bundled: false, url: file => urls.get(file) ?? '', revoke: () => urls.forEach(u => URL.revokeObjectURL(u)) };
}

/** The sample buddies. Resolves to [] if the site's buddy list can't be read. */
export async function loadBundled() {
  try {
    const { buddies } = await (await fetch('buddies/index.json')).json();
    const all = await Promise.all(buddies.map(async id => {
      try {
        const manifest = parseManifest(await (await fetch(`buddies/${id}/${MANIFEST_FILE}`)).json());
        return { manifest, bundled: true, url: file => `buddies/${id}/${file}`, zip: `buddies/${id}.zip` };
      } catch { return null; }
    }));
    return all.filter(Boolean);
  } catch { return []; }
}

export async function loadImported() {
  const out = [];
  for (const record of await getAll()) {
    try { out.push(importedBuddy(record)); } catch { /* a bad record is skipped, not fatal */ }
  }
  return out;
}

/**
 * Imports a buddy.zip. Nothing is kept unless the whole package is valid: the manifest parses, every file it
 * names is present and is a WebP image, and the id doesn't clash with a built-in buddy.
 * @param {ArrayBuffer} buffer
 * @param {Set<string>} reservedIds ids that are already taken by built-in buddies
 */
export async function importZip(buffer, reservedIds) {
  const files = await readZip(buffer);
  const raw = files.get(MANIFEST_FILE);
  if (!raw) throw new InvalidBuddy(`No ${MANIFEST_FILE} in zip`);
  let json;
  try { json = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new InvalidBuddy('manifest.json is not valid JSON'); }
  const manifest = parseManifest(json);
  if (reservedIds.has(manifest.id)) throw new InvalidBuddy(`A built-in buddy already uses the id '${manifest.id}'. Change "id" in manifest.json.`);
  const needed = new Set([manifest.face, ...Object.values(manifest.clips).map(c => c.src)]);
  const blobs = {};
  for (const name of needed) {
    const bytes = files.get(name) ?? (() => { throw new InvalidBuddy(`Missing file ${name}`); })();
    if (!isWebp(bytes)) throw new InvalidBuddy(`${name} is not a WebP image`);
    blobs[name] = new Blob([bytes], { type: 'image/webp' });
  }
  const record = { id: manifest.id, manifest: json, files: blobs };
  await put(record);
  return importedBuddy(record);
}

export const removeImported = id => del(id);
