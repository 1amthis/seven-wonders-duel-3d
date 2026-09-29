// Static game data: buildings, wonders, progress tokens, structure layouts.
// (Fan-made tribute — all artwork is procedurally generated; rules follow the published game.)

export const RES = ['wood', 'clay', 'stone', 'glass', 'papyrus'];
export const RAW = ['wood', 'clay', 'stone'];
export const MANU = ['glass', 'papyrus'];
export const COLORS = ['brown', 'grey', 'yellow', 'blue', 'green', 'red', 'purple'];
export const SCIENCE = ['wheel', 'mortar', 'quill', 'square', 'sundial', 'astrolabe'];

export const COLOR_HEX = {
  brown: '#8b5a2b', grey: '#9aa3ad', blue: '#2f6db5', green: '#3f9a4c',
  yellow: '#e0b030', red: '#b83030', purple: '#7b3fa0',
};
export const COLOR_NAME = {
  brown: 'Raw material', grey: 'Manufactured good', blue: 'Civilian', green: 'Scientific',
  yellow: 'Commercial', red: 'Military', purple: 'Guild',
};

const card = (age, id, name, color, cost, o = {}) => ({ id, name, age, color, cost, chainIn: null, chainOut: null, fx: {}, ...o });

// ---------------------------------------------------------------- AGE I
const AGE1 = [
  card(1, 'lumber_yard', 'Lumber Yard', 'brown', {}, { fx: { produce: { wood: 1 } } }),
  card(1, 'logging_camp', 'Logging Camp', 'brown', { coins: 1 }, { fx: { produce: { wood: 1 } } }),
  card(1, 'clay_pool', 'Clay Pool', 'brown', {}, { fx: { produce: { clay: 1 } } }),
  card(1, 'clay_pit', 'Clay Pit', 'brown', { coins: 1 }, { fx: { produce: { clay: 1 } } }),
  card(1, 'quarry', 'Quarry', 'brown', {}, { fx: { produce: { stone: 1 } } }),
  card(1, 'stone_pit', 'Stone Pit', 'brown', { coins: 1 }, { fx: { produce: { stone: 1 } } }),
  card(1, 'glassworks', 'Glassworks', 'grey', { coins: 1 }, { fx: { produce: { glass: 1 } } }),
  card(1, 'press', 'Press', 'grey', { coins: 1 }, { fx: { produce: { papyrus: 1 } } }),

  card(1, 'theater', 'Theater', 'blue', {}, { fx: { vp: 3 }, chainOut: 'mask' }),
  card(1, 'altar', 'Altar', 'blue', {}, { fx: { vp: 3 }, chainOut: 'moon' }),
  card(1, 'baths', 'Baths', 'blue', { stone: 1 }, { fx: { vp: 3 }, chainOut: 'drop' }),

  card(1, 'guard_tower', 'Guard Tower', 'red', {}, { fx: { shields: 1 } }),
  card(1, 'stable', 'Stable', 'red', { wood: 1 }, { fx: { shields: 1 }, chainOut: 'horseshoe' }),
  card(1, 'garrison', 'Garrison', 'red', { clay: 1 }, { fx: { shields: 1 }, chainOut: 'sword' }),
  card(1, 'palisade', 'Palisade', 'red', { coins: 2 }, { fx: { shields: 1 }, chainOut: 'fort' }),

  card(1, 'workshop', 'Workshop', 'green', { papyrus: 1 }, { fx: { science: 'square', vp: 1 }, chainOut: 'lamp' }),
  card(1, 'apothecary', 'Apothecary', 'green', { glass: 1 }, { fx: { science: 'wheel', vp: 1 }, chainOut: 'abacus' }),
  card(1, 'scriptorium', 'Scriptorium', 'green', { coins: 2 }, { fx: { science: 'quill' }, chainOut: 'book' }),
  card(1, 'pharmacist', 'Pharmacist', 'green', { coins: 2 }, { fx: { science: 'mortar' }, chainOut: 'vial' }),

  card(1, 'stone_reserve', 'Stone Reserve', 'yellow', { coins: 3 }, { fx: { trade: ['stone'] } }),
  card(1, 'clay_reserve', 'Clay Reserve', 'yellow', { coins: 3 }, { fx: { trade: ['clay'] } }),
  card(1, 'wood_reserve', 'Wood Reserve', 'yellow', { coins: 3 }, { fx: { trade: ['wood'] } }),
  card(1, 'tavern', 'Tavern', 'yellow', {}, { fx: { coins: 4 } }),
];

