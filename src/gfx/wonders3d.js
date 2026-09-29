// =============================================================================
//  wonders3d.js — twelve procedural miniature wonders for the 7 Wonders Duel table
//  API:  WONDER_IDS, buildWonderModel(id) -> THREE.Group, updateWonderModel(group, time, dt)
//  Conventions: origin = centre of the plinth base (y = 0 is the table), +y up,
//  front of the model faces +z.  Every call builds fresh materials.
//  userData: { id, height, emissiveMeshes[], glowSprites[], update(t,dt) }
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const WONDER_IDS = ['appian_way', 'circus_maximus', 'colossus', 'great_library', 'great_lighthouse', 'hanging_gardens', 'mausoleum', 'piraeus', 'pyramids', 'sphinx', 'statue_of_zeus', 'temple_of_artemis'];

const BASE = 0.1;                       // top of the plinth = ground level of every model
const PI = Math.PI, TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- PRNG / noise
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul((seed | 0) + 1, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// tileable value noise (period px, py in lattice cells)
function vnoise(x, y, px, py, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const wx = v => ((v % px) + px) % px, wy = v => ((v % py) + py) % py;
  const a = hash2(wx(x0), wy(y0), seed), b = hash2(wx(x0 + 1), wy(y0), seed);
  const c = hash2(wx(x0), wy(y0 + 1), seed), d = hash2(wx(x0 + 1), wy(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, per, seed, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, per * f, per * f, seed + i * 13); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
// non-tileable smooth 3D-ish noise for geometry displacement
function gnoise(x, y, z) {
  return 0.5 + 0.5 * (Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + Math.sin(x * 5.3 - y * 9.1 + z * 3.7) * 0.5);
}

// ---------------------------------------------------------------- canvas textures
const CANV = {};
const TEXS = {};
function pixCanvas(size, fn) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size); const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fn(x, y), i = (y * size + x) * 4;
    if (typeof v === 'number') { d[i] = d[i + 1] = d[i + 2] = clamp(v, 0, 1) * 255; }
    else { d[i] = clamp(v[0], 0, 1) * 255; d[i + 1] = clamp(v[1], 0, 1) * 255; d[i + 2] = clamp(v[2], 0, 1) * 255; }
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function drawCanvas(size, fn) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); fn(ctx, size); return c;
}
const TEXDEF = {
  stone: () => pixCanvas(256, (x, y) => {
    const row = (y / 64) | 0, off = (row % 2) * 64, xx = (x + off) % 256, bx = (xx / 128) | 0;
    const id = row * 2 + bx + (row % 2) * 3;
    const bright = 0.86 + 0.14 * hash2(id, 7, 1);
    const e = Math.min(Math.min(xx % 128, 128 - (xx % 128)), Math.min(y % 64, 64 - (y % 64)));
    const joint = smooth(0.4, 2.8, e);
    const n = fbm(x / 256 * 12, y / 256 * 12, 12, 3, 4);
    const pit = vnoise(x / 3, y / 3, 86, 86, 9) > 0.86 ? 0.9 : 1;
    return (0.5 + 0.5 * joint) * bright * (0.78 + 0.4 * n) * pit;
  }),
  marble: () => pixCanvas(256, (x, y) => {
    const u = x / 256, v = y / 256;
    const w = fbm(u * 4, v * 4, 4, 21, 4), w2 = fbm(u * 8, v * 8, 8, 33, 3);
    const s = Math.sin(TAU * (3 * u + 2 * v + 2.2 * w));
    const s2 = Math.sin(TAU * (5 * u - 3 * v + 3 * w2));
    return 0.95 + 0.05 * w - 0.2 * Math.pow(1 - Math.abs(s), 16) - 0.1 * Math.pow(1 - Math.abs(s2), 24);
  }),
  sand: () => pixCanvas(256, (x, y) => {
    const u = x / 256, v = y / 256;
    const n = fbm(u * 8, v * 8, 8, 5, 4), warp = fbm(u * 4, v * 4, 4, 17, 3);
    const r = Math.sin(TAU * (v * 12 + warp * 2.5)) * 0.5 + 0.5;
    return 0.84 + 0.12 * n + 0.045 * r + (hash2(x, y, 3) - 0.5) * 0.05;
  }),
  cobble: () => {
    const N = 8, S = 256, cell = S / N;
    return pixCanvas(S, (x, y) => {
      const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
      let d1 = 1e9, d2 = 1e9, id = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = ci + di, jj = cj + dj, wi = ((ii % N) + N) % N, wj = ((jj % N) + N) % N;
        const px = (ii + 0.15 + 0.7 * hash2(wi, wj, 1)) * cell, py = (jj + 0.15 + 0.7 * hash2(wi, wj, 2)) * cell;
        const d = Math.hypot(x - px, y - py);
        if (d < d1) { d2 = d1; d1 = d; id = wi + wj * N; } else if (d < d2) d2 = d;
      }
      const joint = smooth(0.5, 4.5, d2 - d1);
      const b = 0.6 + 0.4 * hash2(id, 3, 9), hue = hash2(id, 5, 5);
      const n = fbm(x / S * 24, y / S * 24, 24, 7, 3);
      const v = b * (0.86 + 0.24 * n) * (0.42 + 0.58 * joint);
      return [v * (0.97 + 0.07 * hue), v * 0.95, v * (0.88 + 0.08 * (1 - hue))];
    });
  },
  grass: () => pixCanvas(128, (x, y) => {
    const n = fbm(x / 128 * 16, y / 128 * 16, 16, 12, 3);
    return 0.62 + 0.38 * n + (hash2(x, y, 5) - 0.5) * 0.12;
  }),
  water: () => pixCanvas(256, (x, y) => {
    const u = x / 256, v = y / 256;
    const a = fbm(u * 6, v * 6, 6, 41, 3), b = fbm(u * 6 + 3.3, v * 6 + 1.7, 6, 57, 3);
    const c1 = 1 - Math.abs(2 * a - 1), c2 = 1 - Math.abs(2 * b - 1);
    return 0.74 + 0.32 * (Math.pow(c1, 9) + Math.pow(c2, 9)) + 0.12 * (a - 0.5);
  }),
  wood: () => pixCanvas(256, (x, y) => {
    const plank = (y / 32) | 0, pb = 0.78 + 0.22 * hash2(plank, 2, 2);
    const g = vnoise(x / 256 * 3, y / 256 * 64, 3, 64, 11 + plank);
    const edge = Math.min(y % 32, 32 - (y % 32));
    return pb * (0.72 + 0.28 * g) * (0.55 + 0.45 * smooth(0, 1.8, edge));
  }),
  roof: () => pixCanvas(128, (x, y) => {
    const row = (y / 32) | 0, stag = (row % 2) * 8, xs = x + stag;
    const uu = (xs % 16) / 16, v = (y % 32) / 32;
    const tb = 0.78 + 0.22 * hash2(((xs / 16) | 0) % 8, row, 4);
    return tb * (0.66 + 0.34 * Math.sin(PI * uu)) * (0.6 + 0.4 * Math.pow(v, 1.4));
  }),
  sailRed: () => pixCanvas(128, (x, y) => {
    const k = ((x / 16) | 0) % 2, n = 0.93 + 0.07 * fbm(x / 128 * 8, y / 128 * 8, 8, 31, 2);
    const c = k ? [0.66, 0.16, 0.13] : [0.95, 0.9, 0.78]; return [c[0] * n, c[1] * n, c[2] * n];
  }),
  sailBlue: () => pixCanvas(128, (x, y) => {
    const k = ((x / 16) | 0) % 2, n = 0.93 + 0.07 * fbm(x / 128 * 8, y / 128 * 8, 8, 31, 2);
    const c = k ? [0.13, 0.27, 0.52] : [0.95, 0.9, 0.78]; return [c[0] * n, c[1] * n, c[2] * n];
  }),
  weather: () => pixCanvas(256, (x, y) => {
    const u = x / 256, v = y / 256, n = fbm(u * 5, v * 5, 5, 61, 4), r = 1 - Math.abs(2 * fbm(u * 7 + 1.7, v * 7 + 0.4, 7, 83, 3) - 1);
    return clamp(0.9 + 0.2 * (n - 0.5) - 0.12 * Math.pow(r, 16) + (hash2(x, y, 4) - 0.5) * 0.03, 0, 1);
  }),
  stripes: () => pixCanvas(128, (x, y) => {
    const k = ((y / 8) | 0) % 2, n = 0.92 + 0.08 * fbm(x / 128 * 8, y / 128 * 8, 8, 55, 3);
    const c = k ? [0.82, 0.6, 0.34] : [0.97, 0.86, 0.62]; return [c[0] * n, c[1] * n, c[2] * n];
  }),
  rock: () => pixCanvas(256, (x, y) => {
    const u = x / 256, v = y / 256;
    const n = fbm(u * 6, v * 6, 6, 71, 5), r = 1 - Math.abs(2 * fbm(u * 5 + 1.3, v * 5 + 2.1, 5, 91, 3) - 1);
    return clamp(0.68 + 0.36 * (n - 0.5) - 0.2 * Math.pow(r, 14), 0, 1);
  }),
  checker: () => pixCanvas(128, (x, y) => {
    const k = (((x / 32) | 0) + ((y / 32) | 0)) % 2;
    const n = fbm(x / 128 * 6, y / 128 * 6, 6, 4, 3);
    return (k ? 0.98 : 0.3) * (0.9 + 0.1 * n);
  }),
  arcade: () => drawCanvas(256, (g, S) => {
    g.fillStyle = '#d8c8a2'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${90 + (hash2(i, 1, 1) * 40) | 0},${70 + (hash2(i, 2, 1) * 30) | 0},50,${0.05 + hash2(i, 3, 1) * 0.07})`; g.fillRect(hash2(i, 4, 1) * S, hash2(i, 5, 1) * S, 2 + hash2(i, 6, 1) * 4, 1 + hash2(i, 7, 1) * 3); }
    for (let s = 0; s < 2; s++) {
      const y0 = s * 128;
      for (let b = 0; b < 2; b++) {
        const x0 = b * 128;
        const grd = g.createLinearGradient(0, y0 + 18, 0, y0 + 122);
        grd.addColorStop(0, '#1a120c'); grd.addColorStop(1, '#3d2a1c');
        g.fillStyle = grd;
        g.beginPath(); g.moveTo(x0 + 28, y0 + 122); g.lineTo(x0 + 28, y0 + 58); g.arc(x0 + 64, y0 + 58, 36, PI, 0); g.lineTo(x0 + 100, y0 + 122); g.closePath(); g.fill();
        g.strokeStyle = '#efe3c2'; g.lineWidth = 4;
        g.beginPath(); g.arc(x0 + 64, y0 + 58, 39, PI, 0); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
        g.beginPath(); g.arc(x0 + 64, y0 + 58, 42, PI, 0); g.stroke();
        // keystone
        g.fillStyle = '#efe3c2'; g.fillRect(x0 + 61, y0 + 14, 6, 8);
      }
      g.fillStyle = '#b8a577'; g.fillRect(0, y0 + 122, S, 6);
      g.fillStyle = '#efe3c2'; g.fillRect(0, y0 + 121, S, 2);
    }
  }),
  crowd: () => drawCanvas(128, (g, S) => {
    g.fillStyle = '#cdb98f'; g.fillRect(0, 0, S, S);
    const pal = ['#c0392b', '#f4ead6', '#2c4a7a', '#d8a23a', '#7a3b6e', '#4a7a4a', '#e8d9b8', '#a23a26'];
    const skin = ['#d99a7a', '#c48462', '#e6b090', '#a8704f'];
    for (let r = 0; r < 8; r++) {
      const y = r * 16;
      g.fillStyle = 'rgba(70,50,30,0.35)'; g.fillRect(0, y + 14, S, 2);
      for (let i = 0; i < 24; i++) {
        if (hash2(i, r, 7) < 0.12) continue;
        const x = i * 5.3 + hash2(i, r, 8) * 1.2;
        g.fillStyle = pal[(hash2(i, r, 9) * pal.length) | 0]; g.fillRect(x, y + 6, 3.4, 6);
        g.fillStyle = skin[(hash2(i, r, 10) * skin.length) | 0]; g.beginPath(); g.arc(x + 1.7, y + 4.6, 1.7, 0, TAU); g.fill();
      }
    }
  }),
  hiero: () => drawCanvas(256, (g, S) => {
    g.fillStyle = '#e6d9ba'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(120,95,60,${0.04 + hash2(i, 3, 3) * 0.06})`; g.fillRect(hash2(i, 4, 3) * S, hash2(i, 5, 3) * S, 2 + hash2(i, 6, 3) * 5, 1 + hash2(i, 7, 3) * 3); }
    g.strokeStyle = '#6a5233'; g.fillStyle = '#6a5233'; g.lineWidth = 2;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      const x = c * 25.6 + 12.8, y = r * 25.6 + 12.8, k = (hash2(c, r, 5) * 6) | 0;
      g.beginPath();
      if (k === 0) g.arc(x, y, 6, 0, TAU);
      else if (k === 1) { g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.moveTo(x - 6, y - 3); g.lineTo(x + 6, y - 3); }
      else if (k === 2) { g.arc(x, y - 4, 4, 0, TAU); g.moveTo(x, y); g.lineTo(x, y + 9); g.moveTo(x - 5, y + 3); g.lineTo(x + 5, y + 3); }
      else if (k === 3) { g.moveTo(x - 8, y + 4); g.quadraticCurveTo(x, y - 10, x + 8, y + 4); }
      else if (k === 4) { g.rect(x - 6, y - 4, 12, 8); }
      else { g.moveTo(x - 7, y); g.lineTo(x + 7, y); g.moveTo(x - 4, y - 5); g.lineTo(x - 4, y + 5); g.moveTo(x + 4, y - 5); g.lineTo(x + 4, y + 5); }
      g.stroke();
    }
  }),
  poolReflect: () => drawCanvas(256, (g, S) => {
    const bg = g.createLinearGradient(0, 0, 0, S); bg.addColorStop(0, '#2a7fa8'); bg.addColorStop(0.5, '#14587f'); bg.addColorStop(1, '#0b3556');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    const streak = (x, w, len, r, gg, b, a) => { const gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, `rgba(${r},${gg},${b},${a})`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`); g.fillStyle = gr; g.fillRect(x - w / 2, 0, w, len); };
    for (let i = 0; i < 6; i++) streak(S * (0.045 + 0.182 * i + 0.0) + S * 0.0, S * 0.028, S * 0.75, 255, 244, 224, 0.85);
    streak(S * 0.5, S * 0.16, S * 1.0, 255, 205, 110, 0.85); streak(S * 0.5, S * 0.06, S * 1.0, 255, 236, 170, 0.9);
    streak(S * 0.5, S * 0.42, S * 0.5, 255, 190, 90, 0.35);
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 60; i++) g.fillRect(hash2(i, 1, 9) * S, hash2(i, 2, 9) * S, 6 + hash2(i, 3, 9) * 12, 1);
  }),
  glow: () => drawCanvas(64, (g, S) => {
    const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(0.6, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, S, S);
  }),
};
function canvasOf(name) { if (!CANV[name]) CANV[name] = TEXDEF[name](); return CANV[name]; }
function tex(name) {
  if (typeof document === 'undefined') return null;
  if (!TEXS[name]) {
    const t = new THREE.CanvasTexture(canvasOf(name));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    TEXS[name] = t;
  }
  return TEXS[name];
}
function ownTex(name) {           // a private texture object (own offset/repeat) sharing the cached canvas
  const t = new THREE.Texture(canvasOf(name));
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- materials
function std(o) {
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0,
    map: o.map ? (o.own ? ownTex(o.map) : tex(o.map)) : null,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1,
    vertexColors: !!o.vc, side: o.double ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: !!o.flat, transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
  m.userData.wuv = o.wuv || 0; m.userData.jit = o.jit || 0;
  if (o.noCast) m.userData.noCast = true;
  return m;
}
const gold = (extra) => std({ color: 0xffc94a, rough: 0.26, metal: 0.85, emissive: 0x6a4300, ei: 0.55, ...extra });
const PRE = {
  limestone: () => std({ color: 0xeee2c8, map: 'stone', wuv: 4.2, rough: 0.85, vc: 1, jit: 0.05 }),
  limestoneDark: () => std({ color: 0xcfc0a0, map: 'stone', wuv: 4.2, rough: 0.9, vc: 1, jit: 0.06 }),
  sandstone: () => std({ color: 0xdcb070, map: 'stone', wuv: 4.2, rough: 0.92, vc: 1, jit: 0.07 }),
  sandstoneDark: () => std({ color: 0xb98a50, map: 'stone', wuv: 4.2, rough: 0.95, vc: 1, jit: 0.07 }),
  mudbrick: () => std({ color: 0xc9975c, map: 'stone', wuv: 9, rough: 0.95, vc: 1, jit: 0.08 }),
  marble: () => std({ color: 0xf7f2e9, map: 'marble', wuv: 2.6, rough: 0.3, vc: 1, jit: 0.015 }),
  marbleWarm: () => std({ color: 0xf1e6d0, map: 'marble', wuv: 2.6, rough: 0.34, vc: 1, jit: 0.02 }),
  marbleDark: () => std({ color: 0x3a3632, map: 'marble', wuv: 2.6, rough: 0.22, metal: 0.05 }),
  granite: () => std({ color: 0x8b8580, map: 'rock', wuv: 3, rough: 0.7, vc: 1, jit: 0.06 }),
  rock: () => std({ color: 0xa79d8e, map: 'rock', wuv: 3, rough: 0.95, vc: 1, jit: 0.09, flat: true }),
  gold: () => gold(),
  goldDim: () => gold({ color: 0xd8a63a, ei: 0.35 }),
  goldGlow: () => gold({ color: 0xffd25a, emissive: 0xffa41c, ei: 0.9 }),
  bronze: () => std({ color: 0xd08c40, rough: 0.36, metal: 0.65, emissive: 0x3f2008, ei: 0.5 }),
  bronzeDark: () => std({ color: 0x8a5a2a, rough: 0.45, metal: 0.7, emissive: 0x24120a, ei: 0.4 }),
  verdigris: () => std({ color: 0x4fae98, rough: 0.5, metal: 0.4, emissive: 0x0c3a30, ei: 0.5, vc: 1, jit: 0.04 }),
  ebony: () => std({ color: 0x1b1310, rough: 0.34, metal: 0.12 }),
  terracotta: () => std({ color: 0xd06a3c, map: 'roof', wuv: 6, rough: 0.7, vc: 1, jit: 0.06 }),
  terracottaPlain: () => std({ color: 0xc5643a, rough: 0.75, vc: 1, jit: 0.06 }),
  ivory: () => std({ color: 0xf4ead2, rough: 0.35, metal: 0, emissive: 0x2a2010, ei: 0.3 }),
  skin: () => std({ color: 0xe0a880, rough: 0.55 }),
  wood: () => std({ color: 0xa8743e, map: 'wood', wuv: 5, rough: 0.7, vc: 1, jit: 0.07 }),
  woodDark: () => std({ color: 0x6b4526, map: 'wood', wuv: 5, rough: 0.7, vc: 1, jit: 0.06 }),
  sand: () => std({ color: 0xe8cc92, map: 'sand', rough: 1, vc: 1, jit: 0.03 }),
  grass: () => std({ color: 0x6aa843, map: 'grass', rough: 0.95, vc: 1, jit: 0.05 }),
  leaf: () => std({ color: 0x4f9a3a, rough: 0.8, vc: 1, jit: 0.16 }),
  leafDark: () => std({ color: 0x2f6a2c, rough: 0.8, vc: 1, jit: 0.14 }),
  leafLight: () => std({ color: 0x86bb4a, rough: 0.8, vc: 1, jit: 0.12, double: true }),
  cypress: () => std({ color: 0x2b5a2e, rough: 0.85, vc: 1, jit: 0.12 }),
  palmLeaf: () => std({ color: 0x4f9a3a, rough: 0.7, double: true, vc: 1, jit: 0.1 }),
  water: () => std({ color: 0x2bb3c2, map: 'water', own: true, rough: 0.1, metal: 0.05, emissive: 0x0a5560, ei: 0.35 }),
  waterDeep: () => std({ color: 0x1b8aa8, map: 'water', own: true, rough: 0.1, metal: 0.05, emissive: 0x08394f, ei: 0.35 }),
  glowWarm: () => std({ color: 0xffd58a, rough: 0.5, emissive: 0xffa53a, ei: 1.5 }),
  glowFire: () => std({ color: 0xffb040, rough: 0.6, emissive: 0xff7a18, ei: 2.2 }),
  glowFireCore: () => std({ color: 0xfff0b0, rough: 0.6, emissive: 0xffe08a, ei: 2.6 }),
  dark: () => std({ color: 0x1c1612, rough: 0.9 }),
  cloth: () => std({ color: 0xb03a2e, rough: 0.85, double: true }),
  clothBlue: () => std({ color: 0x2a58a8, rough: 0.85, double: true }),
  clothWhite: () => std({ color: 0xeee4cf, rough: 0.85, double: true }),
  hiero: () => std({ color: 0xf2e6c6, map: 'hiero', wuv: 6, rough: 0.85 }),
  sailRed: () => std({ color: 0xffffff, map: 'sailRed', wuv: 5, rough: 0.9, double: true }),
  sailBlue: () => std({ color: 0xffffff, map: 'sailBlue', wuv: 5, rough: 0.9, double: true }),
  crowd: () => std({ color: 0xffffff, map: 'crowd', rough: 0.9 }),
  arcade: () => std({ color: 0xffffff, map: 'arcade', rough: 0.85 }),
  sack: () => std({ color: 0xd8c39a, rough: 0.95, vc: 1, jit: 0.06 }),
  lapis: () => std({ color: 0x27499a, rough: 0.5, metal: 0.05 }),
  cobble: () => std({ color: 0xffffff, map: 'cobble', wuv: 3.2, rough: 0.9, vc: 1, jit: 0.07 }),
};
class MatSet { constructor() { this._c = {}; } make(key, fn) { return this._c[key] || (this._c[key] = fn()); } }
for (const k of Object.keys(PRE)) Object.defineProperty(MatSet.prototype, k, { get() { return this._c[k] || (this._c[k] = PRE[k]()); } });

// ---------------------------------------------------------------- geometry builder (merges by material)
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4(), _c = new THREE.Color();
const _Y = new THREE.Vector3(0, 1, 0), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

class Builder {
  constructor(seed, y0, parent) {
    this.parent = parent || null;
    this.rnd = parent ? parent.rnd : rng(seed);
    this.root = new THREE.Group(); this.root.position.y = y0 || 0;
    this.buckets = new Map(); this.meshes = new Map(); this.children = [];
    this.emis = parent ? parent.emis : new Set();      // emissive materials / meshes
    this.extraEmissive = parent ? parent.extraEmissive : [];
  }
  sub(y0 = 0) { const b = new Builder(0, y0, this); this.children.push(b); this.root.add(b.root); return b; }
  // child builder whose group rotates about (px,py,pz) while you keep adding in the parent's coordinates
  pivot(px, py, pz) { const b = new Builder(0, 0, this); b.root.position.set(px, py, pz); b.shift = [px, py, pz]; this.children.push(b); this.root.add(b.root); return b; }
  glowMat(mat) { this.emis.add(mat); return mat; }
  // ---- generic add: applies transform, world-UV, vertex colour, and queues by material
  add(geo, mat, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (o.m) _m.copy(o.m);
    else {
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0); _q.setFromEuler(_e); _p.set(o.x || 0, o.y || 0, o.z || 0);
      const s = o.s ?? 1; _s.set(o.sx ?? s, o.sy ?? s, o.sz ?? s); _m.compose(_p, _q, _s);
    }
    g.applyMatrix4(_m);
    if (this.shift) g.translate(-this.shift[0], -this.shift[1], -this.shift[2]);
    const uv = g.attributes.uv;
    if (o.wuv && mat.userData.wuv) {
      const P = g.attributes.position, S = mat.userData.wuv;
      for (let i = 0; i < n; i += 3) {
        const ax = P.getX(i), ay = P.getY(i), az = P.getZ(i);
        const ux = P.getX(i + 1) - ax, uy = P.getY(i + 1) - ay, uz = P.getZ(i + 1) - az, vx = P.getX(i + 2) - ax, vy = P.getY(i + 2) - ay, vz = P.getZ(i + 2) - az;
        const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
        for (let k = 0; k < 3; k++) {
          const X = P.getX(i + k), Y = P.getY(i + k), Z = P.getZ(i + k);
          if (ny >= nx && ny >= nz) uv.setXY(i + k, X * S, Z * S); else if (nx >= nz) uv.setXY(i + k, Z * S, Y * S); else uv.setXY(i + k, X * S, Y * S);
        }
      }
    }
    if (o.uvswap) for (let i = 0; i < n; i++) { const a = uv.getX(i); uv.setXY(i, uv.getY(i), a); }
    if (o.uvs) { const su = Array.isArray(o.uvs) ? o.uvs[0] : o.uvs, sv = Array.isArray(o.uvs) ? o.uvs[1] : o.uvs; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
    if (o.uvo) for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) + o.uvo[0], uv.getY(i) + o.uvo[1]);
    if (mat.vertexColors) {
      const col = new Float32Array(n * 3);
      let t = 1, r = 1, gg = 1, b = 1; const jit = mat.userData.jit;
      if (jit) t += (this.rnd() - 0.5) * 2 * jit;
      if (o.tint !== undefined) t *= o.tint;
      if (o.col !== undefined) { _c.set(o.col); r = _c.r; gg = _c.g; b = _c.b; }
      for (let i = 0; i < n; i++) { col[i * 3] = r * t; col[i * 3 + 1] = gg * t; col[i * 3 + 2] = b * t; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    let list = this.buckets.get(mat); if (!list) { list = []; this.buckets.set(mat, list); }
    list.push(g);
    return g;
  }
  // ---- primitives (box/cyl/cone are base-anchored: y is the bottom)
  box(mat, w, h, d, x = 0, y = 0, z = 0, o = {}) { return this.add(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), mat, { x, y, z, wuv: true, ...o }); }
  cyl(mat, rt, rb, h, x = 0, y = 0, z = 0, seg = 14, o = {}) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1).translate(0, h / 2, 0), mat, { x, y, z, ...o }); }
  cone(mat, r, h, x = 0, y = 0, z = 0, seg = 12, o = {}) { return this.add(new THREE.ConeGeometry(r, h, seg, 1).translate(0, h / 2, 0), mat, { x, y, z, ...o }); }
  sph(mat, r, x = 0, y = 0, z = 0, o = {}) { return this.add(new THREE.SphereGeometry(r, o.ws || 12, o.hs || 8), mat, { x, y, z, ...o }); }
  ell(mat, rx, ry, rz, x = 0, y = 0, z = 0, o = {}) { return this.add(new THREE.SphereGeometry(1, o.ws || 12, o.hs || 8), mat, { x, y, z, sx: rx, sy: ry, sz: rz, ...o }); }
  lathe(mat, pts, x = 0, y = 0, z = 0, seg = 16, o = {}) { return this.add(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg), mat, { x, y, z, ...o }); }
  // shape in XY -> extruded upwards (shape y == world z), base anchored
  ext(mat, shape, depth, x = 0, y = 0, z = 0, o = {}) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: o.cs || 10 });
    g.rotateX(PI / 2); g.translate(0, depth, 0);
    return this.add(g, mat, { x, y, z, ...o });
  }
  // shape in XY extruded along z (centred on z), e.g. pediments
  extZ(mat, shape, depth, x = 0, y = 0, z = 0, o = {}) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: o.cs || 10 });
    g.translate(0, 0, -depth / 2);
    return this.add(g, mat, { x, y, z, wuv: false, ...o });
  }
  // rectangular frustum (hip roof / tapered block): base w x d, top scaled by topFrac; base-anchored
  hip(mat, w, d, h, topFrac, x = 0, y = 0, z = 0, o = {}) {
    const g = new THREE.CylinderGeometry(topFrac * 0.7071, 0.7071, h, 4, 1).rotateY(PI / 4).translate(0, h / 2, 0);
    return this.add(g, mat, { x, y, z, sx: w, sz: d, wuv: true, ...o });
  }
  // tapered cylinder between two points (arrays)
  limb(mat, a, b, r0, r1, seg = 8, o = {}) {
    _v1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = _v1.length(); if (len < 1e-6) return;
    _v1.multiplyScalar(1 / len); _q.setFromUnitVectors(_Y, _v1);
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    return this.add(new THREE.CylinderGeometry(r1, r0, len, seg, 1, o.open), mat, { ...o, m: _m });
  }
  // rectangular beam between two points
  beam(mat, a, b, w, d, o = {}) {
    _v1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = _v1.length(); if (len < 1e-6) return;
    _v1.multiplyScalar(1 / len); _q.setFromUnitVectors(_Y, _v1);
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    return this.add(new THREE.BoxGeometry(w, len, d), mat, { ...o, m: _m });
  }
  tube(mat, pts, r, tseg = 12, rseg = 5, o = {}) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    return this.add(new THREE.TubeGeometry(curve, tseg, r, rseg, false), mat, o);
  }
  // terrain mesh (unmerged, excluded from bounds checks)
  ground(geo, mat) {
    if (mat.vertexColors && !geo.attributes.color) { const n = geo.attributes.position.count; geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
    const g = this.mesh(geo, mat, null, false); g.userData.ground = true; g.userData.noBounds = true; return g; }
  // free-standing (unmerged) mesh, e.g. animated objects
  mesh(geo, mat, parent, cast = true) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true;
    (parent || this.root).add(m); return m;
  }
  finish() {
    for (const [mat, list] of this.buckets) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!geo) throw new Error('mergeGeometries failed for a material bucket');
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !mat.userData.noCast; mesh.receiveShadow = true;
      this.root.add(mesh); this.meshes.set(mat, mesh);
    }
    this.buckets.clear();
    for (const c of this.children) c.finish();
  }
  meshOf(mat) { const m = this.meshes.get(mat); if (m) return m; for (const c of this.children) { const r = c.meshOf(mat); if (r) return r; } return null; }
}

// ---------------------------------------------------------------- shapes & terrain
function chamferShape(hw, hd, c) {
  const s = new THREE.Shape();
  s.moveTo(-hw + c, -hd); s.lineTo(hw - c, -hd); s.lineTo(hw, -hd + c); s.lineTo(hw, hd - c);
  s.lineTo(hw - c, hd); s.lineTo(-hw + c, hd); s.lineTo(-hw, hd - c); s.lineTo(-hw, -hd + c); s.closePath();
  return s;
}
function chamferPoly(hw, hd, c) { return [[-hw + c, -hd], [hw - c, -hd], [hw, -hd + c], [hw, hd - c], [hw - c, hd], [-hw + c, hd], [-hw, hd - c], [-hw, -hd + c]]; }
function rayPoly(poly, ang) {
  const dx = Math.cos(ang), dy = Math.sin(ang); let best = 1e9;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], ex = q[0] - p[0], ey = q[1] - p[1];
    const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
    const t = (p[0] * ey - p[1] * ex) / den, u = (p[0] * dy - p[1] * dx) / den;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
  }
  return best;
}
const GROUND = { hw: 0.675, hd: 0.435, c: 0.15 };     // usable ground outline on top of the plinth
// Polar-grid terrain conforming to the chamfered-rect outline. fn(x,z,rho)->height
function terrainGeo(fn, o = {}) {
  const { hw, hd, c } = { ...GROUND, ...o }; const nr = o.nr || 16, ns = o.ns || 72, rim = o.rim ?? 0.012, uvs = o.uvs ?? 2.5;
  const poly = chamferPoly(hw, hd, c);
  const R = []; for (let j = 0; j < ns; j++) R.push(rayPoly(poly, j / ns * TAU));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nr; i++) {
    const rho = i / nr;
    for (let j = 0; j < ns; j++) {
      const a = j / ns * TAU, x = Math.cos(a) * R[j] * rho, z = Math.sin(a) * R[j] * rho;
      const fall = o.fall === false ? 1 : 1 - smooth(0.7, 1.0, rho);
      const y = (o.fn === false ? 0 : fn(x, z, rho)) * fall + (o.level ?? 0) + rim * smooth(0.8, 1, rho);
      pos.push(x, y, z); uv.push(x * uvs, z * uvs);
    }
  }
  const skirt = (nr + 1) * ns;
  for (let j = 0; j < ns; j++) { const k = nr * ns + j; pos.push(pos[k * 3], 0, pos[k * 3 + 2]); uv.push(pos[k * 3] * uvs, pos[k * 3 + 2] * uvs); }
  for (let i = 0; i < nr; i++) for (let j = 0; j < ns; j++) {
    const a = i * ns + j, b = i * ns + (j + 1) % ns, cc = (i + 1) * ns + j, d = (i + 1) * ns + (j + 1) % ns;
    idx.push(a, b, cc, b, d, cc);
  }
  for (let j = 0; j < ns; j++) { const a = nr * ns + j, b = nr * ns + (j + 1) % ns, cc = skirt + j, d = skirt + (j + 1) % ns; idx.push(a, b, cc, b, d, cc); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// animated water surface (unmerged mesh). returns {mesh, update}
function waterSurface(B, mat, o = {}) {
  const g = terrainGeo(() => 0, { ...(o.hw ? { hw: o.hw, hd: o.hd, c: o.c } : {}), nr: 10, ns: 56, rim: 0, fall: false, level: o.level ?? 0.03, uvs: o.uvs ?? 1.6 });
  const base = g.attributes.position.array.slice();
  const mesh = B.mesh(g, mat, o.parent, false); mesh.receiveShadow = true; mesh.userData.ground = true; mesh.userData.noBounds = true;
  const amp = o.amp ?? 0.004, sp = o.speed ?? 1;
  const P = g.attributes.position; const n = (10 + 1) * 56;
  return {
    mesh,
    update(t) {
      for (let i = 0; i < n; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        P.array[i * 3 + 1] = base[i * 3 + 1] + amp * (Math.sin(x * 9 + t * 1.7 * sp) + Math.sin(z * 11 - t * 1.3 * sp) + 0.6 * Math.sin((x + z) * 15 + t * 2.4 * sp));
      }
      P.needsUpdate = true;
      const mp = mat.map; if (mp) { mp.offset.set(t * 0.018 * sp, t * 0.011 * sp); }
    },
  };
}

// ---------------------------------------------------------------- plinth
function buildPlinth(P, M) {
  const L = [
    [0.74, 0.5, 0.18, 0, 0.045, M.ebony],
    [0.728, 0.488, 0.176, 0.045, 0.012, M.gold],
    [0.715, 0.475, 0.17, 0.057, 0.033, M.ebony],
    [0.70, 0.46, 0.165, 0.09, 0.01, M.marbleDark],
  ];
  for (const [hw, hd, c, y0, h, mat] of L) P.ext(mat, chamferShape(hw, hd, c), h, 0, y0, 0, { wuv: false, uvs: 1 });
  // thin gold inlay ring
  const ring = chamferShape(0.69, 0.45, 0.16); ring.holes.push(new THREE.Path(chamferShape(0.68, 0.44, 0.155).getPoints().reverse()));
  P.ext(M.gold, ring, 0.003, 0, 0.1, 0);
  // little gold corner studs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.sph(M.gold, 0.016, sx * 0.615, 0.045, sz * 0.405, { ws: 8, hs: 6, sy: 0.7 });
}

// ---------------------------------------------------------------- glow sprite
function glowSprite(color, size, opacity = 0.7) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.set(size, size, 1); s.userData.noBounds = true; s.userData.baseOpacity = opacity; s.renderOrder = 5;
  return s;
}

// ---------------------------------------------------------------- shared props
// fluted shaft: alternating-radius star ring -> flat-shaded flutes.  Base-anchored, axis +y.
function flutedGeo(rb, rt, h, n = 8, rings = 2, dep = 0.16, ent = 0.04) {
  const M = n * 2, pos = [], uv = [];
  const V = (r, j) => {
    const a = j / M * TAU, k = (j % 2 === 0) ? 1 : 1 - dep, t = r / rings, rad = lerp(rb, rt, t) * (1 + ent * Math.sin(PI * t));
    return [Math.cos(a) * rad * k, t * h, Math.sin(a) * rad * k, j / M, t];
  };
  const push = (...vs) => { for (const v of vs) { pos.push(v[0], v[1], v[2]); uv.push(v[3], v[4]); } };
  for (let r = 0; r < rings; r++) for (let j = 0; j < M; j++) {
    const a = V(r, j), b = V(r, j + 1), c = V(r + 1, j), d = V(r + 1, j + 1);
    push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); return g;
}
// Column with base, fluted shaft and capital. y0 = bottom, h = total height, r = shaft radius at the base.
function column(B, mat, x, z, y0, h, r, style = 'ionic', capMat) {
  capMat = capMat || mat;
  const baseH = r * 0.5, capH = style === 'corinthian' ? r * 1.7 : style === 'doric' ? r * 0.85 : r * 1.05;
  const shH = h - baseH - capH;
  if (style !== 'doric') {
    B.cyl(mat, r * 1.25, r * 1.32, baseH * 0.55, x, y0, z, 8, { wuv: false });
    B.cyl(mat, r * 1.02, r * 1.2, baseH * 0.45, x, y0 + baseH * 0.55, z, 8, { wuv: false });
  }
  const y1 = y0 + (style === 'doric' ? 0 : baseH);
  B.add(flutedGeo(r, r * 0.8, shH + (style === 'doric' ? baseH : 0), 8, 2), mat, { x, y: y1, z });
  const yc = y0 + h - capH;
  if (style === 'ionic') {
    B.cyl(capMat, r * 1.02, r * 0.82, capH * 0.28, x, yc, z, 8, { wuv: false });
    B.box(capMat, r * 2.0, capH * 0.34, r * 1.35, x, yc + capH * 0.28, z);
    for (const s of [-1, 1]) B.add(new THREE.CylinderGeometry(r * 0.5, r * 0.5, r * 1.5, 7), capMat, { x: x + s * r * 1.02, y: yc + capH * 0.44, z, rx: PI / 2 });
    B.box(capMat, r * 3.0, capH * 0.2, r * 2.0, x, yc + capH * 0.8, z);
  } else if (style === 'doric') {
    B.cyl(capMat, r * 1.15, r * 0.8, capH * 0.5, x, yc, z, 8, { wuv: false });
    B.box(capMat, r * 2.7, capH * 0.5, r * 2.7, x, yc + capH * 0.5, z);
  } else {
    B.cyl(capMat, r * 1.35, r * 0.82, capH * 0.78, x, yc, z, 8, { wuv: false });
    B.cyl(capMat, r * 1.42, r * 1.42, capH * 0.06, x, yc + capH * 0.36, z, 8, { wuv: false });
    B.box(capMat, r * 2.9, capH * 0.22, r * 2.9, x, yc + capH * 0.78, z);
  }
}
function steps(B, mat, cx, cz, w, d, n, stepH, inset, y0 = 0) {
  for (let i = 0; i < n; i++) B.box(mat, w - 2 * inset * i, stepH, d - 2 * inset * i, cx, y0 + i * stepH, cz);
  return y0 + n * stepH;
}
// triangular pediment (frame ring + recessed tympanum) centred on x,z; base at y
function pediment(B, o) {
  const { x = 0, y = 0, z = 0, w, rise, depth = 0.04, frame, field, bw = 0.018 } = o;
  const tri = (hw, r, y0 = 0) => { const s = new THREE.Shape(); s.moveTo(-hw, y0); s.lineTo(hw, y0); s.lineTo(0, y0 + r); s.closePath(); return s; };
  const hw = w / 2, sl = rise / hw, k = Math.sqrt(1 + sl * sl);
  const ihw = hw - bw * (1 + k) / sl, irise = rise - bw * k - bw;
  const outer = tri(hw, rise);
  const inner = tri(ihw, irise, bw);
  outer.holes.push(new THREE.Path(inner.getPoints()));
  B.extZ(frame, outer, depth, x, y, z, { ry: o.ry || 0 });
  if (field) B.extZ(field, tri(ihw + 0.001, irise + 0.001, bw - 0.001), depth * 0.5, x, y, z, { ry: o.ry || 0 });
}
// two sloped roof slabs over a gable of width w / depth d
function pitchedRoof(B, mat, x, y, z, w, d, rise, thick = 0.02, over = 0.025, ry = 0) {
  const ang = Math.atan2(rise, w / 2), L = Math.hypot(w / 2, rise) + over;
  for (const s of [-1, 1]) {
    const lx = s * (w / 4 + over * 0.2), ly = rise / 2 + thick / (2 * Math.cos(ang)) - over * 0.15;
    const c = Math.cos(ry), sn = Math.sin(ry);
    B.add(new THREE.BoxGeometry(L, thick, d), mat, { x: x + lx * c, y: y + ly, z: z - lx * sn, ry, rz: -s * ang, wuv: true, uvswap: true });
  }
  // ridge
  B.cyl(mat, thick * 0.55, thick * 0.55, d + 0.01, x - Math.sin(ry) * (d + 0.01) / 2, y + rise + thick * 0.55, z - Math.cos(ry) * (d + 0.01) / 2, 6, { rx: PI / 2, ry });
}
function leafGeo(len, wid, lift, droop, segs = 5) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, X = t * len, Y = lift * t - droop * t * t, w = wid * Math.sin(PI * Math.pow(t, 0.55)) * 0.5;
    pos.push(X, Y - w * 0.35, -w, X, Y, 0, X, Y - w * 0.35, w);
  }
  for (let i = 0; i < segs; i++) { const a = i * 3, b = (i + 1) * 3; idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function palm(B, m, x, y, z, h, lean = 0.12, rot = 0, seed = 1) {
  const P = [], N = 5;
  for (let i = 0; i <= N; i++) { const t = i / N; P.push([x + Math.cos(rot) * lean * h * t * t, y + h * t, z + Math.sin(rot) * lean * h * t * t]); }
  for (let i = 0; i < N; i++) B.limb(m.woodDark, P[i], P[i + 1], h * 0.032 * (1 - i / N * 0.45), h * 0.032 * (1 - (i + 1) / N * 0.45), 6, { wuv: false });
  const top = P[N];
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU + hash2(i, seed, 3) * 0.5, L = h * (0.42 + 0.14 * hash2(i, seed, 4));
    B.add(leafGeo(L, h * 0.14, h * 0.12, h * 0.42 + hash2(i, seed, 5) * h * 0.12), m.palmLeaf, { x: top[0], y: top[1], z: top[2], ry: a });
  }
  B.sph(m.woodDark, h * 0.03, top[0], top[1] - h * 0.02, top[2], { ws: 6, hs: 4 });
}
function blobGeo(r, detail, jit, seed, sy = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const k = 1 + (hash2(Math.round(x * 997 / r), Math.round(y * 991 / r + z * 983 / r), seed) - 0.5) * jit;
    P.setXYZ(i, x * k, y * k * sy, z * k);
  }
  g.computeVertexNormals(); return g;
}
function roundTree(B, m, x, y, z, h, seed = 1, leafMat) {
  leafMat = leafMat || m.leaf;
  const th = h * 0.46;
  B.limb(m.woodDark, [x, y, z], [x + 0.002, y + th, z], h * 0.03, h * 0.02, 5, { wuv: false });
  B.add(blobGeo(h * 0.3, 1, 0.35, seed), leafMat, { x, y: y + th + h * 0.2, z });
  B.add(blobGeo(h * 0.22, 0, 0.4, seed + 1), leafMat, { x: x + h * 0.14, y: y + th + h * 0.08, z: z + h * 0.05 });
  B.add(blobGeo(h * 0.2, 0, 0.4, seed + 2), m.leafLight, { x: x - h * 0.13, y: y + th + h * 0.1, z: z - h * 0.06 });
}
function cypressGeo(h, r, seed) {
  const N = 9, pts = [];
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(new THREE.Vector2(i === N ? 0 : r * Math.pow(Math.sin(PI * Math.min(t * 0.95 + 0.05, 1)), 0.65) * (1 - 0.25 * t), t * h)); }
  const seg = 8, g = new THREE.LatheGeometry(pts, seg), P = g.attributes.position, np = pts.length;
  for (let i = 0; i < P.count; i++) {
    const si = Math.floor(i / np) % seg, pj = i % np, k = 1 + (hash2(si, pj, seed) - 0.5) * 0.4;
    P.setXYZ(i, P.getX(i) * k, P.getY(i), P.getZ(i) * k);
  }
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); return ng;
}
function cypress(B, m, x, y, z, h, r, seed = 1) {
  B.cyl(m.woodDark, r * 0.12, r * 0.16, h * 0.14, x, y, z, 5, { wuv: false });
  B.add(cypressGeo(h * 0.94, r, seed), m.cypress, { x, y: y + h * 0.06, z, ry: seed });
}
function obelisk(B, m, x, y, z, h, w, ry = 0, capMat) {
  B.box(m.limestoneDark, w * 2.0, h * 0.06, w * 2.0, x, y, z, { ry });
  const bh = h * 0.86;
  B.cyl(m.hiero, w * 0.52 * 1.414, w * 0.72 * 1.414, bh, x, y + h * 0.06, z, 4, { ry: ry + PI / 4, wuv: false, uvs: [2, 2] });
  B.cone(capMat || m.gold, w * 0.52 * 1.414, h * 0.08, x, y + h * 0.06 + bh, z, 4, { ry: ry + PI / 4 });
}


function ribbedDome(r, h, n = 12, dep = 0.05, rings = 6) {
  const pts = [];
  for (let i = 0; i <= rings; i++) { const a = i / rings * PI / 2; pts.push(new THREE.Vector2(Math.max(0.0001, Math.cos(a) * r), Math.sin(a) * h)); }
  const g = new THREE.LatheGeometry(pts, n * 2), P = g.attributes.position, np = pts.length;
  for (let i = 0; i < P.count; i++) { const si = Math.floor(i / np) % (n * 2); const k = si % 2 ? 1 - dep : 1; P.setXYZ(i, P.getX(i) * k, P.getY(i), P.getZ(i) * k); }
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); return ng;
}
// arched window: dark frame + glowing pane. (x,y,z) = bottom centre on the wall surface, facing direction ry
function arcWin(B, m, x, y, z, w, h, ry = 0, glow) {
  glow = glow || m.glowWarm;
  const cs = Math.cos(ry), sn = Math.sin(ry);
  B.box(m.dark, w + 0.008, h, 0.008, x, y, z, { ry });
  B.add(archTop((w + 0.008) / 2, 0.008, 6), m.dark, { x, y: y + h, z, rx: PI / 2, ry });
  const fx = x + sn * 0.0025, fz = z + cs * 0.0025;
  B.box(glow, w, h, 0.008, fx, y, fz, { ry });
  B.add(archTop(w / 2, 0.008, 6), glow, { x: fx, y: y + h, z: fz, rx: PI / 2, ry });
  B.glowMat(glow);
}
// flickering flame (unmerged meshes) + optional halo sprite. returns the outer mesh
function flame(B, m, ctx, x, y, z, size = 0.05, halo = 0, parent = null) {
  const prof = (r, h) => [[0.0001, 0], [r * 0.7, h * 0.12], [r, h * 0.38], [r * 0.75, h * 0.68], [r * 0.32, h * 0.9], [0.0001, h]].map(p => new THREE.Vector2(p[0], p[1]));
  const o = B.mesh(new THREE.LatheGeometry(prof(size * 0.45, size), 8), m.glowFire, parent, false); o.position.set(x, y, z);
  const c = B.mesh(new THREE.LatheGeometry(prof(size * 0.25, size * 0.7), 8), m.glowFireCore, parent, false); c.position.set(x, y, z);
  o.userData.noBounds = c.userData.noBounds = true;
  ctx.emissive.push(o, c);
  const ph = hash2(Math.round(x * 100), Math.round(z * 100), 7) * 10;
  let sp = null;
  if (halo) { sp = glowSprite(0xffa03a, halo, 0.55); sp.position.set(x, y + size * 0.5, z); if (parent) parent.add(sp); ctx.glows.push(sp); }
  ctx.anim.push((t) => {
    const f = 1 + 0.16 * Math.sin(t * 11 + ph) + 0.09 * Math.sin(t * 17.3 + ph * 2) + 0.05 * Math.sin(t * 29 + ph * 3);
    o.scale.set(1 - 0.07 * (f - 1) * 4, f, 1 - 0.07 * (f - 1) * 4); c.scale.set(1, f * 0.95 + 0.03 * Math.sin(t * 23 + ph), 1);
    o.rotation.y = t * 0.7; if (sp) pulseProp(sp.material, 'opacity', (f - 1) * 0.9);
  });
  return o;
}

function ellipseShape(rx, rz, hole) {
  const s = new THREE.Shape(); s.absellipse(0, 0, rx, rz, 0, TAU, false, 0);
  if (hole) { const p = new THREE.Path(); p.absellipse(0, 0, rx - hole, rz - hole, 0, TAU, true, 0); s.holes.push(p); }
  return s;
}
const disc = (n = 24) => new THREE.CircleGeometry(1, n).rotateX(-PI / 2);       // unit flat disc (y up)

// half cylinder (upper half after rotating by PI/2 about x): tops of arches
const archTop = (r, thick, seg = 6) => new THREE.CylinderGeometry(r, r, thick, seg, 1, false, PI / 2, PI);

// ---- ships -----------------------------------------------------------------
function hullGeo(hb, top, keel, L, K = 22, J = 7) {
  const pos = [], uv = [], idx = [], cols = 2 * J + 1;
  for (let k = 0; k <= K; k++) {
    const u = k / K * 2 - 1, b = hb(u), tp = top(u), kl = keel(u);
    for (let j = 0; j <= 2 * J; j++) {
      const ph = j / (2 * J) * PI;
      pos.push(b * Math.cos(ph), tp - (tp - kl) * Math.pow(Math.sin(ph), 0.8), u * L / 2); uv.push(j / (2 * J) * 3, k / K * 5);
    }
  }
  for (let k = 0; k < K; k++) for (let j = 0; j < 2 * J; j++) { const a = k * cols + j, b = a + 1, c = a + cols, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function deckGeo(hb, top, L, K = 22) {
  const pos = [], uv = [], idx = [];
  for (let k = 0; k <= K; k++) { const u = k / K * 2 - 1, b = hb(u) * 0.98, y = top(u) - 0.004; pos.push(-b, y, u * L / 2, b, y, u * L / 2); uv.push(-b * 9, u * L / 2 * 9, b * 9, u * L / 2 * 9); }
  for (let k = 0; k < K; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// sail/cloth in the XY plane hanging down from y=0, bulging toward +z
function sailGeo(w, h, bulge, nx = 8, ny = 5, taper = 0) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny, ww = w * (1 - taper * v);
    pos.push((u - 0.5) * ww, -v * h, bulge * Math.sin(PI * u) * (0.35 + 0.65 * Math.sin(PI * (0.1 + 0.9 * v) * 0.95))); uv.push(u, 1 - v);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// draped cloth with vertical folds
function clothGeo(w, h, folds, amp, nx = 10, ny = 4, flare = 0.25) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny, ww = w * (1 + flare * v);
    pos.push((u - 0.5) * ww, -v * h, amp * Math.sin(folds * TAU * u + v * 1.3) * (0.25 + 0.75 * v)); uv.push(u, 1 - v);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// Builds a ship in its own sub-builder (origin = waterline centre, bow toward +z). o: {L,beam,depth,sheer,oars,mast,sail}
function ship(B, m, o) {
  const sb = B.sub(o.y || 0);
  const L = o.L, beam = o.beam, depth = o.depth ?? beam * 0.6, sheer = o.sheer ?? beam * 0.7, fb = o.fb ?? beam * 0.3;
  const hb = u => beam / 2 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.4)), 0.55);
  const top = u => fb + sheer * Math.pow(Math.abs(u), 3);
  const keel = u => -depth * (1 - Math.pow(Math.abs(u), 1.8));
  const hull = o.hull || m.make('hull', () => std({ color: 0xa8683a, map: 'wood', wuv: 0, rough: 0.65, double: true }));
  const deckM = m.make('deck', () => std({ color: 0xd0a26a, map: 'wood', rough: 0.7 }));
  const trim = o.trim || m.gold;
  sb.add(hullGeo(hb, top, keel, L), hull, { uvs: 1 });
  sb.add(deckGeo(hb, top, L), deckM);
  for (const s of [-1, 1]) {
    const pts = []; for (let k = 0; k <= 12; k++) { const u = k / 12 * 2 - 1; pts.push([s * hb(u), top(u) + 0.001, u * L / 2]); }
    sb.tube(trim, pts, beam * 0.045, 18, 4);
    const pw = []; for (let k = 0; k <= 12; k++) { const u = (k / 12 * 2 - 1) * 0.92; pw.push([s * (hb(u) + 0.001), top(u) * 0.3, u * L / 2]); }
    sb.tube(m.dark, pw, beam * 0.04, 18, 4);
  }
  // ram, stem post, eye
  sb.limb(m.bronze, [0, -depth * 0.05, L / 2 - 0.01], [0, -depth * 0.06, L / 2 + beam * 0.85], beam * 0.13, beam * 0.02, 6);
  sb.tube(hull, [[0, top(1) * 0.7, L / 2 - 0.002], [0, top(1) + beam * 0.35, L / 2 - 0.004], [0, top(1) + beam * 0.7, L / 2 - beam * 0.15]], beam * 0.05, 8, 4);
  for (const s of [-1, 1]) { sb.add(new THREE.CylinderGeometry(beam * 0.09, beam * 0.09, 0.003, 10), m.clothWhite, { x: s * (hb(0.86) + 0.002), y: top(0.86) * 0.62, z: 0.86 * L / 2, rz: PI / 2 }); sb.sph(m.dark, beam * 0.04, s * (hb(0.86) + 0.004), top(0.86) * 0.62, 0.86 * L / 2, { ws: 6, hs: 4 }); }
  // stern ornament (aphlaston)
  sb.tube(m.gold, [[0, top(-1) * 0.8, -L / 2 + 0.004], [0, top(-1) + beam * 0.55, -L / 2 - beam * 0.05], [0, top(-1) + beam * 1.1, -L / 2 + beam * 0.1], [0, top(-1) + beam * 1.25, -L / 2 + beam * 0.4]], beam * 0.05, 10, 4);
  sb.box(m.bronze, beam * 0.5, beam * 0.5, 0.003, 0, top(-1) + beam * 0.65, -L / 2 + beam * 0.02, { wuv: false, rx: 0.2 });
  // shields + oars
  const n = o.oars || 0;
  for (let i = 0; i < n; i++) {
    const u = -0.62 + 1.2 * (n > 1 ? i / (n - 1) : 0.5), z = u * L / 2;
    for (const s of [-1, 1]) {
      const px = s * (hb(u) + 0.001), py = top(u) - beam * 0.06;
      const dir = new THREE.Vector3(s * 0.8, -0.55, -0.35).normalize(), len = o.oarLen || L * 0.3;
      const tip = [px + dir.x * len, py + dir.y * len, z + dir.z * len];
      sb.limb(m.wood, [px - s * 0.012, py + 0.006, z + 0.004], tip, beam * 0.03, beam * 0.02, 5);
      sb.beam(m.wood, tip, [tip[0] + dir.x * len * 0.28, tip[1] + dir.y * len * 0.28, tip[2] + dir.z * len * 0.28], beam * 0.16, 0.003);
      if (o.shields) sb.add(new THREE.CylinderGeometry(beam * 0.14, beam * 0.14, 0.003, 10), i % 2 ? m.bronze : m.cloth, { x: s * (hb(u) + 0.003), y: top(u) - beam * 0.02, z: z + L * 0.02, rz: PI / 2 });
    }
  }
  // mast, yard, sail
  if (o.mast) {
    const mz = (o.mastU ?? 0.08) * L / 2, mt = top(o.mastU ?? 0.08), mh = o.mast;
    sb.limb(m.wood, [0, mt, mz], [0, mt + mh, mz], beam * 0.045, beam * 0.028, 6);
    sb.sph(m.gold, beam * 0.05, 0, mt + mh + beam * 0.03, mz, { ws: 6, hs: 5 });
    const yw = o.yard || beam * 2.6, yy = mt + mh * 0.93, br = o.brace || 0, bc = Math.cos(br), bs = Math.sin(br);
    sb.beam(m.wood, [-yw / 2 * bc, yy, mz + yw / 2 * bs], [yw / 2 * bc, yy, mz - yw / 2 * bs], beam * 0.05, beam * 0.05);
    if (o.sail) sb.add(sailGeo(yw * 0.94, mh * 0.66, beam * 0.5, 8, 5, 0.12), o.sail, { x: 0.004 * bs, y: yy - 0.004, z: mz + 0.004 * bc, ry: br, uvs: 1 });
    sb.limb(m.dark, [0, mt + mh, mz], [0, top(1) + beam * 0.5, L / 2 - 0.01], 0.0013, 0.0013, 3);
    sb.limb(m.dark, [0, mt + mh, mz], [0, top(-1) + beam * 0.9, -L / 2 + 0.01], 0.0013, 0.0013, 3);
    if (o.pennant) sb.add(sailGeo(beam * 0.5, beam * 0.16, 0.004, 3, 1, 0.9), o.pennant, { x: beam * 0.28, y: mt + mh + beam * 0.02, z: mz, ry: PI / 2 });
  }
  return { g: sb.root, top, hb, L, beam };
}

// small draped statuette on the ground/plinth (bottom at y)
function statuette(B, m, x, y, z, h, robe, skin, o = {}) {
  const P = [[0.001, 0], [0.2, 0], [0.19, 0.05], [0.15, 0.35], [0.11, 0.55], [0.14, 0.66], [0.09, 0.76], [0.001, 0.8]].map(p => [p[0] * h, p[1] * h]);
  B.lathe(robe, P, x, y, z, 8, { ry: o.ry || 0 });
  B.sph(skin, 0.075 * h, x, y + 0.87 * h, z, { ws: 8, hs: 6 });
  const ry = o.ry || 0, c = Math.cos(ry), sn = Math.sin(ry);
  for (const s of [-1, 1]) B.limb(skin, [x + c * s * 0.1 * h, y + 0.74 * h, z - sn * s * 0.1 * h], [x + c * s * 0.19 * h + sn * (o.arm ? 0.1 * h : 0), y + (o.arm ? 0.9 : 0.55) * h, z - sn * s * 0.19 * h + c * (o.arm ? 0.1 * h : 0.05 * h)], 0.035 * h, 0.03 * h, 5);
  if (o.crown) B.cone(o.crown, 0.09 * h, 0.16 * h, x, y + 0.92 * h, z, 6);
}

// stylised horse, length along +z (nose at +z). Built in unit-ish coords (height ~1.05), scaled by sc.
// pose: 0 standing, 1 galloping (front legs raised), 2 rearing-ish
function horse(B, mat, x, y, z, sc, ry = 0, pose = 1, maneMat) {
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sc, sc, sc));
  const T = (px, py, pz) => { const v = new THREE.Vector3(px, py, pz).applyMatrix4(M); return [v.x, v.y, v.z]; };
  const el = (rx, ry_, rz, px, py, pz, rot = 0) => { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot, 0, 0)); const mm = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(rx, ry_, rz)); B.add(new THREE.SphereGeometry(1, 7, 5), mat, { m: new THREE.Matrix4().multiplyMatrices(M, mm) }); };
  const lb = (a, b, r0, r1, md) => B.limb(md || mat, T(...a), T(...b), r0 * sc, r1 * sc, 5);
  el(0.16, 0.18, 0.36, 0, 0.62, 0);
  el(0.16, 0.19, 0.19, 0, 0.66, 0.2); el(0.16, 0.18, 0.18, 0, 0.64, -0.2);
  lb([0, 0.72, 0.26], [0, 1.02, 0.44], 0.105, 0.062);
  lb([0, 1.02, 0.44], [0, 0.86, 0.6], 0.066, 0.038);
  el(0.045, 0.045, 0.06, 0, 0.83, 0.62);
  for (const s of [-1, 1]) B.cone(mat, 0.018 * sc, 0.06 * sc, ...T(s * 0.03, 1.05, 0.42), 4);
  lb([0, 1.06, 0.36], [0, 0.78, 0.22], 0.03, 0.02, maneMat || mat);       // mane
  lb([0, 0.7, -0.34], [0, 0.36, -0.5], 0.035, 0.014, maneMat || mat);     // tail
  const lift = pose === 0 ? 0 : pose === 1 ? 0.28 : 0.5;
  for (const s of [-1, 1]) {
    const sd = s * 0.095;
    if (pose === 0 || s > 0) { lb([sd, 0.55, 0.25], [sd, 0.3, 0.29], 0.066, 0.044); lb([sd, 0.3, 0.29], [sd, 0.02, 0.3], 0.042, 0.028); }
    else { lb([sd, 0.55, 0.25], [sd, 0.42 + lift * 0.4, 0.38], 0.066, 0.044); lb([sd, 0.42 + lift * 0.4, 0.38], [sd, 0.3 + lift * 0.6, 0.5 + lift * 0.2], 0.042, 0.028); }
    lb([sd, 0.55, -0.2], [sd, 0.28, -0.3], 0.072, 0.046); lb([sd, 0.28, -0.3], [sd, 0.02, -0.24], 0.044, 0.028);
  }
}
function quadriga(B, m, x, y, z, sc, ry = 0) {
  const c = Math.cos(ry), sn = Math.sin(ry), P = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
  const gd = m.gold;
  for (let i = 0; i < 4; i++) { const [px, pz] = P((i - 1.5) * 0.35 * sc, 0.45 * sc); horse(B, gd, px, y, pz, sc * 0.95, ry, i === 0 || i === 3 ? 1 : 2, m.goldDim); }
  const [cxp, czp] = P(0, -0.5 * sc);
  B.box(gd, 0.9 * sc, 0.05 * sc, 0.42 * sc, cxp, y + 0.3 * sc, czp, { ry, wuv: false });
  B.box(gd, 0.9 * sc, 0.28 * sc, 0.05 * sc, ...(() => { const [a, b] = P(0, -0.7 * sc); return [a, y + 0.35 * sc, b]; })(), { ry, wuv: false });
  for (const s of [-1, 1]) {
    const [wx, wz] = P(s * 0.52 * sc, -0.5 * sc);
    B.add(new THREE.CylinderGeometry(0.28 * sc, 0.28 * sc, 0.05 * sc, 14), gd, { x: wx, y: y + 0.28 * sc, z: wz, rz: PI / 2, ry });
    B.add(new THREE.CylinderGeometry(0.06 * sc, 0.06 * sc, 0.09 * sc, 6), m.goldDim, { x: wx, y: y + 0.28 * sc, z: wz, rz: PI / 2, ry });
  }
  B.limb(gd, [P(0, -0.3 * sc)[0], y + 0.3 * sc, P(0, -0.3 * sc)[1]], [P(0, 0.42 * sc)[0], y + 0.55 * sc, P(0, 0.42 * sc)[1]], 0.02 * sc, 0.014 * sc, 5);
  for (const s of [-0.16, 0.16]) { const [fx, fz] = P(s * sc, -0.5 * sc); statuette(B, m, fx, y + 0.32 * sc, fz, 0.5 * sc, gd, gd, { ry }); }
}

// ---- stadium outlines --------------------------------------------------------
function stadiumPts(hl, r, n = 30) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = -PI / 2 + PI * i / n; pts.push([hl + r * Math.cos(a), r * Math.sin(a)]); }
  for (let i = 0; i <= n; i++) { const a = PI / 2 + PI * i / n; pts.push([-hl + r * Math.cos(a), r * Math.sin(a)]); }
  return pts;
}
function shapeFrom(pts) { const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); s.closePath(); return s; }
function ringShape(outer, inner) { const s = shapeFrom(outer); s.holes.push(new THREE.Path(inner.map(p => new THREE.Vector2(p[0], p[1])))); return s; }
// vertical strip along a closed polyline (x,z); u = arclength / tile
function wallStrip(pts, y0, y1, tile) {
  const pos = [], uv = [], idx = [], n = pts.length; let cum = 0;
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n], q = pts[(i - 1 + n) % n]; if (i) cum += Math.hypot(p[0] - q[0], p[1] - q[1]);
    pos.push(p[0], y0, p[1], p[0], y1, p[1]); uv.push(cum / tile, 0, cum / tile, 1);
  }
  for (let i = 0; i < n; i++) { const a = i * 2, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return { g, len: cum };
}

// rectangular ring of four boxes (open in the middle): outer w x d, thickness t
function frameRing(B, mat, cx, cz, w, d, t, y, h, o = {}) {
  B.box(mat, w, h, t, cx, y, cz + d / 2 - t / 2, o); B.box(mat, w, h, t, cx, y, cz - d / 2 + t / 2, o);
  B.box(mat, t, h, d - 2 * t, cx + w / 2 - t / 2, y, cz, o); B.box(mat, t, h, d - 2 * t, cx - w / 2 + t / 2, y, cz, o);
}

// bronze tripod brazier with a flickering flame
function brazier(B, m, ctx, x, y, z, sc = 1, halo = 0.14) {
  for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; B.limb(m.bronzeDark, [x + Math.sin(a) * 0.028 * sc, y + 0.006 * sc, z + Math.cos(a) * 0.028 * sc], [x, y + 0.11 * sc, z], 0.004 * sc, 0.003 * sc, 5); }
  B.lathe(m.bronze, [[0.001, 0], [0.03 * sc, 0.02 * sc], [0.04 * sc, 0.045 * sc], [0.034 * sc, 0.045 * sc], [0.026 * sc, 0.02 * sc], [0.001, 0.005 * sc]], x, y + 0.105 * sc, z, 10);
  return flame(B, m, ctx, x, y + 0.14 * sc, z, 0.055 * sc, halo * sc);
}

// Writes target[prop] = base * (1 + rel). If somebody else changes the value in between (e.g. the caller
// dims a material for a ghost state) that new value is adopted as the new base instead of being overwritten.
const PST = new WeakMap();
function pulseProp(target, prop, rel) {
  let st = PST.get(target); if (!st) { st = {}; PST.set(target, st); }
  const cur = target[prop]; let s = st[prop];
  if (!s) s = st[prop] = { base: cur, last: cur }; else if (cur !== s.last) s.base = cur;
  const v = s.base * (1 + rel); target[prop] = s.last = v;
}

// a few seagulls circling above (purely decorative, excluded from bounds)
function gulls(B, m, ctx, list) {
  const white = m.make('gullWhite', () => std({ color: 0xf6f8fa, rough: 0.7, double: true })), beakM = m.make('gullBeak', () => std({ color: 0xf0a020, rough: 0.6 }));
  const birds = list.map((c, i) => {
    const gb = B.sub(0); gb.root.userData.noBounds = true;
    gb.ell(white, 0.008, 0.006, 0.022, 0, 0, 0, { ws: 6, hs: 4 }); gb.sph(white, 0.0055, 0, 0.002, 0.024, { ws: 6, hs: 4 }); gb.cone(beakM, 0.0018, 0.008, 0, 0.0015, 0.029, 4, { rx: PI / 2 });
    gb.box(white, 0.008, 0.002, 0.012, 0, 0, -0.03, { wuv: false });
    const wl = gb.pivot(0.005, 0.002, 0), wr = gb.pivot(-0.005, 0.002, 0); wl.root.userData.noBounds = wr.root.userData.noBounds = true;
    wl.ell(white, 0.03, 0.0025, 0.011, 0.033, 0.002, 0, { ws: 6, hs: 3 }); wr.ell(white, 0.03, 0.0025, 0.011, -0.033, 0.002, 0, { ws: 6, hs: 3 });
    return { gb, wl, wr, c, ph: i * 2.1 };
  });
  ctx.anim.push((t) => {
    for (const b of birds) {
      const c = b.c, th = c.sp * t + b.ph, dir = Math.sign(c.sp) || 1;
      b.gb.root.position.set(c.cx + c.R * Math.cos(th), c.H + 0.02 * Math.sin(t * 0.8 + b.ph), c.cz + c.R * Math.sin(th) * (c.k || 1));
      b.gb.root.rotation.set(0, Math.atan2(-Math.sin(th) * dir, Math.cos(th) * (c.k || 1) * dir), -0.4 * dir);
      const f = Math.sin(t * 8 + b.ph * 3) * 0.45 + 0.1; b.wl.root.rotation.z = f; b.wr.root.rotation.z = -f;
    }
  });
}

const BUILDERS = {};
//@@HELPERS_END
// =============================================================================
//  1. PYRAMIDS
// =============================================================================
function pyramid(B, m, cx, cz, hw, H, ry, courses, capMat, bodyMat) {
  const capH = H * 0.11, bodyH = H - capH, ch = bodyH / courses, w = y => hw * (1 - y / H), r2 = 1.4142;
  for (let i = 0; i < courses; i++) {
    const y0 = i * ch, bot = w(y0), top = w(y0 + ch) - hw * 0.012;
    B.cyl(bodyMat || m.sandstone, top * r2, bot * r2, ch, cx, y0, cz, 4, { ry: ry + PI / 4, wuv: false, uvs: [8, 0.25], uvo: [hash2(i, 3, 3), (i % 4) * 0.25] });
  }
  B.cone(capMat, w(bodyH) * r2, capH, cx, bodyH, cz, 4, { ry: ry + PI / 4 });
  B.cyl(capMat, w(bodyH) * r2 * 1.01, w(bodyH) * r2 * 1.01, H * 0.006, cx, bodyH - H * 0.004, cz, 4, { ry: ry + PI / 4 });
}
function camel(sb, m, hide) {
  const cloth = m.make('camelCloth', () => std({ color: 0xb3352c, rough: 0.8, double: true })), trim = m.make('camelTrim', () => std({ color: 0x2b58a4, rough: 0.8 }));
  sb.ell(hide, 0.034, 0.038, 0.075, 0, 0.1, 0, { ws: 9, hs: 6 });
  sb.ell(hide, 0.026, 0.03, 0.03, 0, 0.148, -0.012, { ws: 8, hs: 6 });
  sb.limb(hide, [0, 0.11, 0.055], [0, 0.17, 0.092], 0.021, 0.013, 6);
  sb.ell(hide, 0.013, 0.013, 0.024, 0, 0.18, 0.11, { ws: 7, hs: 5 }); sb.ell(hide, 0.009, 0.009, 0.012, 0, 0.173, 0.13, { ws: 6, hs: 4 });
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) { const x = lx * 0.02, z = lz * 0.048; sb.limb(hide, [x, 0.085, z], [x, 0.045, z + 0.008], 0.0085, 0.006, 5); sb.limb(hide, [x, 0.045, z + 0.008], [x, 0.0, z], 0.006, 0.0045, 5); }
  sb.limb(hide, [0, 0.11, -0.072], [0, 0.06, -0.09], 0.005, 0.003, 4);
  sb.box(cloth, 0.06, 0.006, 0.055, 0, 0.128, 0.0, { wuv: false }); sb.box(trim, 0.064, 0.008, 0.012, 0, 0.126, 0.03, { wuv: false }); sb.box(trim, 0.064, 0.008, 0.012, 0, 0.126, -0.03, { wuv: false });
  sb.ell(cloth, 0.022, 0.018, 0.028, 0, 0.184, -0.012, { ws: 7, hs: 5 });
}
BUILDERS.pyramids = function (B, m, ctx) {
  const dune = (x, z, cx, cz, A, sx, sz) => A * Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  const glow = m.goldGlow; B.glowMat(glow); ctx.pulse(glow, 0.28, 1.4);
  B.ground(terrainGeo((x, z) => 0.022 + 0.008 * Math.sin(x * 7 + z * 3) + 0.006 * Math.sin(z * 11 - x * 2.5)
    + dune(x, z, -0.33, 0.4, 0.05, 0.3, 0.09) + dune(x, z, 0.02, 0.44, 0.035, 0.2, 0.06)
    + dune(x, z, 0.62, -0.1, 0.06, 0.1, 0.25) + dune(x, z, -0.62, -0.12, 0.06, 0.09, 0.22) + dune(x, z, 0.1, -0.44, 0.06, 0.5, 0.08), { uvs: 3 }), m.sand);
  pyramid(B, m, -0.1, -0.08, 0.27, 0.68, 0.32, 14, glow);
  pyramid(B, m, 0.4, 0.06, 0.17, 0.42, -0.25, 10, glow);
  pyramid(B, m, -0.5, 0.12, 0.11, 0.26, 0.12, 8, glow);
  // mastabas / queen's pyramids
  B.box(m.sandstoneDark, 0.14, 0.03, 0.09, 0.45, 0.02, -0.27, { ry: -0.25 }); B.box(m.sandstone, 0.12, 0.02, 0.07, 0.45, 0.05, -0.27, { ry: -0.25 });
  B.box(m.sandstoneDark, 0.1, 0.025, 0.07, -0.47, 0.02, -0.26, { ry: 0.15 });
  // entrance on great pyramid
  const ry = 0.32, y = 0.13, wy = 0.27 * (1 - y / 0.68);
  B.box(m.dark, 0.036, 0.03, 0.02, -0.1 + Math.sin(ry) * (wy - 0.004), y, -0.08 + Math.cos(ry) * (wy - 0.004), { ry, rx: -0.4 });
  // obelisks
  obelisk(B, m, 0.6, 0.02, 0.2, 0.2, 0.017, 0.2, glow);
  obelisk(B, m, 0.5, 0.02, 0.24, 0.12, 0.011, 0.3);
  // oasis with palms
  const oasis = m.make('oasis', () => std({ color: 0x35bfd0, map: 'water', own: true, rough: 0.1, emissive: 0x0a5560, ei: 0.4 }));
  B.ext(m.sandstoneDark, ellipseShape(0.105, 0.06, 0.012), 0.014, 0.05, 0.02, 0.28, { wuv: false });
  B.add(disc(20), oasis, { x: 0.05, y: 0.0305, z: 0.28, sx: 0.094, sz: 0.049, uvs: 1.5 });
  palm(B, m, -0.03, 0.03, 0.28, 0.22, 0.1, 0.6, 1); palm(B, m, 0.1, 0.03, 0.3, 0.17, -0.1, 2.6, 2); palm(B, m, 0.17, 0.03, 0.25, 0.19, 0.08, 0.9, 3);
  palm(B, m, -0.55, 0.03, 0.0, 0.2, 0.1, 0.4, 4); palm(B, m, -0.52, 0.03, -0.06, 0.15, -0.1, 2.2, 5);
  for (let i = 0; i < 6; i++) B.add(blobGeo(0.014 + 0.014 * B.rnd(), 0, 0.5, i + 5), m.rock, { x: -0.55 + B.rnd() * 1.0, y: 0.024, z: 0.15 + B.rnd() * 0.25, sy: 0.6 });
  B.add(blobGeo(0.02, 0, 0.5, 71), m.leafDark, { x: 0.13, y: 0.03, z: 0.29, sy: 0.6 }); B.add(blobGeo(0.017, 0, 0.5, 72), m.leaf, { x: -0.04, y: 0.03, z: 0.27, sy: 0.6 });
  // camel caravan crossing the dunes in front
  const hide = m.make('camelHide', () => std({ color: 0xd6ab70, map: 'weather', rough: 0.95 }));
  const cams = [];
  for (let i = 0; i < 3; i++) { const c = B.sub(0.03); camel(c, m, hide); cams.push(c.root); }
  ctx.anim.push((t) => {
    for (let i = 0; i < 3; i++) {
      const u = (((t * 0.012 + i * 0.13) % 1) + 1) % 1, x = -0.66 + u * 1.32, z = 0.245 + 0.05 * Math.sin(x * 4 + 1) - 0.03 * u;
      const dz = 0.05 * 4 * Math.cos(x * 4 + 1) - 0.03 / 1.32, yaw = Math.atan2(1, dz);
      const g = cams[i]; g.position.set(x, 0.03 + 0.004 * Math.abs(Math.sin(t * 3.2 + i * 1.7)), z); g.rotation.set(0, yaw, 0.03 * Math.sin(t * 3.2 + i * 1.7)); g.scale.setScalar(Math.max(0.001, Math.min(1, u / 0.05, (1 - u) / 0.05)));
    }
    oasis.map.offset.set(t * 0.02, t * 0.014);
  });
};

// =============================================================================
//  2. GREAT LIBRARY OF ALEXANDRIA
// =============================================================================
BUILDERS.great_library = function (B, m, ctx) {
  const parch = m.make('parch', () => std({ color: 0xf0e0b4, rough: 0.8 }));
  const teal = m.make('teal', () => std({ color: 0x2f9c92, rough: 0.35, metal: 0.35, emissive: 0x093a36, ei: 0.5 }));
  // paved plaza
  B.ground(terrainGeo(() => 0.006, { uvs: 3.2 }), m.limestoneDark);
  const Y = 0.09, hallZ = -0.07;
  // podium (3 steps)
  for (let i = 0; i < 3; i++) B.box(m.limestone, 1.2 - i * 0.07, 0.03, 0.68 - i * 0.07, 0, i * 0.03, 0.02);
  // marble carpet up the central stair
  for (let i = 0; i < 3; i++) B.box(m.marble, 0.3, 0.031, 0.036, 0, i * 0.03, 0.36 - 0.035 * i - 0.0175, { wuv: true });
  // main hall
  B.box(m.limestone, 0.74, 0.43, 0.36, 0, Y, hallZ);
  B.box(m.marble, 0.78, 0.025, 0.4, 0, Y + 0.43, hallZ);       // cornice
  for (let i = 0; i < 9; i++) B.box(m.marble, 0.04, 0.02, 0.012, -0.32 + i * 0.08, Y + 0.405, 0.108);
  // portico
  const pz = 0.205, colH = 0.3;
  for (let i = 0; i < 8; i++) column(B, m.marble, -0.315 + i * 0.09, pz, Y, colH, 0.0125, 'corinthian');
  B.box(m.marble, 0.8, 0.03, 0.13, 0, Y + colH, 0.18);         // architrave
  B.box(m.limestone, 0.8, 0.03, 0.13, 0, Y + colH + 0.03, 0.18);  // frieze
  for (let i = 0; i < 20; i++) B.box(m.marble, 0.014, 0.026, 0.008, -0.375 + i * 0.0395, Y + colH + 0.032, 0.2476);
  B.box(m.marble, 0.83, 0.014, 0.15, 0, Y + colH + 0.06, 0.18);   // cornice
  pediment(B, { x: 0, y: Y + colH + 0.074, z: 0.2, w: 0.83, rise: 0.135, depth: 0.05, frame: m.marble, field: m.limestoneDark });
  pitchedRoof(B, m.terracotta, 0, Y + colH + 0.074, 0.152, 0.83, 0.085, 0.135, 0.014, 0.012);
  // pediment ornament: sun disc and figures
  B.add(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16), m.gold, { x: 0, y: Y + colH + 0.135, z: 0.228, rx: PI / 2 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; B.box(m.gold, 0.005, 0.03, 0.006, Math.sin(a) * 0.04, Y + colH + 0.135 + Math.cos(a) * 0.04 - 0.015, 0.228, { rz: -a + 0 }); }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const fx = s * (0.11 + i * 0.07); B.cyl(m.ivory, 0.007, 0.011, 0.04 - i * 0.008, fx, Y + colH + 0.1 + 0.0, 0.226, 6); B.sph(m.ivory, 0.008, fx, Y + colH + 0.1 + 0.05 - i * 0.008, 0.226, { ws: 6, hs: 5 }); }
  // acroteria
  B.cone(m.gold, 0.018, 0.05, 0, Y + colH + 0.074 + 0.135 + 0.02, 0.2, 6); B.sph(m.gold, 0.012, 0, Y + colH + 0.074 + 0.135 + 0.075, 0.2, { ws: 6, hs: 5 });
  for (const s of [-1, 1]) B.cone(m.gold, 0.013, 0.035, s * 0.41, Y + colH + 0.076, 0.2, 6);
  // door and lit interior behind the portico
  B.box(m.dark, 0.14, 0.24, 0.01, 0, Y, 0.11);
  B.box(m.glowWarm, 0.11, 0.22, 0.01, 0, Y, 0.114); B.glowMat(m.glowWarm);
  B.box(m.marble, 0.16, 0.014, 0.02, 0, Y + 0.24, 0.115);
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) arcWin(B, m, s * (0.21 + i * 0.09), Y + 0.08, 0.112, 0.036, 0.13, 0);
  // wings
  for (const s of [-1, 1]) {
    B.box(m.limestone, 0.25, 0.25, 0.28, s * 0.49, Y, -0.09);
    B.box(m.marble, 0.27, 0.02, 0.3, s * 0.49, Y + 0.25, -0.09);
    B.hip(m.terracotta, 0.27, 0.3, 0.06, 0.55, s * 0.49, Y + 0.27, -0.09);
    for (let i = 0; i < 3; i++) arcWin(B, m, s * (0.43 + i * 0.06), Y + 0.06, 0.052, 0.03, 0.11, 0);
    for (let i = 0; i < 2; i++) arcWin(B, m, s * 0.6175, Y + 0.06, -0.14 + i * 0.09, 0.03, 0.11, s * PI / 2);
    // little colonnade in front of each wing
    for (let i = 0; i < 3; i++) column(B, m.marble, s * (0.43 + i * 0.06), 0.085, Y, 0.2, 0.0085, 'doric');
    B.box(m.marble, 0.2, 0.014, 0.05, s * 0.49, Y + 0.2, 0.085);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cone(m.gold, 0.012, 0.035, sx * 0.375, Y + 0.455, hallZ + sz * 0.19, 6);
  // drum + ribbed dome + lantern
  const dz = hallZ, dy = Y + 0.455;
  B.cyl(m.limestone, 0.18, 0.185, 0.1, 0, dy, dz, 24);
  B.cyl(m.marble, 0.19, 0.19, 0.012, 0, dy, dz, 24); B.cyl(m.marble, 0.19, 0.19, 0.012, 0, dy + 0.1, dz, 24);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU + PI / 12, R = 0.183;
    B.box(m.dark, 0.032, 0.062, 0.008, Math.sin(a) * R, dy + 0.024, dz + Math.cos(a) * R, { ry: a });
    B.box(m.glowWarm, 0.026, 0.056, 0.008, Math.sin(a) * (R + 0.003), dy + 0.027, dz + Math.cos(a) * (R + 0.003), { ry: a });
    B.box(m.marble, 0.014, 0.1, 0.014, Math.sin(a + PI / 12) * 0.183, dy, dz + Math.cos(a + PI / 12) * 0.183, { ry: a + PI / 12 });
  }
  B.add(ribbedDome(0.178, 0.17, 12, 0.045), teal, { x: 0, y: dy + 0.1, z: dz });
  const ly = dy + 0.1 + 0.168;
  B.cyl(m.gold, 0.05, 0.055, 0.012, 0, ly - 0.004, dz, 12);
  B.cyl(m.glowWarm, 0.038, 0.038, 0.075, 0, ly + 0.008, dz, 12); B.glowMat(m.glowWarm);
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; B.cyl(m.gold, 0.005, 0.005, 0.078, Math.sin(a) * 0.043, ly + 0.008, dz + Math.cos(a) * 0.043, 5); }
  B.cyl(m.gold, 0.05, 0.05, 0.008, 0, ly + 0.085, dz, 12);
  B.cone(m.gold, 0.048, 0.06, 0, ly + 0.093, dz, 12);
  B.sph(m.gold, 0.01, 0, ly + 0.158, dz, { ws: 8, hs: 6 });
  // scroll racks (front left / right): open pigeonhole shelves full of scrolls
  for (const s of [-1, 1]) {
    const rx = s * 0.47, rz = 0.365, rh = 0.24;
    B.box(m.woodDark, 0.19, rh, 0.045, rx, 0.006, rz);
    B.box(m.wood, 0.17, rh - 0.03, 0.01, rx, 0.02, rz + 0.0235, { wuv: true });
    for (let r = 0; r <= 4; r++) B.box(m.woodDark, 0.18, 0.007, 0.056, rx, 0.011 + r * 0.055, rz + 0.004);
    for (let c = 0; c <= 3; c++) B.box(m.woodDark, 0.007, rh - 0.01, 0.056, rx - 0.0825 + c * 0.055, 0.011, rz + 0.004);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) if (B.rnd() > 0.1) { const sx = rx - 0.055 + c * 0.055, sy = 0.011 + 0.007 + r * 0.055 + 0.024; B.cyl(parch, 0.0092, 0.0092, 0.04, sx, sy, rz + 0.002, 8, { rx: PI / 2 }); if (B.rnd() > 0.5) B.cyl(parch, 0.0075, 0.0075, 0.04, sx + 0.011, sy - 0.008, rz + 0.002, 8, { rx: PI / 2 }); }
    B.box(m.marble, 0.21, 0.012, 0.06, rx, 0.006 + rh, rz);
    B.cone(m.gold, 0.008, 0.02, rx - 0.09, 0.018 + rh, rz, 6); B.cone(m.gold, 0.008, 0.02, rx + 0.09, 0.018 + rh, rz, 6);
  }
  // pile of scrolls on the stair and scattered ones
  const pile = [[-0.05, 0], [0.0, 0], [0.05, 0], [-0.025, 1], [0.025, 1], [0, 2]];
  for (const [px, py] of pile) B.cyl(parch, 0.0125, 0.0125, 0.13, px + 0.065, 0.019 + py * 0.024, 0.395, 8, { rz: PI / 2, ry: 0.1 * (px * 20) });
  // braziers at the stair
  for (const s of [-1, 1]) {
    const bx = s * 0.2, bz = 0.35;
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; B.limb(m.bronzeDark, [bx + Math.sin(a) * 0.028, 0.006, bz + Math.cos(a) * 0.028], [bx, 0.11, bz], 0.004, 0.003, 5); }
    B.lathe(m.bronze, [[0.001, 0], [0.03, 0.02], [0.04, 0.045], [0.034, 0.045], [0.026, 0.02], [0.001, 0.005]], bx, 0.105, bz, 10);
    flame(B, m, ctx, bx, 0.14, bz, 0.055, 0.14);
  }
  // cypress trees framing the building
  for (const [tx, tz, th] of [[-0.6, 0.3, 0.28], [0.6, 0.3, 0.28], [-0.62, -0.28, 0.32], [0.62, -0.28, 0.32]]) cypress(B, m, tx, 0.006, tz, th, 0.036, Math.round(tx * 10 + tz * 7));
  // window shimmer
  ctx.pulse(m.glowWarm, 0.12, 1.7, 0.05, 4.1);
};

// =============================================================================
//  3. HANGING GARDENS OF BABYLON
// =============================================================================
function vineGeoms(vb, m, len, seed, thick = 0.0024) {
  const N = 4, pts = [];
  for (let k = 0; k <= N; k++) pts.push([Math.sin(k * 1.6 + seed) * 0.007, -len * k / N, 0.004 * k]);
  vb.tube(m.leafDark, pts, thick, 6, 4);
  for (let k = 1; k <= N; k++) {
    const p = pts[k], a = hash2(k, seed, 1) * TAU, s = 0.8 + hash2(k, seed, 2) * 0.7;
    vb.add(new THREE.OctahedronGeometry(0.0085 * s), m.leaf, { x: p[0] + Math.cos(a) * 0.006, y: p[1], z: p[2] + Math.sin(a) * 0.006, sx: 0.8, sy: 1.5, sz: 0.5, ry: a, rz: 0.5 });
    if (k % 2) vb.add(new THREE.OctahedronGeometry(0.007 * s), m.leafLight, { x: p[0] - Math.cos(a) * 0.006, y: p[1] - 0.006, z: p[2] - Math.sin(a) * 0.006, sx: 0.8, sy: 1.5, sz: 0.5, ry: a + 1, rz: -0.5 });
  }
}
BUILDERS.hanging_gardens = function (B, m, ctx) {
  const glaze = m.make('glaze', () => std({ color: 0x2a67b5, rough: 0.25, metal: 0.1 }));
  const fall = m.make('fall', () => std({ color: 0x46c8d4, map: 'water', own: true, wuv: 3, rough: 0.1, emissive: 0x0b5a66, ei: 0.45 }));
  const pool = m.make('pool', () => std({ color: 0x2bb3c2, map: 'water', own: true, rough: 0.08, metal: 0.05, emissive: 0x0a5560, ei: 0.4 }));
  const flowers = m.make('flowers', () => std({ vc: 1, rough: 0.7 }));
  const foam = m.make('foam', () => std({ color: 0xf4fbfb, rough: 0.6, emissive: 0x556666, ei: 0.3 }));
  B.ground(terrainGeo(() => 0.004, { uvs: 7 }), m.grass);
  // front pool
  B.ext(m.limestone, ellipseShape(0.29, 0.075, 0.016), 0.022, 0, 0, 0.375, { wuv: false });
  B.add(disc(28), pool, { x: 0, y: 0.014, z: 0.375, sx: 0.276, sz: 0.062, uvs: 2 });
  // ziggurat tiers
  const T = [
    { w: 1.08, d: 0.64, h: 0.17, z: -0.05, n: 8, ns: 4 },
    { w: 0.86, d: 0.5, h: 0.16, z: -0.07, n: 6, ns: 3 },
    { w: 0.64, d: 0.38, h: 0.15, z: -0.09, n: 4, ns: 2 },
    { w: 0.42, d: 0.26, h: 0.14, z: -0.11, n: 4, ns: 2 },
  ];
  let y0 = 0; const tops = [];
  T.forEach((t, ti) => {
    const zf = t.z + t.d / 2;
    B.box(m.mudbrick, t.w, t.h, t.d, 0, y0, t.z);
    B.box(m.sandstoneDark, t.w + 0.02, 0.02, t.d + 0.02, 0, y0, t.z);                    // footing
    B.box(glaze, t.w + 0.012, 0.02, t.d + 0.012, 0, y0 + t.h - 0.046, t.z, { wuv: false });   // blue glazed band
    B.box(m.gold, t.w + 0.016, 0.007, t.d + 0.016, 0, y0 + t.h - 0.026, t.z);            // gold trim
    const yt = y0 + t.h;
    B.box(m.grass, t.w - 0.014, 0.014, t.d - 0.014, 0, yt - 0.006, t.z, { wuv: false, uvs: 4 });   // planted terrace
    // parapet ring (coping)
    for (const s of [-1, 1]) B.box(m.sandstone, 0.014, 0.032, t.d + 0.024, s * (t.w / 2 + 0.005), yt - 0.02, t.z);
    B.box(m.sandstone, t.w + 0.024, 0.032, 0.014, 0, yt - 0.02, t.z + t.d / 2 + 0.005);
    B.box(m.sandstone, t.w + 0.024, 0.032, 0.014, 0, yt - 0.02, t.z - t.d / 2 - 0.005);
    // arcades (front + both sides)
    const archFace = (len, n, cx, cz, ry) => {
      const pitch = len / n, aw = pitch * 0.56, ah = t.h * 0.5;
      for (let i = 0; i < n; i++) {
        const u = -len / 2 + (i + 0.5) * pitch, c = Math.cos(ry), s = Math.sin(ry);
        const px = cx + u * c + s * 0.0, pz = cz - u * s + c * 0.0;
        const ox = s * 0.003, oz = c * 0.003;
        B.box(m.limestone, aw + 0.014, ah, 0.006, px + ox * 0.3, y0 + 0.022, pz + oz * 0.3, { ry });
        B.add(archTop((aw + 0.014) / 2, 0.006, 6), m.limestone, { x: px + ox * 0.3, y: y0 + 0.022 + ah, z: pz + oz * 0.3, rx: PI / 2, ry });
        B.box(m.dark, aw, ah, 0.01, px + ox, y0 + 0.022, pz + oz, { ry });
        B.add(archTop(aw / 2, 0.01, 6), m.dark, { x: px + ox, y: y0 + 0.022 + ah, z: pz + oz, rx: PI / 2, ry });
        if ((i + ti) % 3 === 0) { B.box(m.glowWarm, aw * 0.4, ah * 0.5, 0.004, px + ox * 1.6, y0 + 0.03, pz + oz * 1.6, { ry }); B.glowMat(m.glowWarm); }
      }
    };
    archFace(t.w, t.n, 0, zf, 0);
    archFace(t.d, t.ns, t.w / 2, t.z, PI / 2);
    archFace(t.d, t.ns, -t.w / 2, t.z, -PI / 2);
    tops.push({ y: yt, ...t });
    y0 = yt;
  });
  // cascade down the central axis
  T.forEach((t, ti) => {
    if (ti === 0) return;
    const zf = t.z + t.d / 2, yb = tops[ti - 1].y;
    B.box(fall, 0.05, t.h - 0.02, 0.012, 0, yb, zf + 0.006, { uvs: 1 });
    B.add(disc(14), pool, { x: 0, y: yb + t.h - 0.014, z: zf - 0.045, sx: 0.06, sz: 0.04, uvs: 2 });
    B.box(fall, 0.05, 0.01, 0.06, 0, yb + t.h - 0.02, zf - 0.03);
    for (let k = 0; k < 4; k++) B.sph(foam, 0.008 + 0.003 * (k % 2), (k - 1.5) * 0.02, yb + 0.006, zf + 0.02 + (k % 2) * 0.012, { ws: 6, hs: 5 });
  });
  { const t = T[0], zf = t.z + t.d / 2; B.box(fall, 0.05, t.h - 0.02, 0.014, 0, 0, zf + 0.007); for (let k = 0; k < 5; k++) B.sph(foam, 0.01, (k - 2) * 0.022, 0.016, zf + 0.03 + (k % 2) * 0.012, { ws: 6, hs: 5 }); }
  // side stairs up to the lowest terrace
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) B.box(m.limestone, 0.014, 0.028 * (i + 1), 0.13, s * (T[0].w / 2 + 0.014 + 0.084 - i * 0.014 - 0.007), 0, T[0].z + 0.1);
  // ------- planting
  const tr = (ti, x, z, h, sd) => roundTree(B, m, x, tops[ti].y, z, h, sd, sd % 3 === 0 ? m.leafDark : m.leaf);
  const plant = (ti, list) => list.forEach(([x, z, h, sd]) => tr(ti, x, tops[ti].z + z, h, sd));
  plant(0, [[-0.45, -0.22, 0.17, 1], [-0.28, -0.24, 0.13, 2], [0.0, -0.25, 0.16, 3], [0.3, -0.23, 0.14, 4], [0.46, -0.2, 0.17, 5], [-0.47, 0.05, 0.13, 6], [0.48, 0.06, 0.15, 7], [-0.4, 0.2, 0.09, 8], [0.4, 0.2, 0.09, 9]]);
  plant(1, [[-0.34, -0.16, 0.15, 10], [-0.12, -0.18, 0.16, 11], [0.14, -0.17, 0.14, 12], [0.35, -0.15, 0.16, 13], [-0.36, 0.08, 0.1, 14], [0.36, 0.09, 0.1, 15]]);
  plant(2, [[-0.24, -0.1, 0.13, 16], [0.02, -0.12, 0.15, 17], [0.25, -0.09, 0.12, 18], [-0.25, 0.07, 0.08, 19], [0.26, 0.07, 0.08, 20]]);
  palm(B, m, -0.4, tops[0].y, tops[0].z - 0.08, 0.3, 0.12, 0.6, 1); palm(B, m, 0.42, tops[0].y, tops[0].z - 0.1, 0.27, -0.12, 2.5, 2);
  palm(B, m, -0.29, tops[1].y, tops[1].z + 0.02, 0.26, 0.1, 0.5, 3); palm(B, m, 0.3, tops[1].y, tops[1].z + 0.02, 0.24, -0.1, 2.7, 4);
  palm(B, m, -0.2, tops[2].y, tops[2].z - 0.05, 0.22, 0.12, 0.4, 5);
  // hedges and low shrubs along the terrace fronts, with flowers
  const fcols = [0xff6f91, 0xffd166, 0xf4f0ff, 0xff9f43, 0xc77dff];
  tops.forEach((t, ti) => {
    const nh = 7 + (3 - ti), zf = t.z + t.d / 2;
    for (let i = 0; i < nh; i++) {
      const hx = -t.w / 2 + 0.045 + (i + 0.5) * (t.w - 0.09) / nh; if (Math.abs(hx) < 0.05) continue;
      const rr = 0.026 + 0.014 * hash2(i, ti, 3);
      B.add(blobGeo(rr, 1, 0.35, i + ti * 9), i % 2 ? m.leafDark : m.leaf, { x: hx, y: t.y - 0.004, z: zf - 0.004 + 0.006 * hash2(i, ti, 8), sy: 0.72 });
      B.add(blobGeo(rr * 0.62, 0, 0.35, i * 5 + ti), m.leafLight, { x: hx + (hash2(i, ti, 4) - 0.5) * 0.03, y: t.y - 0.03, z: zf + 0.016, sy: 0.8 });
      for (let k = 0; k < 3; k++) B.add(new THREE.IcosahedronGeometry(0.0065, 0), flowers, { x: hx + (hash2(i, k, 21) - 0.5) * rr * 1.4, y: t.y + rr * 0.55, z: zf - 0.004 + (hash2(i, k, 22) - 0.3) * rr, col: fcols[(i + k + ti) % 5] });
    }
    for (let i = 0; i < 9; i++) {
      const fx = (hash2(i, ti, 11) - 0.5) * (t.w - 0.14), fz = t.z + (hash2(i, ti, 12) - 0.3) * (t.d - 0.1);
      B.add(new THREE.IcosahedronGeometry(0.0085, 0), flowers, { x: fx, y: t.y + 0.006, z: fz, col: fcols[(i * 2 + ti) % 5] });
    }
  });
  // top pavilion
  { const t = tops[3], py = t.y;
    B.box(m.marble, 0.24, 0.016, 0.17, 0, py - 0.005, t.z); B.box(m.marble, 0.2, 0.012, 0.14, 0, py + 0.011, t.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) column(B, m.marble, sx * 0.08, t.z + sz * 0.055, py + 0.023, 0.13, 0.0085, 'doric');
    B.box(m.marble, 0.2, 0.014, 0.14, 0, py + 0.153, t.z);
    B.hip(glaze, 0.22, 0.16, 0.075, 0.15, 0, py + 0.167, t.z, { wuv: false });
    B.hip(m.gold, 0.226, 0.166, 0.008, 0.97, 0, py + 0.162, t.z, { wuv: false });
    B.cone(m.gold, 0.008, 0.04, 0, py + 0.24, t.z, 6); B.sph(m.gold, 0.008, 0, py + 0.28, t.z, { ws: 8, hs: 6 });
    B.cyl(m.marble, 0.02, 0.026, 0.03, 0, py + 0.023, t.z, 10); B.add(disc(10), pool, { x: 0, y: py + 0.054, z: t.z, sx: 0.019, sz: 0.019 });
  }
  // vines: some static (merged), some swaying (sub-builders)
  const sways = [];
  let vs = 0;
  T.forEach((t, ti) => {
    const yt = tops[ti].y, zf = t.z + t.d / 2 + 0.012;
    const spots = [];
    for (let i = 0; i < 6; i++) spots.push([-t.w / 2 + 0.07 + i * (t.w - 0.14) / 5, zf, 0]);
    for (const s of [-1, 1]) spots.push([s * (t.w / 2 + 0.012), t.z, s * PI / 2]);
    spots.forEach(([x, z, ry], i) => {
      if (Math.abs(x) < 0.045 && ry === 0) return;
      const len = t.h * (0.35 + 0.5 * hash2(i, ti, 21)), seed = vs++;
      const vb = B.sub(0);
      vb.root.position.set(x, yt - 0.004, z); vb.root.rotation.y = ry;
      vineGeoms(vb, m, len, seed);
      if (seed % 3 !== 1) sways.push({ g: vb.root, ph: seed * 1.7 });
    });
  });
  // pool-side shrubs & trees
  for (const s of [-1, 1]) { roundTree(B, m, s * 0.5, 0.004, 0.36, 0.12, 30 + s, m.leaf); B.add(blobGeo(0.03, 1, 0.3, 5), m.leafDark, { x: s * 0.58, y: 0.014, z: 0.33, sy: 0.7 }); }
  cypress(B, m, -0.6, 0.004, 0.22, 0.24, 0.03, 3); cypress(B, m, 0.6, 0.004, 0.22, 0.24, 0.03, 4);
  ctx.pulse(m.glowWarm, 0.16, 2.3, 0.06, 5.1);
  ctx.anim.push((t) => {
    fall.map.offset.y = t * 0.55; fall.map.offset.x = 0;
    pool.map.offset.set(t * 0.02, t * 0.014);
    for (const v of sways) { v.g.rotation.z = 0.07 * Math.sin(t * 1.3 + v.ph); v.g.rotation.x = 0.05 * Math.sin(t * 1.1 + v.ph * 1.7); }
  });
};

// =============================================================================
//  4. COLOSSUS OF RHODES
// =============================================================================
function house(B, m, x, y, z, w, d, h, ry, o = {}) {
  const plaster = m.make('plaster', () => std({ color: 0xf3ecdc, rough: 0.9, vc: 1, jit: 0.03 }));
  const blue = m.make('blue', () => std({ color: 0x2b66ae, rough: 0.5 }));
  const c = Math.cos(ry), s = Math.sin(ry);
  B.box(plaster, w, h, d, x, y, z, { ry, wuv: false });
  B.box(plaster, w * 1.04, 0.008, d * 1.04, x, y + h, z, { ry, wuv: false });
  if (o.roof === 'dome') B.add(new THREE.SphereGeometry(Math.min(w, d) * 0.4, 10, 5, 0, TAU, 0, PI / 2), blue, { x, y: y + h + 0.008, z });
  else if (o.roof !== 'flat') B.hip(m.terracotta, w * 1.12, d * 1.12, h * 0.4, 0.2, x, y + h, z, { ry });
  B.box(blue, w * 0.22, h * 0.55, 0.006, x + s * (d / 2 + 0.001), y, z + c * (d / 2 + 0.001), { ry, wuv: false });
  B.box(m.dark, w * 0.16, h * 0.28, 0.006, x + s * (d / 2) + c * w * 0.28, y + h * 0.45, z + c * (d / 2) - s * w * 0.28, { ry, wuv: false });
}
BUILDERS.colossus = function (B, m, ctx) {
  const sea = waterSurface(B, m.water, { level: 0.04, amp: 0.004 });
  ctx.anim.push(t => sea.update(t));
  // stone piers flanking the harbour entrance
  for (const s of [-1, 1]) {
    B.box(m.limestone, 0.5, 0.09, 0.66, s * 0.38, 0, -0.03);
    B.box(m.limestoneDark, 0.5, 0.012, 0.66, s * 0.38, 0.09, -0.03, { wuv: true });
    B.box(m.limestone, 0.03, 0.02, 0.68, s * 0.14, 0.09, -0.03);              // coping along the channel
    for (let i = 0; i < 2; i++) B.box(m.limestone, 0.5 - i * 0.04, 0.02, 0.05, s * 0.38, 0.02 * i, 0.31 + 0.025 * (1 - i));   // landing steps
    // pedestal
    B.box(m.limestone, 0.22, 0.03, 0.27, s * 0.235, 0.102, 0.0);
    B.box(m.marble, 0.17, 0.045, 0.22, s * 0.235, 0.132, 0.0);
    B.box(m.gold, 0.172, 0.005, 0.222, s * 0.235, 0.172, 0.0);
    // bollards
    for (let i = 0; i < 4; i++) { const bz = -0.24 + i * 0.16; B.cyl(m.bronzeDark, 0.008, 0.01, 0.022, s * 0.16, 0.1, bz, 8); B.sph(m.bronzeDark, 0.01, s * 0.16, 0.122, bz, { ws: 6, hs: 4 }); }
  }
  // village on the piers
  house(B, m, -0.56, 0.1, -0.27, 0.085, 0.075, 0.07, 0.1); house(B, m, -0.46, 0.1, -0.29, 0.07, 0.07, 0.09, -0.15, { roof: 'dome' });
  house(B, m, -0.55, 0.1, -0.06, 0.08, 0.08, 0.06, 0.0, { roof: 'flat' }); house(B, m, -0.58, 0.1, 0.13, 0.075, 0.09, 0.075, 0.05);
  house(B, m, -0.47, 0.1, 0.17, 0.07, 0.06, 0.055, -0.1, { roof: 'flat' }); house(B, m, -0.38, 0.1, -0.26, 0.06, 0.06, 0.055, 0.2);
  house(B, m, 0.55, 0.1, -0.27, 0.08, 0.075, 0.075, -0.1, { roof: 'dome' }); house(B, m, 0.45, 0.1, -0.29, 0.07, 0.07, 0.06, 0.1);
  house(B, m, 0.58, 0.1, -0.05, 0.08, 0.08, 0.08, 0.0); house(B, m, 0.55, 0.1, 0.14, 0.075, 0.09, 0.06, -0.05, { roof: 'flat' });
  house(B, m, 0.46, 0.1, 0.19, 0.065, 0.06, 0.07, 0.1, { roof: 'dome' });
  // watch tower
  B.cyl(m.limestone, 0.03, 0.036, 0.15, -0.58, 0.1, 0.27, 12); B.cyl(m.limestone, 0.042, 0.042, 0.016, -0.58, 0.25, 0.27, 12);
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; B.box(m.limestone, 0.014, 0.014, 0.014, -0.58 + Math.sin(a) * 0.036, 0.266, 0.27 + Math.cos(a) * 0.036, { ry: a }); }
  // trees, crates, amphorae
  cypress(B, m, 0.6, 0.1, 0.28, 0.2, 0.026, 5); cypress(B, m, 0.52, 0.1, 0.27, 0.16, 0.022, 6); cypress(B, m, -0.4, 0.1, 0.3, 0.17, 0.024, 7);
  roundTree(B, m, -0.36, 0.1, 0.08, 0.1, 11); roundTree(B, m, 0.37, 0.1, 0.06, 0.1, 12);
  for (const [cx, cz] of [[0.33, 0.25], [-0.33, 0.24], [0.34, -0.22]]) { B.box(m.wood, 0.03, 0.03, 0.03, cx, 0.1, cz, { ry: cx }); B.box(m.woodDark, 0.026, 0.026, 0.026, cx + 0.02, 0.1, cz - 0.03, { ry: 0.5 }); B.lathe(m.terracottaPlain, [[0.001, 0], [0.011, 0.01], [0.015, 0.025], [0.008, 0.045], [0.006, 0.055], [0.01, 0.06]], cx - 0.03, 0.1, cz + 0.01, 8); }

  // --------- the statue (local units, scaled 0.9, standing on the pedestals)
  const st = B.sub(0.176); st.root.scale.setScalar(0.9);
  const br = m.bronze, brd = m.bronzeDark, gd = m.gold;
  const legs = (s) => {
    const F = [s * 0.26, 0.0, 0.01], A = [s * 0.257, 0.05, 0.0], K = [s * 0.172, 0.222, 0.022], H = [s * 0.072, 0.4, 0.0];
    st.box(br, 0.085, 0.032, 0.15, F[0], 0, F[2] + 0.02, { wuv: false });
    st.ell(br, 0.043, 0.02, 0.075, F[0], 0.03, F[2] + 0.028, { ws: 8, hs: 6 });
    for (const zz of [0.0, 0.06]) st.box(gd, 0.09, 0.006, 0.008, F[0], 0.03, F[2] + zz, { wuv: false });
    st.limb(br, A, K, 0.023, 0.031, 9);
    st.ell(br, 0.03, 0.055, 0.032, (A[0] * 0.65 + K[0] * 0.35), 0.11, 0.0, { ws: 8, hs: 6 });
    st.sph(br, 0.033, K[0], K[1], K[2], { ws: 9, hs: 7 });
    st.limb(br, K, H, 0.032, 0.05, 9);
    st.sph(br, 0.05, H[0], H[1], H[2], { ws: 9, hs: 7 });
  };
  legs(-1); legs(1);
  st.ell(br, 0.105, 0.065, 0.075, 0, 0.395, 0, { ws: 12, hs: 8 });
  st.add(flutedGeo(0.118, 0.086, 0.15, 10, 2, 0.14, 0.0), br, { x: 0, y: 0.3, z: 0, sx: 1.05, sz: 0.85 });
  st.cyl(gd, 0.094, 0.098, 0.022, 0, 0.44, 0, 16, { sx: 1.05, sz: 0.85 });
  st.sph(gd, 0.014, 0, 0.452, 0.088, { ws: 8, hs: 6 });
  st.ell(br, 0.076, 0.085, 0.056, 0, 0.51, 0, { ws: 12, hs: 8 });
  st.ell(br, 0.116, 0.095, 0.066, 0, 0.615, 0, { ws: 14, hs: 10 });
  for (const s of [-1, 1]) st.sph(br, 0.04, s * 0.117, 0.665, 0, { ws: 9, hs: 7 });
  st.tube(gd, [[0.1, 0.7, 0.03], [0.05, 0.65, 0.065], [-0.01, 0.58, 0.066], [-0.07, 0.5, 0.055], [-0.1, 0.445, 0.04]], 0.0085, 12, 5);
  st.cyl(br, 0.024, 0.03, 0.05, 0, 0.675, 0, 10);
  st.ell(br, 0.043, 0.054, 0.048, 0, 0.775, 0.004, { ws: 12, hs: 9 });
  st.ell(brd, 0.046, 0.05, 0.05, 0, 0.79, -0.008, { ws: 10, hs: 8 });
  st.cone(br, 0.009, 0.024, 0, 0.765, 0.05, 6, { rx: PI / 2 });
  for (const s of [-1, 1]) st.sph(m.dark, 0.005, s * 0.02, 0.786, 0.043, { ws: 5, hs: 4 });
  st.box(brd, 0.05, 0.008, 0.02, 0, 0.8, 0.036, { wuv: false });
  // radiate crown
  st.cyl(gd, 0.049, 0.049, 0.012, 0, 0.822, 0, 14);
  for (let i = 0; i < 13; i++) {
    const a = i / 13 * TAU, ph = 0.95, d = [Math.sin(a) * Math.sin(ph), Math.cos(ph), Math.cos(a) * Math.sin(ph)];
    if (Math.cos(a) < -0.6) continue;
    st.limb(gd, [d[0] * 0.05, 0.815 + d[1] * 0.03, d[2] * 0.05], [d[0] * 0.125, 0.815 + d[1] * 0.125, d[2] * 0.125], 0.013, 0.002, 5);
  }
  // raised right arm with the torch
  const S1 = [0.117, 0.665, 0], E1 = [0.205, 0.745, 0.004], W1 = [0.218, 0.845, 0.01];
  st.limb(br, S1, E1, 0.034, 0.028, 9); st.sph(br, 0.029, E1[0], E1[1], E1[2], { ws: 8, hs: 6 });
  st.limb(br, E1, W1, 0.028, 0.02, 9); st.cyl(gd, 0.024, 0.024, 0.012, W1[0], W1[1] - 0.004, W1[2], 10); st.sph(br, 0.026, W1[0], W1[1] + 0.022, W1[2], { ws: 8, hs: 6 });
  st.limb(brd, [W1[0], W1[1] + 0.01, W1[2]], [0.222, 0.93, 0.01], 0.008, 0.007, 6);
  st.lathe(gd, [[0.004, 0], [0.024, 0.026], [0.036, 0.05], [0.03, 0.05], [0.018, 0.026], [0.004, 0.006]], 0.222, 0.92, 0.01, 12);
  flame(B, m, ctx, 0.222, 0.965, 0.01, 0.09, 0.3, st.root);
  // left arm holding the cloak
  const S2 = [-0.117, 0.665, 0], E2 = [-0.178, 0.555, 0.03], W2 = [-0.165, 0.45, 0.085];
  st.limb(br, S2, E2, 0.034, 0.028, 9); st.sph(br, 0.029, E2[0], E2[1], E2[2], { ws: 8, hs: 6 });
  st.limb(br, E2, W2, 0.028, 0.02, 9); st.sph(br, 0.024, W2[0], W2[1] - 0.005, W2[2], { ws: 8, hs: 6 });
  st.cyl(gd, 0.024, 0.024, 0.012, W2[0], W2[1] + 0.012, W2[2], 10, { rx: 0.3 });
  // cloak
  st.add(clothGeo(0.17, 0.33, 2.2, 0.02, 12, 5, 0.3), m.make('cloak', () => std({ color: 0xc98f3e, rough: 0.4, metal: 0.65, emissive: 0x3a2008, ei: 0.4, double: true })), { x: -0.11, y: 0.685, z: -0.06, ry: -0.35 });
  st.box(gd, 0.24, 0.008, 0.008, -0.13, 0.36, -0.03, { wuv: false, ry: -0.35 });
  st.cyl(gd, 0.02, 0.02, 0.012, -0.075, 0.66, -0.02, 8, { rx: PI / 2 });

  // --------- ship sailing through the harbour entrance
  const boat = ship(B, m, { L: 0.15, beam: 0.05, depth: 0.028, sheer: 0.035, mast: 0.15, sail: m.make('cream', () => std({ color: 0xf1e7cd, rough: 0.9, double: true })), oars: 0, y: 0.04, yard: 0.12, pennant: m.cloth });
  ctx.anim.push((t) => {
    const z = -0.02 + 0.32 * Math.sin(t * 0.22), v = Math.cos(t * 0.22);
    const yaw = (PI / 2) * (1 - Math.tanh(v * 6));
    boat.g.position.set(Math.sin(t * 0.5) * 0.008, 0.04 + 0.004 * Math.sin(t * 1.7), z);
    boat.g.rotation.set(0.05 * Math.sin(t * 1.3), yaw, 0.06 * Math.sin(t * 1.1));
  });
  // torch glow pulse
  ctx.pulse(m.glowFire, 0.18, 9, 0.09, 15.3);
  gulls(B, m, ctx, [{ cx: 0.0, cz: 0.0, R: 0.45, k: 0.6, H: 0.75, sp: 0.45 }, { cx: 0.0, cz: 0.0, R: 0.3, k: 0.6, H: 0.95, sp: -0.5 }]);
};

// =============================================================================
//  5. TEMPLE OF ARTEMIS AT EPHESUS
// =============================================================================
BUILDERS.temple_of_artemis = function (B, m, ctx) {
  const lapis = m.make('lapis', () => std({ color: 0x2a4c96, rough: 0.5, metal: 0.05 }));
  const roofM = m.make('roofM', () => std({ color: 0xf0e4cb, map: 'roof', wuv: 7, rough: 0.55, vc: 1, jit: 0.03 }));
  B.ground(terrainGeo(() => 0.006, { uvs: 3.4 }), m.limestoneDark);
  const Y = 0.09, colH = 0.4;
  // crepidoma
  const st = [[1.3, 0.76], [1.26, 0.72], [1.22, 0.68]];
  st.forEach(([w, d], i) => B.box(m.limestone, w, 0.03, d, 0, i * 0.03, 0));
  for (let i = 0; i < 3; i++) B.box(m.marble, 0.34 - i * 0.02, 0.03, 0.02, 0, i * 0.03 + 0.0005, 0.385 - i * 0.02 + 0.0, { wuv: true });
  // cella (naos)
  // cella walls with a doorway; the chamber behind is lit
  const cw = colH + 0.06, dw = 0.09, dh = 0.3;
  B.box(m.limestone, 0.66, cw, 0.18, 0, Y, -0.14);
  for (const s of [-1, 1]) B.box(m.limestone, 0.33 - dw, cw, 0.16, s * (dw + (0.33 - dw) / 2), Y, 0.03);
  B.box(m.limestone, dw * 2, cw - dh, 0.16, 0, Y + dh, 0.03);
  B.box(m.marble, 0.7, 0.02, 0.38, 0, Y + colH + 0.02, -0.06);
  B.box(m.marbleWarm, dw * 2, 0.008, 0.16, 0, Y, 0.03);
  B.box(m.glowWarm, dw * 2, dh, 0.006, 0, Y, -0.046); B.glowMat(m.glowWarm);
  for (const s of [-1, 1]) B.box(m.goldDim, 0.008, dh, 0.012, s * (dw + 0.004), Y, 0.112, { wuv: false });
  B.box(m.goldDim, dw * 2 + 0.016, 0.008, 0.012, 0, Y + dh, 0.112, { wuv: false });
  for (let i = 0; i < 8; i++) if (Math.abs(-0.3 + i * 0.086) > 0.12) B.box(m.marble, 0.012, colH, 0.012, -0.3 + i * 0.086, Y, 0.114);   // pilasters on the cella front
  // cult statue seen through the doorway
  { const cx = 0, cz = 0.03, cy = Y;
    B.lathe(m.gold, [[0.001, 0], [0.028, 0], [0.026, 0.03], [0.034, 0.08], [0.036, 0.13], [0.028, 0.17], [0.018, 0.19]], cx, cy + 0.005, cz, 10);
    for (let i = 0; i < 3; i++) B.cyl(m.bronze, 0.037 - i * 0.003, 0.037 - i * 0.003, 0.008, cx, cy + 0.05 + i * 0.03, cz, 10);
    B.sph(m.ivory, 0.02, cx, cy + 0.215, cz, { ws: 8, hs: 6 });
    B.cyl(m.gold, 0.018, 0.026, 0.05, cx, cy + 0.225, cz, 8);
    for (const s of [-1, 1]) B.limb(m.ivory, [s * 0.03, cy + 0.15, cz], [s * 0.055, cy + 0.14, cz + 0.035], 0.008, 0.006, 5);
  }
  // colonnades
  const cols = (x, z, r, cap) => { column(B, m.marble, x, z, Y, colH, r, 'ionic'); };
  const xs = i => -0.5 + i * (1.0 / 7);
  for (let i = 0; i < 8; i++) {
    cols(xs(i), 0.29, 0.0175); cols(xs(i), -0.29, 0.0175);
    B.cyl(m.gold, 0.02, 0.02, 0.04, xs(i), Y + 0.009, 0.29, 8);       // sculpted lower drums (columnae caelatae)
  }
  for (const z of [-0.145, 0, 0.145]) { cols(-0.5, z, 0.0175); cols(0.5, z, 0.0175); }
  for (let i = 0; i < 6; i++) { const x = -0.39 + i * 0.156; cols(x, 0.18, 0.0155); cols(x, -0.18, 0.0155); }
  for (const z of [-0.09, 0, 0.09]) { cols(-0.39, z, 0.0155); cols(0.39, z, 0.0155); }
  // entablature
  const ey = Y + colH;
  B.box(m.marble, 1.24, 0.038, 0.72, 0, ey, 0);
  B.box(m.marbleWarm, 1.25, 0.03, 0.73, 0, ey + 0.038, 0);
  for (let i = 0; i < 40; i++) B.box(m.gold, 0.012, 0.014, 0.004, -0.6 + i * (1.2 / 39), ey + 0.045, 0.3665);
  B.box(m.marble, 1.3, 0.014, 0.76, 0, ey + 0.068, 0);
  for (let i = 0; i < 44; i++) B.box(m.marble, 0.014, 0.014, 0.012, -0.63 + i * (1.26 / 43), ey + 0.054, 0.372);
  // roof + pediments
  const ry0 = ey + 0.082;
  pitchedRoof(B, roofM, 0, ry0, 0, 1.3, 0.74, 0.17, 0.02, 0.0);
  for (const s of [-1, 1]) pediment(B, { x: 0, y: ry0, z: s * 0.372, w: 1.3, rise: 0.17, depth: 0.03, frame: m.marble, field: lapis, bw: 0.022 });
  // pediment sculpture: a gold procession of figures standing on the tympanum floor
  for (let i = 0; i < 11; i++) {
    const fx = -0.53 + i * 0.106, hh = 0.045 + 0.085 * (1 - Math.abs(fx) / 0.66);
    statuette(B, m, fx, ry0 + 0.022, 0.376, i === 5 ? hh * 1.25 : hh, m.gold, m.ivory, { arm: i % 2, ry: 0 });
  }
  for (const s of [-1, 1]) B.ell(m.gold, 0.05, 0.012, 0.012, s * 0.6, ry0 + 0.03, 0.376, { ws: 8, hs: 5, rz: s * 0.15 });
  B.box(m.goldDim, 1.32, 0.008, 0.014, 0, ry0 + 0.012, 0.386, { wuv: false });
  // acroteria (palmettes) and roof-edge tiles
  for (const [ax, ay] of [[0, ry0 + 0.17], [-0.63, ry0 + 0.005], [0.63, ry0 + 0.005]]) {
    B.cone(m.gold, 0.022, 0.06, ax, ay, 0.372, 8); B.sph(m.gold, 0.01, ax, ay + 0.065, 0.372, { ws: 6, hs: 5 });
    B.cone(m.gold, 0.022, 0.06, ax, ay, -0.372, 8);
  }
  for (let i = 0; i < 26; i++) { const ax = -0.62 + i * 0.0496; B.cone(m.gold, 0.007, 0.014, ax, ry0 - 0.016, 0.375, 5); }
  // statuettes and altar
  for (const s of [-1, 1]) {
    B.box(m.marble, 0.04, 0.05, 0.04, s * 0.5, 0, 0.41); statuette(B, m, s * 0.5, 0.05, 0.41, 0.09, m.marble, m.marble);
    B.box(m.marble, 0.04, 0.035, 0.04, s * 0.28, 0, 0.415); statuette(B, m, s * 0.28, 0.035, 0.415, 0.075, m.limestone, m.ivory, { arm: 1 });
  }
  B.box(m.marble, 0.11, 0.07, 0.07, 0.6, 0.006, 0.28); B.box(m.marble, 0.13, 0.014, 0.09, 0.6, 0.076, 0.28);
  flame(B, m, ctx, 0.6, 0.09, 0.28, 0.045, 0.12);
  // trees
  for (const [tx, tz, th] of [[-0.62, 0.33, 0.24], [-0.6, -0.34, 0.26], [0.62, -0.33, 0.26]]) cypress(B, m, tx, 0.006, tz, th, 0.032, Math.round(tx * 9 + tz * 5));
  roundTree(B, m, -0.6, 0.006, 0.05, 0.12, 4, m.leafDark); roundTree(B, m, 0.62, 0.006, 0.05, 0.13, 5);
  ctx.pulse(m.glowWarm, 0.14, 1.9, 0.06, 4.7);
};

// =============================================================================
//  6. GREAT LIGHTHOUSE (PHAROS OF ALEXANDRIA)
// =============================================================================
function beamMesh(L, w, rgb) {
  const pos = [], col = [];
  for (const s of [0, PI]) {
    const c = Math.cos(s), sn = Math.sin(s);
    const P = [[0, 0, 0], [L, 0, -w], [L, 0, w]];
    P.forEach((p, i) => { pos.push(p[0] * c - p[2] * sn, p[1], p[0] * sn + p[2] * c); col.push(...(i === 0 ? rgb : [0, 0, 0])); });
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  mesh.userData.noBounds = true; mesh.renderOrder = 4; mesh.frustumCulled = false;
  return mesh;
}
BUILDERS.great_lighthouse = function (B, m, ctx) {
  const sea = waterSurface(B, m.water, { level: 0.04, amp: 0.005 });
  ctx.anim.push(t => sea.update(t));
  const islandH = (x, z) => {
    const d = ((x - 0.02) / 0.4) ** 2 + ((z + 0.02) / 0.27) ** 2;
    return 0.115 * Math.pow(Math.max(0, 1 - d), 0.45) * (0.9 + 0.2 * gnoise(x * 17, z * 19, 1)) + (d < 1 ? 0.012 * gnoise(x * 40, z * 40, 2) : 0);
  };
  B.ground(terrainGeo((x, z) => { const d = Math.sqrt(((x - 0.02) / 0.54) ** 2 + ((z + 0.02) / 0.4) ** 2); return 0.075 * (1 - smooth(0.5, 1.0, d)); }, { nr: 18, ns: 80, uvs: 5, fall: false, rim: 0 }), m.sand);
  B.ground(terrainGeo(islandH, { nr: 20, ns: 84, uvs: 4, fall: false, rim: 0 }), m.rock);
  const Y = 0.125, cx = 0.02, cz = -0.03;
  // precinct wall with corner turrets
  B.box(m.limestoneDark, 0.5, 0.05, 0.42, cx, Y - 0.01, cz);
  B.box(m.limestone, 0.5, 0.012, 0.42, cx, Y + 0.04, cz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.cyl(m.limestone, 0.027, 0.03, 0.075, cx + sx * 0.24, Y - 0.01, cz + sz * 0.2, 8); B.cone(m.terracottaPlain, 0.034, 0.03, cx + sx * 0.24, Y + 0.065, cz + sz * 0.2, 8); }
  B.box(m.limestoneDark, 0.4, 0.03, 0.34, cx, Y + 0.052, cz);
  // tower, tier 1 (square)
  const t1 = 0.25;
  B.box(m.limestoneDark, 0.3, 0.03, 0.3, cx, Y + 0.04, cz);
  B.hip(m.limestone, 0.26, 0.26, t1, 0.9, cx, Y + 0.07, cz);
  B.box(m.marble, 0.255, 0.012, 0.255, cx, Y + 0.07 + t1, cz);
  const t1t = Y + 0.07 + t1 + 0.012;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.box(m.limestoneDark, 0.02, t1, 0.02, cx + sx * 0.122, Y + 0.07, cz + sz * 0.122); statuette(B, m, cx + sx * 0.118, t1t, cz + sz * 0.118, 0.045, m.gold, m.gold); }
  // door + windows on tier 1 (front)
  B.box(m.dark, 0.055, 0.09, 0.012, cx, Y + 0.07, cz + 0.13, { wuv: false });
  B.box(m.marble, 0.07, 0.012, 0.02, cx, Y + 0.16, cz + 0.13);
  for (let r = 0; r < 3; r++) for (const wx of [-0.06, 0.06]) B.box(m.dark, 0.018, 0.04, 0.01, cx + wx, Y + 0.12 + r * 0.045, cz + 0.128 - r * 0.0015, { wuv: false });
  for (const s of [-1, 1]) for (let r = 0; r < 3; r++) B.box(m.dark, 0.01, 0.04, 0.018, cx + s * 0.125 - s * 0.001 * r, Y + 0.12 + r * 0.045, cz, { wuv: false });
  // entry ramp
  for (let i = 0; i < 5; i++) B.box(m.limestone, 0.09, 0.012 * (i + 1), 0.02, cx, Y + 0.05 - 0.012 * 0, cz + 0.135 + 0.02 * (4 - i));
  // tier 2 (octagonal)
  const t2 = 0.18, r2 = 0.092;
  B.box(m.marble, 0.2, 0.012, 0.2, cx, t1t, cz);
  B.cyl(m.limestone, r2 * 0.86, r2, t2, cx, t1t + 0.012, cz, 8, { ry: PI / 8 });
  const t2b = t1t + 0.012;
  for (let k = 0; k < 8; k++) {
    const a = k * PI / 4, rf = r2 * 0.93 * Math.cos(PI / 8);
    B.box(m.dark, 0.014, 0.045, 0.01, cx + Math.sin(a) * rf, t2b + 0.06, cz + Math.cos(a) * rf, { ry: a, wuv: false });
    B.box(m.dark, 0.014, 0.03, 0.01, cx + Math.sin(a) * rf * 0.96, t2b + 0.12, cz + Math.cos(a) * rf * 0.96, { ry: a, wuv: false });
  }
  B.cyl(m.marble, 0.09, 0.09, 0.01, cx, t2b + t2, cz, 8, { ry: PI / 8 });
  const t3b = t2b + t2 + 0.01;
  // tier 3 (round)
  const t3 = 0.12;
  B.cyl(m.limestone, 0.05, 0.06, t3, cx, t3b, cz, 16);
  for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; B.box(m.dark, 0.011, 0.04, 0.01, cx + Math.sin(a) * 0.056, t3b + 0.05, cz + Math.cos(a) * 0.056, { ry: a, wuv: false }); }
  B.cyl(m.marble, 0.066, 0.066, 0.01, cx, t3b + t3, cz, 16);
  // lantern
  const ly = t3b + t3 + 0.01;
  B.cyl(m.gold, 0.06, 0.062, 0.01, cx, ly, cz, 16);
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; B.cyl(m.marble, 0.006, 0.006, 0.09, cx + Math.sin(a) * 0.05, ly + 0.01, cz + Math.cos(a) * 0.05, 6); }
  B.cyl(m.glowFire, 0.03, 0.03, 0.075, cx, ly + 0.012, cz, 10); B.glowMat(m.glowFire);
  B.cyl(m.gold, 0.062, 0.062, 0.008, cx, ly + 0.1, cz, 16);
  B.add(new THREE.SphereGeometry(0.058, 14, 6, 0, TAU, 0, PI / 2), m.gold, { x: cx, y: ly + 0.108, z: cz, sy: 0.9 });
  B.cyl(m.gold, 0.012, 0.014, 0.014, cx, ly + 0.16, cz, 8);
  statuette(B, m, cx, ly + 0.174, cz, 0.075, m.gold, m.gold, { arm: 1 });
  B.limb(m.gold, [cx + 0.02, ly + 0.21, cz], [cx + 0.02, ly + 0.245, cz], 0.0016, 0.0016, 4);
  flame(B, m, ctx, cx, ly + 0.02, cz, 0.075, 0.3);
  // rotating beacon beams
  const beam = beamMesh(0.55, 0.06, [1.0, 0.72, 0.32]); beam.position.set(cx, ly + 0.05, cz); B.root.add(beam); ctx.glows.push(beam);
  ctx.pulse(m.glowFire, 0.2, 2.1, 0.1, 5.3);
  ctx.anim.push((t) => { beam.rotation.y = t * 0.55; });
  // island buildings and vegetation
  house(B, m, -0.24, 0.08, 0.13, 0.07, 0.06, 0.05, 0.2); house(B, m, -0.31, 0.06, 0.02, 0.06, 0.06, 0.05, -0.3, { roof: 'flat' });
  house(B, m, 0.3, 0.075, 0.1, 0.07, 0.06, 0.05, -0.2);
  palm(B, m, 0.33, 0.07, -0.08, 0.2, 0.1, 0.5, 21); palm(B, m, -0.3, 0.075, -0.12, 0.18, -0.1, 2, 22);
  for (let i = 0; i < 9; i++) { const a = i * 2.1 + 0.3, rr = 0.42 + 0.14 * hash2(i, 1, 2); B.add(blobGeo(0.02 + 0.03 * hash2(i, 2, 2), 0, 0.5, i), m.rock, { x: 0.02 + Math.cos(a) * rr * 0.9, y: 0.03, z: -0.02 + Math.sin(a) * rr * 0.62, sy: 0.7 }); }
  // harbour wall (mole) with arches, curving along the front
  const N = 14;
  for (let i = 0; i < N; i++) {
    const u0 = i / N, x = -0.5 + u0 * 0.85, z = -0.355 - 0.025 * Math.sin(u0 * PI) + 0.02 * u0;
    const ang = 0.11 * Math.cos(u0 * PI);
    B.box(m.limestone, 0.068, 0.085, 0.055, x, 0.0, z, { ry: ang });
    B.box(m.limestoneDark, 0.068, 0.012, 0.06, x, 0.085, z, { ry: ang });
    B.box(m.dark, 0.02, 0.04, 0.01, x, 0.03, z + 0.028 * Math.cos(ang), { ry: ang, wuv: false });
    for (const o of [-0.022, 0.022]) B.box(m.limestone, 0.016, 0.014, 0.014, x + o * Math.cos(ang), 0.097, z - o * Math.sin(ang), { ry: ang });
  }
  { const x = -0.56, z = -0.35; B.cyl(m.limestone, 0.045, 0.05, 0.16, x, 0, z, 10); B.cyl(m.limestoneDark, 0.055, 0.055, 0.014, x, 0.16, z, 10); B.cone(m.terracottaPlain, 0.055, 0.045, x, 0.174, z, 10); }
  { const x = 0.26, z = 0.35; B.cyl(m.limestone, 0.026, 0.03, 0.12, x, 0, z, 8); B.cone(m.terracottaPlain, 0.036, 0.03, x, 0.12, z, 8); flame(B, m, ctx, x, 0.11, z, 0.03, 0.09); }
  // sailing ship circling the island
  const sh = ship(B, m, { L: 0.17, beam: 0.05, depth: 0.03, sheer: 0.04, oars: 6, oarLen: 0.05, mast: 0.15, sail: m.sailRed, y: 0.04, shields: 1 });
  ctx.anim.push((t) => {
    const a = t * 0.11, ax = 0.5, az = 0.28, x = 0.02 + Math.cos(a) * ax, z = -0.02 + Math.sin(a) * az;
    const dx = -Math.sin(a) * ax, dz = Math.cos(a) * az;
    sh.g.position.set(x, 0.04 + 0.004 * Math.sin(t * 1.9), z);
    sh.g.rotation.set(0.04 * Math.sin(t * 1.4), Math.atan2(dx, dz), 0.05 * Math.sin(t * 1.2));
  });
  cypress(B, m, 0.15, 0.09, 0.16, 0.14, 0.02, 4);
  gulls(B, m, ctx, [{ cx: 0.02, cz: -0.03, R: 0.4, k: 0.6, H: 0.62, sp: 0.6 }, { cx: 0.02, cz: -0.03, R: 0.3, k: 0.6, H: 0.8, sp: -0.5 }]);
};

// =============================================================================
//  7. MAUSOLEUM AT HALICARNASSUS
// =============================================================================
BUILDERS.mausoleum = function (B, m, ctx) {
  const lapis = m.make('lapis', () => std({ color: 0x2a4c96, rough: 0.5, metal: 0.05 }));
  B.ground(terrainGeo(() => 0.006, { uvs: 3.4 }), m.limestoneDark);
  // precinct platforms
  B.box(m.limestone, 1.16, 0.03, 0.72, 0, 0, 0); B.box(m.limestone, 1.08, 0.03, 0.64, 0, 0.03, 0);
  // podium with relief frieze
  const PY = 0.06, ph = 0.24, pw = 0.86, pd = 0.54;
  B.box(m.marbleWarm, pw, ph, pd, 0, PY, 0);
  B.box(m.marble, pw + 0.03, 0.02, pd + 0.03, 0, PY, 0); B.box(m.marble, pw + 0.03, 0.022, pd + 0.03, 0, PY + ph - 0.022, 0);
  const fy = PY + ph - 0.09;
  B.box(lapis, pw + 0.004, 0.06, pd + 0.004, 0, fy, 0, { wuv: false });
  for (let i = 0; i < 38; i++) { const fx = -pw / 2 + 0.02 + i * (pw - 0.04) / 37, hh = 0.03 + 0.012 * hash2(i, 1, 1); B.box(m.gold, 0.008, hh, 0.006, fx, fy + 0.012, pd / 2 + 0.005, { wuv: false }); B.sph(m.gold, 0.006, fx, fy + 0.014 + hh, pd / 2 + 0.005, { ws: 5, hs: 4 }); }
  for (let i = 0; i < 24; i++) { const fz = -pd / 2 + 0.02 + i * (pd - 0.04) / 23, hh = 0.03 + 0.012 * hash2(i, 2, 1); for (const s of [-1, 1]) B.box(m.gold, 0.006, hh, 0.008, s * (pw / 2 + 0.005), fy + 0.012, fz, { wuv: false }); }
  for (let i = 0; i < 38; i++) { const fx = -pw / 2 + 0.02 + i * (pw - 0.04) / 37; B.box(m.gold, 0.008, 0.03, 0.006, fx, fy + 0.012, -pd / 2 - 0.005, { wuv: false }); }
  // stair up to the podium
  for (let k = 0; k < 6; k++) { const d = 0.13 - k * 0.0217; B.box(m.marble, 0.24, (k + 1) * 0.03, d, 0, PY - 0.0, pd / 2 + d / 2 - 0.0); }
  for (const s of [-1, 1]) { B.box(m.marble, 0.02, 0.18 + 0.03, 0.135, s * 0.13, PY - 0.0, pd / 2 + 0.065); }
  // corner lions
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = sx * (pw / 2 - 0.04), lz = sz * (pd / 2 - 0.04), ly = PY + ph;
    B.box(m.marble, 0.05, 0.02, 0.07, lx, ly, lz);
    B.ell(m.gold, 0.02, 0.018, 0.035, lx, ly + 0.03, lz); B.sph(m.gold, 0.02, lx, ly + 0.045, lz + sz * 0.032, { ws: 7, hs: 5 });
    B.sph(m.goldDim, 0.026, lx, ly + 0.047, lz + sz * 0.028, { ws: 7, hs: 5 });
  }
  // cella + colonnade
  const CY = PY + ph, colH = 0.2, cw = 0.62, cd = 0.36;
  B.box(m.marbleWarm, cw, colH, cd, 0, CY, 0);
  const xs = [], zs = [];
  for (let i = 0; i < 8; i++) xs.push(-0.35 + i * 0.1); for (let i = 0; i < 6; i++) zs.push(-0.24 + i * 0.096);
  for (const x of xs) { column(B, m.marble, x, 0.24, CY, colH, 0.0125, 'ionic'); column(B, m.marble, x, -0.24, CY, colH, 0.0125, 'ionic'); }
  for (let i = 1; i < 5; i++) { column(B, m.marble, -0.35, zs[i], CY, colH, 0.0125, 'ionic'); column(B, m.marble, 0.35, zs[i], CY, colH, 0.0125, 'ionic'); }
  // statues between the columns (front + sides)
  for (let i = 0; i < 7; i++) statuette(B, m, -0.3 + i * 0.1, CY, 0.195, 0.085, m.gold, m.gold);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) statuette(B, m, s * 0.31, CY, -0.13 + i * 0.13, 0.085, m.gold, m.gold, { ry: s * PI / 2 });
  // entablature
  const EY = CY + colH;
  B.box(m.marble, 0.76, 0.03, 0.54, 0, EY, 0);
  B.box(lapis, 0.762, 0.026, 0.542, 0, EY + 0.03, 0, { wuv: false });
  for (let i = 0; i < 30; i++) B.box(m.gold, 0.008, 0.014, 0.004, -0.36 + i * (0.72 / 29), EY + 0.036, 0.272, { wuv: false });
  B.box(m.marble, 0.8, 0.014, 0.58, 0, EY + 0.056, 0);
  for (let i = 0; i < 28; i++) B.cone(m.gold, 0.006, 0.012, -0.375 + i * (0.75 / 27), EY + 0.07, 0.29, 5);
  // stepped pyramid roof
  const RY = EY + 0.07, N = 12, sh = 0.022;
  for (let i = 0; i < N; i++) {
    const w = 0.7 - i * 0.048, d = 0.5 - i * 0.034;
    B.box(i % 2 ? m.limestone : m.marbleWarm, w, sh, d, 0, RY + i * sh, 0);
    if (i % 3 === 2) B.box(m.gold, w + 0.004, 0.004, d + 0.004, 0, RY + i * sh + sh - 0.003, 0, { wuv: false });
  }
  const TY = RY + N * sh;
  B.box(m.marble, 0.16, 0.03, 0.11, 0, TY, 0); B.box(m.gold, 0.17, 0.008, 0.12, 0, TY + 0.03, 0, { wuv: false });
  quadriga(B, m, 0, TY + 0.038, 0, 0.16, 0);
  // garden
  for (const [tx, tz, th] of [[-0.6, 0.3, 0.26], [0.6, 0.3, 0.26], [-0.6, -0.3, 0.3], [0.6, -0.3, 0.3], [-0.62, 0.0, 0.22], [0.62, 0.0, 0.22]]) cypress(B, m, tx, 0.006, tz, th, 0.032, Math.round(tx * 9 + tz * 5));
  for (const s of [-1, 1]) { statuette(B, m, s * 0.34, 0.06, 0.42, 0.085, m.marble, m.marble); B.box(m.marble, 0.04, 0.06, 0.04, s * 0.34, 0.0, 0.42); }
  for (const s of [-1, 1]) B.box(m.marble, 0.12, 0.05, 0.05, s * 0.5, 0.0, 0.4);
  for (const s of [-1, 1]) brazier(B, m, ctx, s * 0.22, 0.06, 0.34, 0.85, 0.16);
  ctx.pulse(m.glowFire, 0.17, 9);
};

// =============================================================================
//  8. THE GREAT SPHINX
// =============================================================================
BUILDERS.sphinx = function (B, m, ctx) {
  const W = m.make('weathered', () => std({ color: 0xf3cf95, map: 'weather', rough: 0.95, vc: 1, jit: 0.04 }));
  const nem = m.make('nemes', () => std({ color: 0xffffff, map: 'stripes', rough: 0.9 }));
  const face = m.make('face', () => std({ color: 0xf6d2a6, map: 'weather', rough: 0.9 }));
  const stele = m.make('stele', () => std({ color: 0xd9b3a2, map: 'hiero', wuv: 14, rough: 0.7 }));
  const dune = (x, z, cx, cz, A, sx, sz) => A * Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  B.ground(terrainGeo((x, z) => 0.03 + 0.007 * Math.sin(x * 8 + z * 3) + 0.005 * Math.sin(z * 12 - x * 2)
    + dune(x, z, -0.3, 0.38, 0.045, 0.3, 0.08) + dune(x, z, 0.4, 0.4, 0.035, 0.25, 0.07) + dune(x, z, 0.6, -0.15, 0.05, 0.09, 0.3) + dune(x, z, -0.62, 0.1, 0.05, 0.08, 0.25), { uvs: 3 }), m.sand);
  // Khafre's pyramid as the backdrop
  pyramid(B, m, -0.4, -0.17, 0.18, 0.4, 0.4, 10, m.gold);
  // ---- the sphinx (built in its own frame, then yawed towards the camera)
  const sp = B.sub(0.03); sp.root.rotation.y = 0.92; sp.root.position.set(0.06, 0.03, 0.0); sp.root.scale.setScalar(1.15);
  sp.ell(m.sandstoneDark, 0.17, 0.045, 0.4, 0, 0.0, 0.03, { ws: 12, hs: 6 });
  sp.ell(W, 0.108, 0.118, 0.24, 0, 0.11, -0.1, { ws: 14, hs: 9 });
  sp.ell(W, 0.12, 0.118, 0.125, 0, 0.1, -0.21, { ws: 14, hs: 9 });
  for (const s of [-1, 1]) sp.ell(W, 0.055, 0.08, 0.105, s * 0.09, 0.075, -0.2, { ws: 10, hs: 7 });
  sp.ell(W, 0.11, 0.135, 0.135, 0, 0.14, 0.06, { ws: 14, hs: 9 });
  for (const s of [-1, 1]) {
    sp.ell(W, 0.04, 0.05, 0.2, s * 0.068, 0.05, 0.22, { ws: 10, hs: 7 });
    sp.ell(W, 0.044, 0.032, 0.06, s * 0.068, 0.03, 0.4, { ws: 10, hs: 7 });
    for (const t of [-1, 0, 1]) sp.ell(W, 0.011, 0.012, 0.022, s * 0.068 + t * 0.02, 0.026, 0.445, { ws: 6, hs: 5 });
    sp.ell(W, 0.03, 0.03, 0.03, s * 0.07, 0.07, 0.1, { ws: 8, hs: 6 });
  }
  sp.limb(W, [0, 0.2, 0.07], [0, 0.3, 0.1], 0.066, 0.052, 10);
  const hd = sp.pivot(0, 0.3, 0.08);
  hd.root.rotation.y = -0.55;
  hd.cyl(nem, 0.06, 0.098, 0.15, 0, 0.3, 0.045, 16, { sz: 0.85 });
  hd.ell(nem, 0.06, 0.03, 0.05, 0, 0.447, 0.045, { ws: 12, hs: 6 });
  hd.ell(face, 0.055, 0.072, 0.055, 0, 0.385, 0.14, { ws: 14, hs: 10 });
  for (const s of [-1, 1]) {
    hd.ell(nem, 0.027, 0.1, 0.042, s * 0.088, 0.27, 0.12, { ws: 9, hs: 8, rz: -s * 0.12 });
    hd.ell(m.dark, 0.012, 0.0034, 0.004, s * 0.023, 0.404, 0.191, { ws: 6, hs: 4, rz: s * 0.15 });
    hd.ell(face, 0.026, 0.006, 0.012, s * 0.023, 0.416, 0.19, { ws: 6, hs: 4, rz: s * 0.2 });
    hd.ell(face, 0.012, 0.022, 0.014, s * 0.056, 0.385, 0.115, { ws: 6, hs: 5 });
  }
  hd.ell(face, 0.009, 0.024, 0.014, 0, 0.385, 0.2, { ws: 6, hs: 5 });
  hd.ell(face, 0.012, 0.009, 0.012, 0, 0.363, 0.207, { ws: 6, hs: 5 });
  hd.ell(face, 0.022, 0.007, 0.01, 0, 0.342, 0.199, { ws: 6, hs: 4 });
  hd.box(m.dark, 0.028, 0.0024, 0.004, 0, 0.348, 0.203, { wuv: false });
  hd.ell(face, 0.022, 0.015, 0.015, 0, 0.32, 0.185, { ws: 6, hs: 4 });
  hd.add(new THREE.TorusGeometry(0.054, 0.0048, 6, 18, PI).rotateX(-PI / 2 + 0.25), m.gold, { x: 0, y: 0.432, z: 0.13, sz: 0.95 });
  hd.cone(m.gold, 0.006, 0.026, 0, 0.44, 0.192, 6, { rx: 0.3 });
  { const ruby = m.make('ruby', () => std({ color: 0xff5a4a, rough: 0.25, emissive: 0xff2a1a, ei: 1.7 })); B.glowMat(ruby); hd.sph(ruby, 0.0065, 0, 0.462, 0.197, { ws: 8, hs: 6 }); ctx.pulse(ruby, 0.3, 2.2); }
  sp.ell(nem, 0.06, 0.16, 0.035, 0, 0.23, 0.0, { ws: 9, hs: 8, rx: 0.2 });
  sp.tube(W, [[0.07, 0.04, -0.31], [0.15, 0.03, -0.28], [0.17, 0.028, -0.19], [0.15, 0.03, -0.08], [0.12, 0.05, -0.02]], 0.013, 12, 5);
  sp.sph(W, 0.02, 0.07, 0.05, -0.315, { ws: 8, hs: 6 });
  // dream stele between the paws
  sp.box(stele, 0.04, 0.085, 0.012, 0, 0.0, 0.325, { wuv: true });
  sp.add(archTop(0.02, 0.012, 8), stele, { x: 0, y: 0.085, z: 0.325, rx: PI / 2, wuv: false });
  // quarry walls of stacked blocks
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
    const h1 = hash2(k, s, 1), z = -0.27 + k * 0.088;
    sp.box(m.sandstone, 0.075, 0.035 + h1 * 0.03, 0.09, s * (0.25 + h1 * 0.008), 0, z, { ry: (hash2(k, s, 2) - 0.5) * 0.1 });
    if (k % 2 === 1) sp.box(m.limestoneDark, 0.06, 0.03, 0.075, s * (0.255 + h1 * 0.01), 0.04 + h1 * 0.02, z + 0.01, { ry: (hash2(k, s, 3) - 0.5) * 0.2 });
  }
  for (let k = 0; k < 5; k++) { const h1 = hash2(k, 7, 1); sp.box(m.sandstone, 0.09, 0.05 + h1 * 0.04 + (k % 2) * 0.03, 0.08, -0.2 + k * 0.1, 0, -0.32 + h1 * 0.02, { ry: (h1 - 0.5) * 0.15 }); }
  // temple ruins and details in the foreground
  for (let i = 0; i < 4; i++) { const px = 0.32 + i * 0.075, hh = [0.1, 0.075, 0.09, 0.04][i]; B.box(m.granite, 0.036, hh, 0.036, px, 0.03, 0.27 + (i % 2) * 0.03, { ry: 0.1 * i }); }
  B.box(m.granite, 0.16, 0.022, 0.04, 0.4, 0.13, 0.27, { ry: 0.05 }); B.box(m.sandstoneDark, 0.11, 0.02, 0.06, 0.5, 0.03, 0.14, { ry: 0.3 });
  B.box(m.sandstone, 0.09, 0.03, 0.05, -0.2, 0.03, 0.3, { ry: -0.3 }); B.box(m.sandstoneDark, 0.05, 0.02, 0.04, -0.28, 0.03, 0.26, { ry: 0.4 });
  obelisk(B, m, 0.56, 0.03, -0.02, 0.2, 0.014, 0.4);
  palm(B, m, -0.54, 0.03, 0.12, 0.22, 0.1, 0.3, 31); palm(B, m, -0.46, 0.03, 0.22, 0.16, -0.1, 2.3, 32);
  for (let i = 0; i < 7; i++) B.add(blobGeo(0.015 + 0.018 * B.rnd(), 0, 0.5, i + 40), m.rock, { x: -0.5 + B.rnd() * 1.0, y: 0.03, z: 0.05 + B.rnd() * 0.3, sy: 0.6 });
};

// =============================================================================
//  9. CIRCUS MAXIMUS
// =============================================================================
BUILDERS.circus_maximus = function (B, m, ctx) {
  const HL = 0.26, RO = 0.39, RA = 0.25;
  const canal = m.make('canal', () => std({ color: 0x35bfd0, map: 'water', own: true, wuv: 3, rough: 0.1, emissive: 0x0a5560, ei: 0.4 }));
  const horseA = m.make('horseA', () => std({ color: 0x7a4322, rough: 0.6 })), horseB = m.make('horseB', () => std({ color: 0xefe6d6, rough: 0.6 }));
  const manes = m.make('manes', () => std({ color: 0x1e1510, rough: 0.7 }));
  const teamRed = m.make('teamRed', () => std({ color: 0xb02525, rough: 0.5, metal: 0.1, double: true })), teamBlue = m.make('teamBlue', () => std({ color: 0x2652b0, rough: 0.5, metal: 0.1, double: true }));
  B.ground(terrainGeo(() => 0.004, { uvs: 3.4 }), m.limestoneDark);
  // arena floor, spina
  const inner = stadiumPts(HL, RA - 0.012);
  B.ext(m.sand, shapeFrom(inner), 0.014, 0, 0, 0, { uvs: 3.4, wuv: false });
  B.ext(m.limestoneDark, ringShape(stadiumPts(HL, RA + 0.004), stadiumPts(HL, RA - 0.012)), 0.048, 0, 0, 0, { wuv: false, uvs: 3 });
  B.ext(m.gold, ringShape(stadiumPts(HL, RA + 0.004), stadiumPts(HL, RA - 0.002)), 0.004, 0, 0.048, 0, { wuv: false });
  // seating tiers (crowd texture on top, stone risers)
  const NB = 5, ri = k => RA + 0.014 + k * ((RO - 0.014 - RA - 0.014) / NB);
  let yPrev = 0.048;
  for (let k = 0; k < NB; k++) {
    const yk = 0.048 + 0.026 * (k + 1), band = ringShape(stadiumPts(HL, ri(k + 1) + 0.0005), stadiumPts(HL, ri(k)));
    B.ext(m.crowd, band, yk - yPrev, 0, yPrev, 0, { uvs: 7, wuv: false });
    yPrev = yk;
  }
  // outer arcaded wall
  const outerPts = stadiumPts(HL, RO, 34);
  let per = 0; for (let i = 0; i < outerPts.length; i++) { const a = outerPts[i], b = outerPts[(i + 1) % outerPts.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  const tile = per / Math.round(per / 0.19), WH = 0.19;
  const wall = wallStrip(outerPts, 0, WH, tile);
  B.add(wall.g, m.arcade, {});
  B.ext(m.limestone, ringShape(stadiumPts(HL, RO + 0.008, 34), stadiumPts(HL, RO - 0.03, 34)), 0.016, 0, WH - 0.004, 0, { wuv: false });
  B.ext(m.marble, ringShape(stadiumPts(HL, RO + 0.004, 34), stadiumPts(HL, RO - 0.006, 34)), 0.012, 0, WH + 0.012, 0, { wuv: false });
  // carceres (starting gates) around the left end
  for (let i = 0; i < 11; i++) {
    const a = PI / 2 + 0.28 + i * (PI - 0.56) / 10, rr = RA - 0.008, gx = -HL + Math.cos(a) * rr, gz = Math.sin(a) * rr;
    const dx = -Math.cos(a), dz = -Math.sin(a), yaw = Math.atan2(dx, dz);
    B.box(m.limestone, 0.03, 0.062, 0.02, gx, 0.014, gz, { ry: yaw });
    B.box(m.dark, 0.02, 0.036, 0.006, gx + dx * 0.0105, 0.014, gz + dz * 0.0105, { ry: yaw, wuv: false });
    B.add(archTop(0.01, 0.006, 6), m.dark, { x: gx + dx * 0.0105, y: 0.05, z: gz + dz * 0.0105, rx: PI / 2, ry: yaw });
  }
  // spina
  B.box(m.limestone, 0.76, 0.028, 0.06, 0, 0.014, 0); B.box(m.marble, 0.79, 0.008, 0.075, 0, 0.038, 0);
  B.box(canal, 0.7, 0.004, 0.032, 0, 0.044, 0, { wuv: true });
  for (const s of [-1, 1]) {           // turning posts (metae)
    B.cyl(m.limestone, 0.03, 0.036, 0.03, s * 0.385, 0.014, 0, 12);
    for (let i = 0; i < 3; i++) B.cone(m.gold, 0.012, 0.11 + (i === 1 ? 0.02 : 0), s * 0.385 + (i - 1) * 0.02 * s, 0.044, (i % 2 ? 0.008 : -0.008), 8);
  }
  obelisk(B, m, 0, 0.046, 0, 0.29, 0.02, 0);
  for (const s of [-1, 1]) brazier(B, m, ctx, s * 0.41, 0.014, 0.055, 0.5, 0.12);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) { const px = s * (0.12 + i * 0.1); B.box(m.marble, 0.03, 0.018, 0.03, px, 0.044, 0); statuette(B, m, px, 0.062, 0, 0.085, i ? m.gold : m.bronze, i ? m.gold : m.bronze, { ry: s * 1.4 }); }
    // lap counters: eggs on one side, dolphins on the other
    B.limb(m.marble, [s * 0.24, 0.046, 0.02], [s * 0.24, 0.1, 0.02], 0.005, 0.005, 6); B.limb(m.marble, [s * 0.32, 0.046, 0.02], [s * 0.32, 0.1, 0.02], 0.005, 0.005, 6);
    B.box(m.marble, 0.1, 0.008, 0.012, s * 0.28, 0.1, 0.02);
    for (let i = 0; i < 7; i++) { const px = s * (0.24 + i * 0.0133); if (s < 0) B.ell(m.ivory, 0.0055, 0.008, 0.0055, px, 0.113, 0.02, { ws: 6, hs: 5 }); else B.ell(m.gold, 0.004, 0.0035, 0.009, px, 0.111, 0.02, { ws: 5, hs: 4, rz: 0.4 }); }
  }
  // the gate arch at the round end
  B.box(m.limestone, 0.06, 0.24, 0.14, RO + HL - 0.025, 0, 0);
  B.box(m.dark, 0.062, 0.1, 0.05, RO + HL - 0.022, 0.014, 0, { wuv: false });
  B.add(archTop(0.025, 0.062, 8), m.dark, { x: RO + HL - 0.022, y: 0.114, z: 0, rx: PI / 2, ry: PI / 2 });
  B.box(m.marble, 0.07, 0.014, 0.16, RO + HL - 0.025, 0.24, 0);
  B.cone(m.gold, 0.012, 0.04, RO + HL - 0.025, 0.254, 0, 6);
  // banners around the rim
  const cols = [m.cloth, m.clothBlue, m.clothWhite, teamRed, teamBlue];
  const nb = 16;
  for (let i = 0; i < nb; i++) {
    const t = i / nb, u = t * per; let x, z;
    // walk along the outline by arclength
    let acc = 0; let px = outerPts[0][0], pz = outerPts[0][1];
    for (let k = 0; k < outerPts.length; k++) { const a = outerPts[k], b = outerPts[(k + 1) % outerPts.length], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (acc + d >= u) { const f = (u - acc) / d; px = a[0] + (b[0] - a[0]) * f; pz = a[1] + (b[1] - a[1]) * f; break; } acc += d; }
    x = px * 0.985; z = pz * 0.985;
    B.limb(m.woodDark, [x, WH + 0.012, z], [x, WH + 0.11, z], 0.0028, 0.0022, 5);
    B.add(sailGeo(0.032, 0.05, 0.004, 3, 2, 0.15), cols[i % cols.length], { x, y: WH + 0.108, z, ry: Math.atan2(x, z) });
    B.sph(m.gold, 0.004, x, WH + 0.112, z, { ws: 5, hs: 4 });
  }
  // ---------- racing chariots
  const chariot = (horseMat, teamMat) => {
    const cb = B.sub(0.016);
    const sc = 0.078;
    for (const s of [-1, 1]) horse(cb, horseMat, s * 0.017, 0, 0.04, sc, 0, 1, manes);
    cb.box(teamMat, 0.05, 0.008, 0.032, 0, 0.018, -0.018, { wuv: false });
    cb.box(teamMat, 0.05, 0.02, 0.004, 0, 0.018, -0.033, { wuv: false });
    for (const s of [-1, 1]) { cb.add(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 12), m.woodDark, { x: s * 0.028, y: 0.016, z: -0.018, rz: PI / 2 }); }
    cb.limb(m.woodDark, [0, 0.022, -0.014], [0, 0.03, 0.045], 0.0025, 0.002, 4);
    statuette(cb, m, 0, 0.022, -0.02, 0.05, teamMat, m.skin, { arm: 1 });
    return cb.root;
  };
  const chA = chariot(horseA, teamRed), chB = chariot(horseB, teamBlue);
  const laps = [{ g: chA, r: 0.15, v: 0.16, s0: 0 }, { g: chB, r: 0.2, v: 0.14, s0: 1.3 }];
  ctx.anim.push((t) => {
    for (const L of laps) {
      const st = HL * 2, arc = PI * L.r, per2 = 2 * (st + arc);
      let s = ((t * L.v + L.s0) % per2 + per2) % per2, x, z, hx, hz;
      if (s < st) { x = -HL + s; z = -L.r; hx = 1; hz = 0; }
      else if ((s -= st) < arc) { const th = -PI / 2 + s / L.r; x = HL + L.r * Math.cos(th); z = L.r * Math.sin(th); hx = -Math.sin(th); hz = Math.cos(th); }
      else if ((s -= arc) < st) { x = HL - s; z = L.r; hx = -1; hz = 0; }
      else { s -= st; const th = PI / 2 + s / L.r; x = -HL + L.r * Math.cos(th); z = L.r * Math.sin(th); hx = -Math.sin(th); hz = Math.cos(th); }
      L.g.position.set(x, 0.016 + 0.0015 * Math.abs(Math.sin(t * 14 + L.r * 20)), z);
      L.g.rotation.y = Math.atan2(hx, hz);
    }
    canal.map.offset.set(t * 0.03, t * 0.02);
  });
  ctx.pulse(m.glowFire, 0.17, 9);
};

// =============================================================================
//  10. PIRAEUS HARBOUR
// =============================================================================
function amphora(B, mat, x, y, z, s = 1, tilt = 0, ry = 0) {
  const P = [[0.001, 0], [0.006, 0.003], [0.013, 0.016], [0.0155, 0.032], [0.012, 0.048], [0.0065, 0.058], [0.0065, 0.066], [0.0105, 0.07], [0.0105, 0.073], [0.005, 0.072]];
  B.lathe(mat, P.map(p => [p[0] * s, p[1] * s]), x, y, z, 8, { rz: tilt, ry });
  for (const sd of [-1, 1]) B.tube(mat, [[x + sd * 0.0075 * s, y + 0.06 * s, z], [x + sd * 0.0175 * s, y + 0.055 * s, z], [x + sd * 0.0155 * s, y + 0.038 * s, z]], 0.0018 * s, 5, 3, { ry });
}
BUILDERS.piraeus = function (B, m, ctx) {
  const sea = waterSurface(B, m.waterDeep, { level: 0.04, amp: 0.0045, speed: 1.15 });
  ctx.anim.push(t => sea.update(t));
  const hullA = m.make('hullA', () => std({ color: 0x9a5d34, map: 'wood', rough: 0.65, double: true })), hullB = m.make('hullB', () => std({ color: 0x3f4a63, map: 'wood', rough: 0.65, double: true }));
  const crateM = m.make('crateM', () => std({ color: 0xc79a5c, map: 'wood', wuv: 6, rough: 0.8, vc: 1, jit: 0.1 }));
  const sack = m.make('sack', () => std({ color: 0xd8c39a, rough: 0.95, vc: 1, jit: 0.06 }));
  const rope = m.make('rope', () => std({ color: 0xbfa46a, rough: 0.95 }));
  // ---- quay
  B.box(m.limestone, 1.32, 0.1, 0.26, 0, 0, -0.28);
  B.box(m.limestoneDark, 1.32, 0.012, 0.26, 0, 0.1, -0.28);
  for (let i = 0; i < 22; i++) B.box(m.limestone, 0.06, 0.016, 0.014, -0.63 + i * 0.06, 0.1, -0.153);      // edge stones
  for (let i = 0; i < 10; i++) { const x = -0.6 + i * 0.135; B.cyl(m.bronzeDark, 0.007, 0.009, 0.018, x, 0.112, -0.16, 8); B.sph(m.bronzeDark, 0.009, x, 0.13, -0.16, { ws: 6, hs: 4 }); }
  // ---- arcaded warehouse (stoa)
  const wx0 = -0.6, wx1 = 0.08, wz = -0.345, wh = 0.13, wd = 0.11;
  B.box(m.limestone, wx1 - wx0, wh, wd, (wx0 + wx1) / 2, 0.112, wz);
  const nb = 11;
  for (let i = 0; i < nb; i++) {
    const x = wx0 + 0.03 + i * ((wx1 - wx0 - 0.06) / (nb - 1));
    B.box(m.dark, 0.036, 0.07, 0.01, x, 0.114, wz + wd / 2, { wuv: false });
    B.add(archTop(0.018, 0.01, 6), m.dark, { x, y: 0.184, z: wz + wd / 2, rx: PI / 2 });
    B.box(m.limestoneDark, 0.05, 0.008, 0.016, x, 0.243 - 0.0, wz + wd / 2);
  }
  B.box(m.marble, wx1 - wx0 + 0.02, 0.012, wd + 0.02, (wx0 + wx1) / 2, 0.112 + wh, wz);
  pitchedRoof(B, m.terracotta, (wx0 + wx1) / 2, 0.112 + wh + 0.012, wz, wd + 0.03, wx1 - wx0 + 0.03, 0.06, 0.014, 0.01, PI / 2);
  // second warehouse with gable
  B.box(m.limestone, 0.2, 0.12, 0.1, 0.27, 0.112, -0.33);
  B.box(m.dark, 0.05, 0.075, 0.01, 0.27, 0.112, -0.279, { wuv: false }); B.box(m.woodDark, 0.044, 0.07, 0.006, 0.27, 0.112, -0.276, { wuv: false });
  pitchedRoof(B, m.terracotta, 0.27, 0.232, -0.33, 0.22, 0.12, 0.06, 0.014, 0.01, 0);
  pediment(B, { x: 0.27, y: 0.232, z: -0.276, w: 0.2, rise: 0.055, depth: 0.012, frame: m.marble, field: m.limestone, bw: 0.008 });
  // ---- lamp tower on the mole (the Piraeus beacon)
  const tx = 0.52, tz = -0.24;
  B.hip(m.limestone, 0.1, 0.1, 0.06, 0.8, tx, 0.112, tz);
  B.hip(m.limestone, 0.08, 0.08, 0.2, 0.8, tx, 0.172, tz);
  B.box(m.marble, 0.09, 0.012, 0.09, tx, 0.372, tz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(m.marble, 0.005, 0.005, 0.05, tx + sx * 0.032, 0.384, tz + sz * 0.032, 6);
  B.box(m.marble, 0.09, 0.008, 0.09, tx, 0.434, tz);
  B.box(m.dark, 0.014, 0.036, 0.008, tx, 0.24, tz + 0.036, { wuv: false }); B.box(m.dark, 0.014, 0.036, 0.008, tx, 0.31, tz + 0.03, { wuv: false });
  B.hip(m.terracotta, 0.11, 0.11, 0.05, 0.1, tx, 0.442, tz);
  flame(B, m, ctx, tx, 0.384, tz, 0.06, 0.22);
  // ---- mole (breakwater) down the right side
  for (let i = 0; i < 9; i++) {
    const z = -0.16 + i * 0.058;
    B.box(m.limestone, 0.07, 0.085, 0.06, 0.55, 0.06, z); B.box(m.limestoneDark, 0.076, 0.012, 0.062, 0.55, 0.145, z);
    B.box(m.limestone, 0.02, 0.014, 0.02, 0.525, 0.157, z); B.box(m.limestone, 0.02, 0.014, 0.02, 0.575, 0.157, z);
  }
  B.cyl(m.limestone, 0.05, 0.056, 0.13, 0.55, 0.06, 0.37, 12); B.cyl(m.limestoneDark, 0.06, 0.06, 0.012, 0.55, 0.19, 0.37, 12);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.box(m.limestone, 0.02, 0.016, 0.02, 0.55 + Math.sin(a) * 0.052, 0.202, 0.37 + Math.cos(a) * 0.052, { ry: a }); }
  B.cone(m.terracottaPlain, 0.045, 0.05, 0.55, 0.2, 0.37, 12);
  // ---- small tholos temple on the quay
  { const cx = -0.5, cz = -0.19, y0 = 0.112; B.cyl(m.marble, 0.06, 0.066, 0.016, cx, y0, cz, 14); B.cyl(m.marble, 0.055, 0.058, 0.01, cx, y0 + 0.016, cz, 14);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; column(B, m.marble, cx + Math.sin(a) * 0.045, cz + Math.cos(a) * 0.045, y0 + 0.026, 0.085, 0.0065, 'doric'); }
    B.cyl(m.limestone, 0.036, 0.036, 0.075, cx, y0 + 0.026, cz, 12); B.cyl(m.marble, 0.058, 0.058, 0.012, cx, y0 + 0.111, cz, 14);
    B.add(new THREE.SphereGeometry(0.05, 12, 5, 0, TAU, 0, PI / 2), m.terracotta, { x: cx, y: y0 + 0.123, z: cz, sy: 0.8 }); B.cone(m.gold, 0.006, 0.02, cx, y0 + 0.162, cz, 6); }
  // ---- crates, amphorae, barrels, sacks
  B.box(crateM, 0.045, 0.045, 0.045, -0.12, 0.112, -0.2, { ry: 0.2 }); B.box(crateM, 0.04, 0.04, 0.04, -0.06, 0.112, -0.19, { ry: -0.1 }); B.box(crateM, 0.038, 0.038, 0.038, -0.09, 0.157, -0.195, { ry: 0.5 });
  B.box(crateM, 0.05, 0.035, 0.04, 0.14, 0.112, -0.2, { ry: 0.1 }); B.box(crateM, 0.04, 0.04, 0.04, 0.2, 0.112, -0.195, { ry: 0.3 });
  for (let i = 0; i < 6; i++) amphora(B, m.terracottaPlain, -0.35 + (i % 3) * 0.028, 0.112, -0.2 + Math.floor(i / 3) * 0.028, 1.15, 0, i);
  amphora(B, m.terracottaPlain, -0.3, 0.112, -0.19, 1.15, 1.2, 0.5);
  for (let i = 0; i < 4; i++) { const bx = 0.34 + i * 0.03; B.lathe(m.woodDark, [[0.001, 0], [0.011, 0], [0.0145, 0.012], [0.0145, 0.02], [0.011, 0.032], [0.001, 0.032]], bx, 0.112, -0.19, 8); }
  for (let i = 0; i < 4; i++) B.ell(sack, 0.017, 0.012, 0.014, 0.43 + (i % 2) * 0.03, 0.124 + Math.floor(i / 2) * 0.016, -0.18, { ws: 7, hs: 5, ry: i });
  // workers
  const cl = [m.cloth, m.clothBlue, m.clothWhite, m.terracottaPlain];
  for (let i = 0; i < 5; i++) statuette(B, m, -0.28 + i * 0.14, 0.112, -0.135 + (i % 2) * 0.01, 0.05, cl[i % 4], m.skin, { arm: i % 2, ry: i * 0.9 });
  // ---- animated crane with swinging crate
  const cx = 0.16, cz = -0.16;
  B.box(m.woodDark, 0.04, 0.03, 0.04, cx, 0.112, cz); B.limb(m.woodDark, [cx, 0.14, cz], [cx, 0.3, cz], 0.009, 0.006, 6);
  B.limb(m.wood, [cx, 0.29, cz], [cx, 0.27, cz + 0.16], 0.005, 0.004, 5); B.limb(m.wood, [cx, 0.29, cz], [cx, 0.13, cz + 0.02], 0.003, 0.003, 4);
  const cr = B.pivot(cx, 0.27, cz + 0.16);
  cr.limb(rope, [cx, 0.27, cz + 0.16], [cx, 0.21, cz + 0.16], 0.0015, 0.0015, 3);
  cr.box(crateM, 0.03, 0.03, 0.03, cx, 0.18, cz + 0.16);
  ctx.anim.push(t => { cr.root.rotation.x = 0.1 * Math.sin(t * 0.9); cr.root.rotation.z = 0.06 * Math.sin(t * 0.7 + 1); });
  // ---- two triremes
  const shipA = ship(B, m, { L: 0.58, beam: 0.085, depth: 0.045, sheer: 0.07, oars: 13, oarLen: 0.17, mast: 0.34, sail: m.sailRed, y: 0.04, shields: 1, hull: hullA, yard: 0.26, pennant: m.cloth, brace: -0.85 });
  const shipB = ship(B, m, { L: 0.5, beam: 0.078, depth: 0.04, sheer: 0.065, oars: 11, oarLen: 0.155, mast: 0.3, sail: m.sailBlue, y: 0.04, shields: 1, hull: hullB, yard: 0.24, pennant: m.clothBlue, trim: m.goldDim, brace: 0.85 });
  const skiff = ship(B, m, { L: 0.2, beam: 0.052, depth: 0.03, sheer: 0.03, oars: 0, mast: 0.15, sail: m.make('cream', () => std({ color: 0xf1e7cd, rough: 0.9, double: true })), y: 0.04, hull: hullA, yard: 0.11, brace: 0.5 });
  const posA = [-0.12, -0.06, PI / 2 + 0.05], posB = [-0.03, 0.235, -PI / 2 + 0.12];
  ctx.anim.push((t) => {
    shipA.g.position.set(posA[0] + 0.004 * Math.sin(t * 0.6), 0.04 + 0.006 * Math.sin(t * 1.3), posA[1] + 0.005 * Math.sin(t * 0.5 + 1));
    shipA.g.rotation.set(0.035 * Math.sin(t * 1.1), posA[2] + 0.02 * Math.sin(t * 0.4), 0.05 * Math.sin(t * 1.5));
    shipB.g.position.set(posB[0] + 0.004 * Math.sin(t * 0.55 + 2), 0.04 + 0.006 * Math.sin(t * 1.2 + 1.2), posB[1] + 0.005 * Math.sin(t * 0.5));
    shipB.g.rotation.set(0.035 * Math.sin(t * 1.0 + 2), posB[2] + 0.02 * Math.sin(t * 0.45 + 1), 0.05 * Math.sin(t * 1.4 + 1));
    skiff.g.position.set(-0.45 + 0.004 * Math.sin(t * 0.7), 0.04 + 0.005 * Math.sin(t * 1.6), 0.24 + 0.005 * Math.sin(t * 0.6));
    skiff.g.rotation.set(0.05 * Math.sin(t * 1.3 + 3), 0.6 + 0.05 * Math.sin(t * 0.5), 0.07 * Math.sin(t * 1.7));
  });
  // moorings
  for (const [sx, sz] of [[-0.28, -0.153], [0.02, -0.153]]) B.tube(rope, [[sx, 0.13, sz], [sx + 0.01, 0.1, sz + 0.05], [sx + 0.005, 0.07, sz + 0.1]], 0.0016, 6, 3);
  cypress(B, m, -0.62, 0.11, -0.34, 0.24, 0.028, 3);
  gulls(B, m, ctx, [{ cx: 0.05, cz: 0.05, R: 0.45, k: 0.62, H: 0.55, sp: 0.5 }, { cx: 0.0, cz: 0.05, R: 0.35, k: 0.6, H: 0.68, sp: -0.4 }, { cx: 0.1, cz: 0.0, R: 0.5, k: 0.55, H: 0.5, sp: 0.42 }]);
};

// =============================================================================
//  11. STATUE OF ZEUS AT OLYMPIA
// =============================================================================
BUILDERS.statue_of_zeus = function (B, m, ctx) {
  const lapis = m.make('lapis', () => std({ color: 0x25468f, rough: 0.5, metal: 0.05 }));
  const floor = m.make('floor', () => std({ color: 0xffffff, map: 'checker', wuv: 3, rough: 0.25 }));
  const poolM = m.make('poolM', () => std({ color: 0xffffff, map: 'poolReflect', own: true, rough: 0.04, metal: 0.2, emissive: 0x0b2a44, ei: 0.5 }));
  const ripple = m.make('ripple', () => { const t = std({ color: 0xbfe8ff, map: 'water', own: true, rough: 0.2, transparent: true, opacity: 0.16, noCast: true }); t.blending = THREE.AdditiveBlending; t.depthWrite = false; return t; });
  const ivory = m.ivory, gd = m.gold;
  B.ground(terrainGeo(() => 0.006, { uvs: 3.4 }), m.limestoneDark);
  const Y = 0.09, cz = -0.105;
  [[1.16, 0.68], [1.12, 0.64], [1.08, 0.6]].forEach(([w, d], i) => B.box(m.limestone, w, 0.03, d, 0, i * 0.03, cz));
  B.box(floor, 0.9, 0.004, 0.5, 0, Y, cz - 0.02, { wuv: true });
  // ---- back wall (lapis screen) and side barriers
  B.box(m.marble, 0.98, 0.52, 0.035, 0, Y, -0.315);
  B.box(lapis, 0.86, 0.42, 0.01, 0, Y + 0.05, -0.293, { wuv: false });
  for (let i = 0; i < 5; i++) B.box(m.gold, 0.006, 0.42, 0.012, -0.34 + i * 0.17, Y + 0.05, -0.291, { wuv: false });
  B.box(m.gold, 0.87, 0.008, 0.012, 0, Y + 0.46, -0.291, { wuv: false });
  for (const s of [-1, 1]) B.box(lapis, 0.02, 0.09, 0.24, s * 0.27, Y, -0.13, { wuv: false });      // blue barriers beside the statue
  // ---- Doric colonnade
  const colH = 0.5, xs = i => -0.475 + i * 0.19;
  for (let i = 0; i < 6; i++) { column(B, m.marble, xs(i), 0.14, Y, colH, 0.027, 'doric'); column(B, m.marble, xs(i), -0.33, Y, colH, 0.027, 'doric'); }
  for (const z of [-0.0167, -0.173]) { column(B, m.marble, -0.475, z, Y, colH, 0.027, 'doric'); column(B, m.marble, 0.475, z, Y, colH, 0.027, 'doric'); }
  const EY = Y + colH;
  frameRing(B, m.marble, 0, cz, 1.06, 0.58, 0.06, EY, 0.04);
  frameRing(B, m.marbleWarm, 0, cz, 1.07, 0.59, 0.05, EY + 0.04, 0.04);
  for (let i = 0; i < 23; i++) { const x = -0.5 + i * 0.0455; B.box(lapis, 0.012, 0.036, 0.004, x, EY + 0.042, 0.1925, { wuv: false }); B.box(lapis, 0.012, 0.036, 0.004, x, EY + 0.042, -0.4025, { wuv: false }); }
  for (let i = 0; i < 12; i++) { const z = 0.16 - i * 0.0475; for (const s of [-1, 1]) B.box(lapis, 0.004, 0.036, 0.012, s * 0.5375, EY + 0.042, z - 0.03, { wuv: false }); }
  frameRing(B, m.marble, 0, cz, 1.12, 0.64, 0.08, EY + 0.08, 0.016);
  const PY = EY + 0.096, rise = 0.14;
  for (const [pz, s] of [[0.1935, 1], [-0.4035, -1]]) {
    pediment(B, { x: 0, y: PY, z: pz, w: 1.12, rise, depth: 0.03, frame: m.marble, field: s < 0 ? lapis : null, bw: 0.02 });
    B.cone(gd, 0.024, 0.06, 0, PY + rise - 0.01, pz, 8); B.sph(gd, 0.011, 0, PY + rise + 0.055, pz, { ws: 6, hs: 5 });
    for (const sx of [-1, 1]) B.cone(gd, 0.02, 0.05, sx * 0.555, PY, pz, 8);
  }
  // pediment sculpture on the front (floating gold figures in the open frame)
  for (let i = 0; i < 9; i++) { const fx = -0.4 + i * 0.1, hh = 0.03 + 0.08 * (1 - Math.abs(fx) / 0.56); B.cyl(gd, 0.008, 0.013, hh, fx, PY + 0.03, 0.1935, 6); B.sph(gd, 0.01, fx, PY + 0.03 + hh + 0.006, 0.1935, { ws: 6, hs: 5 }); }
  B.box(gd, 0.8, 0.012, 0.016, 0, PY + 0.022, 0.1935, { wuv: false });
  // timber roof frame (open cutaway: only over the rear half so the statue stays visible)
  const ridgeY = PY + rise - 0.005;
  B.limb(m.wood, [0, ridgeY, -0.4], [0, ridgeY, -0.1], 0.008, 0.008, 6);
  for (let i = 0; i < 4; i++) { const z = -0.37 + i * 0.09; for (const s of [-1, 1]) B.beam(m.wood, [0, ridgeY, z], [s * 0.55, PY + 0.008, z], 0.009, 0.008); }
  for (const s of [-1, 1]) B.limb(m.wood, [s * 0.55, PY + 0.012, -0.4], [s * 0.55, PY + 0.012, -0.1], 0.007, 0.007, 5);
  // ---- reflecting pool in front
  B.box(m.marble, 1.02, 0.03, 0.22, 0, 0, 0.29); B.box(m.marbleDark, 0.94, 0.004, 0.16, 0, 0.03, 0.29);
  B.add(new THREE.PlaneGeometry(0.94, 0.16).rotateX(-PI / 2), poolM, { x: 0, y: 0.0355, z: 0.29 });
  B.add(new THREE.PlaneGeometry(0.94, 0.16).rotateX(-PI / 2), ripple, { x: 0, y: 0.037, z: 0.29, uvs: 2 });
  B.box(m.gold, 0.96, 0.004, 0.005, 0, 0.03, 0.208, { wuv: false }); B.box(m.gold, 0.96, 0.004, 0.005, 0, 0.03, 0.372, { wuv: false });
  for (const s of [-1, 1]) { B.box(m.marble, 0.05, 0.05, 0.05, s * 0.5, 0, 0.35); B.cyl(m.bronzeDark, 0.018, 0.012, 0.03, s * 0.5, 0.05, 0.35, 10); flame(B, m, ctx, s * 0.5, 0.08, 0.35, 0.05, 0.1); }
  // ---- the colossal seated statue
  const SY = Y + 0.006, sx0 = 0, sz0 = -0.13;
  B.box(m.marbleDark, 0.52, 0.04, 0.36, sx0, SY, sz0); B.box(gd, 0.53, 0.008, 0.37, sx0, SY + 0.04, sz0, { wuv: false });
  const st = B.sub(SY + 0.05); st.root.position.x = sx0; st.root.position.z = sz0; st.root.scale.setScalar(1.05);
  const eb = m.marbleDark;
  st.box(eb, 0.36, 0.06, 0.27, 0, 0, 0); st.box(gd, 0.37, 0.008, 0.28, 0, 0.06, 0, { wuv: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { st.box(gd, 0.034, 0.12, 0.034, sx * 0.145, 0.068, sz * 0.105, { wuv: false }); st.sph(ivory, 0.018, sx * 0.145, 0.19, sz * 0.105, { ws: 7, hs: 5 }); }
  st.box(ivory, 0.32, 0.03, 0.25, 0, 0.19, 0, { wuv: false });                         // seat
  st.box(gd, 0.33, 0.01, 0.26, 0, 0.22, 0, { wuv: false });
  st.box(eb, 0.32, 0.4, 0.04, 0, 0.23, -0.115); st.box(gd, 0.24, 0.3, 0.008, 0, 0.29, -0.093, { wuv: false }); st.box(lapis, 0.2, 0.26, 0.01, 0, 0.31, -0.092, { wuv: false });
  for (const sx of [-1, 1]) { st.cone(gd, 0.03, 0.09, sx * 0.13, 0.63, -0.115, 6); st.box(gd, 0.04, 0.09, 0.2, sx * 0.165, 0.22, 0.0, { wuv: false }); st.ell(gd, 0.02, 0.025, 0.035, sx * 0.165, 0.335, 0.095, { ws: 7, hs: 5 }); st.sph(ivory, 0.014, sx * 0.165, 0.365, 0.115, { ws: 6, hs: 5 }); }
  st.box(eb, 0.24, 0.035, 0.11, 0, 0, 0.19); st.box(gd, 0.25, 0.008, 0.115, 0, 0.035, 0.19, { wuv: false });
  // legs and robe
  const legs = s => {
    st.limb(ivory, [s * 0.06, 0.28, -0.03], [s * 0.065, 0.28, 0.13], 0.05, 0.04, 8);
    st.limb(ivory, [s * 0.065, 0.28, 0.13], [s * 0.065, 0.075, 0.15], 0.038, 0.03, 8);
    st.box(ivory, 0.05, 0.02, 0.09, s * 0.065, 0.043, 0.17, { wuv: false }); st.box(gd, 0.052, 0.006, 0.03, s * 0.065, 0.058, 0.155, { wuv: false });
  };
  legs(-1); legs(1);
  st.ell(gd, 0.135, 0.06, 0.16, 0, 0.29, 0.02, { ws: 12, hs: 8 });
  st.add(clothGeo(0.2, 0.2, 3.2, 0.014, 14, 5, 0.18), m.gold, { x: 0, y: 0.31, z: 0.16, rx: 0.12 });
  st.ell(gd, 0.07, 0.09, 0.04, 0.0, 0.2, 0.13, { ws: 8, hs: 6 });
  // torso, drapery, head
  st.ell(ivory, 0.082, 0.075, 0.062, 0, 0.365, -0.05, { ws: 12, hs: 8 });
  st.ell(ivory, 0.098, 0.09, 0.068, 0, 0.46, -0.055, { ws: 14, hs: 9 });
  for (const s of [-1, 1]) st.sph(ivory, 0.036, s * 0.105, 0.51, -0.055, { ws: 8, hs: 6 });
  st.tube(gd, [[-0.1, 0.53, -0.03], [-0.03, 0.47, 0.005], [0.05, 0.4, 0.0], [0.11, 0.33, 0.0]], 0.014, 12, 5);
  st.add(clothGeo(0.1, 0.16, 2.4, 0.012, 8, 4, 0.2), m.gold, { x: -0.105, y: 0.52, z: -0.075, ry: 0.2 });
  st.cyl(ivory, 0.024, 0.03, 0.05, 0, 0.51, -0.05, 10);
  st.ell(ivory, 0.047, 0.058, 0.052, 0, 0.6, -0.045, { ws: 12, hs: 9 });
  st.ell(gd, 0.052, 0.05, 0.055, 0, 0.617, -0.058, { ws: 12, hs: 8 });
  st.ell(gd, 0.034, 0.048, 0.03, 0, 0.555, -0.01, { ws: 10, hs: 7 });
  st.ell(gd, 0.026, 0.006, 0.01, 0, 0.583, 0.0, { ws: 8, hs: 4 });
  st.sph(m.dark, 0.005, -0.018, 0.612, 0.004, { ws: 5, hs: 4 }); st.sph(m.dark, 0.005, 0.018, 0.612, 0.004, { ws: 5, hs: 4 });
  st.add(new THREE.TorusGeometry(0.05, 0.005, 6, 20).rotateX(PI / 2), gd, { x: 0, y: 0.638, z: -0.045, sx: 1, sz: 1.05 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; st.ell(gd, 0.012, 0.004, 0.006, Math.sin(a) * 0.05, 0.643, -0.045 + Math.cos(a) * 0.052, { ws: 5, hs: 3, ry: a }); }
  // right arm holding Nike
  st.limb(ivory, [0.105, 0.5, -0.055], [0.135, 0.41, 0.02], 0.03, 0.026, 8); st.sph(ivory, 0.027, 0.135, 0.41, 0.02, { ws: 7, hs: 5 });
  st.limb(ivory, [0.135, 0.41, 0.02], [0.12, 0.42, 0.13], 0.026, 0.02, 8); st.sph(ivory, 0.022, 0.12, 0.42, 0.14, { ws: 7, hs: 5 });
  statuette(st, m, 0.12, 0.44, 0.14, 0.11, gd, ivory, { arm: 1 });
  st.ell(gd, 0.005, 0.03, 0.02, 0.135, 0.5, 0.14, { ws: 5, hs: 4, rz: -0.5 }); st.ell(gd, 0.005, 0.03, 0.02, 0.105, 0.5, 0.14, { ws: 5, hs: 4, rz: 0.5 });
  // left arm with sceptre + eagle
  st.limb(ivory, [-0.105, 0.5, -0.055], [-0.14, 0.42, 0.0], 0.03, 0.026, 8); st.sph(ivory, 0.027, -0.14, 0.42, 0.0, { ws: 7, hs: 5 });
  st.limb(ivory, [-0.14, 0.42, 0.0], [-0.14, 0.5, 0.1], 0.026, 0.02, 8); st.sph(ivory, 0.022, -0.14, 0.5, 0.11, { ws: 7, hs: 5 });
  st.limb(gd, [-0.14, 0.16, 0.11], [-0.14, 0.82, 0.11], 0.007, 0.005, 6);
  st.ell(gd, 0.014, 0.014, 0.024, -0.14, 0.85, 0.11, { ws: 7, hs: 5 }); st.sph(gd, 0.009, -0.14, 0.87, 0.128, { ws: 6, hs: 5 }); st.cone(gd, 0.004, 0.012, -0.14, 0.865, 0.14, 4, { rx: PI / 2 });
  for (const s of [-1, 1]) st.ell(gd, 0.034, 0.004, 0.014, -0.14 + s * 0.03, 0.855, 0.108, { ws: 6, hs: 4, rz: s * 0.4 });
  // divine glow
  const halo = glowSprite(0xffd07a, 0.85, 0.32); halo.position.set(sx0, SY + 0.05 + 0.5, sz0 - 0.03); ctx.glows.push(halo);
  const halo2 = glowSprite(0xffe6a8, 0.4, 0.4); halo2.position.set(sx0, SY + 0.05 + 0.57, sz0 + 0.02); ctx.glows.push(halo2);
  // trees
  for (const s of [-1, 1]) { roundTree(B, m, s * 0.6, 0.006, 0.0, 0.2, 40 + s, m.leafDark); roundTree(B, m, s * 0.58, 0.006, -0.25, 0.18, 43 + s, m.leaf); cypress(B, m, s * 0.63, 0.006, 0.3, 0.26, 0.03, 6 + s); }
  ctx.anim.push((t) => {
    pulseProp(halo.material, 'opacity', 0.2 * Math.sin(t * 1.2)); pulseProp(halo2.material, 'opacity', 0.2 * Math.sin(t * 1.9 + 1));
    ripple.map.offset.set(t * 0.02, t * 0.015);
  });
  ctx.pulse(m.glowFire, 0.17, 9); ctx.pulse(m.gold, 0.18, 1.1);
};

// =============================================================================
//  12. THE APPIAN WAY
// =============================================================================
BUILDERS.appian_way = function (B, m, ctx) {
  const meadow = m.make('meadow', () => std({ color: 0x9aae52, map: 'grass', rough: 1, vc: 1, jit: 0.04 }));
  const bed = m.make('bed', () => std({ color: 0x4a3d30, rough: 1 }));
  const flowers = m.make('flowers', () => std({ vc: 1, rough: 0.7 }));
  const oxM = m.make('ox', () => std({ color: 0x8a6a4a, rough: 0.8 }));
  // road centre line, width and frame (t: 0 front -> 1 back)
  const X = t => -0.02 + 0.2 * t * t * (3 - 2 * t) + 0.24 * Math.sin(TAU * t) * t * (1 - t), Z = t => 0.385 - t * 0.7, Wd = t => 0.34 - 0.16 * t;
  const frame = t => { const e = 0.004, dx = X(t + e) - X(t - e), dz = Z(t + e) - Z(t - e), l = Math.hypot(dx, dz); return { tx: dx / l, tz: dz / l, px: -dz / l, pz: dx / l }; };
  const P = (t, u) => { const f = frame(t); return [X(t) + f.px * u, Z(t) + f.pz * u]; };
  const distToRoad = (x, z) => { let d = 1e9; for (let k = 0; k <= 30; k++) { const t = k / 30, dd = Math.hypot(x - X(t), z - Z(t)) - Wd(t) / 2; if (dd < d) d = dd; } return d; };
  B.ground(terrainGeo((x, z) => {
    const d = distToRoad(x, z);
    return (0.012 + 0.01 * Math.sin(x * 6 + z * 3.1) + 0.008 * Math.sin(z * 9 - x * 4)) * smooth(0.0, 0.06, d) + 0.004;
  }, { uvs: 8, nr: 22, ns: 96 }), meadow);
  // ---- road: bed ribbon + cobbles + kerbs
  { const pos = [], uv = [], idx = [], N = 40;
    for (let k = 0; k <= N; k++) { const t = k / N, [lx, lz] = P(t, -Wd(t) / 2 - 0.008), [rx, rz] = P(t, Wd(t) / 2 + 0.008); pos.push(lx, 0.008, lz, rx, 0.008, rz); uv.push(0, t, 1, t); }
    for (let k = 0; k < N; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    // ensure upward normals
    if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((v, i) => idx[i - (i % 3) + [0, 2, 1][i % 3]])); g.computeVertexNormals(); }
    B.add(g, bed, {}); }
  const R = 28;
  for (let r = 0; r <= R; r++) {
    const t = r / R * 0.985, W = Wd(t), f = W / 0.34, f2 = frame(t), yaw = Math.atan2(f2.tx, f2.tz), step = 0.037 * f, n = Math.floor((W - 0.02) / step);
    for (let i = 0; i < n; i++) {
      const u = (i - (n - 1) / 2) * step + (r % 2 ? 0.5 : 0) * step * 0.5 * 0 + (hash2(i, r, 5) - 0.5) * 0.004;
      const [px, pz] = P(t, u), sx = step * (0.86 + 0.1 * hash2(i, r, 6)), sz = 0.028 * f * (0.85 + 0.2 * hash2(i, r, 7)), sh = 0.006 + 0.005 * hash2(i, r, 8);
      B.box(m.cobble, sx, sh, sz, px, 0.006, pz, { ry: yaw + (hash2(i, r, 9) - 0.5) * 0.35, tint: 0.85 + 0.25 * hash2(i, r, 3) });
    }
    for (const sd of [-1, 1]) { const [kx, kz] = P(t, sd * (W / 2 + 0.006)); B.box(m.limestone, 0.016 * f + 0.004, 0.018, 0.03, kx, 0.004, kz, { ry: yaw }); }
  }
  // ---- cypresses and pines lining the road
  for (let k = 0; k < 26; k++) {
    const t = 0.02 + k * 0.037, sd = k % 2 ? 1 : -1, [x, z] = P(t, sd * (Wd(t) / 2 + 0.075 + 0.045 * hash2(k, 1, 4))), h = lerp(0.3, 0.19, t) * (0.85 + 0.3 * hash2(k, 2, 4));
    if (z > 0.37 || Math.abs(x) > 0.6) continue;
    if ((sd < 0 && t > 0.15 && t < 0.52) || (sd > 0 && Math.abs(t - 0.62) < 0.07)) continue;
    cypress(B, m, x, 0.012, z, h, h * 0.13, k + 3);
  }
  for (const [t, sd, off] of [[0.5, 1, 0.24], [0.7, -1, 0.23]]) {
    const [x, z] = P(t, sd * (Wd(t) / 2 + off)); B.limb(m.woodDark, [x, 0.012, z], [x + 0.004, 0.13, z], 0.01, 0.006, 6, { wuv: false });
    B.add(blobGeo(0.06, 1, 0.3, 4, 0.4), m.leafDark, { x, y: 0.15, z }); B.add(blobGeo(0.045, 1, 0.3, 5, 0.45), m.leaf, { x: x + 0.03, y: 0.13, z: z + 0.015 }); B.add(blobGeo(0.04, 1, 0.3, 6, 0.45), m.leaf, { x: x - 0.03, y: 0.135, z: z - 0.01 });
  }
  // ---- milestones
  for (const t of [0.08, 0.3, 0.55, 0.8]) {
    const [x, z] = P(t, Wd(t) / 2 + 0.035), f2 = frame(t), yaw = Math.atan2(f2.tx, f2.tz);
    B.cyl(m.limestone, 0.011, 0.014, 0.05, x, 0.012, z, 8); B.sph(m.limestone, 0.011, x, 0.062, z, { ws: 8, hs: 4, sy: 0.6 });
    B.box(m.dark, 0.012, 0.012, 0.004, x - f2.pz * 0.011, 0.04, z + f2.px * 0.011, { ry: yaw, wuv: false });
  }
  // ---- tomb of Caecilia Metella (round drum)
  { const [x, z] = P(0.36, -(Wd(0.36) / 2 + 0.2)), y0 = 0.012, k = 1.25;
    B.box(m.limestone, 0.19 * k, 0.045 * k, 0.19 * k, x, y0, z, { ry: 0.3 });
    B.cyl(m.limestone, 0.088 * k, 0.09 * k, 0.1 * k, x, y0 + 0.045 * k, z, 28);
    B.cyl(m.marble, 0.093 * k, 0.093 * k, 0.014 * k, x, y0 + 0.13 * k, z, 28);
    B.cyl(m.dark, 0.0925 * k, 0.0925 * k, 0.006 * k, x, y0 + 0.105 * k, z, 28);
    for (let i = 0; i < 24; i++) B.box(m.gold, 0.007, 0.012 * k, 0.004, x + Math.sin(i / 24 * TAU) * 0.0935 * k, y0 + 0.11 * k, z + Math.cos(i / 24 * TAU) * 0.0935 * k, { ry: i / 24 * TAU, wuv: false });
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; B.box(m.limestoneDark, 0.022, 0.02, 0.014, x + Math.sin(a) * 0.085 * k, y0 + 0.144 * k, z + Math.cos(a) * 0.085 * k, { ry: a }); }
    B.cone(m.terracottaPlain, 0.075 * k, 0.02 * k, x, y0 + 0.144 * k, z, 28);
    B.cyl(m.dark, 0.018, 0.018, 0.03, x + Math.sin(0.9) * 0.088 * k, y0 + 0.05 * k, z + Math.cos(0.9) * 0.088 * k, 8, { rx: 0 }); }
  // ---- small tomb temple with columns
  { const [x, z] = P(0.62, Wd(0.62) / 2 + 0.16), f2 = frame(0.62), yaw = Math.atan2(-f2.px, -f2.pz), y0 = 0.012;
    B.box(m.limestone, 0.13, 0.03, 0.15, x, y0, z, { ry: yaw }); B.box(m.marble, 0.11, 0.09, 0.09, x - Math.sin(yaw) * 0.02, y0 + 0.03, z - Math.cos(yaw) * 0.02, { ry: yaw });
    for (const a of [-1, 1]) for (const b of [0.5, 1]) column(B, m.marble, x + Math.cos(yaw) * a * 0.04 + Math.sin(yaw) * b * 0.045 - 0.0, z - Math.sin(yaw) * a * 0.04 + Math.cos(yaw) * b * 0.045, y0 + 0.03, 0.1, 0.007, 'ionic');
    B.box(m.marble, 0.12, 0.014, 0.12, x + Math.sin(yaw) * 0.01, y0 + 0.13, z + Math.cos(yaw) * 0.01, { ry: yaw });
    pediment(B, { x: x + Math.sin(yaw) * 0.045, y: y0 + 0.144, z: z + Math.cos(yaw) * 0.045, w: 0.12, rise: 0.04, depth: 0.014, frame: m.marble, field: m.limestoneDark, bw: 0.006, ry: yaw });
    pitchedRoof(B, m.terracotta, x - Math.sin(yaw) * 0.005, y0 + 0.144, z - Math.cos(yaw) * 0.005, 0.12, 0.1, 0.04, 0.008, 0.005, yaw); }
  // ---- pyramid tomb (Cestius) and sarcophagi
  pyramid(B, m, -0.5, -0.05, 0.075, 0.17, 0.4, 7, m.marble, m.marble);
  for (const [t, sd, off, ry] of [[0.18, -1, 0.11, 0.3], [0.22, 1, 0.12, -0.2], [0.75, -1, 0.1, 0.5], [0.33, 1, 0.16, 0.1]]) {
    const [x, z] = P(t, sd * (Wd(t) / 2 + off)); B.box(m.limestone, 0.04, 0.026, 0.02, x, 0.012, z, { ry }); B.add(new THREE.CylinderGeometry(0.011, 0.011, 0.04, 8).rotateZ(PI / 2), m.limestone, { x, y: 0.041, z, ry, sy: 0.8 });
    B.box(m.limestoneDark, 0.014, 0.05, 0.01, x + 0.04, 0.012, z, { ry: ry + 1 });
  }
  // ---- triumphal arch at the far end
  { const t = 0.985, ax = X(t), az = Z(t) - 0.0, f2 = frame(t), yaw = Math.atan2(-f2.tx, -f2.tz), y0 = 0.012;
    const A = (lx, ly, lz) => [ax + lx * Math.cos(yaw) + lz * Math.sin(yaw), y0 + ly, az - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
    const bx = (mat, w, h, d, lx, ly, lz) => { const p = A(lx, ly, lz); B.box(mat, w, h, d, p[0], p[1], p[2], { ry: yaw }); };
    bx(m.marble, 0.42, 0.024, 0.13, 0, 0, 0);
    bx(m.marbleWarm, 0.4, 0.2, 0.11, 0, 0.024, 0);
    bx(m.marble, 0.42, 0.016, 0.125, 0, 0.224, 0);
    bx(m.marble, 0.4, 0.08, 0.1, 0, 0.24, 0); bx(m.lapis || m.limestoneDark, 0.16, 0.05, 0.004, 0, 0.255, 0.052);
    bx(m.marble, 0.42, 0.012, 0.12, 0, 0.32, 0);
    { const p = A(0, 0.024, 0.056); B.box(m.dark, 0.11, 0.135, 0.02, p[0], p[1], p[2], { ry: yaw, wuv: false }); const q = A(0, 0.159, 0.056); B.add(archTop(0.055, 0.02, 10), m.dark, { x: q[0], y: q[1], z: q[2], rx: PI / 2, ry: yaw }); }
    for (const s of [-1, 1]) { const p = A(s * 0.145, 0.024, 0.056); B.box(m.dark, 0.055, 0.07, 0.02, p[0], p[1], p[2], { ry: yaw, wuv: false }); const q = A(s * 0.145, 0.094, 0.056); B.add(archTop(0.0275, 0.02, 8), m.dark, { x: q[0], y: q[1], z: q[2], rx: PI / 2, ry: yaw }); const r = A(s * 0.145, 0.15, 0.056); B.add(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 12), m.gold, { x: r[0], y: r[1], z: r[2], rx: PI / 2, ry: yaw }); }
    for (const s of [-1, 1]) for (const c of [0.085, 0.205]) { const p = A(s * c, 0.024, 0.062); column(B, m.marble, p[0], p[2], p[1], 0.2, 0.0075, 'corinthian'); const q = A(s * c, 0.224, 0.062); B.box(m.marble, 0.02, 0.016, 0.02, q[0], q[1], q[2], { ry: yaw }); const st = A(s * c, 0.24 + 0.08, 0.05); statuette(B, m, st[0], st[1], st[2], 0.075, m.gold, m.gold, { ry: yaw }); }
    { const st = A(0, 0.332, 0); B.box(m.marble, 0.14, 0.018, 0.07, st[0], st[1], st[2], { ry: yaw }); quadriga(B, m, st[0], st[1] + 0.018, st[2], 0.07, yaw); }
    for (const s of [-1, 1]) { const q = A(s * 0.12, 0, 0.11); brazier(B, m, ctx, q[0], 0.012, q[2], 0.7, 0.14); }
  }
  ctx.pulse(m.glowFire, 0.17, 9);
  // ---- aqueduct backdrop
  { const nb = 10, bw = 0.125, x0 = -0.62;
    for (let i = 0; i < nb; i++) {
      const s = new THREE.Shape(); s.moveTo(-bw / 2, 0); s.lineTo(bw / 2, 0); s.lineTo(bw / 2, 0.26); s.lineTo(-bw / 2, 0.26); s.closePath();
      const h = new THREE.Path(); h.moveTo(-0.033, 0); h.lineTo(-0.033, 0.11); h.absarc(0, 0.11, 0.033, PI, 0, true); h.lineTo(0.033, 0); h.lineTo(-0.033, 0);
      s.holes.push(h);
      B.extZ(m.limestoneDark, s, 0.05, x0 + bw / 2 + i * bw, 0.004, -0.4, { wuv: false, uvs: 1 });
    }
    B.box(m.limestone, nb * bw + 0.02, 0.014, 0.065, 0, 0.264, -0.4); B.box(m.water, nb * bw, 0.008, 0.03, 0, 0.278, -0.4, { wuv: false }); }
  // ---- cart with an ox, moving away along the road and passing through the arch
  const cart = B.sub(0);
  { const cb = cart; const wood = m.wood, wd = m.woodDark;
    cb.box(wood, 0.052, 0.008, 0.085, 0, 0.022, -0.02, { wuv: false }); cb.box(wd, 0.052, 0.03, 0.006, 0, 0.03, -0.062, { wuv: false });
    for (const s of [-1, 1]) { cb.box(wd, 0.005, 0.026, 0.085, s * 0.026, 0.03, -0.02, { wuv: false }); cb.add(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 14), wd, { x: s * 0.032, y: 0.02, z: -0.015, rz: PI / 2 }); cb.add(new THREE.CylinderGeometry(0.005, 0.005, 0.008, 6), m.bronzeDark, { x: s * 0.033, y: 0.02, z: -0.015, rz: PI / 2 }); for (let k = 0; k < 3; k++) cb.box(wd, 0.006, 0.004, 0.038, s * 0.033, 0.02, -0.015, { wuv: false, rx: k * PI / 3 }); }
    for (let k = 0; k < 3; k++) cb.add(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 6), m.terracottaPlain, { x: (k - 1) * 0.014, y: 0.036, z: -0.035, ry: k });
    cb.ell(m.sack, 0.014, 0.01, 0.014, 0.0, 0.041, -0.05, { ws: 6, hs: 5 });
    cb.limb(wd, [0, 0.022, 0.02], [0, 0.03, 0.09], 0.003, 0.002, 4);
    for (const s of [-1, 1]) {
      cb.ell(oxM, 0.014, 0.017, 0.032, s * 0.011, 0.038, 0.105, { ws: 7, hs: 5 }); cb.ell(oxM, 0.012, 0.014, 0.012, s * 0.011, 0.046, 0.132, { ws: 6, hs: 5 });
      cb.sph(oxM, 0.008, s * 0.011, 0.05, 0.146, { ws: 6, hs: 5 });
      for (const hs of [-1, 1]) cb.limb(m.ivory, [s * 0.011 + hs * 0.006, 0.055, 0.145], [s * 0.011 + hs * 0.013, 0.064, 0.14], 0.0022, 0.001, 4);
      for (const lz of [0.085, 0.125]) for (const lx of [-1, 1]) cb.limb(oxM, [s * 0.011 + lx * 0.007, 0.03, lz], [s * 0.011 + lx * 0.007, 0.0, lz], 0.0035, 0.0025, 4);
    }
    cb.box(wd, 0.045, 0.004, 0.006, 0, 0.056, 0.115, { wuv: false });
    statuette(cb, m, 0.0, 0.03, -0.055, 0.05, m.cloth, m.skin, { arm: 1 });
  }
  ctx.anim.push((t) => {
    const u = ((t * 0.0125) % 1), tt = 0.08 + u * 0.88, f2 = frame(tt), sc = Math.min(1, u / 0.06, (1 - u) / 0.08);
    const [x, z] = P(tt, 0.0);
    cart.root.position.set(x, 0.012 + 0.0015 * Math.sin(t * 9), z); cart.root.rotation.y = Math.atan2(f2.tx, f2.tz) + 0.02 * Math.sin(t * 2.3);
    cart.root.scale.setScalar(Math.max(0.001, sc) * lerp(1.15, 0.75, tt));
  });
  // ---- wild flowers
  for (let i = 0; i < 30; i++) { const t = hash2(i, 1, 2), sd = i % 2 ? 1 : -1, [x, z] = P(0.05 + t * 0.85, sd * (Wd(t) / 2 + 0.03 + 0.12 * hash2(i, 2, 2))); if (z > 0.41 || Math.abs(x) > 0.6) continue; B.add(new THREE.IcosahedronGeometry(0.0055, 0), flowers, { x, y: 0.02, z, col: [0xe63946, 0xf6d55c, 0xffffff, 0xd66ba0][i % 4] }); }
};

//@@MODELS_END

// =============================================================================
//  public API
// =============================================================================
function skipBounds(o) { for (let p = o; p; p = p.parent) if (p.userData && p.userData.noBounds) return true; return false; }
function measure(root) {
  const box = new THREE.Box3(), tmp = new THREE.Box3(); root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (o.isMesh && !skipBounds(o)) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp); }
  });
  return box;
}
export function buildWonderModel(id) {
  const fn = BUILDERS[id];
  if (!fn) throw new Error('Unknown wonder id: ' + id);
  const group = new THREE.Group(); group.name = 'wonder_' + id;
  const seed = hashStr(id);
  const P = new Builder(seed ^ 0x5bd1e995, 0), PM = new MatSet();
  buildPlinth(P, PM); P.finish(); P.root.name = 'plinth'; group.add(P.root);
  const B = new Builder(seed, BASE), M = new MatSet();
  const ctx = { anim: [], glows: [], emissive: [], pulses: [], pulse(mat, a1, f1, a2 = 0, f2 = 1) { this.pulses.push({ mat, a1, f1, a2, f2 }); } };
  fn(B, M, ctx);
  B.finish(); B.root.name = 'model'; group.add(B.root);
  const emissiveMeshes = [];
  for (const e of B.emis) { const m = e.isObject3D ? e : B.meshOf(e); if (m && !emissiveMeshes.includes(m)) emissiveMeshes.push(m); }
  for (const m of ctx.emissive) if (!emissiveMeshes.includes(m)) emissiveMeshes.push(m);
  for (const s of ctx.glows) if (!s.parent) B.root.add(s);
  const box = measure(group);
  for (const pu of ctx.pulses) {
    const meshes = []; B.root.traverse(o => { if (o.isMesh && o.material === pu.mat) meshes.push(o); });
    const ph = hash2(Math.round(pu.f1 * 10), Math.round(pu.a1 * 100), 3) * 6;
    if (meshes.length) ctx.anim.push((t) => { const rel = pu.a1 * Math.sin(t * pu.f1 + ph) + pu.a2 * Math.sin(t * pu.f2 + ph * 2); for (let i = 0; i < meshes.length; i++) { const mt = meshes[i].material; if (mt && !Array.isArray(mt) && mt.emissiveIntensity !== undefined) pulseProp(mt, 'emissiveIntensity', rel); } });
  }
  const anim = ctx.anim;
  group.userData = {
    id, height: +box.max.y.toFixed(3), emissiveMeshes, glowSprites: ctx.glows,
    update: anim.length ? (t, dt) => { for (let i = 0; i < anim.length; i++) anim[i](t, dt); } : null,
  };
  return group;
}
export function updateWonderModel(group, time, dt) {
  const u = group && group.userData && group.userData.update;
  if (u) u(time, dt || 0);
}
