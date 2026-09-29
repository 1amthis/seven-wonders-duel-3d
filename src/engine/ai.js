// Heuristic AI: 1-ply evaluation (normal), noisy (easy) or a 2-ply minimax over visible cards (hard).
// All evaluation weights live in PARAMS so they can be tuned by self-play (see tests/tune.mjs).
import { CARD, RES } from './data.js';
import { apply, legalActions, score, production, distinctScience, hasToken, totalBuiltWonders } from './rules.js';

export const DEFAULTS = {
  coin: 0.36, build: 1.0, res1: 1.5, res2: 0.9, res3: 0.3, resCap: 3, choice: 1.02,
  milAdv: 1.15, milDanger: 2.2, sci: 1.0, chain: 0.55, wonderCap: 2.4, again: 2.5, tokens: 1.0, vp: 1.0, denial: 0.0,
};
export const SEARCH = { topK: 5, wWorst: 0.5, easyRandom: 0.5, easyNoise: 12, normalNoise: 0.8 };
export const PARAMS = { ...DEFAULTS };
export function setParams(p) { Object.assign(PARAMS, DEFAULTS, p); }

const SCI_VAL = [0, 1.5, 4, 7.5, 13, 24, 999];
const TOKEN_VAL = { agriculture: 1, architecture: 3.5, economy: 3, law: 0, masonry: 2.5, mathematics: 0, philosophy: 0, strategy: 2.5, theology: 4, urbanism: 2 };
const WONDER_DRAFT = { piraeus: 8.5, temple_of_artemis: 8, great_library: 7.2, pyramids: 8, statue_of_zeus: 6.6, circus_maximus: 6.4, appian_way: 7, mausoleum: 6, sphinx: 6.6, colossus: 6, hanging_gardens: 6.6, great_lighthouse: 6.2 };

const coinValue = c => (Math.min(c, 9) + Math.max(0, Math.min(c, 18) - 9) * 0.78 + Math.max(0, c - 18) * 0.6) * PARAMS.coin;

function side(state, p) {
  const P = PARAMS;
  const pl = state.players[p];
  const age = state.age || 1;
  const s = score(state, p);
  let v = (s.total - s.coins) * P.vp + coinValue(pl.coins) + P.build * pl.cards.length;
  // production
  const prod = production(state, p);
  const unit = age === 1 ? P.res1 : age === 2 ? P.res2 : P.res3;
  for (const r of RES) v += unit * Math.min(prod.fixed[r], P.resCap) + unit * 0.3 * Math.max(0, prod.fixed[r] - P.resCap);
  v += unit * P.choice * prod.choices.length;
  // military
  const dir = p === 0 ? 1 : -1;
  const adv = state.military * dir;
  v += adv * P.milAdv;
  if (adv <= -5) v -= (Math.abs(adv) - 4) * P.milDanger;
  if (adv >= 5) v += (adv - 4) * P.milDanger;
  // science
  v += SCI_VAL[Math.min(distinctScience(state, p), 6)] * P.sci;
  // progress tokens
  for (const t of pl.tokens) v += (TOKEN_VAL[t] || 0) * P.tokens;
  if (hasToken(state, p, 'mathematics')) v += 0.5;
  // unspent chain potential
  for (const id of pl.cards) if (CARD[id].chainOut && age < 3) v += P.chain;
  // wonders that may be lost to the 7-wonder cap
  if (totalBuiltWonders(state) >= 5) for (const w of pl.wonders) if (!w.built && !w.lost) v -= P.wonderCap;
  // pending extra turn
  if (state.again && state.pending && state.pending.player === p) v += P.again;
  return v;
}

export function evaluate(state, p) {
  if (state.winner) {
    if (state.winner.player === p) return 1e6;
    if (state.winner.player === null) return 0;
    return -1e6;
  }
  return side(state, p) - side(state, 1 - p);
}

const clone = s => { const c = structuredClone(s); c.rng = (Math.random() * 4294967295) >>> 0; return c; };

function simulate(state, action) {
  const s = clone(state);
  try { apply(s, action); } catch (e) { return null; }
  return s;
}

/** Resolve follow-up decisions of the same player greedily (1-ply) until the turn leaves them. */
function settle(state, me) {
  let guard = 0;
  while (!state.winner && state.pending && state.pending.player === me && state.pending.type !== 'turn' && guard++ < 6) {
    const acts = legalActions(state);
    let best = null, bv = -Infinity;
    for (const a of acts) {
      const s = simulate(state, a); if (!s) continue;
      const v = evaluate(s, me);
      if (v > bv) { bv = v; best = a; }
    }
    if (!best) break;
    apply(state, best);
  }
  return state;
}

export function chooseAction(state, { level = 'normal' } = {}) {
  const pend = state.pending;
  const me = pend.player;
  const acts = legalActions(state);
  if (acts.length === 1) return acts[0];

  if (pend.type === 'draft') {
    let best = null, bv = -1;
    for (const a of acts) {
      const v = WONDER_DRAFT[a.wonder] + Math.random() * (level === 'easy' ? 5 : 1.0);
      if (v > bv) { bv = v; best = a; }
    }
    return best;
  }
  if (pend.type === 'starter') return acts.find(a => a.first === me) || acts[0];

  if (level === 'easy' && Math.random() < SEARCH.easyRandom) {
    const builds = acts.filter(a => a.type === 'build');
    const pool = builds.length && Math.random() < 0.7 ? builds : acts;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // 1-ply scoring
  const scored = [];
  for (const a of acts) {
    const s = simulate(state, a);
    if (!s) continue;
    settle(s, me);
    let v = evaluate(s, me);
    if (level === 'easy') v += (Math.random() - 0.5) * SEARCH.easyNoise;
    else if (level === 'normal') v += (Math.random() - 0.5) * SEARCH.normalNoise;
    scored.push({ a, v, s });
  }
  scored.sort((x, y) => y.v - x.v);
  if (!scored.length) return acts[0];
  if (level !== 'hard' || pend.type !== 'turn') return scored[0].a;

  // 2-ply: opponent replies with their best visible option
  const top = scored.slice(0, SEARCH.topK);
  let best = top[0], bv = -Infinity;
  for (const c of top) {
    const s = c.s;
    let val;
    if (s.winner) val = evaluate(s, me);
    else if (s.pending && s.pending.player !== me && s.pending.type === 'turn') {
      const opp = s.pending.player;
      let worst = Infinity;
      for (const oa of legalActions(s)) {
        const s2 = simulate(s, oa); if (!s2) continue;
        settle(s2, opp);
        const v = evaluate(s2, me);
        if (v < worst) worst = v;
      }
      val = worst === Infinity ? c.v : worst * SEARCH.wWorst + c.v * (1 - SEARCH.wWorst);
    } else val = c.v;
    if (val > bv) { bv = val; best = c; }
  }
  return best.a;
}
