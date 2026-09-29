// Procedural illustrations painted inside the picture frame of each card. Region is (0,0,w,h) in ctx space.
import { rng, hashStr, mix, lighten, darken, rgba, lin, rad, makeNoise } from './draw.js';

const SKY = {
  1: ['#4a7196', '#e9ae72', '#fbe0a8'],
  2: ['#2c6db3', '#86bde6', '#f7eccb'],
  3: ['#2b2058', '#b8466b', '#f6a95c'],
};

function sky(ctx, w, h, age, r, opts = {}) {
  const [a, b, c] = SKY[age] || SKY[1];
  ctx.fillStyle = lin(ctx, 0, 0, 0, h * 0.75, [[0, a], [0.6, b], [1, c]]);
  ctx.fillRect(0, 0, w, h);
  if (age === 3) { // stars
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(255,255,240,${0.3 + r() * 0.6})`; const s = r() * 1.8 + 0.4; ctx.fillRect(r() * w, r() * h * 0.45, s, s); }
  } else { // clouds
    for (let i = 0; i < 4; i++) {
      const x = r() * w, y = h * (0.08 + r() * 0.25), s = 40 + r() * 60;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.ellipse(x + k * s * 0.35, y + Math.sin(k) * 6, s * 0.5, s * 0.16, 0, 0, 7); ctx.fill(); }
    }
  }
  if (opts.sun !== false) {
    const sx = w * (0.2 + r() * 0.6), sy = h * (age === 3 ? 0.42 : 0.28 + r() * 0.1), sr = 26 + r() * 10;
    ctx.fillStyle = rad(ctx, sx, sy, 0, sr * 3.2, [[0, age === 3 ? 'rgba(255,180,120,0.9)' : 'rgba(255,245,200,0.95)'], [0.25, 'rgba(255,220,150,0.45)'], [1, 'rgba(255,200,120,0)']]);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = age === 3 ? '#ffd9a0' : '#fffbe6';
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
  }
}

function hills(ctx, w, baseY, amp, color, r, freq = 1, depth = 999) {
  const n = makeNoise(Math.floor(r() * 1e6));
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, baseY + depth);
  for (let x = 0; x <= w; x += 6) ctx.lineTo(x, baseY - n.fbm(x * 0.008 * freq, 3.1, 3) * amp);
  ctx.lineTo(w, baseY + depth); ctx.closePath(); ctx.fill();
}

function ground(ctx, w, y, h, c1, c2) { ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [[0, c1], [1, c2]]); ctx.fillRect(0, y, w, h); }

function pyramid(ctx, cx, baseY, pw, ph, col) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx - pw / 2, baseY); ctx.lineTo(cx, baseY - ph); ctx.lineTo(cx + pw / 2, baseY); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(cx, baseY - ph); ctx.lineTo(cx + pw / 2, baseY); ctx.lineTo(cx + 2, baseY); ctx.closePath(); ctx.fill();
}

function palm(ctx, x, y, s, col = '#1f3a22', trunk = '#3b2a1a') {
  ctx.strokeStyle = trunk; ctx.lineWidth = s * 0.07; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + s * 0.12, y - s * 0.5, x + s * 0.05, y - s); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = s * 0.05;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.95 + i * (Math.PI * 0.9 / 6);
    ctx.beginPath(); ctx.moveTo(x + s * 0.05, y - s);
    ctx.quadraticCurveTo(x + s * 0.05 + Math.cos(a) * s * 0.35, y - s + Math.sin(a) * s * 0.3 - s * 0.05, x + s * 0.05 + Math.cos(a) * s * 0.55, y - s + Math.sin(a) * s * 0.1 + s * 0.22);
    ctx.stroke();
  }
}

function tree(ctx, x, y, s, leaf = '#2c5a2e', trunk = '#4a3020') {
  ctx.fillStyle = trunk; ctx.fillRect(x - s * 0.05, y - s * 0.35, s * 0.1, s * 0.35);
  ctx.fillStyle = leaf;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x, y - s * (1 - i * 0.16)); ctx.lineTo(x + s * (0.24 + i * 0.09), y - s * (0.35 - i * 0.02 + 0.2 * (1 - i))); ctx.lineTo(x - s * (0.24 + i * 0.09), y - s * (0.35 - i * 0.02 + 0.2 * (1 - i))); ctx.closePath(); ctx.fill(); }
}

function column(ctx, x, y, cw, ch, col) {
  const g = lin(ctx, x - cw / 2, 0, x + cw / 2, 0, [[0, darken(col, 0.25)], [0.35, lighten(col, 0.35)], [0.7, col], [1, darken(col, 0.4)]]);
  ctx.fillStyle = g; ctx.fillRect(x - cw / 2, y, cw, ch);
  ctx.fillStyle = darken(col, 0.15);
  ctx.fillRect(x - cw * 0.68, y - ch * 0.05, cw * 1.36, ch * 0.05); // capital
  ctx.fillRect(x - cw * 0.68, y + ch, cw * 1.36, ch * 0.05);        // base
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x + i * cw * 0.25, y); ctx.lineTo(x + i * cw * 0.25, y + ch); ctx.stroke(); }
}

function pediment(ctx, cx, y, pw, ph, col) {
  ctx.fillStyle = lin(ctx, cx - pw / 2, y, cx + pw / 2, y, [[0, lighten(col, 0.3)], [1, darken(col, 0.2)]]);
  ctx.beginPath(); ctx.moveTo(cx - pw / 2, y + ph); ctx.lineTo(cx, y); ctx.lineTo(cx + pw / 2, y + ph); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.moveTo(cx - pw * 0.34, y + ph * 0.86); ctx.lineTo(cx, y + ph * 0.28); ctx.lineTo(cx + pw * 0.34, y + ph * 0.86); ctx.closePath(); ctx.fill();
}

function steps(ctx, cx, y, sw, n, col, sh = 12) {
  for (let i = 0; i < n; i++) { const w2 = sw + (n - i) * 0; ctx.fillStyle = mix(col, '#000', 0.05 * i); ctx.fillRect(cx - sw / 2 - i * 14, y + i * sh, sw + i * 28, sh); ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(cx - sw / 2 - i * 14, y + i * sh, sw + i * 28, 2); }
}

function facade(ctx, cx, baseY, fw, fh, n, col, opts = {}) {
  const ch = fh * 0.62, cw = Math.min(26, fw / (n * 2.2));
  const top = baseY - ch - 14 * (opts.steps ?? 3);
  ctx.fillStyle = darken(col, 0.35); ctx.fillRect(cx - fw * 0.42, top - 4, fw * 0.84, ch + 6); // inner wall
  ctx.fillStyle = rgba('#ffcf80', 0.5); ctx.fillRect(cx - fw * 0.36, top + 8, fw * 0.72, ch - 8); // lit interior
  for (let i = 0; i < n; i++) column(ctx, cx - fw * 0.4 + (fw * 0.8) * (i / (n - 1)), top, cw, ch, col);
  ctx.fillStyle = darken(col, 0.05); ctx.fillRect(cx - fw / 2, top - 22, fw, 20); // entablature
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(cx - fw / 2, top - 22, fw, 3);
  if (opts.dome) { ctx.fillStyle = lin(ctx, cx - fw * 0.3, 0, cx + fw * 0.3, 0, [[0, lighten(col, 0.4)], [1, darken(col, 0.3)]]); ctx.beginPath(); ctx.ellipse(cx, top - 22, fw * 0.3, fw * 0.28, 0, Math.PI, 0); ctx.fill(); }
  else pediment(ctx, cx, top - 22 - fh * 0.2, fw * 1.02, fh * 0.2, col);
  steps(ctx, cx, baseY - 14 * (opts.steps ?? 3), fw, opts.steps ?? 3, lighten(col, 0.1));
}

function arches(ctx, x0, baseY, aw, n, ah, col, tiers = 1) {
  for (let t = 0; t < tiers; t++) {
    const y = baseY - t * (ah + 8);
    ctx.fillStyle = col; ctx.fillRect(x0, y - ah - 8, aw * n, 8);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = 'rgba(20,10,30,0.75)';
      ctx.beginPath(); ctx.moveTo(x0 + i * aw + aw * 0.14, y); ctx.lineTo(x0 + i * aw + aw * 0.14, y - ah * 0.55); ctx.arc(x0 + i * aw + aw / 2, y - ah * 0.55, aw * 0.36, Math.PI, 0); ctx.lineTo(x0 + i * aw + aw * 0.86, y); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = mix(col, '#000', 0.2 * t); ctx.fillRect(x0, y, aw * n, 6);
  }
}

function crenels(ctx, x, y, w, h, col, n = 8) {
  ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
  const cw = w / (n * 2 - 1);
  for (let i = 0; i < n; i++) ctx.fillRect(x + i * cw * 2, y - h * 0.18, cw, h * 0.2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let yy = y + 8; yy < y + h; yy += 14) ctx.fillRect(x, yy, w, 1.4);
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, y, w, 3);
}

function tower(ctx, x, baseY, tw, th, col) {
  ctx.fillStyle = lin(ctx, x - tw / 2, 0, x + tw / 2, 0, [[0, lighten(col, 0.25)], [1, darken(col, 0.3)]]);
  ctx.fillRect(x - tw / 2, baseY - th, tw, th);
  crenels(ctx, x - tw / 2 - 5, baseY - th, tw + 10, 16, col, 4);
  ctx.fillStyle = '#1b1226'; ctx.fillRect(x - 5, baseY - th * 0.6, 10, 22);
}

function banner(ctx, x, y, s, col, alt = '#f2d27a') {
  ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = s * 0.06; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s * 1.9); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + s * 0.75, y + s * 0.08); ctx.lineTo(x + s * 0.6, y + s * 0.35); ctx.lineTo(x + s * 0.75, y + s * 0.65); ctx.lineTo(x + 2, y + s * 0.6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = alt; ctx.beginPath(); ctx.arc(x + s * 0.33, y + s * 0.33, s * 0.1, 0, 7); ctx.fill();
}

function hoplite(ctx, x, y, s, col = '#8a2b2b') {
  ctx.fillStyle = '#20141a'; ctx.fillRect(x - s * 0.08, y - s * 0.55, s * 0.16, s * 0.55); // body
  ctx.beginPath(); ctx.arc(x, y - s * 0.66, s * 0.11, 0, 7); ctx.fill(); // head
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - s * 0.12, y - s * 0.72); ctx.quadraticCurveTo(x, y - s * 0.95, x + s * 0.12, y - s * 0.72); ctx.fill(); // plume
  ctx.strokeStyle = '#20141a'; ctx.lineWidth = s * 0.03; ctx.beginPath(); ctx.moveTo(x + s * 0.22, y + s * 0.05); ctx.lineTo(x + s * 0.22, y - s * 1.0); ctx.stroke(); // spear
  ctx.fillStyle = mix(col, '#000', 0.2); ctx.beginPath(); ctx.arc(x - s * 0.06, y - s * 0.35, s * 0.2, 0, 7); ctx.fill();
  ctx.fillStyle = '#f0d070'; ctx.beginPath(); ctx.arc(x - s * 0.06, y - s * 0.35, s * 0.06, 0, 7); ctx.fill();
}

function horse(ctx, x, y, s) {
  ctx.fillStyle = '#20141a';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y); ctx.lineTo(x - s * 0.45, y - s * 0.45);
  ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.6, x + s * 0.25, y - s * 0.55);
  ctx.lineTo(x + s * 0.4, y - s * 0.95); ctx.lineTo(x + s * 0.6, y - s * 0.85); ctx.lineTo(x + s * 0.62, y - s * 0.7);
  ctx.lineTo(x + s * 0.4, y - s * 0.45); ctx.lineTo(x + s * 0.28, y); ctx.lineTo(x + s * 0.2, y); ctx.lineTo(x + s * 0.12, y - s * 0.3); ctx.lineTo(x - s * 0.2, y - s * 0.3); ctx.lineTo(x - s * 0.3, y); ctx.closePath(); ctx.fill();
}

function amphora(ctx, x, y, s, col = '#a4552a') {
  ctx.fillStyle = lin(ctx, x - s * 0.3, 0, x + s * 0.3, 0, [[0, lighten(col, 0.25)], [1, darken(col, 0.35)]]);
  ctx.beginPath(); ctx.moveTo(x - s * 0.12, y - s); ctx.lineTo(x + s * 0.12, y - s); ctx.quadraticCurveTo(x + s * 0.1, y - s * 0.85, x + s * 0.3, y - s * 0.6); ctx.quadraticCurveTo(x + s * 0.34, y - s * 0.2, x + s * 0.06, y); ctx.lineTo(x - s * 0.06, y); ctx.quadraticCurveTo(x - s * 0.34, y - s * 0.2, x - s * 0.3, y - s * 0.6); ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.85, x - s * 0.12, y - s); ctx.fill();
  ctx.strokeStyle = darken(col, 0.4); ctx.lineWidth = s * 0.03; ctx.beginPath(); ctx.moveTo(x - s * 0.28, y - s * 0.55); ctx.quadraticCurveTo(x, y - s * 0.45, x + s * 0.28, y - s * 0.55); ctx.stroke();
}

function crate(ctx, x, y, s, col = '#7a5230') {
  ctx.fillStyle = col; ctx.fillRect(x, y - s, s, s);
  ctx.strokeStyle = darken(col, 0.4); ctx.lineWidth = 2; ctx.strokeRect(x + 1, y - s + 1, s - 2, s - 2);
  ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.moveTo(x + s, y - s); ctx.lineTo(x, y); ctx.stroke();
}

function awning(ctx, x, y, w, h, c1, c2, n = 7) {
  const sw = w / n;
  for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? c1 : c2; ctx.beginPath(); ctx.moveTo(x + i * sw, y); ctx.lineTo(x + (i + 1) * sw, y); ctx.lineTo(x + (i + 1) * sw + 3, y + h); ctx.arc(x + (i + 0.5) * sw, y + h, sw / 2 + 1.5, 0, Math.PI); ctx.lineTo(x + i * sw - 3, y + h); ctx.closePath(); ctx.fill(); }
}

function sail(ctx, x, y, s, col) {
  ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x - 2, y - s, 4, s);
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + 4, y - s * 0.95); ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.6, x + 4, y - s * 0.15); ctx.closePath(); ctx.fill();
}

function ship(ctx, x, y, s, col) {
  ctx.fillStyle = '#4a2e1a'; ctx.beginPath(); ctx.moveTo(x - s * 0.55, y - s * 0.15); ctx.lineTo(x + s * 0.55, y - s * 0.15); ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.1, x, y + s * 0.1); ctx.quadraticCurveTo(x - s * 0.4, y + s * 0.1, x - s * 0.55, y - s * 0.15); ctx.fill();
  sail(ctx, x, y - s * 0.15, s * 0.9, col);
}

function water(ctx, w, y, h, c1, c2, r) {
  ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [[0, c1], [1, c2]]); ctx.fillRect(0, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 18; i++) { const x = r() * w, yy = y + 6 + r() * (h - 8), l = 14 + r() * 26; ctx.beginPath(); ctx.moveTo(x, yy); ctx.quadraticCurveTo(x + l / 2, yy - 3, x + l, yy); ctx.stroke(); }
}

function glow(ctx, x, y, r0, col = '255,190,90', a = 0.8) {
  ctx.fillStyle = rad(ctx, x, y, 0, r0, [[0, `rgba(${col},${a})`], [1, `rgba(${col},0)`]]);
  ctx.fillRect(x - r0, y - r0, r0 * 2, r0 * 2);
}

function logs(ctx, x, y, s) {
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
    const cx = x + (i + row * 0.5) * s * 0.42, cy = y - row * s * 0.36 - s * 0.2;
    ctx.fillStyle = '#5b3a1e'; ctx.fillRect(cx - s * 1.0, cy - s * 0.18, s * 1.0, s * 0.36);
    ctx.fillStyle = '#c99a5b'; ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.14, s * 0.18, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 1.2;
    for (let k = 1; k < 3; k++) { ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.14 * k / 3, s * 0.18 * k / 3, 0, 0, 7); ctx.stroke(); }
  }
}

function bricks(ctx, x, y, s, rows = 4) {
  for (let r = 0; r < rows; r++) for (let i = 0; i < rows - r + 1; i++) {
    const bx = x + i * s * 0.62 + r * s * 0.31, by = y - (r + 1) * s * 0.26;
    ctx.fillStyle = r % 2 ? '#b8552e' : '#c9663a'; ctx.fillRect(bx, by, s * 0.58, s * 0.24);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(bx, by, s * 0.58, 2);
  }
}

function blocks(ctx, x, y, s, col = '#9aa0a8') {
  const rr2 = rng(Math.floor(x * 13 + y));
  for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) {
    const bx = x + i * s * 0.9 + r * s * 0.45, by = y - (r + 1) * s * 0.55, c = mix(col, '#000', rr2() * 0.2);
    ctx.fillStyle = c; ctx.fillRect(bx, by, s * 0.86, s * 0.52);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(bx, by, s * 0.86, 3); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(bx + s * 0.6, by, s * 0.26, s * 0.52);
  }
}

// -------------------------------------------------------------------- category painters
function brown(ctx, def, w, h, r) {
  const res = Object.keys(def.fx.produce)[0];
  sky(ctx, w, h, def.age, r);
  if (res === 'wood') {
    hills(ctx, w, h * 0.55, 60, '#3b5a3c', r, 1.2); hills(ctx, w, h * 0.65, 50, '#274a2c', r, 1.6);
    for (let i = 0; i < 16; i++) tree(ctx, r() * w, h * (0.55 + r() * 0.15), 90 + r() * 90, mix('#1c4426', '#3a6b30', r()));
    ground(ctx, w, h * 0.72, h * 0.28, '#4a3a22', '#2a2014');
    logs(ctx, w * 0.12 + r() * 40, h * 0.9, 90); if (def.fx.produce.wood > 1 || def.age > 1) logs(ctx, w * 0.5, h * 0.94, 96);
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(w * 0.78, h * 0.95); ctx.lineTo(w * 0.86, h * 0.72); ctx.stroke(); ctx.fillStyle = '#b8c0c8'; ctx.beginPath(); ctx.moveTo(w * 0.86, h * 0.72); ctx.lineTo(w * 0.93, h * 0.76); ctx.lineTo(w * 0.85, h * 0.8); ctx.fill();
  } else if (res === 'clay') {
    hills(ctx, w, h * 0.5, 40, '#8b5a3a', r, 1); hills(ctx, w, h * 0.62, 30, '#b06a40', r, 2);
    ground(ctx, w, h * 0.66, h * 0.34, '#c9764a', '#7b3f24');
    water(ctx, w * 0.7, h * 0.78, h * 0.12, '#7fb0c0', '#3f7c90', r);
    bricks(ctx, w * 0.06, h * 0.96, 110, 4); bricks(ctx, w * 0.62, h * 0.97, 100, 3);
    amphora(ctx, w * 0.47, h * 0.9, 90, '#c9663a'); palm(ctx, w * 0.9, h * 0.8, 130);
  } else {
    hills(ctx, w, h * 0.5, 30, '#7a7f88', r, 0.8);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = mix('#8d939c', '#3a3f48', i / 4); ctx.beginPath(); ctx.moveTo(w * (0.05 + i * 0.05), h * (0.45 + i * 0.08)); ctx.lineTo(w * (0.55 - i * 0.02), h * (0.45 + i * 0.08)); ctx.lineTo(w * (0.62 - i * 0.02), h * (0.53 + i * 0.08)); ctx.lineTo(w * (0.02 + i * 0.05), h * (0.53 + i * 0.08)); ctx.fill(); }
    ground(ctx, w, h * 0.7, h * 0.3, '#8a7b64', '#4b4032');
    blocks(ctx, w * 0.12, h * 0.94, 120); blocks(ctx, w * 0.55, h * 0.96, 100, '#b1a894');
    ctx.strokeStyle = '#4a3020'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(w * 0.85, h * 0.95); ctx.lineTo(w * 0.85, h * 0.5); ctx.lineTo(w * 0.68, h * 0.45); ctx.stroke(); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w * 0.68, h * 0.45); ctx.lineTo(w * 0.68, h * 0.62); ctx.stroke();
  }
  if (def.cost.coins) glow(ctx, w * 0.5, h * 0.3, 120, '255,220,120', 0.15);
}

function grey(ctx, def, w, h, r) {
  const res = Object.keys(def.fx.produce)[0];
  if (res === 'glass') {
    ctx.fillStyle = lin(ctx, 0, 0, 0, h, [[0, '#1a1220'], [1, '#4a2a1a']]); ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.5, h * 0.62, 260, '255,150,50', 0.9);
    ctx.fillStyle = '#2b1c14'; ctx.beginPath(); ctx.moveTo(w * 0.22, h); ctx.lineTo(w * 0.28, h * 0.42); ctx.quadraticCurveTo(w * 0.5, h * 0.2, w * 0.72, h * 0.42); ctx.lineTo(w * 0.78, h); ctx.fill();
    ctx.fillStyle = '#ffb04a'; ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.66, w * 0.14, h * 0.16, 0, Math.PI, 0); ctx.fill();
    glow(ctx, w * 0.5, h * 0.66, 100, '255,230,150', 0.9);
    for (let i = 0; i < 5; i++) { const x = w * (0.1 + i * 0.19), s = 60 + r() * 50; ctx.fillStyle = rgba('#7fe6e0', 0.75); ctx.beginPath(); ctx.moveTo(x - s * 0.07, h * 0.9 - s); ctx.lineTo(x + s * 0.07, h * 0.9 - s); ctx.lineTo(x + s * 0.07, h * 0.9 - s * 0.7); ctx.quadraticCurveTo(x + s * 0.35, h * 0.9 - s * 0.55, x + s * 0.3, h * 0.9 - s * 0.2); ctx.quadraticCurveTo(x, h * 0.9 + s * 0.05, x - s * 0.3, h * 0.9 - s * 0.2); ctx.quadraticCurveTo(x - s * 0.35, h * 0.9 - s * 0.55, x - s * 0.07, h * 0.9 - s * 0.7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(x - s * 0.15, h * 0.9 - s * 0.6, s * 0.06, s * 0.3); }
  } else {
    sky(ctx, w, h, def.age, r);
    hills(ctx, w, h * 0.58, 20, '#c9a86a', r, 1); water(ctx, w, h * 0.6, h * 0.4, '#5fa0a8', '#2f6070', r);
    for (let i = 0; i < 26; i++) { const x = r() * w, y = h * (0.56 + r() * 0.1); ctx.strokeStyle = mix('#5d7a2a', '#2d4a1a', r()); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + 30); ctx.quadraticCurveTo(x + (r() - 0.5) * 20, y, x + (r() - 0.5) * 34, y - 50 - r() * 60); ctx.stroke(); }
    for (let i = 0; i < 3; i++) { const x = w * (0.18 + i * 0.27), y = h * (0.86 - (i % 2) * 0.05); ctx.fillStyle = '#efe0b0'; ctx.fillRect(x - 46, y - 22, 92, 44); ctx.fillStyle = '#c9b070'; ctx.beginPath(); ctx.ellipse(x - 46, y, 9, 22, 0, 0, 7); ctx.ellipse(x + 46, y, 9, 22, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 2; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x - 30 + k * 18, y - 10); ctx.lineTo(x - 20 + k * 18, y + 10); ctx.stroke(); } }
  }
}

function blue(ctx, def, w, h, r) {
  const id = def.id, col = '#dfd3b8';
  sky(ctx, w, h, def.age, r);
  hills(ctx, w, h * 0.66, 30, rgba('#2b3a5a', 0.6), r, 1);
  ground(ctx, w, h * 0.86, h * 0.14, '#b7a17a', '#7a6848');
  if (id === 'altar') {
    steps(ctx, w * 0.5, h * 0.7, 190, 4, '#cdbf9f');
    ctx.fillStyle = '#b9ab8a'; ctx.fillRect(w * 0.41, h * 0.48, w * 0.18, h * 0.22);
    ctx.fillStyle = '#6a3a1a'; ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.48, w * 0.12, 12, 0, 0, 7); ctx.fill();
    glow(ctx, w * 0.5, h * 0.4, 130, '255,170,60', 0.95);
    ctx.fillStyle = '#ff9a2e'; ctx.beginPath(); ctx.moveTo(w * 0.44, h * 0.47); ctx.quadraticCurveTo(w * 0.42, h * 0.32, w * 0.5, h * 0.2); ctx.quadraticCurveTo(w * 0.58, h * 0.32, w * 0.56, h * 0.47); ctx.fill();
    ctx.fillStyle = '#ffe07a'; ctx.beginPath(); ctx.moveTo(w * 0.47, h * 0.47); ctx.quadraticCurveTo(w * 0.46, h * 0.36, w * 0.5, h * 0.3); ctx.quadraticCurveTo(w * 0.54, h * 0.36, w * 0.53, h * 0.47); ctx.fill();
    column(ctx, w * 0.16, h * 0.45, 30, h * 0.4, col); column(ctx, w * 0.84, h * 0.45, 30, h * 0.4, col);
  } else if (id === 'theater') {
    ctx.fillStyle = '#c9b78e'; ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.86, w * 0.5, h * 0.42, 0, Math.PI, 0); ctx.fill();
    for (let i = 1; i < 7; i++) { ctx.strokeStyle = rgba('#5d4c30', 0.5); ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.86, w * (0.5 - i * 0.06), h * (0.42 - i * 0.05), 0, Math.PI, 0); ctx.stroke(); }
    ctx.fillStyle = '#8f7a55'; ctx.fillRect(w * 0.22, h * 0.78, w * 0.56, h * 0.08);
    for (let i = 0; i < 5; i++) column(ctx, w * (0.26 + i * 0.12), h * 0.5, 16, h * 0.28, col);
    ctx.fillStyle = '#f5e6c0'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.32, 40, 0, 7); ctx.fill(); ctx.fillStyle = '#20141a'; ctx.beginPath(); ctx.ellipse(w * 0.5 - 15, h * 0.3, 8, 5, 0, 0, 7); ctx.ellipse(w * 0.5 + 15, h * 0.3, 8, 5, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(w * 0.5, h * 0.38, 16, 0, Math.PI); ctx.fill();
  } else if (id === 'baths') {
    water(ctx, w, h * 0.66, h * 0.24, '#7fd6e6', '#2f9ab0', r);
    facade(ctx, w * 0.5, h * 0.66, w * 0.86, h * 0.6, 6, col, { steps: 0, dome: false });
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(0, h * 0.66, w, 5);
  } else if (id === 'aqueduct') {
    arches(ctx, w * 0.03, h * 0.86, w * 0.16, 6, h * 0.24, '#c9b78e', 2);
    water(ctx, w, h * 0.32, 20, '#7fd6e6', '#5fb6d0', r);
  } else if (id === 'statue') {
    ctx.fillStyle = '#c4b590'; ctx.fillRect(w * 0.34, h * 0.68, w * 0.32, h * 0.18); steps(ctx, w * 0.5, h * 0.62, 150, 2, '#cdbf9f');
    const sx = w * 0.5, sy = h * 0.66;
    ctx.fillStyle = lin(ctx, sx - 40, 0, sx + 40, 0, [[0, '#f2ead4'], [1, '#a9a08a']]);
    ctx.beginPath(); ctx.moveTo(sx - 34, sy); ctx.lineTo(sx - 26, sy - 130); ctx.lineTo(sx + 26, sy - 130); ctx.lineTo(sx + 34, sy); ctx.fill();
    ctx.beginPath(); ctx.arc(sx, sy - 158, 22, 0, 7); ctx.fill(); ctx.fillRect(sx - 10, sy - 140, 20, 14);
    ctx.beginPath(); ctx.moveTo(sx + 24, sy - 120); ctx.lineTo(sx + 80, sy - 190); ctx.lineTo(sx + 90, sy - 180); ctx.lineTo(sx + 32, sy - 108); ctx.fill();
    glow(ctx, sx + 84, sy - 190, 50, '255,240,180', 0.8);
  } else if (id === 'obelisk') {
    ctx.fillStyle = lin(ctx, w * 0.42, 0, w * 0.58, 0, [[0, '#e6c88a'], [1, '#8a6a3a']]);
    ctx.beginPath(); ctx.moveTo(w * 0.44, h * 0.86); ctx.lineTo(w * 0.47, h * 0.2); ctx.lineTo(w * 0.5, h * 0.1); ctx.lineTo(w * 0.53, h * 0.2); ctx.lineTo(w * 0.56, h * 0.86); ctx.fill();
    ctx.fillStyle = '#f0d070'; ctx.beginPath(); ctx.moveTo(w * 0.47, h * 0.2); ctx.lineTo(w * 0.5, h * 0.1); ctx.lineTo(w * 0.53, h * 0.2); ctx.fill();
    ctx.strokeStyle = 'rgba(80,50,20,0.55)'; ctx.lineWidth = 3; for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(w * 0.48, h * (0.28 + i * 0.06)); ctx.lineTo(w * 0.52, h * (0.28 + i * 0.06)); ctx.stroke(); }
    palm(ctx, w * 0.14, h * 0.86, 140); palm(ctx, w * 0.88, h * 0.86, 120);
  } else if (id === 'gardens') {
    for (let t = 0; t < 4; t++) { const y = h * (0.86 - t * 0.17), ww = w * (0.9 - t * 0.17); ctx.fillStyle = '#c9b78e'; ctx.fillRect(w * 0.5 - ww / 2, y - h * 0.14, ww, h * 0.15); ctx.fillStyle = '#3f8a3a'; ctx.fillRect(w * 0.5 - ww / 2, y - h * 0.16, ww, h * 0.035); for (let i = 0; i < 9; i++) { ctx.fillStyle = mix('#2f7a34', '#7ac04a', r()); ctx.beginPath(); ctx.arc(w * 0.5 - ww / 2 + r() * ww, y - h * 0.17, 12 + r() * 10, 0, 7); ctx.fill(); } ctx.strokeStyle = '#3f8a3a'; ctx.lineWidth = 3; for (let i = 0; i < 8; i++) { const x = w * 0.5 - ww / 2 + r() * ww; ctx.beginPath(); ctx.moveTo(x, y - h * 0.14); ctx.lineTo(x + (r() - 0.5) * 8, y - h * 0.14 + 20 + r() * 26); ctx.stroke(); } }
    palm(ctx, w * 0.5, h * 0.3, 90);
  } else if (id === 'rostrum') {
    ctx.fillStyle = '#b9a67c'; ctx.fillRect(w * 0.18, h * 0.6, w * 0.64, h * 0.26); steps(ctx, w * 0.5, h * 0.78, 300, 3, '#cdbf9f');
    for (let i = 0; i < 4; i++) { ctx.fillStyle = '#7a5230'; ctx.beginPath(); ctx.moveTo(w * (0.24 + i * 0.16), h * 0.68); ctx.lineTo(w * (0.3 + i * 0.16), h * 0.64); ctx.lineTo(w * (0.3 + i * 0.16), h * 0.72); ctx.fill(); }
    hoplite(ctx, w * 0.5, h * 0.6, 150, '#2f6db5');
  } else {
    const big = ['palace', 'town_hall', 'pantheon', 'senate'].includes(id);
    facade(ctx, w * 0.5, h * 0.9, w * (big ? 0.92 : 0.8), h * (big ? 0.78 : 0.7), big ? 8 : 6, col, { dome: id === 'pantheon' || id === 'palace', steps: 3 });
    if (id === 'town_hall') { tower(ctx, w * 0.5, h * 0.3, 50, 120, col); }
  }
  // soft vignette for depth
  ctx.fillStyle = rad(ctx, w / 2, h / 2, h * 0.3, h * 0.75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(10,6,20,0.45)']]); ctx.fillRect(0, 0, w, h);
}

function green(ctx, def, w, h, r, glyphFn) {
  ctx.fillStyle = lin(ctx, 0, 0, 0, h, [[0, '#2a1d12'], [1, '#5a3d22']]); ctx.fillRect(0, 0, w, h);
  // arched window w/ night sky
  ctx.fillStyle = lin(ctx, 0, h * 0.05, 0, h * 0.6, [[0, '#151a44'], [1, '#e9945a']]);
  ctx.beginPath(); ctx.moveTo(w * 0.28, h * 0.62); ctx.lineTo(w * 0.28, h * 0.34); ctx.arc(w * 0.5, h * 0.34, w * 0.22, Math.PI, 0); ctx.lineTo(w * 0.72, h * 0.62); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 26; i++) { ctx.fillStyle = `rgba(255,255,230,${0.3 + r() * 0.6})`; ctx.fillRect(w * (0.3 + r() * 0.4), h * (0.14 + r() * 0.4), 2, 2); }
  ctx.strokeStyle = '#c9a050'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(w * 0.28, h * 0.62); ctx.lineTo(w * 0.28, h * 0.34); ctx.arc(w * 0.5, h * 0.34, w * 0.22, Math.PI, 0); ctx.lineTo(w * 0.72, h * 0.62); ctx.stroke();
  // shelves with scrolls
  for (let s = 0; s < 2; s++) {
    for (const side of [0.02, 0.76]) {
      const x0 = w * side, y0 = h * (0.26 + s * 0.3);
      ctx.fillStyle = '#3b2612'; ctx.fillRect(x0, y0 + h * 0.2, w * 0.22, 8);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = mix('#e8d9a8', '#b89a5a', r()); ctx.fillRect(x0 + i * w * 0.055, y0 + h * 0.05, w * 0.045, h * 0.15); ctx.fillStyle = '#7a4a2a'; ctx.fillRect(x0 + i * w * 0.055, y0 + h * 0.05, w * 0.045, 5); }
    }
  }
  // table & glowing symbol
  ctx.fillStyle = '#3a2410'; ctx.fillRect(0, h * 0.78, w, h * 0.22);
  ctx.fillStyle = '#5a3b1a'; ctx.fillRect(0, h * 0.78, w, 8);
  glow(ctx, w * 0.5, h * 0.46, 200, '255,210,120', 0.35);
  if (glyphFn) glyphFn(ctx, w * 0.5, h * 0.44, Math.min(w, h) * 0.5);
  // candle
  ctx.fillStyle = '#efe4c8'; ctx.fillRect(w * 0.86, h * 0.68, 14, 50); glow(ctx, w * 0.865, h * 0.66, 70, '255,190,90', 0.9);
  ctx.fillStyle = '#ffd36a'; ctx.beginPath(); ctx.ellipse(w * 0.865 + 0, h * 0.66, 5, 12, 0, 0, 7); ctx.fill();
  ctx.fillStyle = rad(ctx, w / 2, h / 2, h * 0.3, h * 0.75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(10,6,4,0.5)']]); ctx.fillRect(0, 0, w, h);
}

function yellow(ctx, def, w, h, r) {
  const id = def.id;
  sky(ctx, w, h, def.age, r);
  ground(ctx, w, h * 0.78, h * 0.22, '#c9a86a', '#7a5f38');
  if (id === 'lighthouse') {
    water(ctx, w, h * 0.7, h * 0.3, '#3a7a9a', '#1a3a5a', r);
    ctx.fillStyle = lin(ctx, w * 0.4, 0, w * 0.6, 0, [[0, '#f2ead4'], [1, '#a59c84']]);
    ctx.beginPath(); ctx.moveTo(w * 0.4, h * 0.85); ctx.lineTo(w * 0.45, h * 0.3); ctx.lineTo(w * 0.55, h * 0.3); ctx.lineTo(w * 0.6, h * 0.85); ctx.fill();
    ctx.fillStyle = '#c0392b'; ctx.fillRect(w * 0.435, h * 0.45, w * 0.13, 16); ctx.fillRect(w * 0.425, h * 0.62, w * 0.15, 16);
    glow(ctx, w * 0.5, h * 0.26, 200, '255,230,140', 1); ctx.fillStyle = '#fff2a8'; ctx.fillRect(w * 0.46, h * 0.22, w * 0.08, 20);
    ctx.fillStyle = 'rgba(255,240,170,0.28)'; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.26); ctx.lineTo(w, h * 0.12); ctx.lineTo(w, h * 0.4); ctx.fill();
  } else if (id === 'customs_house' || id === 'port') {
    water(ctx, w, h * 0.62, h * 0.24, '#4a94b0', '#20506a', r);
    ship(ctx, w * 0.28, h * 0.7, 150, '#f4e9c8'); ship(ctx, w * 0.7, h * 0.66, 120, '#c0392b');
    ground(ctx, w, h * 0.84, h * 0.16, '#8a7350', '#4a3d28');
    for (let i = 0; i < 5; i++) crate(ctx, w * (0.08 + i * 0.16), h * 0.96, 40 + r() * 26);
  } else if (id === 'arena') {
    arches(ctx, w * 0.02, h * 0.85, w * 0.14, 7, h * 0.22, '#d9c294', 3);
  } else if (id === 'tavern' || id === 'brewery') {
    ctx.fillStyle = lin(ctx, 0, 0, 0, h, [[0, '#2a1810'], [1, '#5a3418']]); ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.5, h * 0.35, 260, '255,170,70', 0.5);
    for (let i = 0; i < 3; i++) { const x = w * (0.14 + i * 0.3); ctx.fillStyle = lin(ctx, x - 50, 0, x + 50, 0, [[0, '#8a5a2a'], [0.5, '#c08a4a'], [1, '#5a3418']]); ctx.beginPath(); ctx.ellipse(x, h * 0.78, 56, 16, 0, 0, 7); ctx.fillRect(x - 56, h * 0.5, 112, h * 0.28); ctx.ellipse(x, h * 0.5, 56, 16, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#d9b070'; ctx.lineWidth = 6; for (const yy of [0.56, 0.72]) { ctx.beginPath(); ctx.moveTo(x - 56, h * yy); ctx.lineTo(x + 56, h * yy); ctx.stroke(); } }
    ctx.fillStyle = '#efe4c8'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.24, 30, 0, 7); ctx.fill();
  } else if (id === 'caravansery') {
    hills(ctx, w, h * 0.6, 30, '#c9a05a', r); ground(ctx, w, h * 0.7, h * 0.3, '#d7b070', '#8a6a3a');
    for (let i = 0; i < 2; i++) { const x = w * (0.28 + i * 0.4), y = h * 0.86, s = 150; ctx.fillStyle = '#3a2418'; ctx.beginPath(); ctx.ellipse(x, y - s * 0.4, s * 0.38, s * 0.16, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x - s * 0.1, y - s * 0.62, s * 0.11, 0, 7); ctx.arc(x + s * 0.12, y - s * 0.66, s * 0.1, 0, 7); ctx.fill(); ctx.fillRect(x - s * 0.3, y - s * 0.4, s * 0.04, s * 0.4); ctx.fillRect(x + s * 0.26, y - s * 0.4, s * 0.04, s * 0.4); ctx.fillRect(x - s * 0.12, y - s * 0.4, s * 0.04, s * 0.4); ctx.fillRect(x + s * 0.14, y - s * 0.4, s * 0.04, s * 0.4); ctx.fillRect(x + s * 0.24, y - s * 0.95, s * 0.05, s * 0.36); ctx.fillStyle = '#c0392b'; ctx.fillRect(x - s * 0.18, y - s * 0.62, s * 0.36, s * 0.14); }
    pyramid(ctx, w * 0.85, h * 0.7, 140, 90, '#b0864a');
  } else if (id.endsWith('_reserve')) {
    awning(ctx, w * 0.06, h * 0.22, w * 0.88, 60, '#c0392b', '#f2e6c8', 9);
    ctx.fillStyle = '#3a2410'; ctx.fillRect(w * 0.06, h * 0.22, 8, h * 0.6); ctx.fillRect(w * 0.94 - 8, h * 0.22, 8, h * 0.6);
    ctx.fillStyle = '#7a5230'; ctx.fillRect(w * 0.04, h * 0.66, w * 0.92, h * 0.1);
    for (let i = 0; i < 4; i++) { if (id.startsWith('wood')) logs(ctx, w * (0.1 + i * 0.22), h * 0.66, 50); else if (id.startsWith('clay')) bricks(ctx, w * (0.1 + i * 0.22), h * 0.66, 60, 2); else blocks(ctx, w * (0.1 + i * 0.22), h * 0.66, 50); }
    for (let i = 0; i < 6; i++) { ctx.fillStyle = '#f0c040'; ctx.beginPath(); ctx.ellipse(w * (0.15 + i * 0.14), h * 0.82, 16, 5, 0, 0, 7); ctx.fill(); }
  } else {
    awning(ctx, w * 0.04, h * 0.18, w * 0.92, 66, '#2f8a9a', '#f2e6c8', 10); // forum / market
    for (let i = 0; i < 4; i++) column(ctx, w * (0.14 + i * 0.24), h * 0.34, 22, h * 0.44, '#e6d9b8');
    amphora(ctx, w * 0.3, h * 0.9, 100); amphora(ctx, w * 0.68, h * 0.9, 90, '#7a3a2a'); crate(ctx, w * 0.44, h * 0.9, 60);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = '#ffd95a'; ctx.beginPath(); ctx.arc(w * (0.1 + r() * 0.8), h * (0.7 + r() * 0.2), 5, 0, 7); ctx.fill(); }
  }
  ctx.fillStyle = rad(ctx, w / 2, h / 2, h * 0.3, h * 0.75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(20,10,0,0.4)']]); ctx.fillRect(0, 0, w, h);
}

function red(ctx, def, w, h, r) {
  const id = def.id;
  sky(ctx, w, h, def.age === 1 ? 3 : def.age, r, { sun: false });
  ctx.fillStyle = 'rgba(30,10,10,0.25)'; ctx.fillRect(0, 0, w, h);
  hills(ctx, w, h * 0.6, 40, '#2a1a22', r, 1.2);
  ground(ctx, w, h * 0.8, h * 0.2, '#4a3226', '#1e130e');
  if (id === 'stable' || id === 'horse_breeders') {
    ctx.fillStyle = '#4a2a18'; ctx.fillRect(w * 0.08, h * 0.4, w * 0.84, h * 0.4); ctx.fillStyle = '#2a170d'; ctx.beginPath(); ctx.moveTo(w * 0.04, h * 0.4); ctx.lineTo(w * 0.5, h * 0.2); ctx.lineTo(w * 0.96, h * 0.4); ctx.fill();
    for (let i = 0; i < 2; i++) { ctx.fillStyle = '#e6c890'; ctx.fillRect(w * (0.14 + i * 0.4), h * 0.5, w * 0.3, h * 0.3); horse(ctx, w * (0.29 + i * 0.4), h * 0.8, 150); }
  } else if (id === 'palisade') {
    for (let i = 0; i < 12; i++) { const x = w * (0.03 + i * 0.08), hh = h * (0.4 + r() * 0.08); ctx.fillStyle = mix('#6b4a2a', '#3a2510', r()); ctx.beginPath(); ctx.moveTo(x, h * 0.86); ctx.lineTo(x, h * 0.86 - hh); ctx.lineTo(x + w * 0.04, h * 0.86 - hh - 30); ctx.lineTo(x + w * 0.08, h * 0.86 - hh); ctx.lineTo(x + w * 0.08, h * 0.86); ctx.fill(); }
    banner(ctx, w * 0.5, h * 0.12, 90, '#b83030');
  } else if (id === 'archery_range') {
    for (let i = 0; i < 3; i++) { const x = w * (0.2 + i * 0.3), y = h * 0.62; ctx.fillStyle = '#e6d8b0'; ctx.beginPath(); ctx.arc(x, y, 58 - i * 6, 0, 7); ctx.fill(); ['#b83030', '#f2e6c8', '#b83030', '#f2e6c8'].forEach((c, k) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, (58 - i * 6) * (1 - k * 0.24), 0, 7); ctx.fill(); }); ctx.strokeStyle = '#4a2e1a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x, y + 60); ctx.lineTo(x, h * 0.9); ctx.stroke(); ctx.strokeStyle = '#20141a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 90, y - 14 + i * 10); ctx.lineTo(x + 2, y); ctx.stroke(); }
  } else if (id === 'siege_workshop') {
    ctx.strokeStyle = '#4a2e1a'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(w * 0.25, h * 0.86); ctx.lineTo(w * 0.35, h * 0.5); ctx.lineTo(w * 0.62, h * 0.5); ctx.lineTo(w * 0.72, h * 0.86); ctx.moveTo(w * 0.35, h * 0.5); ctx.lineTo(w * 0.7, h * 0.22); ctx.stroke(); ctx.fillStyle = '#7a7f88'; ctx.beginPath(); ctx.arc(w * 0.72, h * 0.2, 22, 0, 7); ctx.fill();
    ctx.fillStyle = '#2a170d'; ctx.beginPath(); ctx.arc(w * 0.3, h * 0.88, 30, 0, 7); ctx.arc(w * 0.68, h * 0.88, 30, 0, 7); ctx.fill();
  } else if (id === 'circus') {
    ctx.fillStyle = '#c9b78e'; ctx.fillRect(0, h * 0.7, w, h * 0.3); arches(ctx, w * 0.02, h * 0.7, w * 0.14, 7, h * 0.2, '#b8a47c', 2);
    ctx.fillStyle = '#20141a'; ctx.beginPath(); ctx.ellipse(w * 0.4, h * 0.86, 26, 12, 0, 0, 7); ctx.fill(); horse(ctx, w * 0.62, h * 0.9, 100); horse(ctx, w * 0.78, h * 0.9, 100);
  } else if (id === 'pretorium') {
    ctx.fillStyle = '#7a1e1e'; ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.86); ctx.lineTo(w * 0.5, h * 0.22); ctx.lineTo(w * 0.9, h * 0.86); ctx.fill(); ctx.fillStyle = '#e8c458'; ctx.fillRect(w * 0.1, h * 0.86, w * 0.8, 8);
    banner(ctx, w * 0.5, h * 0.1, 110, '#b83030', '#f2d27a');
  } else if (['walls', 'fortifications', 'guard_tower', 'arsenal', 'garrison', 'barracks'].includes(id)) {
    crenels(ctx, 0, h * 0.5, w, h * 0.36, '#6a6470', 9);
    tower(ctx, w * 0.16, h * 0.86, 80, h * 0.5, '#7a7480'); tower(ctx, w * 0.84, h * 0.86, 80, h * 0.5, '#7a7480');
    banner(ctx, w * 0.5, h * 0.12, 100, '#b83030');
    if (id === 'garrison' || id === 'barracks') for (let i = 0; i < 4; i++) hoplite(ctx, w * (0.3 + i * 0.13), h * 0.95, 120);
  } else {
    for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) hoplite(ctx, w * (0.12 + i * 0.15) + row * 20, h * (0.86 + row * 0.1), 130 + row * 30, i % 2 ? '#8a2b2b' : '#2f3b8a');
    banner(ctx, w * 0.12, h * 0.1, 90, '#b83030'); banner(ctx, w * 0.82, h * 0.1, 90, '#b83030');
  }
  ctx.fillStyle = rad(ctx, w / 2, h / 2, h * 0.3, h * 0.75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(20,0,0,0.5)']]); ctx.fillRect(0, 0, w, h);
}

function purple(ctx, def, w, h, r, glyphFn) {
  ctx.fillStyle = lin(ctx, 0, 0, 0, h, [[0, '#1a0c2a'], [1, '#3a1a52']]); ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) { const x = (i / 8) * w; ctx.fillStyle = `rgba(${90 + (i % 2) * 30},30,${120 + (i % 2) * 40},0.55)`; ctx.beginPath(); ctx.moveTo(x - 30, 0); ctx.quadraticCurveTo(x + 20, h * 0.5, x - 10, h); ctx.lineTo(x + 40, h); ctx.quadraticCurveTo(x + 60, h * 0.5, x + 30, 0); ctx.fill(); }
  glow(ctx, w * 0.5, h * 0.45, 230, '210,150,255', 0.55);
  ctx.strokeStyle = '#e6c458'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.45, 130, 0, 7); ctx.stroke(); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.45, 142, 0, 7); ctx.stroke();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; ctx.fillStyle = '#e6c458'; ctx.beginPath(); ctx.arc(w * 0.5 + Math.cos(a) * 136, h * 0.45 + Math.sin(a) * 136, 6, 0, 7); ctx.fill(); }
  if (glyphFn) glyphFn(ctx, w * 0.5, h * 0.45, 170);
  ctx.fillStyle = rad(ctx, w / 2, h / 2, h * 0.3, h * 0.75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(10,0,20,0.55)']]); ctx.fillRect(0, 0, w, h);
}

export function paintScene(ctx, def, w, h, glyphFn) {
  const r = rng(hashStr(def.id));
  ctx.save();
  switch (def.color) {
    case 'brown': brown(ctx, def, w, h, r); break;
    case 'grey': grey(ctx, def, w, h, r); break;
    case 'blue': blue(ctx, def, w, h, r); break;
    case 'green': green(ctx, def, w, h, r, glyphFn); break;
    case 'yellow': yellow(ctx, def, w, h, r); break;
    case 'red': red(ctx, def, w, h, r); break;
    case 'purple': purple(ctx, def, w, h, r, glyphFn); break;
  }
  ctx.restore();
}

// Backdrop for wonder cards: (w,h) region. kind picks the scenery
export function paintWonderBackdrop(ctx, id, w, h) {
  const r = rng(hashStr(id));
  const age = { pyramids: 1, sphinx: 1, great_lighthouse: 2, colossus: 2, hanging_gardens: 2, temple_of_artemis: 2, mausoleum: 2, great_library: 2, statue_of_zeus: 2, piraeus: 2, circus_maximus: 3, appian_way: 3 }[id] || 2;
  sky(ctx, w, h, age, r);
  const sea = ['great_lighthouse', 'colossus', 'piraeus', 'mausoleum'].includes(id);
  hills(ctx, w, h * 0.6, 26, rgba('#28304a', 0.55), r, 0.9);
  if (id === 'pyramids' || id === 'sphinx') { pyramid(ctx, w * 0.2, h * 0.7, 210, 120, '#b98a52'); pyramid(ctx, w * 0.82, h * 0.7, 260, 150, '#a67846'); }
  if (sea) water(ctx, w, h * 0.62, h * 0.38, '#3a8aa8', '#143a58', r); else ground(ctx, w, h * 0.68, h * 0.32, '#8a7350', '#3e3220');
  if (id === 'hanging_gardens' || id === 'temple_of_artemis' || id === 'statue_of_zeus') { palm(ctx, w * 0.06, h * 0.9, 140); palm(ctx, w * 0.95, h * 0.88, 120); }
  ctx.fillStyle = rad(ctx, w / 2, h * 0.8, h * 0.1, h * 0.9, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(8,4,16,0.55)']]); ctx.fillRect(0, 0, w, h);
}
