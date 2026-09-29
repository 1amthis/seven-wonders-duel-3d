// glyphs.js — procedural canvas-2D vector icon library for the 7 Wonders Duel fan project.
//
//   import { drawGlyph, GLYPH_NAMES, isMonochrome } from './glyphs.js';
//   drawGlyph(ctx, 'coin', cx, cy, 96, { text: '3', shadow: true });
//   drawGlyph(ctx, 'sword', cx, cy, 40, { color: '#f4ecd8' });
//
// drawGlyph(ctx, name, cx, cy, size, opts) paints glyph `name` centred on (cx, cy) inside a square of
// side `size` (canvas units; works under any ctx transform / devicePixelRatio scaling). It saves and
// restores the context and leaves no state behind. Unknown names draw a neutral '?' disc.
//
// opts:
//   color   monochrome glyphs (isMonochrome(name): chain symbols + again/destroy/revive/pawn/library)
//           are silhouettes filled with this colour (default '#f4ecd8'); 'cardstack' uses it as the
//           card colour (default '#8b5a2b'); every other glyph is full colour and ignores it.
//   text    short string (e.g. '3', '12') drawn centred on 'coin', 'vp' and 'shield' (Cinzel bold).
//   shadow  true -> soft dark drop shadow under the whole glyph (rendered via a private scratch canvas
//           so overlapping parts do not stack shadows).
//
// Every glyph is authored in a 100x100 design box centred on the origin ([-50,50]) and scaled to
// `size`. Light comes from the top-left everywhere, full-colour glyphs carry a thin dark outline,
// monochrome glyphs are pure silhouettes (holes are real holes, so they work on any background).
// Nothing is random: output is fully deterministic.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const DEFAULT_MONO = '#f4ecd8';
const FONT = '"Cinzel", "Times New Roman", serif';
const OUT = 4; // outline width in design units (~4% of the glyph size)

export const GLYPH_NAMES = [];
/** true for glyphs that are single-colour silhouettes tinted with opts.color */
export function isMonochrome(name) { return !!(REG[name] && REG[name].mono); }
const REG = Object.create(null);

/* ------------------------------------------------------------------------------------------ */
/* colour helpers                                                                              */
/* ------------------------------------------------------------------------------------------ */

const _pc = new Map();
let _nctx = null;

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

function parse(col) {
  let r = _pc.get(col);
  if (r) return r;
  const s = String(col).trim();
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/i.exec(s))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    r = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  } else if ((m = /^rgba?\(([^)]+)\)/i.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    r = [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
  } else {
    r = [200, 200, 200, 1];
    try {
      if (!_nctx) { const cv = makeCanvas(1, 1); _nctx = cv && cv.getContext('2d'); }
      if (_nctx) {
        _nctx.fillStyle = '#000'; _nctx.fillStyle = s;
        const n = String(_nctx.fillStyle);
        if (n !== s) r = parse(n);
      }
    } catch (e) { /* keep fallback */ }
  }
  if (_pc.size > 4000) _pc.clear();
  _pc.set(col, r);
  return r;
}
const css = (r, g, b, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
function mix(a, b, t) {
  const A = parse(a), B = parse(b);
  return css(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t, A[3] + (B[3] - A[3]) * t);
}
const lighten = (c, t) => mix(c, '#fff6e0', t);
const darken = (c, t) => mix(c, '#1d0f06', t);
const alpha = (c, a) => { const A = parse(c); return css(A[0], A[1], A[2], A[3] * a); };
const ol = (base, t = 0.66) => darken(base, t); // outline colour derived from a fill colour

/* ------------------------------------------------------------------------------------------ */
/* gradient / paint helpers                                                                    */
/* ------------------------------------------------------------------------------------------ */

function lg(c, x0, y0, x1, y1, ...cols) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  const n = cols.length - 1;
  cols.forEach((col, i) => g.addColorStop(n ? i / n : 0, col));
  return g;
}
function rg(c, x0, y0, r0, x1, y1, r1, ...cols) {
  const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
  const n = cols.length - 1;
  cols.forEach((col, i) => g.addColorStop(n ? i / n : 0, col));
  return g;
}
/** light -> base -> dark linear gradient (top-left lit) */
const sh = (c, x0, y0, x1, y1, base, k = 0.32) => lg(c, x0, y0, x1, y1, lighten(base, k), base, darken(base, k));

/** fill then outline the current path */
function FS(c, fill, line, lw = OUT, rule) {
  if (fill) { c.fillStyle = fill; rule ? c.fill(rule) : c.fill(); }
  if (line) { c.strokeStyle = line; c.lineWidth = lw; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
}
function STK(c, col, lw, cap = 'round') {
  c.strokeStyle = col; c.lineWidth = lw; c.lineCap = cap; c.lineJoin = 'round'; c.stroke();
}
function FILL(c, col, rule) { c.fillStyle = col; rule ? c.fill(rule) : c.fill(); }

/* ------------------------------------------------------------------------------------------ */
/* path helpers (append sub-paths to the current path)                                         */
/* ------------------------------------------------------------------------------------------ */

function P(c, pts, close = true) {
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  if (close) c.closePath();
}
/** rounded polygon: radius r (number or per-vertex array) */
function RP(c, pts, r) {
  const n = pts.length;
  const rad = (i) => (Array.isArray(r) ? r[i] : r);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s = mid(pts[n - 1], pts[0]);
  c.moveTo(s[0], s[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = mid(p, pts[(i + 1) % n]);
    c.arcTo(p[0], p[1], q[0], q[1], rad(i));
  }
  c.closePath();
}
function RR(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function CIR(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); c.closePath(); }
function ELL(c, x, y, rx, ry, rot = 0) { c.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.closePath(); }
function LN(c, x0, y0, x1, y1) { c.moveTo(x0, y0); c.lineTo(x1, y1); }
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/** pointed leaf from base (x,y) growing along angle `ang`; hw = half width */
function LEAF(c, x, y, ang, len, hw) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const tx = x + ca * len, ty = y + sa * len;
  const bx = x + ca * len * 0.42, by = y + sa * len * 0.42;
  c.moveTo(x, y);
  c.quadraticCurveTo(bx - sa * hw * 2, by + ca * hw * 2, tx, ty);
  c.quadraticCurveTo(bx + sa * hw * 2, by - ca * hw * 2, x, y);
  c.closePath();
}
/** star polygon points */
function starPts(n, ro, ri, x = 0, y = 0, a0 = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro, a = a0 + (i * Math.PI) / n;
    out.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
  }
  return out;
}
/** arrow head triangle at (x,y) pointing along `ang` */
function HEAD(c, x, y, ang, len, wid) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  c.moveTo(x + ca * len, y + sa * len);
  c.lineTo(x - sa * wid, y + ca * wid);
  c.lineTo(x + sa * wid, y - ca * wid);
  c.closePath();
}
/** crescent between an outer circle (ox,oy,R) and an inner cutting circle (ix,iy,r) */
function CRESCENT(c, ox, oy, R, ix, iy, r) {
  const dx = ix - ox, dy = iy - oy, d = Math.hypot(dx, dy), phi = Math.atan2(dy, dx);
  const a = Math.acos(Math.max(-1, Math.min(1, (R * R + d * d - r * r) / (2 * R * d))));
  const p1 = [ox + R * Math.cos(phi + a), oy + R * Math.sin(phi + a)];
  const p2 = [ox + R * Math.cos(phi - a), oy + R * Math.sin(phi - a)];
  const t1 = Math.atan2(p1[1] - iy, p1[0] - ix), t2 = Math.atan2(p2[1] - iy, p2[0] - ix);
  c.moveTo(p1[0], p1[1]);
  c.arc(ox, oy, R, phi + a, phi - a + TAU, false); // long way round the outer circle, ends at p2
  // inner arc from p2 back to p1 through the side facing the outer centre
  const towards = phi + Math.PI;
  const norm = (v) => ((v % TAU) + TAU) % TAU;
  const span = norm(t1 - t2);              // clockwise sweep p2 -> p1
  const mid = norm(towards - t2);
  c.arc(ix, iy, r, t2, t1, mid > span);    // choose direction that passes through `towards`
  c.closePath();
}

/* ------------------------------------------------------------------------------------------ */
/* text                                                                                        */
/* ------------------------------------------------------------------------------------------ */

function LABEL(c, str, cx, cy, maxW, maxH, fill, edge, edgeK = 0.13, extra) {
  str = String(str);
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.font = `700 100px ${FONT}`;
  const w100 = c.measureText(str).width || 1;
  const fs = Math.min(maxH / 0.72, (100 * maxW) / w100);
  c.font = `700 ${fs}px ${FONT}`;
  const m = c.measureText(str);
  const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  const y = asc == null ? cy + fs * 0.35 : cy + (asc - desc) / 2;
  c.lineJoin = 'round';
  if (extra) { c.fillStyle = extra.color; c.fillText(str, cx + extra.dx, y + extra.dy); }
  if (edge) { c.strokeStyle = edge; c.lineWidth = fs * edgeK; c.strokeText(str, cx, y); }
  c.fillStyle = fill;
  c.fillText(str, cx, y);
  c.restore();
}

/* ------------------------------------------------------------------------------------------ */
/* registry + rendering pipeline                                                               */
/* ------------------------------------------------------------------------------------------ */

let KO = false; // true while drawing into a private layer where destination-out knock-outs are safe

function full(name, fn) { REG[name] = { fn }; GLYPH_NAMES.push(name); }
function mono(name, fn, layer = false) { REG[name] = { fn, mono: true, layer }; GLYPH_NAMES.push(name); }

/** knock a gap of half-width g around the current path out of what was already drawn (layer glyphs) */
function CUT(c, g) {
  if (!KO) return;
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.lineWidth = g * 2; c.lineJoin = 'round'; c.lineCap = 'round';
  c.fillStyle = c.strokeStyle = '#000';
  c.fill('evenodd'); c.stroke();
  c.restore();
}
/** fill the current path, evenodd, in the mono colour */
function MF(c) { c.fill('evenodd'); }

function paintCore(ctx, rec, cx, cy, size, opts, ko) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 100, size / 100);
  ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  if (ctx.setLineDash) ctx.setLineDash([]);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.miterLimit = 4;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const prevKO = KO; KO = ko;
  ctx.beginPath();
  if (rec.mono) {
    const col = opts.color || DEFAULT_MONO;
    ctx.fillStyle = col; ctx.strokeStyle = col;
    rec.fn(ctx, col, opts);
  } else {
    rec.fn(ctx, opts);
  }
  KO = prevKO;
  ctx.beginPath();
  ctx.restore();
}

/** render through a private square scratch canvas; returns null when unavailable */
function viaScratch(ctx, size, padFrac, render) {
  const t = ctx.getTransform ? ctx.getTransform() : null;
  const k = t ? Math.hypot(t.a, t.b) || 1 : 1;
  const px = Math.max(1, Math.ceil(size * (1 + 2 * padFrac) * k));
  if (px > 4096) return null;
  const box = px / k; // scratch side in caller units: keeps the copy 1:1 in device pixels
  const cv = makeCanvas(px, px);
  const oc = cv && cv.getContext && cv.getContext('2d');
  if (!oc) return null;
  oc.scale(k, k);
  render(oc, box / 2, box / 2);
  return { cv, box, k };
}

function paintGlyph(ctx, rec, cx, cy, size, opts) {
  if (rec.layer) {
    const s = viaScratch(ctx, size, 0.02, (oc, ox, oy) => paintCore(oc, rec, ox, oy, size, opts, true));
    if (s) { ctx.drawImage(s.cv, cx - s.box / 2, cy - s.box / 2, s.box, s.box); return; }
  }
  paintCore(ctx, rec, cx, cy, size, opts, false);
}

export function drawGlyph(ctx, name, cx, cy, size, opts = {}) {
  if (!(size > 0)) return;
  opts = opts || {};
  const rec = REG[name] || UNKNOWN;
  if (!opts.shadow) {
    ctx.save();
    paintGlyph(ctx, rec, cx, cy, size, opts);
    ctx.restore();
    return;
  }
  ctx.save();
  const s = viaScratch(ctx, size, 0.3, (oc, ox, oy) => paintGlyph(oc, rec, ox, oy, size, opts));
  if (s) {
    ctx.shadowColor = 'rgba(8,4,0,0.55)';
    ctx.shadowBlur = size * 0.075 * s.k;
    ctx.shadowOffsetX = size * 0.018 * s.k;
    ctx.shadowOffsetY = size * 0.045 * s.k;
    ctx.drawImage(s.cv, cx - s.box / 2, cy - s.box / 2, s.box, s.box);
  } else {
    // no scratch canvas available: approximate with the native shadow (overlaps will show)
    const k = 1;
    ctx.shadowColor = 'rgba(8,4,0,0.5)';
    ctx.shadowBlur = size * 0.07 * k;
    ctx.shadowOffsetY = size * 0.04 * k;
    paintGlyph(ctx, rec, cx, cy, size, opts);
  }
  ctx.restore();
}

const UNKNOWN = {
  fn(c) {
    c.beginPath(); CIR(c, 0, 0, 42);
    FS(c, sh(c, -30, -30, 30, 30, '#9a9488', 0.3), '#3a362e', 5);
    LABEL(c, '?', 0, 2, 40, 48, '#f3eee0', '#3a362e');
  },
};

/* ============================================================================================ */
/* FULL-COLOUR RESOURCES                                                                        */
/* ============================================================================================ */

function SPIRAL(c, x, y, r0, r1, turns, a0 = 0) {
  const n = Math.ceil(turns * 16);
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = a0 + t * turns * TAU, r = r0 + (r1 - r0) * t;
    if (i) c.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else c.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
}
const hasText = (o) => o && o.text != null && o.text !== '';

