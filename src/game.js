// Game controller: wires the rules engine, the AI, the 3D view, the HUD and the dialogs together.
import * as THREE from 'three';
import { createGame, apply, computeCost, legalActions, cityCount, totalBuiltWonders, isAccessible, distinctScience, score } from './engine/rules.js';
import { chooseAction } from './engine/ai.js';
import { CARD, WONDER, TOKEN, COLOR_HEX, COLOR_NAME } from './engine/data.js';
import { longEffect, shortEffect, chainInfo, SCI_NAME } from './engine/describe.js';
import { cardCanvas, wonderURL, tokenURL, iconHTML } from './ui/icons.js';
import { ROMAN, isTouch } from './ui/hud.js';
import { hashStr } from './gfx/draw.js';
import { savePrefs } from './ui/dialogs.js';

const nm = (state, p) => `<span class="n${p}">${state.players[p].name}</span>`;
const coinsTxt = n => `${n} coin${n === 1 ? '' : 's'}`;

export class Game {
  constructor({ stage, view, hud, dialogs, audio, prefs }) {
    Object.assign(this, { stage, view, hud, dialogs, audio, prefs });
    this.pickedView = null; this.state = null; this.humans = [true, false]; this.paused = false; this.abort = 0; this.mode = null; this.sel = null; this.running = false;
    view.hoverFilter = info => this.inspectable(info);
    view.liftFilter = info => this.liftable(info);
    view.clickable = info => this.isClickable(info);
    view.onHover = (info, px, still) => this.onHover(info, px, still);
    view.onPick = info => this.onPick(info);
    stage.onClick = () => { if (this.dialogOpen()) return; view.handleClick(); };
    addEventListener('keydown', e => this.onKey(e));
    hud.h.onTool = id => this.tool(id);
    hud.h.onDenied = () => this.audio?.play('error');
    this.orbitT = 0;
    this.initGovernor();
    stage.frameCbs.push((dt, t) => { if (this.orbit) { stage.goal.yaw = 0.5 * Math.sin(t * 0.11); stage.goal.pitch = 0.5 + 0.12 * Math.sin(t * 0.07); } });
  }

  /** Adaptive quality: if the frame rate stays low for two consecutive 5 s windows, step the graphics quality down. */
  initGovernor() {
    let frames = 0, t0 = performance.now(), slow = 0, steps = 0;
    this.stage.frameCbs.push(() => {
      if (document.hidden || !this.running || this.dialogOpen()) { frames = 0; t0 = performance.now(); return; }
      frames++;
      const now = performance.now();
      if (now - t0 < 5000) return;
      const fps = frames / ((now - t0) / 1000);
      frames = 0; t0 = now;
      slow = fps < 22 ? slow + 1 : 0;
      if (slow >= 2 && steps < 2 && this.prefs.quality !== 'low') {
        this.prefs.quality = this.prefs.quality === 'high' ? 'medium' : 'low';
        this.stage.setQuality(this.prefs.quality); savePrefs(this.prefs);
        this.hud.toast(`Graphics set to ${this.prefs.quality} for smoother play (change it in Settings)`);
        slow = 0; steps++;
      }
    });
  }

  /** The camera view the game returns to between moves: whatever the player picked, else the whole table (desktop and
   *  landscape) or the card pyramid (portrait, where the whole table would be a strip of unreadable 12px cards). */
  get baseView() { return this.pickedView || (this.stage.portrait ? 'structure' : 'overview'); }
  dialogOpen() { return this.dialogs.overlay.children.length > 0; }
  viewer() { const s = this.state; return this.humans[0] && this.humans[1] ? (s?.pending?.player ?? 0) : 0; }
  sleep(ms) { return this.view.tweens.wait(ms / 1000); }

  // ================================================================== lifecycle
  applyPrefs() {
    const p = this.prefs, a = this.audio;
    a?.setVolume(p.master); a?.setMusicVolume(p.music); a?.setSfxVolume(p.sfx); a?.setMuted(!!p.muted);
    this.view.tweens.speed = p.speed;
    this.stage.setQuality(p.quality);
    document.querySelector('.tbtn[data-id=sound]')?.classList.toggle('on', !p.muted);
  }