// ---------------------------------------------------------------- AGE II
const AGE2 = [
  card(2, 'sawmill', 'Sawmill', 'brown', { coins: 2 }, { fx: { produce: { wood: 2 } } }),
  card(2, 'brickyard', 'Brickyard', 'brown', { coins: 2 }, { fx: { produce: { clay: 2 } } }),
  card(2, 'shelf_quarry', 'Shelf Quarry', 'brown', { coins: 2 }, { fx: { produce: { stone: 2 } } }),
  card(2, 'glassblower', 'Glassblower', 'grey', {}, { fx: { produce: { glass: 1 } } }),
  card(2, 'drying_room', 'Drying Room', 'grey', {}, { fx: { produce: { papyrus: 1 } } }),

  card(2, 'courthouse', 'Courthouse', 'blue', { wood: 2, glass: 1 }, { fx: { vp: 5 } }),
  card(2, 'statue', 'Statue', 'blue', { clay: 2 }, { fx: { vp: 4 }, chainIn: 'mask', chainOut: 'pillar' }),
  card(2, 'temple', 'Temple', 'blue', { wood: 1, papyrus: 1 }, { fx: { vp: 4 }, chainIn: 'moon', chainOut: 'sun' }),
  card(2, 'aqueduct', 'Aqueduct', 'blue', { stone: 3 }, { fx: { vp: 5 }, chainIn: 'drop' }),
  card(2, 'rostrum', 'Rostrum', 'blue', { stone: 1, wood: 1 }, { fx: { vp: 4 }, chainOut: 'laurel' }),

  card(2, 'walls', 'Walls', 'red', { stone: 2 }, { fx: { shields: 2 } }),
  card(2, 'horse_breeders', 'Horse Breeders', 'red', { clay: 1, wood: 1 }, { fx: { shields: 1 }, chainIn: 'horseshoe' }),
  card(2, 'barracks', 'Barracks', 'red', { coins: 3 }, { fx: { shields: 1 }, chainIn: 'sword' }),
  card(2, 'archery_range', 'Archery Range', 'red', { stone: 1, wood: 1, papyrus: 1 }, { fx: { shields: 2 }, chainOut: 'target' }),
  card(2, 'parade_ground', 'Parade Ground', 'red', { clay: 2, glass: 1 }, { fx: { shields: 2 }, chainOut: 'helmet' }),

  card(2, 'library', 'Library', 'green', { stone: 1, wood: 1, glass: 1 }, { fx: { science: 'quill', vp: 2 }, chainIn: 'book', chainOut: 'scroll' }),
  card(2, 'dispensary', 'Dispensary', 'green', { clay: 2, stone: 1 }, { fx: { science: 'mortar', vp: 2 }, chainIn: 'vial', chainOut: 'arena' }),
  card(2, 'school', 'School', 'green', { wood: 1, papyrus: 2 }, { fx: { science: 'wheel', vp: 1 }, chainIn: 'abacus', chainOut: 'compass' }),
  card(2, 'laboratory', 'Laboratory', 'green', { wood: 1, glass: 2 }, { fx: { science: 'square', vp: 1 }, chainIn: 'lamp', chainOut: 'telescope' }),

  card(2, 'forum', 'Forum', 'yellow', { coins: 3, clay: 1 }, { fx: { choice: ['glass', 'papyrus'] }, chainOut: 'scales' }),
  card(2, 'caravansery', 'Caravansery', 'yellow', { coins: 2, glass: 1, papyrus: 1 }, { fx: { choice: ['wood', 'clay', 'stone'] }, chainOut: 'lighthouse' }),
  card(2, 'customs_house', 'Customs House', 'yellow', { coins: 4 }, { fx: { trade: ['glass', 'papyrus'] }, chainOut: 'anchor' }),
  card(2, 'brewery', 'Brewery', 'yellow', {}, { fx: { coins: 6 } }),
];

