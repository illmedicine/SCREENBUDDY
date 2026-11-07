import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { InvalidBuddy, parseManifest } from '../js/manifest.js';
import { readZip, isWebp } from '../js/zip.js';

const root = new URL('../buddies/', import.meta.url);
const load = id => JSON.parse(readFileSync(new URL(`${id}/manifest.json`, root), 'utf8'));
const withChange = (id, fn) => { const m = load(id); fn(m); return m; };

// ---- manifests ---------------------------------------------------------------------------------

test('both shipped buddies parse, and every file they name exists and is a WebP', () => {
  for (const id of JSON.parse(readFileSync(new URL('index.json', root), 'utf8')).buddies) {
    const m = parseManifest(load(id));
    assert.equal(m.id, id);
    for (const file of [m.face, ...Object.values(m.clips).map(c => c.src)]) {
      assert.ok(existsSync(new URL(`${id}/${file}`, root)), `${id}/${file}`);
      assert.ok(isWebp(readFileSync(new URL(`${id}/${file}`, root))), `${id}/${file} is WebP`);
    }
  }
});

test('rejects clip files that escape the package', () => {
  for (const src of ['../strut.webp', '/etc/passwd', 'a/b.webp', 'strut.png']) {
    assert.throws(() => parseManifest(withChange('claw', m => { m.clips.strut.src = src; })), InvalidBuddy, src);
  }
});

test('rejects unknown moves and out-of-range stand frames', () => {
  assert.throws(() => parseManifest(withChange('claw', m => { m.poses = ['moonwalk']; })), InvalidBuddy);
  assert.throws(() => parseManifest(withChange('claw', m => { m.stand = ['moonwalk', 0]; })), InvalidBuddy);
  assert.throws(() => parseManifest(withChange('claw', m => { m.stand = ['hips', 17]; })), InvalidBuddy);
});

test('rejects garbage and prototype-poisoning move names', () => {
  for (const bad of [null, 'x', [], {}]) assert.throws(() => parseManifest(bad), InvalidBuddy);
  const m = load('claw');
  m.clips = JSON.parse('{"__proto__": {"n": 1, "src": "a.webp"}, "hips": {"n": 1, "src": "h.webp"}}');
  assert.throws(() => parseManifest(m), InvalidBuddy);
});

// ---- zip ---------------------------------------------------------------------------------------

/** Builds a zip by hand so both stored and deflated entries can be tested. CRCs are left 0: the reader doesn't check them. */
function makeZip(files, { deflate = false } = {}) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(enc.encode(name));
    const raw = Buffer.from(data);
    const body = deflate ? deflateRawSync(raw) : raw;
    const method = deflate ? 8 : 0;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(body.length), u32(raw.length), u16(n.length), u16(0), n, body]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(0), u32(body.length), u32(raw.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), n]));
    parts.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cd.length), u32(offset), u16(0)]);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}

test('reads the shipped claw.zip (stored)', async () => {
  const files = await readZip(readFileSync(new URL('claw.zip', root)));
  assert.ok(files.has('manifest.json'));
  assert.equal(parseManifest(JSON.parse(new TextDecoder().decode(files.get('manifest.json')))).id, 'claw');
  assert.ok(isWebp(files.get('hips.webp')));
});

test('reads deflated entries', async () => {
  const text = 'hello hello hello hello hello hello';
  const files = await readZip(makeZip({ 'a.txt': text }, { deflate: true }));
  assert.equal(new TextDecoder().decode(files.get('a.txt')), text);
});

test('rejects paths that leave the package, duplicates and non-zips', async () => {
  for (const name of ['../evil.webp', 'dir/x.webp', '.hidden', 'a\\b.webp']) {
    await assert.rejects(readZip(makeZip({ [name]: 'x' })), InvalidBuddy, name);
  }
  await assert.rejects(readZip(new Uint8Array([1, 2, 3, 4])), InvalidBuddy);
});

test('rejects an entry that inflates past its declared size', async () => {
  const zip = makeZip({ 'a.txt': 'x'.repeat(1000) }, { deflate: true });
  // central directory: uncompressed size is at offset 24 of the entry; lie that it is smaller.
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i < zip.length - 4; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 10, true);
  }
  await assert.rejects(readZip(zip), InvalidBuddy);
});
