import assert from 'node:assert/strict';
import { createGame, apply, legalActions, computeCost, score, accessibleSlots, production } from '../src/engine/rules.js';
import { chooseAction } from '../src/engine/ai.js';
import { CARD, CARDS, LAYOUTS, WONDERS } from '../src/engine/data.js';

// ---- data sanity
assert.equal(CARDS.filter(c => c.age === 1).length, 23);
assert.equal(CARDS.filter(c => c.age === 2).length, 23);
assert.equal(CARDS.filter(c => c.age === 3 && c.color !== 'purple').length, 20);
assert.equal(CARDS.filter(c => c.color === 'purple').length, 7);
assert.equal(WONDERS.length, 12);
for (const a of [1, 2, 3]) assert.equal(LAYOUTS[a].length, 20, 'layout ' + a);
// every chainIn has a chainOut producer in an earlier age
for (const c of CARDS) if (c.chainIn) assert(CARDS.some(d => d.chainOut === c.chainIn && d.age < c.age), 'chain ' + c.id);
// science symbols come in pairs
const sci = {};
CARDS.forEach(c => { if (c.fx.science) sci[c.fx.science] = (sci[c.fx.science] || 0) + 1; });
assert.deepEqual(Object.values(sci).sort(), [2, 2, 2, 2, 2, 2]);

// ---- cost engine
{
  const st = createGame({ seed: 1 });
  st.players[0].coins = 20;
  // no production: 2 coins per missing resource
  let c = computeCost(st, 0, { kind: 'card', id: 'baths' });
  assert.equal(c.total, 2);
  st.players[0].cards.push('quarry');
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'baths' }).total, 0);
  // opponent production raises price
  st.players[1].cards.push('quarry', 'shelf_quarry');
  st.players[0].cards = [];
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'baths' }).total, 2 + 3);
  // stone reserve => 1 coin
  st.players[0].cards.push('stone_reserve');
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'baths' }).total, 1);
  // chain
  st.players[0].cards.push('baths');
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'aqueduct' }).chain, true);
  // choice production (forum glass/papyrus) covers one of two
  st.players[0].cards = ['forum'];
  st.players[1].cards = [];
  const lib = computeCost(st, 0, { kind: 'wonder', id: 'temple_of_artemis' }); // wood stone glass papyrus
  assert.equal(lib.trade, 2 * 3);
  // masonry
  st.players[0].cards = [];
  st.players[0].tokens = ['masonry'];
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'courthouse' }).total, 2 * 1);
}

// ---- random playthroughs
function playRandom(seed) {
  const st = createGame({ seed, names: ['A', 'B'] });
  let n = 0;
  while (!st.winner) {
    const acts = legalActions(st);
    assert(acts.length > 0, 'no legal actions in ' + JSON.stringify(st.pending));
    apply(st, acts[Math.floor(Math.random() * acts.length)]);
    assert(n++ < 2000, 'runaway');
  }
  return st;
}
const kinds = {};
for (let i = 0; i < 300; i++) { const s = playRandom(1000 + i); kinds[s.winner.kind] = (kinds[s.winner.kind] || 0) + 1; }
console.log('random games:', kinds);

// ---- AI playthroughs
function playAI(seed, l0, l1) {
  const st = createGame({ seed, names: ['A', 'B'] });
  const lv = [l0, l1];
  let n = 0;
  while (!st.winner) {
    const a = chooseAction(st, { level: lv[st.pending.player] });
    apply(st, a);
    assert(n++ < 2000, 'runaway');
  }
  return st;
}
const t0 = Date.now();
const res = { civil: 0, military: 0, science: 0, draw: 0 };
const totals = [];
for (let i = 0; i < 40; i++) {
  const s = playAI(50 + i, 'hard', 'normal');
  res[s.winner.kind]++;
  if (s.final) totals.push(s.final[0].total, s.final[1].total);
}
console.log('AI games (hard vs normal):', res, 'avg VP', totals.length ? (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) : '-', 'time', Date.now() - t0, 'ms');
let hardWins = 0, normalWins = 0;
for (let i = 0; i < 30; i++) {
  const swap = i % 2;
  const s = playAI(200 + i, swap ? 'normal' : 'hard', swap ? 'hard' : 'normal');
  if (s.winner.player === null) continue;
  const hardIdx = swap ? 1 : 0;
  if (s.winner.player === hardIdx) hardWins++; else normalWins++;
}
console.log('hard vs normal wins:', hardWins, normalWins);
console.log('all engine tests passed');
