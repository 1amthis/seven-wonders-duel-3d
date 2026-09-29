// Headless-browser screenshot helper for visual QA (uses the locally installed Edge/Chrome via puppeteer-core).
// Usage: node tests/shoot.mjs "<query string>" out.png [--wait ms] [--w 1600] [--h 900] [--eval "js"] [--log]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const query = args[0] || '';
const out = args[1] || 'shot.png';
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
const W = +opt('w', 1600), H = +opt('h', 900), wait = +opt('wait', 8000), ev = opt('eval', null), base = opt('base', 'http://localhost:5173/');

const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const exe = candidates.find(existsSync);
if (!exe) throw new Error('No Chromium-based browser found');

const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new',
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GPU stall|swiftshader|WebGL: INVALID|deprecated/i.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  const Q = opt('q', 'low');
  await page.evaluateOnNewDocument(q => { try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: q })); } catch { /* */ } }, Q);
  await page.goto(base + query, { waitUntil: 'load', timeout: 120000 });
  await new Promise(r => setTimeout(r, wait));
  if (ev) { const r = await page.evaluate(ev); if (r !== undefined) console.log('eval →', typeof r === 'string' ? r : JSON.stringify(r)); await new Promise(r => setTimeout(r, +opt('after', 1500))); }
  await page.screenshot({ path: out });
  console.log('saved', out);
  if (logs.length) console.log(logs.slice(0, 12).join('\n'));
} finally { await browser.close(); }
