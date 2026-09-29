// GameView: turns engine state + events into the living 3D table.
import * as THREE from 'three';
import { Tweens, ease } from './tween.js';
import { Textures, CardObj, makeCoinMesh, makeTokenMesh } from './cardobj.js';
import { buildTable, buildMilitaryBoard } from './table.js';
import { buildEnvironment } from './env.js';
import { Particles, makeFloatText, makeShockwave, makePillar } from './fx.js';
import { buildWonderModel, updateWonderModel } from './wonders3d.js';
import * as L from './layout.js';
import { CARD, WONDER, TOKEN, TOKENS, COLOR_HEX, COLORS } from '../engine/data.js';
import { hashStr, rng } from './draw.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const hex3 = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const PI = Math.PI;

export class GameView {
  constructor(stage, audio) {
    this.stage = stage; this.audio = audio; this.scene = stage.scene;
    this.tweens = new Tweens();
    this.tex = new Textures(stage.renderer);
    this.cards = new Map();      // id -> CardObj (buildings)
    this.wonders = new Map();    // id -> WonderView
    this.tokens = new Map();     // id -> token group
    this.pickMeshes = [];
    this.piles = [{ total: 0, meshes: [] }, { total: 0, meshes: [] }];
    this.hovered = null; this.hoverFilter = () => true; this.onHover = null; this.onPick = null;
    this.selected = null;
    this.popups = [];
    this.state = null;
    this.speed = 1;
    this.dealPending = false;    // an ageStart is queued: the pyramid is not laid out until dealAge runs
    this.idleTokenSpin = 0;
  }

