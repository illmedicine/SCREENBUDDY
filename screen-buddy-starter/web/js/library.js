// Characters, the shared collection, favorites and on-screen stats: the pure rules the pages share with the tests.
// No browser or Firebase APIs here. /firestore.rules enforces the same limits on the server; keep them in step
// (web/test/rules-sync.test.mjs checks the numbers).

export const NAME_MAX = 40;          // a character's name (same as a profile name)
export const VIDEO_MAX = 500;        // the video link
export const VIDEO_FILE_MAX = 100 * 1024 * 1024;   // an uploaded video file (storage.rules)
export const UPLOAD_HOST = 'https://firebasestorage.googleapis.com/';
export const LINK_MAX = 300;         // a creator's social link
export const CREATOR_MAX = 60;       // a creator's name
export const MAX_RUNS = 4;           // the first run plus 3 free re-dos
export const STAT_MAX_SELECTIONS = 10;   // most selections one stats write may add
export const STAT_MAX_SECONDS = 900;     // most seconds on screen one stats write may add
export const ADMIN_EMAILS = Object.freeze(['demarkuswilsone@gmail.com']);

/** Where a video link points. Any public https page works; these get a friendly name. */
const PLATFORMS = [
  ['YouTube', /(^|\.)(youtube\.com|youtu\.be)$/],
  ['TikTok', /(^|\.)tiktok\.com$/],
  ['Instagram', /(^|\.)instagram\.com$/],
  ['Facebook', /(^|\.)(facebook\.com|fb\.watch)$/],
  ['X', /(^|\.)(x\.com|twitter\.com)$/],
  ['Snapchat', /(^|\.)snapchat\.com$/],
  ['Vimeo', /(^|\.)vimeo\.com$/],
  ['Twitch', /(^|\.)twitch\.tv$/],
];

const FILE_LINK = /\.(zip|rar|7z|exe|apk|dmg|pkg)$/i;

/** A pasted link made tidy: trimmed, https:// added when missing, http upgraded. '' when it is not a usable web link. */
export function cleanUrl(raw, max = VIDEO_MAX) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return '';
  const out = u.toString();
  return out.length <= max && !/\s/.test(out) ? out : '';
}

/** The video link for a new character, or '' when it can't be used (not https, a file download, too long). */
export function cleanVideoUrl(raw) {
  const url = cleanUrl(raw, VIDEO_MAX);
  if (!url || url.length < 12) return '';
  return FILE_LINK.test(new URL(url).pathname) ? '' : url;
}

/** 'YouTube', 'TikTok', … or 'Web' for any other site. '' for a bad link. */
export function videoPlatform(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  for (const [name, re] of PLATFORMS) if (re.test(host)) return name;
  return 'Web';
}

/** A creator's social link: '' (none) or a clean https link. Returns null when something was typed but it isn't a link. */
export function cleanLink(raw) {
  if (!String(raw ?? '').trim()) return '';
  return cleanUrl(raw, LINK_MAX) || null;
}

