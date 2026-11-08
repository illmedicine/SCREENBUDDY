// Landing page: shows the bundled buddies playing their real sprite strips. No floating buddy here; the
// player page (player.html) is where a buddy follows you around.
import { parseManifest, MANIFEST_FILE } from './manifest.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOOPS = 2;   // plays each move this many times before the next one

/** Builds a sprite box for a buddy and returns { el, tick(now) } so one shared loop can drive them all. */
function sprite(m, dir) {
  const box = document.createElement('div');
  box.className = 'l-sprite-box';
  box.style.height = '100%';
  box.style.aspectRatio = `${m.cw} / ${m.ch}`;
  const fig = document.createElement('div');
  fig.className = 'l-sprite';
  box.append(fig);

  const moves = [m.scroll, ...Object.keys(m.clips).filter(k => k !== m.scroll)];
  const loaded = new Set();
  const show = (move, frame) => {
    const n = m.clips[move].n;
    fig.style.backgroundImage = `url("${dir}/${m.clips[move].src}")`;
    fig.style.backgroundSize = `${n * 100}% 100%`;
    fig.style.backgroundPosition = n > 1 ? `${(frame / (n - 1)) * 100}% 0` : '0 0';
  };
  const preload = move => new Promise(res => {
    const img = new Image();
    img.onload = () => { loaded.add(move); res(); };
    img.onerror = () => res();
    img.src = `${dir}/${m.clips[move].src}`;
  });
  preload(m.stand[0]).then(() => show(m.stand[0], m.stand[1]));
  moves.forEach(preload);

  let idx = 0, start = null, label = null;
  const state = {
    el: box,
    onMove: null,
    tick(now) {
      if (reduced) return;
      const move = moves[idx];
      if (!loaded.has(move)) return;
      if (start === null) { start = now; if (state.onMove) state.onMove(move); }
      const n = m.clips[move].n;
      const per = 1000 / m.fps;
      const f = Math.floor((now - start) / per);
      if (f >= n * LOOPS) {
        idx = (idx + 1) % moves.length;
        start = null;
        return;
      }
      show(move, f % n);
    },
  };
  return state;
}

async function main() {
  const host = document.getElementById('samples');
  const heroHost = document.getElementById('hero-buddy');
  let ids;
  try {
    ids = (await (await fetch('buddies/index.json')).json()).buddies;
  } catch {
    host.innerHTML = '<p class="hint">Could not load the buddies. Try it <a href="player.html">online</a>.</p>';
    return;
  }
  const buddies = [];
  for (const id of ids) {
    try {
      const m = parseManifest(await (await fetch(`buddies/${id}/${MANIFEST_FILE}`)).json());
      buddies.push({ m, dir: `buddies/${id}` });
    } catch { /* a bad package is skipped, not fatal */ }
  }
  if (!buddies.length) {
    host.innerHTML = '<p class="hint">No buddies found. Try it <a href="player.html">online</a>.</p>';
    return;
  }

  const players = [];
  host.textContent = '';
  for (const { m, dir } of buddies) {
    const card = document.createElement('article');
    card.className = 'l-card';
    const fig = document.createElement('div');
    fig.className = 'l-fig';
    const sp = sprite(m, dir);
    fig.append(sp.el);
    const name = document.createElement('h3'); name.textContent = m.name;
    const by = document.createElement('p'); by.className = 'by'; by.textContent = m.author ? `by ${m.author}` : '';
    const mv = document.createElement('p'); mv.className = 'move'; mv.setAttribute('aria-hidden', 'true');
    sp.onMove = move => { mv.textContent = move; };
    card.append(fig, name, by, mv);
    host.append(card);
    players.push({ sp, card, visible: true });
  }

  // the big one in the hero: the first buddy
  const hero = sprite(buddies[0].m, buddies[0].dir);
  heroHost.style.aspectRatio = `${buddies[0].m.cw} / ${buddies[0].m.ch}`;
  heroHost.append(hero.el);

  if (reduced) return;
  const io = new IntersectionObserver(es => {
    for (const e of es) { const p = players.find(x => x.card === e.target); if (p) p.visible = e.isIntersecting; }
  });
  players.forEach(p => io.observe(p.card));
  const loop = now => {
    hero.tick(now);
    for (const p of players) if (p.visible) p.sp.tick(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** Points the Windows button straight at the newest Setup wizard (or the zip for older releases). If GitHub can't be
 *  reached the link still opens the releases page. */
async function windowsDownload() {
  const a = document.getElementById('win-download');
  const hint = document.getElementById('win-hint');
  const SETUP = /^ScreenBuddy-Setup-\d+\.\d+\.\d+\.exe$/;
  const ZIP = /^ScreenBuddy-win-x64-\d+\.\d+\.\d+\.zip$/;
  try {
    const r = await fetch('https://api.github.com/repos/illmedicine/SCREENBUDDY/releases?per_page=30',
      { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = (await r.json()).find(x => !x.draft && !x.prerelease && /^windows-v\d+\.\d+\.\d+$/.test(x.tag_name)
      && x.assets.some(f => SETUP.test(f.name) || ZIP.test(f.name)));
    if (!rel) return;
    const setup = rel.assets.find(f => SETUP.test(f.name));
    const file = setup || rel.assets.find(f => ZIP.test(f.name));
    if (!file.browser_download_url.startsWith('https://github.com/illmedicine/SCREENBUDDY/releases/download/')) return;
    a.href = file.browser_download_url;
    a.setAttribute('download', file.name);
    a.textContent = `Download for Windows (v${rel.tag_name.slice('windows-v'.length)})`;
    hint.textContent = setup
      ? 'Open the downloaded file and click Next. If Windows says "protected your PC", choose More info, then Run anyway.'
      : 'Unzip it and run ScreenBuddy.exe.';
  } catch { /* keep the fallback link */ }
}

/** Once a Mac release exists, turns the Mac "Coming soon" into a link to its installer. */
async function macDownload() {
  const el = document.getElementById('mac-download');
  const hint = document.getElementById('mac-hint');
  const PKG = /^ScreenBuddy-Mac-Installer-\d+\.\d+\.\d+\.pkg$/;
  const ver = t => t.slice('macos-v'.length).split('.').map(Number);
  const newer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  try {
    const r = await fetch('https://api.github.com/repos/illmedicine/SCREENBUDDY/releases?per_page=30',
      { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = (await r.json())
      .filter(x => !x.draft && !x.prerelease && /^macos-v\d+\.\d+\.\d+$/.test(x.tag_name) && x.assets.some(f => PKG.test(f.name)))
      .sort((a, b) => newer(ver(b.tag_name), ver(a.tag_name)))[0];
    if (!rel) return;
    const file = rel.assets.find(f => PKG.test(f.name));
    if (!file.browser_download_url.startsWith('https://github.com/illmedicine/SCREENBUDDY/releases/download/')) return;
    const a = document.createElement('a');
    a.id = el.id;
    a.className = 'btn primary';
    a.href = file.browser_download_url;
    a.setAttribute('download', file.name);
    a.textContent = `Download for Mac (v${rel.tag_name.slice('macos-v'.length)})`;
    el.replaceWith(a);
    hint.textContent = 'Open the downloaded file and click Continue. If macOS blocks it, open System Settings > ' +
      'Privacy & Security and click Open Anyway.';
  } catch { /* keep "Coming soon" */ }
}

windowsDownload();
macDownload();
main();
