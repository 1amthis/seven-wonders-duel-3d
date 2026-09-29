// Headless regression: the Age I deal must start from a clean, stacked deck.
// The engine emits [draft, ageStart, turn] for the last wonder pick with the *final* state (pyramid already built);
// the view must not fly the pyramid cards out during the `draft` event and then snap them back for the real deal.
// usage: node tests/agedeal.mjs [--seed N] [--base http://localhost:5173/]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const base = opt('--base', 'http://localhost:5173/');
const seed = opt('--seed', '8');
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
const page = await browser.newPage(); const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low' })); } catch { /* */ } });
// hooks must be in place before startMatch() runs its first draft events, so install them as soon as __duel exists
await page.evaluateOnNewDocument(() => {
  window.__deal = { ageStarts: [], preDealMoves: 0, moves: [], jumps: [] };
  const iv = setInterval(() => {
    const d = window.__duel; if (!d?.view || d.view.__hooked) return;
    const v = d.view; v.__hooked = true; clearInterval(iv);
    const S = window.__deal; let dealing = false, sawAgeStart = false, inPlay = null;
    const origPlay = v.play.bind(v);
    v.play = async (events, state) => { inPlay = events.map(e => e.t); sawAgeStart = events.some(e => e.t === 'ageStart' && e.age === 1); try { return await origPlay(events, state); } finally { inPlay = null; sawAgeStart = false; } };
    const origDeal = v.dealAge.bind(v);
    v.dealAge = async (state) => { dealing = true; S.ageStarts.push({ age: state.age, events: inPlay }); try { return await origDeal(state); } finally { dealing = false; } };
    const origMove = v.moveTo.bind(v);
    v.moveTo = (obj, t, o) => {
      // a building card being moved onto the pyramid while the Age I deal is still ahead of us = the pre-deal flight
      if (sawAgeStart && !dealing && obj.kind === 'card' && t.zone === 'struct') S.preDealMoves++;
      return origMove(obj, t, o);
    };
  }, 5);
});
await page.goto(base + `?auto=1&speed=14&seed=${seed}&quality=low`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__deal?.ageStarts.length >= 1, { timeout: 240000, polling: 500 });
await sleep(1500);
const r = await page.evaluate(() => window.__deal);
console.log(`seed ${seed}: Age I deal events=${JSON.stringify(r.ageStarts[0].events)}  pyramid cards flown out before the deal: ${r.preDealMoves}`);
console.log('errors:', logs.length ? logs.slice(0, 8) : 'none');
await browser.close();
process.exit(r.preDealMoves === 0 && logs.length === 0 ? 0 : 1);