full('wood', (c) => {
  const R = 21.5;
  const log = (x, y, seed) => {
    c.beginPath(); CIR(c, x, y, R);
    FS(c, rg(c, x - 8, y - 9, 2, x, y, R + 2, '#b07a50', '#7c4c2b', '#432711'), '#2b170a', 3.6);
    for (let i = 0; i < 10; i++) {
      const a = seed + (i * TAU) / 10;
      c.beginPath(); LN(c, x + Math.cos(a) * (R - 1.4), y + Math.sin(a) * (R - 1.4), x + Math.cos(a) * (R - 4.4), y + Math.sin(a) * (R - 4.4));
      STK(c, 'rgba(28,12,3,0.55)', 1.5);
    }
    const f = R - 4.6;
    c.beginPath(); CIR(c, x, y, f);
    FS(c, rg(c, x - 5, y - 6, 1, x, y, f, '#fbe2ae', '#ebc286', '#cc9556'), '#7a4a22', 1.6);
    [0.76, 0.52, 0.28].forEach((k, i) => {
      c.beginPath(); c.arc(x + 0.7, y + 0.5, f * k, 0, TAU);
      STK(c, i === 0 ? 'rgba(130,74,30,0.7)' : 'rgba(130,74,30,0.6)', 1.5);
    });
    c.beginPath(); CIR(c, x + 0.7, y + 0.5, 1.7); FILL(c, '#8a5424');
    c.beginPath(); LN(c, x + 1, y + 1, x + Math.cos(seed + 2.2) * f * 0.95, y + Math.sin(seed + 2.2) * f * 0.95);
    STK(c, 'rgba(90,48,16,0.55)', 1.3);
    c.beginPath(); c.arc(x, y, f * 0.86, 200 * DEG, 262 * DEG); STK(c, 'rgba(255,255,255,0.55)', 2.2);
  };
  log(-21.5, 20, 0.3);
  log(21.5, 20, 1.4);
  log(0, -17, 2.2);
});

full('clay', (c) => {
  const w = 24, h = 18, d = 6, t = 7;
  const brick = (x, y, tint) => {
    const fc = tint ? mix('#d9764a', '#f09a6a', tint) : '#d9764a';
    c.beginPath(); P(c, [[x + w, y], [x + w + d, y - t], [x + w + d, y + h - t], [x + w, y + h]]);
    FS(c, lg(c, x + w, y, x + w + d, y + h, '#a94a26', '#7d3517'), '#3e180a', 2.6);
    c.beginPath(); P(c, [[x, y], [x + w, y], [x + w + d, y - t], [x + d, y - t]]);
    FS(c, lg(c, x, y - t, x + w, y, '#f8b48a', '#eb9366'), '#3e180a', 2.6);
    c.beginPath(); RR(c, x, y, w, h, 1.2);
    FS(c, lg(c, x, y, x + w * 0.7, y + h, fc, '#c25c32', '#a84824'), '#3e180a', 2.8);
    c.beginPath(); LN(c, x + 2, y + 2.4, x + w - 2, y + 2.4); STK(c, 'rgba(255,220,190,0.5)', 1.3);
    c.beginPath(); CIR(c, x + 6, y + 10, 0.9); CIR(c, x + 15, y + 7, 0.8); CIR(c, x + 19, y + 13, 0.9); FILL(c, 'rgba(70,25,8,0.35)');
  };
  const rows = [
    { y: 13, xs: [-45, -15, 15] },
    { y: -5, xs: [-30, 0] },
    { y: -23, xs: [-15] },
  ];
  rows.forEach((r, ri) => r.xs.forEach((x, i) => brick(x, r.y, ((ri + i) % 3) * 0.06)));
});

full('stone', (c) => {
  const O = [[-40, 6], [-33, -16], [-14, -33], [12, -38], [33, -26], [42, -2], [36, 24], [12, 38], [-16, 36], [-34, 26]];
  const J = [[3, -3], [-3, 3], [3, 3], [-2, -2], [3, -1], [-1, 3], [2, 2], [-3, -2], [1, 3], [-2, 1]];
  const L = [-0.55, -0.83];
  const boulder = (ox, oy, s, base) => {
    const Op = O.map((p) => [ox + p[0] * s, oy + p[1] * s]);
    const Ip = O.map((p, i) => [ox + (p[0] * 0.5 + J[i][0]) * s, oy + (p[1] * 0.5 + J[i][1]) * s]);
    const n = O.length;
    c.beginPath(); P(c, Op);
    FS(c, base, ol(base, 0.72), OUT * 0.95);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = Op[j][0] - Op[i][0], ey = Op[j][1] - Op[i][1], l = Math.hypot(ex, ey);
      const nx = ey / l, ny = -ex / l;
      const b = nx * L[0] + ny * L[1];
      const col = b > 0 ? lighten(base, 0.18 + b * 0.5) : darken(base, 0.05 - b * 0.62);
      c.beginPath(); P(c, [Op[i], Op[j], Ip[j], Ip[i]]);
      FS(c, col, 'rgba(18,28,44,0.5)', 1.3);
    }
    c.beginPath(); P(c, Ip);
    FS(c, lg(c, ox - 16 * s, oy - 18 * s, ox + 14 * s, oy + 16 * s, lighten(base, 0.55), lighten(base, 0.22), base), 'rgba(18,28,44,0.5)', 1.3);
    c.beginPath(); P(c, [[Ip[1][0], Ip[1][1]], [Ip[2][0], Ip[2][1]], [ox + 2 * s, oy - 12 * s]]);
    FILL(c, 'rgba(255,255,255,0.38)');
    c.beginPath(); P(c, Op);
    STK(c, ol(base, 0.72), OUT * 0.95);
  };
  boulder(-5, -5, 0.9, '#8ea1b8');
  boulder(28, 27, 0.42, '#9db0c6');
});

full('glass', (c) => {
  const cy = 14, R = 27, nw = 8, yj = cy - Math.sqrt(R * R - nw * nw);
  const a1 = Math.atan2(yj - cy, -nw), a2 = Math.atan2(yj - cy, nw);
  const body = () => { c.beginPath(); c.moveTo(-nw, -34); c.lineTo(-nw, yj); c.arc(0, cy, R, a1, a2, true); c.lineTo(nw, -34); c.closePath(); };
  body();
  FS(c, rg(c, -10, 2, 2, 0, cy, 36, '#f2ffff', '#86e6f0', '#28aac8', '#0f6f94'), '#0b4a63', OUT);
  c.save();
  body(); c.clip();
  c.beginPath(); c.arc(3, cy + 3, R + 1, 0, TAU); STK(c, 'rgba(6,70,110,0.38)', 9);
  c.beginPath(); c.arc(0, cy, R - 4.6, 0, TAU); STK(c, 'rgba(255,255,255,0.32)', 1.5);
  c.beginPath(); ELL(c, 5, 33, 10, 3.6, -0.1); FILL(c, 'rgba(200,255,255,0.35)');
  c.restore();
  body(); STK(c, '#0b4a63', OUT);
  c.beginPath(); RR(c, -12, -44, 24, 9, 4.2);
  FS(c, lg(c, -12, -44, 12, -35, '#e6ffff', '#8fe4ee', '#39aac6'), '#0b4a63', 3.4);
  c.beginPath(); c.arc(0, cy, 19.5, 150 * DEG, 212 * DEG); STK(c, 'rgba(255,255,255,0.9)', 3.4);
  c.beginPath(); CIR(c, -15.5, 0.5, 1.9); FILL(c, 'rgba(255,255,255,0.95)');
  c.beginPath(); LN(c, -4.2, -31, -4.2, -17); STK(c, 'rgba(255,255,255,0.85)', 2.4);
  c.beginPath(); c.arc(0, cy, 20, 20 * DEG, 60 * DEG); STK(c, 'rgba(255,255,255,0.4)', 1.8);
  c.beginPath(); P(c, starPts(4, 10, 2.4, 33, -24, -Math.PI / 2));
  FS(c, '#ffffff', '#3fb1cc', 1.6);
});

full('papyrus', (c) => {
  c.beginPath();
  c.moveTo(-27, -30); c.quadraticCurveTo(-31, -15, -26.5, 0); c.quadraticCurveTo(-31, 15, -27, 30);
  c.lineTo(27, 30); c.quadraticCurveTo(31, 15, 26.5, 0); c.quadraticCurveTo(31, -15, 27, -30); c.closePath();
  FS(c, lg(c, -27, -28, 27, 28, '#fdf3d0', '#f0dda4', '#d9b978'), '#684919', 3.4);
  c.save(); c.clip();
  for (let y = -24; y <= 26; y += 5.5) { c.beginPath(); LN(c, -30, y, 30, y + 0.6); STK(c, 'rgba(140,100,40,0.13)', 1); }
  c.restore();
  const ink = '#6c3f18';
  const mark = (k, x, y) => {
    c.save(); c.translate(x, y);
    c.beginPath();
    if (k === 0) { c.moveTo(-7, 0); c.quadraticCurveTo(0, -8, 7, 0); c.quadraticCurveTo(0, 8, -7, 0); STK(c, ink, 2.3); c.beginPath(); CIR(c, 0, 0, 2); FILL(c, ink); }
    else if (k === 1) { for (const y0 of [-5, 0, 5]) { c.moveTo(-7, y0); c.lineTo(-3.5, y0 - 3); c.lineTo(0, y0); c.lineTo(3.5, y0 - 3); c.lineTo(7, y0); } STK(c, ink, 2.1); }
    else if (k === 2) { c.arc(0, -4.5, 3, 0, TAU); c.moveTo(0, -1.5); c.lineTo(0, 7); c.moveTo(-4.6, 2.5); c.lineTo(4.6, 2.5); STK(c, ink, 2.3); }
    else if (k === 3) { c.moveTo(-6, 6); c.bezierCurveTo(-7, -1, 0, 1, 0, -2); c.bezierCurveTo(0, -6, 6, -6, 7, -1); STK(c, ink, 2.3); c.beginPath(); CIR(c, 7, -1, 1.3); FILL(c, ink); }
    else if (k === 4) { c.arc(0, 0, 4, 0, TAU); STK(c, ink, 2.2); c.beginPath(); CIR(c, 0, 0, 1.3); FILL(c, ink); }
    else { c.moveTo(0, 7); c.lineTo(0, -7); c.moveTo(0, -1); c.lineTo(-4.5, -6); c.moveTo(0, 3); c.lineTo(4.5, -2); STK(c, ink, 2.2); }
    c.restore();
  };
  mark(0, -12, -13); mark(1, 12, -13);
  mark(2, -12, 0); mark(3, 12, 0);
  mark(4, -12, 13.5); mark(5, 12, 13.5);
  const roll = (y, top) => {
    c.beginPath(); RR(c, -31, y - 8.5, 62, 17, 8.5);
    FS(c, top ? lg(c, 0, y - 9, 0, y + 9, '#fff6d6', '#ecd69c', '#c4a05a') : lg(c, 0, y - 9, 0, y + 9, '#f7e6b6', '#e0c383', '#b8944a'), '#684919', 3.2);
    [-31, 31].forEach((x) => {
      c.beginPath(); CIR(c, x, y, 9.5);
      FS(c, rg(c, x - 3, y - 3, 1, x, y, 10, '#fff7dc', '#ecd49a', '#c39f58'), '#684919', 3);
      c.beginPath(); SPIRAL(c, x, y, 1, 6.6, 2.1, x < 0 ? 0 : Math.PI); STK(c, '#a27b36', 1.5);
    });
    c.beginPath(); LN(c, -22, y - 4, 22, y - 4); STK(c, 'rgba(255,255,255,0.55)', 2);
  };
  roll(-31, true);
  roll(31, false);
});

/* ============================================================================================ */
/* VALUES                                                                                       */
/* ============================================================================================ */

full('coin', (c, o) => {
  c.beginPath(); CIR(c, 0, 0, 45.5);
  FS(c, lg(c, -32, -34, 32, 36, '#fff3a6', '#f4c84c', '#b9821f', '#8a5a10'), '#4e3006', OUT + 0.2);
  for (let i = 0; i < 40; i++) {
    const a = (i * TAU) / 40, ca = Math.cos(a), sa = Math.sin(a);
    c.beginPath(); LN(c, ca * 38.6, sa * 38.6, ca * 42.2, sa * 42.2);
    STK(c, 'rgba(90,55,8,0.5)', 1.4, 'butt');
  }
  c.beginPath(); c.arc(0, 0, 43.5, 195 * DEG, 268 * DEG); STK(c, 'rgba(255,250,214,0.9)', 2.2);
  c.beginPath(); CIR(c, 0, 0, 36.6); STK(c, '#8a5a10', 1.8);
  c.beginPath(); CIR(c, 0, 0, 35.4);
  FS(c, lg(c, 28, 30, -28, -30, '#ffe98a', '#f2c640', '#d29a26'), null);
  c.beginPath(); c.arc(0, 0, 34.2, 135 * DEG, 315 * DEG); STK(c, 'rgba(120,70,5,0.42)', 2.4);
  c.beginPath(); c.arc(0, 0, 34.2, -45 * DEG, 135 * DEG); STK(c, 'rgba(255,250,200,0.75)', 2);
  if (hasText(o)) {
    LABEL(c, o.text, 0, 1.5, 54, 40, '#6a3d05', null, 0, { color: 'rgba(255,246,186,0.95)', dx: 0.8, dy: 1.1 });
  } else {
    const rays = starPts(8, 25, 11.5, 0, 0, -Math.PI / 2);
    c.beginPath(); P(c, rays.map((p) => [p[0] + 1, p[1] + 1.2])); FILL(c, 'rgba(255,248,190,0.9)');
    c.beginPath(); P(c, rays); FS(c, lg(c, -20, -20, 20, 20, '#c98a1e', '#8f5c0c'), '#6a3d05', 1.4);
    c.beginPath(); CIR(c, 0, 0, 9.5); FS(c, lg(c, -8, -8, 8, 8, '#ffe58a', '#d9a02c'), '#6a3d05', 1.6);
    c.beginPath(); CIR(c, 0, 0, 4); FS(c, '#a8720f', null);
  }
});

