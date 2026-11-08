// The animated brand mark: a glass phone glowing on a deep-indigo tile, with the buddies taking turns stepping out of
// its screen as holograms (a scan-line shimmer while each one materialises, sparkles around it). It drives two things:
//   - the logo in the page header: an <img data-holo-logo> is swapped for a canvas once the first buddy is ready;
//   - the tab icon: the favicon is redrawn as each buddy appears.
// Every buddy in buddies/index.json joins the rotation, so new characters show up here with no extra work.
// With "reduce motion" on, the logo shows one buddy and stays still. Static icons (favicon.ico, icons/*.png) remain as
// the fallback for browsers without canvas and for the first paint.

import { parseManifest, MANIFEST_FILE } from './manifest.js';

export const CYCLE_MS = 3400;       // one buddy's turn: rise, hold, fade
const RISE_MS = 650;
const FADE_MS = 420;
const BUST_PX = 160;                // resolution each buddy's head-and-shoulders cut-out is kept at

/**
 * Where a buddy's head and shoulders are within one sprite frame, as a square crop.
 * @param {Uint8ClampedArray|number[]} alpha one alpha value per pixel, row by row
 * @returns {{x:number,y:number,size:number}|null} null if the frame is empty
 */
export function bustRect(alpha, w, h, threshold = 40) {
  let top = h, bottom = -1, left = w, right = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] <= threshold) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) return null;
  const bodyH = bottom - top + 1;
  // Centre on the head: the average column of the opaque pixels in the top eighth of the figure.
  const headRows = Math.max(1, Math.round(bodyH / 8));
  let sum = 0, count = 0;
  for (let y = top; y < top + headRows; y++) {
    for (let x = left; x <= right; x++) if (alpha[y * w + x] > threshold) { sum += x; count++; }
  }
  const cx = count ? sum / count : (left + right) / 2;
  const size = Math.max(1, Math.min(w, h, Math.round(bodyH * 0.56)));   // head to waist
  const x = Math.round(Math.min(Math.max(cx - size / 2, 0), w - size));
  const y = Math.round(Math.min(Math.max(top - size * 0.05, 0), h - size));
  return { x, y, size };
}

/**
 * Where we are in the rotation at time t (ms).
 * @returns {{index:number, rise:number, fade:number}} rise goes 0 to 1 as the buddy appears, fade 0 to 1 as it leaves
 */
export function phase(t, count) {
  if (count <= 0) return { index: 0, rise: 1, fade: 0 };
  const turn = Math.floor(t / CYCLE_MS);
  const local = t - turn * CYCLE_MS;
  return {
    index: ((turn % count) + count) % count,
    rise: Math.min(1, local / RISE_MS),
    fade: count > 1 ? Math.max(0, (local - (CYCLE_MS - FADE_MS)) / FADE_MS) : 0,
  };
}

const easeOut = k => 1 - (1 - k) ** 3;

// ---- loading the buddies -------------------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Each buddy's standing frame, cropped to head and shoulders, as a small canvas. */
async function loadBust(id) {
  const m = parseManifest(await (await fetch(`buddies/${id}/${MANIFEST_FILE}`)).json());
  const [move, index] = m.stand;
  const strip = await loadImage(`buddies/${id}/${m.clips[move].src}`);
  const frame = document.createElement('canvas');
  frame.width = m.cw; frame.height = m.ch;
  const fx = frame.getContext('2d', { willReadFrequently: true });
  fx.drawImage(strip, index * m.cw, 0, m.cw, m.ch, 0, 0, m.cw, m.ch);
  const rgba = fx.getImageData(0, 0, m.cw, m.ch).data;
  const alpha = new Uint8ClampedArray(m.cw * m.ch);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  const r = bustRect(alpha, m.cw, m.ch);
  if (!r) return null;
  const bust = document.createElement('canvas');
  bust.width = bust.height = BUST_PX;
  const bx = bust.getContext('2d');
  bx.imageSmoothingQuality = 'high';
  bx.drawImage(frame, r.x, r.y, r.size, r.size, 0, 0, BUST_PX, BUST_PX);
  // Dissolve the bottom of the cut-out so the buddy seems to come up out of the screen, not end at a crop line.
  bx.globalCompositeOperation = 'destination-in';
  const g = bx.createLinearGradient(0, 0, 0, BUST_PX);
  g.addColorStop(0, '#000'); g.addColorStop(0.62, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
  bx.fillStyle = g;
  bx.fillRect(0, 0, BUST_PX, BUST_PX);
  return { name: m.name, bust };
}

// ---- drawing -------------------------------------------------------------------------------------

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function sparkle(c, x, y, r, a) {
  if (a <= 0.02) return;
  c.save();
  c.globalAlpha = a;
  c.fillStyle = '#e9fffb';
  c.shadowColor = 'rgba(120, 255, 230, .9)';
  c.shadowBlur = r * 3;
  c.beginPath();
  c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r);
  c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r);
  c.fill();
  c.restore();
}

