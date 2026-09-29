// Self-play hill-climbing of the AI evaluation weights: node tests/tune.mjs [games] [sweeps]
import { createGame, apply } from '../src/engine/rules.js';
import { chooseAction, setParams, PARAMS, DEFAULTS } from '../src/engine/ai.js';
const G = +(process.argv[2] || 40), SWEEPS = +(process.argv[3] || 2);

function play(seed, pa, pb) {
  const st = createGame({ seed, names: ['A', 'B'] });
  const ps = [pa, pb];
  while (!st.winner) { setParams(ps[st.pending.player]); apply(st, chooseAction(st, { level: 'normal' })); }
  return st.winner.player;
}
function match(pa, pb, games, seed0) {
  let a = 0, b = 0;
  for (let i = 0; i < games; i++) {
    const s = seed0 + i;
    const w1 = play(s, pa, pb); if (w1 === 0) a++; else if (w1 === 1) b++;
    const w2 = play(s, pb, pa); if (w2 === 1) a++; else if (w2 === 0) b++;
  }
  return a / Math.max(1, a + b);
}

let best = { ...DEFAULTS };
const keys = Object.keys(DEFAULTS).filter(k => !['resCap'].includes(k));
let seed = 5000;
for (let sw = 0; sw < SWEEPS; sw++) {
  for (const k of keys) {
    for (const mult of [1.6, 0.6]) {
      const cand = { ...best, [k]: k === 'denial' ? (best[k] + 0.3 * (mult > 1 ? 1 : -1)) : best[k] * mult };
      if (cand.denial < 0) continue;
      const wr = match(cand, best, G / 2, seed); seed += 1000;
      process.stdout.write(`sweep ${sw} ${k} ×${mult} → ${(wr * 100).toFixed(0)}%\n`);
      if (wr > 0.62) { best = cand; console.log('  ACCEPT', k, best[k].toFixed(3)); break; }
    }
  }
  console.log('BEST after sweep', sw, JSON.stringify(best));
}
console.log('FINAL', JSON.stringify(best));
