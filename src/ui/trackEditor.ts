/*
 * The original's track editor, laid out pixel for pixel from its 320x200 screen: the track window
 * (12x11 tiles of the 30x30 grid, scroll bars right and below), the "Track Editor" title, the
 * palette (one of ten 6x6 pages of pieces, every orientation laid out like a little map; the page
 * bar below it), the Horizon / Load / New / Save / Done buttons, and the name of the piece under
 * the cursor along the bottom. Pieces and terrain are drawn with the original's own icons
 * (SDTEDIT.PES) and text in its font when the player's files are there.
 *
 * Controls as in the original manual: Space (or keypad 0) jumps between track window and palette;
 * in the palette the arrows move the highlight, Enter picks the piece and jumps to the track
 * window, where the cursor flashes it over the square and Enter places it (Enter twice on a piece
 * picks it up instead); + / - or F1-F10 turn the palette pages; the blank square erases; C checks
 * the track. The mouse works everywhere.
 */

import { loadEditorGraphics, terrainIcon, type EditorGraphics } from '../original/editorGraphics';
import { drawText, loadFont, textWidth, type BitmapFont } from '../original/font';
import {
  anchorOf,
  checkTrack,
  elementName,
  footprintOf,
  isStart,
  PALETTE_EAST,
  PALETTE_PAGES,
  PALETTE_SOUTH,
  placeAt,
  placementError,
  terrainFromPreset,
  tileName,
} from '../track/editor';
import { ELEMENT_ICONS } from '../track/editorTables.generated';
import { createEmptyTrack, GRID, Horizon, type Track } from '../track/trkFormat';
import { drawElementFallback, drawTerrainFallback, EGA } from './editorIcons';

export interface EditorDeps {
  /** Tracks the Load button offers. */
  trackNames: () => string[];
  loadTrack: (index: number) => Promise<{ track: Track; name: string } | null>;
  /** Save under a name; false when the browser won't store it. */
  save: (name: string, track: Track) => boolean;
}

export type EditorAction =
  | { type: 'none' }
  /** Left the editor with a saved track to drive. */
  | { type: 'done'; track: Track; name: string }
  /** Left the editor without a track of its own. */
  | { type: 'cancel' };

const NONE: EditorAction = { type: 'none' };

type Rect = [number, number, number, number];
const inside = (x: number, y: number, [rx, ry, rw, rh]: Rect): boolean => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

// Track window: tiles of 16 pixels (15 drawn + a black grid line), icons drawn one pixel left.
const MX = 10;
const MY = 4;
const T = 16;
const COLS = 12;
const ROWS = 11;
const VBAR: Rect = [203, 4, 5, 175];
const HBAR: Rect = [10, 181, 191, 5];
// Palette: 6x6 cells from (222, 36), the page bar below it.
const PX = 222;
const PY = 36;
const PAGE_BAR: Rect = [222, 133, 95, 5];
const TITLE: Rect = [218, 3, 102, 23];
type Focus = 'map' | 'grid' | 'bar' | 'horizon' | 'load' | 'new' | 'save' | 'done';
const BUTTONS: { id: Focus; label: string; rect: Rect }[] = [
  { id: 'horizon', label: 'Horizon', rect: [222, 140, 95, 15] },
  { id: 'load', label: 'Load', rect: [222, 156, 47, 15] },
  { id: 'new', label: 'New', rect: [270, 156, 47, 15] },
  { id: 'save', label: 'Save', rect: [222, 172, 47, 15] },
  { id: 'done', label: 'Done', rect: [270, 172, 47, 15] },
];
// Keyboard moves between the palette's controls.
const NEXT: Partial<Record<Focus, Partial<Record<'up' | 'down' | 'left' | 'right', Focus>>>> = {
  bar: { down: 'horizon' },
  horizon: { up: 'bar', down: 'load' },
  load: { up: 'horizon', down: 'save', right: 'new' },
  new: { up: 'horizon', down: 'done', left: 'load' },
  save: { up: 'load', right: 'done' },
  done: { up: 'new', left: 'save' },
};
const HORIZONS = ['Desert', 'Tropical', 'Alpine', 'City', 'Country'];
const LIST_ROWS = 8;
const FLASH_MS = 220;
const DOUBLE_MS = 450;
const NAME_LENGTH = 8;

const LIGHT_RED = EGA[12]!;
const CYAN = EGA[11]!;
const LIGHT_BLUE = EGA[9]!;
const BLUE = EGA[1]!;

