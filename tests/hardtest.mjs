import { createGame, apply } from '../src/engine/rules.js';
import { chooseAction, SEARCH } from '../src/engine/ai.js';
const N = +(process.argv[2] || 20); const cfg = JSON.parse(process.argv[3] || '{}'); const A = process.argv[4] || 'hard', B = process.argv[5] || 'normal';
const base = { ...SEARCH };
let a = 0, b = 0;
for (let i = 0; i < N; i++) for (const aSide of [0, 1]) {
  const st = createGame({ seed: 7000 + i, names: ['x', 'y'] });
  while (!st.winner) { const isA = st.pending.player === aSide; Object.assign(SEARCH, base, isA ? cfg : {}); apply(st, chooseAction(st, { level: isA ? A : B })); }
  if (st.winner.player === aSide) a++; else if (st.winner.player !== null) b++;
}
console.log(A, JSON.stringify(cfg), 'vs', B, '→', a, ':', b);
