// Online play without a network: room codes, input hygiene, and two MatchSync instances playing whole games against
// each other over a fake link that loses messages, reconnects and reloads.
import assert from 'node:assert/strict';
import { createGame, apply, legalActions } from '../src/engine/rules.js';
import { MatchSync, makeCode, parseCode, cleanName, cleanAction, isLegal, parseStart, stateHash, replay, newMatchState, CODE_ALPHABET, CODE_LEN } from '../src/net/protocol.js';

// ---- room codes
{
  for (let i = 0; i < 200; i++) { const c = makeCode(); assert.equal(c.length, CODE_LEN); assert([...c].every(ch => CODE_ALPHABET.includes(ch)), c); assert.equal(parseCode(c), c); }
  assert.equal(parseCode('k7qf2'), 'K7QF2');
  assert.equal(parseCode(' k7 qf-2 '), 'K7QF2');
  assert.equal(parseCode('https://1amthis.github.io/seven-wonders-duel-3d/?join=K7QF2'), 'K7QF2');
  assert.equal(parseCode('https://example.com/?x=1&join=abcd2#top'), 'ABCD2');
  assert.equal(parseCode('K7QF'), null);
  assert.equal(parseCode('K7QF2X'), null);
  assert.equal(parseCode(''), null);
  assert.equal(parseCode(null), null);
  assert(!/[01OI]/.test(CODE_ALPHABET), 'ambiguous characters in the alphabet');
}

