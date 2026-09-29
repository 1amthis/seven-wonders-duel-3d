// Procedural faces for buildings, wonders, progress tokens and coins.
import { drawGlyph } from './glyphs.js';
import { paintScene, paintWonderBackdrop } from './scenes.js';
import { mkCanvas, FONT_TITLE, FONT_BODY, rr, lin, rad, mix, lighten, darken, rgba, fitText, wrapText, noiseFill, hashStr, rng, meander, star } from './draw.js';
import { COLOR_HEX, COLOR_NAME, WONDER, TOKEN } from '../engine/data.js';
import { shortEffect, costList, chainInfo } from '../engine/describe.js';

const GOLD = ['#fff3b8', '#f0c85a', '#9a6f1e', '#f6d777', '#b98a2e'];
const goldGrad = (ctx, x0, y0, x1, y1) => lin(ctx, x0, y0, x1, y1, GOLD.map((c, i) => [i / (GOLD.length - 1), c]));

// ------------------------------------------------------------------ effect glyph row
function effectItems(def) {
  const fx = def.fx, it = [];
  const sep = t => it.push({ sep: t });
  if (fx.produce) {
    Object.entries(fx.produce).forEach(([r, n]) => { if (n <= 3) for (let i = 0; i < n; i++) it.push({ g: r }); else { it.push({ g: r }); sep('×' + n); } });
  }
  if (fx.choice) fx.choice.forEach((r, i) => { if (i) sep('/'); it.push({ g: r }); });
  if (fx.trade) { it.push({ g: 'coin', text: '1' }); sep('='); fx.trade.forEach((r, i) => { if (i) sep('&'); it.push({ g: r }); }); }
  if (fx.shields) for (let i = 0; i < fx.shields; i++) it.push({ g: 'shield' });
  if (fx.science) it.push({ g: fx.science, big: true });
  if (fx.coins) it.push({ g: 'coin', text: String(fx.coins) });
  if (fx.perCard) {
    const c = fx.perCard.of[0];
    it.push(c === 'wonder' ? { g: 'pyramid' } : { g: 'cardstack', color: COLOR_HEX[c] }); sep('→'); it.push({ g: 'coin', text: String(fx.perCard.coins) });
  }
  if (fx.guild) {
    const g = fx.guild;
    if (g.of[0] === 'wonder') it.push({ g: 'pyramid' });
    else if (g.of[0] === 'coins') it.push({ g: 'coin', text: '3' });
    else g.of.forEach((c, i) => { if (i) sep('+'); it.push({ g: 'cardstack', color: COLOR_HEX[c] }); });
    sep('→');
    if (g.coin) { it.push({ g: 'coin', text: String(g.coin) }); sep('+'); }
    it.push({ g: 'vp', text: String(g.vp) });
  }
  if (fx.vp) { if (it.length) sep('+'); it.push({ g: 'vp', text: String(fx.vp), big: !it.length }); }
  return it;
}

