// Headless: fast-forward the engine to the start of Age III and photograph the structure (guilds included).
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
const out = process.argv[2] || 'shots'; const W = +(process.argv[3] || 1440), H = +(process.argv[4] || 810); const seed = process.argv[5] || '5';
mkdirSync(out, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage(); const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
await page.goto(`http://localhost:5173/?auto=1&speed=20&seed=${seed}&quality=low`, { waitUntil: 'load', timeout: 180000 });
await sleep(9000);
const info = await page.evaluate(async () => {
  const g = __duel.game; g.abort++; const st = g.state; const E = __engine;
  let guard = 0; while (st.age < 3 && !st.winner && guard++ < 400) { const p = st.pending; if (p.type === 'starter') E.apply(st, { type: 'starter', first: p.player }); else E.apply(st, __ai(st, { level: 'normal' })); }
  // play a few age III turns so that some cards are gone
  for (let i = 0; i < 4 && !st.winner; i++) E.apply(st, __ai(st, { level: 'normal' }));
  __duel.view.newGame(st); await __duel.view.syncAll(st, { instant: true });
  __duel.game.hud.update(st); __duel.stage.goto('structure', { snap: true });
  return { age: st.age, guilds: st.structure.filter(s => /guild/.test(s.card)).map(s => s.card) };
});
console.log(JSON.stringify(info));
await sleep(6000); await page.screenshot({ path: `${out}/a3_structure.png` });
await page.evaluate(() => __duel.stage.goto('overview', { snap: true })); await sleep(4000); await page.screenshot({ path: `${out}/a3_overview.png` });
console.log('errors:', logs.length ? logs.slice(0, 6) : 'none');
await browser.close();