// ---------------------------------------------------------------- AGE III
const AGE3 = [
  card(3, 'palace', 'Palace', 'blue', { clay: 1, stone: 1, wood: 1, glass: 2 }, { fx: { vp: 7 } }),
  card(3, 'town_hall', 'Town Hall', 'blue', { stone: 3, wood: 2 }, { fx: { vp: 7 } }),
  card(3, 'obelisk', 'Obelisk', 'blue', { stone: 2, glass: 1 }, { fx: { vp: 5 } }),
  card(3, 'gardens', 'Gardens', 'blue', { clay: 2, wood: 2 }, { fx: { vp: 6 }, chainIn: 'pillar' }),
  card(3, 'pantheon', 'Pantheon', 'blue', { clay: 1, wood: 1, papyrus: 2 }, { fx: { vp: 6 }, chainIn: 'sun' }),
  card(3, 'senate', 'Senate', 'blue', { clay: 2, stone: 1, papyrus: 1 }, { fx: { vp: 5 }, chainIn: 'laurel' }),

  card(3, 'arsenal', 'Arsenal', 'red', { clay: 3, wood: 2 }, { fx: { shields: 3 } }),
  card(3, 'pretorium', 'Pretorium', 'red', { coins: 8 }, { fx: { shields: 3 } }),
  card(3, 'fortifications', 'Fortifications', 'red', { stone: 2, clay: 1, papyrus: 1 }, { fx: { shields: 2 }, chainIn: 'fort' }),
  card(3, 'siege_workshop', 'Siege Workshop', 'red', { wood: 3, glass: 1 }, { fx: { shields: 2 }, chainIn: 'target' }),
  card(3, 'circus', 'Circus', 'red', { clay: 2, stone: 2 }, { fx: { shields: 2 }, chainIn: 'helmet' }),

  card(3, 'academy', 'Academy', 'green', { stone: 1, wood: 1, glass: 2 }, { fx: { science: 'sundial', vp: 3 } }),
  card(3, 'study', 'Study', 'green', { wood: 2, glass: 1, papyrus: 1 }, { fx: { science: 'sundial', vp: 3 }, chainIn: 'compass' }),
  card(3, 'university', 'University', 'green', { clay: 1, glass: 1, papyrus: 1 }, { fx: { science: 'astrolabe', vp: 2 }, chainIn: 'scroll' }),
  card(3, 'observatory', 'Observatory', 'green', { stone: 1, papyrus: 2 }, { fx: { science: 'astrolabe', vp: 2 }, chainIn: 'telescope' }),

  card(3, 'chamber_of_commerce', 'Chamber of Commerce', 'yellow', { papyrus: 2 }, { fx: { vp: 3, perCard: { of: ['grey'], coins: 3 } }, chainIn: 'scales' }),
  card(3, 'port', 'Port', 'yellow', { wood: 1, glass: 1, papyrus: 1 }, { fx: { vp: 3, perCard: { of: ['brown'], coins: 2 } }, chainIn: 'anchor' }),
  card(3, 'armory', 'Armory', 'yellow', { stone: 2, glass: 1 }, { fx: { vp: 3, perCard: { of: ['red'], coins: 1 } } }),
  card(3, 'lighthouse', 'Lighthouse', 'yellow', { clay: 2, glass: 1 }, { fx: { vp: 3, perCard: { of: ['yellow'], coins: 1 } }, chainIn: 'lighthouse' }),
  card(3, 'arena', 'Arena', 'yellow', { clay: 1, stone: 1, wood: 1 }, { fx: { vp: 3, perCard: { of: ['wonder'], coins: 2 } }, chainIn: 'arena' }),
];