  async showTitle() {
    this.abort++;
    this.hud.hideDock(); this.hud.hint(''); this.hud.hideTip(); this.view.clearGlows(); this.view.select(null);
    document.getElementById('hud').style.opacity = 0;
    // demo table behind the title
    const demo = createGame({ seed: (Math.random() * 1e9) | 0, names: ['A', 'B'] });
    while (demo.pending.type === 'draft') apply(demo, chooseAction(demo));
    for (let i = 0; i < 26 && !demo.winner; i++) apply(demo, chooseAction(demo));
    this.view.newGame(demo);
    await this.view.syncAll(demo, { instant: true });
    this.stage.goto('cinematic', { snap: true });
    this.orbit = true;
    this.audio?.init(); this.audio?.setMood?.('menu'); this.audio?.startMusic?.('menu');
    const r = await this.dialogs.mainMenu(this.prefs, { canResume: false });
    savePrefs(this.prefs);
    this.orbit = false;
    document.getElementById('hud').style.opacity = 1;
    if (r.action === 'play') this.startMatch();
  }

  async startMatch() {
    const my = ++this.abort;
    const pf = this.prefs;
    const seed = pf.seed ? (/^\d+$/.test(pf.seed) ? +pf.seed : hashStr(pf.seed)) : (Math.random() * 1e9) | 0;
    this.seed = seed;
    this.humans = pf.mode === 'ai' ? [true, false] : pf.mode === 'spec' ? [false, false] : [true, true];
    const names = pf.mode === 'spec' ? ['Athens', 'Sparta'] : [pf.name || 'You', pf.rival || (pf.mode === 'ai' ? 'Rival' : 'Player 2')];
    const first = pf.first === 'me' ? 0 : pf.first === 'rival' ? 1 : undefined;
    const state = this.state = createGame({ seed, names, mode: pf.mode, first });
    if (new URLSearchParams(location.search).get('scenario')) { // QA hook: deterministic wonder pool that exercises every interactive effect
      state.wonderPool = ['circus_maximus', 'mausoleum', 'great_library', 'statue_of_zeus', 'appian_way', 'hanging_gardens', 'sphinx', 'piraeus'];
      state.draft.pool = state.wonderPool.slice(0, 4);
    }
    this.hud.setNames(names, this.humans);
    this.hud.els.log.innerHTML = '';
    this.view.newGame(state);
    this.hud.update(state);
    this.applyPrefs();
    this.audio?.startMusic?.('calm'); this.audio?.setMood?.('calm');
    this.stage.goto('cinematic', { snap: true });
    this.orbit = false;
    this.stage.goto('draft');
    this.hud.log(`— The duel begins · seed ${seed} —`, 'sys');
    await this.hud.banner('THE DRAFT', `${state.players[state.current].name} chooses first`, 2600);
    await this.view.syncAll(state);
    this.running = true;
    await this.loop(my);
  }

  async loop(my) {
    const st = this.state;
    while (!st.winner && my === this.abort) {
      const pend = st.pending;
      const actor = pend.player;
      this.hud.setActive(actor); this.hud.update(st); this.view.setActivePlayer(actor);
      this.updateMood();
      let action;
      if (this.humans[actor]) action = await this.askHuman(pend, my); else action = await this.askAI(pend, my);
      if (my !== this.abort) return;
      while (this.paused) await this.sleep(150);
      const events = apply(st, action);
      this.narrate(events, st);
      const banner = this.banners(events, st);
      await this.view.play(events, st);
      await banner;
      if (my !== this.abort) return;
      this.hud.update(st);
      if (this.stage.viewName !== this.baseView && st.pending && st.pending.type !== 'draft') this.stage.goto(this.baseView);
    }
    if (my === this.abort && st.winner) await this.finish(my);
  }

  // ================================================================== turn banners / narration
  banners(events, st) {
    let pr = Promise.resolve();
    for (const ev of events) {
      if (ev.t === 'ageEnd') pr = this.hud.banner(`AGE ${ROMAN[ev.age]} COMPLETE`, '', 2000);
      if (ev.t === 'ageStart') { this.audio?.play('ageStart'); pr = this.hud.banner(`AGE ${ROMAN[ev.age]}`, ['', 'The Dawn of Cities', 'The Age of Merchants', 'The Age of Empires'][ev.age], 3200); this.stage.goto(this.baseView); }
      if (ev.t === 'again') pr = Promise.resolve();
    }
    return pr;
  }

