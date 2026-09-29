// The table, the felt play-mat, the military board, the conflict pawn and the capitals.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mkCanvas, rr, lin, rad, mix, lighten, darken, rgba, meander, rng, makeNoise, FONT_TITLE, FONT_BODY, star } from './draw.js';
import { drawGlyph } from './glyphs.js';
import { TABLE, BOARD, COLUMNS, cityCardPos, wonderPos, tokenOwnedPos, treasuryPos, DISCARD_POS, DECK_POS, CW, CH, WW, WH, CITY, tokenBoardPos, PLAYER_COLORS } from './layout.js';
import { COLOR_HEX } from '../engine/data.js';

const GOLD = [[0, '#fff3b8'], [0.3, '#f0c85a'], [0.6, '#9a6f1e'], [0.85, '#f6d777'], [1, '#b98a2e']];

export const MAT = { x0: -13.2, x1: 13.2, z0: -8.55, z1: 5.55 };
MAT.w = MAT.x1 - MAT.x0; MAT.d = MAT.z1 - MAT.z0;

// ------------------------------------------------------------------ wood
export function makeWoodCanvas(w = 1024, h = 512) {
  const cv = mkCanvas(w, h), ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const n = makeNoise(11);
  const dark = [38, 22, 13], light = [104, 66, 38];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nn = n.fbm(x * 0.0035, y * 0.028, 4);
    const streak = 0.5 + 0.5 * Math.sin(y * 0.09 + nn * 14 + n.n2(x * 0.002, y * 0.01) * 6);
    const fine = n.n2(x * 0.06, y * 0.9) * 0.18;
    const t = Math.min(1, Math.max(0, 0.42 * nn + 0.45 * streak + fine));
    const i = (y * w + x) * 4;
    d[i] = dark[0] + (light[0] - dark[0]) * t; d[i + 1] = dark[1] + (light[1] - dark[1]) * t; d[i + 2] = dark[2] + (light[2] - dark[2]) * t; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // plank seams
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (let y = 0; y < h; y += h / 4) ctx.fillRect(0, y, w, 3);
  return cv;
}

