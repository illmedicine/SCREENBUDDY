// Reads a buddy.zip in the browser. The archive is untrusted: only flat, size-limited, unencrypted files
// (stored or deflated) are accepted, and nothing is returned unless every entry passes.

import { InvalidBuddy } from './manifest.js';

export const MAX_FILES = 40;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 200;

const bad = message => { throw new InvalidBuddy(message); };

/** @returns {Promise<Map<string, Uint8Array>>} file name -> bytes */
export async function readZip(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const need = (pos, len) => { if (pos < 0 || pos + len > u8.length) bad('Damaged zip file'); };

  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) bad('Not a zip file');
  const entries = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  if (entries > MAX_ENTRIES) bad('Too many files in zip');

  const out = new Map();
  let total = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let e = 0; e < entries; e++) {
    need(pos, 46);
    if (dv.getUint32(pos, true) !== 0x02014b50) bad('Damaged zip file');
    const flags = dv.getUint16(pos + 8, true);
    const method = dv.getUint16(pos + 10, true);
    const comp = dv.getUint32(pos + 20, true);
    const size = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const local = dv.getUint32(pos + 42, true);
    need(pos + 46, nameLen);
    let name;
    try { name = decoder.decode(u8.subarray(pos + 46, pos + 46 + nameLen)); } catch { bad('Bad file name in zip'); }
    pos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;                                    // folder entry
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) bad(`Unexpected path '${name}' in zip`);
    if (out.has(name)) bad(`Duplicate file '${name}' in zip`);
    if (out.size >= MAX_FILES) bad('Too many files in zip');
    if (flags & 1) bad('Encrypted zips are not supported');
    if (comp === 0xffffffff || size === 0xffffffff) bad('Zip64 files are not supported');
    if (size > MAX_FILE_BYTES) bad('A file in the zip is too large');
    total += size;
    if (total > MAX_TOTAL_BYTES) bad('Zip is too large');

    need(local, 30);
    if (dv.getUint32(local, true) !== 0x04034b50) bad('Damaged zip file');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    need(start, comp);
    const data = u8.subarray(start, start + comp);
    if (method === 0) {
      if (comp !== size) bad('Damaged zip file');
      out.set(name, data.slice());
    } else if (method === 8) {
      const bytes = await inflateRaw(data, size);
      if (bytes.length !== size) bad('Damaged zip file');
      out.set(name, bytes);
    } else {
      bad('Unsupported zip compression');
    }
  }
  return out;
}

async function inflateRaw(data, limit) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); bad('Damaged zip file'); }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof InvalidBuddy) throw err;
    bad('Damaged zip file');
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** True if the bytes start like a WebP file. */
export function isWebp(bytes) {
  const s = (a, b) => String.fromCharCode(...bytes.subarray(a, b));
  return bytes.length > 12 && s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP';
}
