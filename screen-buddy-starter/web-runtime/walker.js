// Armani on the page: a realistic cut-out of her, made from her own videos, standing in the corner of
// the screen. She stays put while the page scrolls and only moves when you do: scrolling makes her
// dance in step with the page, and tapping her makes her strike a pose. Visitors pick which Armani
// they want (or none) from the header, like a light/dark theme switch.
import { CHARACTERS } from './walker-data.js';

const KEY = 'aw:walker';
const STEP_PX = 28;          // page scroll per dance frame
export const WALKERS = CHARACTERS;
export const DEFAULT_WALKER = Object.keys(CHARACTERS)[0];

export function savedWalker() {
  try { const v = localStorage.getItem(KEY); if (v === 'off' || CHARACTERS[v]) return v; } catch { }
  return DEFAULT_WALKER;
}
export function saveWalker(v) { try { localStorage.setItem(KEY, v); } catch { } }

let current = null;
export function setWalker(key) {
  current?.destroy(); current = null;
  if (key && key !== 'off' && CHARACTERS[key]) current = mountWalker(CHARACTERS[key]);
}

function mountWalker(C) {
  const { cw, ch, fps, clips } = C;
  const off = new AbortController(), on = { signal: off.signal, passive: true };
  const el = document.createElement('div');
  el.className = 'walker';
  el.setAttribute('role', 'button'); el.tabIndex = 0;
  el.setAttribute('aria-label', `Armani West (${C.name}). Tap for a pose`);
  el.style.aspectRatio = `${cw} / ${ch}`;
  el.innerHTML = '<span class="wk-shadow"></span><div class="wk-fig"></div>';
  document.body.appendChild(el);
  const fig = el.querySelector('.wk-fig');

  // Sprite strips load in the background; a move is only used once its strip is ready.
  const ready = {};
  const load = name => ready[name] || (ready[name] = new Promise(res => {
    const im = new Image(); im.decoding = 'async';
    im.onload = () => { ready[name].ok = true; res(true); }; im.onerror = () => res(false);
    im.src = clips[name].src;
  }));

  let cur = null, frame = -1, dead = false;
  const show = (name, i) => {
    if (dead) return;
    const n = clips[name].n;
    if (cur !== name) { fig.style.backgroundImage = `url("${clips[name].src}")`; fig.style.backgroundSize = `${n * 100}% 100%`; cur = name; frame = -1; }
    if (i !== frame) { fig.style.backgroundPosition = `${n > 1 ? (i / (n - 1)) * 100 : 0}% 0`; frame = i; }
  };
  const [standClip, standFrame] = C.stand;
  const stand = () => show(standClip, standFrame);

  load(standClip).then(ok => { if (dead) return; if (!ok) return el.remove(); stand(); requestAnimationFrame(() => el.classList.add('on')); });
  const destroy = () => { dead = true; off.abort(); el.remove(); };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { destroy };
  [C.scroll, ...C.poses].forEach(load);

  // Tap her (or press Enter / Space on her) for a pose, played forwards and back for the short ones.
  let posing = false, lastPose = '';
  const pose = () => {
    if (posing) return;
    const ok = C.poses.filter(p => ready[p]?.ok && p !== lastPose);
    if (!ok.length) return;
    const p = ok[Math.floor(Math.random() * ok.length)], n = clips[p].n;
    const total = n < 24 ? 2 * n - 1 : n, t0 = performance.now();
    posing = true; lastPose = p;
    const tick = t => {
      if (dead) return;
      const k = Math.floor((t - t0) / 1000 * fps);
      if (k >= total) { posing = false; stand(); return; }
      show(p, k < n ? k : 2 * n - 2 - k); requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  el.addEventListener('click', pose, { signal: off.signal });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pose(); } }, { signal: off.signal });

  // Scrolling: she dances in step with the page (frames follow the scroll position), leans with it,
  // and goes back to standing once the page stops.
  let lastY = scrollY, travel = 0, idle;
  addEventListener('scroll', () => {
    const dy = scrollY - lastY; lastY = scrollY;
    el.style.setProperty('--lean', Math.max(-5, Math.min(5, dy / 8)) + 'deg');
    if (!posing && ready[C.scroll]?.ok) {
      travel += Math.abs(dy);
      const n = clips[C.scroll].n, cycle = 2 * n - 2, k = Math.floor(travel / STEP_PX) % cycle;
      show(C.scroll, k < n ? k : cycle - k);
    }
    clearTimeout(idle);
    idle = setTimeout(() => { el.style.setProperty('--lean', '0deg'); if (!posing) stand(); }, 450);
  }, on);
  off.signal.addEventListener('abort', () => clearTimeout(idle));
  return { destroy };
}
