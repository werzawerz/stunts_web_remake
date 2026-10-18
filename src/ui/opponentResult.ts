/*
 * After a race against a computer opponent: their win or lose animation (OPP?WIN.PVS /
 * OPP?LOSE.PVS frames "op01".."op08" in the order of their "winn"/"lose" lists) and what they say,
 * from their own lines in OPP?.PRE: gloating or a jibe about your crash when they win, a sulk or an
 * excuse when they lose, an apology when they wrecked you both. Any key goes on to the evaluation.
 */

import type { Sprite } from '../original/cockpit';
import { drawText, loadFont, textWidth, type BitmapFont } from '../original/font';
import type { OpponentProfile } from '../original/opponents';
import { formatRaceTime } from './results';

export interface RaceOutcome {
  /** The player's time with penalties, or null for a crash. */
  playerSec: number | null;
  /** The opponent's, or null when they crashed or didn't finish. */
  opponentSec: number | null;
  /** The two cars wrecked each other. */
  collision: boolean;
  /** For picking their lines (the same race always gets the same ones). */
  seed: number;
}

/** Who won: the opponent when you didn't finish or they were faster. */
export const opponentWon = (o: RaceOutcome): boolean =>
  o.playerSec === null ? true : o.opponentSec !== null && o.opponentSec < o.playerSec;

/** What the opponent says after the race (keys of their lines). */
export function opponentLines(p: OpponentProfile, o: RaceOutcome): string[] {
  const pick = (keys: string[], salt: number): string => {
    const have = keys.filter((k) => p.lines[k]);
    return have.length ? p.lines[have[(o.seed + salt) % have.length]!]! : '';
  };
  if (o.collision && p.lines.ed4a) return [p.lines.ed4a];
  if (opponentWon(o)) {
    const first = o.playerSec === null ? pick(['ev2a', 'ev2b'], 0) : pick(['ev1a', 'ev1b', 'ev1c'], 0);
    return [first, pick(['ev2c', 'ev2d', 'ev3a', 'ev3b', 'ev3c'], 1)].filter(Boolean);
  }
  return [pick(['ed1a', 'ed1b', 'ed1c'], 0), pick(['ed2a', 'ed2b', 'ed2c', 'ed2d', 'ed3a', 'ed3b', 'ed3c'], 1)].filter(Boolean);
}

const FRAME_MS = 180;
const WRAP = 300;

export class OpponentResult {
  visible = false;
  private profile: OpponentProfile | null = null;
  private outcome: RaceOutcome | null = null;
  private frames: (Sprite | undefined)[] = [];
  private order: number[] = [];
  private at = 0;
  private small: BitmapFont | null = null;

  constructor(private readonly pictures: (file: string) => Promise<Map<string, Sprite> | null>) {
    void loadFont('FONTN.FNT').then((f) => (this.small = f));
  }

  open(profile: OpponentProfile, outcome: RaceOutcome, now: number): void {
    this.visible = true;
    this.profile = profile;
    this.outcome = outcome;
    this.at = now;
    const won = opponentWon(outcome);
    this.order = won ? profile.winFrames : profile.loseFrames;
    this.frames = [];
    void this.pictures(`OPP${profile.id}${won ? 'WIN' : 'LOSE'}.PVS`).then((p) => {
      this.frames = Array.from({ length: 8 }, (_, i) => p?.get(`op0${i + 1}`));
    });
  }

  close(): void {
    this.visible = false;
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    const p = this.profile;
    const o = this.outcome;
    c.fillStyle = '#000000';
    c.fillRect(0, 0, 320, 200);
    if (!p || !o) return;
    // The animation, played once (its last frame held).
    const k = Math.min(this.order.length - 1, Math.floor((now - this.at) / FRAME_MS));
    const f = this.frames[(this.order[Math.max(0, k)] ?? 1) - 1];
    if (f) c.drawImage(f.image, Math.round(160 - f.image.width / 2), 8);

    const won = opponentWon(o);
    let y = 100;
    const line = (s: string, colour = '#fcfcfc', center = false): void => {
      const w = this.small ? textWidth(this.small, s) : s.length * 5;
      const x = center ? Math.round(160 - w / 2) : 10;
      if (this.small) drawText(c, this.small, s, x, y, colour);
      else {
        c.font = '7px monospace';
        c.textBaseline = 'top';
        c.fillStyle = colour;
        c.fillText(s, x, y);
      }
      y += 9;
    };
    line(won ? `${p.name} wins!` : `You beat ${p.name}!`, won ? '#fc5454' : '#54fc54', true);
    y += 3;
    for (const said of opponentLines(p, o)) {
      for (const l of wrap(`"${said}"`, (s) => (this.small ? textWidth(this.small, s) : s.length * 5), WRAP)) line(l);
      y += 3;
    }
    y = 172;
    line(`You: ${o.playerSec === null ? 'crashed' : formatRaceTime(o.playerSec)}    ${p.name}: ${o.opponentSec === null ? 'did not finish' : formatRaceTime(o.opponentSec)}`, '#fcfc54', true);
    if (now - this.at > 1500) line('Press any key', '#a8a8a8', true);
  }
}

function wrap(text: string, width: (s: string) => number, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (width(next) > max && cur) {
      out.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