// ------------------------------------------------------------------ felt mat
export function makeMatCanvas() {
  const S = 80, W = Math.round(MAT.w * S), H = Math.round(MAT.d * S);
  const cv = mkCanvas(W, H), ctx = cv.getContext('2d');
  const px = (x, z) => [(x - MAT.x0) * S, (z - MAT.z0) * S];
  // base felt
  ctx.fillStyle = rad(ctx, W / 2, H * 0.48, 40, W * 0.62, [[0, '#1a5450'], [0.55, '#123f40'], [1, '#08191d']]);
  ctx.fillRect(0, 0, W, H);
  const r = rng(5);
  for (let i = 0; i < 60000; i++) { const x = r() * W, y = r() * H, l = 3 + r() * 6, a = r() * 6.28; ctx.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r() * 0.05})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
  // central sun medallion
  const [cx, cy] = px(0, 0.2);
  ctx.save(); ctx.translate(cx, cy);
  for (let i = 0; i < 48; i++) { ctx.rotate(Math.PI / 24); ctx.fillStyle = i % 2 ? 'rgba(240,200,110,0.05)' : 'rgba(240,200,110,0.02)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-26, -S * 5.4); ctx.lineTo(26, -S * 5.4); ctx.fill(); }
  for (const [rr2, a, lw] of [[5.6, 0.18, 3], [5.2, 0.1, 1.5], [3.9, 0.1, 1.5], [3.5, 0.14, 2.5]]) { ctx.strokeStyle = `rgba(240,200,110,${a})`; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(0, 0, rr2 * S, 0, 7); ctx.stroke(); }
  ctx.restore();

  // zone furniture ------------------------------------------------
  const line = (a) => `rgba(236,200,120,${a})`;
  const slot = (x, z, w, h, col, a = 0.3, rad2 = 10) => {
    const [sx, sy] = px(x, z);
    rr(ctx, sx - w * S / 2, sy - h * S / 2, w * S, h * S, rad2);
    ctx.fillStyle = rgba(col, 0.055); ctx.fill(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = 2; ctx.stroke();
  };
  for (let p = 0; p < 2; p++) {
    // city columns
    COLUMNS.forEach(c => {
      const pos = cityCardPos(p, c, 0, 1);
      const col = COLOR_HEX[c];
      const [sx, sy] = px(pos.x, pos.z);
      ctx.save(); const g = ctx.createLinearGradient(0, sy - CH * CITY.scale * S / 2, 0, sy + CITY.maxDepth * S);
      g.addColorStop(0, rgba(col, 0.13)); g.addColorStop(1, rgba(col, 0));
      rr(ctx, sx - CW * CITY.scale * S / 2 - 3, sy - CH * CITY.scale * S / 2, CW * CITY.scale * S + 6, CITY.maxDepth * S, 12); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      slot(pos.x, pos.z, CW * CITY.scale, CH * CITY.scale, col, 0.5, 12);
      // colour pip above the column
      ctx.fillStyle = rgba(col, 0.85); ctx.beginPath(); ctx.arc(sx, sy - CH * CITY.scale * S / 2 - 14, 6, 0, 7); ctx.fill();
    });
    // wonder slots
    for (let i = 0; i < 4; i++) { const wp = wonderPos(p, i); slot(wp.x, wp.z, WW, WH, '#ecc878', 0.45, 12); }
    // treasury
    for (let s = 0; s < 3; s++) { const t = treasuryPos(p, s); const [sx, sy] = px(t.x, t.z); ctx.strokeStyle = line(0.4); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 0.36 * S, 0, 7); ctx.stroke(); ctx.strokeStyle = line(0.18); ctx.beginPath(); ctx.arc(sx, sy, 0.42 * S, 0, 7); ctx.stroke(); }
    // progress token tray
    for (let i = 0; i < 8; i++) { const t = tokenOwnedPos(p, i); const [sx, sy] = px(t.x, t.z); ctx.strokeStyle = line(0.3); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 0.44 * S, 0, 7); ctx.stroke(); }
  }
  slot(DECK_POS.x, DECK_POS.z, CW, CH, '#9fb8ff', 0.4, 12); slot(DISCARD_POS.x, DISCARD_POS.z, CW, CH, '#ff9f9f', 0.4, 12);
  ctx.font = `700 22px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.fillStyle = line(0.5);
  ctx.fillText('DECK', ...px(DECK_POS.x, DECK_POS.z + 0.98)); ctx.fillText('DISCARD', ...px(DISCARD_POS.x, DISCARD_POS.z + 0.98));

  // border frame
  const b = 26;
  ctx.strokeStyle = lin(ctx, 0, 0, W, H, GOLD); ctx.lineWidth = 6; rr(ctx, b, b, W - b * 2, H - b * 2, 18); ctx.stroke();
  ctx.lineWidth = 2; rr(ctx, b + 14, b + 14, W - (b + 14) * 2, H - (b + 14) * 2, 12); ctx.stroke();
  meander(ctx, b + 40, b + 22, W - (b + 40) * 2, 22, 'rgba(236,200,120,0.35)', 2.4);
  meander(ctx, b + 40, H - b - 44, W - (b + 40) * 2, 22, 'rgba(236,200,120,0.35)', 2.4);
  for (const [x, y] of [[b + 30, b + 30], [W - b - 30, b + 30], [b + 30, H - b - 30], [W - b - 30, H - b - 30]]) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = lin(ctx, -22, -22, 22, 22, GOLD); star(ctx, 0, 0, 24, 9, 12); ctx.fill(); ctx.fillStyle = '#123f40'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill(); ctx.restore();
  }
  return cv;
}

// ------------------------------------------------------------------ military board texture
export function makeBoardCanvas() {
  const S = 128, W = Math.round(BOARD.len * S), H = Math.round(BOARD.d * S);
  const cv = mkCanvas(W, H), ctx = cv.getContext('2d');
  const bx = x => (x + BOARD.len / 2) * S, bz = z => (z - (BOARD.z - BOARD.d / 2)) * S;
  ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, '#3a2716'], [1, '#26170d']]); ctx.fillRect(0, 0, W, H);
  const r = rng(9);
  for (let i = 0; i < 7000; i++) { ctx.strokeStyle = `rgba(0,0,0,${r() * 0.08})`; ctx.lineWidth = 1; const y = r() * H; ctx.beginPath(); ctx.moveTo(r() * W, y); ctx.lineTo(r() * W, y + (r() - 0.5) * 6); ctx.stroke(); }
  // player wash
  const gl = ctx.createLinearGradient(0, 0, W, 0);
  gl.addColorStop(0, 'rgba(58,155,217,0.55)'); gl.addColorStop(0.42, 'rgba(58,155,217,0.05)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)'); gl.addColorStop(0.58, 'rgba(217,80,58,0.05)'); gl.addColorStop(1, 'rgba(217,80,58,0.55)');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  // frame
  ctx.strokeStyle = lin(ctx, 0, 0, W, H, GOLD); ctx.lineWidth = 8; rr(ctx, 10, 10, W - 20, H - 20, 20); ctx.stroke(); ctx.lineWidth = 2; rr(ctx, 26, 26, W - 52, H - 52, 12); ctx.stroke();
  // track lane
  const ty = bz(BOARD.trackZ);
  rr(ctx, bx(-9.55), ty - 0.5 * S, 19.1 * S, 1.0 * S, 24); ctx.fillStyle = 'rgba(12,8,4,0.6)'; ctx.fill(); ctx.strokeStyle = lin(ctx, 0, 0, W, 0, GOLD); ctx.lineWidth = 4; ctx.stroke();
  for (let p = -9; p <= 9; p++) {
    const x = bx(p);
    ctx.fillStyle = rad(ctx, x, ty, 0, 0.4 * S, [[0, 'rgba(0,0,0,0.85)'], [0.8, 'rgba(0,0,0,0.5)'], [1, 'rgba(255,220,150,0.35)']]);
    ctx.beginPath(); ctx.arc(x, ty, 0.36 * S, 0, 7); ctx.fill();
    ctx.strokeStyle = Math.abs(p) === 9 ? 'rgba(255,90,70,0.8)' : p === 0 ? 'rgba(255,255,255,0.65)' : 'rgba(236,200,120,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, ty, 0.36 * S, 0, 7); ctx.stroke();
    if (p !== 0 && Math.abs(p) < 9) { ctx.fillStyle = 'rgba(236,210,150,0.35)'; ctx.font = `700 26px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(Math.abs(p)), x, ty + 0.42 * S); }
  }
  // zone VP plates (south of lane)
  const zones = [[1, 2, 2], [3, 5, 5], [6, 8, 10]];
  for (const s of [-1, 1]) for (const [lo, hi, v] of zones) {
    const x0 = bx(s * lo - 0.5), x1 = bx(s * hi + 0.5), cx = (x0 + x1) / 2, y = ty + 0.72 * S;
    ctx.strokeStyle = 'rgba(236,200,120,0.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(Math.min(x0, x1) + 6, y - 6); ctx.lineTo(Math.max(x0, x1) - 6, y - 6); ctx.stroke();
    ctx.fillStyle = 'rgba(30,18,8,0.85)'; rr(ctx, cx - 44, y - 2, 88, 40, 10); ctx.fill(); ctx.strokeStyle = 'rgba(236,200,120,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#f0d27a'; ctx.font = `700 26px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${v} VP`, cx, y + 18);
  }
  // loot slots (north)
  for (const s of [-1, 1]) for (const th of [3, 6]) {
    const x = bx(s * th), y = bz(BOARD.lootZ);
    ctx.strokeStyle = 'rgba(236,200,120,0.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 0.4 * S, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
  }
  // token lane
  const ky = bz(BOARD.tokenZ);
  ctx.fillStyle = 'rgba(236,200,120,0.5)'; ctx.font = `700 22px ${FONT_TITLE}`; ctx.textAlign = 'center';
  ctx.fillText('P R O G R E S S', bx(0), ky + 0.72 * S);
  for (let i = 0; i < 5; i++) {
    const x = bx(tokenBoardPos(i).x);
    ctx.fillStyle = rad(ctx, x, ky, 0, 0.55 * S, [[0, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0.3)']]); ctx.beginPath(); ctx.arc(x, ky, 0.52 * S, 0, 7); ctx.fill();
    ctx.strokeStyle = lin(ctx, x - 60, ky - 60, x + 60, ky + 60, GOLD); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, ky, 0.52 * S, 0, 7); ctx.stroke();
  }
  return cv;
}

