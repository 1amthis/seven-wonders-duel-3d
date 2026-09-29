// World layout of the table. +x right, +z toward the camera (south), y up. 1 unit ≈ one card width.
export const CW = 1.0, CH = 1.5, CT = 0.026;      // building card
export const WW = 1.8, WH = 1.2;                   // wonder card (landscape)

export const STRUCT_SCALE = 1.15;
export const ROW_STEP = 0.72 * STRUCT_SCALE, X_PITCH = 1.08 * STRUCT_SCALE;      // card structure spacing
export const STRUCT_Z = 0.0;

export const ZONE_X = [-7.9, 7.9];                 // player zone centres
export const CITY = { scale: 0.92, pitch: 1.04, z0: -3.95, step: 0.36, maxDepth: 4.6 };
export const COLUMNS = ['brown', 'grey', 'yellow', 'blue', 'green', 'red', 'purple'];
export const WONDER_Z = 4.05;
export const TREASURY_Z = 2.05;

export const DISCARD_POS = { x: 2.7, z: 4.05 };
export const DECK_POS = { x: -2.7, z: 4.05 };

export const BOARD = { z: -6.55, d: 2.6, len: 24.2, trackZ: -6.85, lootZ: -7.52, tokenZ: -5.85, pitch: 1.0 };
export const TABLE = { w: 27.6, d: 15.6, cz: -1.45, h: 0.55 };

export function structureSlotPos(slot, nRows) {
  return { x: slot.x * X_PITCH, z: STRUCT_Z + (slot.row - (nRows - 1) / 2) * ROW_STEP, y: 0.04 + slot.row * 0.036 };
}

/** position of the k-th card (0-based) in a column, given how many are in it. */
export function cityCardPos(player, color, k, count) {
  const ci = COLUMNS.indexOf(color);
  const col = player === 0 ? ci : COLUMNS.length - 1 - ci;
  const step = Math.min(CITY.step, (CITY.maxDepth - CH * CITY.scale) / Math.max(1, count - 1));
  return {
    x: ZONE_X[player] + (col - 3) * CITY.pitch,
    z: CITY.z0 + CH * CITY.scale / 2 + k * step,
    y: 0.04 + k * 0.03,
  };
}

export function wonderPos(player, index) {
  return { x: ZONE_X[player] + (index - 1.5) * (WW + 0.2), z: WONDER_Z, y: 0.04 };
}
export function wonderPoolPos(i) {
  return { x: (i % 2 === 0 ? -1 : 1) * 1.05, z: (i < 2 ? -0.85 : 0.85), y: 0.05 };
}
export function tokenBoardPos(i) { return { x: (i - 2) * 1.9, z: BOARD.tokenZ, y: 0.2 }; }
export function tokenOwnedPos(player, i) {
  return { x: ZONE_X[player] + 0.6 + (i % 4) * 0.98 - (player === 1 ? 0 : 0), z: TREASURY_Z + Math.floor(i / 4) * 0.98, y: 0.06 };
}
export function treasuryPos(player, slot) { // slot 0..2 : 6s, 3s, 1s
  return { x: ZONE_X[player] - 3.5 + slot * 0.92, z: TREASURY_Z, y: 0.04 };
}
export function militaryX(pos) { return pos * BOARD.pitch; }

export const PLAYER_COLORS = [0x3a9bd9, 0xd9503a];
export const PLAYER_CSS = ['#4db3ff', '#ff6b4a'];
