import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BuddyAnimator } from '../js/animator.js';
import { parseManifest } from '../js/manifest.js';

const claw = parseManifest(JSON.parse(readFileSync(new URL('../buddies/claw/manifest.json', import.meta.url), 'utf8')));

// A small seeded generator so "random" choices repeat between runs.
const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const make = (ready, seed = 1) => new BuddyAnimator(claw, { random: seeded(seed), ready });

test('starts on the standing frame', () => {
  const a = make();
  assert.deepEqual(a.frame(), { move: 'hips', frame: 0 });
  assert.equal(a.animating, false);
});

test('scrolling steps through the walk one frame per 28px', () => {
  const a = make();
  a.scrub(28, 0);
  assert.deepEqual(a.frame(), { move: 'strut', frame: 1 });
  a.scrub(28 * 8, 10);
  assert.deepEqual(a.frame(), { move: 'strut', frame: 9 });
});

test('the walk plays backwards at the end instead of snapping', () => {
  const a = make();
  a.scrub(28 * 10, 0);             // 10 of an 18-step cycle: coming back
  assert.deepEqual(a.frame(), { move: 'strut', frame: 8 });
  a.scrub(28 * 8, 10);
  assert.deepEqual(a.frame(), { move: 'strut', frame: 0 });
});

test('lean follows movement and is clamped to 5 degrees', () => {
  const a = make();
  a.scrub(16, 0);
  assert.equal(a.lean, 2);
  a.scrub(-500, 1);
  assert.equal(a.lean, -5);
});

test('goes back to standing 450ms after movement stops', () => {
  const a = make();
  a.scrub(60, 1000);
  assert.equal(a.animating, true);
  a.update(1449);
  assert.equal(a.animating, true);
  a.update(1450);
  assert.equal(a.animating, false);
  assert.deepEqual(a.frame(), { move: 'hips', frame: 0 });
  assert.equal(a.lean, 0);
});

test('a tap starts a pose and never repeats the last one', () => {
  const a = make();
  let last = '', t = 0;
  for (let i = 0; i < 40; i++) {
    assert.ok(a.tap(t));
    const { move } = a.frame();
    assert.ok(claw.poses.includes(move));
    assert.notEqual(move, last);
    last = move;
    t += 10_000;
    a.update(t);
    assert.equal(a.posing, false);
  }
});

test('a second tap during a pose is ignored', () => {
  const a = make();
  assert.ok(a.tap(0));
  assert.equal(a.tap(100), false);
});

test('short poses play forwards then backwards', () => {
  const a = make();
  assert.ok(a.play('hips', 0));    // 17 frames: 33 steps there and back
  a.update(0);    assert.deepEqual(a.frame(), { move: 'hips', frame: 0 });
  a.update(1600); assert.deepEqual(a.frame(), { move: 'hips', frame: 16 });
  a.update(1700); assert.deepEqual(a.frame(), { move: 'hips', frame: 15 });
  a.update(3200); assert.deepEqual(a.frame(), { move: 'hips', frame: 0 });
  assert.equal(a.posing, true);
  a.update(3300);                  // 33 steps done
  assert.equal(a.posing, false);
  assert.deepEqual(a.frame(), { move: 'hips', frame: 0 });
});

test('long poses play once', () => {
  const a = make();
  assert.ok(a.play('wave', 0));    // 40 frames at 10 fps = 4s
  a.update(3900); assert.deepEqual(a.frame(), { move: 'wave', frame: 39 });
  assert.equal(a.posing, true);
  a.update(4000);
  assert.equal(a.posing, false);
});

test('movement during a pose does not interrupt it', () => {
  const a = make();
  a.play('wave', 0);
  a.update(500);
  const before = a.frame();
  a.scrub(200, 600);
  assert.deepEqual(a.frame(), before);
  assert.equal(a.posing, true);
});

test('never chooses a move that has not loaded', () => {
  const a = make(m => m === 'arms');
  for (let i = 0; i < 10; i++) {
    assert.ok(a.tap(i * 10_000));
    assert.equal(a.frame().move, 'arms');
    a.update(i * 10_000 + 9_999);
  }
});

test('taps do nothing, and the walk keeps standing, when nothing has loaded', () => {
  const a = make(() => false);
  assert.equal(a.tap(0), false);
  a.scrub(100, 0);
  assert.deepEqual(a.frame(), { move: 'hips', frame: 0 });
});

test('stop() drops a pose and returns to standing', () => {
  const a = make();
  a.play('wave', 0);
  a.update(500);
  a.stop();
  assert.equal(a.posing, false);
  assert.equal(a.animating, false);
  assert.deepEqual(a.frame(), { move: 'hips', frame: 0 });
});
