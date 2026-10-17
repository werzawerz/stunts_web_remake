import type { Sprite } from '../original/cockpit';

/*
 * The original's main menu: a picture of a road with five signs (Opponent, Car, Let's Drive,
 * Track, Option); left/right moves a yellow frame between them, Enter picks. The picture is the
 * original's (SDMSEL.PVS, read from the player's files); without it we draw our own stand-in.
 * Sub-screens use the original's options box: black, red frame, white items, the current one
 * inverted. Car opens the showroom, Track the track selection screen.
 */

export type MenuAction =
  | { type: 'drive' }
  | { type: 'showroom' }
  | { type: 'trackselect' }
  | { type: 'car'; index: number }
  | { type: 'track'; index: number }
  | { type: 'sound'; on: boolean }
  | { type: 'ghost'; on: boolean }
  | { type: 'loadreplay'; index: number }
  | { type: 'pixels' }
  | { type: 'none' };

interface Item {
  label: string;
  /** Selection frame (x0, y0, x1, y1) in 320x200 pixels, measured on the original. */
  frame: [number, number, number, number];
}

const ITEMS: Item[] = [
  { label: 'Opponent', frame: [8, 117, 66, 167] },
  { label: 'Car', frame: [69, 79, 107, 118] },
  { label: "Let's Drive", frame: [106, 118, 211, 196] },
  { label: 'Track', frame: [192, 78, 254, 117] },
  { label: 'Option', frame: [255, 117, 294, 166] },
];
const DRIVE = 2;

type Screen =
  | { kind: 'main' }
  | { kind: 'list'; title: string; items: string[]; selected: number; pick: (i: number) => MenuAction }
  | { kind: 'message'; title: string; lines: string[] };

export interface MenuOptions {
  cars: () => string[];
  carIndex: () => number;
  tracks: () => string[];
  trackIndex: () => number;
  soundOn: () => boolean;
  ghostOn: () => boolean;
  /** Names of the replays saved in this browser. */
  replayNames: () => string[];
}

export class MainMenu {
  visible = false;
  private selected = DRIVE;
  private screen: Screen = { kind: 'main' };
  /** The original's menu picture, when the player's files have it. */
  picture: Sprite | null = null;

  constructor(private readonly opts: MenuOptions) {}

  open(): void {
    this.visible = true;
    this.screen = { kind: 'main' };
    this.selected = DRIVE;
  }

  close(): void {
    this.visible = false;
  }

  /** Handle a key; returns what the game should do. */
  key(code: string): MenuAction {
    const s = this.screen;
    const enter = code === 'Enter' || code === 'NumpadEnter' || code === 'Space';
    if (s.kind === 'main') {
      if (code === 'ArrowLeft' || code === 'ArrowUp') this.selected = (this.selected + ITEMS.length - 1) % ITEMS.length;
      else if (code === 'ArrowRight' || code === 'ArrowDown') this.selected = (this.selected + 1) % ITEMS.length;
      else if (enter) return this.activate(this.selected);
      return { type: 'none' };
    }
    if (s.kind === 'message') {
      if (enter || code === 'Escape') this.screen = { kind: 'main' };
      return { type: 'none' };
    }
    if (code === 'ArrowUp') s.selected = (s.selected + s.items.length - 1) % s.items.length;
    else if (code === 'ArrowDown') s.selected = (s.selected + 1) % s.items.length;
    else if (code === 'Escape') this.screen = { kind: 'main' };
    else if (enter) {
      const a = s.pick(s.selected);
      if (this.screen === s && !['sound', 'ghost', 'pixels'].includes(a.type)) this.screen = { kind: 'main' };
      return a;
    }
    return { type: 'none' };
  }