// ---- names and actions from the other browser are untrusted
{
  { const n = cleanName('<img src=x onerror=alert(1)>'); assert(n.length > 0 && n.length <= 14 && !/[<>&"'`]/.test(n), n); }
  assert(!/[<>&"'`]/.test(cleanName('<b>"Bob" & \'Al\'</b>')));
  assert.equal(cleanName('   '), 'Player');
  assert.equal(cleanName(undefined, 'Guest'), 'Guest');
  assert.equal(cleanName('a'.repeat(40)).length, 14);
  assert.deepEqual(cleanAction({ type: 'build', slot: 3, evil: 'x', __proto__: { y: 1 } }), { type: 'build', slot: 3 });
  assert.equal(cleanAction('build'), null);
  assert.equal(cleanAction({ slot: 1 }), null);

  const st = createGame({ seed: 5, names: ['A', 'B'] });
  const p = st.pending.player;
  const good = legalActions(st)[0];
  assert(isLegal(st, good, p));
  assert(isLegal(st, { ...good, junk: 1 }, p), 'unknown fields are ignored, not fatal');
  assert(!isLegal(st, good, 1 - p), 'the wrong player cannot move');
  assert(!isLegal(st, { type: 'draft', wonder: 'nope' }, p));
  assert(!isLegal(st, { type: 'build', slot: 0 }, p), 'a build during the draft');
  assert(!isLegal(st, null, p));
  assert(!isLegal(null, good, p));

  const cfg = { seed: 9, first: 1, names: ['<i>x</i>', 'Bo'] };
  const ok = parseStart({ t: 'start', ...cfg, log: [] });
  assert.equal(ok.cfg.names[0], 'ix/i');
  for (const bad of [null, {}, { ...cfg, seed: 1.5, log: [] }, { ...cfg, first: 2, log: [] }, { ...cfg, names: ['a'], log: [] }, { ...cfg, log: 'x' }, { ...cfg, log: [1] }, { ...cfg, log: new Array(601).fill({ type: 'draft' }) }]) assert.equal(parseStart(bad), null, JSON.stringify(bad).slice(0, 60));
}

// ---- a fake link between two players
const tick = () => new Promise(r => setImmediate(r));
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class Match {
  constructor(seed) {
    this.rand = mulberry(seed * 7919 + 1);
    this.cfg = { seed, first: seed % 2, names: ['Ann', 'Bob'] };
    this.up = true; this.q = [[], []]; this.sent = 0; this.problems = [];
    this.sides = [0, 1].map(seat => {
      const s = { seat, epoch: 0, sync: null, hashes: [] };
      this.attach(s, new MatchSync({ seat, send: m => this.send(seat, m) }));
      return s;
    });
    this.host = this.sides[0]; this.guest = this.sides[1];
    this.host.sync.begin(this.cfg);
    this.guestReceives(this.host.sync.startMsg());
  }
  attach(side, sync) {
    side.sync = sync;
    sync.onGap = () => this.problems.push(`gap@${side.seat}`);
    sync.onBad = () => this.problems.push(`bad@${side.seat}`);
    sync.onDesync = () => this.problems.push(`desync@${side.seat}`);
  }
  send(from, m) {
    if (!this.up) return false;
    this.sent++;
    const copy = JSON.parse(JSON.stringify(m)); // what the wire does to it
    this.q[1 - from].push(copy);
    setImmediate(() => this.deliver(1 - from));
    return true;
  }
  deliver(to) {
    const m = this.q[to].shift();
    if (!m) return;
    if (to === 0) {
      if (m.t === 'move') this.host.sync.receiveMove(m);
      else if (m.t === 'hello') this.send(0, this.host.sync.startMsg());
    } else if (m.t === 'move') this.guest.sync.receiveMove(m);
    else if (m.t === 'start') this.guestReceives(m);
  }
  guestReceives(m) {
    const r = this.guest.sync.receiveStart(m);
    assert(r, 'the host sent a match the guest rejected');
    if (r === 'rebuild' && this.guest.running) this.run(this.guest); // a loop that was playing keeps playing on the rebuilt state
  }
  /** Connection lost: whatever is in flight is gone. */
  cut() { this.up = false; this.q = [[], []]; }
  /** Connection back: the guest says hello, the host answers with the whole match. */
  reconnect() { this.up = true; this.send(1, { t: 'hello', name: 'Bob' }); }
  run(side) {
    const my = ++side.epoch; side.running = true;
    side.done = (async () => {
      for (;;) {
        const s = side.sync;
        if (my !== side.epoch || s.state.winner) return;
        const actor = s.state.pending.player;
        let a;
        if (actor === side.seat) { const acts = legalActions(s.state); a = acts[Math.floor(this.rand() * acts.length)]; for (let i = Math.floor(this.rand() * 3); i >= 0; i--) await tick(); } // "animations"
        else a = await s.nextRemote();
        if (my !== side.epoch) return;
        s.play(a, actor);
        side.hashes[s.log.length] = stateHash(s.state);
      }
    })();
    return side.done;
  }
  async settle() { for (let i = 0; i < 50; i++) await tick(); }
}

const finished = m => m.sides.every(s => s.sync.state.winner);
async function untilDone(m, limitMs = 20000) {
  const t0 = Date.now();
  while (!finished(m)) { await tick(); assert(Date.now() - t0 < limitMs, 'match did not finish: ' + JSON.stringify({ log: m.sides.map(s => s.sync.log.length), problems: m.problems })); }
  await m.settle();
}
function assertSame(m, label) {
  const [h, g] = m.sides.map(s => s.sync);
  assert.deepEqual(h.log, g.log, label + ': logs differ');
  assert.equal(stateHash(h.state), stateHash(g.state), label + ': states differ');
  assert.deepEqual(m.problems, [], label + ': ' + m.problems.join(','));
}

// ---- clean games: both ends agree after every move
for (let seed = 1; seed <= 25; seed++) {
  const m = new Match(seed);
  m.run(m.host); m.run(m.guest);
  await untilDone(m);
  assertSame(m, 'seed ' + seed);
  const h = m.host, total = h.sync.log.length;
  assert(total > 60, 'a whole duel is dozens of moves, got ' + total);
  assert.deepEqual(h.hashes.filter((x, i) => i).length, m.guest.hashes.filter((x, i) => i).length);
  // every prefix of the log replays to the state the players actually had
  for (const k of [0, 1, 7, 8, 31, total >> 1, total - 1, total]) {
    const hashAt = k === 0 ? stateHash(newMatchState(m.cfg)) : h.hashes[k];
    assert.equal(stateHash(replay(m.cfg, h.sync.log.slice(0, k))), hashAt, `seed ${seed}: replay of ${k} moves`);
  }
}

// ---- the link dies and comes back at random moments
for (let seed = 100; seed < 140; seed++) {
  const m = new Match(seed);
  m.run(m.host); m.run(m.guest);
  const cutAt = 3 + Math.floor(mulberry(seed)() * 50);
  while (m.host.sync.log.length + m.guest.sync.log.length < 2 * cutAt && !finished(m)) await tick();
  m.cut();
  for (let i = 0; i < 6; i++) await tick(); // moves made while offline stay local
  m.reconnect();
  await untilDone(m);
  // a loop that was waiting on a lost move may be stuck on a state the reconcile replaced: assertSame is the judge
  assertSame(m, 'cut at ' + cutAt + ' seed ' + seed);
}

// ---- a lost move is not lost: the side that made it still has it, and re-sends it
{
  const m = new Match(7);
  // play the draft by hand: 8 picks, no loops
  const pick = (side, i = 0) => { const s = side.sync; const a = legalActions(s.state)[i]; s.play(a, s.state.pending.player); return a; };
  const sideOf = seat => m.sides[seat];
  for (let i = 0; i < 3; i++) {
    const actor = m.host.sync.state.pending.player;
    pick(sideOf(actor)); await m.settle();
    // the other side has to "wait" to consume it
    const other = sideOf(1 - actor).sync; const w = other.nextRemote(); await m.settle(); const a = await w; other.play(a, actor);
  }
  assertSame(m, 'manual draft');
  // now the guest (or host) whose turn it is moves while the link is down
  m.cut();
  const actor = m.host.sync.state.pending.player, mover = sideOf(actor), waiter = sideOf(1 - actor);
  const made = pick(mover);
  assert.equal(mover.sync.log.length, waiter.sync.log.length + 1);
  m.reconnect(); await m.settle();
  if (actor === 1) {
    // the guest was ahead: it kept its state and re-sent, so the host can now read the move
    const a = await waiter.sync.nextRemote();
    assert.deepEqual(a, made);
    waiter.sync.play(a, actor);
  } else {
    // the host was ahead: the guest rebuilt from the host's log and is level again
    assert.equal(waiter.sync.log.length, mover.sync.log.length);
  }
  assertSame(m, 'after the lost move');
}

// ---- reload: a guest with no memory, and a host restored from its saved log
{
  const m = new Match(11);
  m.run(m.host); m.run(m.guest);
  while (m.host.sync.log.length < 14) await tick();
  // guest reloads the page: brand new MatchSync, says hello, gets the match
  m.guest.epoch++;
  m.attach(m.guest, new MatchSync({ seat: 1, send: x => m.send(1, x) }));
  m.q = [[], []];
  m.send(1, { t: 'hello', name: 'Bob' });
  // host reloads too, from what it saved (config + log)
  const saved = JSON.parse(JSON.stringify({ cfg: m.host.sync.cfg, log: m.host.sync.log }));
  m.host.epoch++;
  m.attach(m.host, new MatchSync({ seat: 0, send: x => m.send(0, x) }));
  m.host.sync.begin(saved.cfg, saved.log);
  m.run(m.host);
  await m.settle();
  // the guest's hello went to the old host object's queue: say it again to the new one
  m.send(1, { t: 'hello', name: 'Bob' });
  await untilDone(m);
  assertSame(m, 'reload');
}

// ---- detection: drift, a move from the future, an illegal move
{
  const m = new Match(3);
  const s0 = m.host.sync, s1 = m.guest.sync;
  const actor = s0.state.pending.player;
  const me = m.sides[actor].sync, you = m.sides[1 - actor].sync;
  // drift: the receiver's copy of the state is not what the sender has
  const a = legalActions(me.state)[0];
  me.play(a, actor);
  await m.settle();
  const w = you.nextRemote(); await m.settle(); await w;
  you.state.rng ^= 1; // the two copies of the game are no longer the same
  you.play(a, actor);
  assert(m.problems.some(p => p.startsWith('desync')), 'drift goes unnoticed');
}
{
  const m = new Match(4);
  const actor = m.host.sync.state.pending.player, me = m.sides[actor].sync, you = m.sides[1 - actor].sync;
  you.receiveMove({ t: 'move', n: 5, a: legalActions(me.state)[0], h: null }); // skipped ahead
  you.nextRemote();
  assert(m.problems.some(p => p.startsWith('gap')), 'a gap goes unnoticed');
}
{
  const m = new Match(5);
  const actor = m.host.sync.state.pending.player, me = m.sides[actor].sync, you = m.sides[1 - actor].sync;
  you.nextRemote();
  you.receiveMove({ t: 'move', n: 0, a: { type: 'draft', wonder: 'not_a_wonder' }, h: null });
  assert(m.problems.some(p => p.startsWith('bad')), 'an illegal move goes unnoticed');
  // and the player who is NOT on turn cannot move for the one who is
  const m2 = new Match(6);
  const turn = m2.host.sync.state.pending.player, mover = m2.sides[turn].sync, listener = m2.sides[1 - turn].sync;
  mover.nextRemote(); // the player on turn listens, so anything arriving is "from the other seat"
  mover.receiveMove({ t: 'move', n: 0, a: legalActions(mover.state)[0], h: null });
  assert(m2.problems.some(p => p.startsWith('bad')), 'moved out of turn');
  void listener;
}

console.log('net tests OK');