export function cleanText(raw, max) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** A stable document id for a favorite creator, from their link: "tiktok-com-kiah". */
export function creatorKey(link) {
  let u;
  try { u = new URL(link); } catch { return ''; }
  const raw = `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || '';
}

/** A new character id: 20 letters and digits. */
export function newCharacterId(random = () => Math.random()) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 20; i++) s += abc[Math.floor(random() * abc.length)];
  return s;
}

/** The key a character is counted and featured under: a shared buddy's id, or "<uid>__<characterId>". */
export const ownKey = (uid, cid) => `${uid}__${cid}`;
export const isOwnKey = key => typeof key === 'string' && key.includes('__');

/** Checks a chosen video file. Returns '' when it can be uploaded, else a message for the person. */
export function checkVideoFile(file) {
  if (!file) return 'Choose a video file.';
  if (!/^video\//.test(file.type ?? '')) return "That file isn't a video. Choose an MP4, MOV or WebM video.";
  if (!(file.size > 0)) return 'That video is empty.';
  if (file.size > VIDEO_FILE_MAX) return 'That video is over 100 MB. Trim it to a few seconds and try again.';
  return '';
}

/** The storage name for an uploaded video, from its type: "video.mp4". Matches storage.rules. */
export function videoFileName(file) {
  const fromType = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/3gpp': '3gp' }[file?.type];
  const fromName = String(file?.name ?? '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  return `video.${fromType ?? fromName ?? 'mp4'}`;
}

/**
 * Checks the "make a character" form. Returns { ok: true, value } with the document fields to write, or
 * { ok: false, error } with a message for the person.
 */
export function newCharacter({ videoUrl, name, creatorName, creatorLink, uploaded = false }) {
  const url = uploaded
    ? (typeof videoUrl === 'string' && videoUrl.startsWith(UPLOAD_HOST) && videoUrl.length <= VIDEO_MAX ? videoUrl : '')
    : cleanVideoUrl(videoUrl);
  if (!url) return { ok: false, error: uploaded ? 'The upload did not finish. Try again.' : 'Paste a link to a public video (YouTube, TikTok, Instagram and so on), or upload a video.' };
  const n = cleanText(name, NAME_MAX);
  if (!n) return { ok: false, error: 'Give your character a name.' };
  const link = cleanLink(creatorLink);
  if (link === null) return { ok: false, error: "The creator's link should be a web address, like https://www.tiktok.com/@name." };
  return {
    ok: true,
    value: {
      name: n,
      videoUrl: url,
      platform: uploaded ? 'Upload' : videoPlatform(url),
      creatorName: cleanText(creatorName, CREATOR_MAX),
      creatorLink: link,
      status: 'queued',
      runs: 1,
      disabled: false,
    },
  };
}

export const STATUS = Object.freeze({
  queued: 'Waiting in line',
  processing: 'Being made',
  ready: 'Ready',
  failed: "Didn't work",
});

export const statusLabel = s => STATUS[s] ?? 'Waiting in line';

/** Re-dos left for a character, or 0 when it can't be redone right now. */
export function redosLeft(c) {
  if (!c || c.disabled || !['ready', 'failed'].includes(c.status)) return 0;
  return Math.max(0, MAX_RUNS - (Number.isInteger(c.runs) ? c.runs : MAX_RUNS));
}

/**
 * The shared collection: the site's buddies with the admin's settings on top.
 * @param {{id: string, name: string, author?: string, from?: string}[]} manifests
 * @param {Object<string, {name?: string, creatorName?: string, creatorLink?: string, hidden?: boolean}>} overlays
 * @param {{includeHidden?: boolean}} [opts]
 */
export function mergeCollection(manifests, overlays = {}, { includeHidden = false } = {}) {
  const out = [];
  for (const m of manifests) {
    const o = overlays[m.id] ?? {};
    const item = {
      id: m.id,
      name: o.name || m.name,
      creatorName: o.creatorName || m.author || '',
      creatorLink: cleanLink(o.creatorLink) || '',
      from: m.from || '',
      hidden: o.hidden === true,
    };
    if (includeHidden || !item.hidden) out.push(item);
  }
  return out;
}

/** The buddy to feature on the landing page: the admin's pick if it is visible, else the first visible one. */
export function pickFeatured(collection, featured) {
  return collection.find(b => b.id === featured && !b.hidden) ?? collection.find(b => !b.hidden) ?? null;
}

/**
 * Counts selections and time on screen per character between writes, so the page writes at most once a minute.
 * drain() hands back what to add, capped to what the rules accept in one write; anything over the cap waits.
 */
export class StatsTally {
  constructor() { this.pending = new Map(); }

  #get(key) {
    let p = this.pending.get(key);
    if (!p) this.pending.set(key, p = { selections: 0, ms: 0 });
    return p;
  }

  select(key) { if (key) this.#get(key).selections += 1; }

  /** Adds `ms` of time on screen, ignoring nonsense (negative, or a sleeping laptop's hours). */
  tick(key, ms) { if (key && Number.isFinite(ms) && ms > 0 && ms <= 120_000) this.#get(key).ms += ms; }

  /** @returns {{key: string, selections: number, seconds: number}[]} */
  drain() {
    const out = [];
    for (const [key, p] of this.pending) {
      const selections = Math.min(p.selections, STAT_MAX_SELECTIONS);
      const seconds = Math.min(Math.floor(p.ms / 1000), STAT_MAX_SECONDS);
      if (!selections && !seconds) continue;
      p.selections -= selections;
      p.ms -= seconds * 1000;
      out.push({ key, selections, seconds });
    }
    for (const [key, p] of this.pending) if (!p.selections && p.ms < 1000) this.pending.delete(key);
    return out;
  }
}

/** "2 h 05 min", "4 min", "35 s". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function isAdminEmail(email, verified = true) {
  return Boolean(verified) && ADMIN_EMAILS.includes(String(email ?? '').toLowerCase());
}