type Dialog =
  /** Lines of text and buttons to choose from (none: any key closes it). */
  | { kind: 'menu'; lines: string[]; options: string[]; selected: number; pick: (i: number) => void }
  | { kind: 'list'; items: string[]; selected: number; top: number }
  | { kind: 'name'; text: string; then: (() => void) | null };

export class TrackEditor {
  visible = false;
  private track: Track = createEmptyTrack();
  /** Name it was loaded or saved under ('' for an original or a new track). */
  private name = '';
  private dirty = false;
  /** The last version saved or loaded under a name: what Done drives. */
  private saved: { track: Track; name: string } | null = null;
  private scrollX = 0;
  private scrollY = 0;
  private cursor: [number, number] = [0, 0];
  private focus: Focus = 'grid';
  private page = 0;
  /** Highlighted palette cell (a piece's top-left cell). */
  private cell = 0;
  /** The piece the cursor builds with (0 = the blank square), or null before one is picked. */
  private selected: number | null = null;
  private lastPlace: { x: number; z: number; at: number; before: Track } | null = null;
  private dialog: Dialog | null = null;
  private busy = false;
  private action: EditorAction = NONE;
  private gfx: EditorGraphics | null = null;
  private font: BitmapFont | null = null;
  /** Map, palette and buttons drawn once per change: redrawing ~200 icons every frame starved
   * the compositor. Redrawn when `layerKey` changes. */
  private layer: HTMLCanvasElement | null = null;
  private layerKey = '';
  /** Bumped whenever the track's pieces change. */
  private version = 0;

  constructor(private readonly deps: EditorDeps) {
    void loadEditorGraphics().then((g) => (this.gfx = g));
    void loadFont('FONTDEF.FNT').then((f) => (this.font = f));
  }

  /** Open on a copy of a track; `name` is set for the player's own (saved) tracks. */
  open(track: Track | null, name: string): void {
    this.visible = true;
    this.track = track ? cloneTrack(track) : createEmptyTrack();
    this.version++;
    this.name = name;
    this.saved = name ? { track: cloneTrack(this.track), name } : null;
    this.dirty = false;
    this.dialog = null;
    this.focus = 'grid';
    this.page = 0;
    this.cell = 0;
    this.selected = null;
    this.centreOnStart();
  }

  close(): void {
    this.visible = false;
    this.dialog = null;
  }

  /** Text is being typed (the save name). */
  get typing(): boolean {
    return this.dialog?.kind === 'name';
  }

  // ---- keyboard ---------------------------------------------------------------------------------

  key(e: KeyboardEvent): EditorAction {
    if (this.busy) return NONE;
    if (this.dialog) {
      this.dialogKey(this.dialog, e);
      return this.take();
    }
    const code = e.code;
    const enter = code === 'Enter' || code === 'NumpadEnter';
    const page = pageKey(e);
    if (page !== null) this.setPage(page === 'next' ? this.page + 1 : page === 'prev' ? this.page - 1 : page);
    else if (code === 'Space' || code === 'Numpad0') this.focus = this.focus === 'map' ? 'grid' : 'map';
    else if (code === 'KeyC') this.check();
    else if (code === 'Escape') this.leave();
    else if (this.focus === 'map') {
      const move: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      const m = move[code];
      if (m) this.moveCursor(this.cursor[0] + m[0], this.cursor[1] + m[1]);
      else if (enter) this.build(...this.cursor);
    } else if (this.focus === 'grid') {
      const dirs: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (dirs[code]) this.moveHighlight(dirs[code]);
      else if (enter) this.pick(this.cell);
    } else {
      const dirs: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const d = dirs[code];
      if (this.focus === 'bar' && (d === 'left' || d === 'right')) this.setPage(this.page + (d === 'left' ? -1 : 1));
      else if (this.focus === 'bar' && d === 'up') this.focus = 'grid';
      else if (d) this.focus = NEXT[this.focus]?.[d] ?? this.focus;
      else if (enter) this.press(this.focus);
    }
    return this.take();
  }

