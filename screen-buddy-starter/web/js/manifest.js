// Validates a buddy manifest. Same rules as the Android app (BuddyManifest.kt), so one package works on both.
// Packages can come from anyone, so nothing in a manifest may name a file outside the package.

export class InvalidBuddy extends Error {}
const bad = message => { throw new InvalidBuddy(message); };

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MOVE = /^[A-Za-z0-9_-]{1,32}$/;
const FILE_NAME = /^[A-Za-z0-9_-]{1,64}\.webp$/;

export const MANIFEST_FILE = 'manifest.json';

/** @returns {{id,name,author,version,from,cw,ch,fps,stand:[string,number],scroll:string,poses:string[],face:string,clips:Object<string,{n:number,src:string}>}} */
export function parseManifest(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) bad('Not a valid buddy manifest');
  const text = (v, what) => (typeof v === 'string' && v.trim() ? v : bad(`Missing ${what}`));
  const int = (v, lo, hi, what) => (Number.isInteger(v) && v >= lo && v <= hi ? v : bad(`Bad ${what}`));

  const id = text(o.id, 'id');
  if (!ID.test(id)) bad(`Bad id '${id}'`);

  if (!o.clips || typeof o.clips !== 'object' || Array.isArray(o.clips)) bad('Missing clips');
  const clips = Object.create(null);
  for (const [name, c] of Object.entries(o.clips)) {
    if (!MOVE.test(name)) bad(`Bad move name '${name}'`);
    if (!c || typeof c !== 'object') bad(`Bad clip '${name}'`);
    if (typeof c.src !== 'string' || !FILE_NAME.test(c.src)) bad(`Bad clip file '${c.src}'`);
    clips[name] = { n: int(c.n, 1, 400, `frame count of '${name}'`), src: c.src };
  }
  const known = name => (typeof name === 'string' && name in clips ? name : bad(`Unknown move '${name}'`));

  if (!Array.isArray(o.stand) || o.stand.length !== 2) bad('Bad stand');
  const standClip = known(o.stand[0]);
  const standFrame = int(o.stand[1], 0, clips[standClip].n - 1, `stand frame (outside '${standClip}')`);
  const scroll = known(o.scroll);
  if (!Array.isArray(o.poses)) bad('Bad poses');
  const poses = o.poses.map(known);
  if (typeof o.face !== 'string' || !FILE_NAME.test(o.face)) bad(`Bad face file '${o.face}'`);

  return Object.freeze({
    id,
    name: text(o.name, 'name'),
    author: typeof o.author === 'string' ? o.author : '',
    version: Number.isInteger(o.version) ? o.version : 1,
    from: typeof o.from === 'string' ? o.from : '',
    cw: int(o.cw, 16, 2048, 'cell width'),
    ch: int(o.ch, 16, 2048, 'cell height'),
    fps: o.fps === undefined ? 10 : int(o.fps, 1, 60, 'fps'),
    stand: [standClip, standFrame],
    scroll,
    poses,
    face: o.face,
    clips,
  });
}