// ---------------------------------------------------------------- GUILDS
const GUILDS = [
  card(3, 'merchants_guild', 'Merchants Guild', 'purple', { clay: 1, wood: 1, glass: 1, papyrus: 1 }, { fx: { guild: { of: ['yellow'], coin: 1, vp: 1 } } }),
  card(3, 'shipowners_guild', 'Shipowners Guild', 'purple', { clay: 1, stone: 1, glass: 1, papyrus: 1 }, { fx: { guild: { of: ['brown', 'grey'], coin: 1, vp: 1 } } }),
  card(3, 'builders_guild', 'Builders Guild', 'purple', { stone: 2, clay: 1, wood: 1, glass: 2 }, { fx: { guild: { of: ['wonder'], vp: 2 } } }),
  card(3, 'magistrates_guild', 'Magistrates Guild', 'purple', { wood: 2, clay: 1, papyrus: 1 }, { fx: { guild: { of: ['blue'], coin: 1, vp: 1 } } }),
  card(3, 'scientists_guild', 'Scientists Guild', 'purple', { clay: 2, wood: 2 }, { fx: { guild: { of: ['green'], coin: 1, vp: 1 } } }),
  card(3, 'moneylenders_guild', 'Moneylenders Guild', 'purple', { stone: 2, wood: 2 }, { fx: { guild: { of: ['coins'], vp: 1 } } }),
  card(3, 'tacticians_guild', 'Tacticians Guild', 'purple', { stone: 2, wood: 1, papyrus: 1 }, { fx: { guild: { of: ['red'], coin: 1, vp: 1 } } }),
];

export const CARDS = [...AGE1, ...AGE2, ...AGE3, ...GUILDS];
export const CARD = Object.fromEntries(CARDS.map(c => [c.id, c]));
export const AGE_CARDS = { 1: AGE1, 2: AGE2, 3: AGE3, guilds: GUILDS };

// ---------------------------------------------------------------- WONDERS
const wonder = (id, name, cost, vp, fx, text) => ({ id, name, cost, vp, fx, text });
export const WONDERS = [
  wonder('appian_way', 'The Appian Way', { stone: 2, clay: 2, papyrus: 1 }, 3, { coins: 3, oppLoseCoins: 3, again: true }, 'Take 3 coins. Your opponent loses 3 coins. Play again.'),
  wonder('circus_maximus', 'Circus Maximus', { stone: 2, wood: 1, glass: 1 }, 3, { shields: 1, destroy: 'grey' }, 'Destroy a manufactured good (grey card) of your opponent. 1 shield.'),
  wonder('colossus', 'The Colossus', { clay: 3, glass: 1 }, 3, { shields: 2 }, 'Advance the conflict pawn by 2 shields.'),
  wonder('great_library', 'The Great Library', { wood: 3, glass: 1, papyrus: 1 }, 4, { library: true }, 'Draw 3 random progress tokens that are not on the board. Choose 1 and play it.'),
  wonder('great_lighthouse', 'The Great Lighthouse', { papyrus: 2, stone: 1, wood: 1 }, 4, { choice: ['wood', 'clay', 'stone'] }, 'Produces 1 raw material of your choice each turn.'),
  wonder('hanging_gardens', 'The Hanging Gardens', { wood: 2, glass: 1, papyrus: 1 }, 3, { coins: 6, again: true }, 'Take 6 coins. Play again.'),
  wonder('mausoleum', 'The Mausoleum', { clay: 2, glass: 2, papyrus: 1 }, 2, { revive: true }, 'Pick any discarded card and build it for free.'),
  wonder('piraeus', 'Piraeus', { wood: 2, clay: 1, stone: 1 }, 2, { choice: ['glass', 'papyrus'], again: true }, 'Produces 1 manufactured good of your choice each turn. Play again.'),
  wonder('pyramids', 'The Pyramids', { stone: 3, papyrus: 1 }, 9, {}, 'Nothing but glory: 9 victory points.'),
  wonder('sphinx', 'The Sphinx', { stone: 1, clay: 1, glass: 2 }, 6, { again: true }, 'Play again.'),
  wonder('statue_of_zeus', 'The Statue of Zeus', { stone: 1, wood: 1, clay: 1, papyrus: 2 }, 3, { shields: 1, destroy: 'brown' }, 'Destroy a raw material (brown card) of your opponent. 1 shield.'),
  wonder('temple_of_artemis', 'The Temple of Artemis', { wood: 1, stone: 1, glass: 1, papyrus: 1 }, 0, { coins: 12, again: true }, 'Take 12 coins. Play again.'),
];
export const WONDER = Object.fromEntries(WONDERS.map(w => [w.id, w]));

