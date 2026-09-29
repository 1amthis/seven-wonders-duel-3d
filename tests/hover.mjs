// Headless: hover tooltips for a card, a wonder, a token and the discard pile in an AI-vs-AI game at turn N.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
const out = process.argv[2] || 'shots'; const W = +(process.argv[3] || 1440), H = +(process.argv[4] || 810); const turn = +(process.argv[5] || 14);
mkdirSync(out, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage(); const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
await page.goto('http://localhost:5173/?auto=1&speed=14&seed=8&quality=low', { waitUntil: 'load', timeout: 180000 });
for (;;) { await sleep(2500); const t = await page.evaluate(() => __duel.game.state.turnNo); if (t >= turn) break; }
await page.evaluate(() => { __duel.game.paused = true; __duel.stage.goto('overview'); }); await sleep(5000);
const proj = (expr) => page.evaluate(expr);
const hover = async (name, expr) => { const p = await proj(expr); if (!p) { console.log('no target for', name); return; } await page.mouse.move(p.x - 3, p.y); await page.mouse.move(p.x, p.y); await sleep(2200); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const P = `(o) => { const c = o.clone().project(__duel.stage.camera); return { x: (c.x * 0.5 + 0.5) * innerWidth, y: (-c.y * 0.5 + 0.5) * innerHeight }; }`;
await hover('h1_card', `(() => { const st = __duel.game.state, v = __duel.view; const i = st.structure.findIndex((s, i) => !s.taken && s.coveredBy.every(j => st.structure[j].taken)); const o = v.cards.get(st.structure[i].card); const c = o.root.position.clone().project(__duel.stage.camera); return { x: (c.x * 0.5 + 0.5) * innerWidth, y: (-c.y * 0.5 + 0.5) * innerHeight }; })()`);
await hover('h2_wonder', `(() => { const st = __duel.game.state, v = __duel.view; const id = st.players[0].wonders[1].id; const o = v.wonders.get(id).card; const c = o.root.position.clone().project(__duel.stage.camera); return { x: (c.x * 0.5 + 0.5) * innerWidth, y: (-c.y * 0.5 + 0.5) * innerHeight }; })()`);
await hover('h3_token', `(() => { const st = __duel.game.state, v = __duel.view; const id = st.board[0]; const g = v.tokens.get(id); const c = g.position.clone().project(__duel.stage.camera); return { x: (c.x * 0.5 + 0.5) * innerWidth, y: (-c.y * 0.5 + 0.5) * innerHeight }; })()`);
console.log('errors:', logs.length ? logs.slice(0, 8) : 'none');
await browser.close();
