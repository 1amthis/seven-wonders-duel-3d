// DOM heads-up display: player cartouches, age banner, action dock, tooltips, log and toolbar.
import { iconHTML, icon, iconImg, tokenURL } from './icons.js';
import { CARD, WONDER, TOKEN, SCIENCE, RES } from '../engine/data.js';
import { score, citySummary, builtWonders, totalBuiltWonders } from '../engine/rules.js';
import { SCI_NAME } from '../engine/describe.js';

const $ = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const ROMAN = ['', 'I', 'II', 'III'];

// Phones in either orientation. Keep in sync with the "compact" media query in hud.css.
export const COMPACT_MQ = '(max-width:720px), (max-height:500px)';
export const isCompact = () => matchMedia(COMPACT_MQ).matches;
/** True on devices whose main pointer is a finger: there is no hover, so tooltips come from a press-and-hold. */
export const isTouch = () => matchMedia('(pointer:coarse)').matches;

export class HUD {
  constructor(root, handlers) {
    this.root = root; this.h = handlers;
    this.els = {};
    this.build();
  }

  build() {
    const r = this.root; r.innerHTML = '';
    // ---- top bar
    const top = $('div', 'topbar');
    this.els.p = [0, 1].map(i => {
      const el = $('div', `pcard p${i}`);
      el.innerHTML = `
        <div class="pc-head"><div class="emblem"></div><div class="pc-name"></div><div class="pc-net" role="status"></div><div class="pc-turn">TO PLAY</div></div>
        <div class="pc-stats">
          <div class="stat coins" title="Coins (3 coins = 1 VP at the end)"><span class="si"></span><b>0</b></div>
          <div class="stat vp" title="Victory points right now"><span class="si"></span><b>0</b></div>
          <div class="stat shield" title="Shields on military buildings"><span class="si"></span><b>0</b></div>
          <div class="stat wonders" title="Wonders built"><span class="si"></span><b>0</b></div>
        </div>
        <div class="pc-more"><div class="pc-sci"></div><div class="pc-prod"></div><div class="pc-tok"></div></div>`;
      el.addEventListener('click', () => { const open = !el.classList.contains('open'); this.els.p.forEach(p => p.classList.remove('open')); el.classList.toggle('open', open); });
      el.querySelector('.coins .si').innerHTML = iconHTML('coin', 26);
      el.querySelector('.vp .si').innerHTML = iconHTML('vp', 26);
      el.querySelector('.shield .si').innerHTML = iconHTML('shield', 24);
      el.querySelector('.wonders .si').innerHTML = iconHTML('pyramid', 24);
      return el;
    });
    const center = $('div', 'pc-center');
    center.innerHTML = `<div class="age-roman"></div><div class="age-name"></div><div class="age-sub"></div>`;
    this.els.center = center;
    top.append(this.els.p[0], center, this.els.p[1]);
    r.appendChild(top);

    // ---- banner
    this.els.banner = $('div', 'banner'); r.appendChild(this.els.banner);
    // ---- toast (hint line)
    this.els.hint = $('div', 'hint'); r.appendChild(this.els.hint);
    // ---- dock
    this.els.dock = $('div', 'dock hidden'); r.appendChild(this.els.dock);
    // ---- tooltip
    this.els.tip = $('div', 'tip hidden'); r.appendChild(this.els.tip);
    // ---- log
    this.els.log = $('div', 'log'); r.appendChild(this.els.log);
    this.els.ticker = $('div', 'ticker'); r.appendChild(this.els.ticker);
    // ---- toolbar
    const tb = $('div', 'toolbar');
    const btn = (id, label, title) => { const b = $('button', 'tbtn', label); b.title = title; b.dataset.id = id; b.addEventListener('click', () => { this.h.onTool?.(id); }); return b; };
    tb.append(
      btn('overview', '◎', 'Overview camera (1)'), btn('structure', '▦', 'Card pyramid (2)'), btn('mine', '⌂', 'Your city (3)'), btn('rival', '⚑', "Rival's city (4)"),
      btn('wonders', '✦', 'Wonders (5)'), btn('military', '⚔', 'Military track (6)'), btn('log', '≡', 'Toggle event log (L)'), btn('photo', '📷', 'Save a screenshot of the table (P)'),
      btn('sound', '♪', 'Sound on/off (M)'), btn('menu', '☰', 'Menu (Esc)'));
    r.appendChild(tb); this.els.toolbar = tb;

    // The cartouche drawers close when anything else is touched.
    if (!this._outside) {
      this._outside = e => { if (!e.target.closest?.('.pcard')) this.els.p?.forEach(p => p.classList.remove('open')); };
      addEventListener('pointerdown', this._outside);
    }
    // Phone layouts hang the hint, ticker, log and tooltip off the bottom of the top bar, whose height depends on the screen.
    if (window.ResizeObserver) { this._ro?.disconnect(); this._ro = new ResizeObserver(() => { this.topH = Math.ceil(top.getBoundingClientRect().bottom); r.style.setProperty('--top-h', this.topH + 'px'); }); this._ro.observe(top); }
  }

