// Modal dialogs: title menu, pause, rules, settings, starter choice, discard picker, final scoreboard.
import { iconHTML, cardURL } from './icons.js';
import { CARD, COLOR_HEX } from '../engine/data.js';
import { isTouch } from './hud.js';

const $ = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// Ties a <label> to its <input> so screen readers (and Lighthouse) can name the field.
let fieldId = 0;
const labelFor = (label, input) => { input.id = 'field-' + ++fieldId; label.htmlFor = input.id; return label; };
// Adds a "label / control" pair to an options grid.
const addRow = (opts, text, el) => { const l = $('label', '', text); opts.append(el.tagName === 'INPUT' ? labelFor(l, el) : l, el); };

export const PREFS_KEY = 'sw-duel-3d-prefs';
export function loadPrefs() {
  const d = { mode: 'ai', level: 'normal', name: 'You', rival: 'Rival', first: 'random', seed: '', quality: isTouch() ? 'medium' : 'high', master: 0.8, music: 0.5, sfx: 0.9, speed: 1, muted: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return d; }
}
export function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

export class Dialogs {
  constructor(overlay, audio) { this.overlay = overlay; this.audio = audio; }

  _open(panelEl, { clear = false, esc = null } = {}) {
    const m = $('div', 'modal' + (clear ? ' clear' : ''));
    m.appendChild(panelEl); this.overlay.appendChild(m);
    if (esc) { const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); esc(); } }; addEventListener('keydown', onKey, true); m._esc = onKey; }
    return m;
  }
  _close(m) { if (m._esc) removeEventListener('keydown', m._esc, true); m.style.transition = 'opacity .35s'; m.style.opacity = 0; setTimeout(() => m.remove(), 350); }
  clear() { this.overlay.innerHTML = ''; }
  click() { this.audio?.play('click'); }

  seg(options, value, onChange) {
    const s = $('div', 'seg');
    options.forEach(([v, label]) => {
      const b = $('button', v === value ? 'on' : '', label);
      b.onclick = () => { [...s.children].forEach(c => c.classList.remove('on')); b.classList.add('on'); onChange(v); this.click(); };
      s.appendChild(b);
    });
    return s;
  }

  // ---------------------------------------------------------------- title
  mainMenu(prefs, { canResume = false } = {}) {
    return new Promise(resolve => {
      const p = $('div', 'panel');
      const w = $('div', 'menu-wrap');
      w.innerHTML = `<div class="menu-title"><div class="title-small">A 3D TRIBUTE TO</div>
        <div class="title-big">SEVEN WONDERS</div>
        <div class="title-big duel">DUEL</div>
        <div class="title-sub">Two rival civilisations. Three ages. One legacy.</div></div>`;
      const opts = $('div', 'opts');
      const row = (label, el) => addRow(opts, label, el);
      row('Opponent', this.seg([['ai', 'Computer'], ['hot', 'Two players'], ['spec', 'Watch AI']], prefs.mode, v => { prefs.mode = v; refresh(); }));
      const diffLabel = $('label', '', 'Difficulty');
      const diff = this.seg([['easy', 'Scribe'], ['normal', 'Strategos'], ['hard', 'Pharaoh']], prefs.level, v => { prefs.level = v; });
      opts.append(diffLabel, diff);
      const name = $('input'); name.type = 'text'; name.maxLength = 14; name.value = prefs.name; name.oninput = () => { prefs.name = name.value || 'You'; };
      row('Your name', name);
      const rival = $('input'); rival.type = 'text'; rival.maxLength = 14; rival.value = prefs.rival; rival.oninput = () => { prefs.rival = rival.value || 'Rival'; };
      const rivalLabel = labelFor($('label', '', 'Rival name'), rival); opts.append(rivalLabel, rival);
      row('Who begins', this.seg([['random', 'Random'], ['me', 'Me'], ['rival', 'Rival']], prefs.first, v => { prefs.first = v; }));
      const seed = $('input'); seed.type = 'text'; seed.placeholder = 'random'; seed.value = prefs.seed; seed.oninput = () => { prefs.seed = seed.value; };
      row('Seed', seed);
      const refresh = () => { const ai = prefs.mode !== 'hot'; diffLabel.style.display = diff.style.display = ai ? '' : 'none'; rival.value = ai ? (prefs.rival === 'Player 2' ? 'Rival' : prefs.rival) : (prefs.rival === 'Rival' ? 'Player 2' : prefs.rival); prefs.rival = rival.value; };
      refresh();
      const btns = $('div', 'row menu-actions');
      const go = $('button', 'btn big', 'Begin the Duel'); go.onclick = () => { this.click(); this.audio?.init(); this.audio?.resume(); this._close(m); resolve({ action: 'play', prefs }); };
      const rules = $('button', 'btn ghost', 'How to play'); rules.onclick = () => { this.click(); this.rules(); };
      const set = $('button', 'btn ghost', 'Settings'); set.onclick = () => { this.click(); this.settings(prefs); };
      btns.append(go, rules, set);
      if (canResume) { const r = $('button', 'btn ghost', 'Back to table'); r.onclick = () => { this.click(); this._close(m); resolve({ action: 'resume' }); }; btns.appendChild(r); }
      const fine = $('div', 'fine', 'A fan-made digital tribute. Not affiliated with or endorsed by the publishers of 7 Wonders Duel. All artwork, models and music are generated procedurally in your browser.');
      w.append(opts, btns, fine); p.appendChild(w);
      const m = this._open(p);
    });
  }

  // ---------------------------------------------------------------- pause
  pause() {
    return new Promise(resolve => {
      const p = $('div', 'panel'); p.style.minWidth = 'min(420px,90vw)';
      p.innerHTML = '<h2>Paused</h2>';
      const col = $('div', 'row'); col.style.flexDirection = 'column'; col.style.alignItems = 'stretch';
      const b = (t, a, cls = '') => { const x = $('button', 'btn ' + cls, t); x.onclick = () => { this.click(); this._close(m); resolve(a); }; col.appendChild(x); };
      b('Resume', 'resume'); b('Settings', 'settings', 'ghost'); b('How to play', 'rules', 'ghost'); b('Restart duel', 'restart', 'ghost'); b('Quit to title', 'quit', 'ghost');
      p.appendChild(col);
      const m = this._open(p, { esc: () => { this._close(m); resolve('resume'); } });
    });
  }

  // ---------------------------------------------------------------- settings
  settings(prefs, onChange) {
    return new Promise(resolve => {
      const p = $('div', 'panel'); p.innerHTML = '<h2>Settings</h2>';
      const opts = $('div', 'opts');
      const row = (label, el) => addRow(opts, label, el);
      row('Graphics', this.seg([['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], prefs.quality, v => { prefs.quality = v; onChange?.('quality', v); savePrefs(prefs); }));
      row('Animation', this.seg([[1, 'Normal'], [1.6, 'Fast'], [2.6, 'Very fast']], prefs.speed, v => { prefs.speed = +v; onChange?.('speed', +v); savePrefs(prefs); }));
      const slider = (key, label) => { const r = $('input'); r.type = 'range'; r.min = 0; r.max = 1; r.step = 0.01; r.value = prefs[key]; r.oninput = () => { prefs[key] = +r.value; onChange?.(key, +r.value); savePrefs(prefs); }; row(label, r); };
      slider('master', 'Master volume'); slider('music', 'Music'); slider('sfx', 'Effects');
      p.appendChild(opts);
      const b = $('div', 'row'); const ok = $('button', 'btn', 'Done'); ok.onclick = () => { this.click(); this._close(m); resolve(); }; b.appendChild(ok); p.appendChild(b);
      const m = this._open(p, { esc: () => { this._close(m); resolve(); } });
    });
  }

  // ---------------------------------------------------------------- rules
  rules() {
    return new Promise(resolve => {
      const p = $('div', 'panel'); p.style.maxWidth = 'min(1000px,95vw)';
      const legend = Object.entries({ brown: 'Raw materials', grey: 'Manufactured goods', blue: 'Civilian · VP', green: 'Science', yellow: 'Commerce', red: 'Military', purple: 'Guilds' }).map(([c, t]) => `<span><i style="background:${COLOR_HEX[c]}"></i>${t}</span>`).join('');
      p.innerHTML = `<h2>How to play</h2><div class="rules">
        <h3>The goal</h3><p>Build the greatest city over three Ages — or win instantly by <b>military supremacy</b> (push the pawn into your rival's capital) or <b>scientific supremacy</b> (six different science symbols). Otherwise the player with the most victory points after Age III wins.</p>
        <h3>Your turn</h3><p>Take one <b>uncovered</b> card from the pyramid and either:</p>
        <ul><li><b>Construct</b> it — pay its cost. Resources are never spent: your production is used again and again. Missing resources are bought from the bank for <b>2 coins + the number your rival produces</b> of that resource from brown/grey cards.</li>
        <li><b>Discard</b> it for <b>2 coins + 1 per yellow card</b> you own.</li>
        <li>Use it to <b>build a Wonder</b> — the card is tucked under the wonder. Only 7 Wonders may be built in total.</li></ul>
        <h3>Chains</h3><p>A card showing a white symbol lets you build the later card carrying the same symbol for <b>free</b>.</p>
        <h3>Military</h3><p>Every shield pushes the conflict pawn one step toward your rival. Crossing the looting thresholds makes the rival lose <b>2</b> then <b>5</b> coins. Ending the game with the pawn on your side scores 2 / 5 / 10 VP by zone.</p>
        <h3>Science</h3><p>Two identical symbols earn a <b>Progress token</b> of your choice from the board. Six different symbols win the game immediately.</p>
        <h3>Wonders &amp; tokens</h3><p>Hover any wonder or token to read what it does. Some wonders let you play again, destroy a rival card, or revive a discarded one.</p>
        <h3>End scoring</h3><p>Military zone + building VP + wonders + tokens + <b>1 VP per 3 coins</b>. Tie: most blue-card VP.</p>
        <h3>Card colours</h3><div class="legend">${legend}</div>
        <h3>Controls</h3>${isTouch()
    ? `<ul><li><b>Tap</b> a glowing card to select it, then choose an action in the bar that appears.</li><li><b>Press and hold</b> a card, wonder or token to read what it does.</li><li><b>Drag</b> to orbit · <b>pinch</b> to zoom · <b>two fingers</b> to pan.</li><li>The buttons along the screen edge switch camera views, open the log and the menu. <b>Tap a player's panel</b> to see their science, resources and progress tokens.</li></ul></div>`
    : `<ul><li><b>Click</b> a glowing card to select it, then choose an action in the dock (keys <kbd>B</kbd> <kbd>D</kbd> <kbd>W</kbd>).</li><li><b>Drag</b> to orbit · <b>right-drag</b> to pan · <b>wheel</b> to zoom.</li><li><kbd>1</kbd>–<kbd>6</kbd> camera views · <kbd>L</kbd> log · <kbd>M</kbd> mute · <kbd>Esc</kbd> menu.</li></ul></div>`}`;
      const b = $('div', 'row'); const ok = $('button', 'btn', 'To the table'); ok.onclick = () => { this.click(); this._close(m); resolve(); }; b.appendChild(ok); p.appendChild(b);
      const m = this._open(p, { esc: () => { this._close(m); resolve(); } });
    });
  }

  // ---------------------------------------------------------------- starter
  starter(age, chooserName, names, chooserIdx) {
    return new Promise(resolve => {
      const p = $('div', 'panel'); p.style.textAlign = 'center';
      p.innerHTML = `<h2>Age ${['', 'I', 'II', 'III'][age]} awaits</h2><p><b>${chooserName}</b> has the weaker military position and decides who begins the new Age.</p>`;
      const r = $('div', 'row');
      [chooserIdx, 1 - chooserIdx].forEach(i => { const b = $('button', 'btn', i === chooserIdx ? `${names[i]} begins` : `${names[i]} begins`); b.onclick = () => { this.click(); this._close(m); resolve(i); }; r.appendChild(b); });
      p.appendChild(r);
      const m = this._open(p);
    });
  }

  // ---------------------------------------------------------------- discard picker (Mausoleum)
  revive(ids, title = 'The Mausoleum', sub = 'Choose a discarded card to build for free') {
    return new Promise(resolve => {
      const p = $('div', 'panel'); p.style.textAlign = 'center';
      p.innerHTML = `<h2>${title}</h2><p>${sub}</p>`;
      const pk = $('div', 'picker');
      ids.forEach(id => {
        const d = $('div', 'pick'); const img = new Image(); img.src = cardURL(CARD[id], 0.36); img.width = 184; d.appendChild(img);
        d.onclick = () => { this.audio?.play('select'); this._close(m); resolve(id); };
        pk.appendChild(d);
      });
      p.appendChild(pk);
      const m = this._open(p);
    });
  }

  // ---------------------------------------------------------------- game over
  gameOver(state, { names, viewer = 0, mode = 'ai' } = {}) {
    return new Promise(resolve => {
      const w = state.winner;
      const p = $('div', 'panel');
      const title = w.kind === 'military' ? 'Military Supremacy' : w.kind === 'science' ? 'Scientific Supremacy' : w.kind === 'draw' ? 'A Shared Legacy' : 'Civilian Victory';
      const you = w.player !== null && names[w.player] === 'You';
      const who = w.player === null ? 'The duel ends in a perfect tie' : you ? 'You triumph' : `${names[w.player]} triumphs`;
      const youWon = w.player === viewer;
      p.innerHTML = `<div class="verdict">${title}</div><div class="vsub">${who}${mode === 'ai' && w.player !== null ? (youWon ? ' — glory is yours!' : ' — your rival prevails.') : '.'}</div>`;
      const s = state.final || null;
      if (s) {
        const rows = [['Military', 'military'], ['Civilian (blue)', 'blue'], ['Science (green)', 'green'], ['Commerce (yellow)', 'yellow'], ['Guilds (purple)', 'purple'], ['Wonders', 'wonders'], ['Progress tokens', 'tokens'], ['Treasury (3 coins = 1 VP)', 'coins']];
        let h = `<table class="score"><tr><th></th><th class="c0">${names[0]}</th><th class="c1">${names[1]}</th></tr>`;
        for (const [l, k] of rows) { const a = s[0][k], b = s[1][k]; h += `<tr><td>${l}</td><td class="${a > b ? 'lead' : ''}">${a}</td><td class="${b > a ? 'lead' : ''}">${b}</td></tr>`; }
        h += `<tr class="total"><td>Total</td><td class="${w.player === 0 ? 'win' : ''}">${s[0].total}</td><td class="${w.player === 1 ? 'win' : ''}">${s[1].total}</td></tr></table>`;
        p.insertAdjacentHTML('beforeend', h);
      } else {
        p.insertAdjacentHTML('beforeend', `<p style="text-align:center">${w.kind === 'military' ? 'The conflict pawn has reached the capital gates.' : 'Six different sciences bring enlightenment to the winner\'s people.'}</p>`);
      }
      const r = $('div', 'row');
      const again = $('button', 'btn', 'Play again'); again.onclick = () => { this.click(); this._close(m); resolve('again'); };
      const look = $('button', 'btn ghost', 'Admire the table'); look.onclick = () => { this.click(); this._close(m); resolve('close'); };
      const menu = $('button', 'btn ghost', 'Title screen'); menu.onclick = () => { this.click(); this._close(m); resolve('menu'); };
      r.append(again, look, menu); p.appendChild(r);
      const m = this._open(p);
    });
  }
}
