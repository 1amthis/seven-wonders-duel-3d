// Scripted end-to-end UI scenario in headless Edge: drives the real click paths (draft, dock, wonders, destroy,
// revive, Great Library, tokens) in hot-seat mode and takes screenshots along the way.
// Usage: node tests/scenario.mjs <outDir> [w] [h]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const out = process.argv[2] || 'shots';
const W = +(process.argv[3] || 1440), H = +(process.argv[4] || 810);
mkdirSync(out, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => { await sleep(700); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const ev = (fn, ...a) => page.evaluate(fn, ...a);

await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low', speed: 8 })); } catch { /* */ } });
await page.goto('http://localhost:5173/?scenario=1', { waitUntil: 'load', timeout: 180000 });
await sleep(6000);
await ev(() => {
  const S = window.S = {
    sleep: ms => new Promise(r => setTimeout(r, ms)), g: __duel.game,
    async waitMode(type, ms = 40000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = this.g.mode; if (m && m.type === type) return true; await this.sleep(200); } return false; },
    async draft(prefs) { while (await this.waitMode('draft', 30000)) { const st = this.g.state; const id = prefs.find(p => st.draft.pool.includes(p)) || st.draft.pool[0]; this.g.onPick({ type: 'wonder', id }); await this.sleep(1500); } },
    acc() { const st = this.g.state; return st.structure.map((s, i) => i).filter(i => { const s = st.structure[i]; return !s.taken && s.coveredBy.every(j => st.structure[j].taken); }); },
    async sel(i) { const st = this.g.state; this.g.onPick({ type: 'card', id: st.structure[i].card }); await this.sleep(700); },
    dock(k) { document.querySelector('.dk-btn.' + k)?.click(); },
    wonderBtn(re) { [...document.querySelectorAll('.dk-w')].find(b => re.test(b.textContent))?.click(); },
  };
});
// --- start hot-seat game
await ev(() => { const g = __duel.game; g.prefs.speed = 8; g.prefs.first = 'me'; g.prefs.mode = 'hot'; g.applyPrefs(); document.querySelectorAll('.seg')[0].children[1].click(); });
await sleep(300);
await shot('01_title');
await ev(() => [...document.querySelectorAll('.btn')].find(x => /Begin/.test(x.textContent)).click());
await sleep(5000);
await shot('02_draft');
await ev(() => S.draft(['circus_maximus', 'statue_of_zeus', 'mausoleum', 'great_library', 'hanging_gardens', 'appian_way', 'sphinx', 'piraeus']));
await ev(() => S.waitMode('turn', 60000));
await sleep(5000);
await shot('03_age1_overview');
// cheat: money + raw materials, discard pile content, targets for destroy
await ev(async () => { const st = S.g.state; st.players[0].coins = 60; st.players[1].coins = 60; st.players[0].cards.push('sawmill', 'brickyard', 'shelf_quarry', 'glassblower', 'drying_room'); st.players[1].cards.push('glassblower', 'drying_room', 'sawmill', 'clay_pit'); st.discard.push('theater', 'altar', 'baths'); await S.g.view.syncAll(st); S.g.hud.update(st); });
await sleep(2500);
await ev(async () => { const a = S.acc(); await S.sel(a[1]); });
await shot('04_dock');
await ev(() => document.querySelector('.dk-btn.wond').click());
await shot('05_dock_wonders');
await ev(() => S.wonderBtn(/Circus/));
await sleep(2500); await shot('05b_wonder_build_a');
await sleep(3500); await shot('05c_wonder_build_b');
await ev(() => S.waitMode('destroy', 30000));
await sleep(4000);
await shot('06_destroy_choice');
await ev(() => S.g.onPick({ type: 'card', id: 'glassblower' }));
await sleep(4500);
await shot('07_after_destroy');
// P1 builds the Mausoleum
await ev(async () => { await S.waitMode('turn', 20000); const a = S.acc(); await S.sel(a[1]); document.querySelector('.dk-btn.wond').click(); await S.sleep(300); S.wonderBtn(/Mausoleum/); });
await ev(() => S.waitMode('revive', 20000));
await sleep(2500);
await shot('08_revive');
await ev(() => document.querySelectorAll('.pick')[2].click());
await sleep(7000);
await shot('09_after_revive');
// P0 builds Great Library
await ev(async () => { await S.waitMode('turn', 20000); const a = S.acc(); await S.sel(a[2]); document.querySelector('.dk-btn.wond').click(); await S.sleep(300); S.wonderBtn(/Library/); });
await ev(() => S.waitMode('library', 20000));
await sleep(3500);
await shot('10_library');
await ev(() => S.g.onPick({ type: 'token', id: S.g.state.pending.options[0] }));
await sleep(4000);
await shot('11_after_token');
console.log('errors:', logs.length ? logs.slice(0, 8) : 'none');
await browser.close();