  /** Mouse click at 320x200 coordinates. */
  click(x: number, y: number): MenuAction {
    if (this.screen.kind !== 'main') return this.key('Enter');
    const i = ITEMS.findIndex(({ frame: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    if (i < 0) return { type: 'none' };
    this.selected = i;
    return this.activate(i);
  }

  private activate(i: number): MenuAction {
    const label = ITEMS[i]!.label;
    if (label === "Let's Drive") return { type: 'drive' };
    if (label === 'Car') return { type: 'showroom' };
    if (label === 'Track') return { type: 'trackselect' };
    if (label === 'Option') {
      this.optionsScreen(0);
    } else {
      this.screen = { kind: 'message', title: 'Opponent', lines: ['No opponents yet:', 'you race against the clock.'] };
    }
    return { type: 'none' };
  }

  private optionsScreen(selected: number): void {
    const items = [
      `Sound effects ${this.opts.soundOn() ? 'on' : 'off'}`,
      `Ghost car ${this.opts.ghostOn() ? 'on' : 'off'}`,
      'Load replay',
      'Graphic level',
      'Done',
    ];
    this.screen = {
      kind: 'list',
      title: 'Options',
      items,
      selected,
      pick: (k) => {
        // Toggles stay on the options box, showing the new setting.
        if (k === 0) {
          const on = !this.opts.soundOn();
          queueMicrotask(() => this.optionsScreen(0));
          return { type: 'sound', on };
        }
        if (k === 1) {
          const on = !this.opts.ghostOn();
          queueMicrotask(() => this.optionsScreen(1));
          return { type: 'ghost', on };
        }
        if (k === 2) {
          const names = this.opts.replayNames();
          queueMicrotask(() => {
            this.screen =
              names.length === 0
                ? { kind: 'message', title: 'Load replay', lines: ['No saved replays yet.', 'Save one from the replay menu.'] }
                : { kind: 'list', title: 'Load replay', items: names, selected: 0, pick: (i) => ({ type: 'loadreplay', index: i }) };
          });
          return { type: 'none' };
        }
        if (k === 3) {
          queueMicrotask(() => this.optionsScreen(3));
          return { type: 'pixels' };
        }
        this.screen = { kind: 'main' };
        return { type: 'none' };
      },
    };
  }

  draw(c: CanvasRenderingContext2D): void {
    if (this.picture) c.drawImage(this.picture.image, 0, 0);
    else standIn(c);
    if (this.screen.kind === 'main') {
      const [x0, y0, x1, y1] = ITEMS[this.selected]!.frame;
      c.strokeStyle = '#fcfc54';
      c.lineWidth = 1;
      c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      return;
    }
    const s = this.screen;
    const lines = s.kind === 'list' ? s.items : s.lines;
    const w = 190;
    const h = 22 + lines.length * 10;
    const x = Math.round((320 - w) / 2);
    const y = Math.round((200 - h) / 2);
    c.fillStyle = '#000000';
    c.fillRect(x, y, w, h);
    c.strokeStyle = '#a80000';
    c.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    c.font = 'bold 8px monospace';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillStyle = '#fcfcfc';
    c.fillText(s.title, x + 9, y + 10);
    lines.forEach((t, i) => {
      const ly = y + 21 + i * 10;
      if (s.kind === 'list' && i === s.selected) {
        c.fillStyle = '#fcfcfc';
        c.fillRect(x + 7, ly - 5, c.measureText(t).width + 4, 10);
        c.fillStyle = '#000000';
      } else c.fillStyle = '#fcfcfc';
      c.fillText(t, x + 9, ly);
    });
  }
}

/** Our own drawing of the menu when the original picture isn't available: road and five signs. */
function standIn(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#54a8fc';
  c.fillRect(0, 0, 320, 70);
  c.fillStyle = '#2c8c2c';
  c.fillRect(0, 70, 320, 130);
  c.fillStyle = '#383838';
  c.beginPath();
  c.moveTo(150, 70);
  c.lineTo(170, 70);
  c.lineTo(260, 200);
  c.lineTo(60, 200);
  c.closePath();
  c.fill();
  const label = (t: string, x: number, y: number, color = '#fcfcfc'): void => {
    c.font = 'bold 8px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(t, x, y);
  };
  const post = (x: number, y0: number): void => {
    c.fillStyle = '#a8a8a8';
    c.fillRect(x - 1, y0, 3, 200 - y0);
  };
  post(37, 160);
  c.fillStyle = '#d81c1c';
  c.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    c.lineTo(37 + Math.cos(a) * 26, 142 + Math.sin(a) * 23);
  }
  c.fill();
  label('Opponent', 37, 142);
  post(88, 110);
  c.fillStyle = '#1c3cc8';
  c.beginPath();
  c.arc(88, 98, 18, 0, Math.PI * 2);
  c.fill();
  label('Car', 88, 98);
  post(223, 105);
  c.fillStyle = '#fca854';
  c.beginPath();
  c.moveTo(194, 80);
  c.lineTo(252, 80);
  c.lineTo(223, 115);
  c.closePath();
  c.fill();
  label('Track', 223, 89, '#000000');
  post(274, 160);
  c.fillStyle = '#2c8c2c';
  c.fillRect(257, 119, 36, 46);
  c.strokeStyle = '#fcfcfc';
  c.strokeRect(258.5, 120.5, 33, 43);
  label('Option', 275, 142);
  c.fillStyle = '#1c3cc8';
  c.fillRect(118, 130, 82, 60);
  c.fillStyle = '#fc5454';
  c.fillRect(122, 176, 74, 6);
  label("Let's", 159, 146);
  label('Drive', 159, 157);
}