full('vp', (c, o) => {
  const R = 34;
  c.beginPath(); c.arc(0, 0, R, 92 * DEG, 262 * DEG); STK(c, '#5e3f07', 5);
  c.beginPath(); c.arc(0, 0, R, -82 * DEG, 88 * DEG); STK(c, '#5e3f07', 5);
  c.beginPath(); c.arc(0, 0, R, 92 * DEG, 262 * DEG); STK(c, '#c8901f', 2.4);
  c.beginPath(); c.arc(0, 0, R, -82 * DEG, 88 * DEG); STK(c, '#c8901f', 2.4);
  const n = 8;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const th = side < 0 ? (100 + t * 136) * DEG : (80 - t * 136) * DEG;
      const px = R * Math.cos(th), py = R * Math.sin(th);
      const psi = side < 0 ? th + Math.PI / 2 : th - Math.PI / 2;
      const len = 17 - 5.5 * t, hw = 4.6 - 1.3 * t;
      const outer = psi + (side < 0 ? -1 : 1) * 40 * DEG;
      const inner = psi - (side < 0 ? -1 : 1) * 40 * DEG;
      [[inner, '#e2a92e', '#f3d566'], [outer, '#f0c445', '#fff0a0']].forEach(([ang, dark, light]) => {
        c.beginPath(); LEAF(c, px, py, ang, len, hw);
        const tx = px + Math.cos(ang) * len, ty = py + Math.sin(ang) * len;
        FS(c, lg(c, px, py, tx, ty, dark, light), '#5e3f07', 1.7);
      });
    }
    const th = side < 0 ? 240 * DEG : -60 * DEG;
    const px = R * Math.cos(th), py = R * Math.sin(th);
    const psi = side < 0 ? th + Math.PI / 2 : th - Math.PI / 2;
    c.beginPath(); LEAF(c, px, py, psi, 10, 3.2);
    FS(c, lg(c, px, py, px + Math.cos(psi) * 10, py + Math.sin(psi) * 10, '#e2a92e', '#f8dc70'), '#5e3f07', 1.7);
  }
  c.beginPath(); CIR(c, 0, R + 1.5, 3.8); FS(c, '#e8b53a', '#5e3f07', 1.8);
  c.beginPath(); CIR(c, 0, 0, 27);
  FS(c, rg(c, -9, -11, 2, 0, 0, 30, '#8a63d0', '#54308f', '#2a1657'), '#20103d', 3);
  c.beginPath(); CIR(c, 0, 0, 24.2); STK(c, '#f5d35c', 2.2);
  c.beginPath(); c.arc(0, 0, 24.2, 200 * DEG, 260 * DEG); STK(c, 'rgba(255,255,255,0.45)', 1.4);
  if (hasText(o)) {
    LABEL(c, o.text, 0, 1, 34, 27, lg(c, 0, -14, 0, 14, '#fff3b0', '#f2c94c'), '#1a0c33', 0.15);
  } else {
    c.beginPath(); P(c, starPts(5, 16, 6.8, 0, 1.5));
    FS(c, lg(c, -12, -14, 12, 14, '#fff3b0', '#f2c94c', '#c88f1c'), '#1a0c33', 1.8);
  }
});

full('shield', (c, o) => {
  const outline = (s, oy = 0) => {
    c.save(); c.translate(0, oy); c.scale(s, s);
    c.moveTo(-35, -34); c.bezierCurveTo(-17, -40, 17, -40, 35, -34);
    c.lineTo(35, -8); c.bezierCurveTo(35, 20, 20, 35, 0, 47);
    c.bezierCurveTo(-20, 35, -35, 20, -35, -8); c.closePath();
    c.restore();
  };
  c.beginPath(); outline(1, 0);
  FS(c, lg(c, -34, -36, 34, 44, '#f4f7fb', '#b9c3cf', '#7c8896', '#56616f'), '#232a33', OUT);
  c.beginPath(); outline(0.82, -2);
  c.save(); c.clip();
  c.fillStyle = lg(c, -30, -34, 0, 40, '#e0574a', '#b9342f', '#8a1f1f'); c.fillRect(-40, -46, 80, 100);
  c.beginPath(); c.moveTo(0, -50); c.lineTo(40, -50); c.lineTo(40, 60); c.lineTo(0, 60); c.closePath();
  FILL(c, 'rgba(50,5,5,0.32)');
  c.beginPath(); c.moveTo(-40, -20); c.lineTo(-40, -50); c.lineTo(0, -50); c.lineTo(0, -32); c.closePath();
  FILL(c, 'rgba(255,220,200,0.16)');
  c.restore();
  c.beginPath(); outline(0.82, -2); STK(c, '#3d0d0c', 2.2);
  c.beginPath(); outline(1, 0); STK(c, '#232a33', OUT);
  c.beginPath(); c.moveTo(-31, -30); c.bezierCurveTo(-16, -35, 10, -36, 22, -34); STK(c, 'rgba(255,255,255,0.75)', 1.8);
  [[-27, -25], [27, -25], [0, 39]].forEach(([x, y]) => { c.beginPath(); CIR(c, x, y, 1.9); FS(c, '#e8edf3', '#232a33', 1.1); });
  const by = -4;
  c.beginPath(); CIR(c, 0, by, 21);
  FS(c, rg(c, -7, by - 9, 2, 0, by, 23, '#ffe9a8', '#d9a04a', '#8a5420'), '#3a2008', 3.2);
  c.beginPath(); CIR(c, 0, by, 17); STK(c, 'rgba(70,35,6,0.5)', 1.2);
  if (hasText(o)) {
    LABEL(c, o.text, 0, by + 1, 30, 22, '#3f2105', null, 0, { color: 'rgba(255,240,190,0.8)', dx: 0.7, dy: 0.9 });
  } else {
    c.beginPath(); CIR(c, 0, by, 9); FS(c, rg(c, -3, by - 4, 1, 0, by, 10, '#fff6cc', '#e2ad55', '#9a5f26'), '#3a2008', 1.6);
    c.beginPath(); CIR(c, -2.6, by - 3.2, 2.2); FILL(c, 'rgba(255,255,255,0.8)');
  }
});

/* ============================================================================================ */
/* SCIENCE                                                                                      */
/* ============================================================================================ */

const pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

function GEAR(c, n, ro, rr, halfRoot, halfTip, a0 = -Math.PI / 2) {
  const step = TAU / n;
  for (let i = 0; i < n; i++) {
    const a = a0 + i * step;
    const p = [pol(rr, a - halfRoot), pol(ro, a - halfTip), pol(ro, a + halfTip), pol(rr, a + halfRoot)];
    if (i === 0) c.moveTo(p[0][0], p[0][1]); else c.lineTo(p[0][0], p[0][1]);
    c.lineTo(p[1][0], p[1][1]); c.lineTo(p[2][0], p[2][1]); c.lineTo(p[3][0], p[3][1]);
    c.arc(0, 0, rr, a + halfRoot, a + step - halfRoot);
  }
  c.closePath();
}

full('wheel', (c) => {
  const n = 10;
  c.beginPath(); GEAR(c, n, 45, 36, 9.5 * DEG, 6 * DEG); CIR(c, 0, 0, 25);
  FS(c, lg(c, -40, -40, 40, 40, '#f6f9fc', '#b6c2cf', '#6b7888'), '#1f252e', OUT, 'evenodd');
  c.beginPath(); CIR(c, 0, 0, 25); STK(c, 'rgba(20,28,40,0.55)', 1.4);
  c.beginPath(); c.arc(0, 0, 31, 190 * DEG, 275 * DEG); STK(c, 'rgba(255,255,255,0.8)', 2.2);
  c.beginPath(); c.arc(0, 0, 31, 10 * DEG, 95 * DEG); STK(c, 'rgba(30,40,60,0.25)', 2.2);
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 6, ca = Math.cos(a), sa = Math.sin(a);
    const q = (r, w) => [r * ca - w * sa, r * sa + w * ca];
    c.beginPath(); P(c, [q(6, -3.6), q(26, -3), q(26, 3), q(6, 3.6)]);
    FS(c, lg(c, -20, -20, 20, 20, '#e6edf4', '#9ba9b8', '#657386'), '#1f252e', 2.2);
  }
  c.beginPath(); CIR(c, 0, 0, 12);
  FS(c, rg(c, -3, -4, 1, 0, 0, 13, '#ffe7a0', '#e0a640', '#8f5a16'), '#3a2308', 3);
  c.beginPath(); CIR(c, 0, 0, 4.4); FS(c, '#2b2117', '#120c06', 1.2);
});

full('mortar', (c) => {
  const rim = (fill, line, lw) => { c.beginPath(); ELL(c, 0, -6, 37, 10); FS(c, fill, line, lw); };
  rim(lg(c, -37, -16, 37, 4, '#fffaf0', '#d7cbb2'), '#3b3122', 3.6);
  c.beginPath(); ELL(c, 0, -5, 33, 7.4); FS(c, lg(c, -30, -12, 30, 3, '#4a3f30', '#7a6b54'), null);
  // herbs
  const herb = (x, y, ang, len) => { c.beginPath(); LEAF(c, x, y, ang, len, 3.6); FS(c, lg(c, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, '#3f8f3a', '#8fd070'), '#1f4a1a', 1.6); };
  herb(-14, -2, -110 * DEG, 17); herb(-14, -2, -75 * DEG, 15); herb(-14, -2, -145 * DEG, 13);
  // pestle
  const b = [-3, 12], t = [29, -33];
  const dx = t[0] - b[0], dy = t[1] - b[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  c.beginPath(); P(c, [[b[0] - nx * 4.5, b[1] - ny * 4.5], [b[0] + nx * 4.5, b[1] + ny * 4.5], [t[0] + nx * 6.6, t[1] + ny * 6.6], [t[0] - nx * 6.6, t[1] - ny * 6.6]]);
  FS(c, lg(c, b[0] - 8, b[1] - 8, b[0] + 12, b[1] + 8, '#f0c88a', '#c98e4f', '#8a5626'), '#3a2210', 3.2);
  c.beginPath(); CIR(c, t[0], t[1], 8.2);
  FS(c, rg(c, t[0] - 3, t[1] - 3, 1, t[0], t[1], 9, '#ffe2b0', '#d59a58', '#8a5626'), '#3a2210', 3.2);
  // bowl body
  c.beginPath();
  c.moveTo(-37, -6); c.bezierCurveTo(-37, 24, -22, 38, 0, 38); c.bezierCurveTo(22, 38, 37, 24, 37, -6);
  c.ellipse(0, -6, 37, 10, 0, 0, Math.PI, false); c.closePath();
  FS(c, lg(c, -36, -8, 34, 40, '#fffaf0', '#dccfb4', '#a39377'), '#3b3122', 3.8);
  c.beginPath(); RR(c, -14, 36, 28, 7.5, 3); FS(c, lg(c, -14, 36, 14, 44, '#d6c9ae', '#93856a'), '#3b3122', 3);
  c.beginPath(); c.moveTo(-31, 6); c.bezierCurveTo(-30, 18, -22, 28, -10, 32); STK(c, 'rgba(255,255,255,0.85)', 2.8);
  c.beginPath(); c.moveTo(20, 24); c.bezierCurveTo(26, 18, 30, 12, 32, 4); STK(c, 'rgba(90,70,40,0.25)', 3);
});

full('quill', (c) => {
  const B = [-13, -2], ang = -47 * DEG, len = 65, hw = 13;
  const T = [B[0] + Math.cos(ang) * len, B[1] + Math.sin(ang) * len];
  const dk = '#25324d';
  // shaft stub going into the pot
  c.beginPath(); LN(c, B[0], B[1], -28, 15); STK(c, '#4a3a22', 6.6); STK(c, '#f3e6c0', 3.6);
  // vane
  c.beginPath(); LEAF(c, B[0], B[1], ang, len, hw);
  FS(c, lg(c, -22, -44, 36, 2, '#ffffff', '#e6eef9', '#a9bbd6'), dk, 3.8);
  c.save(); c.beginPath(); LEAF(c, B[0], B[1], ang, len, hw); c.clip();
  // shaded lower half of the vane
  c.beginPath(); P(c, [[B[0], B[1]], [T[0], T[1]], [T[0] + 30, T[1] + 40], [B[0] + 30, B[1] + 40]]); FILL(c, 'rgba(70,95,140,0.22)');
  for (let t = 0.12; t < 0.95; t += 0.068) {
    const px = B[0] + Math.cos(ang) * len * t, py = B[1] + Math.sin(ang) * len * t;
    for (const s of [-1, 1]) {
      const a = ang + s * 62 * DEG, l = 15;
      c.beginPath(); LN(c, px, py, px + Math.cos(a) * l, py + Math.sin(a) * l); STK(c, 'rgba(60,80,120,0.5)', 1.2);
    }
  }
  c.restore();
  c.beginPath(); LN(c, B[0] + 1, B[1] - 1, T[0], T[1]); STK(c, '#40527a', 2.6);
  c.beginPath(); LEAF(c, B[0], B[1], ang, len, hw); STK(c, dk, 3.8);
  // ink pot
  c.beginPath(); RR(c, -47, 20, 36, 24, 9);
  FS(c, lg(c, -47, 20, -11, 44, '#7d90d8', '#34448a', '#151c4a'), '#0b0f2c', 3.8);
  c.beginPath(); RR(c, -41, 13, 24, 10, 3.4); FS(c, lg(c, -41, 13, -17, 23, '#a3b3ee', '#3c4c94'), '#0b0f2c', 3);
  c.beginPath(); LN(c, -46, 32.5, -12, 32.5); STK(c, '#f0c04a', 3.2);
  c.beginPath(); LN(c, -42, 26, -42, 39); STK(c, 'rgba(255,255,255,0.45)', 2.6);
  // drop of ink
  c.beginPath(); c.moveTo(30, 22); c.bezierCurveTo(32, 30, 40, 33, 40, 40); c.arc(33, 40, 7, 0, Math.PI, false); c.bezierCurveTo(26, 33, 28, 30, 30, 22); c.closePath();
  FS(c, lg(c, 24, 26, 40, 46, '#6f82cc', '#22306e', '#0e1436'), '#0b0f2c', 3);
  c.beginPath(); CIR(c, 30.4, 39, 1.9); FILL(c, 'rgba(255,255,255,0.7)');
});

full('square', (c) => {
  // protractor (behind)
  c.beginPath(); c.moveTo(-34, 36); c.lineTo(46, 36); c.arc(6, 36, 40, 0, Math.PI, true); c.closePath();
  FS(c, lg(c, -30, -4, 40, 36, '#fff6d0', '#f0dc98', '#cdb060'), '#4d3a14', 3.4);
  for (let a = 0; a <= 180; a += 10) {
    const an = (a * DEG), big = a % 30 === 0;
    const p0 = [6 + Math.cos(an) * (big ? 27 : 31) * 1, 36 - Math.sin(an) * (big ? 27 : 31)], p1 = [6 + Math.cos(an) * 35.5, 36 - Math.sin(an) * 35.5];
    c.beginPath(); LN(c, p0[0], p0[1], p1[0], p1[1]); STK(c, 'rgba(70,50,15,0.75)', big ? 1.7 : 1.2, 'butt');
  }
  c.beginPath(); c.arc(6, 36, 23, Math.PI, 0); STK(c, 'rgba(70,50,15,0.5)', 1.3);
  // set-square (front) with a cut-out
  c.beginPath();
  P(c, [[-42, -40], [-42, 40], [22, 40]]);
  P(c, [[-31, -14], [-31, 29], [-4, 29]]);
  FS(c, lg(c, -42, -40, 22, 40, '#f5b866', '#d4832f', '#8f4f14'), '#3d2007', OUT, 'evenodd');
  c.beginPath(); P(c, [[-31, -14], [-31, 29], [-4, 29]]); STK(c, 'rgba(60,30,5,0.55)', 1.5);
  for (let i = 0; i < 8; i++) {
    const y = -30 + i * 8.6, l = i % 2 ? 4 : 6.5;
    c.beginPath(); LN(c, -42, y, -42 + l, y); STK(c, 'rgba(60,30,5,0.7)', 1.5, 'butt');
  }
  for (let i = 0; i < 6; i++) {
    const x = -32 + i * 9, l = i % 2 ? 4 : 6.5;
    c.beginPath(); LN(c, x, 40, x, 40 - l); STK(c, 'rgba(60,30,5,0.7)', 1.5, 'butt');
  }
  c.beginPath(); LN(c, -39, -33, -39, 33); STK(c, 'rgba(255,240,200,0.55)', 1.6);
});

full('sundial', (c) => {
  // side + top of the stone plate
  c.beginPath(); c.moveTo(-41, 10); c.lineTo(-41, 19); c.ellipse(0, 19, 41, 19, 0, Math.PI, 0, true); c.lineTo(41, 10); c.closePath();
  FS(c, lg(c, -41, 10, 41, 38, '#c9b078', '#9a7f48', '#6c5426'), '#3a2c12', 3.6);
  c.beginPath(); ELL(c, 0, 10, 41, 19); FS(c, lg(c, -36, -6, 36, 26, '#fff0c6', '#ead6a2', '#c8ae72'), '#3a2c12', 3.6);
  c.beginPath(); ELL(c, 0, 10, 35, 15.5); STK(c, 'rgba(90,64,24,0.6)', 1.4);
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    c.beginPath(); LN(c, Math.cos(a) * 12, 10 + Math.sin(a) * 5.2, Math.cos(a) * 32, 10 + Math.sin(a) * 14);
    STK(c, 'rgba(90,64,24,0.85)', 1.9);
  }
  // shadow wedge
  c.beginPath(); P(c, [[-3, 12], [9, 8], [33, 17], [24, 24]]); FILL(c, 'rgba(60,40,10,0.32)');
  // gnomon
  c.beginPath(); P(c, [[-9, 14], [-1, -34], [10, 10], [1, 17]]); FS(c, '#c98a24', null);
  c.beginPath(); P(c, [[-9, 14], [-1, -34], [1, 17]]); FS(c, lg(c, -9, -20, 1, 17, '#fff4b0', '#f3c445', '#d8992c'), null);
  c.beginPath(); P(c, [[-1, -34], [10, 10], [1, 17]]); FS(c, lg(c, -1, -30, 10, 17, '#d9962e', '#9a5f12'), null);
  c.beginPath(); LN(c, -1, -34, 1, 17); STK(c, 'rgba(74,46,6,0.55)', 1.4);
  c.beginPath(); P(c, [[-9, 14], [-1, -34], [10, 10], [1, 17]]); STK(c, '#4a2e06', 3.4);
  c.beginPath(); LN(c, -5.4, 8, -2.2, -22); STK(c, 'rgba(255,255,255,0.7)', 1.6);
  // sun
  const sx = -33, sy = -30;
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8, ca = Math.cos(a), sa = Math.sin(a);
    c.beginPath(); LN(c, sx + ca * 9.5, sy + sa * 9.5, sx + ca * 14, sy + sa * 14); STK(c, '#5a3a05', 4.4); STK(c, '#f6cb45', 2.2);
  }
  c.beginPath(); CIR(c, sx, sy, 7.4); FS(c, rg(c, sx - 2, sy - 2, 1, sx, sy, 8, '#fff6b0', '#f4c43c', '#c88a16'), '#5a3a05', 2.6);
});

