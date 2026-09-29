// Glyph → data-URL icon cache so the DOM can reuse the same procedural artwork as the textures.
import { drawGlyph } from '../gfx/glyphs.js';
import { mkCanvas, FONT_TITLE } from '../gfx/draw.js';
import { renderTokenFace, renderCardFace, renderWonderFace } from '../gfx/cardart.js';

const cache = new Map();
export function icon(name, size = 48, opts = {}) {
  const key = `${name}|${size}|${opts.text ?? ''}|${opts.color ?? ''}`;
  let u = cache.get(key);
  if (!u) {
    const px = size * 2;
    const c = mkCanvas(px, px), ctx = c.getContext('2d');
    drawGlyph(ctx, name, px / 2, px / 2, px * 0.92, opts);
    u = c.toDataURL();
    cache.set(key, u);
  }
  return u;
}
export function iconImg(name, size = 22, opts = {}) {
  const i = new Image(); i.src = icon(name, size, opts); i.width = size; i.height = size; i.draggable = false; i.className = 'ico ico-' + name; return i;
}
export function iconHTML(name, size = 22, opts = {}) { return `<img class="ico ico-${name}" src="${icon(name, size, opts)}" width="${size}" height="${size}" draggable="false" alt="${name}">`; }

export function tokenURL(id, size = 96) { const k = 'tok|' + id + size; let u = cache.get(k); if (!u) { u = renderTokenFace(id, size * 2).toDataURL(); cache.set(k, u); } return u; }

const cardCache = new Map();
export function cardCanvas(def, scale = 0.62) { const k = def.id + scale; let c = cardCache.get(k); if (!c) { c = renderCardFace(def, scale); cardCache.set(k, c); } return c; }
export function cardURL(def, scale = 0.62) { const k = 'u' + def.id + scale; let u = cardCache.get(k); if (!u) { u = cardCanvas(def, scale).toDataURL(); cardCache.set(k, u); } return u; }
export function wonderURL(id, scale = 0.5) { const k = 'wu' + id + scale; let u = cardCache.get(k); if (!u) { u = renderWonderFace(id, scale).toDataURL(); cardCache.set(k, u); } return u; }
