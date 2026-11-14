// Landing page: shows the bundled buddies playing their real sprite strips. No floating buddy here; the
// player page (player.html) is where a buddy follows you around.
import { loadCollection, creatorLine, whenHiddenKnown } from './collection.js';
import { pickFeatured } from './library.js';
import { onUser, askSignIn } from './cloud.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOOPS = 2;   // plays each move this many times before the next one

/** Builds a sprite box for a buddy and returns { el, tick(now) } so one shared loop can drive them all. */
function sprite(m, url) {
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
    fig.style.backgroundImage = `url("${url(m.clips[move].src)}")`;
    fig.style.backgroundSize = `${n * 100}% 100%`;
    fig.style.backgroundPosition = n > 1 ? `${(frame / (n - 1)) * 100}% 0` : '0 0';
  };
  const preload = move => new Promise(res => {
    const img = new Image();
    img.onload = () => { loaded.add(move); res(); };
    img.onerror = () => res();
    img.src = url(m.clips[move].src);
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
  const { items, featured } = await loadCollection();
  const buddies = items.map(item => ({ m: item.manifest, url: item.url, item }));
  if (!buddies.length) {
    host.innerHTML = '<p class="hint">No buddies found. Try it <a href="player.html">online</a>.</p>';
    return;
  }

  const players = [];
  host.textContent = '';
  for (const { m, url, item } of buddies) {
    const card = document.createElement('article');
    card.className = 'l-card';
    const fig = document.createElement('div');
    fig.className = 'l-fig';
    const sp = sprite(m, url);
    fig.append(sp.el);
    const name = document.createElement('h3'); name.textContent = item.name;
    const by = creatorLine(item);
    const mv = document.createElement('p'); mv.className = 'move'; mv.setAttribute('aria-hidden', 'true');
    sp.onMove = move => { mv.textContent = move; };
    card.append(fig, name, by, mv);
    host.append(card);
    players.push({ sp, card, visible: true, id: item.id });
  }

  // the big one in the hero: the admin's featured buddy (config/site), else the first one
  let top = buddies.find(b => b.item === pickFeatured(items, featured)) ?? buddies[0];
  let hero = sprite(top.m, top.url);
  heroHost.style.aspectRatio = `${top.m.cw} / ${top.m.ch}`;
  heroHost.append(hero.el);

  // If the admin's settings arrive late (slow phone connection), take hidden buddies off the page then.
  whenHiddenKnown(hidden => {
    for (const p of players.filter(x => hidden.has(x.id))) { p.card.remove(); players.splice(players.indexOf(p), 1); }
    if (!hidden.has(top.item.id)) return;
    const next = buddies.find(b => !hidden.has(b.item.id) && b.item.id === featured) ?? buddies.find(b => !hidden.has(b.item.id));
    if (!next) { heroHost.textContent = ''; return; }
    top = next;
    hero = sprite(top.m, top.url);
    heroHost.textContent = '';
    heroHost.style.aspectRatio = `${top.m.cw} / ${top.m.ch}`;
    heroHost.append(hero.el);
  });

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

/** Points the Windows button straight at the newest Setup wizard. If GitHub can't be
 *  reached the link still opens the releases page. */
async function windowsDownload() {
  const a = document.getElementById('win-download');
  const hint = document.getElementById('win-hint');
  const SETUP = /^ScreenBuddy-Setup-\d+\.\d+\.\d+\.exe$/;
  try {
    const r = await fetch('https://api.github.com/repos/illmedicine/SCREENBUDDY/releases?per_page=30',
      { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = (await r.json()).find(x => !x.draft && !x.prerelease && /^windows-v\d+\.\d+\.\d+$/.test(x.tag_name)
      && x.assets.some(f => SETUP.test(f.name)));
    if (!rel) return;
    const setup = rel.assets.find(f => SETUP.test(f.name));
    const file = setup;
    if (!file.browser_download_url.startsWith('https://github.com/illmedicine/SCREENBUDDY/releases/download/')) return;
    a.href = file.browser_download_url;
    a.setAttribute('download', file.name);
    a.textContent = `Download for Windows (v${rel.tag_name.slice('windows-v'.length)})`;
    hint.textContent = 'Open the downloaded file and click Next. If Windows says "protected your PC", choose More info, then Run anyway.';
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

/** "Sign in with Google" buttons: open sign-in, then the dashboard. Signed in, they go straight to the dashboard. */
function signInButtons() {
  let signed = false;
  const buttons = [...document.querySelectorAll('[data-signin], [data-signin-link]')];
  for (const b of buttons) {
    b.dataset.label = b.textContent;
    b.addEventListener('click', e => {
      if (signed) return;
      e.preventDefault();
      askSignIn('dashboard.html');
    });
  }
  onUser(u => {
    signed = Boolean(u);
    for (const b of buttons) b.textContent = !signed ? b.dataset.label : b.hasAttribute('data-signin') ? 'Open my dashboard' : 'open your dashboard';
  });
}

signInButtons();
windowsDownload();
macDownload();
main();
