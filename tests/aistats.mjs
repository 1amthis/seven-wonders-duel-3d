import { createGame, apply, score } from '../src/engine/rules.js';
import { chooseAction } from '../src/engine/ai.js';
const N = +(process.argv[2] || 40), L0 = process.argv[3] || 'normal', L1 = process.argv[4] || 'normal';
const agg = { games: 0, civil: 0, military: 0, science: 0, draw: 0, vp: 0, cards: 0, wonders: 0, discards: 0, coins: 0, w0: 0, w1: 0, turns: 0 };
for (let i = 0; i < N; i++) {
  const st = createGame({ seed: 900 + i, names: ['A', 'B'] });
  const lv = [L0, L1]; let disc = 0;
  while (!st.winner) { const a = chooseAction(st, { level: lv[st.pending.player] }); if (a.type === 'discard') disc++; apply(st, a); }
  agg.games++; agg[st.winner.kind]++; agg.discards += disc; agg.turns += st.turnNo;
  if (st.winner.player === 0) agg.w0++; else if (st.winner.player === 1) agg.w1++;
  if (st.final) for (let p = 0; p < 2; p++) { agg.vp += st.final[p].total / 2; }
  for (let p = 0; p < 2; p++) { agg.cards += st.players[p].cards.length / 2; agg.wonders += st.players[p].wonders.filter(w => w.built).length / 2; agg.coins += st.players[p].coins / 2; }
}
for (const k of ['vp', 'cards', 'wonders', 'discards', 'coins', 'turns']) agg[k] = +(agg[k] / agg.games).toFixed(1);
console.log(L0, 'vs', L1, JSON.stringify(agg));
