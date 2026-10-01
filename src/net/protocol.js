// Online play, the part that does not touch the network: room codes, sanity checks on everything the other player
// sends, a state hash to spot drift, and MatchSync, which keeps two copies of the (deterministic) rules engine in step.
//
// Both browsers run the whole game. The only things that cross the wire are the match set-up (seed, names, who starts)
// and the moves. A match is therefore fully described by { seed, names, first } plus the ordered list of moves (the
// "log"), which is also what lets a player who reloads the page, or whose connection dropped, pick up where they were.
import { createGame, apply, legalActions } from '../engine/rules.js';

// ------------------------------------------------------------------ room codes
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0 / O / 1 / I: easy to read out loud
export const CODE_LEN = 5;
export const PEER_PREFIX = 'sw7duel-';
export const PROTOCOL = 1;

export function makeCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}
/** Accepts a bare code in any case ("k7qf2", "K7 QF2") or a pasted invite link. Returns null when it is not a valid code. */
export function parseCode(input) {
  let s = String(input ?? '');
  const m = /[?&]join=([^&#\s]+)/i.exec(s);
  if (m) s = m[1];
  s = s.toUpperCase().split('').filter(c => CODE_ALPHABET.includes(c)).join('');
  return s.length === CODE_LEN ? s : null;
}
export const peerIdFor = code => PEER_PREFIX + code;

// ------------------------------------------------------------------ untrusted input
// Names end up in innerHTML in several places, and they come from another person's browser: strip anything markup-like.
export const cleanName = (s, fallback = 'Player') => String(s ?? '').replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, 14) || fallback;

const ACTION_KEYS = ['type', 'slot', 'wonder', 'card', 'token', 'first'];
export function cleanAction(a) {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') return null;
  const out = {};
  for (const k of ACTION_KEYS) if (k in a) out[k] = a[k];
  return out;
}
const canon = a => JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]]));

/** True when `action` is one of the moves the rules allow right now, for `player`. */
export function isLegal(state, action, player) {
  if (!state?.pending || state.winner || state.pending.player !== player) return false;
  const a = cleanAction(action);
  if (!a) return false;
  const c = canon(a);
  return legalActions(state).some(l => canon(l) === c);
}

/** Checks a match description and its move list; returns a cleaned copy or null. */
export function parseStart(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const { seed, first, names, log } = msg;
  if (!Number.isInteger(seed) || (first !== 0 && first !== 1)) return null;
  if (!Array.isArray(names) || names.length !== 2 || !Array.isArray(log) || log.length > 600) return null;
  const moves = log.map(cleanAction);
  if (moves.some(a => !a)) return null;
  return { cfg: { seed, first, names: [cleanName(names[0], 'Host'), cleanName(names[1], 'Guest')] }, log: moves, force: !!msg.force };
}

// ------------------------------------------------------------------ state
/** FNV-1a over the JSON of the state: cheap, and identical on both sides as long as the engine is deterministic. */
export function stateHash(state) {
  const s = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const newMatchState = cfg => createGame({ seed: cfg.seed, names: cfg.names, mode: 'online', first: cfg.first });
export function replay(cfg, log) {
  const st = newMatchState(cfg);
  for (const a of log) apply(st, a);
  return st;
}
const isPrefix = (a, b) => a.length <= b.length && a.every((x, i) => canon(x) === canon(b[i]));
const sameCfg = (a, b) => a && b && a.seed === b.seed && a.first === b.first && a.names[0] === b.names[0] && a.names[1] === b.names[1];

// ------------------------------------------------------------------ MatchSync
/**
 * One player's side of an online match. It owns the game state and the move log and is the only thing that applies
 * moves: `play()` applies a move (and sends it, when it is ours) and `nextRemote()` waits for the other player's.
 *
 * Moves carry their index in the log and the hash of the state they lead to. If the connection drops, the host simply
 * sends its whole log again when the guest comes back (`startMsg`), and `receiveStart` reconciles the two logs: a log
 * that is behind is replaced, one that is ahead keeps its state and re-sends the moves the other side missed. Only
 * the player whose turn it is can add to a log, so two logs are always a prefix of one another.
 */
export class MatchSync {
  constructor({ seat, send }) {
    this.seat = seat; this.send = send;
    this.cfg = null; this.state = null; this.log = [];
    this.inbox = []; this.waiter = null; this.expect = null;
    // hooks
    this.onGap = null;     // a move arrived out of order: ask the host for the match again
    this.onBad = null;     // the other player sent something illegal
    this.onDesync = null;  // our state and theirs differ after the same move
    this.onChange = null;  // the log grew (persist it)
  }
  get remote() { return 1 - this.seat; }

  /** Host: start a fresh match, or restore one from a saved log. */
  begin(cfg, log = []) {
    this.cfg = cfg; this.log = log.slice(); this.inbox = []; this.waiter = null; this.expect = null;
    this.state = replay(cfg, this.log);
    return this.state;
  }
  startMsg({ force = false } = {}) {
    return { t: 'start', v: PROTOCOL, seed: this.cfg.seed, first: this.cfg.first, names: this.cfg.names, log: this.log, force };
  }

  /** Guest: the host describes the match. Returns 'rebuild' (this.state is new, restart the view) or 'keep', or null if invalid. */
  receiveStart(msg) {
    const p = parseStart(msg);
    if (!p) return null;
    if (!p.force && this.state && sameCfg(this.cfg, p.cfg) && isPrefix(p.log, this.log)) {
      // Same match and the host is not ahead of us: nothing to rebuild. If we are ahead, it missed our last moves.
      for (let i = p.log.length; i < this.log.length; i++) this.send({ t: 'move', n: i, a: this.log[i], h: null });
      return 'keep';
    }
    let state;
    try { state = replay(p.cfg, p.log); } catch { return null; }
    this.cfg = p.cfg; this.log = p.log; this.state = state;
    this.inbox = []; this.waiter = null; this.expect = null;
    return 'rebuild';
  }

  /** The other player's move arrived. It is held until the game loop asks for it. */
  receiveMove(msg) {
    if (!this.state || !msg || !Number.isInteger(msg.n) || msg.n < this.log.length) return; // too early to matter, or one we already have
    this.inbox.push(msg);
    this._wake();
  }
  nextRemote() {
    return new Promise(resolve => { this.waiter = resolve; this._wake(); });
  }
  cancel() { this.waiter = null; }
  _wake() {
    if (!this.waiter || !this.state) return;
    while (this.inbox.length) {
      const m = this.inbox.shift();
      if (m.n < this.log.length) continue;
      if (m.n > this.log.length) { this.inbox.length = 0; this.onGap?.(); return; }
      const action = cleanAction(m.a);
      if (!isLegal(this.state, action, this.remote)) { this.inbox.length = 0; this.onBad?.(m); return; }
      const w = this.waiter; this.waiter = null;
      this.expect = typeof m.h === 'string' ? m.h : null;
      w(action);
      return;
    }
  }

  /** Apply a move for `actor` (this.seat or the other player) and return the events. */
  play(action, actor) {
    const events = apply(this.state, action);
    this.log.push(action);
    const h = stateHash(this.state);
    if (actor === this.seat) this.send({ t: 'move', n: this.log.length - 1, a: action, h });
    else if (this.expect && this.expect !== h) this.onDesync?.();
    this.expect = null;
    this.onChange?.(this);
    return events;
  }
}
