// End-to-end test of online play: two headless Edge pages talk over real WebRTC through a local PeerJS signalling
// server (no internet needed). It drives the lobby (host / join by link), plays moves through the real game loop on
// both sides and checks that the two copies of the game never differ, then abuses the connection: a dropped data
// channel, a reload of the guest's tab and of the host's, and finally a finished match with a rematch.
//
//   npm run build && node tests/online.mjs [--shots dir]
//
// Serves dist/ itself on a free port; needs `npm run build` first. Takes a few minutes: headless WebGL is slow.
import puppeteer from 'puppeteer-core';
import { PeerServer } from 'peer';
import http from 'node:http';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createGame, apply, legalActions } from '../src/engine/rules.js';

const args = process.argv.slice(2);
// --phases 1,6,7 runs only those numbered steps (2 to 5 replay a whole match, which is slow)
const phases = args.includes('--phases') ? args[args.indexOf('--phases') + 1].split(',').map(Number) : null;
const want = n => !phases || phases.includes(n);
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shotDir) mkdirSync(shotDir, { recursive: true });
if (!existsSync('dist/index.html')) { console.error('dist/ is missing: run `npm run build` first'); process.exit(2); }

// ---- servers: the game (static) and the PeerJS signalling server
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'text/xml' };
const web = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = join('dist', p === '/' ? 'index.html' : p.replace(/\.\.+/g, ''));
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise(r => web.listen(0, r));
const WEB = web.address().port, SIG = 9000 + Math.floor(Math.random() * 900);
const sig = PeerServer({ port: SIG, path: '/' });
const base = `http://localhost:${WEB}/?peer=localhost:${SIG}`;

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
// every player gets a browser of their own: a background tab does not run requestAnimationFrame, so two pages in one
// browser would starve each other (and two separate browsers is closer to two computers anyway)
const launch = () => puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--window-size=1100,650'], defaultViewport: { width: 1100, height: 650, deviceScaleFactor: 1 } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
let failed = 0;
const ok = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) failed++; };
const step = t => console.log('\n' + t);

const browsers = [];
async function newPlayer(name, url, { saved = null } = {}) {
  const browser = await launch(); browsers.push(browser);
  const page = await browser.newPage();
  page.browser_ = browser;
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${name}] ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => errors.push(`[${name}] PAGEERROR ${e.message}`));
  await page.evaluateOnNewDocument((s) => {
    try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low', speed: 8, mode: 'online', first: 'me' })); } catch { /* */ }
    if (s && !sessionStorage.getItem('sw-duel-online')) sessionStorage.setItem('sw-duel-online', JSON.stringify(s));
  }, saved);
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__duel?.game, { timeout: 60000 });
  await page.evaluate(() => {
    window.__h = () => { const s = JSON.stringify(__duel.game.state); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
    // whoever's turn it is plays a random legal move, through the same function the UI's clicks end in
    window.__move = () => {
      const g = __duel.game; if (!g.mode) return false;
      const acts = __engine.legalActions(g.state); const a = acts[Math.floor(Math.random() * acts.length)];
      g.resolveAction(a); g.dialogs.clear(); return a.type;
    };
  });
  page.name = name;
  return page;
}
const clickText = (page, re) => page.evaluate(src => { const b = [...document.querySelectorAll('button')].find(x => new RegExp(src, 'i').test(x.textContent) && !x.disabled); if (!b) return false; b.click(); return true; }, re.source);
const waitText = (page, re, t = 30000) => page.waitForFunction(src => new RegExp(src, 'i').test(document.getElementById('overlay').textContent), { timeout: t }, re.source);
const shot = async (page, n) => { if (shotDir) { await sleep(400); await page.screenshot({ path: `${shotDir}/${n}.png` }); } };
const logLen = page => page.evaluate(() => __duel.game.online?.sync.log.length ?? -1);
const hash = page => page.evaluate(() => __h());