  narrate(events, st) {
    const L = (h, c) => this.hud.log(h, c);
    for (const ev of events) {
      switch (ev.t) {
        case 'ageStart': L(`— Age ${ROMAN[ev.age]} begins —`, 'sys'); break;
        case 'draft': L(`${nm(st, ev.player)} chooses <b>${WONDER[ev.wonder].name}</b>`); break;
        case 'build': L(`${nm(st, ev.player)} builds <b style="color:${COLOR_HEX[CARD[ev.card].color]}">${CARD[ev.card].name}</b>${ev.cost.chain ? ' <i>(free by chain)</i>' : ev.cost.coins + ev.cost.trade ? ` for ${coinsTxt(ev.cost.coins + ev.cost.trade)}` : ''}`); break;
        case 'discard': L(`${nm(st, ev.player)} discards a card for ${coinsTxt(ev.coins)}`); break;
        case 'wonder': L(`${nm(st, ev.player)} raises <b>${WONDER[ev.wonder].name}</b>!`); break;
        case 'military': L(`${nm(st, ev.player)} advances the conflict pawn ${ev.n} step${ev.n > 1 ? 's' : ''}`); break;
        case 'loot': L(`${nm(st, ev.player)} is looted for ${coinsTxt(ev.lost)}`); break;
        case 'science': if (ev.count === 2) L(`${nm(st, ev.player)} completes a pair of ${SCI_NAME[ev.symbol]}`); break;
        case 'token': L(`${nm(st, ev.player)} gains the <b>${TOKEN[ev.token].name}</b> token`); break;
        case 'destroy': L(`${nm(st, ev.player)} destroys ${nm(st, ev.victim)}'s <b>${CARD[ev.card].name}</b>`); break;
        case 'revive': L(`${nm(st, ev.player)} rebuilds <b>${CARD[ev.card].name}</b> for free`); break;
        case 'again': L(`${nm(st, ev.player)} plays again`); break;
        case 'wonderLost': L(`<i>${WONDER[ev.wonder].name} is lost — seven wonders stand.</i>`, 'sys'); break;
        case 'starter': L(`${nm(st, ev.first)} will begin the next Age`); break;
        default: break;
      }
    }
  }

  updateMood() {
    const s = this.state; if (!s) return;
    const tense = Math.abs(s.military) >= 6 || distinctScience(s, 0) >= 5 || distinctScience(s, 1) >= 5;
    const m = tense ? 'tense' : 'calm';
    if (m !== this._mood) { this._mood = m; this.audio?.setMood?.(m); }
  }

  // ================================================================== AI
  async askAI(pend, my) {
    const st = this.state;
    const actor = pend.player;
    this.stage.goto(this.baseView);
    this.hud.hint(`<span class="think">${st.players[actor].name} ponders</span>`, actor);
    await this.sleep(pend.type === 'turn' ? 900 : 650);
    let action;
    const t0 = performance.now();
    action = chooseAction(st, { level: this.prefs.level });
    const dt = performance.now() - t0;
    if (pend.type === 'turn') {
      // show which card is being taken
      const id = st.structure[action.slot].card;
      this.view.select(id);
      this.view.setGlow(id, actor ? 0xff8a6a : 0x6ac0ff, 1);
      await this.sleep(700);
      this.view.select(null); this.view.setGlow(id, null, 0);
    } else if (pend.type === 'starter') {
      await this.sleep(500);
    }
    this.hud.hint('');
    return action;
  }

