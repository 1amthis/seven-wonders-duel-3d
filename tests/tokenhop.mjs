// Headless regression: progress tokens must not "hop" when they are already in place.
// Plays an AI-vs-AI game and counts _tweenGroup calls whose destination equals the token's current position.
// usage: node tests/tokenhop.mjs [turns=14] [--base http://localhost:5173/]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const args = process.argv.slice(2);
const bi = args.indexOf('--base'); const base = bi >= 0 ? args.splice(bi, 2)[1] : 'http://localhost:5173/';
const turns = +(args[0] || 14);
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
const page = await browser.newPage(); const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
await page.goto(base + '?auto=1&speed=14&seed=8&quality=low', { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__duel?.view, { timeout: 60000 });
await page.evaluate(() => {
  const v = __duel.view, orig = v._tweenGroup.bind(v);
  window.__hops = { total: 0, spurious: 0, maxRestOffset: 0 };
  v._tweenGroup = (g, dest, dur, arc) => { window.__hops.total++; if (g.position.distanceTo(dest) < 0.01) window.__hops.spurious++; return orig(g, dest, dur, arc); };
  // resting tokens (no glow, no library, no tween) should sit on their slot
  const tick = () => {
    for (const g of v.tokens.values()) if (g.visible && !g.userData.moving && !g.userData.glowT && g.userData.state !== 'library' && g.userData.home) window.__hops.maxRestOffset = Math.max(window.__hops.maxRestOffset, Math.abs(g.position.y - g.userData.home.y));
    requestAnimationFrame(tick);
  };
  tick();
});
for (;;) { await sleep(2500); const t = await page.evaluate(() => __duel.game.state.turnNo); if (t >= turns) break; }
const r = await page.evaluate(() => window.__hops);
console.log(`turns>=${turns}  tween calls: ${r.total}  spurious (token already in place): ${r.spurious}  max offset of a resting token: ${r.maxRestOffset.toFixed(3)}`);
console.log('errors:', logs.length ? logs.slice(0, 8) : 'none');
await browser.close();
process.exit(r.spurious === 0 && logs.length === 0 ? 0 : 1);