  // ------------------------------------------------------------------ state
  setNames(names, humans) {
    this.names = names;
    this.els.p.forEach((el, i) => {
      el.querySelector('.pc-name').textContent = names[i];
      const em = el.querySelector('.emblem'); em.textContent = names[i].trim()[0]?.toUpperCase() || '?';
      el.classList.toggle('ai', !humans[i]);
    });
  }
  /** Online: show that the other player is slow ('slow') or gone for now ('off'); '' clears it. */
  setPeerStatus(seat, status) {
    const el = this.els.p[seat]; if (!el) return;
    el.classList.toggle('net-slow', status === 'slow');
    el.classList.toggle('net-off', status === 'off');
    el.querySelector('.pc-net').textContent = status === 'slow' ? 'SLOW' : status === 'off' ? 'OFFLINE' : '';
  }
  setActive(p) { this.els.p.forEach((el, i) => el.classList.toggle('active', i === p)); }

  update(state) {
    this.state = state;
    const c = this.els.center;
    c.querySelector('.age-roman').textContent = state.age ? 'AGE ' + ROMAN[state.age] : 'THE DRAFT';
    c.querySelector('.age-name').textContent = state.age ? ['', 'The Dawn of Cities', 'The Age of Merchants', 'The Age of Empires'][state.age] : 'Choose your wonders';
    const left = state.structure.filter(s => !s.taken).length;
    c.querySelector('.age-sub').innerHTML = state.age ? `${left} cards left · ${totalBuiltWonders(state)}/7 wonders` : '';
    state.players.forEach((pl, i) => {
      const el = this.els.p[i];
      const sc = score(state, i), sum = citySummary(state, i);
      this._num(el.querySelector('.coins b'), pl.coins);
      this._num(el.querySelector('.vp b'), sc.total);
      this._num(el.querySelector('.shield b'), sum.shields);
      this._num(el.querySelector('.wonders b'), builtWonders(state, i));
      // science
      const sci = el.querySelector('.pc-sci'); sci.innerHTML = '';
      for (const s of [...SCIENCE, 'law']) {
        const n = sum.science[s] || 0;
        const w = $('span', 'sci' + (n ? ' on' : '') + (n > 1 ? ' pair' : '')); w.title = SCI_NAME[s] + (n ? ` ×${n}` : ''); w.appendChild(iconImg(s, 24));
        if (n > 1) w.appendChild($('i', 'cnt', n));
        sci.appendChild(w);
      }
      // production
      const prod = el.querySelector('.pc-prod'); prod.innerHTML = '';
      for (const r of RES) if (sum.prod.fixed[r]) { const w = $('span', 'res'); w.title = `${sum.prod.fixed[r]} ${r}`; w.appendChild(iconImg(r, 22)); w.appendChild($('b', '', sum.prod.fixed[r])); prod.appendChild(w); }
      for (const ch of sum.prod.choices) { const w = $('span', 'res choice'); w.title = 'One of: ' + ch.opts.join(' / '); ch.opts.forEach((o, k) => { w.appendChild(iconImg(o, 17)); }); prod.appendChild(w); }
      // trade
      const trade = new Set(); for (const id of pl.cards) (CARD[id].fx.trade || []).forEach(r => trade.add(r));
      if (trade.size) { const w = $('span', 'res trade'); w.title = 'Buy at 1 coin: ' + [...trade].join(', '); trade.forEach(r => w.appendChild(iconImg(r, 17))); w.appendChild($('b', '', '1¢')); prod.appendChild(w); }
      // tokens
      const tk = el.querySelector('.pc-tok'); tk.innerHTML = '';
      for (const t of pl.tokens) { const im = new Image(); im.src = tokenURL(t, 44); im.width = 30; im.height = 30; im.title = TOKEN[t].name + ' — ' + TOKEN[t].text; im.className = 'tok'; tk.appendChild(im); }
    });
  }
  _num(el, v) { if (el.textContent !== String(v)) { el.textContent = v; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); } }

  toast(text) { this.log(text, 'sys'); const t = this.els.ticker; t.innerHTML = text; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), 2200); }

  // ------------------------------------------------------------------ banner / hint / log
  banner(title, sub = '', ms = 2600, cls = '') {
    const b = this.els.banner;
    b.className = 'banner ' + cls; b.innerHTML = `<div class="b-title">${title}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    void b.offsetWidth; b.classList.add('show');
    clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove('show'), ms);
    return new Promise(res => setTimeout(res, Math.min(ms, 900)));
  }
  hint(text, who = -1) {
    const h = this.els.hint;
    if (!text) { h.classList.remove('show'); return; }
    h.className = 'hint show' + (who >= 0 ? ' who' + who : ''); h.innerHTML = text;
  }
  log(html, cls = '') {
    const line = $('div', 'logline ' + cls, html);
    this.els.log.appendChild(line);
    while (this.els.log.children.length > 60) this.els.log.firstChild.remove();
    this.els.log.scrollTop = 1e6;
    line.classList.add('fresh'); setTimeout(() => line.classList.remove('fresh'), 7000);
    if (cls !== 'sys') {
      const t = this.els.ticker; t.innerHTML = html; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
      clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), 3800);
    }
  }
  toggleLog() { const open = this.els.log.classList.toggle('open'); this.root.classList.toggle('logopen', open); }

  // ------------------------------------------------------------------ tooltip
  showTip(node, px) {
    const t = this.els.tip;
    t.innerHTML = ''; t.appendChild(node); t.classList.remove('hidden'); t.classList.toggle('wide', !!node.dataset.wide);
    this._placeTip(px);
  }
  moveTip(px) { if (!this.els.tip.classList.contains('hidden')) this._placeTip(px); }
  _placeTip(px) {
    const t = this.els.tip, W = innerWidth, H = innerHeight, r = t.getBoundingClientRect();
    let x, y;
    if (isCompact()) {
      // A finger hides what is under it and a phone has no room beside it: centre the tip and park it in the half of
      // the screen the finger is not in, clear of the top bar and of the toolbar when that is a bar along the bottom.
      const tb = this.els.toolbar.getBoundingClientRect();
      const floor = tb.width > W * 0.5 ? tb.top - 8 : H - 8, ceil = (this.topH || 60) + 6;
      x = (W - r.width) / 2;
      const hr = this.els.hint.getBoundingClientRect(), hintBelowBar = this.els.hint.classList.contains('show') && hr.bottom < H * 0.5 ? hr.bottom + 6 : ceil; // the phone hint hangs under the top bar
      y = px.y < H * 0.5 ? floor - r.height : hintBelowBar;
      y = Math.max(ceil, Math.min(floor - r.height, y));
    } else {
      x = px.x + 26; y = px.y - r.height / 2;
      if (x + r.width > W - 12) x = px.x - r.width - 26;
      y = Math.max(96, Math.min(H - r.height - 12, y));
    }
    x = Math.max(8, Math.min(W - r.width - 8, x));
    t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  hideTip() { this.els.tip.classList.add('hidden'); }

  // ------------------------------------------------------------------ dock
  hideDock() { this.els.dock.classList.add('hidden'); this.els.dock.innerHTML = ''; this.root.classList.remove('docked'); }
  showDock(spec) {
    const d = this.els.dock; d.innerHTML = ''; this.root.classList.add('docked');
    const head = $('div', 'dk-head');
    head.innerHTML = `<div class="dk-name">${spec.title}</div><div class="dk-sub">${spec.subtitle || ''}</div>`;
    const x = $('button', 'dk-x', '✕'); x.title = 'Deselect (Esc)'; x.onclick = spec.onCancel; head.appendChild(x);
    const row = $('div', 'dk-row');
    const mk = (cls, icoHTML, label, sub, ok, on, key) => {
      const b = $('button', 'dk-btn ' + cls + (ok ? '' : ' off'));
      b.innerHTML = `<div class="dk-ico">${icoHTML}</div><div class="dk-lab"><b>${label}</b><span>${sub}</span></div>${key ? `<kbd>${key}</kbd>` : ''}`;
      b.onclick = () => { if (ok) on(); else this.h.onDenied?.(); };
      return b;
    };
    const B = spec.build;
    row.appendChild(mk('build', iconHTML('pillar', 34), 'Construct', B.sub, B.ok, spec.onBuild, 'B'));
    const D = spec.discard;
    row.appendChild(mk('disc', iconHTML('coin', 34, { text: '+' + D.gain }), 'Discard', `Gain ${D.gain} coin${D.gain > 1 ? 's' : ''}`, true, spec.onDiscard, 'D'));
    const wb = mk('wond', iconHTML('pyramid', 34), 'Wonder', spec.wonders.some(w => w.ok) ? 'Choose which ▾' : (spec.wonders.length ? 'None affordable' : 'None left'), spec.wonders.some(w => w.ok), () => {
      d.classList.toggle('wopen');
    }, 'W');
    row.appendChild(wb);
    d.append(head, row);
    // wonder chooser
    const list = $('div', 'dk-wonders');
    spec.wonders.forEach(w => {
      const it = $('button', 'dk-w' + (w.ok ? '' : ' off'));
      it.innerHTML = `<b>${WONDER[w.id].name}</b><span>${w.sub}</span>`;
      it.onclick = () => { if (w.ok) spec.onWonder(w.id); else this.h.onDenied?.(); };
      it.onmouseenter = () => spec.onWonderHover?.(w.id, true); it.onmouseleave = () => spec.onWonderHover?.(w.id, false);
      list.appendChild(it);
    });
    d.appendChild(list);
    d.classList.remove('hidden');
    this.dockSpec = spec;
    d.classList.remove('wopen');
  }
  dockKey(k) {
    const d = this.els.dock; if (d.classList.contains('hidden')) return false;
    const btn = { b: '.dk-btn.build', d: '.dk-btn.disc', w: '.dk-btn.wond' }[k];
    if (btn) { d.querySelector(btn)?.click(); return true; }
    return false;
  }
}
