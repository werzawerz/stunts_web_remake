import { createEmptyTrack, Horizon, type Track } from './trkFormat';

/** Place a 2x2 piece: the code sits in the NW tile, fillers (FE south, FD south-east, FF east) in the rest. */
function placeLarge(t: Track, x: number, z: number, code: number): void {
  t.elements[x]![z] = code;
  t.elements[x]![z - 1] = 0xfe;
  t.elements[x + 1]![z - 1] = 0xfd;
  t.elements[x + 1]![z] = 0xff;
}

/**
 * Our own demo circuit (anticlockwise): start straight along the south side with a loop,
 * large corners, an elevated ramp section on the east side, a pond and a hill in the middle.
 */
export function buildSampleTrack(horizon: Horizon = Horizon.Desert): Track {
  const t = createEmptyTrack(horizon);
  const el = t.elements;

  // South side, eastbound (row 5).
  for (let x = 6; x <= 21; x++) el[x]![5] = 0x05;
  el[10]![5] = 0xb4; // paved start/finish, W>E
  el[14]![5] = 0x41; // loop, east-west (2x1)
  el[15]![5] = 0xff;

  // East side, northbound (column 23) with a ramp, elevated stretch and descent.
  for (let z = 7; z <= 22; z++) el[23]![z] = 0x04;
  el[23]![8] = 0x26;
  for (let z = 9; z <= 11; z++) el[23]![z] = 0x22;
  el[23]![12] = 0x27;

  // North side, westbound (row 24).
  for (let x = 6; x <= 21; x++) el[x]![24] = 0x05;

  // West side, southbound (column 4).
  for (let z = 7; z <= 22; z++) el[4]![z] = 0x04;

  // Large corners (centre of each arc is the inside corner of its 2x2 block).
  placeLarge(t, 4, 6, 0x0c); // SW: N-E
  placeLarge(t, 22, 6, 0x0d); // SE: W-N
  placeLarge(t, 22, 24, 0x0b); // NE: S-W
  placeLarge(t, 4, 24, 0x0a); // NW: S-E

  // Scenery.
  el[8]![8] = 0x97;
  el[9]![18] = 0x97;
  el[19]![9] = 0x98;
  el[12]![20] = 0x98;
  el[26]![15] = 0x99;
  el[2]![15] = 0x99;

  // Terrain: pond and a hill with slopes on its four sides.
  for (let x = 10; x <= 13; x++) for (let z = 12; z <= 15; z++) t.terrain[x]![z] = 0x01;
  for (let x = 16; x <= 17; x++) for (let z = 14; z <= 15; z++) t.terrain[x]![z] = 0x06;
  for (let x = 16; x <= 17; x++) {
    t.terrain[x]![13] = 0x07; // uphill south>north
    t.terrain[x]![16] = 0x09; // uphill north>south
  }
  for (let z = 14; z <= 15; z++) {
    t.terrain[15]![z] = 0x0a; // uphill west>east
    t.terrain[18]![z] = 0x08; // uphill east>west
  }

  return t;
}