  private dialogKey(d: Dialog, e: KeyboardEvent): void {
    const code = e.code;
    const enter = code === 'Enter' || code === 'NumpadEnter';
    if (d.kind === 'name') {
      if (code === 'Escape') this.dialog = null;
      else if (code === 'Backspace') d.text = d.text.slice(0, -1);
      else if (enter) this.saveAs(d.text, d.then);
      else if (/^[a-z0-9_-]$/i.test(e.key) && d.text.length < NAME_LENGTH) d.text += e.key.toUpperCase();
      return;
    }
    if (d.kind === 'list') {
      if (code === 'ArrowUp') d.selected = (d.selected + d.items.length - 1) % d.items.length;
      else if (code === 'ArrowDown') d.selected = (d.selected + 1) % d.items.length;
      else if (code === 'Escape') this.dialog = null;
      else if (enter || code === 'Space') this.load(d.selected);
      d.top = Math.min(Math.max(d.top, d.selected - LIST_ROWS + 1), d.selected);
      return;
    }
    if (!d.options.length || code === 'Escape') {
      this.dialog = null;
      return;
    }
    if (code === 'ArrowUp') d.selected = (d.selected + d.options.length - 1) % d.options.length;
    else if (code === 'ArrowDown') d.selected = (d.selected + 1) % d.options.length;
    else if (enter || code === 'Space') {
      this.dialog = null;
      d.pick(d.selected);
    }
  }

  // ---- mouse ------------------------------------------------------------------------------------

  /** Mouse click in 320x200 screen pixels. */
  click(x: number, y: number): EditorAction {
    if (this.busy) return NONE;
    if (this.dialog) {
      this.dialogClick(this.dialog, x, y);
      return this.take();
    }
    const tile = this.tileAt(x, y);
    if (tile) {
      this.focus = 'map';
      this.cursor = tile;
      this.build(...tile);
    } else if (inside(x, y, VBAR)) {
      this.scrollY = clamp(Math.round(((y - VBAR[1]) / VBAR[3]) * GRID - ROWS / 2), 0, GRID - ROWS);
    } else if (inside(x, y, HBAR)) {
      this.scrollX = clamp(Math.round(((x - HBAR[0]) / HBAR[2]) * GRID - COLS / 2), 0, GRID - COLS);
    } else if (inside(x, y, PAGE_BAR)) {
      this.focus = 'bar';
      this.setPage(Math.floor(((x - PAGE_BAR[0]) / PAGE_BAR[2]) * PALETTE_PAGES.length));
    } else {
      const cell = this.cellAt(x, y);
      if (cell !== null) {
        this.focus = 'grid';
        this.cell = cell;
        this.pick(cell, false);
      } else {
        const b = BUTTONS.find((bt) => inside(x, y, bt.rect));
        if (b) {
          this.focus = b.id;
          this.press(b.id);
        }
      }
    }
    return this.take();
  }

  /** The mouse makes whatever it is over active, like the original's. */
  move(x: number, y: number): void {
    if (this.dialog || this.busy) {
      const d = this.dialog;
      if (d?.kind === 'menu' && d.options.length) {
        const i = this.dialogOptionAt(d, y);
        if (i !== null) d.selected = i;
      }
      return;
    }
    const tile = this.tileAt(x, y);
    if (tile) {
      this.focus = 'map';
      this.cursor = tile;
      return;
    }
    const cell = this.cellAt(x, y);
    if (cell !== null) {
      this.focus = 'grid';
      this.cell = cell;
      return;
    }
    if (inside(x, y, PAGE_BAR)) this.focus = 'bar';
    const b = BUTTONS.find((bt) => inside(x, y, bt.rect));
    if (b) this.focus = b.id;
  }

  /** Mouse wheel scrolls the track window (with Shift, sideways). */
  wheel(dy: number, sideways: boolean): void {
    const step = Math.sign(dy);
    if (sideways) this.scrollX = clamp(this.scrollX + step, 0, GRID - COLS);
    else this.scrollY = clamp(this.scrollY + step, 0, GRID - ROWS);
  }

  private dialogClick(d: Dialog, x: number, y: number): void {
    if (d.kind === 'list') {
      const box = listBox();
      const row = Math.floor((y - (box[1] + 33)) / 10);
      if (inside(x, y, box) && row >= 0 && row < LIST_ROWS && d.top + row < d.items.length) this.load(d.top + row);
      else if (!inside(x, y, box)) this.dialog = null;
      return;
    }
    if (d.kind === 'name') return;
    if (!d.options.length) {
      this.dialog = null;
      return;
    }
    const i = this.dialogOptionAt(d, y);
    if (i !== null && inside(x, y, menuBox(d.lines.length + 1 + d.options.length, this.menuWidth(d)))) {
      this.dialog = null;
      d.pick(i);
    }
  }

