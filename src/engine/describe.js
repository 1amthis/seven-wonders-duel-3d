// Human-readable descriptions of cards, wonders and costs (used by textures and UI).
import { CARDS, CARD, WONDER, COLOR_NAME } from './data.js';

export const RES_NAME = { wood: 'wood', clay: 'clay', stone: 'stone', glass: 'glass', papyrus: 'papyrus' };
export const SCI_NAME = { wheel: 'Wheel', mortar: 'Mortar & Pestle', quill: 'Writing', square: 'Geometry', sundial: 'Astronomy', astrolabe: 'Astrolabe', law: 'Law' };
export const CHAIN_LABEL = {};
for (const c of CARDS) if (c.chainOut) CHAIN_LABEL[c.chainOut] = c.name;

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const colorWord = c => ({ brown: 'brown', grey: 'grey', blue: 'blue', green: 'green', yellow: 'yellow', red: 'red', purple: 'purple', wonder: 'Wonder', coins: 'coins' }[c] || c);

/** short one-liner shown on the card face and in the tooltip headline */
export function shortEffect(def) {
  const fx = def.fx;
  const bits = [];
  if (fx.produce) bits.push('Produces ' + Object.entries(fx.produce).map(([r, n]) => `${n} ${r}`).join(' + '));
  if (fx.choice) bits.push('Produces 1 ' + fx.choice.join(' / ') + ' per turn');
  if (fx.trade) bits.push(fx.trade.join(' & ') + ' cost 1 coin to buy');
  if (fx.shields) bits.push(plural(fx.shields, 'shield'));
  if (fx.science) bits.push('Science: ' + SCI_NAME[fx.science]);
  if (fx.coins) bits.push(`Gain ${fx.coins} coins`);
  if (fx.perCard) bits.push(`Gain ${fx.perCard.coins} coin${fx.perCard.coins > 1 ? 's' : ''} per ${fx.perCard.of[0] === 'wonder' ? 'Wonder' : colorWord(fx.perCard.of[0]) + ' card'} you own`);
  if (fx.vp) bits.push(`${fx.vp} VP`);
  if (fx.guild) {
    const g = fx.guild;
    const what = g.of[0] === 'wonder' ? 'Wonder' : g.of[0] === 'coins' ? '3 coins' : g.of.map(colorWord).join('/') + ' card';
    bits.push(`${g.coin ? `${g.coin} coin + ` : ''}${g.vp} VP per ${what}`);
  }
  return bits.join(' · ');
}

export function longEffect(def) {
  const fx = def.fx, out = [];
  if (fx.produce) out.push('Produces ' + Object.entries(fx.produce).map(([r, n]) => plural(n, r)).join(' and ') + ' every time you need it.');
  if (fx.choice) out.push('Produces 1 of ' + fx.choice.join(', ') + ' — chosen freshly whenever you build.');
  if (fx.trade) out.push(`You buy ${fx.trade.join(' and ')} for just 1 coin each.`);
  if (fx.shields) out.push(`${plural(fx.shields, 'shield')}: push the conflict pawn ${fx.shields} step${fx.shields > 1 ? 's' : ''} toward your rival's capital.`);
  if (fx.science) out.push(`Scientific symbol — ${SCI_NAME[fx.science]}. A pair of identical symbols earns a Progress token; six different symbols win the game.`);
  if (fx.coins) out.push(`Take ${fx.coins} coins from the bank.`);
  if (fx.perCard) out.push(`Immediately take ${fx.perCard.coins} coin${fx.perCard.coins > 1 ? 's' : ''} for each ${fx.perCard.of[0] === 'wonder' ? 'Wonder you have built' : colorWord(fx.perCard.of[0]) + ' card in your city'}.`);
  if (fx.vp) out.push(`Worth ${fx.vp} victory points.`);
  if (fx.guild) {
    const g = fx.guild;
    if (g.of[0] === 'wonder') out.push('At the end: 2 VP for each Wonder built in the city that has the most Wonders.');
    else if (g.of[0] === 'coins') out.push('At the end: 1 VP per 3 coins in the richest city.');
    else out.push(`${g.coin ? `Immediately take ${g.coin} coin per ${g.of.map(colorWord).join('/')} card in the city that has the most. ` : ''}At the end: ${g.vp} VP per such card in that city.`);
  }
  return out;
}

export function chainInfo(def) {
  const out = [];
  if (def.chainIn) out.push({ kind: 'in', sym: def.chainIn, from: CHAIN_LABEL[def.chainIn] });
  if (def.chainOut) out.push({ kind: 'out', sym: def.chainOut, to: CARDS.filter(c => c.chainIn === def.chainOut).map(c => c.name) });
  return out;
}

export function costList(cost) {
  const out = [];
  if (cost.coins) out.push({ r: 'coins', n: cost.coins });
  for (const r of ['wood', 'clay', 'stone', 'glass', 'papyrus']) if (cost[r]) out.push({ r, n: cost[r] });
  return out;
}
export const typeName = def => COLOR_NAME[def.color];
