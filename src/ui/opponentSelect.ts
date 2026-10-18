/*
 * The original's opponent selection (main menu → Opponent): a clipboard (SDOSEL.PVS "scrn") with
 * the opponent's photo ("opp1".."opp6", "opp0" the stopwatch for racing against the clock) and
 * their bio written on it, and the buttons Last, Next, Clock, Car, Done along the bottom. Car opens
 * the showroom to pick the car they drive. Layout measured from the original's 320x200 screen.
 */

import type { Sprite } from '../original/cockpit';
import { drawText, loadFont, textWidth, type BitmapFont } from '../original/font';
import { OPPONENT_COUNT, type OpponentProfile } from '../original/opponents';

export type OpponentAction = { type: 'none' } | { type: 'done' } | { type: 'car' };

type Rect = [number, number, number, number];
const BUTTONS: { label: string; rect: Rect }[] = [
  { label: 'Last', rect: [20, 178, 52, 20] },
  { label: 'Next', rect: [76, 178, 56, 20] },
  { label: 'Clock', rect: [135, 178, 56, 20] },
  { label: 'Car', rect: [194, 178, 51, 20] },
  { label: 'Done', rect: [248, 178, 53, 20] },
];
const TEXT_X = 12;
const TEXT_Y = 32;
const LINE_H = 8;

export class OpponentSelect {
  visible = false;
  /** 0 = no opponent (the clock), 1..6. */
  index = 0;
  private selected = 1;
  private pictures: Map<string, Sprite> | null = null;
  private small: BitmapFont | null = null;
  private big: BitmapFont | null = null;

  constructor(private readonly profile: (id: number) => OpponentProfile | null) {
    void loadFont('FONTN.FNT').then((f) => (this.small = f));
    void loadFont('FONTDEF.FNT').then((f) => (this.big = f));
  }

  setPictures(p: Map<string, Sprite> | null): void {
    this.pictures = p;
  }

  open(index: number): void {
    this.visible = true;
    this.index = index;
    this.selected = 1;
  }

  close(): void {
    this.visible = false;
  }

  key(code: string): OpponentAction {
    const n = BUTTONS.length;
    if (code === 'ArrowLeft' || code === 'ArrowUp') this.selected = (this.selected + n - 1) % n;
    else if (code === 'ArrowRight' || code === 'ArrowDown') this.selected = (this.selected + 1) % n;
    else if (code === 'Escape') return { type: 'done' };
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') return this.press(this.selected);
    return { type: 'none' };
  }

  click(x: number, y: number): OpponentAction {
    const i = BUTTONS.findIndex(({ rect: [bx, by, bw, bh] }) => x >= bx && x < bx + bw && y >= by && y < by + bh);
    if (i < 0) return { type: 'none' };
    this.selected = i;
    return this.press(i);
  }

  private press(i: number): OpponentAction {
    const count = OPPONENT_COUNT + 1;
    switch (BUTTONS[i]!.label) {
      case 'Last':
        this.index = (this.index + count - 1) % count;
        break;
      case 'Next':
        this.index = (this.index + 1) % count;
        break;
      case 'Clock':
        this.index = 0;
        break;
      case 'Car':
        if (this.index > 0) return { type: 'car' };
        break;
      case 'Done':
        return { type: 'done' };
    }
    return { type: 'none' };
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    c.fillStyle = '#000000';
    c.fillRect(0, 0, 320, 200);
    const scrn = this.pictures?.get('scrn');
    if (scrn) c.drawImage(scrn.image, scrn.x, scrn.y);
    else {
      c.fillStyle = '#dcdcdc';
      c.fillRect(6, 6, 186, 176);
    }
    const photo = this.pictures?.get(`opp${this.index}`);
    if (photo) c.drawImage(photo.image, photo.x, photo.y);

    const p = this.index > 0 ? this.profile(this.index) : null;
    const lines = this.index === 0 ? ['Race against', 'the Clock.'] : p ? p.bio : [`Opponent ${this.index}`, '', '(needs the Stunts files)'];
    lines.forEach((l, k) => this.text(c, l, TEXT_X, TEXT_Y + k * LINE_H, '#000000', this.small, 7));

    const blink = Math.floor(now / 400) % 2 === 0 ? '#fcfc54' : '#fc54fc';
    BUTTONS.forEach(({ label, rect: [x, y, w, h] }, i) => {
      c.fillStyle = '#545454';
      c.fillRect(x, y, w, h);
      c.fillStyle = '#fcfcfc';
      c.fillRect(x, y, w - 2, h - 2);
      c.fillStyle = '#a8a8a8';
      c.fillRect(x + 2, y + 2, w - 4, h - 4);
      const dim = label === 'Car' && this.index === 0;
      const tw = this.big ? textWidth(this.big, label) : label.length * 7;
      this.text(c, label, x + Math.round((w - tw) / 2), y + 6, dim ? '#545454' : '#000000', this.big, 8);
      if (i === this.selected) {
        c.fillStyle = blink;
        c.fillRect(x - 1, y - 1, w + 2, 1);
        c.fillRect(x - 1, y + h, w + 2, 1);
        c.fillRect(x - 1, y - 1, 1, h + 2);
        c.fillRect(x + w, y - 1, 1, h + 2);
      }
    });
  }

  private text(c: CanvasRenderingContext2D, s: string, x: number, y: number, colour: string, font: BitmapFont | null, size: number): void {
    if (font) {
      drawText(c, font, s, x, y, colour);
      return;
    }
    c.font = `${size}px monospace`;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillStyle = colour;
    c.fillText(s, x, y);
  }
}