  // ================================================================== human input
  askHuman(pend, my) {
    return new Promise(resolve => {
      this.resolveAction = a => { this.leaveMode(); resolve(a); };
      this.mode = { type: pend.type, pend };
      const st = this.state;
      const actor = pend.player;
      this.view.clearGlows(); this.view.select(null); this.sel = null; this.hud.hideDock();
      const multi = this.humans[0] && this.humans[1];
      const who = multi ? `${st.players[actor].name}: ` : '';
      switch (pend.type) {
        case 'draft':
          this.stage.goto('draft');
          for (const id of st.draft.pool) this.view.setGlow(id, 0xffd36a, 0.85);
          this.hud.hint(`${who}Choose a <b>Wonder</b> · ${isTouch() ? 'press and hold' : 'hover'} to inspect`, actor);
          break;
        case 'turn': this.enterTurn(); break;
        case 'token': case 'library': {
          const lib = pend.type === 'library';
          this.stage.goto(lib ? 'draft' : 'military');
          for (const id of pend.options) { const g = this.view.tokens.get(id); if (g) g.userData.glowT = 1; }
          this.hud.hint(`${who}${lib ? 'Great Library — choose a <b>token</b>' : 'A pair! Choose a <b>Progress token</b>'}`, actor);
          break;
        }
        case 'destroy':
          this.stage.goto(actor === 0 ? 'right' : 'left');
          for (const id of pend.options) this.view.setGlow(id, 0xff4a3a, 0.95);
          this.hud.hint(`${who}Choose a <b>${pend.color === 'grey' ? 'grey' : 'brown'}</b> card to destroy`, actor);
          break;
        case 'revive':
          this.hud.hint(`${who}The Mausoleum stirs…`, actor);
          this.dialogs.revive(pend.options).then(id => this.resolveAction({ type: 'revive', card: id }));
          break;
        case 'starter': {
          this.hud.hint('');
          this.dialogs.starter(st.age + 1, st.players[actor].name, st.players.map(p => p.name), actor).then(first => this.resolveAction({ type: 'starter', first }));
          break;
        }
      }
    });
  }
  leaveMode() {
    this.mode = null; this.sel = null;
    this.view.clearGlows(); this.view.select(null); this.hud.hideDock(); this.hud.hint(''); this.hud.hideTip();
  }

  // ---------------------------------------------------------------- normal turn
  enterTurn() {
    const st = this.state, p = st.pending.player;
    this.stage.goto(this.baseView);
    this.refreshTurnGlows();
    const multi = this.humans[0] && this.humans[1];
    this.hud.hint(`${multi ? st.players[p].name + ': ' : ''}Pick a <b>glowing card</b> from the pyramid`, p);
    this.audio?.play('turn', { vol: 0.5 });
  }
  refreshTurnGlows() {
    const st = this.state, p = st.pending.player;
    this.view.clearGlows();
    st.structure.forEach((s, i) => {
      if (!isAccessible(st, i)) return;
      const c = computeCost(st, p, { kind: 'card', id: s.card });
      this.view.setGlow(s.card, c.affordable ? 0x7fe08a : 0xe0a040, c.affordable ? 0.75 : 0.45);
    });
    if (this.sel != null) {
      const id = st.structure[this.sel].card;
      this.view.setGlow(id, 0xffe08a, 1);
      for (const w of st.players[p].wonders) if (!w.built && !w.lost && totalBuiltWonders(st) < 7 && computeCost(st, p, { kind: 'wonder', id: w.id }).affordable) this.view.setGlow(w.id, 0x8ac6ff, 0.9);
    }
  }
  selectSlot(i) {
    const st = this.state, p = st.pending.player;
    this.sel = i;
    const s = st.structure[i], def = CARD[s.card];
    this.view.select(s.card);
    this.refreshTurnGlows();
    this.audio?.play('select');
    const cost = computeCost(st, p, { kind: 'card', id: def.id });
    const yellow = cityCount(st, p, ['yellow']);
    const costTxt = c => c.chain ? 'Free — chain' : c.total === 0 ? 'Free' : c.affordable ? `Pay ${coinsTxt(c.total)}${c.trade ? ` (${c.trade} trade)` : ''}` : `Need ${c.total - st.players[p].coins} more coin${c.total - st.players[p].coins > 1 ? 's' : ''}`;
    const canW = totalBuiltWonders(st) < 7;
    const wonders = st.players[p].wonders.filter(w => !w.built && !w.lost).map(w => {
      const c = computeCost(st, p, { kind: 'wonder', id: w.id });
      return { id: w.id, ok: canW && c.affordable, sub: c.total === 0 ? 'Free' : c.affordable ? `Pay ${coinsTxt(c.total)}${c.trade ? ` (${c.trade} trade)` : ''}` : `Need ${c.total - st.players[p].coins} more coin${c.total - st.players[p].coins > 1 ? 's' : ''}` };
    });
    this.hud.showDock({
      title: def.name, subtitle: shortEffect(def),
      build: { ok: cost.affordable, sub: costTxt(cost) },
      discard: { gain: 2 + yellow },
      wonders,
      onBuild: () => this.resolveAction({ type: 'build', slot: i }),
      onDiscard: () => this.resolveAction({ type: 'discard', slot: i }),
      onWonder: id => this.resolveAction({ type: 'wonder', slot: i, wonder: id }),
      onWonderHover: (id, on) => { const w = this.view.wonders.get(id); if (w) w.card.hoverTarget = on ? 1 : 0; },
      onCancel: () => this.deselect(),
    });
  }
  deselect() { if (this.mode?.type !== 'turn') return; this.sel = null; this.view.select(null); this.hud.hideDock(); this.refreshTurnGlows(); }

