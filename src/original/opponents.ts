import { fetchOriginal } from './files';
import { parseResources, unpack } from './formats';

/*
 * The original's computer opponents, read at runtime from the player's own files (OPP1..6.PRE,
 * wiki.stunts.hu "Opponent files"): name and bio ("edes", lines split by "]"), initials, the speed
 * table ("sped": mph per kind of piece, see SPEED_CLASS in race/opponent.ts), a trouble level per
 * element code ("path": where their bio says they struggle), and what they say after a race:
 * "ev*" when they win, "ed*" when they lose, "ed4a" after crashing into you; "winn"/"lose" are
 * the frame orders of their OPP?WIN.PVS / OPP?LOSE.PVS animations.
 */

export interface OpponentProfile {
  /** 1..6 (0 = none, the clock). */
  id: number;
  name: string;
  initials: string;
  bio: string[];
  /** mph per speed class (16 entries in 1.1). */
  sped: number[];
  /** Trouble level per element code. */
  trouble: number[];
  lines: Record<string, string>;
  winFrames: number[];
  loseFrames: number[];
}

export const OPPONENT_COUNT = 6;

const cache = new Map<number, Promise<OpponentProfile | null>>();

const text = (b: Uint8Array | undefined): string => (b ? String.fromCharCode(...b).replace(/\0.*$/s, '') : '');

export function parseOpponent(id: number, bytes: Uint8Array): OpponentProfile {
  const res = parseResources(unpack(bytes));
  const bio = text(res.get('edes')).split(']');
  while (bio.length && bio[bio.length - 1] === '') bio.pop();
  const lines: Record<string, string> = {};
  for (const [k, v] of res) if (/^e[dv]\d[a-d]$/.test(k)) lines[k] = text(v);
  const frames = (b: Uint8Array | undefined): number[] => [...(b ?? [])].filter((v) => v > 0);
  // The name: the bio's first lines up to the blank one ("Squealin'" / "Bernie Rubber").
  const blank = bio.indexOf('');
  return {
    id,
    name: bio.slice(0, blank < 0 ? 1 : blank).join(' '),
    initials: text(res.get('enam')),
    bio,
    sped: [...(res.get('sped') ?? [])],
    trouble: [...(res.get('path') ?? [])],
    lines,
    winFrames: frames(res.get('winn')),
    loseFrames: frames(res.get('lose')),
  };
}

/** Opponent 1..6, or null without the player's Stunts files. */
export function loadOpponent(id: number): Promise<OpponentProfile | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetchOriginal(`OPP${id}.PRE`)
      .then((b) => (b ? parseOpponent(id, b) : null))
      .catch(() => null);
    cache.set(id, p);
  }
  return p;
}