  // ---- editing ----------------------------------------------------------------------------------

  private take(): EditorAction {
    const a = this.action;
    this.action = NONE;
    return a;
  }

  private tileAt(x: number, y: number): [number, number] | null {
    if (!inside(x, y, [MX, MY, COLS * T, ROWS * T])) return null;
    return [this.scrollX + Math.floor((x - MX) / T), GRID - 1 - (this.scrollY + Math.floor((y - MY) / T))];
  }

  /** The palette cell under the mouse, as its piece's top-left cell. */
  private cellAt(x: number, y: number): number | null {
    if (!inside(x, y, [PX, PY, 6 * T, 6 * T])) return null;
    return this.anchorCell(Math.floor((y - PY) / T) * 6 + Math.floor((x - PX) / T));
  }

  private anchorCell(i: number): number {
    const page = PALETTE_PAGES[this.page]!;
    let r = Math.floor(i / 6);
    let c = i % 6;
    while (r > 0 && page[r * 6 + c] === PALETTE_SOUTH) r--;
    while (c > 0 && page[r * 6 + c] === PALETTE_EAST) c--;
    return r * 6 + c;
  }

  private moveHighlight(d: 'up' | 'down' | 'left' | 'right'): void {
    const code = PALETTE_PAGES[this.page]![this.cell]!;
    const { w, h } = code ? footprintOf(code) : { w: 1, h: 1 };
    const r = Math.floor(this.cell / 6);
    const c = this.cell % 6;
    if (d === 'down' && r + h > 5) {
      this.focus = 'bar';
      return;
    }
    const nr = d === 'up' ? r - 1 : d === 'down' ? r + h : r;
    const nc = d === 'left' ? c - 1 : d === 'right' ? c + w : c;
    if (nr < 0 || nc < 0 || nc > 5) return;
    this.cell = this.anchorCell(nr * 6 + nc);
  }

  /** Pick the highlighted palette piece; from the keyboard that jumps to the track window. */
  private pick(cell: number, jump = true): void {
    this.selected = PALETTE_PAGES[this.page]![cell]!;
    if (jump) this.focus = 'map';
  }

  private setPage(p: number): void {
    this.page = (p + PALETTE_PAGES.length) % PALETTE_PAGES.length;
    this.cell = this.anchorCell(Math.min(this.cell, 35));
  }

  private moveCursor(x: number, z: number): void {
    this.cursor = [clamp(x, 0, GRID - 1), clamp(z, 0, GRID - 1)];
    const row = GRID - 1 - this.cursor[1];
    if (this.cursor[0] < this.scrollX) this.scrollX = this.cursor[0];
    if (this.cursor[0] >= this.scrollX + COLS) this.scrollX = this.cursor[0] - COLS + 1;
    if (row < this.scrollY) this.scrollY = row;
    if (row >= this.scrollY + ROWS) this.scrollY = row - ROWS + 1;
  }

