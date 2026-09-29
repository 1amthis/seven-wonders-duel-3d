// 7 Wonders Duel — pure rules engine. The state is plain JSON (structuredClone-able) so the AI can simulate.
import { CARD, WONDER, TOKEN, TOKENS, WONDERS, AGE_CARDS, LAYOUTS, RES, MIL, MILITARY_VP, SCIENCE } from './data.js';

let EV = []; // events emitted by the action currently being applied

// ------------------------------------------------------------------ rng
export function rnd(state) {
  // mulberry32
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function shuffle(state, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(state) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ------------------------------------------------------------------ creation
export function createGame({ seed = (Math.random() * 1e9) | 0, names = ['You', 'Rival'], mode = 'ai', first } = {}) {
  const state = {
    seed, rng: seed >>> 0, mode,
    phase: 'draft', age: 0, turnNo: 0,
    current: 0, first: 0, lastPlayer: 0,
    military: 0,
    loot: { '3': true, '6': true, '-3': true, '-6': true },
    players: names.map(name => ({ name, coins: 7, cards: [], wonders: [], tokens: [] })),
    board: [], box: [],
    wonderPool: [], draft: { round: 0, pool: [], picks: 0 },
    structure: [], discard: [],
    pending: null, queue: [], again: false, winner: null,
  };
  state.first = first ?? (rnd(state) < 0.5 ? 0 : 1);
  state.current = state.first;
  const toks = shuffle(state, TOKENS.map(t => t.id));
  state.board = toks.slice(0, 5);
  state.box = toks.slice(5);
  state.wonderPool = shuffle(state, WONDERS.map(w => w.id)).slice(0, 8);
  startDraftRound(state, 1);
  return state;
}

function startDraftRound(state, round) {
  state.draft = { round, pool: state.wonderPool.slice((round - 1) * 4, round * 4), picks: 0 };
  const a = state.first, b = 1 - a;
  state.draft.order = round === 1 ? [a, b, b, a] : [b, a, a, b];
  state.pending = { type: 'draft', player: state.draft.order[0] };
  state.current = state.pending.player;
}

// ------------------------------------------------------------------ queries
export const other = p => 1 - p;
export const hasToken = (state, p, id) => state.players[p].tokens.includes(id);
export const cityCount = (state, p, colors) => state.players[p].cards.reduce((n, id) => n + (colors.includes(CARD[id].color) ? 1 : 0), 0);
export const builtWonders = (state, p) => state.players[p].wonders.filter(w => w.built).length;
export const totalBuiltWonders = state => builtWonders(state, 0) + builtWonders(state, 1);

export function ownsChain(state, p, sym) {
  return !!sym && state.players[p].cards.some(id => CARD[id].chainOut === sym);
}

export function production(state, p) {
  const fixed = { wood: 0, clay: 0, stone: 0, glass: 0, papyrus: 0 };
  const choices = [];
  const pl = state.players[p];
  for (const id of pl.cards) {
    const fx = CARD[id].fx;
    if (fx.produce) for (const r in fx.produce) fixed[r] += fx.produce[r];
    if (fx.choice) choices.push({ src: id, opts: fx.choice });
  }
  for (const w of pl.wonders) if (w.built && WONDER[w.id].fx.choice) choices.push({ src: w.id, opts: WONDER[w.id].fx.choice, wonder: true });
  return { fixed, choices };
}

// what the opponent's brown & grey cards produce (drives trading prices)
export function tradeBase(state, p) {
  const base = { wood: 0, clay: 0, stone: 0, glass: 0, papyrus: 0 };
  for (const id of state.players[p].cards) {
    const c = CARD[id];
    if ((c.color === 'brown' || c.color === 'grey') && c.fx.produce) for (const r in c.fx.produce) base[r] += c.fx.produce[r];
  }
  return base;
}
export function tradePrices(state, p) {
  const oppProd = tradeBase(state, 1 - p);
  const price = {};
  const disc = new Set();
  for (const id of state.players[p].cards) (CARD[id].fx.trade || []).forEach(r => disc.add(r));
  for (const r of RES) price[r] = disc.has(r) ? 1 : 2 + oppProd[r];
  return price;
}

export function scienceCounts(state, p) {
  const counts = {};
  for (const id of state.players[p].cards) { const s = CARD[id].fx.science; if (s) counts[s] = (counts[s] || 0) + 1; }
  if (hasToken(state, p, 'law')) counts.law = 1;
  return counts;
}
export const distinctScience = (state, p) => Object.keys(scienceCounts(state, p)).length;

// ------------------------------------------------------------------ cost
function removalCombos(need, k) {
  // all ways to remove exactly min(k,total) units from `need`
  const total = RES.reduce((s, r) => s + need[r], 0);
  const kk = Math.min(k, total);
  const out = [];
  const rec = (i, left, cur) => {
    if (i === RES.length) { if (left === 0) out.push({ ...cur }); return; }
    const r = RES[i];
    for (let n = 0; n <= Math.min(left, need[r]); n++) { cur[r] = n; rec(i + 1, left - n, cur); }
    cur[r] = 0;
  };
  rec(0, kk, {});
  return out;
}

/** Cost for player p to build item {kind:'card'|'wonder', id}. Returns the cheapest way to pay. */
export function computeCost(state, p, item) {
  const def = item.kind === 'card' ? CARD[item.id] : WONDER[item.id];
  const me = state.players[p];
  const cost = def.cost;
  if (item.kind === 'card' && def.chainIn && ownsChain(state, p, def.chainIn)) {
    return { chain: true, coins: 0, trade: 0, total: 0, affordable: true, plan: { chain: def.chainIn }, price: null };
  }
  const baseCoins = cost.coins || 0;
  const need = {};
  for (const r of RES) need[r] = cost[r] || 0;
  let reduce = 0;
  if (item.kind === 'card' && def.color === 'blue' && hasToken(state, p, 'masonry')) reduce = 2;
  if (item.kind === 'wonder' && hasToken(state, p, 'architecture')) reduce = 2;
  const prod = production(state, p);
  const price = tradePrices(state, p);

  let best = null;
  for (const red of removalCombos(need, reduce)) {
    const rem = {};
    for (const r of RES) rem[r] = need[r] - (red[r] || 0);
    const afterFixed = {};
    for (const r of RES) afterFixed[r] = Math.max(0, rem[r] - prod.fixed[r]);
    const assign = [];
    const rec = (i, cur) => {
      if (i === prod.choices.length) {
        let t = 0; for (const r of RES) t += cur[r] * price[r];
        if (!best || t < best.trade) best = { trade: t, red: { ...red }, after: { ...cur }, assign: assign.slice(), rem: { ...rem } };
        return;
      }
      const ch = prod.choices[i];
      let used = false;
      for (const r of ch.opts) {
        if (cur[r] > 0) { used = true; cur[r]--; assign[i] = r; rec(i + 1, cur); cur[r]++; }
      }
      if (!used) { assign[i] = null; rec(i + 1, cur); }
    };
    rec(0, afterFixed);
  }
  const total = baseCoins + best.trade;
  return {
    chain: false, coins: baseCoins, trade: best.trade, total,
    affordable: me.coins >= total,
    plan: { reduced: best.red, buy: best.after, choices: prod.choices.map((c, i) => ({ ...c, use: best.assign[i] })), fixed: prod.fixed, need: best.rem },
    price,
  };
}

// ------------------------------------------------------------------ helpers with events
function gainCoins(state, p, n, reason) {
  if (n <= 0) return;
  state.players[p].coins += n;
  EV.push({ t: 'coins', player: p, delta: n, total: state.players[p].coins, reason });
}
function loseCoins(state, p, n, reason) {
  const lost = Math.min(n, state.players[p].coins);
  if (lost <= 0) return 0;
  state.players[p].coins -= lost;
  EV.push({ t: 'coins', player: p, delta: -lost, total: state.players[p].coins, reason });
  return lost;
}

function setWinner(state, player, kind) {
  if (state.winner) return;
  state.winner = { player, kind };
  state.phase = 'over';
  state.pending = null;
  state.queue = [];
  EV.push({ t: 'win', player, kind });
}

function pushMilitary(state, p, n) {
  if (n <= 0) return;
  const dir = p === 0 ? 1 : -1;
  const from = state.military;
  const to = Math.max(-MIL.max, Math.min(MIL.max, from + dir * n));
  EV.push({ t: 'military', player: p, n, from, to });
  for (let i = 0; i < n && !state.winner; i++) {
    state.military = Math.max(-MIL.max, Math.min(MIL.max, state.military + dir));
    const a = state.military * dir;
    for (const th of [3, 6]) {
      const key = String(dir * th);
      if (a >= th && state.loot[key]) {
        state.loot[key] = false;
        const lost = loseCoins(state, 1 - p, MIL.lootAt[th], 'loot');
        EV.push({ t: 'loot', player: 1 - p, amount: MIL.lootAt[th], lost, token: key });
      }
    }
    if (a >= MIL.max) setWinner(state, p, 'military');
  }
}

function addScience(state, p, sym) {
  const counts = scienceCounts(state, p);
  EV.push({ t: 'science', player: p, symbol: sym, count: counts[sym] });
  if (sym !== 'law' && counts[sym] === 2 && state.board.length) state.queue.push({ type: 'token', player: p, source: 'pair' });
  if (Object.keys(counts).length >= 6) setWinner(state, p, 'science');
}

function giveToken(state, p, id, source) {
  const t = TOKEN[id];
  state.players[p].tokens.push(id);
  const bi = state.board.indexOf(id);
  if (bi >= 0) state.board.splice(bi, 1);
  EV.push({ t: 'token', player: p, token: id, source });
  if (t.coins) gainCoins(state, p, t.coins, 'token');
  if (t.science) addScience(state, p, t.science);
}

function guildCount(state, of) {
  const per = p => {
    if (of[0] === 'wonder') return builtWonders(state, p);
    if (of[0] === 'coins') return Math.floor(state.players[p].coins / 3);
    return cityCount(state, p, of);
  };
  return Math.max(per(0), per(1));
}

/** Put a card into a player's city and apply its immediate effects. */
function addCardToCity(state, p, id, how) {
  const def = CARD[id];
  const pl = state.players[p];
  pl.cards.push(id);
  const fx = def.fx;
  if (fx.coins) gainCoins(state, p, fx.coins, 'card');
  if (fx.perCard) {
    const n = fx.perCard.of[0] === 'wonder' ? builtWonders(state, p) : cityCount(state, p, fx.perCard.of);
    gainCoins(state, p, n * fx.perCard.coins, 'card');
  }
  if (fx.guild && fx.guild.coin) gainCoins(state, p, guildCount(state, fx.guild.of) * fx.guild.coin, 'guild');
  if (fx.shields) pushMilitary(state, p, fx.shields + (hasToken(state, p, 'strategy') ? 1 : 0));
  if (fx.science && !state.winner) addScience(state, p, fx.science);
  if (how === 'chain' && hasToken(state, p, 'urbanism')) gainCoins(state, p, 4, 'urbanism');
}

function payCost(state, p, cost) {
  if (cost.coins) loseCoins(state, p, cost.coins, 'build');
  if (cost.trade) {
    loseCoins(state, p, cost.trade, 'trade');
    if (hasToken(state, 1 - p, 'economy')) gainCoins(state, 1 - p, cost.trade, 'economy');
  }
}

// ------------------------------------------------------------------ structure
export function setupAge(state, age) {
  let ids;
  if (age === 3) {
    const base = shuffle(state, AGE_CARDS[3].map(c => c.id)).slice(0, 17);
    const guilds = shuffle(state, AGE_CARDS.guilds.map(c => c.id)).slice(0, 3);
    ids = shuffle(state, [...base, ...guilds]);
  } else ids = shuffle(state, AGE_CARDS[age].map(c => c.id)).slice(0, 20);
  const layout = LAYOUTS[age];
  state.structure = layout.map((s, i) => ({ card: ids[i], row: s.row, x: s.x, up: s.up, taken: false, coveredBy: [] }));
  state.structure.forEach((a, i) => state.structure.forEach((b, j) => {
    if (b.row === a.row + 1 && Math.abs(b.x - a.x) < 0.99) a.coveredBy.push(j);
  }));
  state.age = age;
  state.phase = 'play';
  EV.push({ t: 'ageStart', age });
}

export const isAccessible = (state, i) => {
  const s = state.structure[i];
  return !s.taken && s.coveredBy.every(j => state.structure[j].taken);
};
export const accessibleSlots = state => state.structure.map((_, i) => i).filter(i => isAccessible(state, i));

// ------------------------------------------------------------------ turn flow
function advance(state) {
  while (!state.winner) {
    if (state.queue.length) {
      const q = state.queue.shift();
      if (q.type === 'destroy') {
        q.options = state.players[1 - q.player].cards.filter(id => CARD[id].color === q.color);
        if (!q.options.length) continue;
      } else if (q.type === 'revive') {
        q.options = state.discard.slice();
        if (!q.options.length) continue;
      } else if (q.type === 'library') {
        q.options = shuffle(state, state.box).slice(0, 3);
        if (!q.options.length) continue;
        EV.push({ t: 'library', player: q.player, options: q.options });
      } else if (q.type === 'token') {
        q.options = state.board.slice();
        if (!q.options.length) continue;
      }
      state.pending = q;
      state.current = q.player;
      return;
    }
    finishTurn(state);
    return;
  }
}

function finishTurn(state) {
  // reveal newly accessible cards
  state.structure.forEach((s, i) => {
    if (!s.taken && !s.up && isAccessible(state, i)) { s.up = true; EV.push({ t: 'flip', slot: i, card: s.card }); }
  });
  if (state.structure.every(s => s.taken)) { state.again = false; endAge(state); return; }
  const cur = state.current;
  if (state.again) { state.again = false; EV.push({ t: 'again', player: cur }); }
  else state.current = 1 - cur;
  state.pending = { type: 'turn', player: state.current };
  state.turnNo++;
  EV.push({ t: 'turn', player: state.current });
}

function endAge(state) {
  EV.push({ t: 'ageEnd', age: state.age });
  if (state.age >= 3) { finalScoring(state); return; }
  const mil = state.military;
  const chooser = mil > 0 ? 1 : mil < 0 ? 0 : state.lastPlayer; // weaker military decides (centre: last player)
  state.phase = 'between';
  state.pending = { type: 'starter', player: chooser };
  state.current = chooser;
}

function finalScoring(state) {
  const s0 = score(state, 0), s1 = score(state, 1);
  let player = null;
  if (s0.total !== s1.total) player = s0.total > s1.total ? 0 : 1;
  else if (s0.blue !== s1.blue) player = s0.blue > s1.blue ? 0 : 1;
  state.final = [s0, s1];
  if (player === null) { state.winner = { player: null, kind: 'draw' }; }
  else state.winner = { player, kind: 'civil' };
  state.phase = 'over';
  state.pending = null;
  EV.push({ t: 'win', player, kind: player === null ? 'draw' : 'civil' });
}

export function score(state, p) {
  const pl = state.players[p];
  const out = { military: 0, blue: 0, green: 0, yellow: 0, purple: 0, wonders: 0, tokens: 0, coins: 0, total: 0 };
  if ((p === 0 && state.military > 0) || (p === 1 && state.military < 0)) out.military = MILITARY_VP(state.military);
  for (const id of pl.cards) {
    const c = CARD[id];
    if (c.color === 'purple') {
      const g = c.fx.guild;
      out.purple += guildCount(state, g.of) * g.vp;
    } else if (c.fx.vp) out[c.color] = (out[c.color] || 0) + c.fx.vp;
  }
  for (const w of pl.wonders) if (w.built) out.wonders += WONDER[w.id].vp;
  for (const t of pl.tokens) out.tokens += TOKEN[t].vp;
  if (pl.tokens.includes('mathematics')) out.tokens += 3 * pl.tokens.length;
  out.coins = Math.floor(pl.coins / 3);
  out.total = out.military + out.blue + out.green + out.yellow + out.purple + out.wonders + out.tokens + out.coins;
  return out;
}

// ------------------------------------------------------------------ actions
export function legalActions(state) {
  const p = state.pending;
  if (!p || state.winner) return [];
  const acts = [];
  switch (p.type) {
    case 'draft': for (const w of state.draft.pool) acts.push({ type: 'draft', wonder: w }); break;
    case 'starter': acts.push({ type: 'starter', first: p.player }, { type: 'starter', first: 1 - p.player }); break;
    case 'token': case 'library': for (const t of p.options) acts.push({ type: 'token', token: t }); break;
    case 'destroy': for (const c of p.options) acts.push({ type: 'destroy', card: c }); break;
    case 'revive': for (const c of p.options) acts.push({ type: 'revive', card: c }); break;
    case 'turn': {
      const pl = state.players[p.player];
      const canWonder = totalBuiltWonders(state) < 7;
      for (const i of accessibleSlots(state)) {
        const id = state.structure[i].card;
        if (computeCost(state, p.player, { kind: 'card', id }).affordable) acts.push({ type: 'build', slot: i });
        acts.push({ type: 'discard', slot: i });
        if (canWonder) for (const w of pl.wonders) if (!w.built && !w.lost && computeCost(state, p.player, { kind: 'wonder', id: w.id }).affordable) acts.push({ type: 'wonder', slot: i, wonder: w.id });
      }
      break;
    }
  }
  return acts;
}

/** Apply an action. Returns the list of events it produced. Throws on illegal actions. */
export function apply(state, action) {
  EV = [];
  const p = state.pending;
  if (!p || state.winner) throw new Error('No action pending');
  const me = p.player;
  switch (action.type) {
    case 'draft': {
      if (p.type !== 'draft' || !state.draft.pool.includes(action.wonder)) throw new Error('Illegal draft pick');
      state.draft.pool.splice(state.draft.pool.indexOf(action.wonder), 1);
      state.players[me].wonders.push({ id: action.wonder, built: false, under: null, lost: false });
      EV.push({ t: 'draft', player: me, wonder: action.wonder });
      state.draft.picks++;
      if (state.draft.picks < 4) {
        state.pending = { type: 'draft', player: state.draft.order[state.draft.picks] };
        state.current = state.pending.player;
      } else if (state.draft.round === 1) {
        startDraftRound(state, 2);
      } else {
        state.current = state.first;
        state.lastPlayer = state.first;
        setupAge(state, 1);
        state.pending = { type: 'turn', player: state.current };
        EV.push({ t: 'turn', player: state.current });
      }
      break;
    }
    case 'starter': {
      if (p.type !== 'starter') throw new Error('Not choosing starter');
      state.first = action.first;
      state.current = state.first;
      EV.push({ t: 'starter', chooser: me, first: action.first });
      setupAge(state, state.age + 1);
      state.pending = { type: 'turn', player: state.current };
      EV.push({ t: 'turn', player: state.current });
      break;
    }
    case 'build': {
      if (p.type !== 'turn' || !isAccessible(state, action.slot)) throw new Error('Card not accessible');
      const slot = state.structure[action.slot];
      const cost = computeCost(state, me, { kind: 'card', id: slot.card });
      if (!cost.affordable) throw new Error('Cannot afford');
      slot.taken = true;
      state.lastPlayer = me;
      EV.push({ t: 'build', player: me, card: slot.card, slot: action.slot, cost: { coins: cost.coins, trade: cost.trade, chain: cost.chain } });
      payCost(state, me, cost);
      addCardToCity(state, me, slot.card, cost.chain ? 'chain' : 'paid');
      advance(state);
      break;
    }
    case 'discard': {
      if (p.type !== 'turn' || !isAccessible(state, action.slot)) throw new Error('Card not accessible');
      const slot = state.structure[action.slot];
      slot.taken = true;
      state.lastPlayer = me;
      const gain = 2 + cityCount(state, me, ['yellow']);
      state.discard.push(slot.card);
      EV.push({ t: 'discard', player: me, card: slot.card, slot: action.slot, coins: gain });
      gainCoins(state, me, gain, 'discard');
      advance(state);
      break;
    }
    case 'wonder': {
      if (p.type !== 'turn' || !isAccessible(state, action.slot)) throw new Error('Card not accessible');
      if (totalBuiltWonders(state) >= 7) throw new Error('All wonders built');
      const w = state.players[me].wonders.find(x => x.id === action.wonder && !x.built && !x.lost);
      if (!w) throw new Error('Wonder unavailable');
      const cost = computeCost(state, me, { kind: 'wonder', id: w.id });
      if (!cost.affordable) throw new Error('Cannot afford wonder');
      const slot = state.structure[action.slot];
      slot.taken = true;
      state.lastPlayer = me;
      w.built = true; w.under = slot.card;
      EV.push({ t: 'wonder', player: me, wonder: w.id, card: slot.card, slot: action.slot, cost: { coins: cost.coins, trade: cost.trade } });
      payCost(state, me, cost);
      const def = WONDER[w.id], fx = def.fx;
      if (fx.coins) gainCoins(state, me, fx.coins, 'wonder');
      if (fx.oppLoseCoins) { const lost = loseCoins(state, 1 - me, fx.oppLoseCoins, 'wonder'); EV.push({ t: 'steal', player: me, amount: lost }); }
      if (fx.shields) pushMilitary(state, me, fx.shields);
      if (fx.again || hasToken(state, me, 'theology')) state.again = true;
      if (!state.winner) {
        if (fx.destroy) state.queue.push({ type: 'destroy', player: me, color: fx.destroy });
        if (fx.library) state.queue.push({ type: 'library', player: me });
        if (fx.revive) state.queue.push({ type: 'revive', player: me });
      }
      if (totalBuiltWonders(state) >= 7) {
        for (const pp of state.players) for (const ww of pp.wonders) if (!ww.built && !ww.lost) { ww.lost = true; EV.push({ t: 'wonderLost', wonder: ww.id }); }
      }
      advance(state);
      break;
    }
    case 'token': {
      if (p.type !== 'token' && p.type !== 'library') throw new Error('No token pending');
      if (!p.options.includes(action.token)) throw new Error('Token unavailable');
      giveToken(state, me, action.token, p.type === 'library' ? 'library' : 'pair');
      if (p.type === 'library') state.box = state.box.filter(t => t !== action.token);
      advance(state);
      break;
    }
    case 'destroy': {
      if (p.type !== 'destroy' || !p.options.includes(action.card)) throw new Error('Illegal destroy target');
      const opp = state.players[1 - me];
      opp.cards.splice(opp.cards.indexOf(action.card), 1);
      state.discard.push(action.card);
      EV.push({ t: 'destroy', player: me, victim: 1 - me, card: action.card });
      advance(state);
      break;
    }
    case 'revive': {
      if (p.type !== 'revive' || !p.options.includes(action.card)) throw new Error('Illegal revive');
      state.discard.splice(state.discard.indexOf(action.card), 1);
      EV.push({ t: 'revive', player: me, card: action.card });
      addCardToCity(state, me, action.card, 'free');
      advance(state);
      break;
    }
    default: throw new Error('Unknown action ' + action.type);
  }
  return EV;
}

// ------------------------------------------------------------------ summaries for UI / AI
export function citySummary(state, p) {
  const pl = state.players[p];
  const prod = production(state, p);
  const byColor = {};
  for (const id of pl.cards) byColor[CARD[id].color] = (byColor[CARD[id].color] || 0) + 1;
  const shields = pl.cards.reduce((s, id) => s + (CARD[id].fx.shields || 0), 0);
  return { prod, byColor, shields, science: scienceCounts(state, p), price: tradePrices(state, p) };
}
