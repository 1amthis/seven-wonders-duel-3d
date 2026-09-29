// Renders a short silent teaser (docs/teaser.mp4 + docs/teaser.gif) of the built game.
//
// Software WebGL is far too slow to screen-record, so the page runs on a virtual clock: performance.now and
// requestAnimationFrame are replaced (and Math.random seeded), and we step the game exactly 1/fps second per frame,
// screenshot it, and let ffmpeg assemble the frames. The result is smooth however long each frame takes to render.
//
// Usage: npm run build && node tests/teaser.mjs [--seed=21] [--fps=24] [--w=1280] [--h=720] [--quality=high]
//                                                [--out=docs] [--frames=<dir>] [--no-encode]
// Quick composition test: node tests/teaser.mjs --w=640 --h=360 --fps=12 --quality=low --out=<scratch dir>
// ffmpeg: set FFMPEG to the executable, otherwise `ffmpeg` on PATH (pip's imageio-ffmpeg ships one).
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const seed = arg('seed', '21'), fps = +arg('fps', 24), W = +arg('w', 1280), H = +arg('h', 720), Q = arg('quality', 'high');
const outDir = arg('out', 'docs'), framesDir = arg('frames', join(tmpdir(), 'sw-teaser-frames'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const encodeOnly = process.argv.includes('--encode-only'); // re-encode the frames already in --frames, without rendering
mkdirSync(outDir, { recursive: true });
if (!encodeOnly) { rmSync(framesDir, { recursive: true, force: true }); mkdirSync(framesDir, { recursive: true }); }

// The game's film grain is random per pixel per frame, which video codecs and GIF palettes cannot compress: lower it for
// filming (see the uAmount uniform of the GrainShader in src/gfx/stage.js) and let hqdn3d clean up what is left.
function encode() {
  const inp = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', join(framesDir, 'f%04d.jpg')];
  // mp4: limited-range yuv420p plays everywhere (the JPEG frames are full range); gif: small enough to sit inline in a README
  execFileSync(FFMPEG, [...inp, '-vf', 'hqdn3d=3:2.5:6:5,scale=out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart', join(outDir, 'teaser.mp4')], { stdio: 'inherit' });
  execFileSync(FFMPEG, [...inp, '-vf', 'hqdn3d=4:3:8:6,fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle', '-loop', '0', join(outDir, 'teaser.gif')], { stdio: 'inherit' });
  for (const f of ['teaser.mp4', 'teaser.gif']) console.log('wrote', join(outDir, f), (statSync(join(outDir, f)).size / 1048576).toFixed(1) + ' MB');
}
if (encodeOnly) { encode(); process.exit(0); }

// ---------------------------------------------------------------- storyboard (seconds)
const DUR = 13.5, DIP = 5.8, GLIDE = [6.3, 11.0];
const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const seg = (t, a, b) => clamp01((t - a) / (b - a));                       // 0..1 progress of t within [a, b]
const fadeAt = t => 1 - smooth(seg(t, 0, 0.8)) + smooth(seg(t, 5.3, DIP)) - smooth(seg(t, DIP, 6.3)) + smooth(seg(t, 12.9, DUR)); // 1 = black
const titleAt = t => smooth(seg(t, 0.5, 1.3)) - smooth(seg(t, 3.5, 4.2));
const CAPTIONS = [ // none over the live scene: the HUD's hint bar and ticker occupy the bottom of the frame there
  { a: 6.9, b: 10.6, text: 'Twelve wonders, every one generated in your browser' },
];
const endCardAt = t => smooth(seg(t, 11.7, 12.5));
const hudAt = t => (t < DIP ? smooth(seg(t, 3.9, 4.6)) : 0);              // the HUD stays out of the opening title and the beauty shots
// camera keyframes: [t, {target, yaw, pitch, dist as a multiple of the fit distance}] blended with smoothstep
const cam = (P, name, o = {}) => ({ t: [...P[name].t], yaw: o.yaw ?? P[name].yaw, pitch: o.pitch ?? P[name].pitch, dist: (o.k ?? 1) * P[name].dist });
const lerp = (a, b, u) => a + (b - a) * u;
const blend = (a, b, u) => ({ t: a.t.map((v, i) => lerp(v, b.t[i], u)), yaw: lerp(a.yaw, b.yaw, u), pitch: lerp(a.pitch, b.pitch, u), dist: lerp(a.dist, b.dist, u) });
function cameraAt(t, P) {
  const A0 = cam(P, 'overview', { yaw: -0.14, pitch: 0.9, k: 0.95 }), A1 = cam(P, 'overview', { yaw: 0.13, pitch: 0.7, k: 0.6 });
  const B0 = cam(P, 'wondersLeft', { pitch: 0.62, k: 1.05 }), B1 = cam(P, 'wondersRight', { pitch: 0.58, k: 0.98 });
  const C1 = cam(P, 'cinematic', { k: 1.0 });
  if (t < DIP) return blend(A0, A1, smooth(seg(t, 0, DIP)));
  if (t < GLIDE[1]) return blend(B0, B1, smooth(seg(t, GLIDE[0], GLIDE[1])));
  return blend(B1, C1, smooth(seg(t, GLIDE[1], DUR - 0.4)));
}

// ---------------------------------------------------------------- serve dist/ on localhost
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html', f = join('dist', p);
  if (p.includes('..') || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise(r => server.listen(0, 'localhost', r));

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!exe) throw new Error('No Chromium-based browser found');
const browser = await puppeteer.launch({
  executablePath: exe, headless: 'new', protocolTimeout: 1800000,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', `--window-size=${W},${H}`],
  defaultViewport: { width: 480, height: 270, deviceScaleFactor: 1 },
});
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/GPU stall|swiftshader/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

  // virtual clock + seeded randomness, installed before the game's scripts run
  await page.evaluateOnNewDocument(seedNum => {
    let s = seedNum >>> 0;
    Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let vt = 0, id = 0, cbs = [];
    performance.now = () => vt;
    window.requestAnimationFrame = cb => { cbs.push(cb); return ++id; };
    window.cancelAnimationFrame = () => {};
    window.__vt = {
      // advance the virtual clock by ms, run the queued frame callbacks, then let promise continuations (the game loop) run
      async step(ms) { vt += ms; const l = cbs; cbs = []; for (const f of l) f(vt); await new Promise(r => setTimeout(r, 0)); const st = window.__duel && __duel.game.state; return st ? { turn: st.turnNo, age: st.age, win: !!st.winner } : null; },
    };
    try { localStorage.setItem('sw-duel-3d-prefs', JSON.stringify({ quality: 'low', speed: 14, muted: true, level: 'normal' })); } catch { /* */ }
  }, +seed);

  await page.goto(`http://localhost:${server.address().port}/?auto=1&speed=14&seed=${seed}&quality=low&level=normal`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__duel && window.__duel.game.state, { timeout: 60000, polling: 200 });

  // ---- 1. fast-forward a spectated match (tiny viewport, Low) to mid Age II so both cities are populated
  const TARGET_TURN = 24;
  for (let i = 0; ; i++) {
    const s = await page.evaluate(() => __vt.step(100));
    if (i % 20 === 0) log('  fast-forward', JSON.stringify(s));
    if (s && (s.turn >= TARGET_TURN || s.win)) break;
    if (i > 4000) throw new Error('match did not reach the target turn');
  }
  log('mid-game reached, starting to film');

  // ---- 2. set up the shoot: full size, chosen quality, natural pacing, overlays we control per frame
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluate((q) => {
    const g = __duel.game; g.running = false; g.prefs.quality = q; g.prefs.speed = 1.5; g.view.tweens.speed = 1.5; __duel.stage.setQuality(q);
    const mk = (id, css, html = '') => { const d = document.createElement('div'); d.id = id; d.style.cssText = 'position:fixed;pointer-events:none;transition:none;' + css; d.innerHTML = html; document.body.appendChild(d); return d; };
    mk('t-title', 'left:0;right:0;top:0;padding:4.5vh 0 12vh;text-align:center;opacity:0;z-index:50;background:linear-gradient(#0b0705ee,#0b070500)',
      '<div class="title-small">A 3D TRIBUTE TO</div><div class="title-big">SEVEN WONDERS</div><div class="title-big" style="font-size:clamp(20px,min(3.4vw,6vh),44px);letter-spacing:.7em;margin-right:-.7em">DUEL</div>');
    mk('t-cap', 'left:0;right:0;bottom:8vh;text-align:center;opacity:0;z-index:50;text-shadow:0 2px 14px #000,0 0 30px #000;padding:0 6vw',
      '<div class="title-small" id="t-cap-text" style="font-size:clamp(14px,2.3vh,26px);letter-spacing:.32em;color:#f3dfa8"></div>');
    mk('t-end', 'inset:0;opacity:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#0b0705cc,#0b0705f4)',
      '<div class="title-small">A 3D TRIBUTE TO</div><div class="title-big">SEVEN WONDERS</div><div class="title-big" style="font-size:clamp(20px,min(3.4vw,6vh),44px);letter-spacing:.7em;margin-right:-.7em">DUEL</div>' +
      '<div class="title-sub" style="margin-top:3.5vh">Play free in your browser · no download, no sign-up</div>' +
      '<div class="title-small" style="margin-top:2.2vh;letter-spacing:.2em;color:#f3dfa8">1amthis.github.io/seven-wonders-duel-3d</div>' +
      '<div class="title-small" style="margin-top:4vh;font-size:clamp(9px,1.4vh,14px);opacity:.6">A fan-made tribute · not affiliated with the publishers of 7 Wonders Duel</div>');
    mk('t-fade', 'inset:0;background:#000;opacity:1;z-index:99');
    document.getElementById('hud').style.transition = 'none';
    __duel.stage.grain.uniforms.uAmount.value = 0.004;
  }, Q);
  await sleep(500);
  const P = await page.evaluate(() => Object.fromEntries(Object.entries(__duel.stage.presets()).map(([k, v]) => [k, { t: [v.target.x, v.target.y, v.target.z], yaw: v.yaw, pitch: v.pitch, dist: v.dist }])));

  // ---- 3. film
  const total = Math.round(DUR * fps), dtMs = 1000 / fps;
  let staged = false, tFrame = 0;
  for (let i = 0; i < total; i++) {
    const t = i / fps;
    if (!staged && t >= DIP) {
      staged = true; // under the dip to black: freeze the match and stage the beauty shots (rendering only, no rules involved)
      await page.evaluate(async () => {
        const g = __duel.game, st = g.state; g.paused = true; let n = 0;
        for (const p of st.players) for (const w of p.wonders) { w.lost = false; w.built = n < 7; if (w.built) n++; w.under = w.under || null; }
        st.military = 4;
        await g.view.syncAll(st, { instant: true });
      });
    }
    const c = cameraAt(t, P), cap = CAPTIONS.find(k => t >= k.a && t <= k.b);
    const capOp = cap ? smooth(seg(t, cap.a, cap.a + 0.4)) - smooth(seg(t, cap.b - 0.4, cap.b)) : 0;
    await page.evaluate((c, fade, title, capText, capOp, end, hud, dt) => {
      const s = __duel.stage, r = s.rig, g = s.goal;
      for (const o of [r, g]) { o.target.set(c.t[0], c.t[1], c.t[2]); o.yaw = c.yaw; o.pitch = c.pitch; o.dist = c.dist; }
      s.user.yaw = s.user.pitch = 0; s.user.zoom = 1; s.user.pan.set(0, 0, 0);
      const $ = id => document.getElementById(id);
      $('t-fade').style.opacity = fade; $('t-title').style.opacity = title; $('t-end').style.opacity = end;
      $('t-cap').style.opacity = capOp; if (capText) $('t-cap-text').textContent = capText;
      $('hud').style.opacity = hud;
      return __vt.step(dt);
    }, c, Math.min(1, Math.max(0, fadeAt(t))), Math.max(0, titleAt(t)), cap ? cap.text : '', Math.max(0, capOp), endCardAt(t), hudAt(t), dtMs);
    const t1 = Date.now();
    await page.screenshot({ path: join(framesDir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 95 });
    tFrame += Date.now() - t1;
    if (i % 12 === 0) log(`  frame ${i + 1}/${total}  (t=${t.toFixed(1)}s, screenshot avg ${Math.round(tFrame / (i + 1))} ms)`);
  }
  log('frames done; console errors:', errors.length ? errors.slice(0, 6) : 'none');

  // ---- 4. encode
  if (!process.argv.includes('--no-encode')) encode();
} finally { await browser.close(); server.close(); }
