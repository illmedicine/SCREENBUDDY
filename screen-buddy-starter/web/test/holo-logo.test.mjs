import test from 'node:test';
import assert from 'node:assert/strict';
import { bustRect, phase, CYCLE_MS } from '../js/holo-logo.js';

/** A w x h alpha map with an opaque figure: a head (small block) on top of a body (wider block). */
function figure(w, h, { headX, top, bottom, headW = 10, bodyW = 30 }) {
  const a = new Uint8ClampedArray(w * h);
  const headBottom = top + Math.round((bottom - top) / 6);
  for (let y = top; y <= bottom; y++) {
    const half = (y <= headBottom ? headW : bodyW) / 2;
    for (let x = Math.round(headX - half); x < Math.round(headX + half); x++) if (x >= 0 && x < w) a[y * w + x] = 255;
  }
  return a;
}

test('bustRect frames the head to waist of the figure', () => {
  const a = figure(200, 370, { headX: 100, top: 40, bottom: 360 });
  const r = bustRect(a, 200, 370);
  assert.equal(r.size, Math.round(321 * 0.56));
  assert.ok(Math.abs(r.x + r.size / 2 - 100) <= 1, 'centred on the head');
  assert.ok(r.y <= 40 && r.y >= 40 - r.size * 0.06, 'starts just above the head');
});

test('bustRect stays inside the frame', () => {
  const a = figure(200, 370, { headX: 4, top: 2, bottom: 368 });
  const r = bustRect(a, 200, 370);
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.size <= 200 && r.y + r.size <= 370);
});

test('bustRect ignores faint pixels and returns null for an empty frame', () => {
  assert.equal(bustRect(new Uint8ClampedArray(50 * 50).fill(20), 50, 50), null);
});

test('phase rotates through the buddies, rising then fading', () => {
  assert.deepEqual(phase(0, 3), { index: 0, rise: 0, fade: 0 });
  assert.equal(phase(CYCLE_MS * 0.5, 3).rise, 1);
  assert.equal(phase(CYCLE_MS * 0.5, 3).fade, 0);
  assert.ok(phase(CYCLE_MS - 1, 3).fade > 0.9);
  assert.equal(phase(CYCLE_MS + 10, 3).index, 1);
  assert.equal(phase(CYCLE_MS * 3 + 10, 3).index, 0);
});

test('a single buddy never fades out', () => {
  assert.equal(phase(CYCLE_MS - 1, 1).fade, 0);
  assert.equal(phase(CYCLE_MS * 5, 0).index, 0);
});
