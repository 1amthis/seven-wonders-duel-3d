// Targeted rule checks on crafted positions.
import assert from 'node:assert/strict';
import { createGame, apply, legalActions, computeCost, score, accessibleSlots, distinctScience } from '../src/engine/rules.js';
import { WONDERS } from '../src/engine/data.js';

function fresh(seed = 11) {
  const st = createGame({ seed, first: 0 });
  while (st.pending.type === 'draft') apply(st, legalActions(st)[0]);
  assert.equal(st.pending.type, 'turn'); assert.equal(st.pending.player, 0);
  return st;
}
/** put `card` into an accessible slot and return the slot index */
function put(st, card) { const i = accessibleSlots(st)[0]; st.structure[i].card = card; return i; }
const give = (st, p, ...ids) => st.players[p].cards.push(...ids);
const discardUntil = (st, p) => { while (st.pending.player !== p) apply(st, legalActions(st).find(a => a.type === 'discard')); };

// 1. trading: price = 2 + rival brown/grey production; reserves make it 1
{
  const st = fresh(); st.players[0].coins = 20;
  give(st, 1, 'sawmill');                       // rival produces 2 wood
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'temple' }).trade, (2 + 2) + 2);  // wood 4 + papyrus 2
  give(st, 0, 'wood_reserve');
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'temple' }).trade, 1 + 2);
  give(st, 1, 'forum'); assert.equal(computeCost(st, 0, { kind: 'card', id: 'press' }).total, 1); // yellow choice cards do not raise prices
}
// 2. chain building is free and Urbanism pays 4
{
  const st = fresh(); st.players[0].coins = 5; give(st, 0, 'theater'); st.players[0].tokens.push('urbanism');
  const i = put(st, 'statue'); const ev = apply(st, { type: 'build', slot: i });
  assert.equal(st.players[0].coins, 9); assert(ev.some(e => e.t === 'build' && e.cost.chain));
}
// 3. Economy: the rival's trading coins go to the Economy owner
{
  const st = fresh(); st.players[0].coins = 10; st.players[1].tokens.push('economy'); const c1 = st.players[1].coins;
  const i = put(st, 'baths'); apply(st, { type: 'build', slot: i });    // 1 stone bought for 2
  assert.equal(st.players[0].coins, 8); assert.equal(st.players[1].coins, c1 + 2);
}
// 4. Masonry (blue only) and Architecture (wonders)
{
  const st = fresh(); st.players[0].coins = 30; st.players[0].tokens.push('masonry');
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'courthouse' }).trade, 2);  // 3 resources minus 2, one bought at 2
  assert.equal(computeCost(st, 0, { kind: 'card', id: 'palisade' }).total, 2);    // not blue: unchanged
  st.players[0].tokens.push('architecture');
  const w = st.players[0].wonders[0].id; const base = Object.values(WONDERS.find(x => x.id === w).cost).reduce((a, b) => a + b, 0);
  assert(computeCost(st, 0, { kind: 'wonder', id: w }).trade <= (base - 2) * 2);
}
// 5. military: looting thresholds and instant victory
{
  const st = fresh(); st.players[0].coins = 50; st.players[1].coins = 20; give(st, 0, 'sawmill', 'brickyard', 'shelf_quarry', 'glassblower', 'drying_room');
  let i = put(st, 'pretorium'); apply(st, { type: 'build', slot: i });          // +3 → loot 2
  assert.equal(st.military, 3); assert.equal(st.players[1].coins, 18); assert.equal(st.loot['3'], false);
  discardUntil(st, 0);
  i = put(st, 'arsenal'); apply(st, { type: 'build', slot: i });                // +3 → 6, loot 5
  assert.equal(st.military, 6); assert.equal(st.loot['6'], false);
  assert.equal(score(st, 0).military, 10);
  discardUntil(st, 0);
  i = put(st, 'siege_workshop'); st.players[0].tokens.push('strategy'); apply(st, { type: 'build', slot: i }); // 2+1 → 9
  assert.deepEqual(st.winner, { player: 0, kind: 'military' });
}
// 6. science: pair → progress token, six different → win
{
  const st = fresh(); st.players[0].coins = 40; give(st, 0, 'pharmacist');
  const i = put(st, 'dispensary'); apply(st, { type: 'build', slot: i });       // mortar pair (chain free)
  assert.equal(st.pending.type, 'token'); assert.equal(st.pending.player, 0);
  apply(st, { type: 'token', token: st.pending.options[0] }); assert.equal(st.players[0].tokens.length, 1);
  const st2 = fresh(); st2.players[0].coins = 99; give(st2, 0, 'workshop', 'apothecary', 'scriptorium', 'pharmacist', 'academy');
  const j = put(st2, 'university'); apply(st2, { type: 'build', slot: j });    // sixth distinct symbol (astrolabe)
  assert.equal(distinctScience(st2, 0), 6); assert.equal(st2.winner.kind, 'science');
}
// 7. seven-wonder cap: the last unbuilt wonder is lost
{
  const st = fresh(); st.players[0].coins = 99; st.players[1].coins = 99;
  for (const p of [0, 1]) give(st, p, 'sawmill', 'brickyard', 'shelf_quarry', 'glassblower', 'drying_room');
  let built = 0, guard = 0;
  while (built < 7 && !st.winner && guard++ < 200) {
    if (st.pending.type !== 'turn') { apply(st, legalActions(st)[0]); continue; }
    const acts = legalActions(st).filter(a => a.type === 'wonder');
    if (acts.length) { apply(st, acts[0]); built++; } else apply(st, legalActions(st).find(a => a.type === 'discard'));
    if (st.structure.every(s => s.taken)) break;
  }
  if (built === 7) assert.equal(st.players.flatMap(p => p.wonders).filter(w => w.lost).length, 1);
}
// 8. destroy / revive / library interactions
{
  const st = fresh(); st.players[0].coins = 99; give(st, 1, 'glassblower', 'sawmill');
  st.players[0].wonders.push({ id: 'circus_maximus', built: false, under: null, lost: false }); give(st, 0, 'sawmill', 'brickyard', 'shelf_quarry', 'glassblower', 'drying_room');
  const i = put(st, 'baths'); apply(st, { type: 'wonder', slot: i, wonder: 'circus_maximus' });
  assert.equal(st.pending.type, 'destroy'); assert.deepEqual(st.pending.options, ['glassblower']);
  apply(st, { type: 'destroy', card: 'glassblower' }); assert(st.discard.includes('glassblower')); assert.equal(st.military, 1);
}
{
  const st = fresh(); st.players[0].coins = 99; give(st, 0, 'sawmill', 'brickyard', 'shelf_quarry', 'glassblower', 'drying_room');
  st.players[0].wonders.push({ id: 'mausoleum', built: false, under: null, lost: false }, { id: 'great_library', built: false, under: null, lost: false });
  st.discard.push('theater', 'altar');
  let i = put(st, 'baths'); apply(st, { type: 'wonder', slot: i, wonder: 'mausoleum' });
  assert.equal(st.pending.type, 'revive'); apply(st, { type: 'revive', card: 'theater' }); assert(st.players[0].cards.includes('theater'));
  discardUntil(st, 0);
  i = put(st, 'press'); apply(st, { type: 'wonder', slot: i, wonder: 'great_library' });
  assert.equal(st.pending.type, 'library'); assert.equal(st.pending.options.length, 3);
  apply(st, { type: 'token', token: st.pending.options[1] });
}
// 9. discard value counts yellow cards; end scoring pieces
{
  const st = fresh(); give(st, 0, 'tavern', 'stone_reserve'); const c0 = st.players[0].coins; const i = put(st, 'baths');
  apply(st, { type: 'discard', slot: i }); assert.equal(st.players[0].coins, c0 + 4);
  const s = fresh(); s.players[0].coins = 10; s.players[0].tokens.push('mathematics', 'philosophy'); give(s, 0, 'temple', 'library');
  const sc = score(s, 0); assert.equal(sc.coins, 3); assert.equal(sc.tokens, 6 + 7); assert.equal(sc.blue, 4); assert.equal(sc.green, 2);
}
// 10. weaker military chooses who starts the next age
{
  const st = fresh(); st.military = -4;  // pawn on player 0's side, so player 0 is weaker
  while (st.structure.some(s => !s.taken) && !st.winner) { const acts = legalActions(st); apply(st, acts.find(a => a.type === 'discard') || acts[0]); }
  assert.equal(st.pending.type, 'starter'); assert.equal(st.pending.player, 0);
}
console.log('rules tests passed');
