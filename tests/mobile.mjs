// Headless phone QA: walks the game on emulated touch phones and checks that the HUD and the dialogs fit the screen.
// For every viewport and every scene it reports HUD elements that leave the viewport or get clipped by a parent, text
// that is cut off, touch targets that are too small and HUD blocks that overlap each other. Exits with 1 on any problem.
// usage: node tests/mobile.mjs [--base http://localhost:5173/] [--out dir] [--vp 390x844,844x390] [--scene title,dock] [--shots] [--desktop]
// (--desktop keeps the mouse and skips the touch-only checks: a regression run for big screens, e.g. --desktop --vp 1600x900,1280x720)
// (--shots saves a screenshot of every scene; scenes with problems are always saved). Needs the dev server on :5173.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
const base = opt('base', 'http://localhost:5173/');
const outDir = opt('out', 'mobile-shots');
const VIEWPORTS = opt('vp', '390x844,844x390,360x640,667x375,320x568,768x1024,1024x768').split(',').map(s => s.split('x').map(Number));
const ONLY = opt('scene', '') ? opt('scene', '').split(',') : null;
const SHOTS = args.includes('--shots');
const DESKTOP = args.includes('--desktop');
const MIN_TARGET = 32; // CSS px. WCAG 2.2 asks for 24, Apple 44 and Material 48; an icon toolbar of nine buttons on a 320px-wide or 375px-tall screen cannot do better than ~33
mkdirSync(outDir, { recursive: true });

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('No Chromium-based browser found');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Runs inside the page. Returns a list of problems for whatever HUD / dialog is currently visible.
const AUDIT = minTarget => {
  const W = innerWidth, H = innerHeight, problems = [];
  const hudOpacity = +getComputedStyle(document.getElementById('hud')).opacity;
  const visible = el => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const name = el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (el.children.length === 0 && el.textContent.trim() ? ` "${el.textContent.trim().slice(0, 24)}"` : '');
  const box = el => { const r = el.getBoundingClientRect(); return `[${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`; };
  // the first ancestor that hides part of the element (overflow hidden / clip, or a scroller that scrolls sideways)
  const clippedBy = (el, r) => {
    for (let a = el.parentElement; a && a.id !== 'hud' && a.id !== 'overlay'; a = a.parentElement) {
      const cs = getComputedStyle(a); if (cs.display === 'contents') continue;
      const ar = a.getBoundingClientRect(), hid = v => v === 'hidden' || v === 'clip', scr = v => v === 'auto' || v === 'scroll';
      if ((hid(cs.overflowX) || scr(cs.overflowX)) && (r.left < ar.left - 1.5 || r.right > ar.right + 1.5)) return a;
      if (hid(cs.overflowY) && (r.top < ar.top - 1.5 || r.bottom > ar.bottom + 1.5)) return a;
    }
    return null;
  };
  const scroller = el => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowY; if ((o === 'auto' || o === 'scroll') && a.scrollHeight > a.clientHeight + 1) return a; } return null; };
  for (const el of document.querySelectorAll('#hud *, #overlay *')) {
    if (!visible(el)) continue;
    if (el.closest('canvas') || el.tagName === 'CANVAS' && el.closest('.tip')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const scrolled = !!scroller(el);
    if (r.left < -1 || r.right > W + 1 || (!scrolled && (r.top < -1 || r.bottom > H + 1))) problems.push(`outside viewport: ${name(el)} ${box(el)} of ${W}x${H}`);
    else { const a = clippedBy(el, r); if (a) problems.push(`clipped by ${name(a)}: ${name(el)} ${box(el)}`); }
    if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline' && cs.overflow === 'hidden') {
      if (cs.textOverflow !== 'ellipsis') problems.push(`text cut off: ${name(el)} (${el.scrollWidth}px of ${el.clientWidth}px)`);
      else if (el.clientWidth < 44) problems.push(`text truncated to nothing: ${name(el)} (${el.clientWidth}px)`);
    }
    if (minTarget && (el.tagName === 'BUTTON' || el.classList.contains('pick')) && Math.min(r.width, r.height) < minTarget) problems.push(`touch target too small: ${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const p of document.querySelectorAll('.panel')) if (visible(p) && p.scrollWidth > p.clientWidth + 1) problems.push(`panel scrolls sideways (${p.scrollWidth}px in ${p.clientWidth}px)`);
  // blocks that must never sit on top of each other
  const blocks = ['.pcard.p0', '.pcard.p1', '.pc-center', '.hint.show', '.dock:not(.hidden)', '.toolbar', '.ticker.show', '.log.open', '.banner.show'].map(s => [s, document.querySelector('#hud ' + s)]).filter(([, e]) => e && visible(e));
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    if (blocks[i][0] === '.banner.show' || blocks[j][0] === '.banner.show') continue; // the banner is transient and meant to float over the table
    const ov = inter(blocks[i][1].getBoundingClientRect(), blocks[j][1].getBoundingClientRect());
    if (ov > 60) problems.push(`overlap: ${blocks[i][0]} × ${blocks[j][0]} (${Math.round(ov)}px²)`);
  }
  const tip = document.querySelector('#hud .tip:not(.hidden)');
  if (tip && visible(tip)) { const tr = tip.getBoundingClientRect(); if (tr.height > H * 0.8) problems.push(`tooltip covers ${Math.round(tr.height / H * 100)}% of the screen height`); }
  if (document.documentElement.scrollWidth > W + 1 || document.documentElement.scrollHeight > H + 1) problems.push(`page scrolls: ${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight} in ${W}x${H}`);
  if (document.querySelector('#hud .topbar') && hudOpacity < 0.5 && !document.querySelector('#overlay .modal')) problems.push('the HUD is hidden');
  return problems;
};

// Scenes run inside the page, in this order; each builds on the previous one.
const SCENES = {
  title: async () => { /* the menu is up on load */ },
  // the online screens that need no network: the menu with Online picked, the lobby, and its join form
  menuOnline: async () => { document.querySelector('.seg').children[2].click(); },
  lobby: async () => { document.querySelector('.menu-actions .btn.big').click(); },
  lobbyJoin: async () => { [...document.querySelectorAll('.lobby button')].find(b => /Join a duel/.test(b.textContent)).click(); },
  settings: async () => { const g = __duel.game; g.dialogs.settings(g.prefs); },
  rules: async () => { __duel.game.dialogs.rules(); },
  pause: async () => { __duel.game.dialogs.pause(); },
  // "draft" is driven from the node side (a real tap on Begin the Duel), see below
  banner: async () => { __duel.hud.banner('AGE II', 'The Age of Merchants', 60000); },
  tipWonder: async () => {
    const g = __duel.game, id = g.state.draft.pool[0];
    __duel.hud.showTip(g.buildTip({ type: 'wonder', id }), { x: innerWidth * 0.4, y: innerHeight * 0.5 });
  },
  turn: async () => {
    const g = __duel.game; __duel.hud.hideTip(); __duel.hud.els.banner.classList.remove('show');
    while (g.state.pending.type === 'draft') {
      if (g.state.pending.player === 0 && g.mode) g.resolveAction({ type: 'draft', wonder: g.state.draft.pool[0] });
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => { const t = setInterval(() => { if (g.state?.pending?.type === 'turn' && g.state.pending.player === 0 && g.mode?.type === 'turn') { clearInterval(t); r(); } }, 200); });
    await new Promise(r => setTimeout(r, 2500));
  },
  dock: async () => {
    const g = __duel.game, st = g.state;
    g.selectSlot(st.structure.findIndex((s, k) => !s.taken && __engine.isAccessible(st, k)));
  },
  dockWonders: async () => { document.querySelector('.dock')?.classList.add('wopen'); },
  tipCard: async () => {
    const g = __duel.game, st = g.state;
    const s = st.structure.find((s, k) => !s.taken && __engine.isAccessible(st, k));
    __duel.hud.showTip(g.buildTip({ type: 'card', id: s.card }), { x: innerWidth * 0.5, y: innerHeight * 0.5 });
  },
  tipToken: async () => { __duel.hud.showTip(__duel.game.buildTip({ type: 'token', id: 'mathematics' }), { x: innerWidth * 0.5, y: innerHeight * 0.4 }); },
  log: async () => {
    const h = __duel.hud; h.hideTip(); h.els.banner.classList.remove('show');
    for (let i = 0; i < 14; i++) h.log(`<span class="n${i % 2}">Alexandros</span> builds <b>Hanging Gardens ${i}</b> for ${i} coins`);
    if (!h.els.log.classList.contains('open')) h.toggleLog(); h.toast('Graphics set to low for smoother play (change it in Settings)');
  },
  gestures: async () => { /* node side, see below */ },
  rich: async () => { // a busy cartouche: every science symbol, resources, choices, trade and tokens
    const st = __duel.game.state, p = st.players[0], { CARD, TOKEN } = __data;
    const pick = f => Object.values(CARD).filter(f).map(c => c.id);
    p.cards = [...new Set([...pick(c => c.fx.science), ...pick(c => c.fx.produce), ...pick(c => c.fx.choice), ...pick(c => c.fx.trade)])];
    p.tokens = Object.keys(TOKEN).slice(0, 5);
    p.coins = 128;
    st.players[1].cards = pick(c => c.fx.produce).slice(0, 6);
    if (__duel.hud.els.log.classList.contains('open')) __duel.hud.toggleLog();
    __duel.hud.update(st);
  },
  drawer: async () => { document.querySelector('#hud .pcard.p0').click(); },
  drawer1: async () => { document.querySelector('#hud .pcard.p1').click(); },
  gameOver: async () => {
    const g = __duel.game; g.dialogs.clear(); if (__duel.hud.els.log.classList.contains('open')) __duel.hud.toggleLog();
    const s = __engine.createGame({ seed: 4, names: ['Alexandros', 'Cleopatra'] });
    while (!s.winner) __engine.apply(s, __ai(s));
    g.dialogs.gameOver(s, { names: ['Alexandros', 'Cleopatra'], viewer: 0, mode: 'ai' });
  },
};
const ORDER = ['title', 'menuOnline', 'lobby', 'lobbyJoin', 'settings', 'rules', 'pause', 'draft', 'banner', 'tipWonder', 'turn', 'dock', 'dockWonders', 'tipCard', 'log', 'rich', 'drawer', 'drawer1', 'gestures', 'gameOver'];
const RESET = ['settings', 'rules', 'pause']; // dialogs stacked on top of the title: close them before the next scene

const gestureProblems = [];
// Touches on the canvas, sent as PointerEvents in one task each. Puppeteer's own touchscreen cannot do a quick tap here:
// with software WebGL every CDP round trip waits for a ~1s frame, so its taps last seconds and are (rightly) read as holds.
// A tap must select without leaving a tooltip behind, a press-and-hold must inspect and let go, a pinch must zoom, and
// the tooltip has to stay inside the screen the whole time.
async function gestures(page, out) {
  const W = page.viewport().width, H = page.viewport().height;
  const cardXY = () => page.evaluate(() => {
    const { game, view, stage } = __duel, st = game.state;
    const i = st.structure.findIndex((s, k) => !s.taken && __engine.isAccessible(st, k));
    const o = view.cards.get(st.structure[i].card), v = o.root.getWorldPosition(new o.root.position.constructor()).project(stage.camera);
    return { x: Math.round((v.x + 1) / 2 * innerWidth), y: Math.round((1 - v.y) / 2 * innerHeight) };
  });
  const touch = (steps) => page.evaluate(steps => {
    const c = document.getElementById('stage');
    for (const [type, id, x, y] of steps) c.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: id, isPrimary: id === 1, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
  }, steps);
  const state = () => page.evaluate(() => {
    const tip = document.querySelector('#hud .tip'), r = tip.getBoundingClientRect();
    return { tip: !tip.classList.contains('hidden'), box: [r.left, r.top, r.right, r.bottom], dock: !document.querySelector('#hud .dock').classList.contains('hidden'), zoom: __duel.stage.user.zoom };
  });
  const until = async (pred, ms) => { const t0 = Date.now(); for (;;) { const s = await state(); if (pred(s) || Date.now() - t0 > ms) return s; await sleep(250); } };
  await page.evaluate(() => { __duel.game.deselect(); __duel.hud.hideTip(); if (__duel.hud.els.log.classList.contains('open')) __duel.hud.toggleLog(); });
  await sleep(800);
  const { x, y } = await cardXY();
  // 1. tap
  await touch([['pointerdown', 1, x, y], ['pointerup', 1, x, y]]);
  let s = await until(v => v.dock, 6000);
  if (!s.dock) out.push('tap: the card was not selected (no dock)');
  await sleep(1500);
  if ((await state()).tip) out.push('tap: a tooltip is left on screen after a plain tap');
  await page.evaluate(() => __duel.game.deselect());
  await sleep(600);
  // 2. press and hold
  await touch([['pointerdown', 1, x, y]]);
  s = await until(v => v.tip, 25000);
  if (!s.tip) out.push('hold: no tooltip after pressing and holding a card');
  else if (s.box[0] < -1 || s.box[2] > W + 1 || s.box[1] < -1 || s.box[3] > H + 1) out.push(`hold: tooltip outside the screen [${s.box.map(Math.round)}]`);
  await touch([['pointerup', 1, x, y]]);
  s = await until(v => !v.tip, 6000);
  if (s.tip) out.push('hold: the tooltip stays after the finger is lifted');
  if ((await state()).dock) out.push('hold: a press-and-hold selected the card');
  // 3. pinch
  const z0 = (await state()).zoom;
  await touch([['pointerdown', 1, W * 0.4, H * 0.5], ['pointerdown', 2, W * 0.6, H * 0.5]]);
  for (let k = 1; k <= 5; k++) await touch([['pointermove', 1, W * (0.4 - k * 0.06), H * 0.5], ['pointermove', 2, W * (0.6 + k * 0.06), H * 0.5]]);
  await touch([['pointerup', 1, W * 0.1, H * 0.5], ['pointerup', 2, W * 0.9, H * 0.5]]);
  await sleep(300);
  const z1 = (await state()).zoom;
  if (!(z1 < z0 * 0.85)) out.push(`pinch: spreading two fingers did not zoom in (zoom ${z0.toFixed(2)} → ${z1.toFixed(2)})`);
  if ((await state()).dock) out.push('pinch: a pinch selected a card');
  // 4. a drag orbits and selects nothing
  await touch([['pointerdown', 1, W * 0.5, H * 0.45], ['pointermove', 1, W * 0.6, H * 0.45], ['pointermove', 1, W * 0.7, H * 0.45], ['pointerup', 1, W * 0.7, H * 0.45]]);
  await sleep(300);
  if ((await state()).dock) out.push('drag: an orbit drag selected a card');
  await page.evaluate(() => { __duel.stage.user.zoom = 1; __duel.stage.user.yaw = 0; __duel.stage.user.pitch = 0; });
}

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
let failures = 0;
try {
  for (const [w, h] of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: DESKTOP ? 1 : 2, isMobile: !DESKTOP, hasTouch: !DESKTOP });
    if (!DESKTOP) await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36');
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low', speed: 6, mode: 'ai', name: 'Alexandros', rival: 'Cleopatra' })); } catch { /* */ } });
    await page.goto(base + '?quality=low', { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__duel?.game, { timeout: 60000 });
    await sleep(3500);
    console.log(`\n=== ${w}x${h} ===`);
    for (const scene of ORDER) {
      if (DESKTOP && scene === 'gestures') continue;
      if (ONLY && !ONLY.includes(scene) && !(scene === 'draft' && ONLY.some(s => !['title', 'menuOnline', 'lobby', 'lobbyJoin', 'settings', 'rules', 'pause', 'gameOver'].includes(s)))) continue;
      try {
        if (scene === 'draft') {
          const go = await page.$('.btn.big'); await go.tap();
          await page.waitForFunction(() => { const g = __duel.game; return g.state?.pending?.type === 'draft' && g.state.pending.player === 0 && g.mode; }, { timeout: 90000 });
          await sleep(4500); // the DRAFT banner has to go away first
        } else if (scene === 'gestures') {
          await page.evaluate(() => { document.querySelectorAll('#hud .pcard').forEach(p => p.classList.remove('open')); });
          gestureProblems.length = 0;
          await gestures(page, gestureProblems);
        } else await page.evaluate(`(${SCENES[scene].toString()})()`);
        await sleep(scene === 'turn' ? 1500 : 1200);
      } catch (e) { console.log(`  ${scene}: SCENE ERROR ${e.message.split('\n')[0]}`); failures++; continue; }
      if (ONLY && !ONLY.includes(scene)) continue;
      await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch { /* endless animations cannot finish */ } } }); // entry animations shift boxes while they run
      const problems = scene === 'gestures' ? [...gestureProblems] : await page.evaluate(`(${AUDIT.toString()})(${DESKTOP ? 0 : MIN_TARGET})`);
      if (SHOTS || problems.length) await page.screenshot({ path: `${outDir}/${w}x${h}-${scene}.png` });
      console.log(`  ${scene.padEnd(12)} ${problems.length ? problems.length + ' problem(s)' : 'ok'}`);
      for (const p of [...new Set(problems)].slice(0, 12)) console.log('      - ' + p);
      failures += problems.length;
      if (RESET.includes(scene)) await page.evaluate(() => document.getElementById('overlay').lastElementChild?.remove());
      if (scene === 'lobbyJoin') { // leave the lobby the way a player does (Esc): the title menu comes back, set to "Computer" again for the match scenes
        await page.keyboard.press('Escape'); await sleep(1800);
        await page.evaluate(() => document.querySelector('.seg').children[0].click());
      }
    }
    if (errs.length) { console.log('  page errors:', errs.slice(0, 4)); failures += errs.length; }
    await page.close();
  }
} finally { await browser.close(); }
console.log(failures ? `\n${failures} problem(s)` : '\nall clear');
process.exit(failures ? 1 : 0);