const SPARKLES = [[0.2, 0.3, 0.0], [0.82, 0.24, 1.7], [0.86, 0.62, 3.1], [0.16, 0.7, 4.4], [0.7, 0.86, 2.3]];

/** Draws the whole mark at size s (pixels) for time t, with buddy `b` (or none yet). */
function drawMark(c, s, t, b, p, layer) {
  c.clearRect(0, 0, s, s);
  c.save();
  roundRect(c, 0, 0, s, s, s * 0.24);
  c.clip();

  // tile: deep indigo with a teal glow coming from the phone
  const bg = c.createLinearGradient(0, 0, 0, s);
  bg.addColorStop(0, '#2a1d78'); bg.addColorStop(1, '#0a1029');
  c.fillStyle = bg; c.fillRect(0, 0, s, s);
  const glow = c.createRadialGradient(s * 0.52, s * 0.72, 0, s * 0.52, s * 0.72, s * 0.62);
  glow.addColorStop(0, 'rgba(45, 227, 184, .55)'); glow.addColorStop(1, 'rgba(45, 227, 184, 0)');
  c.fillStyle = glow; c.fillRect(0, 0, s, s);

  // the phone, tilted, its glass edge shifting from teal to violet
  const phone = { x: -s * 0.2, y: -s * 0.29, w: s * 0.4, h: s * 0.66 };   // top edge crosses the buddy's chest
  c.save();
  c.translate(s * 0.52, s * 0.66);
  c.rotate(-0.17);
  roundRect(c, phone.x, phone.y, phone.w, phone.h, s * 0.09);
  c.fillStyle = 'rgba(140, 230, 255, .10)'; c.fill();
  const edge = c.createLinearGradient(0, phone.y, 0, phone.y + phone.h);
  const hue = (t / 40) % 360;
  edge.addColorStop(0, `hsla(${170 + 20 * Math.sin(hue / 57)}, 95%, 70%, .95)`);
  edge.addColorStop(0.5, 'rgba(160, 120, 255, .9)');
  edge.addColorStop(1, 'rgba(45, 227, 184, .9)');
  c.lineWidth = Math.max(1, s * 0.04);
  c.strokeStyle = edge; c.stroke();
  c.restore();

  // the buddy, materialising out of the screen
  if (b) {
    const k = easeOut(p.rise);
    const alpha = k * (1 - p.fade);
    const size = s * 0.7;
    const x = (s - size) / 2;
    const y = s * 0.05 + (1 - k) * s * 0.34 - p.fade * s * 0.06;
    layer.width = layer.height = Math.ceil(size);
    const lc = layer.getContext('2d');
    lc.clearRect(0, 0, layer.width, layer.height);
    lc.drawImage(b.bust, 0, 0, layer.width, layer.height);
    // hologram scan lines: strong while it appears, a faint travelling shimmer while it stays
    const scan = 0.55 * (1 - k) + 0.6 * p.fade + 0.05;
    lc.globalCompositeOperation = 'source-atop';
    const step = Math.max(2, Math.round(layer.height / 26));
    lc.fillStyle = `rgba(120, 255, 235, ${scan.toFixed(3)})`;
    for (let yy = (Math.floor(t / 60) % step); yy < layer.height; yy += step) lc.fillRect(0, yy, layer.width, Math.max(1, step / 3));
    const band = ((t % 1800) / 1800) * layer.height * 1.6 - layer.height * 0.3;
    const sheen = lc.createLinearGradient(0, band - layer.height * 0.12, 0, band + layer.height * 0.12);
    sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.5, 'rgba(200,255,250,.28)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    lc.fillStyle = sheen; lc.fillRect(0, 0, layer.width, layer.height);
    lc.globalCompositeOperation = 'source-over';

    c.save();
    c.globalAlpha = alpha;
    c.shadowColor = 'rgba(45, 227, 184, .85)';
    c.shadowBlur = s * 0.09;
    c.drawImage(layer, x, y, size, size);
    c.restore();
  }

  // glass sheen over the lower half, so the buddy reads as coming *through* the screen
  c.save();
  c.translate(s * 0.52, s * 0.66);
  c.rotate(-0.17);
  roundRect(c, phone.x, 0, phone.w, phone.h + phone.y, s * 0.09);
  const glass = c.createLinearGradient(phone.x, 0, phone.x + phone.w, phone.h);
  glass.addColorStop(0, 'rgba(180, 240, 255, .16)'); glass.addColorStop(0.45, 'rgba(180, 240, 255, .04)'); glass.addColorStop(1, 'rgba(180, 240, 255, .12)');
  c.fillStyle = glass; c.fill();
  c.restore();

  for (const [sx, sy, ph] of SPARKLES) sparkle(c, sx * s, sy * s, s * 0.045, 0.5 + 0.5 * Math.sin(t / 420 + ph));

  c.restore();
  c.lineWidth = Math.max(1, s * 0.02);
  roundRect(c, c.lineWidth / 2, c.lineWidth / 2, s - c.lineWidth, s - c.lineWidth, s * 0.24);
  c.strokeStyle = 'rgba(255, 255, 255, .10)';
  c.stroke();
}