full('astrolabe', (c) => {
  const gold = (w) => { STK(c, '#4d3105', w + 3.2); STK(c, lg(c, -38, -38, 38, 38, '#fff0a8', '#f0bf42', '#b57c1a'), w); };
  const cy = -3;
  // stand
  c.beginPath(); P(c, [[-12, 47], [-7, 37], [7, 37], [12, 47]]); FS(c, lg(c, -12, 37, 12, 47, '#e8b040', '#9b6a16'), '#4d3105', 3);
  c.beginPath(); RR(c, -19, 43, 38, 6, 2.5); FS(c, lg(c, -19, 43, 19, 49, '#f0c04a', '#9b6a16'), '#4d3105', 2.6);
  // axis
  c.beginPath(); LN(c, -13, cy + 44, 13, cy - 44); STK(c, '#4d3105', 6.4); STK(c, '#dba33a', 3.2);
  // meridian
  c.beginPath(); c.arc(0, cy, 37, 0, TAU); gold(6.4);
  // back halves of the inner rings
  c.beginPath(); c.ellipse(0, cy, 37, 12.5, 0, Math.PI, TAU); gold(4.6);
  c.beginPath(); c.ellipse(0, cy, 37, 13, -0.66, Math.PI, TAU); gold(4.6);
  // globe with star
  c.beginPath(); CIR(c, 0, cy, 14.5);
  FS(c, rg(c, -5, cy - 6, 1, 0, cy, 16, '#a9e6ff', '#3c8fd0', '#173a78'), '#0e1f45', 3);
  c.beginPath(); P(c, starPts(5, 11.5, 4.8, 0, cy + 0.6));
  FS(c, lg(c, -8, cy - 8, 8, cy + 9, '#fffbd0', '#f5c94a', '#c8901c'), '#4d3105', 1.6);
  // front halves
  c.beginPath(); c.ellipse(0, cy, 37, 12.5, 0, 0, Math.PI); gold(4.6);
  c.beginPath(); c.ellipse(0, cy, 37, 13, -0.66, 0, Math.PI); gold(4.6);
  // finial balls
  [[-13, cy + 44], [13, cy - 44]].forEach(([x, y]) => { c.beginPath(); CIR(c, x, y, 3.8); FS(c, rg(c, x - 1, y - 1, 0.5, x, y, 4.2, '#fff0a8', '#e0a83a'), '#4d3105', 1.8); });
});

full('law', (c) => {
  const gold = (x0, y0, x1, y1) => lg(c, x0, y0, x1, y1, '#fff2ae', '#f0bf42', '#a86f14');
  const dk = '#4a2e06';
  // base + stem
  c.beginPath(); P(c, [[-21, 46], [-15, 38], [15, 38], [21, 46]]); FS(c, gold(-21, 38, 21, 46), dk, 3.2);
  c.beginPath(); RR(c, -5, -26, 10, 66, 2.5); FS(c, lg(c, -5, 0, 5, 0, '#fff0a8', '#e6ad34', '#94610f'), dk, 3.2);
  // beam
  c.beginPath(); RR(c, -33, -32, 66, 7.5, 3.5); FS(c, gold(-33, -32, 33, -24), dk, 3.2);
  // strings
  [-1, 1].forEach((s) => {
    const px = s * 31;
    c.beginPath(); LN(c, px, -25, px - 15, 10); LN(c, px, -25, px + 15, 10); LN(c, px, -25, px, 10); STK(c, dk, 3.4); STK(c, '#e8b43c', 1.4);
    // pan
    c.beginPath(); c.moveTo(px - 16, 9); c.lineTo(px + 16, 9); c.bezierCurveTo(px + 15, 21, px + 7, 25, px, 25); c.bezierCurveTo(px - 7, 25, px - 15, 21, px - 16, 9); c.closePath();
    FS(c, gold(px - 16, 9, px + 16, 25), dk, 3.2);
    c.beginPath(); LN(c, px - 12, 12.5, px + 4, 12.5); STK(c, 'rgba(255,255,255,0.7)', 1.6);
    c.beginPath(); CIR(c, px, -28, 3.6); FS(c, gold(px - 4, -32, px + 4, -24), dk, 2.2);
  });
  // finial
  c.beginPath(); CIR(c, 0, -34, 6.2); FS(c, rg(c, -2, -36, 1, 0, -34, 7, '#fff6be', '#eab63a', '#94610f'), dk, 3);
  c.beginPath(); c.arc(0, -34, 3.2, 0, TAU); STK(c, 'rgba(74,46,6,0.5)', 1.2);
});

/* ============================================================================================ */
/* MONOCHROME CHAIN SYMBOLS  (silhouettes with real holes, filled in opts.color)                */
/* ============================================================================================ */

/** fill a freshly built path (evenodd so nested sub-paths become holes / islands) */
const FP = (c, fn) => { c.beginPath(); fn(); c.fill('evenodd'); };
/** stroke a freshly built path in the current stroke colour */
const SP = (c, lw, fn, cap = 'round') => { c.beginPath(); fn(); c.lineWidth = lw; c.lineCap = cap; c.lineJoin = 'round'; c.stroke(); };
/** knock a stroked line out of what has been drawn (layer glyphs only) */
function ERASE(c, w) {
  if (!KO) return;
  c.save(); c.globalCompositeOperation = 'destination-out'; c.strokeStyle = '#000'; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); c.restore();
}
/** a closed arch-topped hole: left x0, right x1, top y0 (crown), bottom y1 */
function ARCH(c, x0, x1, y0, y1) {
  const r = (x1 - x0) / 2;
  c.moveTo(x0, y1); c.lineTo(x0, y0 + r); c.arc((x0 + x1) / 2, y0 + r, r, Math.PI, 0, false); c.lineTo(x1, y1); c.closePath();
}

mono('mask', (c) => {
  FP(c, () => {
    c.moveTo(-36, -26);
    c.bezierCurveTo(-30, -40, 30, -40, 36, -26);
    c.bezierCurveTo(41, -6, 30, 30, 0, 45);
    c.bezierCurveTo(-30, 30, -41, -6, -36, -26);
    c.closePath();
    // eyes
    c.moveTo(-28, -10); c.quadraticCurveTo(-17, -24, -5, -8); c.quadraticCurveTo(-16, -2, -28, -10); c.closePath();
    c.moveTo(28, -10); c.quadraticCurveTo(17, -24, 5, -8); c.quadraticCurveTo(16, -2, 28, -10); c.closePath();
    // smile
    c.moveTo(-20, 12); c.quadraticCurveTo(0, 38, 20, 12); c.quadraticCurveTo(0, 25, -20, 12); c.closePath();
    // brow ridge notch
    c.moveTo(-4, -2); c.lineTo(0, 10); c.lineTo(4, -2); c.quadraticCurveTo(0, 0, -4, -2); c.closePath();
  });
});

mono('moon', (c) => {
  FP(c, () => CRESCENT(c, -4, 2, 41, 13, -7, 33));
  FP(c, () => P(c, starPts(4, 12, 3, 24, -5, -Math.PI / 2)));
  FP(c, () => P(c, starPts(4, 5.5, 1.4, 34, 20, -Math.PI / 2)));
});

mono('drop', (c) => {
  FP(c, () => {
    c.moveTo(0, -46);
    c.bezierCurveTo(6, -29, 30, -10, 30, 14);
    c.arc(0, 14, 30, 0, Math.PI, false);
    c.bezierCurveTo(-30, -10, -6, -29, 0, -46);
    c.closePath();
    CRESCENT(c, 0, 14, 21, 3.4, 10.6, 21);
  });
});

mono('horseshoe', (c) => {
  const cy = 6, Ro = 39, Ri = 21, a0 = -36 * DEG, a1 = 216 * DEG;
  c.beginPath();
  c.arc(0, cy, Ro, a0, a1, false);
  c.arc(0, cy, Ri, a1, a0, true);
  c.closePath();
  for (const off of [0, -34, 34, -68, 68, -102, 102]) {
    const a = (90 + off) * DEG, r = (Ro + Ri) / 2;
    CIR(c, r * Math.cos(a), cy + r * Math.sin(a), 3.4);
  }
  c.fill('evenodd');
  // soften the corners a touch
  c.beginPath(); c.arc(0, cy, Ro - 1.5, a0, a1, false); c.arc(0, cy, Ri + 1.5, a1, a0, true); c.closePath();
  c.lineWidth = 3; c.stroke();
});

mono('sword', (c) => {
  FP(c, () => {
    c.moveTo(0, -47);
    c.bezierCurveTo(7, -39, 10.5, -27, 10.5, -13);
    c.lineTo(8.5, 10);
    c.lineTo(-8.5, 10);
    c.lineTo(-10.5, -13);
    c.bezierCurveTo(-10.5, -27, -7, -39, 0, -47);
    c.closePath();
    RR(c, -1.9, -34, 3.8, 42, 1.9);
  });
  FP(c, () => RR(c, -23, 11, 46, 7.5, 3.75));
  FP(c, () => {
    RR(c, -5, 19, 10, 21, 2.5);
    RR(c, -5.6, 24, 11.2, 1.7, 0.8); RR(c, -5.6, 29, 11.2, 1.7, 0.8); RR(c, -5.6, 34, 11.2, 1.7, 0.8);
  });
  FP(c, () => CIR(c, 0, 44, 6.4));
});

mono('fort', (c) => {
  FP(c, () => {
    P(c, [
      [-44, 46], [-44, -36], [-38, -36], [-38, -30], [-34, -30], [-34, -36], [-28, -36], [-28, -30], [-24, -30], [-24, -36], [-18, -36],
      [-18, -14], [-12, -14], [-12, -8], [-8, -8], [-8, -14], [-2, -14], [-2, -8], [2, -8], [2, -14], [8, -14], [8, -8], [12, -8], [12, -14], [18, -14],
      [18, -36], [24, -36], [24, -30], [28, -30], [28, -36], [34, -36], [34, -30], [38, -30], [38, -36], [44, -36], [44, 46],
    ]);
    ARCH(c, -11, 11, 4, 40);                  // gate opening
    RR(c, -34.5, -20, 6, 15, 3); RR(c, 28.5, -20, 6, 15, 3);   // tower slits
    RR(c, -34.5, 4, 6, 15, 3); RR(c, 28.5, 4, 6, 15, 3);
    // portcullis: nested islands inside the gate hole
    RR(c, -7.6, 13, 2.6, 26, 1); RR(c, -1.3, 8, 2.6, 31, 1); RR(c, 5, 13, 2.6, 26, 1);
    RR(c, -9, 17, 18, 2.4, 1); RR(c, -9, 25, 18, 2.4, 1); RR(c, -9, 33, 18, 2.4, 1);
  });
});