  // ---------------------------------------------------------------- picking
  onPick(info) {
    if (!this.mode || this.dialogOpen()) return;
    const st = this.state, m = this.mode, actor = m.pend.player;
    switch (m.type) {
      case 'draft': if (info?.type === 'wonder' && st.draft.pool.includes(info.id)) { this.resolveAction({ type: 'draft', wonder: info.id }); } break;
      case 'turn': {
        if (!info) { this.deselect(); break; }
        if (info.type === 'card') {
          const o = this.view.cards.get(info.id);
          const i = o && o.zone === 'struct' ? o.slot : -1;
          if (i >= 0 && isAccessible(st, i)) { if (this.sel === i) this.deselect(); else this.selectSlot(i); }
          else if (o && o.zone === 'struct') this.audio?.play('error');
        } else if (info.type === 'wonder' && this.sel != null) {
          const w = st.players[actor].wonders.find(x => x.id === info.id);
          if (w && !w.built && !w.lost && totalBuiltWonders(st) < 7 && computeCost(st, actor, { kind: 'wonder', id: w.id }).affordable) this.resolveAction({ type: 'wonder', slot: this.sel, wonder: w.id });
          else this.audio?.play('error');
        } else if (info.type === 'discard' && this.sel != null) this.resolveAction({ type: 'discard', slot: this.sel });
        break;
      }
      case 'token': case 'library': if (info?.type === 'token' && m.pend.options.includes(info.id)) { this.resolveAction({ type: 'token', token: info.id }); } break;
      case 'destroy': if (info?.type === 'card' && m.pend.options.includes(info.id)) this.resolveAction({ type: 'destroy', card: info.id }); break;
    }
  }

  inspectable(info) {
    if (this.dialogOpen()) return false;
    const v = this.view;
    if (info.type === 'card') { const o = v.cards.get(info.id); return !!(o && o.faceUp && o.root.visible); }
    if (info.type === 'wonder') return !!v.wonders.get(info.id)?.card.root.visible;
    if (info.type === 'token') return !!v.tokens.get(info.id)?.visible;
    if (info.type === 'discard') return true;
    return false;
  }
  liftable(info) {
    const m = this.mode; if (!m) return false;
    if (m.type === 'draft') return info.type === 'wonder';
    if (m.type === 'turn') { if (info.type === 'card') { const o = this.view.cards.get(info.id); return o && o.zone === 'struct' && isAccessible(this.state, o.slot); } return info.type === 'wonder' && this.sel != null; }
    if (m.type === 'destroy') return info.type === 'card' && m.pend.options.includes(info.id);
    return false;
  }
  isClickable(info) {
    const m = this.mode; if (!m) return false;
    if (m.type === 'draft') return info.type === 'wonder';
    if (m.type === 'turn') return this.liftable(info) || (info.type === 'discard' && this.sel != null);
    if (m.type === 'token' || m.type === 'library') return info.type === 'token' && m.pend.options.includes(info.id);
    if (m.type === 'destroy') return info.type === 'card' && m.pend.options.includes(info.id);
    return false;
  }