  private centreOnStart(): void {
    let at: [number, number] = [GRID >> 1, GRID >> 1];
    for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) if (isStart(this.track.elements[x]![z]!)) at = [x, z];
    this.cursor = at;
    this.scrollX = clamp(at[0] - (COLS >> 1), 0, GRID - COLS);
    this.scrollY = clamp(GRID - 1 - at[1] - (ROWS >> 1), 0, GRID - ROWS);
  }

  /** Enter / click on the track window: place the selected piece; twice quickly picks it up. */
  private build(x: number, z: number): void {
    const now = performance.now();
    const last = this.lastPlace;
    if (last && last.x === x && last.z === z && now - last.at < DOUBLE_MS) {
      // Double press: undo the first one and take the piece that was there.
      this.track = last.before;
      this.version++;
      this.lastPlace = null;
      const a = anchorOf(this.track, x, z);
      if (a) this.selected = this.track.elements[a[0]]![a[1]]!;
      return;
    }
    const before = cloneTrack(this.track);
    this.lastPlace = { x, z, at: now, before };
    if (this.selected === null) return;
    const err = placementError(this.track, x, z, this.selected);
    if (err) {
      this.showMessage(err);
      return;
    }
    if (placeAt(this.track, x, z, this.selected)) {
      this.dirty = true;
      this.version++;
    }
  }

  private showMessage(lines: string[]): void {
    this.dialog = { kind: 'menu', lines, options: [], selected: 0, pick: () => {} };
  }

  /** A message from outside (sharing finished), unless another box is open or the editor closed. */
  notice(lines: string[]): void {
    if (this.visible && !this.dialog) this.showMessage(lines);
  }

  /** "Track has been changed": save first, or go on and lose the changes. */
  private changed(goOn: string, then: () => void): void {
    if (!this.dirty) {
      then();
      return;
    }
    this.dialog = {
      kind: 'menu',
      lines: ['Track has been changed'],
      options: ['Save First', goOn],
      selected: 0,
      pick: (i) => (i === 0 ? this.askName(then) : then()),
    };
  }

  private press(f: Focus): void {
    switch (f) {
      case 'horizon':
        this.dialog = {
          kind: 'menu',
          lines: ['Select Horizon'],
          options: [...HORIZONS, 'Cancel'],
          selected: Math.min(this.track.horizon, HORIZONS.length - 1),
          pick: (i) => {
            if (i < HORIZONS.length && i !== this.track.horizon) {
              this.track.horizon = i as Horizon;
              this.dirty = true;
            }
          },
        };
        break;
      case 'load':
        this.changed('Load New Track', () => {
          const items = this.deps.trackNames();
          if (items.length) this.dialog = { kind: 'list', items, selected: 0, top: 0 };
        });
        break;
      case 'new':
        this.changed('Load New Track', () => {
          const presets = this.gfx?.terrains.length ?? 0;
          const options = Array.from({ length: Math.max(1, presets) }, (_, i) => `Terrain ${i + 1}`);
          this.dialog = {
            kind: 'menu',
            lines: ['Select Terrain'],
            options: [...options, 'Cancel'],
            selected: 0,
            pick: (i) => {
              if (i >= options.length) return;
              const t = createEmptyTrack(this.track.horizon);
              t.terrain = terrainFromPreset(this.gfx?.terrains[i] ?? null);
              this.track = t;
              this.version++;
              this.name = '';
              this.dirty = false;
              this.centreOnStart();
            },
          };
        });
        break;
      case 'save':
        this.askName(null);
        break;
      case 'done':
        // A track that fails the check can't be driven: say why, and stay.
        if (this.check(false)) this.leave();
        break;
    }
  }

  /** The original's track check: the message (always, or only when it fails); the cursor goes to the trouble. */
  private check(always = true): boolean {
    const r = checkTrack(this.track);
    if (r.at) {
      this.moveCursor(...r.at);
      this.focus = 'map';
    }
    if (always || r.error) this.showMessage(r.message);
    return r.error === null;
  }

  /** Leave the editor (Done, Escape): with the last saved version if it can be driven. */
  private leave(): void {
    this.changed('Exit Editor', () => {
      const s = this.saved;
      this.action = s && !checkTrack(s.track).error ? { type: 'done', track: cloneTrack(s.track), name: s.name } : { type: 'cancel' };
    });
  }

  private askName(then: (() => void) | null): void {
    this.dialog = { kind: 'name', text: this.name, then };
  }

  private saveAs(text: string, then: (() => void) | null): void {
    const name = text.trim();
    if (!name) return;
    this.dialog = null;
    if (!this.deps.save(name, this.track)) {
      this.showMessage(['Could not save:', 'the browser keeps no data.']);
      return;
    }
    this.name = name;
    this.dirty = false;
    this.saved = { track: cloneTrack(this.track), name };
    then?.();
  }

  private load(i: number): void {
    this.dialog = null;
    this.busy = true;
    void this.deps
      .loadTrack(i)
      .then((r) => {
        if (!r) return;
        this.track = cloneTrack(r.track);
        this.version++;
        this.name = r.name;
        this.saved = r.name ? { track: cloneTrack(r.track), name: r.name } : this.saved;
        this.dirty = false;
        this.centreOnStart();
      })
      .finally(() => (this.busy = false));
  }

  // ---- drawing ----------------------------------------------------------------------------------

  draw(c: CanvasRenderingContext2D, now: number): void {
    const key = [this.scrollX, this.scrollY, this.page, this.version, !!this.gfx, !!this.font].join();
    if (!this.layer || key !== this.layerKey) {
      this.layer ??= document.createElement('canvas');
      this.layer.width = 320;
      this.layer.height = 200;
      const l = this.layer.getContext('2d')!;
      l.imageSmoothingEnabled = false;
      l.fillStyle = '#000000';
      l.fillRect(0, 0, 320, 200);
      this.drawMap(l);
      bevelFrame(l, 6, 0, 207, 191);
      this.drawPalette(l);
      bevelFrame(l, 218, 32, 102, 159, true);
      this.layerKey = key;
    }
    c.drawImage(this.layer, 0, 0);
    this.drawCursor(c, now);
    this.drawHighlights(c);

    // The name of the piece under the cursor (or the palette highlight).
    const name =
      this.focus === 'map'
        ? tileName(this.track, ...this.cursor)
        : this.focus === 'grid'
          ? elementName(PALETTE_PAGES[this.page]![this.cell]!)
          : '';
    this.text(c, name, 10, 192, EGA[15]!);
    if (this.dialog) this.drawDialog(c, this.dialog, now);
  }

  /** Draw an original icon one pixel left of (x, y) (its first column is the grid line); false without one. */
  private icon(c: CanvasRenderingContext2D, name: string, x: number, y: number): boolean {
    const g = this.gfx;
    const i = g?.icons.get(name);
    if (!g || !i) return false;
    c.drawImage(g.atlas, i.sx, i.sy, i.w, i.h, x - 1, y, i.w, i.h);
    return true;
  }

  private drawTerrain(c: CanvasRenderingContext2D, code: number, x: number, y: number): void {
    if (!this.icon(c, terrainIcon(code), x, y)) drawTerrainFallback(c, code, x, y);
  }

  private drawPiece(c: CanvasRenderingContext2D, code: number, x: number, y: number): void {
    if (!this.icon(c, ELEMENT_ICONS[code] ?? '', x, y)) drawElementFallback(c, code, x, y);
  }

  private drawMap(c: CanvasRenderingContext2D): void {
    const t = this.track;
    c.save();
    c.beginPath();
    c.rect(MX - 1, MY, COLS * T, ROWS * T);
    c.clip();
    const px = (x: number): number => MX + (x - this.scrollX) * T;
    const py = (z: number): number => MY + (GRID - 1 - z - this.scrollY) * T;
    const x0 = this.scrollX;
    const zTop = GRID - 1 - this.scrollY;
    for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) this.drawTerrain(c, t.terrain[x0 + i]![zTop - j]!, px(x0 + i), py(zTop - j));
    // Pieces reach east and south from their anchor: start one tile further west and north.
    for (let x = x0 - 1; x < x0 + COLS; x++) {
      for (let z = zTop + 1; z > zTop - ROWS; z--) {
        if (x < 0 || x >= GRID || z < 0 || z >= GRID) continue;
        const code = t.elements[x]![z]!;
        if (code !== 0 && code < 0xfd) this.drawPiece(c, code, px(x), py(z));
      }
    }
    c.restore();

    // Scroll bars: white thumbs.
    const [vx, vy, vw, vh] = VBAR;
    c.fillStyle = EGA[15]!;
    c.fillRect(vx, vy + Math.round((this.scrollY / GRID) * vh), vw, Math.round((ROWS / GRID) * vh));
    const [hx, hy, hw, hh] = HBAR;
    c.fillRect(hx + Math.round((this.scrollX / GRID) * hw), hy, Math.round((COLS / GRID) * hw), hh);
  }

  /** The cursor flashes the selected piece over the square. */
  private drawCursor(c: CanvasRenderingContext2D, now: number): void {
    if (this.focus !== 'map' || this.dialog || Math.floor(now / FLASH_MS) % 2 !== 0) return;
    const px = (x: number): number => MX + (x - this.scrollX) * T;
    const py = (z: number): number => MY + (GRID - 1 - z - this.scrollY) * T;
    c.save();
    c.beginPath();
    c.rect(MX - 1, MY, COLS * T, ROWS * T);
    c.clip();
    {
      const [cx, cz] = this.cursor;
      const code = this.selected ?? 0;
      const { w, h } = code ? footprintOf(code) : { w: 1, h: 1 };
      if (!this.icon(c, ['crs0', 'crs1', 'crs2', 'crs3'][(w > 1 ? 2 : 0) + (h > 1 ? 1 : 0)]!, px(cx), py(cz))) {
        c.fillStyle = CYAN;
        c.fillRect(px(cx), py(cz), w * T - 1, h * T - 1);
      }
      if (code) this.drawPiece(c, code, px(cx), py(cz));
    }
    c.restore();
  }

  private drawPalette(c: CanvasRenderingContext2D): void {
    this.button(c, TITLE, 'Track Editor');
    const page = PALETTE_PAGES[this.page]!;
    for (let i = 0; i < 36; i++) this.drawTerrain(c, 0, PX + (i % 6) * T, PY + Math.floor(i / 6) * T);
    page.forEach((code, i) => {
      if (code !== 0 && code !== PALETTE_EAST && code !== PALETTE_SOUTH) this.drawPiece(c, code, PX + (i % 6) * T, PY + Math.floor(i / 6) * T);
    });
    // Page bar: the white thumb shows which of the ten pages this is.
    const [bx, by, bw, bh] = PAGE_BAR;
    c.fillStyle = EGA[15]!;
    c.fillRect(bx + Math.round((this.page / PALETTE_PAGES.length) * bw), by, Math.round(bw / PALETTE_PAGES.length), bh);
    for (const b of BUTTONS) this.button(c, b.rect, b.label);
  }

  /** Highlights in light red: the palette piece, the page bar or a button. */
  private drawHighlights(c: CanvasRenderingContext2D): void {
    if (this.dialog) return;
    const page = PALETTE_PAGES[this.page]!;
    const [bx, by, bw, bh] = PAGE_BAR;
    const b = BUTTONS.find((bt) => bt.id === this.focus);
    if (b) {
      const [x, y, w, h] = b.rect;
      outline(c, x - 1, y - 1, w + 2, h + 2, LIGHT_RED);
    }
    if (this.focus === 'grid') {
      const code = page[this.cell]!;
      const { w, h } = code ? footprintOf(code) : { w: 1, h: 1 };
      outline(c, PX + (this.cell % 6) * T - 1, PY + Math.floor(this.cell / 6) * T - 1, w * T + 1, h * T + 1, LIGHT_RED);
    }
    if (this.focus === 'bar') outline(c, bx - 1, by - 2, bw + 2, bh + 4, LIGHT_RED);
  }

  /** The original's bevelled grey buttons: white top and left, dark grey bottom and right. */
  private button(c: CanvasRenderingContext2D, [x, y, w, h]: Rect, label: string): void {
    c.fillStyle = EGA[8]!;
    c.fillRect(x, y, w, h);
    c.fillStyle = EGA[15]!;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + w, y);
    c.lineTo(x + w - 3, y + 3);
    c.lineTo(x + 3, y + 3);
    c.lineTo(x + 3, y + h - 3);
    c.lineTo(x, y + h);
    c.fill();
    c.fillStyle = EGA[7]!;
    c.fillRect(x + 3, y + 3, w - 6, h - 6);
    const tw = this.font ? textWidth(this.font, label) : label.length * 6;
    this.text(c, label, x + Math.round((w - tw) / 2), y + Math.round((h - 7) / 2), EGA[0]!);
  }

  private text(c: CanvasRenderingContext2D, s: string, x: number, y: number, colour: string): void {
    if (this.font) {
      drawText(c, this.font, s, x, y, colour);
      return;
    }
    c.font = 'bold 8px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillStyle = colour;
    c.fillText(s, x, y);
  }

  private menuWidth(d: Extract<Dialog, { kind: 'menu' }>): number {
    const all = [...d.lines, ...d.options];
    return Math.max(...all.map((s) => (this.font ? textWidth(this.font, s) : s.length * 6))) + 24;
  }

  private dialogOptionAt(d: Extract<Dialog, { kind: 'menu' }>, y: number): number | null {
    const box = menuBox(d.lines.length + 1 + d.options.length, this.menuWidth(d));
    const i = Math.floor((y - (box[1] + 9 + (d.lines.length + 1) * 10)) / 10);
    return i >= 0 && i < d.options.length ? i : null;
  }

  private drawDialog(c: CanvasRenderingContext2D, d: Dialog, now: number): void {
    if (d.kind === 'list') {
      const [x, y, w, h] = listBox();
      dialogBox(c, x, y, w, h);
      this.text(c, 'Load Track', x + 10, y + 9, EGA[15]!);
      if (d.top > 0) this.text(c, '(Scroll Up)', x + 10, y + 21, EGA[7]!);
      for (let r = 0; r < LIST_ROWS && d.top + r < d.items.length; r++) {
        const i = d.top + r;
        const ty = y + 33 + r * 10;
        this.itemText(c, d.items[i]!, x + 10, ty, i === d.selected);
      }
      if (d.top + LIST_ROWS < d.items.length) this.text(c, '(Scroll Down)', x + 10, y + h - 13, EGA[7]!);
      return;
    }
    if (d.kind === 'name') {
      const [x, y, w, h] = menuBox(4, 150);
      dialogBox(c, x, y, w, h);
      this.text(c, 'Save Track', x + 10, y + 9, EGA[15]!);
      const caret = Math.floor(now / 300) % 2 === 0 ? '_' : '';
      this.text(c, `Name: ${d.text}${caret}`, x + 10, y + 29, EGA[15]!);
      this.text(c, 'Enter: Save   Esc: Cancel', x + 10, y + 39, EGA[7]!);
      return;
    }
    const n = d.lines.length + (d.options.length ? 1 + d.options.length : 0);
    const [x, y, w, h] = menuBox(n, this.menuWidth(d));
    dialogBox(c, x, y, w, h);
    d.lines.forEach((s, i) => this.text(c, s, x + 10, y + 9 + i * 10, EGA[15]!));
    d.options.forEach((s, i) => this.itemText(c, s, x + 10, y + 9 + (d.lines.length + 1 + i) * 10, i === d.selected));
  }

  /** A list entry; the selected one in black on white. */
  private itemText(c: CanvasRenderingContext2D, s: string, x: number, y: number, selected: boolean): void {
    if (selected) {
      c.fillStyle = EGA[15]!;
      c.fillRect(x - 1, y - 1, (this.font ? textWidth(this.font, s) : s.length * 6) + 2, 9);
    }
    this.text(c, s, x, y, selected ? EGA[0]! : EGA[15]!);
  }
}