mono('lamp', (c) => {
  FP(c, () => {
    c.moveTo(-30, 5);
    c.bezierCurveTo(-31, 27, -16, 35, 2, 35);
    c.bezierCurveTo(20, 35, 30, 29, 32, 17);
    c.lineTo(47, 4); c.lineTo(46, -2); c.lineTo(32, 4);
    c.bezierCurveTo(10, 8, -12, 8, -30, 5);
    c.closePath();
    CIR(c, -14, 21, 2.4); CIR(c, -2, 24, 2.4); CIR(c, 10, 22, 2.4);
  });
  FP(c, () => { c.arc(-6, 6, 12, Math.PI, 0, false); c.closePath(); CIR(c, -6, 0.5, 2.8); });
  FP(c, () => { CIR(c, -38, 12, 9.5); CIR(c, -38, 12, 4.4); });
  FP(c, () => {
    c.moveTo(41, -38); c.bezierCurveTo(43, -28, 50, -22, 50, -11); c.arc(41, -11, 9, 0, Math.PI, false); c.bezierCurveTo(32, -22, 39, -28, 41, -38); c.closePath();
    c.moveTo(41, -26); c.bezierCurveTo(42, -21, 45, -18, 45, -12); c.arc(41, -12, 4, 0, Math.PI, false); c.bezierCurveTo(37, -18, 40, -21, 41, -26); c.closePath();
  });
});

mono('abacus', (c) => {
  FP(c, () => { RR(c, -44, -37, 88, 74, 8); RR(c, -37.5, -30.5, 75, 61, 3); });
  const rows = [[-17, 3, 1], [0, 1, 3], [17, 2, 2]];
  const r = 7;
  rows.forEach(([y, nl, nr]) => {
    SP(c, 3, () => LN(c, -37, y, 37, y), 'butt');
    FP(c, () => {
      for (let i = 0; i < nl; i++) CIR(c, -29.5 + i * 14.4, y, r);
      for (let i = 0; i < nr; i++) CIR(c, 29.5 - i * 14.4, y, r);
    });
  });
});

function BOOK(c) {
  c.moveTo(0, -24); c.bezierCurveTo(-10, -32, -30, -34, -46, -26); c.lineTo(-46, 32); c.bezierCurveTo(-30, 26, -10, 26, 0, 34);
  c.bezierCurveTo(10, 26, 30, 26, 46, 32); c.lineTo(46, -26); c.bezierCurveTo(30, -34, 10, -32, 0, -24); c.closePath();
  c.moveTo(-3, -19); c.bezierCurveTo(-12, -25, -28, -27, -41, -21); c.lineTo(-41, 25); c.bezierCurveTo(-28, 20, -12, 20, -3, 28); c.closePath();
  c.moveTo(3, -19); c.bezierCurveTo(12, -25, 28, -27, 41, -21); c.lineTo(41, 25); c.bezierCurveTo(28, 20, 12, 20, 3, 28); c.closePath();
  for (const s of [-1, 1]) {
    [[-10, 28], [-1, 28], [8, 28], [17, 17]].forEach(([y, w]) => RR(c, s < 0 ? -36 : 8, y - 1.8, w, 3.6, 1.8));
  }
}
mono('book', (c) => { FP(c, () => BOOK(c)); });

mono('vial', (c) => {
  FP(c, () => {
    // outer glass
    c.moveTo(-11, -46); c.lineTo(11, -46); c.lineTo(11, -40); c.lineTo(8, -40); c.lineTo(8, -14); c.lineTo(35, 31);
    c.quadraticCurveTo(39, 44, 25, 44); c.lineTo(-25, 44); c.quadraticCurveTo(-39, 44, -35, 31); c.lineTo(-8, -14); c.lineTo(-8, -40); c.lineTo(-11, -40); c.closePath();
    // empty part of the cavity above the liquid
    c.moveTo(-3.6, -40); c.lineTo(3.6, -40); c.lineTo(3.6, -11); c.lineTo(23, 16); c.lineTo(-23, 16); c.lineTo(-3.6, -11); c.closePath();
    // bubbles in the liquid (holes) and above it (islands inside the empty cavity)
    CIR(c, -8, 30, 3.6); CIR(c, 9, 26, 2.8); CIR(c, 1, 36, 2.2);
    CIR(c, 0, -3, 2.2); CIR(c, 8, 8, 1.8);
  });
});

mono('pillar', (c) => {
  FP(c, () => RR(c, -24, -44, 48, 7.5, 2));
  FP(c, () => { P(c, [[-16, -37], [16, -37], [13, -28], [-13, -28]]); });
  FP(c, () => { CIR(c, -17.5, -30, 8.4); CIR(c, -17.5, -30, 3.2); });
  FP(c, () => { CIR(c, 17.5, -30, 8.4); CIR(c, 17.5, -30, 3.2); });
  FP(c, () => {
    P(c, [[-12.5, -27], [12.5, -27], [10.5, 33], [-10.5, 33]]);
    RR(c, -6.8, -19, 2.8, 47, 1.4); RR(c, -1.4, -19, 2.8, 47, 1.4); RR(c, 4, -19, 2.8, 47, 1.4);
  });
  FP(c, () => RR(c, -16, 33, 32, 6.5, 2.5));
  FP(c, () => RR(c, -22, 40, 44, 7, 2.5));
});

mono('sun', (c) => {
  FP(c, () => {
    CIR(c, 0, 0, 18); CIR(c, 0, 0, 13); CIR(c, 0, 0, 9);
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12 - Math.PI / 2, ro = i % 2 ? 39 : 47, hw = i % 2 ? 0.16 : 0.2;
      P(c, [pol(25, a - hw), pol(ro, a), pol(25, a + hw)]);
    }
  });
});

mono('laurel', (c) => {
  const bz = (t) => {
    const P0 = [-24, 46], P1 = [-52, 4], P2 = [-14, -30], P3 = [24, -46], u = 1 - t;
    const x = u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0];
    const y = u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1];
    const dx = 3 * u * u * (P1[0] - P0[0]) + 6 * u * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]);
    const dy = 3 * u * u * (P1[1] - P0[1]) + 6 * u * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]);
    return [x, y, Math.atan2(dy, dx)];
  };
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = 0.16 + (i / (n - 1)) * 0.7;
    const [x, y, a] = bz(t);
    const len = 20 - 6 * (i / (n - 1)), hw = 5.2 - 1.2 * (i / (n - 1));
    for (const s of [-1, 1]) {
      c.beginPath(); LEAF(c, x, y, a + s * 48 * DEG, len, hw); CUT(c, 1.3); c.fill();
    }
  }
  const [tx, ty, ta] = bz(1);
  c.beginPath(); LEAF(c, tx - Math.cos(ta) * 4, ty - Math.sin(ta) * 4, ta, 17, 4.2); CUT(c, 1.3); c.fill();
  SP(c, 3.8, () => { c.moveTo(-24, 46); c.bezierCurveTo(-52, 4, -14, -30, 24, -46); });
}, true);

mono('scroll', (c) => {
  // open scroll: parchment with text, rolled up at both ends, tied with a seal
  c.beginPath();
  c.moveTo(-32, -24); c.quadraticCurveTo(0, -30, 32, -24); c.lineTo(32, 24); c.quadraticCurveTo(0, 30, -32, 24); c.closePath();
  RR(c, -23, -13.5, 46, 4.2, 2.1); RR(c, -23, -4.5, 46, 4.2, 2.1); RR(c, -23, 4.5, 30, 4.2, 2.1);
  c.fill('evenodd');
  const roll = (x) => {
    c.beginPath(); RR(c, x - 9.5, -33, 19, 66, 9.5); CUT(c, 2); c.fill();
    // end-cap spiral rings on the top of the roll
    c.beginPath(); c.ellipse(x, -25, 6.2, 3.6, 0, 0, TAU); ERASE(c, 2.1);
    c.beginPath(); c.ellipse(x, -25, 2.4, 1.4, 0, 0, TAU); ERASE(c, 1.8);
    c.beginPath(); c.ellipse(x, 25, 6.2, 3.6, 0, 0, Math.PI); ERASE(c, 2.1);
  };
  roll(-37); roll(37);
  // wax seal with ribbon tails
  c.beginPath(); P(c, [[9, 15], [4, 34], [9, 31], [13, 37], [16, 17]]); CUT(c, 1.6); c.fill();
  c.beginPath(); P(c, [[16, 15], [20, 37], [24, 31], [29, 34], [24, 15]]); CUT(c, 1.6); c.fill();
  c.beginPath(); CIR(c, 15.5, 14, 8); CUT(c, 1.8); c.fill();
  c.beginPath(); P(c, starPts(5, 4.6, 2, 15.5, 14.2)); ERASE(c, 1.6);
}, true);