// ---- wiring --------------------------------------------------------------------------------------

export async function startHoloLogo({ marks = document.querySelectorAll('img[data-holo-logo]'), favicon = true } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ids;
  try { ids = (await (await fetch('buddies/index.json')).json()).buddies; } catch { return; }
  if (!Array.isArray(ids) || !ids.length) return;

  const buddies = [];
  const first = await loadBust(ids[0]).catch(() => null);
  if (first) buddies.push(first);
  if (!reduced) {
    // The rest load quietly in the background and join the rotation as they arrive.
    const rest = () => ids.slice(1).forEach(id => loadBust(id).then(b => b && buddies.push(b)).catch(() => {}));
    if ('requestIdleCallback' in window) requestIdleCallback(rest, { timeout: 4000 }); else setTimeout(rest, 1500);
  }
  if (!buddies.length) return;

  const layer = document.createElement('canvas');
  const canvases = [...marks].map(img => {
    const css = img.width || 36;
    const cv = document.createElement('canvas');
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = cv.height = Math.round(css * dpr);
    cv.style.width = cv.style.height = `${css}px`;
    cv.className = `${img.className} holo-logo`.trim();
    cv.setAttribute('aria-hidden', 'true');
    img.replaceWith(cv);
    return cv;
  });

  const icon = favicon ? faviconLink() : null;
  const favCanvas = document.createElement('canvas');
  favCanvas.width = favCanvas.height = 64;
  const t0 = performance.now();
  const at = () => (reduced ? CYCLE_MS * 0.5 : performance.now() - t0);
  const state = t => { const p = phase(t, buddies.length); return { p, b: buddies[p.index] }; };

  // header logo: animate on every frame (about 30 fps) while the page is visible
  let last = 0;
  const paint = now => {
    if (!reduced) requestAnimationFrame(paint);
    if (now - last < 33 && !reduced) return;
    last = now;
    const t = at();
    const { p, b } = state(t);
    for (const cv of canvases) drawMark(cv.getContext('2d'), cv.width, t, b, p, layer);
  };
  requestAnimationFrame(paint);

  // tab icon: a handful of frames as each buddy rises, then hold (redrawing it constantly would waste battery)
  if (icon) {
    let shown = '';
    const update = () => {
      const t = at();
      const { p, b } = state(t);
      const key = `${p.index}:${Math.round(p.rise * 4)}:${p.fade > 0 ? Math.round(p.fade * 2) : 0}`;
      if (key !== shown) {
        shown = key;
        drawMark(favCanvas.getContext('2d'), 64, t, b, p, layer);
        icon.href = favCanvas.toDataURL('image/png');
      }
    };
    update();
    if (!reduced) setInterval(update, 160);
  }
}

/** One <link rel="icon"> we own (other icon links are dropped so the browser doesn't stick to a static one). */
function faviconLink() {
  document.querySelectorAll('link[rel~="icon"]').forEach(l => l.remove());
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  document.head.append(link);
  return link;
}

if (typeof document !== 'undefined' && !globalThis.__holoLogoManual) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startHoloLogo());
  else startHoloLogo();
}