function drawItems(ctx, items, box, base = 92) {
  const gap = 0.08;
  const width = s => items.reduce((w, i) => w + (i.sep ? s * (i.sep.length > 1 ? 0.62 : 0.42) : s * (1 + gap)), 0);
  let s = base;
  while (width(s) > box.w && s > 30) s -= 2;
  const total = width(s);
  let x = box.x + (box.w - total) / 2;
  const cy = box.y + box.h / 2;
  for (const i of items) {
    if (i.sep) {
      const w = s * (i.sep.length > 1 ? 0.62 : 0.42);
      ctx.save(); ctx.font = `700 ${s * 0.5}px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#3a2a16'; ctx.fillText(i.sep, x + w / 2, cy + s * 0.02); ctx.restore();
      x += w;
    } else {
      drawGlyph(ctx, i.g, x + s / 2, cy, s * (i.big ? 1.08 : 1), { text: i.text, color: i.color, shadow: true });
      x += s * (1 + gap);
    }
  }
}

// ------------------------------------------------------------------ frames
function goldFrame(ctx, x, y, w, h, r, lw = 5) {
  rr(ctx, x, y, w, h, r); ctx.lineWidth = lw; ctx.strokeStyle = goldGrad(ctx, x, y, x + w, y + h); ctx.stroke();
  rr(ctx, x + lw, y + lw, w - lw * 2, h - lw * 2, Math.max(2, r - lw)); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(60,35,5,0.55)'; ctx.stroke();
}

function costColumn(ctx, cost, x, y, iconSize, opts = {}) {
  const list = costList(cost);
  const icons = [];
  for (const c of list) { if (c.r === 'coins') icons.push({ g: 'coin', text: String(c.n) }); else for (let i = 0; i < c.n; i++) icons.push({ g: c.r }); }
  const pad = 9, w = iconSize + pad * 2;
  if (!icons.length) {
    if (opts.showFree) {
      ctx.save(); ctx.font = `700 ${iconSize * 0.34}px ${FONT_TITLE}`; ctx.fillStyle = 'rgba(30,18,8,0.55)'; rr(ctx, x, y, w, iconSize * 0.7, 12); ctx.fill(); ctx.fillStyle = '#f5e3a8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('FREE', x + w / 2, y + iconSize * 0.36); ctx.restore();
    }
    return;
  }
  const h = icons.length * (iconSize + 4) + pad * 2 - 4;
  ctx.save();
  ctx.fillStyle = 'rgba(24,14,6,0.72)'; rr(ctx, x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, x, y, x + w, y + h); ctx.lineWidth = 2; rr(ctx, x + 1, y + 1, w - 2, h - 2, 13); ctx.stroke();
  icons.forEach((ic, i) => drawGlyph(ctx, ic.g, x + w / 2, y + pad + iconSize / 2 + i * (iconSize + 4), iconSize, { text: ic.text }));
  ctx.restore();
}

// ------------------------------------------------------------------ building face
export function renderCardFace(def, scale = 1) {
  const W = 512, H = 768;
  const cv = mkCanvas(W * scale, H * scale), ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  const base = COLOR_HEX[def.color];
  // body
  rr(ctx, 0, 0, W, H, 30); ctx.fillStyle = lin(ctx, 0, 0, W, H, [[0, '#4a3520'], [1, '#160f08']]); ctx.fill();
  ctx.save(); rr(ctx, 12, 12, W - 24, H - 24, 22); ctx.clip();
  ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, lighten('#ecdcb4', 0.06)], [0.5, '#e2cf9f'], [1, '#c9b07a']]); ctx.fillRect(0, 0, W, H);
  noiseFill(ctx, 0, 0, W, H, 0.05, hashStr(def.id));
  // colour wash behind effect area
  ctx.fillStyle = lin(ctx, 0, 60, 0, 220, [[0, rgba(base, 0.55)], [1, rgba(base, 0.08)]]); ctx.fillRect(0, 60, W, 170);

  // illustration
  ctx.save(); rr(ctx, 24, 222, W - 48, 412, 16); ctx.clip(); ctx.translate(24, 222);
  const glyphFn = (c, x, y, s) => { if (def.fx.science) drawGlyph(c, def.fx.science, x, y, s, { shadow: true }); else if (def.color === 'purple') { const g = def.fx.guild; if (g.of[0] === 'wonder') drawGlyph(c, 'pyramid', x, y, s); else if (g.of[0] === 'coins') drawGlyph(c, 'coin', x, y, s, { text: '3' }); else drawGlyph(c, 'cardstack', x, y, s, { color: COLOR_HEX[g.of[0]] }); } };
  paintScene(ctx, def, W - 48, 412, glyphFn);
  ctx.restore();
  goldFrame(ctx, 22, 220, W - 44, 416, 18, 4);

  // header
  const hg = lin(ctx, 0, 14, 0, 76, [[0, lighten(base, 0.28)], [0.55, base], [1, darken(base, 0.42)]]);
  ctx.fillStyle = hg; ctx.fillRect(12, 12, W - 24, 66);
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(12, 12, W - 24, 3);
  meander(ctx, 16, 66, W - 32, 9, 'rgba(255,240,190,0.28)', 1.6);
  const fs = fitText(ctx, def.name.toUpperCase(), W - 150, 40, 700);
  ctx.font = `700 ${fs}px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20,10,0,0.75)'; ctx.strokeText(def.name.toUpperCase(), W / 2, 42);
  ctx.fillStyle = '#fff7de'; ctx.fillText(def.name.toUpperCase(), W / 2, 42);
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = goldGrad(ctx, 0, 0, W, 90); ctx.beginPath(); ctx.moveTo(12, 78); ctx.lineTo(W - 12, 78); ctx.stroke();

  // effect plate
  const plate = { x: 108, y: 88, w: 384, h: 122 };
  ctx.save(); rr(ctx, plate.x, plate.y, plate.w, plate.h, 16);
  ctx.fillStyle = lin(ctx, 0, plate.y, 0, plate.y + plate.h, [[0, 'rgba(255,248,225,0.72)'], [1, 'rgba(226,205,160,0.72)']]); ctx.fill();
  ctx.strokeStyle = rgba(darken(base, 0.3), 0.7); ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore();
  drawItems(ctx, effectItems(def), { x: plate.x + 8, y: plate.y + 6, w: plate.w - 16, h: plate.h - 34 }, 90);
  ctx.save(); ctx.font = `600 italic ${fitText(ctx, shortEffect(def), plate.w - 24, 21, 600, FONT_BODY, 12)}px ${FONT_BODY}`; ctx.fillStyle = '#3a2814'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(shortEffect(def), plate.x + plate.w / 2, plate.y + plate.h - 17); ctx.restore();

  // cost column
  costColumn(ctx, def.cost, 22, 90, 50, { showFree: true });

  // footer
  ctx.save();
  ctx.fillStyle = 'rgba(26,16,8,0.9)'; rr(ctx, 22, 644, W - 44, 96, 16); ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, 22, 644, W - 22, 740); ctx.lineWidth = 2.5; rr(ctx, 23, 645, W - 46, 94, 15); ctx.stroke();
  const ch = chainInfo(def);
  const cin = ch.find(c => c.kind === 'in'), cout = ch.find(c => c.kind === 'out');
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  if (cin) {
    ctx.fillStyle = '#c9b88a'; ctx.font = `600 ${17}px ${FONT_TITLE}`; ctx.fillText('FREE WITH', 40, 668);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.arc(74, 708, 25, 0, 7); ctx.fill();
    drawGlyph(ctx, cin.sym, 74, 708, 40, { color: '#fff6dc' });
    ctx.fillStyle = '#e8dcb8'; ctx.font = `600 italic 20px ${FONT_BODY}`; ctx.fillText(cin.from, 106, 708);
  }
  ctx.textAlign = 'right';
  if (cout) {
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.arc(W - 74, 700, 28, 0, 7); ctx.fill();
    ctx.strokeStyle = goldGrad(ctx, W - 100, 672, W - 48, 728); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(W - 74, 700, 28, 0, 7); ctx.stroke();
    drawGlyph(ctx, cout.sym, W - 74, 700, 44, { color: '#fff6dc' });
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cx = W / 2 + (cin && cout ? 0 : cin ? 96 : cout ? -50 : 0);
  ctx.fillStyle = 'rgba(240,215,140,0.95)'; ctx.font = `800 40px ${FONT_TITLE}`;
  ctx.fillText(['', 'I', 'II', 'III'][def.age], cx, 676);
  ctx.fillStyle = lighten(base, 0.42); ctx.font = `700 ${cin && cout ? 17 : 21}px ${FONT_TITLE}`;
  ctx.fillText(COLOR_NAME[def.color].toUpperCase(), cx, 718);
  ctx.restore();

  goldFrame(ctx, 2, 2, W - 4, H - 4, 30, 6);
  return cv;
}

// ------------------------------------------------------------------ card backs
export function renderCardBack(age, scale = 1) {
  const W = 512, H = 768;
  const cv = mkCanvas(W * scale, H * scale), ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  const pal = { 1: ['#a2632c', '#5a300f', '#f2c96b'], 2: ['#2a8497', '#0d3b48', '#d9f0e6'], 3: ['#7c46a8', '#2a1046', '#f0c6ff'] }[age] || ['#666', '#222', '#eee'];
  rr(ctx, 0, 0, W, H, 30); ctx.fillStyle = darken(pal[1], 0.4); ctx.fill();
  ctx.save(); rr(ctx, 10, 10, W - 20, H - 20, 24); ctx.clip();
  ctx.fillStyle = rad(ctx, W / 2, H / 2, 20, H * 0.75, [[0, pal[0]], [1, pal[1]]]); ctx.fillRect(0, 0, W, H);
  // rays
  ctx.save(); ctx.translate(W / 2, H / 2);
  for (let i = 0; i < 36; i++) { ctx.rotate(Math.PI / 18); ctx.fillStyle = i % 2 ? rgba(pal[2], 0.10) : 'rgba(0,0,0,0.08)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-30, -H); ctx.lineTo(30, -H); ctx.fill(); }
  ctx.restore();
  // patterned border
  for (const [y, flip] of [[26, 1], [H - 44, -1]]) meander(ctx, 40, y, W - 80, 18, rgba(pal[2], 0.75), 2.2);
  ctx.save(); ctx.translate(0, 0);
  for (let i = 0; i < 12; i++) { const y = 92 + i * 47; drawGlyphSmall(ctx, 30, y, pal[2]); drawGlyphSmall(ctx, W - 30, y, pal[2]); }
  ctx.restore();
  // medallion
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(W / 2, H / 2 + 6, 176, 0, 7); ctx.fill();
  ctx.fillStyle = rad(ctx, W / 2 - 40, H / 2 - 50, 10, 170, [[0, lighten(pal[0], 0.25)], [1, darken(pal[1], 0.1)]]); ctx.beginPath(); ctx.arc(W / 2, H / 2, 168, 0, 7); ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, W / 2 - 170, H / 2 - 170, W / 2 + 170, H / 2 + 170); ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(W / 2, H / 2, 166, 0, 7); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2, H / 2, 148, 0, 7); ctx.stroke();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.283; star(ctx, W / 2 + Math.cos(a) * 157, H / 2 + Math.sin(a) * 157, 5, 2, 4); ctx.fillStyle = pal[2]; ctx.fill(); }
  // motif
  ctx.save(); ctx.translate(W / 2, H / 2);
  if (age === 1) { ctx.fillStyle = 'rgba(255,230,160,0.9)'; ctx.beginPath(); ctx.moveTo(-96, 68); ctx.lineTo(0, -70); ctx.lineTo(96, 68); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.moveTo(0, -70); ctx.lineTo(96, 68); ctx.lineTo(4, 68); ctx.fill(); }
  else if (age === 2) { ctx.strokeStyle = 'rgba(230,250,240,0.9)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, -8, 62, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-62, 70); ctx.lineTo(0, -80); ctx.lineTo(62, 70); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-84, 70); ctx.lineTo(84, 70); ctx.stroke(); }
  else { ctx.fillStyle = 'rgba(255,230,255,0.9)'; star(ctx, 0, -8, 78, 34, 8); ctx.fill(); }
  ctx.font = `800 ${age === 3 ? 74 : 84}px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillText(['', 'I', 'II', 'III'][age], 3, 110); ctx.fillStyle = pal[2]; ctx.fillText(['', 'I', 'II', 'III'][age], 0, 106);
  ctx.restore();
  noiseFill(ctx, 0, 0, W, H, 0.05, age);
  ctx.restore();
  goldFrame(ctx, 2, 2, W - 4, H - 4, 30, 6);
  return cv;
}
function drawGlyphSmall(ctx, x, y, col) { ctx.fillStyle = rgba(col, 0.6); ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 7, y); ctx.closePath(); ctx.fill(); }

// ------------------------------------------------------------------ wonder face (landscape)
export function renderWonderFace(id, scale = 1) {
  const def = WONDER[id];
  const W = 768, H = 512;
  const cv = mkCanvas(W * scale, H * scale), ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  rr(ctx, 0, 0, W, H, 30); ctx.fillStyle = lin(ctx, 0, 0, W, H, [[0, '#3a2a18'], [1, '#120c06']]); ctx.fill();
  ctx.save(); rr(ctx, 12, 12, W - 24, H - 24, 22); ctx.clip();
  ctx.fillStyle = '#d9c491'; ctx.fillRect(0, 0, W, H);
  // backdrop art
  ctx.save(); rr(ctx, 22, 84, W - 44, 290, 14); ctx.clip(); ctx.translate(22, 84); paintWonderBackdrop(ctx, id, W - 44, 290); ctx.restore();
  goldFrame(ctx, 20, 82, W - 40, 294, 16, 4);
  // pedestal
  ctx.save(); ctx.translate(W / 2, 318);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(0, 10, 190, 50, 0, 0, 7); ctx.fill();
  ctx.fillStyle = lin(ctx, -180, 0, 180, 0, [[0, '#6a5a44'], [0.5, '#d9c9a4'], [1, '#5a4a36']]); ctx.beginPath(); ctx.ellipse(0, 0, 178, 44, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, -170, -40, 170, 40); ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(0, -2, 168, 40, 0, 0, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(255,240,190,0.18)'; ctx.beginPath(); ctx.ellipse(0, -6, 130, 26, 0, 0, 7); ctx.fill();
  ctx.restore();
  // header
  ctx.fillStyle = lin(ctx, 0, 12, 0, 78, [[0, '#a3452b'], [0.55, '#7a2a18'], [1, '#3a1208']]); ctx.fillRect(12, 12, W - 24, 68);
  ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(12, 12, W - 24, 3);
  meander(ctx, 16, 66, W - 32, 9, 'rgba(255,230,160,0.28)', 1.6);
  const nm = def.name.toUpperCase();
  const fs = fitText(ctx, nm, W - 220, 44, 700);
  ctx.font = `700 ${fs}px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(20,6,0,0.8)'; ctx.strokeText(nm, W / 2, 44); ctx.fillStyle = '#ffedb0'; ctx.fillText(nm, W / 2, 44);
  // cost column
  costColumn(ctx, def.cost, 34, 96, 52);
  // effect icons (right)
  const eff = [];
  const fx = def.fx;
  if (fx.coins) eff.push({ g: 'coin', text: String(fx.coins) });
  if (fx.oppLoseCoins) eff.push({ g: 'coin', text: '-' + fx.oppLoseCoins, color: '#ff8a7a' });
  if (fx.shields) for (let i = 0; i < fx.shields; i++) eff.push({ g: 'shield' });
  if (fx.destroy) eff.push({ g: 'destroy', color: fx.destroy === 'grey' ? '#cfd6dc' : '#d9a066' });
  if (fx.library) eff.push({ g: 'library' });
  if (fx.revive) eff.push({ g: 'revive' });
  if (fx.choice) eff.push({ g: fx.choice[0] }, { g: fx.choice[1] }, ...(fx.choice[2] ? [{ g: fx.choice[2] }] : []));
  if (fx.again) eff.push({ g: 'again' });
  const ex = W - 84;
  ctx.save();
  if (def.vp) { drawGlyph(ctx, 'vp', ex, 130, 82, { text: String(def.vp), shadow: true }); }
  const rows = eff.slice(0, 4);
  const bh = rows.length * 54 + 12;
  if (rows.length) {
    const y0 = def.vp ? 180 : 100;
    ctx.fillStyle = 'rgba(24,14,6,0.72)'; rr(ctx, ex - 33, y0, 66, bh, 14); ctx.fill();
    ctx.strokeStyle = goldGrad(ctx, ex - 33, y0, ex + 33, y0 + bh); ctx.lineWidth = 2; rr(ctx, ex - 32, y0 + 1, 64, bh - 2, 13); ctx.stroke();
    rows.forEach((e, i) => drawGlyph(ctx, e.g, ex, y0 + 32 + i * 54, 46, { text: e.text, color: e.color }));
  }
  ctx.restore();
  // description
  ctx.fillStyle = 'rgba(28,18,8,0.92)'; rr(ctx, 20, 384, W - 40, 108, 16); ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, 20, 384, W - 20, 492); ctx.lineWidth = 2.5; rr(ctx, 21, 385, W - 42, 106, 15); ctx.stroke();
  ctx.fillStyle = '#f2e4bc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = 32; let lines;
  do { ctx.font = `600 ${size}px ${FONT_BODY}`; lines = wrapText(ctx, def.text, W - 100); size -= 2; } while (lines.length * size * 1.16 > 88 && size > 16);
  size += 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 438 - ((lines.length - 1) * size * 0.58) + i * size * 1.16));
  ctx.restore();
  goldFrame(ctx, 2, 2, W - 4, H - 4, 30, 6);
  return cv;
}

