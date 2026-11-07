// Decides which frame the buddy shows. This is the same behaviour as the Android player (BuddyAnimator.kt)
// and the original armaniwest walker.js, with no DOM, so it can be tested in Node.
//
//  - Idle:  stands on one chosen frame.
//  - Scrub: movement (page scroll, a drag) steps through the scroll move, STEP_PX per frame, forwards then
//           backwards so it never snaps; the buddy leans up to MAX_LEAN degrees; SETTLE_MS after the last
//           movement it goes back to standing.
//  - Pose:  plays a random pose that isn't the one before. Short poses play forwards then backwards.
//
// All times are caller-supplied milliseconds on any monotonic clock.
// `ready(move)` says whether a move's image has loaded; moves that haven't are never chosen.

export const STEP_PX = 28;
export const MAX_LEAN = 5;
export const LEAN_DIV = 8;
export const SETTLE_MS = 450;
export const LOOP_BELOW = 24;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class BuddyAnimator {
  lean = 0;
  #m; #random; #ready;
  #travel = 0;
  #lastMoveAt = 0;
  #scrubbing = false;
  #pose = null;
  #poseStart = 0;
  #poseTotal = 0;
  #lastPose = '';
  #current;

  constructor(manifest, { random = Math.random, ready = () => true } = {}) {
    this.#m = manifest;
    this.#random = random;
    this.#ready = ready;
    this.#current = { move: manifest.stand[0], frame: manifest.stand[1] };
  }

  get posing() { return this.#pose !== null; }
  /** True while something is moving and the host should keep redrawing. */
  get animating() { return this.posing || this.#scrubbing; }
  frame() { return this.#current; }

  /** Movement of `dy` pixels (signed; the sign leans the buddy) at time `now`. Ignored while posing, except the lean. */
  scrub(dy, now) {
    this.lean = clamp(dy / LEAN_DIV, -MAX_LEAN, MAX_LEAN);
    this.#lastMoveAt = now;
    if (this.posing) return;
    this.#scrubbing = true;
    const move = this.#m.scroll;
    if (!this.#ready(move)) return;
    this.#travel += Math.abs(dy);
    const n = this.#m.clips[move].n;
    if (n === 1) { this.#current = { move, frame: 0 }; return; }
    const cycle = 2 * n - 2;
    const k = Math.floor(this.#travel / STEP_PX) % cycle;
    this.#current = { move, frame: k < n ? k : cycle - k };
  }

  /** Starts a random ready pose, never the same as the last. False if one is playing or none has loaded. */
  tap(now) {
    if (this.posing) return false;
    let choices = this.#m.poses.filter(p => this.#ready(p) && p !== this.#lastPose);
    if (!choices.length) choices = this.#m.poses.filter(p => this.#ready(p));
    if (!choices.length) return false;
    this.#start(choices[Math.floor(this.#random() * choices.length)], now);
    return true;
  }

  /** Plays a specific move as a pose. */
  play(move, now) {
    if (this.posing || !(move in this.#m.clips) || !this.#ready(move)) return false;
    this.#start(move, now);
    return true;
  }

  #start(move, now) {
    const n = this.#m.clips[move].n;
    this.#pose = move; this.#lastPose = move; this.#poseStart = now;
    this.#poseTotal = n < LOOP_BELOW ? 2 * n - 1 : n;
    this.#scrubbing = false;
    this.#current = { move, frame: 0 };
  }

  /** Advances time-driven state. Call once per drawn frame. */
  update(now) {
    const p = this.#pose;
    if (p !== null) {
      const n = this.#m.clips[p].n;
      const k = Math.floor(((now - this.#poseStart) * this.#m.fps) / 1000);
      if (k >= this.#poseTotal) { this.#pose = null; this.#stand(); }
      else this.#current = { move: p, frame: k < n ? k : 2 * n - 2 - k };
    } else if (this.#scrubbing && now - this.#lastMoveAt >= SETTLE_MS) {
      this.#scrubbing = false;
      this.#stand();
    }
  }

  /** Drops whatever is playing and goes back to standing (used when the user pauses the buddy). */
  stop() {
    this.#pose = null;
    this.#scrubbing = false;
    this.#stand();
  }

  #stand() {
    this.lean = 0;
    this.#current = { move: this.#m.stand[0], frame: this.#m.stand[1] };
  }
}