/** Light cyan and light blue on the top and left, light blue and blue on the bottom and right. */
function bevelFrame(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cutRight = false): void {
  const r = x + w - 1;
  const b = y + h - 1;
  c.fillStyle = CYAN;
  c.fillRect(x, y, w - 3, 2);
  c.fillRect(x, y, 2, h - 3);
  c.fillStyle = LIGHT_BLUE;
  c.fillRect(x + 2, y + 2, w - 5, 1);
  c.fillRect(x + 2, y + 2, 1, h - 5);
  c.fillRect(r - (cutRight ? 1 : 2), y + 2, 1, h - 4);
  c.fillRect(x + 2, b - 2, w - 4, 1);
  c.fillStyle = BLUE;
  c.fillRect(r - (cutRight ? 0 : 1), y, cutRight ? 1 : 2, h);
  c.fillRect(x, b - 1, w, 2);
}

/** The original's message boxes: black with a red line four pixels in. */
function dialogBox(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  c.fillStyle = EGA[0]!;
  c.fillRect(x, y, w, h);
  outline(c, x + 4, y + 5, w - 8, h - 9, EGA[4]!);
}

/** A one-pixel rectangle outline, pixel-aligned (filled lines, no path stroking). */
function outline(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string): void {
  c.fillStyle = colour;
  c.fillRect(x, y, w, 1);
  c.fillRect(x, y + h - 1, w, 1);
  c.fillRect(x, y, 1, h);
  c.fillRect(x + w - 1, y, 1, h);
}

/** A box for n lines of text, centred on the screen like the original's (128 wide at least). */
function menuBox(lines: number, width: number): Rect {
  const h = 18 + lines * 10;
  const w = Math.max(128, width);
  return [Math.round(160 - w / 2), Math.round(99 - h / 2), w, h];
}

function listBox(): Rect {
  return [96, 35, 128, 128];
}

/** Palette keys: + / - turn the page, F1-F10 pick one. */
function pageKey(e: KeyboardEvent): 'next' | 'prev' | number | null {
  if (e.code === 'NumpadAdd' || e.key === '+') return 'next';
  if (e.code === 'NumpadSubtract' || e.key === '-') return 'prev';
  const f = /^F(\d+)$/.exec(e.code);
  if (f && +f[1]! >= 1 && +f[1]! <= PALETTE_PAGES.length) return +f[1]! - 1;
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function cloneTrack(t: Track): Track {
  return {
    elements: t.elements.map((col) => [...col]),
    terrain: t.terrain.map((col) => [...col]),
    horizon: t.horizon,
    extra: t.extra,
    overlay: t.overlay.slice(),
  };
}