// ------------------------------------------------------------------ progress token
export function renderTokenFace(id, size = 512) {
  const def = TOKEN[id];
  const cv = mkCanvas(size, size), ctx = cv.getContext('2d');
  const c = size / 2, R = size / 2 - 2;
  ctx.fillStyle = goldGrad(ctx, 0, 0, size, size); ctx.beginPath(); ctx.arc(c, c, R, 0, 7); ctx.fill();
  ctx.fillStyle = rad(ctx, c - size * 0.12, c - size * 0.15, size * 0.05, R, [[0, '#2d6f8a'], [0.6, '#123e58'], [1, '#0a2236']]); ctx.beginPath(); ctx.arc(c, c, R - size * 0.045, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,230,150,0.7)'; ctx.lineWidth = size * 0.008; ctx.beginPath(); ctx.arc(c, c, R - size * 0.075, 0, 7); ctx.stroke();
  for (let i = 0; i < 48; i++) { const a = (i / 48) * 6.283; ctx.fillStyle = 'rgba(255,225,140,0.85)'; ctx.beginPath(); ctx.arc(c + Math.cos(a) * (R - size * 0.06), c + Math.sin(a) * (R - size * 0.06), size * 0.006, 0, 7); ctx.fill(); }
  ctx.fillStyle = rad(ctx, c, c * 0.95, 0, size * 0.32, [[0, 'rgba(255,240,190,0.35)'], [1, 'rgba(255,240,190,0)']]); ctx.fillRect(0, 0, size, size);
  drawGlyph(ctx, id, c, c - size * 0.03, size * 0.56, { shadow: true });
  // name ribbon
  ctx.fillStyle = 'rgba(8,20,32,0.82)'; rr(ctx, c - size * 0.3, c + size * 0.22, size * 0.6, size * 0.13, size * 0.03); ctx.fill();
  ctx.strokeStyle = goldGrad(ctx, 0, 0, size, size); ctx.lineWidth = size * 0.006; rr(ctx, c - size * 0.3, c + size * 0.22, size * 0.6, size * 0.13, size * 0.03); ctx.stroke();
  const nm = def.name.toUpperCase();
  const fs = fitText(ctx, nm, size * 0.54, size * 0.07, 700);
  ctx.font = `700 ${fs}px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffe9a8'; ctx.fillText(nm, c, c + size * 0.285);
  return cv;
}

// ------------------------------------------------------------------ coins
const METALS = {
  bronze: ['#f0b070', '#b06a34', '#5a2f12'],
  silver: ['#ffffff', '#c5ced6', '#6a7480'],
  gold: ['#fff2a6', '#e8b930', '#8a5d10'],
};
export function renderCoinFace(kind, value, size = 256) {
  const m = METALS[kind];
  const cv = mkCanvas(size, size), ctx = cv.getContext('2d');
  const c = size / 2;
  ctx.fillStyle = rad(ctx, c * 0.8, c * 0.75, size * 0.05, size * 0.6, [[0, m[0]], [0.5, m[1]], [1, m[2]]]); ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = m[2]; ctx.lineWidth = size * 0.03; ctx.beginPath(); ctx.arc(c, c, size * 0.44, 0, 7); ctx.stroke();
  ctx.strokeStyle = m[0]; ctx.lineWidth = size * 0.012; ctx.beginPath(); ctx.arc(c, c, size * 0.405, 0, 7); ctx.stroke();
  for (let i = 0; i < 40; i++) { const a = (i / 40) * 6.283; ctx.fillStyle = m[2]; ctx.beginPath(); ctx.arc(c + Math.cos(a) * size * 0.465, c + Math.sin(a) * size * 0.465, size * 0.008, 0, 7); ctx.fill(); }
  // laurel
  ctx.fillStyle = m[2];
  for (let i = 0; i < 10; i++) for (const s of [-1, 1]) { const a = Math.PI / 2 + s * (0.5 + i * 0.22); ctx.save(); ctx.translate(c + Math.cos(a) * size * 0.34, c + Math.sin(a) * size * 0.34); ctx.rotate(a + Math.PI / 2 * s); ctx.beginPath(); ctx.ellipse(0, 0, size * 0.03, size * 0.014, 0, 0, 7); ctx.fill(); ctx.restore(); }
  ctx.font = `800 ${size * 0.42}px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(String(value), c - 2, c - 1); ctx.fillStyle = m[2]; ctx.fillText(String(value), c, c + 2);
  return cv;
}
export function renderCoinSide(kind, w = 64, h = 16) {
  const m = METALS[kind];
  const cv = mkCanvas(w, h), ctx = cv.getContext('2d');
  ctx.fillStyle = lin(ctx, 0, 0, 0, h, [[0, m[0]], [0.5, m[1]], [1, m[2]]]); ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = m[2]; for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
  return cv;
}
