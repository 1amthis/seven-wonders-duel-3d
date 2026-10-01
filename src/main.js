import './styles.css';
import { Stage } from './gfx/stage.js';
import { GameView } from './gfx/view.js';
import { HUD } from './ui/hud.js';
import { Dialogs, loadPrefs } from './ui/dialogs.js';
import { Game } from './game.js';
import { GameAudio } from './audio.js';
import { installDebug } from './debug.js';
import { parseCode } from './net/protocol.js';
import { chooseAction } from './engine/ai.js';
import * as rules from './engine/rules.js';
import * as data from './engine/data.js';

// QA switch: drive requestAnimationFrame from a worker so the game keeps running while the preview pane is hidden.
if (new URLSearchParams(location.search).get('raf') === 'worker') {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16)'])));
  let cbs = [];
  w.onmessage = () => { const c = cbs; cbs = []; const t = performance.now(); for (const f of c) f(t); };
  window.requestAnimationFrame = cb => { cbs.push(cb); return cbs.length; };
  window.cancelAnimationFrame = () => {};
}

async function boot() {
  await Promise.all(['700 40px Cinzel', '600 20px Cinzel', '800 40px Cinzel', '400 20px Cinzel', '600 20px "Cormorant Garamond"', 'italic 600 20px "Cormorant Garamond"', '500 20px "Cormorant Garamond"'].map(f => document.fonts.load(f)));
  const audio = new GameAudio();
  const stage = new Stage(document.getElementById('stage'));
  stage.viewInsets = { top: 100, bottom: 34 };
  stage.getInsets = () => {
    const tb = document.querySelector('.toolbar')?.getBoundingClientRect();
    const bar = tb && tb.width > innerWidth * 0.5; // the phone toolbar is a full-width bar along the bottom; elsewhere it floats in a corner
    return { top: (document.querySelector('.topbar')?.offsetHeight || 92) + 6, bottom: bar ? Math.round(innerHeight - tb.top) + 4 : 34 };
  };
  const view = new GameView(stage, audio);
  view.init();
  const hud = new HUD(document.getElementById('hud'), {});
  // the top bar changes height with the screen size (and when a counter wraps): keep the camera framing in step
  if (window.ResizeObserver) { let raf = 0; new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => stage.resize()); }).observe(document.querySelector('.topbar')); }
  const dialogs = new Dialogs(document.getElementById('overlay'), audio);
  const prefs = loadPrefs();
  const game = new Game({ stage, view, hud, dialogs, audio, prefs });
  window.__duel = { game, stage, view, hud, audio };
  game.applyPrefs();
  if (new URLSearchParams(location.search).has('debug') || location.hostname === 'localhost') { installDebug(stage); window.__ai = chooseAction; window.__engine = rules; window.__data = data; }
  stage.renderer.setAnimationLoop(() => stage.frame());
  const unlock = () => { audio.init(); audio.resume(); if (!game.running) audio.startMusic?.('menu'); removeEventListener('pointerdown', unlock); };
  addEventListener('pointerdown', unlock);
  document.getElementById('loader').classList.add('done');
  const q = new URLSearchParams(location.search);
  if (q.get('auto')) { prefs.mode = 'spec'; prefs.speed = +(q.get('speed') || 3); prefs.level = q.get('level') || 'normal'; if (q.get('quality')) prefs.quality = q.get('quality'); game.applyPrefs(); audio.init(); game.startMatch(); }
  else { game.linkJoin = parseCode(q.get('join')); game.showTitle(); } // an invite link opens straight on the "join" screen
}
boot().catch(e => {
  console.error(e); document.title = 'ERR ' + e.message;
  const l = document.querySelector('.loader-sub');
  if (l) l.textContent = /webgl/i.test(e.message) ? 'This game needs WebGL 2 — please enable hardware acceleration or try a recent Chrome, Edge or Firefox.' : 'Something went wrong: ' + e.message;
});
