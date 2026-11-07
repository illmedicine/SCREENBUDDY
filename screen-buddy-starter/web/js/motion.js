// What makes the buddy move on its own: steadily, while you type, or while the microphone hears sound.
// The two gates are the same logic as the Windows app (ScreenBuddy.Core/Motion.cs), so the modes feel alike.

/** Active from a ping until `holdMs` after the last one, so typing with small pauses is one continuous movement. */
export class ActivityGate {
  #last = null;
  constructor(holdMs = 700) { this.holdMs = holdMs; }
  ping(now) { this.#last = now; }
  isActive(now) { return this.#last !== null && now - this.#last < this.holdMs; }
  reset() { this.#last = null; }
}

/**
 * Decides from loudness readings (0 to 1) whether there is sound. The first moments only measure the room, the
 * threshold then follows the room's background level (so a fan isn't "sound"), a pop shorter than `attackMs` is
 * ignored, and once going it keeps moving through gaps between words until `releaseMs` after the sound ends.
 */
export class SoundGate {
  #floor = 0;
  #aboveSince = null;
  #startedAt = null;
  #lastLoud = 0;
  #active = false;
  constructor({ minThreshold = 0.02, ratio = 3, attackMs = 80, releaseMs = 700, calibrationMs = 600 } = {}) {
    Object.assign(this, { minThreshold, ratio, attackMs, releaseMs, calibrationMs });
  }
  get noiseFloor() { return this.#floor; }
  get active() { return this.#active; }
  update(level, now) {
    level = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    this.#startedAt ??= now;
    if (now - this.#startedAt < this.calibrationMs) {
      this.#floor += (level - this.#floor) * 0.1;
      return false;
    }
    const threshold = Math.max(this.minThreshold, this.#floor * this.ratio);
    if (level > threshold) {
      this.#aboveSince ??= now;
      this.#lastLoud = now;
      if (!this.#active && now - this.#aboveSince >= this.attackMs) this.#active = true;
    } else {
      this.#aboveSince = null;
      if (this.#active && now - this.#lastLoud >= this.releaseMs) this.#active = false;
      if (!this.#active) this.#floor = level < this.#floor ? level : this.#floor + (level - this.#floor) * 0.02;
    }
    return this.#active;
  }
  reset() { this.#floor = 0; this.#aboveSince = null; this.#startedAt = null; this.#active = false; }
}

export const MODES = ['touch', 'steady', 'typing', 'sound'];

// Walking pace: scrubbing moves the walk cycle by 28 px per frame and the sample buddies run at 10 frames/s.
const NATURAL_PX_PER_SEC = 28 * 10;
const STEADY_FACTOR = 0.6;

/**
 * Starts driving a buddy in `mode`. `scrub(px)` moves its walk cycle; `onProblem(message)` is called if the
 * microphone can't be used. Returns `{ stop() }`. Typing only sees keys pressed while this page is focused:
 * a web page can't see what you type anywhere else (the Windows app can).
 */
export function startMotion(mode, { scrub, onProblem = () => {}, now = () => performance.now() }) {
  if (mode === 'touch') return { stop() {} };
  const typing = new ActivityGate();
  const sound = new SoundGate();
  let analyser = null, buf = null, stream = null, ctx = null, stopped = false, raf = 0, last = now();
  const cleanup = new AbortController();

  if (mode === 'typing') addEventListener('keydown', () => typing.ping(now()), { signal: cleanup.signal, capture: true });

  if (mode === 'sound') {
    if (!navigator.mediaDevices?.getUserMedia) {
      queueMicrotask(() => onProblem("This browser can't listen to the microphone."));
    } else {
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        .then(s => {
          if (stopped) { s.getTracks().forEach(t => t.stop()); return; }
          stream = s;
          ctx = new AudioContext();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          ctx.createMediaStreamSource(s).connect(analyser);   // not connected to the speakers: nothing is played or kept
          buf = new Float32Array(analyser.fftSize);
          ctx.resume?.();
        })
        .catch(err => onProblem(err?.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it for this site to use sound movement.'
          : "Couldn't listen to the microphone."));
    }
  }

  const peak = () => {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v));
    return p;
  };

  const step = () => {
    raf = 0;
    if (stopped) return;
    const t = now();
    const dt = Math.min(t - last, 100) / 1000;
    last = t;
    const active = mode === 'steady' ? true
      : mode === 'typing' ? typing.isActive(t)
      : analyser ? sound.update(peak(), t) : false;
    if (active) scrub(NATURAL_PX_PER_SEC * (mode === 'steady' ? STEADY_FACTOR : 1) * dt);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      cleanup.abort();
      stream?.getTracks().forEach(t => t.stop());      // turns the browser's "microphone in use" indicator off
      ctx?.close?.();
    },
  };
}
