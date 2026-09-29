// Canvas drawing helpers shared by all procedural textures.
export const FONT_TITLE = "'Cinzel', 'Trajan Pro', Georgia, serif";
export const FONT_BODY = "'Cormorant Garamond', Georgia, serif";

export function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); return c; }

export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
export function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
export const lighten = (hex, t) => mix(hex, '#ffffff', t);
export const darken = (hex, t) => mix(hex, '#000000', t);
export function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

export function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function lin(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}
export function rad(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

export function fitText(ctx, text, maxW, size, weight = 700, family = FONT_TITLE, min = 12) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxW) break; s -= 1; } while (s > min);
  return s;
}

export function wrapText(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function noiseFill(ctx, x, y, w, h, amount, seed = 1, size = 1) {
  const r = rng(seed);
  for (let i = 0; i < (w * h) / 40; i++) {
    const v = r() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * amount})`;
    ctx.fillRect(x + r() * w, y + r() * h, size, size);
  }
}

export function star(ctx, cx, cy, r1, r2, n) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? r2 : r1;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

// Greek key (meander) band
export function meander(ctx, x, y, w, h, color, lw = 3) {
  const u = h / 3;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let px = x; px < x + w - u * 4; px += u * 4) {
    ctx.moveTo(px, y + h);
    ctx.lineTo(px, y);
    ctx.lineTo(px + u * 3, y);
    ctx.lineTo(px + u * 3, y + u * 2);
    ctx.lineTo(px + u, y + u * 2);
    ctx.lineTo(px + u, y + u);
    ctx.lineTo(px + u * 2, y + u);
    ctx.moveTo(px + u * 3, y + h);
    ctx.lineTo(px + u * 4, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

// smooth value noise (deterministic) for terrain-like shapes / wood grain
export function makeNoise(seed = 7) {
  const r = rng(seed);
  const N = 256, perm = new Uint8Array(N * 2), vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { vals[i] = r(); perm[i] = i; }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const f = t => t * t * (3 - 2 * t);
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = vals[perm[(xi & 255) + perm[yi & 255]]], b = vals[perm[((xi + 1) & 255) + perm[yi & 255]]];
    const c = vals[perm[(xi & 255) + perm[(yi + 1) & 255]]], d = vals[perm[((xi + 1) & 255) + perm[(yi + 1) & 255]]];
    const u = f(xf), v = f(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, fr = 1, t = 0; for (let i = 0; i < o; i++) { s += n2(x * fr, y * fr) * a; t += a; a *= 0.5; fr *= 2; } return s / t; };
  return { n2, fbm };
}