/** Both pages have applied the same number of moves and hold the same state. */
async function inSync(a, b, what, timeout = 45000) {
  const t0 = Date.now();
  for (;;) {
    const [la, lb] = [await logLen(a), await logLen(b)];
    if (la >= 0 && la === lb) { const [ha, hb] = [await hash(a), await hash(b)]; if (ha === hb) { ok(true, `${what}: in sync after ${la} moves (${ha})`); return la; } if (Date.now() - t0 > timeout) { ok(false, `${what}: same log length ${la} but states differ ${ha} / ${hb}`); return la; } }
    else if (Date.now() - t0 > timeout) { ok(false, `${what}: logs differ (${la} vs ${lb})`); return la; }
    await sleep(400);
  }
}
/** Play `n` moves between two pages, whoever is on turn, checking they agree after each. */
async function play(a, b, n, what) {
  let done = 0;
  const t0 = Date.now();
  while (done < n) {
    if (Date.now() - t0 > 240000) { ok(false, `${what}: stalled after ${done} moves`); return done; }
    for (const p of [a, b]) { if (await p.evaluate(() => { const g = __duel.game; return !!g.mode && !g.state.winner; })) { const before = await logLen(p); await p.evaluate(() => __move()); done++; const t1 = Date.now(); while ((await logLen(p)) === before && Date.now() - t1 < 15000) await sleep(100); await inSync(a, b, `${what} move ${done}`); break; } }
    await sleep(250);
  }
  return done;
}