mono('compass', (c) => {
  FP(c, () => { CIR(c, 0, -31, 8.5); CIR(c, 0, -31, 3.4); });
  FP(c, () => RR(c, -3.2, -49, 6.4, 13, 2.6));
  FP(c, () => CIR(c, 0, -49, 4.2));
  const H = [0, -31];
  const leg = (E, holder) => {
    const dx = E[0] - H[0], dy = E[1] - H[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const at = (t, w) => [H[0] + dx * t + nx * w, H[1] + dy * t + ny * w];
    FP(c, () => P(c, [at(0.09, -4.8), at(0.09, 4.8), at(1, 1), at(1, -1)]));
    if (holder) FP(c, () => P(c, [at(0.6, -4.6), at(0.6, 4.6), at(0.88, 3.4), at(0.88, -3.4)]));
  };
  leg([-31, 46], false);
  leg([31, 46], true);
  SP(c, 3.6, () => { c.moveTo(-15, 8); c.quadraticCurveTo(0, -3, 15, 8); });
});

mono('telescope', (c) => {
  c.save();
  c.translate(2, -13);
  c.rotate(-28 * DEG);
  FP(c, () => RR(c, -44, -4.8, 16, 9.6, 2.2));
  FP(c, () => RR(c, -25, -7.8, 26, 15.6, 2.6));
  FP(c, () => RR(c, 3, -11, 30, 22, 2.8));
  FP(c, () => { RR(c, 35, -13.5, 10, 27, 3); });
  c.restore();
  // tripod
  const px = 2 + Math.cos(-28 * DEG) * -9, py = -13 + Math.sin(-28 * DEG) * -9 + 8;
  SP(c, 5.4, () => { LN(c, px, py, -20, 46); LN(c, px, py, 14, 46); LN(c, px, py, px + 1, 44); });
  FP(c, () => CIR(c, px, py, 5.2));
});

mono('arena', (c) => {
  FP(c, () => {
    c.moveTo(-46, 44); c.lineTo(-46, -25); c.quadraticCurveTo(-46, -37, -34, -37); c.lineTo(34, -37); c.quadraticCurveTo(46, -37, 46, -25); c.lineTo(46, 44); c.closePath();
    const xs = [-33, -16.5, 0, 16.5, 33];
    xs.forEach((x) => { ARCH(c, x - 4.7, x + 4.7, 18, 40); ARCH(c, x - 4.7, x + 4.7, -2, 12); ARCH(c, x - 4.2, x + 4.2, -20.5, -9); });
    [-35, -21, -7, 7, 21, 35].forEach((x) => RR(c, x - 2.6, -31.5, 5.2, 5.5, 1.2));
  });
});

mono('target', (c) => {
  const s = Math.SQRT1_2, u = [s, -s], v = [s, s];
  const at = (sv, w) => [u[0] * sv + v[0] * w, u[1] * sv + v[1] * w];
  FP(c, () => { CIR(c, 0, 0, 41); CIR(c, 0, 0, 33); CIR(c, 0, 0, 25); CIR(c, 0, 0, 17); CIR(c, 0, 0, 9); });
  const shaft = [at(0, -1.9), at(0, 1.9), at(43, 1.9), at(43, -1.9)];
  const fa = [at(28, 1.9), at(37, 10.5), at(47, 10.5), at(43, 1.9)];
  const fb = [at(28, -1.9), at(37, -10.5), at(47, -10.5), at(43, -1.9)];
  [shaft, fa, fb].forEach((poly) => { c.beginPath(); P(c, poly); CUT(c, 2.4); });
  [shaft, fa, fb].forEach((poly) => { c.beginPath(); P(c, poly); c.fill(); });
  // arrow tip
  c.beginPath(); P(c, [at(-5, 0), at(3, 3.4), at(3, -3.4)]); c.fill();
}, true);

mono('helmet', (c) => {
  // crest: an arched plume floating above the dome
  FP(c, () => {
    const cx = -4, cy = -2, ro = 48, ri = 37.5, a0 = 208 * DEG, a1 = 338 * DEG;
    c.arc(cx, cy, ro, a0, a1, false); c.arc(cx, cy, ri, a1, a0, true); c.closePath();
    for (const a of [236, 256, 276, 296, 316]) {
      const r = a * DEG, w = 0.026;
      P(c, [[cx + Math.cos(r - w) * 40.5, cy + Math.sin(r - w) * 40.5], [cx + Math.cos(r - w) * 45.5, cy + Math.sin(r - w) * 45.5], [cx + Math.cos(r + w) * 45.5, cy + Math.sin(r + w) * 45.5], [cx + Math.cos(r + w) * 40.5, cy + Math.sin(r + w) * 40.5]]);
    }
  });
  FP(c, () => {
    c.moveTo(-34, 30);
    c.bezierCurveTo(-42, 12, -40, -26, -8, -32);
    c.bezierCurveTo(16, -37, 33, -22, 35, 3);
    c.lineTo(32, 15);
    c.bezierCurveTo(34, 27, 29, 38, 17, 45);
    c.lineTo(6, 45);
    c.lineTo(2, 35);
    c.lineTo(-10, 39);
    c.lineTo(-22, 46);
    c.closePath();
    // eye opening (behind the nose guard) and mouth slit
    c.moveTo(11, -10); c.quadraticCurveTo(19, -15, 27, -9); c.lineTo(26, -2); c.quadraticCurveTo(18, 3, 11, -1); c.closePath();
    RR(c, 16, 19, 11, 4, 2);
    // ear hole
    CIR(c, -9, 8, 3.2);
  });
});

mono('lighthouse', (c) => {
  const ex = (y) => 9 + (y + 10) * 0.0741;
  const seg = (y0, y1) => P(c, [[-ex(y0), y0], [ex(y0), y0], [ex(y1), y1], [-ex(y1), y1]]);
  FP(c, () => { seg(-10, 9); });
  FP(c, () => { seg(13, 27); });
  FP(c, () => { seg(31, 42); ARCH(c, -3.6, 3.6, 33.5, 40); });
  FP(c, () => RR(c, -16, -17, 32, 6.5, 2));
  FP(c, () => { RR(c, -9, -33, 18, 16, 2); RR(c, -4.6, -29.5, 9.2, 9.6, 2.4); });
  FP(c, () => { P(c, [[-12, -33], [0, -44], [12, -33]]); });
  FP(c, () => CIR(c, 0, -46, 2.4));
  FP(c, () => { c.moveTo(-38, 49); c.quadraticCurveTo(-32, 41, -18, 43); c.lineTo(18, 43); c.quadraticCurveTo(32, 41, 38, 49); c.closePath(); });
  for (const s of [-1, 1]) {
    SP(c, 3, () => { LN(c, s * 14, -30, s * 44, -41); LN(c, s * 14, -25, s * 46, -25); LN(c, s * 14, -20, s * 44, -9); });
  }
});

mono('scales', (c) => {
  const E1 = [-34, -37], E2 = [34, -25];
  SP(c, 5.2, () => LN(c, E1[0], E1[1], E2[0], E2[1]));
  const pan = (E, py) => {
    SP(c, 2.4, () => { LN(c, E[0], E[1], E[0] - 15, py); LN(c, E[0], E[1], E[0] + 15, py); });
    FP(c, () => { c.ellipse(E[0], py, 16, 11, 0, 0, Math.PI, false); c.closePath(); });
  };
  pan(E1, -2); pan(E2, 10);
  FP(c, () => { CIR(c, E1[0], E1[1], 3.8); CIR(c, E2[0], E2[1], 3.8); });
  FP(c, () => RR(c, -3.8, -32, 7.6, 70, 2));
  FP(c, () => P(c, [[-21, 47], [-14, 37], [14, 37], [21, 47]]));
  FP(c, () => { CIR(c, 0, -31, 7); CIR(c, 0, -31, 2.6); });
});

mono('anchor', (c) => {
  FP(c, () => { CIR(c, 0, -41, 8); CIR(c, 0, -41, 3.9); });
  FP(c, () => RR(c, -3.6, -34, 7.2, 76, 3));
  FP(c, () => { RR(c, -20, -25, 40, 6.4, 3.2); CIR(c, -20, -21.8, 4); CIR(c, 20, -21.8, 4); });
  SP(c, 7, () => c.arc(0, 12, 31, 8 * DEG, 172 * DEG, false));
  FP(c, () => { LEAF(c, 27, 22, -48 * DEG, 24, 7); LEAF(c, -27, 22, -132 * DEG, 24, 7); });
  FP(c, () => CIR(c, 0, 43, 4.6));
});

mono('tower', (c) => {
  FP(c, () => {
    P(c, [[-16, 49], [16, 49], [13, -14], [-13, -14]]);
    RR(c, -2.8, -8, 5.6, 15, 2.8);
    ARCH(c, -6, 6, 27, 44);
  });
  FP(c, () => RR(c, -22, -26, 44, 11, 2));
  FP(c, () => { RR(c, -22, -39, 10, 14, 1.6); RR(c, -5, -39, 10, 14, 1.6); RR(c, 12, -39, 10, 14, 1.6); });
  FP(c, () => RR(c, -25, 46, 50, 4.5, 2));
});

/* ============================================================================================ */
/* EFFECT ICONS (monochrome)                                                                    */
/* ============================================================================================ */

mono('again', (c) => {
  const R = 29;
  const arrow = (a0, a1) => {
    SP(c, 9.5, () => c.arc(0, 0, R, a0 * DEG, a1 * DEG, false));
    const th = a1 * DEG, ex = R * Math.cos(th), ey = R * Math.sin(th);
    FP(c, () => HEAD(c, ex, ey, th + Math.PI / 2, 19, 13.5));
  };
  arrow(196, 318);
  arrow(16, 138);
});

mono('destroy', (c) => {
  // cracked block: two shards separated by a jagged fissure
  FP(c, () => RP(c, [[-46, 8], [-11, 8], [-14.5, 17], [-8.5, 23], [-15.5, 32], [-10.5, 39], [-13.5, 46], [-46, 46]], [3, 1, 0.6, 0.6, 0.6, 0.6, 0.6, 3]));
  FP(c, () => RP(c, [[-5.5, 8], [10, 8], [10, 46], [-8, 46], [-5, 39], [-10, 32], [-3, 23], [-9, 17]], [1, 3, 3, 0.6, 0.6, 0.6, 0.6, 0.6]));
  // flying chips
  FP(c, () => { P(c, [[16, -2], [24, -8], [28, 0], [20, 5]]); P(c, [[29, 14], [36, 10], [40, 18], [33, 21]]); P(c, [[17, 24], [22, 22], [23, 28], [18, 29]]); });
  // hammer
  c.save();
  c.translate(-3, -15);
  c.rotate(-40 * DEG);
  FP(c, () => RR(c, 0, -4.4, 50, 8.8, 3.8));
  FP(c, () => { RR(c, -10.5, -21, 21, 42, 3.5); RR(c, 3.4, -15.5, 2.6, 31, 1.3); });
  c.restore();
  // impact ticks
  SP(c, 3, () => { LN(c, -30, -2, -36, -8); LN(c, -40, 3, -47, 0); LN(c, -22, -12, -24, -19); });
});

mono('revive', (c) => {
  const card = (cx, cy, rot, ring, gem) => {
    c.beginPath();
    c.save(); c.translate(cx, cy); c.rotate(rot * DEG);
    RR(c, -15, -21, 30, 42, 4.5);
    if (ring) RR(c, -10.2, -16.2, 20.4, 32.4, 2);
    if (gem) { c.moveTo(0, -7); c.lineTo(6.5, 0); c.lineTo(0, 7); c.lineTo(-6.5, 0); c.closePath(); }
    c.restore();
    CUT(c, 1.6); c.fill('evenodd');
  };
  card(-23, 27, -20, true, false);
  card(23, 27, 20, true, false);
  card(0, 28, 0, false, true);
  c.beginPath();
  RP(c, [[0, -48], [19, -22], [7, -22], [7, 15], [-7, 15], [-7, -22], [-19, -22]], [3, 3, 1, 1.5, 1.5, 1, 3]);
  CUT(c, 2); c.fill();
}, true);

mono('pawn', (c) => {
  const piece = (fn) => { c.beginPath(); fn(); CUT(c, 1.4); c.fill(); };
  piece(() => RR(c, -27, 14, 54, 10.5, 4.5));
  piece(() => { c.moveTo(-9.5, -13); c.bezierCurveTo(-9.5, -2, -17, 6, -20.5, 15); c.lineTo(20.5, 15); c.bezierCurveTo(17, 6, 9.5, -2, 9.5, -13); c.closePath(); });
  piece(() => RR(c, -14.5, -19.5, 29, 7, 3.5));
  piece(() => CIR(c, 0, -30, 12));
  SP(c, 5, () => LN(c, -28, 39, 28, 39));
  FP(c, () => { HEAD(c, -27, 39, Math.PI, 17, 11); HEAD(c, 27, 39, 0, 17, 11); });
}, true);

mono('library', (c) => {
  c.save(); c.translate(-6, 10); c.scale(0.83, 0.83);
  FP(c, () => BOOK(c));
  c.restore();
  FP(c, () => P(c, starPts(4, 15, 3.2, 31, -29, -Math.PI / 2)));
  FP(c, () => P(c, starPts(4, 7, 1.7, 7, -37, -Math.PI / 2)));
  FP(c, () => P(c, starPts(4, 5.5, 1.4, 43, -6, -Math.PI / 2)));
});

/* ============================================================================================ */
/* PROGRESS TOKEN EMBLEMS (full colour, no disc)                                                */
/* ============================================================================================ */

/** outlined stroke: dark underlay + coloured stroke of the same path */
function SO(c, dark, mid, w, fn, cap = 'round') {
  c.beginPath(); fn();
  STK(c, dark, w + 3.2, cap); STK(c, mid, w, cap);
}

full('agriculture', (c) => {
  const dk = '#5a3c08';
  const blade = (ang) => {
    c.beginPath(); LEAF(c, 0, 44, ang * DEG, 50, 6.8);
    const tx = Math.cos(ang * DEG) * 50, ty = 44 + Math.sin(ang * DEG) * 50;
    FS(c, lg(c, 0, 44, tx, ty, '#3f7a26', '#9fcf55'), '#1f4210', 2.6);
  };
  blade(-146); blade(-34);
  const ear = (angDeg, len) => {
    const a = angDeg * DEG, ca = Math.cos(a), sa = Math.sin(a), B = [0, 44];
    const T = [B[0] + ca * len, B[1] + sa * len];
    c.beginPath(); LN(c, B[0], B[1], T[0], T[1]); STK(c, dk, 6.2); STK(c, '#d2a23c', 3);
    const grains = [];
    for (let k = 0; k < 6; k++) {
      const t = 0.5 + k * 0.088, px = B[0] + ca * len * t, py = B[1] + sa * len * t;
      for (const s of [-1, 1]) grains.push([px, py, a + s * 31 * DEG, 12 - k * 0.5]);
    }
    grains.push([T[0] - ca * 3, T[1] - sa * 3, a, 13]);
    grains.forEach(([x, y, an, l]) => {
      c.beginPath(); LN(c, x + Math.cos(an) * l * 0.8, y + Math.sin(an) * l * 0.8, x + Math.cos(an) * (l + 6), y + Math.sin(an) * (l + 6)); STK(c, '#8a6412', 1.3);
    });
    grains.forEach(([x, y, an, l]) => {
      c.beginPath(); LEAF(c, x, y, an, l, 3.7);
      FS(c, lg(c, x, y, x + Math.cos(an) * l, y + Math.sin(an) * l, '#e0a626', '#fdeb8a'), dk, 1.6);
    });
  };
  ear(-113, 58); ear(-67, 58); ear(-90, 66);
  // tie
  c.beginPath(); P(c, [[-4, 30], [-11, 46], [-6, 44], [-2, 48]]); FS(c, '#a02c28', '#3d0e0c', 1.6);
  c.beginPath(); P(c, [[4, 30], [11, 46], [6, 44], [2, 48]]); FS(c, '#a02c28', '#3d0e0c', 1.6);
  c.beginPath(); RR(c, -11.5, 22, 23, 10, 4); FS(c, lg(c, 0, 22, 0, 32, '#ee6a58', '#b3302b', '#7a1c1a'), '#3d0e0c', 2.6);
});

full('architecture', (c) => {
  const cy = 7, Ro = 40, Ri = 24;
  const stone = (a0, a1, ro, fill, lw = 2.4, line = '#4a3c26') => {
    c.beginPath(); c.arc(0, cy, ro, a0 * DEG, a1 * DEG, false); c.arc(0, cy, Ri, a1 * DEG, a0 * DEG, true); c.closePath();
    FS(c, fill, line, lw);
  };
  // piers
  [[-40, -24], [24, 40]].forEach(([x0, x1]) => {
    [[7, 22, '#e9dcc0', '#cdbd97'], [22, 37, '#dccdaa', '#bfae86']].forEach(([y0, y1, a, b]) => {
      c.beginPath(); RR(c, x0, y0, x1 - x0, y1 - y0, 1.5); FS(c, lg(c, x0, y0, x1, y1, a, b), '#4a3c26', 2.4);
    });
  });
  const cols = ['#f2e8d0', '#dccdaa'];
  for (let i = 0; i < 4; i++) {
    const a = 180 + i * 20.5;
    stone(a, a + 20.5, Ro, lg(c, -40, -20, 20, 20, cols[i % 2], darken(cols[i % 2], 0.12)));
    stone(278 + i * 20.5, 278 + (i + 1) * 20.5, Ro, lg(c, -20, -30, 40, 20, cols[(i + 1) % 2], darken(cols[(i + 1) % 2], 0.18)));
  }
  stone(262, 278, 46, lg(c, -10, -46, 10, -20, '#fff0a0', '#f0bf42', '#b57c1a'), 2.8, '#5a3a05');
  c.beginPath(); RR(c, -47, 37, 94, 8, 2.5); FS(c, lg(c, 0, 37, 0, 45, '#dccdaa', '#a99770'), '#4a3c26', 2.8);
  // dividers in the opening
  const H = [0, -8];
  c.beginPath(); LN(c, H[0], H[1], -14, 33); LN(c, H[0], H[1], 14, 33);
  STK(c, '#2b1a08', 8.4, 'round'); STK(c, lg(c, -14, -8, 14, 33, '#f0b567', '#c9853a', '#8a5322'), 5);
  c.beginPath(); LN(c, -14, 33, -15.2, 36.5); LN(c, 14, 33, 15.2, 36.5); STK(c, '#2b1a08', 3);
  c.beginPath(); c.moveTo(-8.3, 14); c.quadraticCurveTo(0, 8, 8.3, 14); STK(c, '#2b1a08', 3.6); STK(c, '#e8b53a', 1.6);
  c.beginPath(); CIR(c, 0, -8, 4.8); FS(c, rg(c, -1, -9, 0.5, 0, -8, 5.2, '#fff0a8', '#e0a83a'), '#2b1a08', 1.8);
});

full('economy', (c) => {
  const R = 39, gr = ['#a8f0a0', '#3aa668', '#1c6a40'], dk = '#0f3a24';
  const arrow = (a0, a1) => {
    c.beginPath(); c.arc(0, 0, R, a0 * DEG, a1 * DEG, false); STK(c, dk, 11.4); STK(c, lg(c, -30, -40, 30, 40, ...gr), 8);
    const th = a1 * DEG, ex = R * Math.cos(th), ey = R * Math.sin(th);
    c.beginPath(); HEAD(c, ex, ey, th + Math.PI / 2, 19, 14);
    FS(c, lg(c, ex - 12, ey - 12, ex + 12, ey + 12, ...gr), dk, 2.6);
    c.beginPath(); c.arc(0, 0, R + 1.4, (a0 + 6) * DEG, (a0 + 40) * DEG); STK(c, 'rgba(255,255,255,0.5)', 1.6);
  };
  arrow(203, 320); arrow(23, 140);
  // purse
  c.beginPath(); c.moveTo(-8, -10); c.bezierCurveTo(-29, -2, -29, 27, 0, 27); c.bezierCurveTo(29, 27, 29, -2, 8, -10); c.closePath();
  FS(c, rg(c, -8, 2, 2, 0, 10, 32, '#e6a862', '#b97a3c', '#6f4218'), '#33190a', 3.2);
  c.beginPath(); c.moveTo(-9, -11); c.lineTo(-14, -26); c.quadraticCurveTo(0, -19, 14, -26); c.lineTo(9, -11); c.closePath();
  FS(c, lg(c, -12, -26, 12, -10, '#d9954f', '#9b622b'), '#33190a', 2.8);
  c.beginPath(); RR(c, -11, -14.5, 22, 6, 3); FS(c, lg(c, 0, -14, 0, -8, '#fff0a0', '#d9a02c'), '#4d3105', 2);
  c.beginPath(); CIR(c, 0, 9, 10.5); FS(c, lg(c, -8, 0, 8, 19, '#fff3a6', '#f0bf42', '#b57c1a'), '#4d3105', 2.4);
  c.beginPath(); P(c, starPts(5, 6, 2.6, 0, 9.6)); FS(c, '#a8720f', null);
  c.beginPath(); c.arc(-10, 4, 20, 190 * DEG, 235 * DEG); STK(c, 'rgba(255,240,210,0.55)', 2);
});

full('masonry', (c) => {
  // wall
  c.beginPath(); RR(c, -46, 6, 92, 38, 3); FILL(c, '#5c2c17');
  const rows = [[6, 0], [17.7, 11], [29.4, 0]];
  rows.forEach(([y, off], ri) => {
    for (let x = -46 - (off ? 0 : 0) + (off ? -11 : 0); x < 46; x += 23) {
      const x0 = Math.max(x + 1, -45), x1 = Math.min(x + 23 - 1, 45);
      if (x1 - x0 < 3) continue;
      c.beginPath(); RR(c, x0, y + 1, x1 - x0, 9.6, 1.6);
      FS(c, lg(c, x0, y, x1, y + 11, (x / 23 + ri) % 2 ? '#e08a58' : '#d67a48', '#a94a26'), null);
      c.beginPath(); LN(c, x0 + 1.5, y + 2.6, x1 - 1.5, y + 2.6); STK(c, 'rgba(255,225,200,0.4)', 1.2);
    }
  });
  c.beginPath(); RR(c, -46, 6, 92, 38, 3); STK(c, '#2c1208', 3.6);
  // trowel
  c.save(); c.translate(-4, -8); c.rotate(33 * DEG);
  c.beginPath(); RR(c, -37, -4.2, 27, 8.4, 4.2); FS(c, lg(c, 0, -4, 0, 4, '#e8b077', '#a8703c', '#6d431c'), '#33190a', 2.8);
  c.beginPath(); RR(c, -12, -2.2, 12, 4.4, 2); FS(c, '#8b96a3', '#232a33', 2.2);
  c.beginPath(); c.moveTo(-3, -1); c.lineTo(5, -12); c.quadraticCurveTo(28, -14, 42, 0); c.quadraticCurveTo(28, 14, 5, 12); c.lineTo(-3, 1); c.closePath();
  FS(c, lg(c, 0, -14, 0, 14, '#f4f7fb', '#b6c2cf', '#6f7d8e'), '#232a33', OUT - 0.4);
  c.beginPath(); c.moveTo(6, -8); c.quadraticCurveTo(26, -10, 36, -2); STK(c, 'rgba(255,255,255,0.8)', 1.8);
  c.restore();
});

full('mathematics', (c) => {
  const H = [0, -37];
  const leg = (E) => {
    const dx = E[0] - H[0], dy = E[1] - H[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    c.beginPath(); P(c, [[H[0] - nx * 5.5, H[1] - ny * 5.5], [H[0] + nx * 5.5, H[1] + ny * 5.5], [E[0] + nx * 1.1, E[1] + ny * 1.1], [E[0] - nx * 1.1, E[1] - ny * 1.1]]);
    FS(c, lg(c, -30, -37, 30, 40, '#f7faff', '#c3d1e4', '#8ea2bd'), '#1b2431', 3.4);
  };
  leg([-31, 38]); leg([31, 38]);
  c.beginPath(); c.moveTo(-17, 6); c.quadraticCurveTo(0, -6, 17, 6); STK(c, '#1b2431', 5.4); STK(c, '#c3d1e4', 2.4);
  c.beginPath(); RR(c, -3.2, -49, 6.4, 12, 2.6); FS(c, '#7a8aa0', '#1b2431', 2.4);
  c.beginPath(); CIR(c, 0, -37, 6.4); FS(c, rg(c, -1.5, -38.5, 0.5, 0, -37, 7, '#fff0a8', '#e0a83a', '#94610f'), '#3a2308', 2.4);
  // pi
  const pi = () => {
    c.moveTo(-26, -8); c.quadraticCurveTo(0, -16, 26, -8);
    c.moveTo(-12, -12); c.lineTo(-14.5, 32);
    c.moveTo(9, -12.5); c.lineTo(9, 21); c.quadraticCurveTo(9, 33, 21, 32);
  };
  c.beginPath(); pi(); c.lineCap = 'round'; c.lineJoin = 'round';
  STK(c, '#3a2308', 15.5); STK(c, lg(c, -26, -14, 26, 34, '#fff3a6', '#f0bf42', '#b57c1a'), 11);
  c.beginPath(); c.moveTo(-23, -10.5); c.quadraticCurveTo(-4, -15.5, 12, -12.5); STK(c, 'rgba(255,255,255,0.7)', 1.8);
  c.beginPath(); LN(c, -15.4, -6, -16.4, 16); STK(c, 'rgba(255,255,255,0.55)', 1.8);
});

full('philosophy', (c) => {
  const dk = '#33200e';
  // tufts
  [-1, 1].forEach((s) => { c.beginPath(); P(c, [[s * 25, -22], [s * 21, -45], [s * 7, -32]]); FS(c, lg(c, s * 25, -45, s * 7, -25, '#b98550', '#6a4326'), dk, 3); });
  // body + head
  c.beginPath(); ELL(c, 0, 12, 28, 32); FS(c, lg(c, -26, -20, 26, 44, '#cb9764', '#976239', '#5b3819'), dk, OUT - 0.4);
  c.beginPath(); ELL(c, 0, -13, 27, 23); FS(c, lg(c, -26, -34, 26, 8, '#cb9764', '#976239', '#6a4326'), dk, OUT - 0.4);
  // chest
  c.beginPath(); ELL(c, 0, 22, 16.5, 20); FS(c, lg(c, -10, 4, 12, 42, '#fff2cf', '#efd9a6'), null);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3 - (r % 2); k++) {
    const x = (k - (2 - (r % 2)) / 2) * 9.5, y = 11 + r * 8;
    c.beginPath(); c.arc(x, y, 4.2, 0.12 * Math.PI, 0.88 * Math.PI); STK(c, 'rgba(120,80,40,0.55)', 1.4);
  }
  // wings
  [-1, 1].forEach((s) => {
    c.beginPath(); c.moveTo(s * 24, -4); c.bezierCurveTo(s * 42, 4, s * 39, 30, s * 20, 41); c.bezierCurveTo(s * 21, 27, s * 19, 10, s * 24, -4); c.closePath();
    FS(c, lg(c, s * 40, -4, s * 20, 40, '#8a5a30', '#4f2f14'), dk, 3);
    c.beginPath(); LN(c, s * 31, 8, s * 25, 12); LN(c, s * 32, 18, s * 25, 22); LN(c, s * 30, 28, s * 24, 31); STK(c, 'rgba(255,220,170,0.4)', 1.4);
  });
  // face disc + eyes
  [-1, 1].forEach((s) => { c.beginPath(); CIR(c, s * 11.5, -13, 14.5); FS(c, rg(c, s * 11 - 2, -16, 1, s * 11.5, -13, 15, '#fffbe8', '#f0dfb4'), '#7a5028', 1.8); });
  [-1, 1].forEach((s) => {
    c.beginPath(); CIR(c, s * 11.5, -13, 9.4); FS(c, rg(c, s * 11.5 - 2, -15, 0.5, s * 11.5, -13, 10, '#fff4b8', '#f6c23c', '#c98a14'), dk, 2.4);
    c.beginPath(); CIR(c, s * 11.5, -12.5, 4.6); FILL(c, '#14090a');
    c.beginPath(); CIR(c, s * 11.5 - 1.6, -14.8, 1.6); FILL(c, '#ffffff');
  });
  c.beginPath(); P(c, [[-4.6, -9], [4.6, -9], [0, 3]]); FS(c, lg(c, 0, -9, 0, 3, '#ffd15a', '#d9902a'), dk, 2);
  // perch + feet
  c.beginPath(); RR(c, -36, 40, 72, 7.5, 3.75); FS(c, lg(c, 0, 40, 0, 48, '#a4713f', '#5e3a1a'), dk, 2.8);
  [-1, 1].forEach((s) => { c.beginPath(); RR(c, s * 10 - 7, 37, 14, 6, 3); FS(c, '#f0b030', dk, 1.8); });
});

full('strategy', (c) => {
  const spear = (ang) => {
    c.save(); c.translate(0, 6); c.rotate(ang * DEG);
    c.beginPath(); RR(c, -2.9, -44, 5.8, 92, 2.9); FS(c, lg(c, -3, 0, 3, 0, '#d9a468', '#a06a34', '#5f3a18'), '#2c170a', 2.6);
    c.beginPath(); c.moveTo(0, -66); c.bezierCurveTo(9.5, -58, 10.5, -49, 0, -41); c.bezierCurveTo(-10.5, -49, -9.5, -58, 0, -66); c.closePath();
    FS(c, lg(c, -9, -60, 9, -44, '#ffffff', '#c3ced9', '#6d7b8c'), '#1e262f', 2.8);
    c.beginPath(); LN(c, 0, -62, 0, -46); STK(c, 'rgba(30,38,47,0.45)', 1.3);
    c.beginPath(); RR(c, -5, -43, 10, 4.4, 1.6); FS(c, '#e8b53a', '#4d3105', 1.6);
    c.beginPath(); c.moveTo(0, 48); c.lineTo(2.6, 44); c.lineTo(-2.6, 44); c.closePath(); FS(c, '#8b96a3', '#1e262f', 1.6);
    c.restore();
  };
  spear(-37); spear(37);
  // helmet (front view)
  const dome = () => {
    c.moveTo(-25, 12); c.bezierCurveTo(-28, -14, -13, -25, 0, -25); c.bezierCurveTo(13, -25, 28, -14, 25, 12);
    c.lineTo(23, 30); c.bezierCurveTo(21, 39, 14, 43, 7, 43); c.lineTo(4, 35); c.lineTo(-4, 35); c.lineTo(-7, 43);
    c.bezierCurveTo(-14, 43, -21, 39, -23, 30); c.closePath();
  };
  // crest
  c.beginPath(); c.moveTo(-27, -12); c.bezierCurveTo(-30, -50, 30, -50, 27, -12); c.lineTo(20, -15); c.bezierCurveTo(21, -36, -21, -36, -20, -15); c.closePath();
  FS(c, lg(c, -20, -44, 20, -16, '#f26a52', '#c73027', '#7c1712'), '#3a0c0a', 3);
  c.beginPath(); dome(); FS(c, lg(c, -26, -25, 26, 43, '#ffe0a0', '#d6975a', '#8a5426', '#5f3a18'), '#2c170a', OUT - 0.2);
  c.beginPath(); c.moveTo(-18, 6); c.lineTo(18, 6); c.lineTo(18, 13); c.lineTo(3.8, 13); c.lineTo(3.8, 31); c.lineTo(-3.8, 31); c.lineTo(-3.8, 13); c.lineTo(-18, 13); c.closePath();
  FS(c, '#1b0f07', '#000000', 1.2);
  c.beginPath(); c.moveTo(-21, -9); c.bezierCurveTo(-15, -19, -6, -21, 0, -21); STK(c, 'rgba(255,255,255,0.65)', 2.2);
  c.beginPath(); LN(c, -20, 16, -18, 27); STK(c, 'rgba(255,255,255,0.4)', 2);
});

full('theology', (c) => {
  const cy = -2;
  // rays
  for (let i = 0; i < 16; i++) {
    const a = (i * TAU) / 16 - Math.PI / 2, ro = i % 2 ? 40 : 48, hw = i % 2 ? 0.13 : 0.15;
    c.beginPath(); P(c, [pol(28, a - hw).map((v, k) => v + (k ? cy : 0)), pol(ro, a).map((v, k) => v + (k ? cy : 0)), pol(28, a + hw).map((v, k) => v + (k ? cy : 0))]);
    FS(c, lg(c, 0, cy - ro, 0, cy + ro, '#ffe07a', '#f1a92c'), '#6a3d05', 1.8);
  }
  c.beginPath(); CIR(c, 0, cy, 30); FS(c, rg(c, -8, cy - 10, 2, 0, cy, 32, '#fffbd6', '#ffe58a', '#f2bd3e'), '#6a3d05', 3);
  c.beginPath(); CIR(c, 0, cy, 26); STK(c, 'rgba(160,100,10,0.4)', 1.4);
  // ankh
  const ank = () => { c.ellipse(0, -14, 11.5, 15, 0, 0, TAU); c.moveTo(0, 1); c.lineTo(0, 43); c.moveTo(-19.5, 11); c.lineTo(19.5, 11); };
  c.beginPath(); ank(); STK(c, '#08222c', 15); STK(c, lg(c, -20, -30, 20, 44, '#4fd0d6', '#1e8a9c', '#0e4a63'), 10.4);
  c.beginPath(); c.arc(0, -14, 11.5, 190 * DEG, 260 * DEG); STK(c, 'rgba(255,255,255,0.7)', 2);
  c.beginPath(); LN(c, -2.6, 16, -2.6, 40); STK(c, 'rgba(255,255,255,0.35)', 2);
  c.beginPath(); LN(c, -17, 9, -3, 9); STK(c, 'rgba(255,255,255,0.4)', 1.8);
});

full('urbanism', (c) => {
  const dk = '#3d2c1a';
  const win = (x, y, w = 3.6, h = 5.4) => { c.beginPath(); RR(c, x, y, w, h, 1.4); FILL(c, '#3b2a18'); };
  // house left
  c.beginPath(); RR(c, -46, 12, 17, 28, 1.5); FS(c, lg(c, -46, 12, -29, 40, '#f0d9a8', '#c9a56c'), dk, 2.4);
  c.beginPath(); P(c, [[-49, 13], [-37.5, 0], [-26, 13]]); FS(c, lg(c, -49, 0, -26, 13, '#e0805a', '#a4482a'), dk, 2.6);
  win(-42, 19); win(-36.5, 19); win(-42, 29); win(-36.5, 29);
  // house right
  c.beginPath(); RR(c, 29, 16, 17, 24, 1.5); FS(c, lg(c, 29, 16, 46, 40, '#f0d9a8', '#c9a56c'), dk, 2.4);
  c.beginPath(); P(c, [[26, 17], [37.5, 5], [49, 17]]); FS(c, lg(c, 26, 5, 49, 17, '#e0805a', '#a4482a'), dk, 2.6);
  win(33, 22); win(38.5, 22); win(33, 31); win(38.5, 31);
  // left tower with pyramid roof
  c.beginPath(); RR(c, -27, -6, 14, 46, 1.5); FS(c, lg(c, -27, -6, -13, 40, '#f7ecd2', '#d2bc8a'), dk, 2.4);
  c.beginPath(); P(c, [[-30, -6], [-20, -27], [-10, -6]]); FS(c, lg(c, -30, -27, -10, -6, '#4fb4b8', '#1f6f7c'), dk, 2.6);
  win(-22, 2); win(-22, 14); win(-22, 26, 3.6, 8);
  // right tower with small dome
  c.beginPath(); RR(c, 13, -2, 14, 42, 1.5); FS(c, lg(c, 13, -2, 27, 40, '#f7ecd2', '#d2bc8a'), dk, 2.4);
  c.beginPath(); c.arc(20, -2, 8.5, Math.PI, 0); c.closePath(); FS(c, lg(c, 12, -10, 28, -2, '#ffe58a', '#d9a02c'), dk, 2.6);
  win(18.2, 6); win(18.2, 17); win(18.2, 28, 3.6, 8);
  // central dome hall
  c.beginPath(); RR(c, -13, 12, 26, 28, 1.5); FS(c, lg(c, -13, 12, 13, 40, '#fbf1d8', '#d6c08f'), dk, 2.4);
  c.beginPath(); RR(c, -9, 3, 18, 10, 1.5); FS(c, lg(c, -9, 3, 9, 13, '#f1e1bb', '#c9b07a'), dk, 2.2);
  c.beginPath(); c.arc(0, 3, 12.5, Math.PI, 0); c.closePath();
  FS(c, rg(c, -4, -6, 1, 0, 3, 14, '#8fe0e0', '#3aa0a8', '#1a5f70'), dk, 2.8);
  c.beginPath(); LN(c, 0, -9, 0, -24); STK(c, dk, 5); STK(c, '#e8b53a', 2.2);
  c.beginPath(); CIR(c, 0, -26, 3.6); FS(c, '#f6cb45', dk, 1.8);
  c.beginPath(); ARCH(c, -4.5, 4.5, 24, 40); FILL(c, '#3b2a18');
  win(-10, 17, 3.2, 4.4); win(6.8, 17, 3.2, 4.4);
  // ground
  c.beginPath(); RR(c, -48, 39, 96, 7, 2.5); FS(c, lg(c, 0, 39, 0, 46, '#b39a6e', '#6c5630'), dk, 2.6);
});

/* ============================================================================================ */
/* EXTRAS                                                                                       */
/* ============================================================================================ */

full('cardstack', (c, o) => {
  const col = o.color || '#8b5a2b';
  const edge = darken(col, 0.68);
  const card = (cx, cy, rotDeg, tone) => {
    const base = tone ? darken(col, tone) : col;
    const w = 45, h = 63;
    c.save(); c.translate(cx, cy); c.rotate(rotDeg * DEG);
    c.beginPath(); RR(c, -w / 2, -h / 2, w, h, 6);
    FS(c, lg(c, -w / 2, -h / 2, w / 2, h / 2, lighten(base, 0.22), base, darken(base, 0.22)), null);
    c.save(); c.clip();
    c.beginPath(); c.rect(-w / 2, -h / 2, w, 17); FILL(c, lighten(base, 0.42));
    c.beginPath(); LN(c, -w / 2, -h / 2 + 17, w / 2, -h / 2 + 17); STK(c, alpha(darken(base, 0.6), 0.55), 1.6, 'butt');
    c.restore();
    c.beginPath(); RR(c, -w / 2 + 3.4, -h / 2 + 3.4, w - 6.8, h - 6.8, 3.4); STK(c, '#f0c65a', 1.8);
    c.beginPath(); RR(c, -w / 2, -h / 2, w, h, 6); STK(c, edge, 3.6);
    c.restore();
  };
  card(9, -3, 9, 0.28);
  card(-4, 2, -5, 0);
  // little emblem on the front card
  c.save(); c.translate(-4, 2); c.rotate(-5 * DEG);
  c.beginPath(); c.moveTo(0, 2); c.lineTo(7, 11); c.lineTo(0, 20); c.lineTo(-7, 11); c.closePath(); FS(c, alpha('#f6d970', 0.9), alpha(edge, 0.7), 1.2);
  c.restore();
});

full('pyramid', (c) => {
  const A = [2, -40], Lf = [-46, 22], F = [-2, 43], R = [46, 15];
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  c.beginPath(); ELL(c, 0, 44, 46, 5); FILL(c, 'rgba(0,0,0,0.22)');
  c.beginPath(); P(c, [A, Lf, F]); FS(c, lg(c, -46, -40, 0, 43, '#fff0a0', '#f1c94e', '#d9a53a'), null);
  c.beginPath(); P(c, [A, F, R]); FS(c, lg(c, 0, -40, 46, 43, '#d9a03a', '#a86f14', '#7d4c0a'), null);
  [0.22, 0.4, 0.58, 0.78].forEach((t, i) => {
    const a = lerp(A, Lf, t), b = lerp(A, F, t), d = lerp(A, R, t);
    c.beginPath(); LN(c, a[0], a[1], b[0], b[1]); LN(c, b[0], b[1], d[0], d[1]); STK(c, 'rgba(70,40,4,0.5)', 1.6);
  });
  c.beginPath(); LN(c, A[0], A[1], F[0], F[1]); STK(c, 'rgba(70,40,4,0.55)', 2);
  c.beginPath(); P(c, [A, Lf, F, R]); STK(c, '#4a2e06', OUT);
  c.beginPath(); LN(c, A[0] - 1, A[1] + 4, Lf[0] + 6, Lf[1] - 2); STK(c, 'rgba(255,255,255,0.65)', 2.2);
});

full('hourglass', (c) => {
  const dk = '#2c1c0a';
  const bulb = (flip) => {
    const s = flip ? -1 : 1;
    c.moveTo(-19, s * -37); c.bezierCurveTo(-19, s * -14, -3.2, s * -9, -3.2, 0); c.lineTo(3.2, 0); c.bezierCurveTo(3.2, s * -9, 19, s * -14, 19, s * -37); c.closePath();
  };
  // posts
  [-22.5, 22.5].forEach((x) => { c.beginPath(); RR(c, x - 2.8, -40, 5.6, 80, 2.8); FS(c, lg(c, x - 3, 0, x + 3, 0, '#f5c860', '#b47a1e'), dk, 2); });
  // glass
  c.beginPath(); bulb(false); bulb(true);
  FS(c, lg(c, -19, -37, 19, 37, 'rgba(235,252,255,0.96)', 'rgba(150,220,240,0.95)', 'rgba(86,170,205,0.95)'), null);
  // sand
  c.save(); c.beginPath(); bulb(false); c.clip();
  c.beginPath(); c.moveTo(-22, -20); c.quadraticCurveTo(0, -12, 22, -20); c.lineTo(22, 4); c.lineTo(-22, 4); c.closePath();
  FILL(c, lg(c, -18, -20, 18, 0, '#ffe58a', '#e8b53a', '#b57c1a'));
  c.restore();
  c.save(); c.beginPath(); bulb(true); c.clip();
  c.beginPath(); c.moveTo(-22, 40); c.lineTo(-22, 26); c.quadraticCurveTo(-8, 25, 0, 19); c.quadraticCurveTo(8, 25, 22, 26); c.lineTo(22, 40); c.closePath();
  FILL(c, lg(c, -18, 18, 18, 38, '#ffe58a', '#e8b53a', '#b57c1a'));
  c.restore();
  c.beginPath(); LN(c, 0, -3, 0, 22); STK(c, '#e8b53a', 1.8);
  c.beginPath(); bulb(false); bulb(true); STK(c, dk, OUT - 0.4);
  c.beginPath(); c.moveTo(-14.5, -33); c.bezierCurveTo(-14.5, -20, -9, -15, -7, -10); STK(c, 'rgba(255,255,255,0.85)', 2.4);
  c.beginPath(); c.moveTo(14.5, 33); c.bezierCurveTo(14.5, 24, 12, 22, 9, 19); STK(c, 'rgba(255,255,255,0.4)', 2);
  // plates
  [-46, 38].forEach((y) => { c.beginPath(); RR(c, -28, y, 56, 9, 3.4); FS(c, lg(c, 0, y, 0, y + 9, '#ffe58a', '#e0a83a', '#94610f'), '#3a2308', 2.8); });
});

full('star', (c) => {
  const ro = 45, ri = 20, cx = 0, cy = 2;
  const pts = starPts(5, ro, ri, cx, cy);
  const L = [-0.6, -0.8];
  c.beginPath(); RP(c, pts, 2.6);
  FS(c, '#e8b53a', null);
  c.save(); c.clip();
  for (let i = 0; i < 5; i++) {
    const tip = pts[i * 2], inL = pts[(i * 2 + 9) % 10], inR = pts[i * 2 + 1];
    [[inL, tip], [tip, inR]].forEach(([p, q]) => {
      const mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy, ml = Math.hypot(mx, my);
      const b = (mx / ml) * L[0] + (my / ml) * L[1];
      c.beginPath(); P(c, [[cx, cy], p, q]);
      FILL(c, b > 0 ? lighten('#f0bf42', 0.15 + b * 0.55) : darken('#e0a63a', -b * 0.5));
    });
  }
  c.restore();
  c.beginPath(); for (let i = 0; i < 10; i++) { c.moveTo(cx, cy); c.lineTo(pts[i][0], pts[i][1]); } STK(c, 'rgba(90,55,5,0.5)', 1.4);
  c.beginPath(); RP(c, pts, 2.6); STK(c, '#5a3a05', OUT + 0.2);
  c.beginPath(); LN(c, pts[0][0] - 1.5, pts[0][1] + 8, pts[9][0] + 3, pts[9][1] - 1.5); STK(c, 'rgba(255,255,255,0.6)', 1.8);
});

full('lock', (c) => {
  const arc = () => { c.moveTo(-15, -4); c.lineTo(-15, -20); c.arc(0, -20, 15, Math.PI, 0, false); c.lineTo(15, -4); };
  c.beginPath(); arc(); STK(c, '#1e262f', 14.5); STK(c, lg(c, -15, -36, 15, -4, '#f4f7fb', '#a9b6c4', '#66738a'), 9.6);
  c.beginPath(); c.arc(0, -20, 15, 190 * DEG, 250 * DEG); STK(c, 'rgba(255,255,255,0.85)', 2);
  c.beginPath(); RR(c, -28, -8, 56, 46, 9); FS(c, lg(c, -28, -8, 28, 38, '#ffe58a', '#e2a92e', '#94610f'), '#3a2308', OUT);
  c.beginPath(); RR(c, -24, -4.5, 48, 39, 6.5); STK(c, 'rgba(255,245,200,0.5)', 1.6);
  c.beginPath(); CIR(c, 0, 11, 6.2); c.moveTo(-3.6, 14); c.lineTo(-5.4, 28); c.lineTo(5.4, 28); c.lineTo(3.6, 14); c.closePath();
  FS(c, '#2a1808', '#000000', 1);
  c.beginPath(); LN(c, -22, 30, -22, 12); STK(c, 'rgba(255,255,255,0.35)', 2.2);
});

full('check', (c) => {
  const pth = () => { c.moveTo(-30, 3); c.lineTo(-10, 24); c.lineTo(31, -26); };
  c.beginPath(); pth(); STK(c, '#0f3d1c', 19); STK(c, lg(c, -30, -26, 31, 24, '#b6f59a', '#4fc25a', '#1f8a3a'), 13.4);
  c.beginPath(); c.moveTo(-27, 0.5); c.lineTo(-10, 18.5); c.lineTo(27, -25); STK(c, 'rgba(255,255,255,0.55)', 2.6);
});

full('cross', (c) => {
  const pth = () => { c.moveTo(-27, -27); c.lineTo(27, 27); c.moveTo(27, -27); c.lineTo(-27, 27); };
  c.beginPath(); pth(); STK(c, '#4a0d0b', 19); STK(c, lg(c, -27, -27, 27, 27, '#ff9a86', '#e0433a', '#a5231f'), 13.4);
  c.beginPath(); c.moveTo(-26, -20); c.lineTo(-8, -2); STK(c, 'rgba(255,255,255,0.5)', 2.4);
  c.beginPath(); c.moveTo(20, -26); c.lineTo(8, -14); STK(c, 'rgba(255,255,255,0.35)', 2.2);
});
