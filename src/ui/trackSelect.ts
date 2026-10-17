/*
 * The original's track selection screen: the track seen from above at an angle (rendered by the
 * game), "Track='NAME'" and its fastest time on top, and the buttons More Tracks, New/Edit Tracks
 * and Main Menu. More Tracks opens the original's "Load Track" list box. Layout measured from the
 * original's 320x200 screen.
 */

export interface BestTime {
  name: string;
  car: string;
  time: string;
}

export type TrackSelectAction =
  | { type: 'menu' }
  | { type: 'pick'; index: number }
  | { type: 'none' };

const BUTTONS = [
  { label: ['More', 'Tracks'], enabled: true },
  { label: ['New/Edit', 'Tracks'], enabled: false }, // no track editor yet
  { label: ['Main Menu'], enabled: true },
];
/** Button rectangles (x, y, w, h). */
const RECTS: [number, number, number, number][] = [
  [17, 172, 93, 24],
  [114, 172, 93, 24],
  [210, 172, 93, 24],
];
const LIST_ROWS = 8;

export class TrackSelect {
  visible = false;
  private selected = 0;
  /** Open "Load Track" list: entries, current row, first visible row. */
  private list: { items: string[]; selected: number; top: number } | null = null;

  constructor(
    private readonly deps: {
      trackName: () => string;
      best: () => BestTime | null | undefined;
      tracks: () => string[];
      trackIndex: () => number;
    },
  ) {}

  open(): void {
    this.visible = true;
    this.selected = 0;
    this.list = null;
  }

  close(): void {
    this.visible = false;
    this.list = null;
  }

  key(code: string): TrackSelectAction {
    const enter = code === 'Enter' || code === 'NumpadEnter' || code === 'Space';
    const l = this.list;
    if (l) {
      if (code === 'ArrowUp') l.selected = (l.selected + l.items.length - 1) % l.items.length;
      else if (code === 'ArrowDown') l.selected = (l.selected + 1) % l.items.length;
      else if (code === 'Escape') this.list = null;
      else if (enter) {
        this.list = null;
        return { type: 'pick', index: l.selected };
      }
      l.top = Math.min(Math.max(l.top, l.selected - LIST_ROWS + 1), l.selected);
      return { type: 'none' };
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const step = code === 'ArrowLeft' ? -1 : 1;
      for (let k = 1; k <= BUTTONS.length; k++) {
        const i = (this.selected + step * k + BUTTONS.length * 3) % BUTTONS.length;
        if (BUTTONS[i]!.enabled) {
          this.selected = i;
          break;
        }
      }
    } else if (code === 'Escape') return { type: 'menu' };
    else if (enter) return this.activate(this.selected);
    return { type: 'none' };
  }

  click(x: number, y: number): TrackSelectAction {
    if (this.list) {
      const row = Math.floor((y - 69) / 10);
      if (x >= 66 && x < 254 && row >= 0 && row < LIST_ROWS && this.list.top + row < this.list.items.length) {
        this.list.selected = this.list.top + row;
        return this.key('Enter');
      }
      return { type: 'none' };
    }
    const i = RECTS.findIndex(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh);
    if (i < 0 || !BUTTONS[i]!.enabled) return { type: 'none' };
    this.selected = i;
    return this.activate(i);
  }

  private activate(i: number): TrackSelectAction {
    if (i === 0) {
      const items = this.deps.tracks();
      const sel = this.deps.trackIndex();
      this.list = { items, selected: sel, top: Math.max(0, sel - LIST_ROWS + 1) };
    }
    if (i === 2) return { type: 'menu' };
    return { type: 'none' };
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    outlined(c, `Track='${this.deps.trackName().toUpperCase()}'`, 160, 9, 'center', 9);
    outlined(c, 'FASTEST TIME', 160, 21, 'center', 9);
    const b = this.deps.best();
    c.font = '7px monospace';
    c.textBaseline = 'middle';
    c.fillStyle = '#000000';
    if (b) {
      c.textAlign = 'left';
      c.fillText(b.name.slice(0, 22), 16, 34);
      c.fillText(b.car.slice(0, 22), 120, 34);
      c.textAlign = 'right';
      c.fillText(b.time, 304, 34);
    } else {
      c.textAlign = 'center';
      c.fillText(b === null ? 'No times yet' : '', 160, 34);
    }

    const blink = Math.floor(now / 400) % 2 === 0 ? '#fcfc54' : '#fc54fc';
    RECTS.forEach(([x, y, w, h], i) => {
      const btn = BUTTONS[i]!;
      c.fillStyle = '#545454';
      c.fillRect(x + 2, y + 2, w, h);
      c.fillStyle = '#a8a8a8';
      c.fillRect(x, y, w, h);
      c.fillStyle = '#fcfcfc';
      c.fillRect(x, y, w, 1);
      c.fillRect(x, y, 1, h);
      c.fillStyle = '#000000';
      c.fillRect(x, y + h - 1, w, 1);
      c.fillRect(x + w - 1, y, 1, h);
      if (i === this.selected && !this.list) {
        c.strokeStyle = blink;
        c.lineWidth = 1;
        c.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      }
      btn.label.forEach((t, k) => {
        const ty = y + h / 2 + (k - (btn.label.length - 1) / 2) * 8;
        if (btn.enabled) outlined(c, t, x + w / 2, ty, 'center', 9);
        else {
          c.font = 'bold 8px monospace';
          c.textAlign = 'center';
          c.fillStyle = '#545454';
          c.fillText(t, x + w / 2, ty);
        }
      });
    });

    const l = this.list;
    if (!l) return;
    // The original's "Load Track" box.
    const x = 64;
    const y = 36;
    const w = 192;
    const h = 126;
    c.fillStyle = '#000000';
    c.fillRect(x, y, w, h);
    c.strokeStyle = '#a80000';
    c.lineWidth = 1;
    c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    c.font = 'bold 8px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = '#fcfcfc';
    c.fillText('Load Track', x + 8, y + 10);
    c.strokeStyle = '#a80000';
    c.beginPath();
    c.moveTo(x + 2, y + 30.5);
    c.lineTo(x + w - 2, y + 30.5);
    c.stroke();
    c.textAlign = 'center';
    c.fillText(l.top > 0 ? '(Scroll Up)' : '', x + w / 2, y + 30);
    c.fillText(l.top + LIST_ROWS < l.items.length ? '(Scroll Down)' : '', x + w / 2, y + h - 4);
    c.textAlign = 'left';
    for (let r = 0; r < LIST_ROWS && l.top + r < l.items.length; r++) {
      const i = l.top + r;
      const t = l.items[i]!;
      const ty = y + 38 + r * 10;
      if (i === l.selected) {
        c.fillStyle = '#fcfcfc';
        c.fillRect(x + 7, ty - 5, c.measureText(t).width + 3, 10);
        c.fillStyle = '#000000';
      } else c.fillStyle = '#fcfcfc';
      c.fillText(t, x + 8, ty);
    }
  }
}

function outlined(c: CanvasRenderingContext2D, t: string, x: number, y: number, align: CanvasTextAlign, size: number): void {
  c.font = `bold ${size}px monospace`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.lineWidth = 2;
  c.lineJoin = 'round';
  c.strokeStyle = '#000000';
  c.strokeText(t, x, y);
  c.fillStyle = '#fcfcfc';
  c.fillText(t, x, y);
}
