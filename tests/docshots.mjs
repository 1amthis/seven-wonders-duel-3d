// Regenerates the README screenshots (docs/screenshots/*) and the link-preview image (public/og-image.jpg) by playing a
// real match against the built game in headless Edge/Chrome (software WebGL, so it takes several minutes).
// Usage: npm run build && node tests/docshots.mjs [seed] [--only=a,b,c]
// Shots: menu draft turn tooltip results wonders_right wonders_left military og
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const seed = process.argv.slice(2).find(a => !a.startsWith('--')) || '21';
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = n => !only.length || only.includes(n);
const W = 1600, H = 900, SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true }); mkdirSync('public', { recursive: true });

// ---- serve dist/ on localhost (so the debug hooks the driver needs are available)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = join('dist', p);
  if (p.includes('..') || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, 'localhost', r));
const base = `http://localhost:${server.address().port}/`;

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('No Chromium-based browser found');
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  protocolTimeout: 900000, // a single High-quality frame can take many seconds in software rendering
});
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/GPU stall|swiftshader/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.evaluateOnNewDocument(s => {
    try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ mode: 'ai', level: 'normal', first: 'me', seed: s, quality: 'low', speed: 14, muted: true })); } catch { /* */ }
  }, seed);
  await page.goto(base + '?debug', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__duel && window.__ai, { timeout: 60000 });
  await page.evaluate(() => { window.__fr = 0; __duel.stage.frameCbs.push(() => { window.__fr++; }); });

  // ---- helpers
  // Software rendering runs at well under 1 fps on High and the render loop clamps dt, so we wait for rendered frames, not seconds.
  const frames = async (n, max = 600000) => {
    const s = await page.evaluate(() => window.__fr), t = Date.now();
    while (Date.now() - t < max) { await sleep(400); if ((await page.evaluate(() => window.__fr)) - s >= n) return; }
    log('  (frame wait timed out)');
  };
  // Rendering cost scales with pixels: play the match in a tiny viewport on Low, and only go full-size on High for a capture.
  const quality = async q => {
    await page.setViewport({ width: q === 'high' ? W : 480, height: q === 'high' ? H : 270, deviceScaleFactor: 1 });
    await page.evaluate(q => {
      const g = __duel.game; g.prefs.quality = q; __duel.stage.setQuality(q);
      g.running = q === 'low' && !!g.state; // the adaptive-quality governor only runs while "running"; keep it off for High captures
    }, q);
  };
  const save = async (name, { dir = SHOTS, type = 'jpeg', ext = 'jpg', q = 86 } = {}) => {
    await page.screenshot({ path: `${dir}/${name}.${ext}`, type, ...(type === 'png' ? {} : { quality: q }) });
    log('saved', `${dir}/${name}.${ext}`);
  };
  const project = expr => page.evaluate(expr);
  const outOfWay = () => page.mouse.move(2, H - 2);

  // ---- 1. title screen
  await page.waitForFunction(() => [...document.querySelectorAll('.btn')].some(b => /Begin/.test(b.textContent)), { timeout: 60000 });
  if (want('menu')) {
    // show the seed field as a player sees it (empty); the prefs object keeps the real seed for the match
    await page.evaluate(() => { const i = [...document.querySelectorAll('.modal input')].find(x => x.placeholder === 'random'); i.dataset.v = i.value; i.value = ''; });
    await quality('high'); await frames(3); await save('menu'); await quality('low');
    await page.evaluate(() => { const i = [...document.querySelectorAll('.modal input')].find(x => x.placeholder === 'random'); i.value = i.dataset.v; });
  }

  // ---- 2. start a match; a driver plays the human side with the engine AI until we ask it to stop for a capture
  await page.evaluate(() => {
    const g = __duel.game;
    window.DRV = { on: true, hold: null };
    setInterval(() => {
      if (!DRV.on || !g.state || g.state.winner || !g.mode || g.mode.pend.player !== 0) return;
      const ov = document.getElementById('overlay'), t = g.mode.type;
      if (t === 'starter') { ov.querySelector('.btn')?.click(); return; }
      if (t === 'revive') { ov.querySelector('.pick')?.click(); return; }
      if (DRV.hold && DRV.hold(g.state)) { DRV.on = false; return; }
      if (g.dialogOpen()) return;
      g.resolveAction(__ai(g.state, { level: 'normal' }));
    }, 250);
    [...document.querySelectorAll('.btn')].find(b => /Begin/.test(b.textContent)).click();
  });
  log('match started, seed', seed);

  const probe = () => page.evaluate(() => { const g = __duel.game, st = g.state; return { on: DRV.on, age: st.age, turn: st.turnNo, pend: st.pending && st.pending.type, who: st.pending && st.pending.player, mode: g.mode && g.mode.type, dlg: g.dialogOpen(), fr: window.__fr, win: !!st.winner }; });
  const holdAt = async (fnSrc, label, max = 1500000) => {
    await page.evaluate(src => { DRV.hold = new Function('st', 'return (' + src + ')(st)'); DRV.on = true; }, fnSrc);
    const t = Date.now(); let last = 0;
    while (Date.now() - t < max) {
      await sleep(2000);
      const s = await probe();
      if (!s.on) { log('holding at', label); return; }
      if (Date.now() - last > 20000) { last = Date.now(); log('  waiting for', label, JSON.stringify(s)); }
    }
    throw new Error('timed out waiting for ' + label);
  };
  const release = async () => { await outOfWay(); await page.evaluate(() => { __duel.game.hud.hideTip(); DRV.hold = null; DRV.on = true; }); await quality('low'); };

  // ---- 3. the wonder draft (first human pick)
  await holdAt('st => st.pending.type === "draft" && st.draft.picks === 0', 'draft');
  if (want('draft')) {
    await page.evaluate(() => __duel.stage.goto('draft', { snap: true }));
    await quality('high'); await frames(8); await save('draft');
  }
  await release();

  // ---- 4. human turns: a card selected with the action dock, then a hover tooltip
  const turns = [{ at: 28, tag: 'turn' }];
  for (const { at, tag } of want('turn') || want('tooltip') ? turns : []) {
    await holdAt(`st => st.pending.type === "turn" && st.turnNo >= ${at}`, `turn ${at}`);
    await page.evaluate(() => {
      const g = __duel.game, st = g.state, a = __ai(st, { level: 'normal' });
      g.stage.goto('overview', { snap: true });
      g.onPick({ type: 'card', id: st.structure[a.slot].card });
      window.__sel = a.slot;
    });
    await quality('high'); await frames(10);
    if (want('turn')) await save(tag);
    if (want('tooltip')) {
      const pos = await project(`(() => { const g = __duel.game, st = g.state, v = __duel.view;
        const acc = st.structure.map((s, i) => i).filter(i => i !== window.__sel && !st.structure[i].taken && st.structure[i].up && st.structure[i].coveredBy.every(j => st.structure[j].taken));
        if (!acc.length) return null; const o = v.cards.get(st.structure[acc[Math.floor(acc.length / 2)]].card);
        const c = o.root.position.clone().project(__duel.stage.camera); return { x: (c.x * 0.5 + 0.5) * innerWidth, y: (-c.y * 0.5 + 0.5) * innerHeight }; })()`);
      if (pos) { await page.mouse.move(pos.x - 4, pos.y); await page.mouse.move(pos.x, pos.y); await frames(8); await save('tooltip'); }
      else log('no accessible card to hover');
    }
    await release();
  }

  // ---- 5. play on to the end, then the scoreboard
  if (['results', 'wonders_right', 'wonders_left', 'military', 'og'].some(want)) {
    await page.waitForFunction(() => __duel.game.state.winner && __duel.game.dialogOpen() && /Play again/.test(document.getElementById('overlay').textContent), { timeout: 1500000, polling: 2000 });
    const win = await page.evaluate(() => __duel.game.state.winner);
    log('game over:', JSON.stringify(win));
    if (win.kind !== 'civil' && win.kind !== 'civilian') log('  note: early victory, so the scoreboard has no score table; try another seed for the "results" shot');
    if (want('results')) { await quality('high'); await frames(8); await save('results'); await quality('low'); }
    await page.evaluate(() => [...document.querySelectorAll('#overlay .btn')].find(b => /Admire/.test(b.textContent)).click());
    await sleep(1500);

    // ---- 6. staged shots on the finished table: seven wonders raised, the pawn advanced. Rendering only; no rules involved.
    await page.evaluate(async () => {
      const g = __duel.game, st = g.state; let n = 0;
      for (const p of st.players) for (const w of p.wonders) { w.lost = false; w.built = n < 7; if (w.built) n++; w.under = w.under || null; }
      st.military = 4;
      await g.view.syncAll(st, { instant: true });
    });
    await quality('high');
    for (const [name, view] of [['wonders_right', 'wondersRight'], ['wonders_left', 'wondersLeft'], ['military', 'military']]) {
      if (!want(name)) continue;
      await page.evaluate(v => __duel.stage.goto(v, { snap: true }), view); await frames(10); await save(name);
    }
    if (want('og')) {
      await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 1 });
      await page.evaluate(() => {
        document.getElementById('hud').style.opacity = 0;
        __duel.stage.goto('cinematic', { snap: true });
        const d = document.createElement('div');
        d.innerHTML = `<div class="title-small">A 3D TRIBUTE TO</div><div class="title-big">SEVEN WONDERS</div><div class="title-big" style="font-size:44px;letter-spacing:.7em;margin-right:-.7em">DUEL</div>`;
        d.style.cssText = 'position:absolute;left:0;right:0;top:0;padding:34px 0 90px;text-align:center;pointer-events:none;background:linear-gradient(#0b0705f0,#0b070500)';
        document.getElementById('overlay').appendChild(d);
      });
      await frames(10); await save('og-image', { dir: 'public', q: 88 });
    }
  }
  log('console errors:', errors.length ? errors.slice(0, 6) : 'none');
} finally { await browser.close(); server.close(); }