// ---------------------------------------------------------------- PROGRESS TOKENS
const token = (id, name, text, vp = 0, extra = {}) => ({ id, name, text, vp, ...extra });
export const TOKENS = [
  token('agriculture', 'Agriculture', 'Take 6 coins. Worth 4 victory points.', 4, { coins: 6 }),
  token('architecture', 'Architecture', 'Your future Wonders cost 2 fewer resources (your choice).'),
  token('economy', 'Economy', 'You gain the coins your opponent pays for trading resources.'),
  token('law', 'Law', 'Counts as a scientific symbol.', 0, { science: 'law' }),
  token('masonry', 'Masonry', 'Your future civilian (blue) buildings cost 2 fewer resources.'),
  token('mathematics', 'Mathematics', 'Worth 3 victory points per progress token you own at the end (including this one).'),
  token('philosophy', 'Philosophy', 'Worth 7 victory points.', 7),
  token('strategy', 'Strategy', 'Your future military (red) buildings have 1 extra shield.'),
  token('theology', 'Theology', 'Your future Wonders all gain the "play again" effect.'),
  token('urbanism', 'Urbanism', 'Take 6 coins. Whenever you build a building for free through a chain, gain 4 coins.', 0, { coins: 6 }),
];
export const TOKEN = Object.fromEntries(TOKENS.map(t => [t.id, t]));

// ---------------------------------------------------------------- CARD STRUCTURES
// Rows top→bottom; x offsets in card widths; `up` = initially face-up.
const tri = (counts, ups) => counts.flatMap((n, r) => Array.from({ length: n }, (_, i) => ({ row: r, x: i - (n - 1) / 2, up: ups[r] })));
export const LAYOUTS = {
  1: tri([2, 3, 4, 5, 6], [true, false, true, false, true]),
  2: tri([6, 5, 4, 3, 2], [true, false, true, false, true]),
  3: [
    ...tri([2, 3, 4], [true, false, true]),
    { row: 3, x: -1, up: false }, { row: 3, x: 1, up: false },
    ...tri([4, 3, 2], [true, false, true]).map(s => ({ ...s, row: s.row + 4 })),
  ],
};
export const AGE_NAMES = { 1: 'The Dawn of Cities', 2: 'The Age of Merchants', 3: 'The Age of Empires' };

// Military track: positive = advantage of player 0.
export const MIL = { max: 9, lootAt: { 3: 2, 6: 5 }, vpZones: [[1, 2, 2], [3, 5, 5], [6, 8, 10]] };
export const MILITARY_VP = pos => { const a = Math.abs(pos); for (const [lo, hi, v] of MIL.vpZones) if (a >= lo && a <= hi) return v; return 0; };
