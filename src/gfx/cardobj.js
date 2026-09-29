// Card meshes: custom rounded slab geometry, texture cache, and the CardObj wrapper used by the view.
import * as THREE from 'three';
import { CW, CH, CT, WW, WH } from './layout.js';
import { renderCardFace, renderCardBack, renderWonderFace, renderTokenFace, renderCoinFace } from './cardart.js';
import { mkCanvas } from './draw.js';
import { CARD } from '../engine/data.js';

// ------------------------------------------------------------------ geometry
const geoCache = new Map();
export function cardGeometry(w = CW, h = CH, t = CT, r = 0.055, seg = 5) {
  const key = `${w}|${h}|${t}|${r}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const pts = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  const n = pts.length, pos = [], nor = [], uv = [], idx = [];
  const hz = t / 2;
  const push = (x, y, z, nx, ny, nz, u, v) => { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, v); return pos.length / 3 - 1; };
  // front (group 0)
  let start = idx.length;
  const fc = push(0, 0, hz, 0, 0, 1, 0.5, 0.5);
  const f0 = pts.map(([x, y]) => push(x, y, hz, 0, 0, 1, x / w + 0.5, y / h + 0.5));
  for (let i = 0; i < n; i++) idx.push(fc, f0[i], f0[(i + 1) % n]);
  const g0 = [start, idx.length - start];
  // back (group 1) — uv already mirrored for a card lying face-down
  start = idx.length;
  const bc = push(0, 0, -hz, 0, 0, -1, 0.5, 0.5);
  const b0 = pts.map(([x, y]) => push(x, y, -hz, 0, 0, -1, x / w + 0.5, 0.5 - y / h));
  for (let i = 0; i < n; i++) idx.push(bc, b0[(i + 1) % n], b0[i]);
  const g1 = [start, idx.length - start];
  // edge (group 2)
  start = idx.length;
  const e0 = [], e1 = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = pts[i % n], [px, py] = pts[(i + n - 1) % n], [nx2, ny2] = pts[(i + 1) % n];
    let tx = nx2 - px, ty = ny2 - py; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    e0.push(push(x, y, hz, ty, -tx, 0, 0.5, 0.5)); e1.push(push(x, y, -hz, ty, -tx, 0, 0.5, 0.5));
  }
  for (let i = 0; i < n; i++) idx.push(e0[i], e1[i], e0[i + 1], e1[i], e1[i + 1], e0[i + 1]);
  const g2 = [start, idx.length - start];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(g0[0], g0[1], 0); g.addGroup(g1[0], g1[1], 1); g.addGroup(g2[0], g2[1], 2);
  g.computeBoundingBox(); g.computeBoundingSphere();
  geoCache.set(key, g);
  return g;
}

// ------------------------------------------------------------------ textures
export class Textures {
  constructor(renderer) {
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.cache = new Map();
    this.quality = 0.875;
  }
  _tex(key, make, opts = {}) {
    let t = this.cache.get(key);
    if (!t) {
      t = new THREE.CanvasTexture(make());
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.aniso; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      Object.assign(t, opts);
      this.cache.set(key, t);
    }
    return t;
  }
  card(id) { return this._tex('c:' + id, () => renderCardFace(CARD[id], this.quality)); }
  back(age) { return this._tex('b:' + age, () => renderCardBack(age, this.quality)); }
  wonder(id) { return this._tex('w:' + id, () => renderWonderFace(id, this.quality)); }
  token(id) { return this._tex('t:' + id, () => renderTokenFace(id, 512)); }
  coin(kind, v) { return this._tex('coin:' + kind, () => renderCoinFace(kind, v, 256)); }
  canvasTex(key, make, opts) { return this._tex(key, make, opts); }
  /** full-res canvas for DOM previews (not cached as texture) */
  previewCard(id) { return renderCardFace(CARD[id], 1.25); }
}

let rectGlowTex = null;
export function getRectGlow() {
  if (rectGlowTex) return rectGlowTex;
  const S = 128, c = mkCanvas(S, S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.max(0, Math.abs(x - S / 2) - S * 0.26) / (S * 0.24), dy = Math.max(0, Math.abs(y - S / 2) - S * 0.26) / (S * 0.24);
    const d = Math.hypot(dx, dy), a = Math.max(0, 1 - d), v = a * a * (3 - 2 * a);
    const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(v * 255);
  }
  ctx.putImageData(img, 0, 0);
  rectGlowTex = new THREE.CanvasTexture(c); rectGlowTex.colorSpace = THREE.SRGBColorSpace;
  return rectGlowTex;
}

// ------------------------------------------------------------------ card object
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.85 });

export class CardObj {
  /**
   * @param {'card'|'wonder'} kind
   * @param {string} id  card id or wonder id
   * @param {Textures} tex
   */
  constructor(kind, id, tex, { age = 1 } = {}) {
    this.kind = kind; this.id = id; this.tex = tex; this.age = age;
    const w = kind === 'wonder' ? WW : CW, h = kind === 'wonder' ? WH : CH;
    this.w = w; this.h = h;
    this.root = new THREE.Group();
    this.flipG = new THREE.Group();
    this.root.add(this.flipG);
    this.frontMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 });
    this.backMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 });
    this.backMat.map = kind === 'wonder' ? tex.back(2) : tex.back(age);
    if (kind === 'wonder') this.frontMat.map = tex.wonder(id);
    this.mesh = new THREE.Mesh(cardGeometry(w, h), [this.frontMat, this.backMat, edgeMat]);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.userData.cardObj = this;
    this.flipG.add(this.mesh);
    // fold so that front faces up: rotation.x = -PI/2 ; face-down: +PI/2
    this.flipG.rotation.x = Math.PI / 2;
    this.faceUp = false;
    // highlight glow (additive, lies under the card)
    this.glowMat = new THREE.MeshBasicMaterial({ map: getRectGlow(), color: 0xffd36a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.34, h * 1.34), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = -0.006; this.glow.renderOrder = 2;
    this.root.add(this.glow);
    this.glowTarget = 0; this.glowColor = new THREE.Color(0xffd36a);
    // logical transform (tweened by the view); root/flipG are derived from it every frame
    this.pos = new THREE.Vector3(); this.yaw = 0; this.s = 1; this.flipAngle = Math.PI / 2; this.arc = 0;
    this.hover = 0; this.hoverTarget = 0; this.sel = 0; this.selTarget = 0;
    this.animId = 0; this.pulse = 0; this.wobble = 0;
    this.slot = -1;
    this.setFaceUp(false);
  }
  ensureFace() {
    if (this.kind === 'wonder') return;
    if (!this.frontMat.map) { this.frontMat.map = this.tex.card(this.id); this.frontMat.needsUpdate = true; }
  }
  setFaceUp(up) {
    this.faceUp = up;
    if (up) this.ensureFace();
    this.flipAngle = up ? -Math.PI / 2 : Math.PI / 2;
  }
  place(x, y, z, yaw = 0, s = 1) { this.pos.set(x, y, z); this.yaw = yaw; this.s = s; }
  setGlow(color, strength) { if (color !== null && color !== undefined) this.glowColor.set(color); this.glowTarget = strength; }
  dispose() { this.glowMat.dispose(); this.frontMat.dispose(); this.backMat.dispose(); }
  update(dt, t) {
    const kg = 1 - Math.exp(-dt * 10);
    const pulse = this.glowTarget > 0.05 ? 0.78 + 0.22 * Math.sin(t * 4 + this.pos.x) : 1;
    this.glowMat.opacity += (this.glowTarget * 0.42 * pulse - this.glowMat.opacity) * kg;
    this.glowMat.color.copy(this.glowColor);
    this.glow.visible = this.glowMat.opacity > 0.01;
    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-dt * 14));
    this.sel += (this.selTarget - this.sel) * (1 - Math.exp(-dt * 9));
    const lift = this.hover * 0.14 + this.sel * 0.5;
    this.root.position.set(this.pos.x, this.pos.y + this.arc + lift, this.pos.z);
    this.root.rotation.y = this.yaw;
    this.root.rotation.x = -(this.sel * 0.18 + this.hover * 0.05);
    this.root.rotation.z = this.wobble;
    this.root.scale.setScalar(this.s);
    this.flipG.rotation.x = this.flipAngle;
    this.glow.position.y = -0.006 - lift;
  }
}

// ------------------------------------------------------------------ coins & tokens
export function makeCoinMesh(tex, kind, value) {
  const r = kind === 'gold' ? 0.235 : kind === 'silver' ? 0.2 : 0.17;
  const top = tex.coin(kind, value);
  const metal = { bronze: 0xc2773d, silver: 0xd5dde6, gold: 0xf2c23e }[kind];
  const sideMat = new THREE.MeshStandardMaterial({ color: metal, metalness: 0.95, roughness: 0.28 });
  const capMat = new THREE.MeshStandardMaterial({ map: top, metalness: 0.9, roughness: 0.32, bumpMap: top, bumpScale: 0.6 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 40, 1), [sideMat, capMat, capMat]);
  m.castShadow = true; m.receiveShadow = true; m.userData.radius = r; m.userData.thickness = 0.05;
  return m;
}

export function makeTokenMesh(tex, id) {
  const top = tex.token(id);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe0b445, metalness: 0.9, roughness: 0.3 });
  const faceMat = new THREE.MeshStandardMaterial({ map: top, metalness: 0.35, roughness: 0.4, emissive: 0x111111 });
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.09, 56, 1), [rimMat, faceMat, rimMat]);
  disc.rotation.y = Math.PI / 2; disc.castShadow = true; disc.receiveShadow = true;
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.022, 10, 56), rimMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.045; g.add(ring);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.62, 48), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.06; halo.renderOrder = 3; g.add(halo);
  g.userData.disc = disc; g.userData.id = id; g.userData.halo = halo;
  return g;
}
