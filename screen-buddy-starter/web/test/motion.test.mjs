import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityGate, SoundGate, startMotion } from '../js/motion.js';

const feed = (g, level, from, to, step = 10) => {
  let last = false;
  for (let t = from; t <= to; t += step) last = g.update(level, t);
  return last;
};

test('ActivityGate: quiet until pinged, holds through short pauses, then stops', () => {
  const g = new ActivityGate(700);
  assert.equal(g.isActive(0), false);
  g.ping(1000);
  assert.equal(g.isActive(1699), true);
  g.ping(1600);
  assert.equal(g.isActive(2299), true);
  assert.equal(g.isActive(2300), false);
  g.reset();
  assert.equal(g.isActive(2301), false);
});

test('SoundGate: silence never activates', () => {
  const g = new SoundGate();
  assert.equal(feed(g, 0, 0, 5000), false);
  assert.equal(feed(g, 0.005, 5000, 10000), false);
});

test('SoundGate: loud sound activates after the attack and stops after the release', () => {
  const g = new SoundGate();
  feed(g, 0, 0, 1000);
  assert.equal(g.update(0.3, 1010), false);
  assert.equal(feed(g, 0.3, 1020, 1200), true);
  assert.equal(feed(g, 0, 1210, 1800), true);
  assert.equal(feed(g, 0, 1810, 2000), false);
});

test('SoundGate: a brief pop is ignored', () => {
  const g = new SoundGate();
  feed(g, 0, 0, 1000);
  g.update(0.9, 1000); g.update(0.9, 1010);
  assert.equal(feed(g, 0, 1020, 1500), false);
});

test('SoundGate: gaps between words do not stop it', () => {
  const g = new SoundGate();
  feed(g, 0, 0, 1000);
  feed(g, 0.3, 1010, 1300);
  for (let i = 0; i < 5; i++) {
    feed(g, 0, 1310 + i * 800, 1600 + i * 800);
    assert.equal(feed(g, 0.3, 1610 + i * 800, 2100 + i * 800), true);
  }
});

test('SoundGate: a steady hum, even present from the start, is learned and ignored', () => {
  const g = new SoundGate();
  assert.equal(feed(g, 0.05, 0, 30000), false);
  assert.ok(g.noiseFloor > 0.04 && g.noiseFloor < 0.051);
  assert.equal(feed(g, 0.4, 30010, 30300), true);
  const h = new SoundGate();
  assert.equal(feed(h, 0.08, 0, 20000), false);
});

test('SoundGate: garbage readings are ignored', () => {
  const g = new SoundGate();
  assert.equal(g.update(NaN, 0), false);
  assert.equal(g.update(Infinity, 10), false);
  assert.equal(g.update(-5, 20), false);
});

test("startMotion: 'touch' does nothing and can be stopped", () => {
  const m = startMotion('touch', { scrub() { throw new Error('should not move'); } });
  m.stop();
});

globalThis.requestAnimationFrame ??= () => 1;
globalThis.cancelAnimationFrame ??= () => {};

test('startMotion: sound mode reports a browser without a microphone API', async () => {
  const problems = [];
  const m = startMotion('sound', { scrub() {}, onProblem: p => problems.push(p), now: () => 0 });
  await Promise.resolve();
  m.stop();
  assert.equal(problems.length, 1);
});