  // ------------------------------------------------------------------ world
  init() {
    const { scene, stage } = this;
    this.env = buildEnvironment(scene, stage.renderer);
    this.table = buildTable(this.tex); scene.add(this.table);
    this.board = buildMilitaryBoard(this.tex); scene.add(this.board);
    this.pawn = this.board.userData.pawn;
    this.loot = this.board.userData.lootTokens;
    this.particles = new Particles(scene, stage);
    this.world = new THREE.Group(); scene.add(this.world);
    this.fxGroup = new THREE.Group(); scene.add(this.fxGroup);
    this._buildBank();
    this._ghostMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffd98a) }, uAmp: { value: 1 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform float uTime, uAmp; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); float scan = 0.5 + 0.5 * sin(vW.y * 46.0 - uTime * 3.0);
          float a = (0.018 + f * 0.2 + scan * 0.02) * uAmp; gl_FragColor = vec4(uColor * (0.8 + f * 0.9), a); }`,
    });
    // invisible pick surfaces
    const mk = (x, z, w, d, type) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ visible: false })); m.rotation.x = -PI / 2; m.position.set(x, 0.08, z); m.userData.pick = { type }; this.world.add(m); return m; };
    this.discardZone = mk(L.DISCARD_POS.x, L.DISCARD_POS.z, 1.6, 2.1, 'discard');
    stage.frameCbs.push((dt, t) => this.update(dt, t));
    this.setPawn(0, true);
  }

  _buildBank() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2c14, roughness: 0.6, metalness: 0.1 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b445, metalness: 0.95, roughness: 0.28 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 0.9), wood); base.position.y = 0.28; base.castShadow = base.receiveShadow = true; g.add(base);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.5, 24, 1, false, 0, PI), wood); lid.rotation.z = PI / 2; lid.rotation.y = 0; lid.position.y = 0.55; lid.scale.set(1, 1, 1); lid.castShadow = true;
    lid.rotation.set(0, 0, PI / 2); lid.rotateX(0); g.add(lid);
    for (const x of [-0.6, 0, 0.6]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.94), gold); band.position.set(x, 0.3, 0); g.add(band); }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), gold); lock.position.set(0, 0.52, 0.47); g.add(lock);
    // spilled coins on top
    this.bankGlow = new THREE.PointLight(0xffc36a, 0, 5, 2); this.bankGlow.position.y = 1.2; g.add(this.bankGlow);
    g.position.set(0, 0, 4.55); g.scale.setScalar(0.9);
    this.scene.add(g); this.bank = g;
    this.bankPos = V3(0, 0.7, 4.55);
  }

  // ------------------------------------------------------------------ new game
  newGame(state) {
    for (const o of this.cards.values()) { this.world.remove(o.root); o.dispose(); }
    for (const w of this.wonders.values()) this.world.remove(w.card.root);
    for (const t of this.tokens.values()) this.world.remove(t);
    this.cards.clear(); this.wonders.clear(); this.tokens.clear();
    this.pickMeshes = [this.discardZone];
    this.state = state;
    // wonders
    for (const id of state.wonderPool) this._makeWonder(id);
    // progress tokens
    for (const t of TOKENS) {
      const g = makeTokenMesh(this.tex, t.id); g.visible = false; g.userData.pick = { type: 'token', id: t.id };
      g.userData.disc.userData.pick = { type: 'token', id: t.id };
      g.userData.home = V3(0, 0, 0); g.userData.hoverT = 0;
      this.world.add(g); this.tokens.set(t.id, g); this.pickMeshes.push(g.userData.disc);
    }
    this.setPawn(state.military, true);
    for (const k in this.loot) this.loot[k].visible = true;
    this.setCoins(0, state.players[0].coins, true); this.setCoins(1, state.players[1].coins, true);
  }

  _makeWonder(id) {
    const card = new CardObj('wonder', id, this.tex);
    card.setFaceUp(true);
    card.root.visible = false;
    card.mesh.userData.pick = { type: 'wonder', id };
    this.world.add(card.root); this.pickMeshes.push(card.mesh);
    let solid;
    try { solid = buildWonderModel(id); } catch (e) {
      console.warn('wonder model missing', id, e.message);
      solid = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.35 })); b.position.y = 0.3; solid.add(b);
    }
    const ghost = solid.clone(true);
    ghost.traverse(o => { if (o.isMesh) { o.material = this._ghostMat; o.castShadow = false; o.receiveShadow = false; } });
    solid.visible = false;
    const h = solid.userData.height || 1;
    for (const m of [solid, ghost]) { m.scale.setScalar(0.92); m.position.set(0, 0.04, -0.06); card.root.add(m); }
    // wonder "lifecycle" data
    const wv = { id, card, solid, ghost, built: false, lost: false, height: h, model: 0 };
    solid.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
    this.wonders.set(id, wv);
    return wv;
  }

  cardObj(id) {
    let o = this.cards.get(id);
    if (!o) {
      o = new CardObj('card', id, this.tex, { age: CARD[id].age });
      o.mesh.userData.pick = { type: 'card', id };
      o.place(L.DECK_POS.x, 0.05, L.DECK_POS.z);
      this.world.add(o.root); this.cards.set(id, o); this.pickMeshes.push(o.mesh);
    }
    return o;
  }

  // ------------------------------------------------------------------ targets from state
  locate(state) {
    const T = new Map(), WT = new Map();
    const rows = state.structure.length ? Math.max(...state.structure.map(s => s.row)) + 1 : 0;
    // while an ageStart is still queued the new pyramid belongs to dealAge, not to whatever syncAll runs before it
    state.structure.forEach((s, i) => { if (!s.taken && !this.dealPending) T.set(s.card, { ...L.structureSlotPos(s, rows), yaw: 0, s: L.STRUCT_SCALE, faceUp: s.up, zone: 'struct', slot: i }); });
    state.players.forEach((pl, p) => {
      const byColor = {};
      for (const id of pl.cards) (byColor[CARD[id].color] ||= []).push(id);
      for (const c of Object.keys(byColor)) byColor[c].forEach((id, k) => T.set(id, { ...L.cityCardPos(p, c, k, byColor[c].length), yaw: 0, s: L.CITY.scale, faceUp: true, zone: 'city', p }));
      pl.wonders.forEach((w, idx) => {
        const wp = L.wonderPos(p, idx);
        WT.set(w.id, { ...wp, yaw: 0, s: 1, built: w.built, lost: w.lost, zone: 'slot', p, idx });
        if (w.under) T.set(w.under, { x: wp.x + (idx % 2 ? 0.1 : -0.1), y: wp.y - 0.018, z: wp.z + 0.5, yaw: PI / 2, s: 1, faceUp: false, zone: 'under' });
      });
    });
    const n = state.discard.length;
    state.discard.forEach((id, k) => { const r = rng(hashStr(id)); T.set(id, { x: L.DISCARD_POS.x + (r() - 0.5) * 0.14, y: 0.04 + k * 0.016, z: L.DISCARD_POS.z + (r() - 0.5) * 0.14, yaw: (r() - 0.5) * 0.4, s: 1, faceUp: k >= n - 2, zone: 'discard' }); });
    // draft pool
    state.draft.pool.forEach((id, i) => { if (state.phase === 'draft') WT.set(id, { ...L.wonderPoolPos(i), yaw: 0, s: 1.12, built: false, zone: 'pool' }); });
    return { T, WT };
  }

  moveTo(obj, t, { dur = 0.6, delay = 0, arc = 0.8, e = ease.inOutCubic } = {}) {
    const id = ++obj.animId;
    const p0 = obj.pos.clone(), y0 = obj.yaw, s0 = obj.s, f0 = obj.flipAngle;
    const f1 = t.faceUp ? -PI / 2 : PI / 2;
    let y1 = t.yaw; y1 = y0 + ((y1 - y0 + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;
    if (t.faceUp && obj.kind === 'card') obj.ensureFace();
    const p1 = V3(t.x, t.y, t.z);
    obj.faceUp = t.faceUp;
    if (p0.distanceToSquared(p1) < 1e-6 && Math.abs(f1 - f0) < 1e-4 && Math.abs(y1 - y0) < 1e-4 && Math.abs(t.s - s0) < 1e-4) return Promise.resolve();
    const dist = p0.distanceTo(p1);
    const arcH = arc * Math.min(1, 0.25 + dist * 0.12);
    return this.tweens.run(dur, (k, ek) => {
      if (obj.animId !== id) return;
      obj.pos.lerpVectors(p0, p1, ek); obj.arc = arcH * Math.sin(PI * k);
      obj.yaw = y0 + (y1 - y0) * ek; obj.s = s0 + (t.s - s0) * ek; obj.flipAngle = f0 + (f1 - f0) * ek;
      if (k >= 1) { obj.arc = 0; obj.pos.copy(p1); }
    }, { delay, ease: e });
  }

  /** Bring every object to the place the state says it belongs (idempotent). */
  syncAll(state, { instant = false, stagger = 0 } = {}) {
    this.state = state;
    const { T, WT } = this.locate(state);
    const promises = [];
    let i = 0;
    for (const [id, t] of T) {
      const o = this.cardObj(id);
      o.root.visible = true;
      if (instant) { o.animId++; o.place(t.x, t.y, t.z, t.yaw, t.s); o.setFaceUp(t.faceUp); o.arc = 0; }
      else promises.push(this.moveTo(o, t, { dur: 0.55, delay: stagger * (i++), arc: 0.6 }));
      o.slot = t.slot ?? -1; o.zone = t.zone;
    }
    for (const [id, o] of this.cards) if (!T.has(id)) { o.root.visible = false; }
    // wonders
    for (const [id, w] of this.wonders) {
      const t = WT.get(id);
      if (!t) { w.card.root.visible = false; continue; }
      const o = w.card;
      const wasHidden = !o.root.visible;
      o.root.visible = true; o.zone = t.zone; w.p = t.p; w.idx = t.idx;
      if (instant || wasHidden && t.zone === 'pool') {
        if (wasHidden && !instant) { o.animId++; o.place(t.x, t.y + 5, t.z - 1, 0.6, 0.2); o.setFaceUp(true); promises.push(this.moveTo(o, { ...t, faceUp: true }, { dur: 0.9, delay: 0.12 * (t.zone === 'pool' ? state.draft.pool.indexOf(id) : 0), arc: 0.2, e: ease.outCubic })); }
        else { o.animId++; o.place(t.x, t.y, t.z, t.yaw, t.s); o.setFaceUp(true); }
      } else promises.push(this.moveTo(o, { ...t, faceUp: true }, { dur: 0.75, arc: 0.7 }));
      if (t.built && !w.built) { w.built = true; this._showSolid(w); }
      if (t.lost && !w.lost) { w.lost = true; this._loseWonder(w); }
      w.ghost.visible = !w.built && !t.lost;
    }
    // progress tokens
    this._syncTokens(state, instant);
    // coins
    return Promise.all(promises);
  }

  _syncTokens(state, instant) {
    const lib = state.pending?.type === 'library' ? state.pending.options : [];
    for (const [id, g] of this.tokens) {
      let pos = null, owner = -1;
      const bi = state.board.indexOf(id);
      if (bi >= 0) pos = L.tokenBoardPos(bi);
      state.players.forEach((pl, p) => { const j = pl.tokens.indexOf(id); if (j >= 0) { pos = L.tokenOwnedPos(p, j); owner = p; } });
      const li = lib.indexOf(id);
      if (li >= 0) pos = { x: (li - 1) * 1.7, y: 1.5, z: 0.4 };
      g.userData.state = li >= 0 ? 'library' : owner >= 0 ? 'owned' : bi >= 0 ? 'board' : 'hidden';
      if (!pos) { g.visible = false; continue; }
      const dest = V3(pos.x, pos.y, pos.z);
      const appearing = instant || !g.visible;
      // syncAll runs after every event: only hop tokens whose slot actually changed
      const moved = appearing || !g.userData.home || !g.userData.home.equals(dest);
      if (appearing) { g.position.copy(dest); if (!instant) { g.position.y += 4; } }
      g.visible = true; g.userData.home = dest;
      if (instant) { g.userData.animId = (g.userData.animId || 0) + 1; g.userData.moving = false; }
      else if (moved) this._tweenGroup(g, dest, 0.7);
    }
  }

  _tweenGroup(g, dest, dur, arc = 1.2) {
    const id = g.userData.animId = (g.userData.animId || 0) + 1, p0 = g.position.clone();
    g.userData.moving = true;
    const run = this.tweens.run(dur, (k, e) => { if (g.userData.animId !== id) return; g.position.lerpVectors(p0, dest, e); g.position.y += Math.sin(PI * k) * arc; }, { ease: ease.inOutCubic });
    run.then(() => { if (g.userData.animId === id) g.userData.moving = false; });
    return run;
  }

  // ------------------------------------------------------------------ wonders
  _showSolid(w, animate = false) {
    w.solid.visible = true;
    w.solid.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const S = 0.92;
    if (!animate) { w.solid.scale.setScalar(S); return Promise.resolve(); }
    w.building = true;
    const wp = w.card.pos, H = w.height * S;
    w.solid.scale.set(S, S * 0.02, S);
    return this.tweens.run(1.9, (k, e) => {
      const ky = Math.max(0.02, e);
      w.solid.scale.set(S * (0.9 + 0.1 * Math.min(1, ky)), S * ky, S * (0.9 + 0.1 * Math.min(1, ky)));
      const top = wp.y + 0.04 + H * Math.min(1, ky);
      if (Math.random() < 0.9) this.particles.emit({ pos: [wp.x + (Math.random() - 0.5) * 1.2, top, wp.z + (Math.random() - 0.5) * 0.8], vel: [0, 0.5 + Math.random(), 0], color: [1, 0.85, 0.45], life: 0.9, size: 0.12, gravity: -0.3 });
      w.ghost.visible = k < 0.6;
    }, { ease: ease.outBack }).then(() => { w.solid.scale.setScalar(S); w.building = false; w.ghost.visible = false; });
  }
  _loseWonder(w) {
    w.ghost.visible = false; w.card.setGlow(null, 0);
    const mat = w.card.frontMat; mat.color.set(0x555555);
  }

  // ------------------------------------------------------------------ pawn / coins
  setPawn(pos, instant) {
    const x = L.militaryX(pos);
    this.pawn.userData.pos = pos;
    if (instant) this.pawn.position.x = x;
  }
  async movePawn(from, to, player) {
    const dir = Math.sign(to - from), steps = Math.abs(to - from);
    for (let s = 1; s <= steps; s++) {
      const x0 = L.militaryX(from + dir * (s - 1)), x1 = L.militaryX(from + dir * s);
      this.audio?.play('shield', { pan: x1 / 12 });
      await this.tweens.run(0.42 / this.speed, (k, e) => { this.pawn.position.x = x0 + (x1 - x0) * e; this.pawn.position.y = 0.2 + Math.sin(PI * k) * 0.55; }, { ease: ease.inOutQuad });
      this.pawn.position.y = 0.2;
      this.stage.shake(0.06, 0.2);
      this.particles.burst({ pos: [x1, 0.3, L.BOARD.trackZ], count: 14, color: hex3(player === 0 ? 0x66c2ff : 0xff8a6a), speed: 1.6, spread: 0.6, gravity: 4, life: 0.6, size: 0.1 });
    }
    this.pawn.userData.pos = to;
    this.audio?.play('military', { pan: L.militaryX(to) / 12 });
  }

  _coinBreakdown(total) { const n6 = Math.floor(total / 6), r = total % 6; return [n6, Math.floor(r / 3), r % 3]; }
  setCoins(p, total, instant = false) {
    const pile = this.piles[p];
    pile.total = total;
    for (const m of pile.meshes) this.world.remove(m);
    pile.meshes = [];
    const counts = this._coinBreakdown(total);
    const kinds = [['gold', 6], ['silver', 3], ['bronze', 1]];
    counts.forEach((n, slot) => {
      const [kind, val] = kinds[slot];
      const c = L.treasuryPos(p, slot);
      for (let i = 0; i < Math.min(n, 14); i++) {
        const m = makeCoinMesh(this.tex, kind, val);
        const r = rng(p * 977 + slot * 131 + i);
        m.position.set(c.x + (r() - 0.5) * 0.05, 0.03 + m.userData.thickness / 2 + i * m.userData.thickness * 1.02, c.z + (r() - 0.5) * 0.05);
        m.rotation.y = r() * 6;
        this.world.add(m); pile.meshes.push(m);
        if (!instant && i === n - 1) { m.scale.setScalar(0.01); this.tweens.run(0.3, (k, e) => m.scale.setScalar(0.01 + 0.99 * e), { ease: ease.outBack }); }
      }
    });
  }
  pileTop(p) { const c = L.treasuryPos(p, 1); return V3(c.x, 0.5, c.z); }

  /** coins flying between two world points */
  flyCoins(from, to, n, { delay = 0, kind = 'gold', dur = 0.7 } = {}) {
    const ps = [];
    const count = Math.max(1, Math.min(9, n));
    for (let i = 0; i < count; i++) {
      const m = makeCoinMesh(this.tex, kind, kind === 'gold' ? 6 : kind === 'silver' ? 3 : 1);
      m.castShadow = false; m.position.copy(from); m.visible = false; this.fxGroup.add(m);
      const a = Math.random() * PI * 2, spread = 0.3;
      const mid = from.clone().lerp(to, 0.5); mid.y += 1.6 + Math.random() * 0.8; mid.x += Math.cos(a) * spread; mid.z += Math.sin(a) * spread;
      const spin = 4 + Math.random() * 6;
      ps.push(this.tweens.run(dur, (k, e) => {
        m.visible = true;
        const a1 = from.clone().lerp(mid, e), b1 = mid.clone().lerp(to, e);
        m.position.copy(a1.lerp(b1, e)); m.rotation.x = k * spin; m.rotation.z = k * spin * 0.7;
      }, { delay: delay + i * 0.06, ease: ease.inOutQuad }).then(() => {
        this.fxGroup.remove(m);
        this.audio?.play('coin', { pitch: Math.random() * 3, vol: 0.6, pan: to.x / 14 });
        this.particles.burst({ pos: [to.x, to.y, to.z], count: 4, color: [1, 0.85, 0.4], speed: 1, spread: 1, gravity: 5, life: 0.4, size: 0.07 });
      }));
    }
    return Promise.all(ps);
  }

  async coinsEvent(ev) {
    const p = ev.player, d = ev.delta;
    if (!d) return;
    const bank = this.bankPos.clone();
    if (d > 0) {
      const from = ev.reason === 'economy' ? this.pileTop(1 - p) : ev.source != null ? this.pileTop(ev.source) : bank;
      this.bankGlow.intensity = 2; this.tweens.run(0.8, (k) => { this.bankGlow.intensity = 2 * (1 - k); });
      this.audio?.play(d > 4 ? 'coins' : 'coin', { count: Math.min(d, 8), pan: (p ? 1 : -1) * 0.5 });
      await this.flyCoins(from, this.pileTop(p), d, { kind: d >= 6 ? 'gold' : d >= 3 ? 'silver' : 'bronze' });
      this.setCoins(p, ev.total);
      this.popup(`+${d}`, this.pileTop(p).clone().add(V3(0, 0.9, 0)), '#ffe08a');
    } else {
      this.setCoins(p, ev.total, true);
      this.audio?.play('coinloss', { count: Math.min(-d, 6), pan: (p ? 1 : -1) * 0.5 });
      this.popup(`${d}`, this.pileTop(p).clone().add(V3(0, 0.9, 0)), '#ff9a8a');
      const to = ev.reason === 'trade' ? bank : ev.reason === 'loot' ? bank : bank;
      await this.flyCoins(this.pileTop(p), to, -d, { kind: -d >= 6 ? 'gold' : 'silver' });
    }
  }

  popup(text, pos, color = '#ffe9a8', life = 1.5) {
    const sp = makeFloatText(text, { color });
    sp.position.copy(pos); this.fxGroup.add(sp);
    this.tweens.run(life, (k) => { sp.position.y = pos.y + k * 1.4; sp.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; sp.scale.setScalar(1 + 0.2 * Math.sin(Math.min(1, k * 4) * PI / 2)); sp.scale.y *= 0.31; }, { ease: ease.outCubic }).then(() => { this.fxGroup.remove(sp); sp.material.map.dispose(); sp.material.dispose(); });
  }

  shockwave(pos, color = 0xffd36a, r = 3, dur = 0.9) {
    const m = makeShockwave(color); m.position.set(pos.x, (pos.y ?? 0) + 0.06, pos.z); this.fxGroup.add(m);
    return this.tweens.run(dur, (k, e) => { m.scale.setScalar(0.2 + r * e); m.material.opacity = 0.9 * (1 - k); }, { ease: ease.outCubic }).then(() => { this.fxGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }
  pillar(pos, color = 0xffe6a0, h = 7, dur = 1.6) {
    const m = makePillar(color, h); m.position.x = pos.x; m.position.z = pos.z; m.position.y = h / 2; this.fxGroup.add(m);
    return this.tweens.run(dur, (k) => { m.material.opacity = 0.85 * Math.sin(PI * Math.min(1, k * 1.05)); const s = 0.6 + 0.6 * Math.sin(PI * k); m.scale.set(s, 1, s); }, { ease: ease.linear }).then(() => { this.fxGroup.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }

  // ------------------------------------------------------------------ age deal
  async dealAge(state) {
    this.state = state;
    this.dealPending = false;
    const { T } = this.locate(state);
    const ids = [];
    // stack the deck first
    let k = 0;
    for (const s of state.structure) {
      const o = this.cardObj(s.card);
      o.root.visible = true; o.animId++; o.place(L.DECK_POS.x, 0.05 + (k++) * 0.006, L.DECK_POS.z); o.setFaceUp(false); o.arc = 0;
      o.age = CARD[s.card].age; ids.push(s.card);
    }
    // face textures are drawn lazily; do the face-up ones a card per frame while the deck shuffles rather than all in the first deal frame
    const warm = this._warmFaces(state.structure.filter(s => s.up).map(s => s.card));
    await this.tweens.wait(0.35 / this.speed);
    this.audio?.play('shuffle');
    // shuffle wobble
    await this.tweens.run(0.5, (kk) => { for (const id of ids) { const o = this.cards.get(id); o.wobble = Math.sin(kk * 40 + o.pos.y * 100) * 0.03 * (1 - kk); } }, { ease: ease.linear });
    for (const id of ids) this.cards.get(id).wobble = 0;
    await warm;
    const order = state.structure.map((s, i) => i).sort((a, b) => state.structure[a].row - state.structure[b].row || a - b);
    const ps = [];
    order.forEach((si, n) => {
      const s = state.structure[si], o = this.cards.get(s.card), t = T.get(s.card);
      ps.push(this.moveTo(o, t, { dur: 0.7, delay: n * 0.055 / this.speed, arc: 1.4, e: ease.inOutCubic }).then(() => { o.slot = si; }));
      this.tweens.run(0.01, () => {}, { delay: n * 0.055 / this.speed + 0.1 }).then(() => this.audio?.play('deal', { pan: t.x / 8, vol: 0.5 }));
    });
    await Promise.all(ps);
    await this.syncAll(state);
  }

  /** Draw + upload card-face textures one per frame (yielding a frame via the tween loop) so no single frame eats the whole batch. */
  async _warmFaces(ids) {
    for (const id of ids) {
      this.stage.renderer.initTexture(this.tex.card(id));
      await this.tweens.wait(0.0001);
    }
  }

  setActivePlayer(p) { this.spotX = p === 0 ? -3 : 3; }

  // ------------------------------------------------------------------ selection / highlight / hover
  select(id) {
    if (this.selected && this.cards.get(this.selected)) this.cards.get(this.selected).selTarget = 0;
    if (this.selected && this.wonders.get(this.selected)) this.wonders.get(this.selected).card.selTarget = 0;
    this.selected = id;
    const o = id && (this.cards.get(id) || this.wonders.get(id)?.card);
    if (o) o.selTarget = 1;
  }
  objOf(id) { return this.cards.get(id) || this.wonders.get(id)?.card || null; }
  setGlow(id, color, strength) { const o = this.objOf(id); if (o) o.setGlow(color, strength); }
  clearGlows() {
    for (const o of this.cards.values()) o.setGlow(null, 0);
    for (const w of this.wonders.values()) w.card.setGlow(null, 0);
    for (const g of this.tokens.values()) g.userData.glowT = 0;
  }

  updatePick() {
    const stage = this.stage;
    const hit = stage.pointer.x > -2 ? stage.pick(this.pickMeshes.filter(m => m.visible !== false && this._visible(m))) : null;
    let info = null;
    if (hit) info = hit.object.userData.pick || null;
    const key = info ? info.type + ':' + (info.id ?? '') : '';
    if (key !== this.hoverKey) {
      const prev = this.hovered;
      if (prev) { const o = this.objOf(prev.id); if (o) o.hoverTarget = 0; }
      this.hoverKey = key;
      this.hovered = info && this.hoverFilter(info) ? info : null;
      if (this.hovered && this.liftFilter?.(this.hovered)) { const o = this.objOf(this.hovered.id); if (o) o.hoverTarget = 1; this.audio?.play('hover', { vol: 0.6 }); }
      if (this.hovered && info.type === 'token') { const g = this.tokens.get(info.id); if (g) g.userData.hoverT = 1; }
      this.onHover?.(this.hovered, stage.pointerPx);
    } else if (this.hovered) this.onHover?.(this.hovered, stage.pointerPx, true);
    this.stage.canvas.style.cursor = this.hovered && this.clickable?.(this.hovered) ? 'pointer' : 'default';
  }
  _visible(m) { let o = m; while (o) { if (o.visible === false) return false; o = o.parent; } return true; }
  handleClick() { this.hoverKey = null; this.updatePick(); if (this.hovered) this.onPick?.(this.hovered); else this.onPick?.(null); }

  // ------------------------------------------------------------------ frame update
  update(dt, t) {
    dt *= 1;
    this.tweens.update(dt);
    if (this.tweens.items.length) this.stage.shadowDirty = true;
    this.env?.update(t, dt);
    if (this.env && this.spotX !== undefined) { const sp = this.env.lights.spot; sp.target.position.x += (this.spotX - sp.target.position.x) * Math.min(1, dt * 1.5); sp.position.x = sp.target.position.x * 0.5; }
    for (const o of this.cards.values()) { o.update(dt, t); if (Math.abs(o.hover - o.hoverTarget) > 0.01 || Math.abs(o.sel - o.selTarget) > 0.01) this.stage.shadowDirty = true; }
    for (const w of this.wonders.values()) {
      w.card.update(dt, t); if (Math.abs(w.card.hover - w.card.hoverTarget) > 0.01 || Math.abs(w.card.sel - w.card.selTarget) > 0.01) this.stage.shadowDirty = true;
      if (w.card.root.visible) {
        if (w.built) updateWonderModel(w.solid, t, dt);
        else if (w.ghost.visible) { this._ghostMat.uniforms.uTime.value = t; }
      }
    }
    for (const g of this.tokens.values()) {
      if (!g.visible) continue;
      const h = g.userData.home;
      const st = g.userData.state;
      const glow = g.userData.glowT || 0;
      if (st === 'library' || glow) { g.rotation.y += dt * 0.9; g.position.y = h.y + Math.sin(t * 2 + h.x) * 0.06 + (g.userData.hoverT || 0) * 0.15; }
      else if (!g.userData.moving) { const k = Math.min(1, dt * 4); g.rotation.y += (0 - g.rotation.y) * k; g.position.y += (h.y - g.position.y) * k; }
      g.userData.halo.material.opacity = glow ? 0.28 + 0.16 * Math.sin(t * 5) : 0;
      g.userData.hoverT = (this.hovered && this.hovered.type === 'token' && this.hovered.id === g.userData.id) ? 1 : 0;
    }
    this.pawn.userData.glow.intensity = 1.2 + Math.sin(t * 3) * 0.4;
    for (const f of this.board.userData.capitals) f.userData.flag.rotation.z = Math.sin(t * 3 + f.position.x) * 0.12;
    this.particles.update(dt);
    if ((this._pf = (this._pf || 0) + 1) % 2 === 0) this.updatePick();
  }

  // ------------------------------------------------------------------ event choreography
  async play(events, state) {
    this.state = state;
    const wait = s => this.tweens.wait(s / this.speed);
    // the last wonder pick arrives as [draft, ageStart, turn] against the final state, pyramid included
    this.dealPending = events.some(ev => ev.t === 'ageStart');
    for (const ev of events) {
      switch (ev.t) {
        case 'ageStart': await this.dealAge(state); break;
        case 'draft': {
          this.audio?.play('pick');
          const w = this.wonders.get(ev.wonder);
          this.popup(state.players[ev.player].name, w.card.pos.clone().add(V3(0, 1.2, 0)), ev.player ? '#ff9a8a' : '#8ad0ff');
          await this.syncAll(state); this._draftRefresh(state);
          break;
        }
        case 'build': {
          const o = this.cardObj(ev.card);
          const { T } = this.locate(state);
          const t = T.get(ev.card);
          this.audio?.play('slide', { pan: t.x / 12 });
          await this.moveTo(o, t, { dur: 0.7 / this.speed, arc: 1.3 });
          this.audio?.play('place', { pan: t.x / 12 });
          this.audio?.play(CARD[ev.card].color === 'red' ? 'shield' : 'build', { pan: t.x / 12, vol: 0.7 });
          const col = hex3(COLOR_HEX[CARD[ev.card].color]);
          this.particles.glitter({ pos: [t.x, t.y, t.z], count: 26, color: col.map(c => Math.min(1, c * 1.4 + 0.15)), radius: 0.5, height: 1.6 });
          this.shockwave(V3(t.x, t.y, t.z), new THREE.Color(COLOR_HEX[CARD[ev.card].color]).getHex(), 1.6, 0.7);
          if (ev.cost.chain) this.popup('CHAIN', V3(t.x, 1.2, t.z), '#ffffff');
          await this.syncAll(state);
          break;
        }
        case 'discard': {
          const o = this.cardObj(ev.card); const { T } = this.locate(state);
          this.audio?.play('discard');
          await this.moveTo(o, T.get(ev.card), { dur: 0.65 / this.speed, arc: 1.1 });
          await this.syncAll(state);
          break;
        }
        case 'wonder': {
          const o = this.cardObj(ev.card); const { T } = this.locate(state); const w = this.wonders.get(ev.wonder);
          this.audio?.play('slide');
          await this.moveTo(o, T.get(ev.card), { dur: 0.7 / this.speed, arc: 1.0 });
          this.audio?.play('wonder');
          this.stage.flash(0.18, 0.13, 0.05); this.stage.shake(0.12, 0.6);
          const wp = w.card.pos;
          this.stage.goto('overview', { name: 'focus', target: V3(wp.x, 0.3, wp.z - 0.4), dist: (this.stage.fitDist || 24) * 0.34, pitch: 0.72, yaw: wp.x < 0 ? 0.22 : -0.22 });
          this.pillar(wp, 0xffe6a0, 8, 2.2); this.shockwave(wp, 0xffe6a0, 4.5, 1.4);
          this.particles.burst({ pos: [wp.x, 0.4, wp.z], count: 90, color: [1, 0.85, 0.4], speed: 4.2, spread: 1, gravity: 3.5, life: 1.8, size: 0.14 });
          w.built = true;
          await this._showSolid(w, true);
          await wait(0.6);
          await this.syncAll(state);
          break;
        }
        case 'coins': await this.coinsEvent(ev); break;
        case 'military': {
          this.stage.goto('pawn', { target: V3(L.militaryX(ev.to) * 0.6, 0, -5.5) });
          await this.movePawn(ev.from, ev.to, ev.player);
          break;
        }
        case 'loot': {
          const tok = this.loot[ev.token];
          if (tok && tok.visible) {
            this.audio?.play('loot');
            this.stage.shake(0.22, 0.5);
            this.particles.burst({ pos: [tok.position.x, 0.5, tok.position.z], count: 50, color: [1, 0.75, 0.3], speed: 3, spread: 1, gravity: 6, life: 1.2, size: 0.13 });
            await this.tweens.run(0.7, (k, e) => { tok.position.y = 0.24 + e * 1.4; tok.rotation.x = e * 8; tok.scale.setScalar(1 - k * 0.9); }, { ease: ease.inQuad });
            tok.visible = false; tok.scale.setScalar(1); tok.rotation.x = 0;
          }
          break;
        }
        case 'science': {
          this.audio?.play('science');
          break;
        }
        case 'token': {
          this.audio?.play('token');
          const g = this.tokens.get(ev.token);
          if (g) { this.particles.glitter({ pos: [g.position.x, g.position.y, g.position.z], count: 34, color: [0.6, 0.9, 1], radius: 0.4, height: 1.8 }); this.popup(TOKEN[ev.token].name, V3(g.position.x, 1.6, g.position.z), '#9fe6ff'); }
          await this.syncAll(state); await wait(0.5);
          break;
        }
        case 'destroy': {
          const o = this.cardObj(ev.card); const { T } = this.locate(state);
          this.audio?.play('destroy');
          this.stage.shake(0.25, 0.7);
          const p = o.pos;
          this.particles.burst({ pos: [p.x, p.y + 0.2, p.z], count: 80, color: [1, 0.5, 0.2], speed: 3, spread: 1, gravity: 5, life: 1.4, size: 0.15 });
          this.particles.burst({ pos: [p.x, p.y + 0.2, p.z], count: 40, color: [0.4, 0.35, 0.3], speed: 1.6, spread: 1, gravity: -0.5, life: 2, size: 0.3, jitter: 0.2 });
          await this.tweens.run(0.5, (k) => { o.wobble = Math.sin(k * 50) * 0.08 * (1 - k); }, { ease: ease.linear });
          o.wobble = 0;
          await this.moveTo(o, T.get(ev.card), { dur: 0.7 / this.speed, arc: 1.2 });
          await this.syncAll(state);
          break;
        }
        case 'revive': {
          const o = this.cardObj(ev.card); const { T } = this.locate(state);
          this.audio?.play('token');
          await this.moveTo(o, T.get(ev.card), { dur: 0.9 / this.speed, arc: 1.8 });
          this.particles.glitter({ pos: [o.pos.x, o.pos.y, o.pos.z], count: 40, color: [0.7, 1, 0.8], radius: 0.5, height: 2 });
          await this.syncAll(state);
          break;
        }
        case 'again': this.popup('PLAY AGAIN', V3(0, 1.8, 2.5), '#ffe08a', 1.8); this.audio?.play('turn'); break;
        case 'flip': this.audio?.play('flip', { vol: 0.5 }); break;
        case 'library': await this.syncAll(state); this.audio?.play('token'); await wait(0.6); break;
        case 'wonderLost': { await this.syncAll(state); break; }
        default: break;
      }
    }
    await this.syncAll(state);
  }

  _draftRefresh(state) { /* pool re-layout handled by syncAll */ }

  // ------------------------------------------------------------------ finale
  async victoryFx(state, winner) {
    const { kind, player } = winner;
    this.audio?.play(player === 0 || player === null ? 'victory' : 'defeat');
    if (kind === 'military') {
      const loser = 1 - player, cap = this.board.userData.capitals[loser];
      const cx = cap.position.x;
      this.stage.goto('pawn', { target: V3(cx * 0.9, 0.5, -6.4), pitch: 0.5 });
      this.stage.shake(0.6, 2.5);
      for (let i = 0; i < 10; i++) { this.particles.burst({ pos: [cx + (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), L.BOARD.z + (Math.random() - 0.5)], count: 60, color: [1, 0.45, 0.15], speed: 4, spread: 1, gravity: 2, life: 2.2, size: 0.22 }); await this.tweens.wait(0.25); }
      await this.tweens.run(1.8, (k, e) => { cap.rotation.z = (loser === 0 ? 1 : -1) * e * 0.5; cap.position.y = 0.2 - e * 0.6; }, { ease: ease.inQuad });
    } else if (kind === 'science') {
      const x = L.ZONE_X[player];
      for (let i = 0; i < 6; i++) { this.pillar(V3(x - 3 + i * 1.2, 0, 0), 0x9fe6ff, 9, 2.4); this.audio?.play('science'); await this.tweens.wait(0.3); }
    }
    // fireworks over the winner
    const x = player === null ? 0 : L.ZONE_X[player];
    const cols = [[1, 0.8, 0.3], [0.5, 0.8, 1], [1, 0.4, 0.5], [0.6, 1, 0.6], [1, 1, 1]];
    for (let i = 0; i < 14; i++) {
      const c = cols[i % cols.length], px = x + (Math.random() - 0.5) * 8, py = 4 + Math.random() * 4, pz = -1 + (Math.random() - 0.5) * 6;
      this.particles.burst({ pos: [px, py, pz], count: 90, color: c, speed: 4.5, spread: 2, up: 1, gravity: 2.5, life: 2.2, size: 0.2, drag: 1.1 });
      this.audio?.play('coin', { pitch: 12 + Math.random() * 12, vol: 0.5 });
      this.stage.flash(0.03, 0.03, 0.02);
      await this.tweens.wait(0.22 + Math.random() * 0.25);
    }
  }
}
