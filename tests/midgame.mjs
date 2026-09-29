// Headless: watch an AI-vs-AI game up to a target age/turn, then capture several camera views + a hover tooltip.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
const out = process.argv[2] || 'shots'; const W = +(process.argv[3] || 1440), H = +(process.argv[4] || 810);
const targetTurn = +(process.argv[5] || 30); const seed = process.argv[6] || '5';
mkdirSync(out, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage(); const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async n => { await sleep(600); await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
await page.goto(`http://localhost:5173/?auto=1&speed=14&seed=${seed}&quality=low&level=normal`, { waitUntil: 'load', timeout: 180000 });
const t0 = Date.now();
for (;;) { await sleep(3000); const s = await page.evaluate(() => { const st = __duel.game.state; return { age: st.age, turn: st.turnNo, win: !!st.winner }; }); process.stdout.write(`\r age ${s.age} turn ${s.turn}   `); if (s.turn >= targetTurn || s.win || Date.now() - t0 > 420000) break; }
console.log();
await page.evaluate(() => { __duel.game.paused = true; __duel.stage.goto('overview'); }); await sleep(5000);
await shot('m1_overview');
await page.evaluate(() => __duel.stage.goto('left')); await sleep(5000); await shot('m2_left');
await page.evaluate(() => __duel.stage.goto('right')); await sleep(5000); await shot('m3_right');
await page.evaluate(() => __duel.stage.goto('military')); await sleep(5000); await shot('m4_military');
await page.evaluate(() => __duel.stage.goto('wondersRight')); await sleep(5000); await shot('m5_wonders');
await page.evaluate(() => __duel.stage.goto('overview')); await sleep(4000);
// hover a structure card
const p = await page.evaluate(() => { const v = __duel.view, st = __duel.game.state; const i = st.structure.findIndex(s => !s.taken && s.up); const o = v.cards.get(st.structure[i].card); const c = o.root.position.clone().project(__duel.stage.camera); return { x: (c.x * 0.5 + 0.5) * innerWidth, y: (-c.y * 0.5 + 0.5) * innerHeight }; });
await page.mouse.move(p.x, p.y); await sleep(2500); await shot('m6_hover_card');
console.log('errors:', logs.length ? logs.slice(0, 8) : 'none');
await browser.close();
