import { createGame, apply, legalActions } from '../src/engine/rules.js';
import { chooseAction, setParams } from '../src/engine/ai.js';
setParams({ coin: 0.36, build: 1, choice: 1.02, wonderCap: 2.4 });
const N = +(process.argv[2] || 40), level = process.argv[3] || 'normal';
let ai = 0, rnd = 0, draw = 0;
for (let i = 0; i < N; i++) for (const aiSide of [0, 1]) {
  const st = createGame({ seed: 3000 + i, names: ['A', 'B'] });
  while (!st.winner) {
    if (st.pending.player === aiSide) apply(st, chooseAction(st, { level }));
    else { const acts = legalActions(st); apply(st, acts[Math.floor(Math.random() * acts.length)]); }
  }
  if (st.winner.player === null) draw++; else if (st.winner.player === aiSide) ai++; else rnd++;
}
console.log(level, 'vs random →', { ai, rnd, draw });