function loot(amount) {
  const S = 256, cv = mkCanvas(S, S), ctx = cv.getContext('2d'), c = S / 2;
  ctx.fillStyle = lin(ctx, 0, 0, S, S, GOLD); ctx.beginPath(); ctx.arc(c, c, c - 2, 0, 7); ctx.fill();
  ctx.fillStyle = rad(ctx, c, c, 10, c, [[0, '#8a1f1f'], [1, '#4a0c0c']]); ctx.beginPath(); ctx.arc(c, c, c - 22, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,230,150,0.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(c, c, c - 32, 0, 7); ctx.stroke();
  drawGlyph(ctx, 'coin', c, c - 30, 96);
  ctx.font = `800 ${amount > 9 ? 84 : 100}px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText('-' + amount, c + 3, c + 66); ctx.fillStyle = '#ffe9a8'; ctx.fillText('-' + amount, c, c + 63);
  return cv;
}

// ------------------------------------------------------------------ builders
const matGold = () => new THREE.MeshStandardMaterial({ color: 0xe0b445, metalness: 0.95, roughness: 0.28 });

export function buildTable(tex) {
  const g = new THREE.Group();
  const wood = tex.canvasTex('wood', () => makeWoodCanvas(), { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  wood.repeat.set(3, 1); wood.needsUpdate = true;
  const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.05, bumpMap: wood, bumpScale: 1.4 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(TABLE.w, 0.7, TABLE.d, 5, 0.12), woodMat);
  body.position.set(0, -0.37, TABLE.cz); body.receiveShadow = true; body.castShadow = true; g.add(body);
  // lower skirt + legs
  const skirt = new THREE.Mesh(new RoundedBoxGeometry(TABLE.w - 1.6, 0.9, TABLE.d - 1.6, 4, 0.1), woodMat);
  skirt.position.set(0, -1.15, TABLE.cz); skirt.castShadow = true; g.add(skirt);
  const legProfile = [[0.0, 0], [0.55, 0], [0.5, 0.15], [0.32, 0.3], [0.3, 0.5], [0.42, 0.62], [0.28, 0.72], [0.26, 2.4], [0.36, 2.5], [0.3, 2.62], [0.5, 2.8], [0.5, 3.0], [0, 3.0]].map(([x, y]) => new THREE.Vector2(x, y));
  const legGeo = new THREE.LatheGeometry(legProfile, 28);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, woodMat); leg.position.set(sx * (TABLE.w / 2 - 1.1), -4.05, TABLE.cz + sz * (TABLE.d / 2 - 1.1)); leg.castShadow = true; g.add(leg);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 10, 28), matGold()); ring.rotation.x = Math.PI / 2; ring.position.set(leg.position.x, -3.55, leg.position.z); g.add(ring);
  }
  // felt
  const matTex = tex.canvasTex('mat', () => makeMatCanvas());
  const feltMat = new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.96, metalness: 0, bumpMap: matTex, bumpScale: 0.3 });
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(MAT.w, MAT.d), feltMat);
  felt.rotation.x = -Math.PI / 2; felt.position.set((MAT.x0 + MAT.x1) / 2, 0.001, (MAT.z0 + MAT.z1) / 2); felt.receiveShadow = true; g.add(felt);
  // gold inlay around felt
  const gm = matGold();
  const t = 0.09;
  for (const [w, d, x, z] of [[MAT.w + t * 2, t, 0, MAT.z0 - t / 2], [MAT.w + t * 2, t, 0, MAT.z1 + t / 2], [t, MAT.d, MAT.x0 - t / 2, (MAT.z0 + MAT.z1) / 2], [t, MAT.d, MAT.x1 + t / 2, (MAT.z0 + MAT.z1) / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), gm); m.position.set(x, 0.0, z); m.castShadow = true; g.add(m);
  }
  // corner brass caps
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.12, 6), gm);
    cap.position.set(sx * (TABLE.w / 2 - 0.42), 0.0, TABLE.cz + sz * (TABLE.d / 2 - 0.42)); cap.castShadow = true; g.add(cap);
  }
  g.userData.woodMat = woodMat;
  return g;
}

let stoneTex = null;
function getStoneTexture() {
  if (stoneTex) return stoneTex;
  const S = 256, cv = mkCanvas(S, S), ctx = cv.getContext('2d'), n = makeNoise(31);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 0.62 + 0.3 * n.fbm(x * 0.05, y * 0.05, 4) - 0.1 * n.n2(x * 0.4, y * 0.4);
    const i = (y * S + x) * 4; img.data[i] = 226 * v; img.data[i + 1] = 214 * v; img.data[i + 2] = 190 * v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(70,55,35,0.35)'; ctx.lineWidth = 2;
  for (let y = 0; y < S; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); for (let x = (y / 32) % 2 ? 0 : 32; x < S; x += 64) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 32); ctx.stroke(); } }
  stoneTex = new THREE.CanvasTexture(cv); stoneTex.colorSpace = THREE.SRGBColorSpace; stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping; stoneTex.anisotropy = 4;
  return stoneTex;
}

function buildCapital(color, dir) {
  const g = new THREE.Group();
  const st = getStoneTexture();
  const stone = new THREE.MeshStandardMaterial({ color: 0xffffff, map: st, roughness: 0.85, bumpMap: st, bumpScale: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x140c08, roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25, emissive: color, emissiveIntensity: 0.1 });
  const gold = matGold();
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xffd58a, emissive: 0xffa848, emissiveIntensity: 1.6, roughness: 0.6 });
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  // stepped platform
  add(new THREE.BoxGeometry(2.3, 0.12, 2.6), stone, 0, 0.06, 0); add(new THREE.BoxGeometry(2.0, 0.12, 2.3), stone, 0, 0.18, 0);
  // curtain wall + merlons
  add(new THREE.BoxGeometry(1.5, 0.75, 1.9), stone, 0, 0.6, 0);
  const merlon = new THREE.BoxGeometry(0.16, 0.14, 0.16);
  for (let i = 0; i < 6; i++) for (const sx of [-0.68, 0.68]) add(merlon, stone, sx, 1.05, -0.85 + i * 0.34);
  for (let i = 0; i < 3; i++) for (const sz of [-0.9, 0.9]) add(merlon, stone, -0.34 + i * 0.34, 1.05, sz);
  // corner towers
  for (const [tx, tz] of [[-0.8, -1.0], [-0.8, 1.0], [0.8, -1.0], [0.8, 1.0]]) {
    add(new THREE.CylinderGeometry(0.27, 0.31, 1.25, 16), stone, tx, 0.78, tz);
    add(new THREE.CylinderGeometry(0.34, 0.3, 0.1, 16), stone, tx, 1.43, tz);
    add(new THREE.ConeGeometry(0.36, 0.55, 16), roof, tx, 1.75, tz);
    add(new THREE.SphereGeometry(0.045, 8, 8), gold, tx, 2.06, tz);
    add(new THREE.BoxGeometry(0.06, 0.16, 0.03), glowMat, tx, 1.05, tz + (tz > 0 ? -0.26 : 0.26));
  }
  // central keep with golden dome
  add(new THREE.BoxGeometry(0.85, 1.05, 0.9), stone, 0, 1.15, 0);
  add(new THREE.CylinderGeometry(0.34, 0.4, 0.2, 20), stone, 0, 1.72, 0);
  const dome = add(new THREE.SphereGeometry(0.36, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0, 1.82, 0);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), gold, 0, 2.5, 0);
  for (const z of [-0.2, 0.2]) add(new THREE.BoxGeometry(0.06, 0.18, 0.03), glowMat, 0.46, 1.3, z, Math.PI / 2);
  // gate facing the board (toward -dir side)
  add(new THREE.BoxGeometry(0.06, 0.48, 0.44), dark, 0.76, 0.45, 0);
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16, 1, false, 0, Math.PI), dark, 0.76, 0.69, 0).rotation.set(0, 0, Math.PI / 2);
  add(new THREE.TorusGeometry(0.25, 0.025, 8, 20, Math.PI), gold, 0.79, 0.69, 0, Math.PI / 2);
  for (const z of [-0.36, 0.36]) { add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6), gold, 0.8, 0.5, z); const fl = new THREE.PointLight(0xff9a4a, 0.5, 1.6, 2); fl.position.set(0.95, 0.75, z); g.add(fl); add(new THREE.SphereGeometry(0.055, 8, 8), glowMat, 0.8, 0.72, z); }
  // banner
  const pole = add(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6), gold, 0, 2.55, 0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.32), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6, emissive: color, emissiveIntensity: 0.25 }));
  flag.position.set(0.28, 2.75, 0); flag.rotation.y = Math.PI / 2; g.add(flag); g.userData.flag = flag;
  return g;
}

function buildPawn() {
  const pts = [[0, 0], [0.3, 0], [0.32, 0.05], [0.26, 0.11], [0.18, 0.18], [0.11, 0.3], [0.1, 0.5], [0.16, 0.56], [0.17, 0.6], [0.1, 0.64], [0.2, 0.76], [0.22, 0.9], [0.14, 1.02], [0.04, 1.06], [0, 1.07]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), new THREE.MeshStandardMaterial({ color: 0xe6b73c, metalness: 0.95, roughness: 0.22 }));
  m.castShadow = true; g.add(m);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 10, 30), new THREE.MeshStandardMaterial({ color: 0xb3261e, metalness: 0.4, roughness: 0.4, emissive: 0x501008 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.62; g.add(ring);
  const glow = new THREE.PointLight(0xffc36a, 0.0, 3, 2); glow.position.y = 0.9; g.add(glow); g.userData.glow = glow;
  return g;
}

export function buildMilitaryBoard(tex) {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2716, roughness: 0.5, metalness: 0.1 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(BOARD.len, 0.2, BOARD.d, 4, 0.06), woodMat);
  body.position.set(0, 0.1, BOARD.z); body.castShadow = true; body.receiveShadow = true; g.add(body);
  const topTex = tex.canvasTex('board', () => makeBoardCanvas());
  const top = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.len - 0.06, BOARD.d - 0.06), new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.55, metalness: 0.15, bumpMap: topTex, bumpScale: 1.5 }));
  top.rotation.x = -Math.PI / 2; top.position.set(0, 0.205, BOARD.z); top.receiveShadow = true; g.add(top);
  const capL = buildCapital(PLAYER_COLORS[0], 1), capR = buildCapital(PLAYER_COLORS[1], -1);
  capL.position.set(-BOARD.len / 2 + 0.05, 0.2, BOARD.z - 0.2); capL.rotation.y = 0; capR.position.set(BOARD.len / 2 - 0.05, 0.2, BOARD.z - 0.2); capR.rotation.y = Math.PI;
  g.add(capL, capR);
  const pawn = buildPawn(); pawn.position.set(0, 0.2, BOARD.trackZ); pawn.scale.setScalar(0.62); g.add(pawn);
  // loot tokens
  const lootTokens = {};
  for (const s of [-1, 1]) for (const th of [3, 6]) {
    const amt = th === 3 ? 2 : 5;
    const lt = tex.canvasTex('loot' + amt, () => loot(amt));
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.07, 36), [matGold(), new THREE.MeshStandardMaterial({ map: lt, roughness: 0.4, metalness: 0.4 }), matGold()]);
    m.rotation.y = Math.PI / 2; m.position.set(s * th * BOARD.pitch, 0.24, BOARD.lootZ); m.castShadow = true;
    g.add(m); lootTokens[String(s * th)] = m;
  }
  g.userData = { pawn, lootTokens, capitals: [capL, capR] };
  return g;
}