  // ================================================================== tooltips
  onHover(info, px, still) {
    // A finger has no hover: the tooltip belongs to a press-and-hold (stage.touchHold), never to a plain tap.
    if (!info || this.dialogOpen() || (this.stage.pointerType === 'touch' && !this.stage.touchHold)) { this.hud.hideTip(); return; }
    if (still) { this.hud.moveTip(px); return; }
    const node = this.buildTip(info);
    if (node) this.hud.showTip(node, px); else this.hud.hideTip();
  }
  costHTML(c) {
    if (c.chain) return { ok: true, html: `Free by chain <span class="chain">(${chainInfo({ chainIn: c.plan.chain })[0].from})</span>` };
    if (c.total === 0) return { ok: true, html: 'Free' };
    const buy = c.plan.buy ? Object.entries(c.plan.buy).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${r} @${c.price[r]}`).join(', ') : '';
    return { ok: c.affordable, html: `${coinsTxt(c.total)}${c.trade ? ` — incl. <b>${c.trade}</b> trading (${buy})` : ''}${c.affordable ? '' : ' — <b>not affordable</b>'}` };
  }
  buildTip(info) {
    const st = this.state; if (!st) return null;
    const viewer = this.viewer();
    const d = document.createElement('div'); d.style.display = 'contents';
    if (info.type === 'card') {
      const def = CARD[info.id];
      const wrap = document.createElement('div'); wrap.style.display = 'contents';
      const cv = cardCanvas(def, 0.5);
      const t = document.createElement('div'); t.className = 'tt';
      let html = `<h4>${def.name}</h4><div class="kind">${COLOR_NAME[def.color]} · Age ${ROMAN[def.age]}</div>`;
      html += longEffect(def).map(l => `<p>${l}</p>`).join('');
      for (const c of chainInfo(def)) html += c.kind === 'in' ? `<p class="chain">Free if you own <b>${c.from}</b>.</p>` : `<p class="chain">Chain symbol — builds <b>${c.to.join(', ')}</b> for free.</p>`;
      const o = this.view.cards.get(info.id);
      if (o && (o.zone === 'struct') && st.phase === 'play') {
        const c = computeCost(st, viewer, { kind: 'card', id: def.id }); const h = this.costHTML(c);
        html += `<div class="cost ${h.ok ? 'ok' : 'no'}">${st.players[viewer].name}: ${h.html}</div>`;
        if (!isAccessible(st, o.slot)) html += `<p class="chain">Covered — not yet available.</p>`;
      }
      t.innerHTML = html; wrap.append(cv, t); return wrap;
    }
    if (info.type === 'wonder') {
      const def = WONDER[info.id];
      const w = st.players[0].wonders.concat(st.players[1].wonders).find(x => x.id === info.id);
      const owner = st.players[0].wonders.includes(w) ? 0 : st.players[1].wonders.includes(w) ? 1 : -1;
      const wrap = document.createElement('div'); wrap.className = 'wide'; wrap.style.display = 'contents';
      const box = document.createElement('div'); box.className = 'tipbox';
      const img = new Image(); img.src = wonderURL(info.id, 0.6); img.className = 'big wonder';
      const t = document.createElement('div'); t.className = 'tt';
      let html = `<h4>${def.name}</h4><div class="kind">Wonder · ${def.vp} victory point${def.vp === 1 ? '' : 's'}${owner >= 0 ? ' · ' + st.players[owner].name : ' · Unclaimed'}</div><p>${def.text}</p>`;
      if (w) html += w.built ? `<p class="chain">Built ✔</p>` : w.lost ? `<p class="chain">Lost — seven wonders already stand.</p>` : owner === viewer ? (() => { const c = computeCost(st, owner, { kind: 'wonder', id: info.id }); const h = this.costHTML(c); return `<div class="cost ${h.ok ? 'ok' : 'no'}">Your cost: ${h.html}</div>`; })() : '';
      t.innerHTML = html; box.append(img, t); wrap.appendChild(box);
      wrap.dataset.wide = '1';
      return wrap;
    }
    if (info.type === 'token') {
      const def = TOKEN[info.id];
      const img = new Image(); img.src = tokenURL(info.id, 150); img.className = 'big'; img.width = 130; img.height = 130; img.style.borderRadius = '50%';
      const t = document.createElement('div'); t.className = 'tt';
      t.innerHTML = `<h4>${def.name}</h4><div class="kind">Progress token${def.vp ? ` · ${def.vp} VP` : ''}</div><p>${def.text}</p>`;
      const wrap = document.createElement('div'); wrap.style.display = 'contents'; wrap.append(img, t); return wrap;
    }
    if (info.type === 'discard') {
      const t = document.createElement('div'); t.className = 'tt';
      t.innerHTML = `<h4>Discard pile</h4><div class="kind">${st.discard.length} card${st.discard.length === 1 ? '' : 's'}</div><p>Discarded cards return to play through the Mausoleum.</p>`;
      const wrap = document.createElement('div'); wrap.style.display = 'contents'; wrap.appendChild(t); return wrap;
    }
    return null;
  }

  // ================================================================== toolbar, keys
  tool(id) {
    this.audio?.play('click');
    const s = this.state, v = this.viewer();
    const mine = v === 0 ? 'left' : 'right', rival = v === 0 ? 'right' : 'left';
    const cam = name => { this.pickedView = name; this.stage.goto(name); };
    switch (id) {
      case 'overview': cam('overview'); break;
      case 'structure': cam('structure'); break;
      case 'mine': cam(mine); break;
      case 'rival': cam(rival); break;
      case 'wonders': cam(v === 0 ? 'wondersLeft' : 'wondersRight'); break;
      case 'military': cam('military'); break;
      case 'log': this.hud.toggleLog(); break;
      case 'sound': this.prefs.muted = !this.prefs.muted; this.audio?.setMuted(this.prefs.muted); document.querySelector('.tbtn[data-id=sound]')?.classList.toggle('on', !this.prefs.muted); savePrefs(this.prefs); break;
      case 'photo': this.photo(); break;
      case 'menu': this.pauseMenu(); break;
    }
  }
  /** Save the 3D scene (without the HUD) as a PNG. */
  photo() {
    const st = this.stage;
    st.composer.render(0);
    st.canvas.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `seven-wonders-duel-${Date.now()}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
    this.audio?.play('flip');
    this.hud.toast?.('Screenshot saved');
  }
  async pauseMenu() {
    if (this.dialogOpen()) return;
    this.paused = true;
    const r = await this.dialogs.pause();
    if (r === 'settings') { await this.dialogs.settings(this.prefs, (k, v) => { this.applyPrefs(); }); this.applyPrefs(); return this.pauseMenu(); }
    if (r === 'rules') { await this.dialogs.rules(); return this.pauseMenu(); }
    this.paused = false;
    if (r === 'restart') { this.abort++; this.leaveMode(); this.startMatch(); }
    if (r === 'quit') { this.abort++; this.leaveMode(); this.showTitle(); }
  }
  onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (this.dialogOpen()) return; if (this.mode?.type === 'turn' && this.sel != null) this.deselect(); else this.pauseMenu(); return; }
    if (this.dialogOpen()) return;
    const cams = { 1: 'overview', 2: 'structure', 3: 'mine', 4: 'rival', 5: 'wonders', 6: 'military' };
    if (cams[k]) this.tool(cams[k]);
    else if (k === 'l') this.tool('log');
    else if (k === 'm') this.tool('sound');
    else if (k === 'p') this.tool('photo');
    else if (['b', 'd', 'w'].includes(k)) this.hud.dockKey(k);
  }

  // ================================================================== finale
  async finish(my) {
    const st = this.state, w = st.winner;
    this.leaveMode();
    this.hud.update(st);
    this.hud.log(w.kind === 'draw' ? '— The duel ends in a draw —' : `— ${st.players[w.player].name} wins by ${w.kind === 'civil' ? 'points' : w.kind + ' supremacy'} —`, 'sys');
    this.audio?.setMood?.('triumph');
    const humanWon = w.player !== null && this.humans[w.player];
    await this.hud.banner(w.kind === 'military' ? 'MILITARY SUPREMACY' : w.kind === 'science' ? 'SCIENTIFIC SUPREMACY' : w.kind === 'draw' ? 'A SHARED LEGACY' : 'THE AGES ARE SETTLED', w.player === null ? '' : `${st.players[w.player].name} ${w.kind === 'civil' ? 'wins on points' : 'wins the duel'}`, 3800, w.player === null ? '' : 'p' + w.player);
    await this.view.victoryFx(st, w);
    if (my !== this.abort) return;
    const r = await this.dialogs.gameOver(st, { names: st.players.map(p => p.name), viewer: 0, mode: this.prefs.mode });
    if (r === 'again') this.startMatch();
    else if (r === 'menu') this.showTitle();
    else { this.hud.hint('The table is yours to admire — press <b>Esc</b> for the menu'); }
  }
}
