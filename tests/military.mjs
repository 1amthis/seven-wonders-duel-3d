// Headless: force a military victory through the real UI (hot-seat) and capture the sequence.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
const out = process.argv[2] || 'shots'; const W = +(process.argv[3] || 1280), H = +(process.argv[4] || 720);
mkdirSync(out, { recursive: true });
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage(); const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async n => { await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
const ev = (fn, ...a) => page.evaluate(fn, ...a);
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low', speed: 6, mode: 'hot', first: 'me' })); } catch { /* */ } });
await page.goto('http://localhost:5173/?scenario=1', { waitUntil: 'load', timeout: 180000 });
await sleep(6000);
await ev(() => {
  window.S = {
    sleep: ms => new Promise(r => setTimeout(r, ms)), g: __duel.game,
    async waitMode(type, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = this.g.mode; if (m && m.type === type) return true; await this.sleep(200); } return false; },
    async draft() { while (await this.waitMode('draft', 30000)) { const st = this.g.state; this.g.onPick({ type: 'wonder', id: st.draft.pool[0] }); await this.sleep(1500); } },
    acc() { const st = this.g.state; return st.structure.map((s, i) => i).filter(i => { const s = st.structure[i]; return !s.taken && s.coveredBy.every(j => st.structure[j].taken); }); },
    async sel(i) { const st = this.g.state; this.g.onPick({ type: 'card', id: st.structure[i].card }); await this.sleep(600); },
  };
  const g = __duel.game; g.prefs.mode = 'hot'; document.querySelectorAll('.seg')[0].children[1].click();
  [...document.querySelectorAll('.btn')].find(x => /Begin/.test(x.textContent)).click();
});
await sleep(4000);
await ev(() => S.draft()); await ev(() => S.waitMode('turn', 90000)); await sleep(4000);
const cards = ['pretorium', 'arsenal', 'fortifications', 'siege_workshop'];
for (let k = 0; k < cards.length; k++) {
  await ev(async (id, first) => {
    await S.waitMode('turn', 60000);
    const st = S.g.state; if (first) { st.players[0].coins = 200; st.players[1].coins = 30; }
    const a = S.acc(); st.structure[a[0]].card = id; st.structure[a[0]].up = true; await S.g.view.syncAll(st); await S.sleep(1200);
    await S.sel(a[0]); document.querySelector('.dk-btn.build').click();
  }, cards[k], k === 0);
  await sleep(2500); await shot(`mil_${k}a`);
  await sleep(4500); await shot(`mil_${k}b`);
  const win = await ev(() => !!S.g.state.winner); if (win) break;
  // P1 discards something
  await ev(async () => { await S.waitMode('turn', 60000); const a = S.acc(); await S.sel(a[0]); document.querySelector('.dk-btn.disc').click(); });
  await sleep(3000);
}
await sleep(8000); await shot('mil_end1'); await sleep(8000); await shot('mil_end2');
console.log('errors:', logs.length ? logs.slice(0, 8) : 'none');
await browser.close();
