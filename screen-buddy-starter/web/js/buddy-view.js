// The floating buddy: a fixed-position element that stays put while the page scrolls.
//  - tap / Enter / Space: strike a pose
//  - drag: move it (and make it walk); long-press / Menu key: open the menu
//  - page scroll: makes it dance in step with the page
// Each move is one transparent sprite strip; a frame is shown by sliding the strip's background-position,
// so there is no video decoding.

import { BuddyAnimator } from './animator.js';

const SLOP = 6;                 // px of movement before a press becomes a drag
const LONG_PRESS_MS = 500;
const MARGIN = 16;

/**
 * @param {import('./store.js').Buddy} buddy
 * @param {{height:number, opacity:number, anchor:'free'|'bottom', pos:{x:number,y:number}|null, paused:boolean}} settings
 * @param {{onMoved?:(pos:{x:number,y:number})=>void, onMenu?:(rect:DOMRect)=>void}} hooks
 */
export function mountBuddy(buddy, settings, hooks = {}) {
  const m = buddy.manifest;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'sb-buddy';
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.setAttribute('aria-label', `${m.name}. Press Enter for a pose. Drag to move.`);
  el.innerHTML = '<div class="sb-fig"></div>';
  const fig = el.firstChild;
  el.hidden = true;                                 // shown once the standing frame has loaded
  document.body.append(el);

  // ---- loading: a move is only used once its strip has loaded -------------------------------------
  const loaded = new Set();
  let dead = false;
  const load = move => new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { if (!dead) loaded.add(move); resolve(true); };
    img.onerror = () => resolve(false);
    img.src = buddy.url(m.clips[move].src);
  });
  const animator = new BuddyAnimator(m, { ready: move => loaded.has(move) });
  let paused = settings.paused;

  // ---- layout ------------------------------------------------------------------------------------
  let height = settings.height;
  let pos = settings.pos;
  const width = () => Math.round((height * m.cw) / m.ch);
  const clampPos = p => {
    const maxX = Math.max(0, innerWidth - width());
    const maxY = Math.max(0, innerHeight - height);
    return { x: Math.min(Math.max(0, p.x), maxX), y: settings.anchor === 'bottom' ? maxY : Math.min(Math.max(0, p.y), maxY) };
  };
  function layout() {
    const p = clampPos(pos ?? { x: innerWidth - width() - MARGIN, y: innerHeight - height - MARGIN });
    el.style.width = `${width()}px`;
    el.style.height = `${height}px`;
    // Move with translate, lean with rotate (--lean) about the feet.
    el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(var(--lean, 0deg))`;
    return p;
  }
  const off = new AbortController();               // removes the window listeners when the buddy is replaced
  el.style.opacity = String(settings.opacity / 100);
  layout();
  addEventListener('resize', layout, { signal: off.signal });

  // ---- drawing -----------------------------------------------------------------------------------
  let cur = null, frame = -1, leanShown = 0, raf = 0;
  function render() {
    const { move, frame: i } = animator.frame();
    const clip = m.clips[move];
    if (cur !== move) {
      fig.style.backgroundImage = `url("${buddy.url(clip.src)}")`;
      fig.style.backgroundSize = `${clip.n * 100}% 100%`;
      cur = move; frame = -1;
    }
    if (i !== frame) { fig.style.backgroundPosition = `${clip.n > 1 ? (i / (clip.n - 1)) * 100 : 0}% 0`; frame = i; }
    if (animator.lean !== leanShown) { leanShown = animator.lean; el.style.setProperty('--lean', `${leanShown}deg`); }
  }
  const tick = () => {
    raf = 0;
    if (dead) return;
    animator.update(performance.now());
    render();
    if (animator.animating) kick();
  };
  const kick = () => { if (!raf && !dead) raf = requestAnimationFrame(tick); };

  load(m.stand[0]).then(ok => {
    if (dead) return;
    if (!ok) { el.remove(); hooks.onError?.(); return; }
    render();
    el.hidden = false;
  });
  if (!reduced) [m.scroll, ...m.poses].forEach(load);

  // ---- actions -----------------------------------------------------------------------------------
  const pose = () => { if (!paused && !reduced && animator.tap(performance.now())) kick(); };

  let lastY = scrollY;
  addEventListener('scroll', () => {
    const dy = scrollY - lastY;
    lastY = scrollY;
    if (paused || reduced || dead) return;
    animator.scrub(dy, performance.now());
    kick();
  }, { passive: true, signal: off.signal });

  // ---- pointer: tap, drag, long-press -----------------------------------------------------------------
  let press = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone: still handle the press */ }
    const p = layout();
    press = { x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, ox: p.x, oy: p.y, moved: false, long: false };
    press.timer = setTimeout(() => {
      if (press && !press.moved) { press.long = true; hooks.onMenu?.(el.getBoundingClientRect()); }
    }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', e => {
    if (!press) return;
    if (!press.moved && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > SLOP) {
      press.moved = true;
      clearTimeout(press.timer);
      el.classList.add('dragging');
    }
    if (!press.moved) return;
    const dx = e.clientX - press.lx, dy = e.clientY - press.ly;
    press.lx = e.clientX; press.ly = e.clientY;
    pos = clampPos({ x: press.ox + (e.clientX - press.x0), y: press.oy + (e.clientY - press.y0) });
    layout();
    if (!paused && !reduced) {
      const d = Math.hypot(dx, dy);
      animator.scrub(dx !== 0 ? Math.sign(dx) * d : Math.sign(dy) * d, performance.now());
      kick();
    }
  });
  const release = e => {
    if (!press) return;
    clearTimeout(press.timer);
    const { moved, long } = press;
    press = null;
    el.classList.remove('dragging');
    if (moved) hooks.onMoved?.(pos);
    else if (!long && e.type === 'pointerup') pose();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('contextmenu', e => { e.preventDefault(); hooks.onMenu?.(el.getBoundingClientRect()); });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pose(); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); hooks.onMenu?.(el.getBoundingClientRect()); }
  });

  return {
    el,
    pose,
    get paused() { return paused; },
    setPaused(v) { paused = v; if (v) { animator.stop(); render(); } },
    setHeight(px) { height = px; layout(); },
    setOpacity(percent) { el.style.opacity = String(percent / 100); },
    setAnchor(anchor) { settings.anchor = anchor; layout(); },
    focus() { el.focus(); },
    destroy() { dead = true; off.abort(); cancelAnimationFrame(raf); clearTimeout(press?.timer); el.remove(); },
  };
}