try {
  // ============================================================ lobby
  step('1. host a duel, join by invite link');
  const host = await newPlayer('host', base);
  await waitText(host, /Opponent|Begin|Play online/i).catch(() => {}); // title menu is up
  await host.evaluate(() => document.querySelector('.seg').children[2].click()); // Opponent: Online
  ok(await host.evaluate(() => /Play online/.test(document.querySelector('.menu-actions .btn.big').textContent)), 'the menu button says "Play online"');
  await host.evaluate(() => document.querySelector('.menu-actions .btn.big').click());
  await waitText(host, /Host a duel/);
  ok(await host.evaluate(() => [...document.querySelectorAll('.lobby button')].filter(b => /host|join/i.test(b.textContent)).every(b => b.disabled)), 'host/join are disabled until a name is typed');
  await host.type('#lobby-name', 'Ann');
  await shot(host, '01_lobby_choose');
  await clickText(host, /Host a duel/);
  await host.waitForSelector('.code-big span', { timeout: 30000 });
  const code = await host.evaluate(() => [...document.querySelectorAll('.code-big span')].map(s => s.textContent).join(''));
  ok(/^[A-HJ-NP-Z2-9]{5}$/.test(code), `a room code was issued: ${code}`);
  ok(await host.evaluate(c => document.querySelector('.invite-link').textContent.endsWith('?join=' + c), code), 'the invite link carries the code');
  await shot(host, '02_lobby_host');

  const guest = await newPlayer('guest', base + '&join=' + code);
  await waitText(guest, /Join a duel/);
  ok(await guest.evaluate(c => document.getElementById('lobby-code').value === c, code), 'the invite link pre-fills the room code');
  await guest.type('#lobby-name', 'Bob');
  await shot(guest, '03_lobby_join');
  await clickText(guest, /^Join$/);

  await Promise.all([host, guest].map(p => p.waitForFunction(() => __duel.game.running && __duel.game.online, { timeout: 60000 })));
  ok(true, 'both browsers are in the match');
  const names = await Promise.all([host, guest].map(p => p.evaluate(() => ({ names: __duel.game.state.players.map(x => x.name), seat: __duel.game.online.seat, first: __duel.game.state.first, seed: __duel.game.state.seed }))));
  ok(JSON.stringify(names[0].names) === JSON.stringify(['Ann', 'Bob']) && JSON.stringify(names[1].names) === JSON.stringify(['Ann', 'Bob']), 'both see Ann (host) and Bob (guest)');
  ok(names[0].seat === 0 && names[1].seat === 1, 'the host sits in seat 0, the guest in seat 1');
  ok(names[0].seed === names[1].seed && names[0].first === 0, 'same seed; the host chose to begin');
  await sleep(3000);
  await shot(host, '04_host_table'); await shot(guest, '05_guest_table');

  // ============================================================ play
if (want(2)) {
  step('2. play ten moves, checking both copies after each');
  await play(host, guest, 10, 'play');
  ok(await guest.evaluate(() => __duel.game.viewer() === 1), 'the guest looks from seat 1');
  const waitingHint = await host.evaluate(() => document.querySelector('.hint')?.textContent || '');
  console.log('  (hint on host now: ' + JSON.stringify(waitingHint) + ')');

}
  // ============================================================ dropped connection
if (want(3)) {
  step('3. the connection drops and comes back');
  await host.evaluate(() => { window.__st = []; __duel.game.online.room.on('status', s => window.__st.push(s)); });
  await guest.evaluate(() => { window.__st = []; __duel.game.online.room.on('status', s => window.__st.push(s)); });
  await guest.evaluate(() => __duel.game.online.room.conn.close()); // what a wifi blip looks like to the page
  await host.waitForFunction(() => window.__st.includes('lost'), { timeout: 20000 }).then(() => ok(true, 'the host noticed the drop'), () => ok(false, 'the host never noticed the drop'));
  await Promise.all([host, guest].map(p => p.waitForFunction(() => __duel.game.online.room.status === 'connected' && __duel.game.online.room.open, { timeout: 40000 }))).then(() => ok(true, 'the guest dialled back in on its own'), () => ok(false, 'no reconnection'));
  await inSync(host, guest, 'after the drop');
  await play(host, guest, 3, 'after reconnect');

}
  // ============================================================ reload the guest
if (want(4)) {
  step('4. the guest reloads the tab');
  const before = await logLen(host);
  await guest.reload({ waitUntil: 'load', timeout: 120000 });
  await guest.waitForFunction(() => window.__duel?.game, { timeout: 60000 });
  await guest.evaluate(() => { window.__h = () => { const s = JSON.stringify(__duel.game.state); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }; window.__move = () => { const g = __duel.game; if (!g.mode) return false; const acts = __engine.legalActions(g.state); const a = acts[Math.floor(Math.random() * acts.length)]; g.resolveAction(a); g.dialogs.clear(); return a.type; }; });
  await guest.waitForFunction(() => __duel.game.running && __duel.game.online, { timeout: 90000 }).then(() => ok(true, 'the guest was taken straight back into the duel'), () => ok(false, 'the guest did not rejoin after the reload'));
  ok((await logLen(guest)) === before, `the guest's match was rebuilt from the host's log (${before} moves)`);
  await inSync(host, guest, 'after the guest reload');
  await play(host, guest, 2, 'after guest reload');
  await shot(guest, '06_guest_after_reload');

}
  // ============================================================ reload the host
if (want(5)) {
  step('5. the host reloads the tab');
  const before2 = await logLen(guest);
  await host.reload({ waitUntil: 'load', timeout: 120000 });
  await host.waitForFunction(() => window.__duel?.game, { timeout: 60000 });
  await waitText(host, /Resume your online duel/);
  await shot(host, '07_resume_prompt');
  await clickText(host, /^Resume$/);
  await host.waitForFunction(() => __duel.game.running && __duel.game.online, { timeout: 90000 }).then(() => ok(true, 'the host reopened its room and the match'), () => ok(false, 'the host did not get its match back'));
  await host.evaluate(() => { window.__h = () => { const s = JSON.stringify(__duel.game.state); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }; window.__move = () => { const g = __duel.game; if (!g.mode) return false; const acts = __engine.legalActions(g.state); const a = acts[Math.floor(Math.random() * acts.length)]; g.resolveAction(a); g.dialogs.clear(); return a.type; }; });
  ok((await logLen(host)) === before2, `the host's log survived the reload (${before2} moves)`);
  await inSync(host, guest, 'after the host reload', 90000);
  await play(host, guest, 2, 'after host reload');

}
  // ============================================================ rules of the road
if (want(6)) {
  step('6. a third browser cannot barge in, and leaving is announced');
  // three software-rendered 3D pages starve each other: let the two running games stand still while the third one loads
  const freeze = p => p.evaluate(() => __duel.stage.renderer.setAnimationLoop(null));
  const thaw = p => p.evaluate(() => __duel.stage.renderer.setAnimationLoop(() => __duel.stage.frame()));
  await freeze(host); await freeze(guest);
  const intruder = await newPlayer('intruder', base + '&join=' + code);
  await waitText(intruder, /Join a duel/);
  await intruder.type('#lobby-name', 'Eve');
  await clickText(intruder, /^Join$/);
  await waitText(intruder, /already has two players/i, 40000).then(() => ok(true, 'the intruder is told the duel is full'), () => ok(false, 'the intruder was not refused'));
  ok((await logLen(host)) === (await logLen(guest)), 'the running match was not disturbed');
  await intruder.browser_.close();
  await thaw(host); await thaw(guest);


}
// the first pair is done: their 3D scenes would starve the next two software-rendered pages
for (const p of [host, guest]) await p.browser_.close().catch(() => {});

  // ============================================================ a finished match and a rematch
if (want(7)) {
  step('7. finish a match, then rematch');
  // a match that is three moves from the end, described the way a host saves it
  const cfg = { seed: 4242, first: 0, names: ['Ann', 'Bob'] };
  const st = createGame(cfg); const log = [];
  let rs = 12345; const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  while (!st.winner) { const acts = legalActions(st); const a = acts[Math.floor(rnd() * acts.length)]; apply(st, a); log.push(a); }
  const nearEnd = log.slice(0, log.length - 3);
  const saved = { role: 'host', code: 'DUEL7', cfg, log: nearEnd };
  const h2 = await newPlayer('host2', base, { saved });
  await waitText(h2, /Resume your online duel/, 120000);
  await clickText(h2, /^Resume$/);
  await h2.waitForFunction(() => __duel.game.running && __duel.game.online, { timeout: 90000 });
  const g2 = await newPlayer('guest2', base + '&join=DUEL7');
  await waitText(g2, /Join a duel/, 120000);
  await g2.type('#lobby-name', 'Bob');
  await clickText(g2, /^Join$/);
  await g2.waitForFunction(() => __duel.game.running && __duel.game.online, { timeout: 90000 });
  ok((await logLen(g2)) === nearEnd.length, `the guest joined a match already ${nearEnd.length} moves in`);
  await inSync(h2, g2, 'near the end', 90000);
  await play(h2, g2, 3, 'last moves');
  await Promise.all([h2, g2].map(p => p.waitForFunction(() => document.querySelector('.verdict'), { timeout: 120000 }))).then(() => ok(true, 'both see the game-over dialog'), () => ok(false, 'no game-over dialog'));
  const verdicts = await Promise.all([h2, g2].map(p => p.evaluate(() => document.querySelector('.verdict').textContent + ' | ' + document.querySelector('.vsub').textContent)));
  console.log('  ' + verdicts.join('\n  '));
  await shot(h2, '08_game_over_host'); await shot(g2, '09_game_over_guest');
  const oldSeed = cfg.seed;
  await clickText(h2, /^Rematch$/);
  await waitText(g2, /wants a rematch/i, 20000).then(() => ok(true, 'the guest is told the host wants a rematch'), () => ok(false, 'the guest was not told'));
  await shot(g2, '10_rematch_asked');
  await clickText(g2, /^Rematch$/);
  await Promise.all([h2, g2].map(p => p.waitForFunction(old => __duel.game.online.sync.cfg.seed !== old && __duel.game.running && __duel.game.online.sync.log.length === 0, { timeout: 60000 }, oldSeed))).then(() => ok(true, 'a fresh match started on both sides'), () => ok(false, 'the rematch never started'));
  const cfgs = await Promise.all([h2, g2].map(p => p.evaluate(() => JSON.stringify(__duel.game.online.sync.cfg))));
  ok(cfgs[0] === cfgs[1], 'same new seed and starter on both');
  ok(JSON.parse(cfgs[0]).first === 1, 'the other player begins the rematch');
  await inSync(h2, g2, 'rematch');

  // leaving on purpose is announced
  await h2.evaluate(() => { const g = __duel.game; g.abort++; g.leaveMode(); g.showTitle(); });
  await waitText(g2, /has left the duel/i, 20000).then(() => ok(true, 'the guest is told the host left'), () => ok(false, 'the guest was not told the host left'));
  await shot(g2, '11_host_left');
}
} catch (e) {
  console.log('  FAIL ' + (e.stack || e)); failed++;
  // what was on screen when it went wrong
  for (const b of browsers) for (const p of await b.pages().catch(() => [])) {
    try {
      console.log('  [diag] ' + await p.evaluate(() => JSON.stringify({ url: location.search, overlay: document.getElementById('overlay')?.innerText.replace(/\s+/g, ' ').slice(0, 160), running: window.__duel?.game?.running, online: !!window.__duel?.game?.online })));
      if (shotDir) await p.screenshot({ path: `${shotDir}/fail-${Math.random().toString(36).slice(2, 6)}.png` });
    } catch { /* page already gone */ }
  }
}

const real = errors.filter(e => !/favicon|Failed to load resource/.test(e));
console.log('\nconsole errors:', real.length ? real.slice(0, 10) : 'none');
if (real.length) failed++;
for (const b of browsers) await b.close().catch(() => {});
sig.close?.(); web.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nonline tests OK');
process.exit(failed ? 1 : 0);
