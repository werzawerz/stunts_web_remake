/*
 * The original's track editor: the track from above on a scrolling map of 12x11 tiles (left), the
 * "Track Editor" title, the pieces to build with and the Horizon / Load / New / Save / Done buttons
 * (right), and the name of the piece under the cursor along the bottom. Layout measured from the
 * original's 320x200 screen. Pieces are drawn from the centre lines our track builder lays down,
 * so the map always shows what you'll drive.
 */

import * as THREE from 'three';
import { anchorOf, CATALOG, footprintOf, isStart, placeAt, removeAt, setTerrain, startCount, tileName } from '../track/editor';
import { buildTrack } from '../track/trackBuilder';
import { decodeTerrain, decodeTile, type RoadStyle, type Surface } from '../track/tiles';
import { createEmptyTrack, GRID, Horizon, type Track } from '../track/trkFormat';
import { TILE } from '../track/constants';

export interface EditorDeps {
  /** Tracks the Load button offers. */
  trackNames: () => string[];
  loadTrack: (index: number) => Promise<{ track: Track; name: string } | null>;
  /** Save under a name; false when the browser won't store it. */
  save: (name: string, track: Track) => boolean;
}

export type EditorAction =
  | { type: 'none' }
  /** Done: drive the edited track. */
  | { type: 'done'; track: Track; name: string }
  /** Left without using the edits. */
  | { type: 'cancel' };

const NONE: EditorAction = { type: 'none' };

// Map: 12 x 11 tiles of 16 pixels, scroll bars right and below.
const MX = 9;
const MY = 4;
const COLS = 12;
const ROWS = 11;
const T = 16;
const VBAR: Rect = [203, MY, 5, ROWS * T];
const HBAR: Rect = [MX, 182, COLS * T, 5];
// Right column: pieces 4 x 4 per category, then the buttons.
const PX = 222;
const PY = 48;
const CELL = 23;
const PCOLS = 4;
type Rect = [number, number, number, number];
const BUTTONS: { label: string; rect: Rect }[] = [
  { label: 'Horizon', rect: [222, 143, 92, 12] },
  { label: 'Load', rect: [222, 157, 45, 12] },
  { label: 'New', rect: [269, 157, 45, 12] },
  { label: 'Save', rect: [222, 171, 45, 12] },
  { label: 'Done', rect: [269, 171, 45, 12] },
];
const HORIZONS = ['Desert', 'Tropical', 'Alpine', 'City', 'Country'];
const LIST_ROWS = 8;

const GRASS = '#00a800';
const HILL = '#54fc54';
const WATER = '#5454fc';
const ROAD: Record<Surface, string> = { paved: '#545454', dirt: '#a85400', ice: '#a8fcfc' };
const ELEVATED = '#a8a8a8';
/** Edging that tells the stand-in roads apart (tunnel walls, pipe sides, banking...). */
const EDGE: Partial<Record<RoadStyle, string>> = {
  tunnel: '#000000',
  pipe: '#a8a8a8',
  halfpipe: '#a8a8a8',
  banked: '#a80000',
  highway: '#fcfcfc',
  slalom: '#fcfc54',
  cork: '#fc54fc',
};

const inside = (x: number, y: number, [rx, ry, rw, rh]: Rect): boolean => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

/** Centre lines of a piece in tiles from its anchor tile's NW corner (u east, v south). */
interface Outline {
  paths: [number, number][][];
}
const outlines = new Map<number, Outline>();

function outlineOf(code: number): Outline {
  let o = outlines.get(code);
  if (o) return o;
  o = { paths: [] };
  const ax = 10;
  const az = 15;
  const t = createEmptyTrack();
  if (placeAt(t, ax, az, code)) {
    try {
      const built = buildTrack(t, null);
      for (const p of built.pieces) {
        if (p.anchor[0] !== ax || p.anchor[1] !== az) continue;
        o.paths.push(p.path.map(([e, n]): [number, number] => [e / TILE - ax, az + 1 - n / TILE]));
      }
      built.group.traverse((m) => {
        if (m instanceof THREE.Mesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    } catch {
      // Drawn as an empty tile.
    }
  }
  outlines.set(code, o);
  return o;
}

let dither: CanvasPattern | null | undefined;
/** The original's dithered slopes: hill and grass pixels in a checkerboard. */
function slopeFill(c: CanvasRenderingContext2D): CanvasPattern | string {
  if (dither === undefined) {
    const p = document.createElement('canvas');
    p.width = p.height = 2;
    const pc = p.getContext('2d')!;
    pc.fillStyle = GRASS;
    pc.fillRect(0, 0, 2, 2);
    pc.fillStyle = HILL;
    pc.fillRect(0, 0, 1, 1);
    pc.fillRect(1, 1, 1, 1);
    dither = c.createPattern(p, 'repeat');
  }
  return dither ?? HILL;
}

function drawTerrain(c: CanvasRenderingContext2D, code: number, x: number, y: number, s: number): void {
  const t = decodeTerrain(code);
  c.fillStyle = GRASS;
  c.fillRect(x, y, s, s);
  const SW: [number, number] = [x, y + s];
  const SE: [number, number] = [x + s, y + s];
  const NE: [number, number] = [x + s, y];
  const NW: [number, number] = [x, y];
  const tri = (a: [number, number], b: [number, number], d: [number, number], fill: string | CanvasPattern): void => {
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(...a);
    c.lineTo(...b);
    c.lineTo(...d);
    c.closePath();
    c.fill();
  };
  if (t.kind === 'water') {
    c.fillStyle = WATER;
    c.fillRect(x, y, s, s);
  } else if (t.kind === 'hill') {
    c.fillStyle = HILL;
    c.fillRect(x, y, s, s);
  } else if (t.kind === 'slope') {
    c.fillStyle = slopeFill(c);
    c.fillRect(x, y, s, s);
    // The top of the slope.
    c.fillStyle = HILL;
    if (t.ascent === 'N') c.fillRect(x, y, s, 2);
    if (t.ascent === 'S') c.fillRect(x, y + s - 2, s, 2);
    if (t.ascent === 'E') c.fillRect(x + s - 2, y, 2, s);
    if (t.ascent === 'W') c.fillRect(x, y, 2, s);
  } else if (t.kind === 'corner') {
    // Same split as the track builder: each triangle hill, grass or slope by its corner heights.
    const [sw, se, ne, nw] = t.heights;
    const fill = (k: number): string | CanvasPattern => (k === 3 ? HILL : k === 0 ? GRASS : slopeFill(c));
    if (sw !== ne || t.heights[0] === t.heights[2]) {
      tri(SW, SE, NW, fill(sw + se + nw));
      tri(SE, NE, NW, fill(se + ne + nw));
    } else {
      tri(SW, SE, NE, fill(sw + se + ne));
      tri(SW, NE, NW, fill(sw + ne + nw));
    }
  } else if (t.kind === 'coast') {
    const corners = { SW, SE, NE, NW };
    const order = ['SW', 'SE', 'NE', 'NW'] as const;
    const i = order.indexOf(t.water);
    tri(corners[order[(i + 3) % 4]!], corners[t.water], corners[order[(i + 1) % 4]!], WATER);
  }
}

/** One element with its anchor tile's top-left corner at (x, y), s pixels per tile. */
function drawElement(c: CanvasRenderingContext2D, code: number, x: number, y: number, s: number): void {
  const info = decodeTile(code);
  const { w, h } = footprintOf(code);
  const cx = x + (w * s) / 2;
  const cy = y + (h * s) / 2;
  if (info.kind === 'scenery' || info.kind === 'building') {
    drawScenery(c, info, cx, cy, s);
    return;
  }
  const o = outlineOf(code);
  const width = Math.max(1.5, s * 0.36);
  const raised = info.kind === 'elevatedRoad' || info.kind === 'elevatedCorner' || info.kind === 'ramp';
  const colour = 'surface' in info ? ROAD[info.surface] : ROAD.paved;
  c.lineJoin = 'round';
  c.lineCap = 'butt';
  const stroke = (lw: number, style: string): void => {
    c.lineWidth = lw;
    c.strokeStyle = style;
    for (const p of o.paths) {
      c.beginPath();
      p.forEach(([u, v], i) => (i ? c.lineTo(x + u * s, y + v * s) : c.moveTo(x + u * s, y + v * s)));
      c.stroke();
    }
  };
  const edge = (info.kind === 'road' || info.kind === 'longRoad') && info.style ? EDGE[info.style] : undefined;
  if (raised) {
    stroke(width + 2, '#000000');
    stroke(width, ELEVATED);
  } else if (edge) {
    stroke(width + 2, edge);
    stroke(width - 1, colour);
  } else stroke(width, colour);
  if (info.kind === 'loop') {
    c.lineWidth = Math.max(1, width * 0.6);
    c.strokeStyle = ELEVATED;
    c.beginPath();
    c.ellipse(cx, cy, info.axis === 'NS' ? s * 0.3 : s * 0.75, info.axis === 'NS' ? s * 0.75 : s * 0.3, 0, 0, Math.PI * 2);
    c.stroke();
  }
  if (info.kind === 'start') {
    // The chequered line across the road.
    const across = info.dir === 'N' || info.dir === 'S';
    const n = 4;
    const len = width * 1.4;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        c.fillStyle = (i + j) % 2 ? '#000000' : '#fcfcfc';
        const a = -len / 2 + (i * len) / n;
        const b = -s * 0.08 + j * s * 0.08;
        if (across) c.fillRect(cx + a, cy + b, len / n, s * 0.08);
        else c.fillRect(cx + b, cy + a, s * 0.08, len / n);
      }
    }
  }
}

function drawScenery(
  c: CanvasRenderingContext2D,
  info: Extract<ReturnType<typeof decodeTile>, { kind: 'scenery' | 'building' }>,
  cx: number,
  cy: number,
  s: number,
): void {
  const k = s / 16;
  const box = (w: number, h: number, fill: string, dx = 0, dy = 0): void => {
    c.fillStyle = '#000000';
    c.fillRect(cx + (dx - w / 2) * k - 0.5, cy + (dy - h / 2) * k - 0.5, w * k + 1, h * k + 1);
    c.fillStyle = fill;
    c.fillRect(cx + (dx - w / 2) * k, cy + (dy - h / 2) * k, w * k, h * k);
  };
  if (info.kind === 'scenery') {
    if (info.type === 'pine') {
      c.fillStyle = '#a85400';
      c.fillRect(cx - 0.5 * k, cy + 3 * k, 1 * k, 3 * k);
      c.fillStyle = '#005400';
      c.strokeStyle = '#000000';
      c.lineWidth = 0.5;
      c.beginPath();
      c.moveTo(cx, cy - 6 * k);
      c.lineTo(cx + 4.5 * k, cy + 3.5 * k);
      c.lineTo(cx - 4.5 * k, cy + 3.5 * k);
      c.closePath();
      c.fill();
      c.stroke();
    } else if (info.type === 'palm') {
      c.fillStyle = '#a85400';
      c.fillRect(cx - 0.5 * k, cy - 2 * k, 1 * k, 8 * k);
      c.fillStyle = '#54a800';
      c.strokeStyle = '#005400';
      c.beginPath();
      c.arc(cx, cy - 3 * k, 3.5 * k, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    } else {
      box(2, 10, '#54a800');
      box(4, 1.5, '#54a800', 0, 0);
    }
    return;
  }
  switch (info.type) {
    case 'tennis':
      box(12, 8, '#00a8a8');
      c.fillStyle = '#fcfcfc';
      c.fillRect(cx - 0.25 * k, cy - 4 * k, 0.5 * k, 8 * k);
      break;
    case 'gas':
      box(10, 6, '#fcfcfc');
      box(10, 2, '#a80000', 0, -3);
      break;
    case 'barn':
      box(9, 9, '#a80000');
      box(9, 2, '#545454');
      break;
    case 'office':
      box(9, 9, '#a8a8a8');
      c.fillStyle = '#5454fc';
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) c.fillRect(cx + (i * 3 - 0.75) * k, cy + (j * 3 - 0.75) * k, 1.5 * k, 1.5 * k);
      break;
    case 'windmill':
      box(4, 4, '#a85400');
      box(12, 1, '#fcfcfc');
      box(1, 12, '#fcfcfc');
      break;
    case 'ship':
      if (info.facing === 'N' || info.facing === 'S') box(5, 13, '#fcfcfc');
      else box(13, 5, '#fcfcfc');
      box(3, 3, '#a80000');
      break;
    case 'diner':
      box(11, 7, '#fc5454');
      box(11, 2, '#fcfc54', 0, -2.5);
      break;
  }
}

function bevelButton(c: CanvasRenderingContext2D, [x, y, w, h]: Rect, label: string): void {
  c.fillStyle = '#a8a8a8';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#fcfcfc';
  c.fillRect(x, y, w, 1);
  c.fillRect(x, y, 1, h);
  c.fillStyle = '#545454';
  c.fillRect(x, y + h - 1, w, 1);
  c.fillRect(x + w - 1, y, 1, h);
  c.font = 'bold 8px monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#000000';
  c.fillText(label, x + w / 2, y + h / 2 + 0.5);
}

function frame(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  c.strokeStyle = '#5454fc';
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.strokeStyle = '#54fcfc';
  c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

export class TrackEditor {
  visible = false;
  private track: Track = createEmptyTrack();
  private name = '';
  private dirty = false;
  private scrollX = 0;
  private scrollY = 0;
  private cursor: [number, number] = [0, 0];
  private category = 0;
  private piece = 0;
  private rot = 0;
  private message = '';
  private messageUntil = 0;
  /** Pressed once already: asks for a second press before throwing work away. */
  private confirm: 'new' | 'leave' | null = null;
  private list: { items: string[]; selected: number; top: number } | null = null;
  private prompt: { text: string } | null = null;
  private busy = false;

  constructor(private readonly deps: EditorDeps) {}

  /** Open on a copy of a track (an empty one for a new track). */
  open(track: Track | null, name: string): void {
    this.visible = true;
    this.track = track ? cloneTrack(track) : createEmptyTrack();
    this.name = name;
    this.dirty = false;
    this.list = null;
    this.prompt = null;
    this.confirm = null;
    this.centreOnStart();
    this.say('Arrows: move  Space: build  Del: erase  R: turn', 6000);
  }

  close(): void {
    this.visible = false;
    this.list = null;
    this.prompt = null;
  }

  /** Text is being typed (the save prompt). */
  get typing(): boolean {
    return this.prompt !== null;
  }

  private get pieceDef() {
    return CATALOG[this.category]!.pieces[this.piece]!;
  }

  private get code(): number {
    const p = this.pieceDef;
    return p.codes[this.rot % p.codes.length]!;
  }

  private say(text: string, ms = 2500): void {
    this.message = text;
    this.messageUntil = performance.now() + ms;
  }

  private centreOnStart(): void {
    let at: [number, number] = [GRID >> 1, GRID >> 1];
    for (let x = 0; x < GRID; x++) for (let z = 0; z < GRID; z++) if (isStart(this.track.elements[x]![z]!)) at = [x, z];
    this.cursor = at;
    this.scrollX = clamp(at[0] - (COLS >> 1), 0, GRID - COLS);
    this.scrollY = clamp(GRID - 1 - at[1] - (ROWS >> 1), 0, GRID - ROWS);
  }

  private follow(): void {
    const [x, z] = this.cursor;
    const row = GRID - 1 - z;
    if (x < this.scrollX) this.scrollX = x;
    if (x >= this.scrollX + COLS) this.scrollX = x - COLS + 1;
    if (row < this.scrollY) this.scrollY = row;
    if (row >= this.scrollY + ROWS) this.scrollY = row - ROWS + 1;
  }

  private build(x: number, z: number): void {
    const p = this.pieceDef;
    this.confirm = null;
    if (p.terrain) {
      setTerrain(this.track, x, z, this.code);
      this.dirty = true;
      return;
    }
    if (placeAt(this.track, x, z, this.code)) this.dirty = true;
    else this.say("It doesn't fit there");
  }

  private erase(x: number, z: number): void {
    this.confirm = null;
    if (anchorOf(this.track, x, z)) removeAt(this.track, x, z);
    else setTerrain(this.track, x, z, 0);
    this.dirty = true;
  }

  private selectPiece(category: number, piece: number): void {
    if (category === this.category && piece === this.piece) {
      this.rot = (this.rot + 1) % this.pieceDef.codes.length;
      return;
    }
    this.category = category;
    this.piece = piece;
    this.rot = 0;
  }

  private stepCategory(step: number): void {
    this.selectPiece((this.category + step + CATALOG.length) % CATALOG.length, 0);
  }

  key(e: KeyboardEvent): EditorAction {
    const code = e.code;
    const enter = code === 'Enter' || code === 'NumpadEnter';
    if (this.busy) return NONE;
    if (this.prompt) {
      const p = this.prompt;
      if (code === 'Escape') this.prompt = null;
      else if (code === 'Backspace') p.text = p.text.slice(0, -1);
      else if (enter) {
        const name = p.text.trim();
        if (!name) return NONE;
        this.prompt = null;
        if (this.deps.save(name, this.track)) {
          this.name = name;
          this.dirty = false;
          this.say(`Saved '${name}'`);
        } else this.say('Could not save: browser storage is full or off');
      } else if (e.key.length === 1 && p.text.length < 20) p.text += e.key;
      return NONE;
    }
    const l = this.list;
    if (l) {
      if (code === 'ArrowUp') l.selected = (l.selected + l.items.length - 1) % l.items.length;
      else if (code === 'ArrowDown') l.selected = (l.selected + 1) % l.items.length;
      else if (code === 'Escape') this.list = null;
      else if (enter || code === 'Space') {
        this.list = null;
        this.load(l.selected);
      }
      l.top = Math.min(Math.max(l.top, l.selected - LIST_ROWS + 1), l.selected);
      return NONE;
    }
    const move: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const m = move[code];
    if (m) {
      this.cursor = [clamp(this.cursor[0] + m[0], 0, GRID - 1), clamp(this.cursor[1] + m[1], 0, GRID - 1)];
      this.follow();
    } else if (code === 'Space' || enter) this.build(...this.cursor);
    else if (code === 'Delete' || code === 'Backspace') this.erase(...this.cursor);
    else if (code === 'KeyR') this.rot = (this.rot + 1) % this.pieceDef.codes.length;
    else if (code === 'Tab') this.stepCategory(e.shiftKey ? -1 : 1);
    else if (code === 'Comma' || code === 'Period') {
      const n = CATALOG[this.category]!.pieces.length;
      this.selectPiece(this.category, (this.piece + (code === 'Comma' ? n - 1 : 1)) % n);
    } else if (code === 'KeyH') return this.button(0);
    else if (code === 'Escape') {
      if (this.dirty && this.confirm !== 'leave') {
        this.confirm = 'leave';
        this.say('Esc again leaves without your changes', 4000);
        return NONE;
      }
      return { type: 'cancel' };
    }
    return NONE;
  }

  /** Mouse click (button 0) or right click (button 2), in 320x200 screen pixels. */
  click(x: number, y: number, button = 0): EditorAction {
    if (this.busy || this.prompt) return NONE;
    if (this.list) {
      const row = Math.floor((y - 69) / 10);
      if (x >= 66 && x < 254 && row >= 0 && row < LIST_ROWS && this.list.top + row < this.list.items.length) {
        this.list.selected = this.list.top + row;
        const i = this.list.selected;
        this.list = null;
        this.load(i);
      } else if (!inside(x, y, [64, 36, 192, 126])) this.list = null;
      return NONE;
    }
    const tile = this.tileAt(x, y);
    if (tile) {
      this.cursor = tile;
      if (button === 2) this.erase(...tile);
      else this.build(...tile);
      return NONE;
    }
    if (inside(x, y, VBAR)) {
      const [, by, , bh] = VBAR;
      this.scrollY = clamp(Math.round(((y - by) / bh) * GRID - ROWS / 2), 0, GRID - ROWS);
      return NONE;
    }
    if (inside(x, y, HBAR)) {
      const [bx, , bw] = HBAR;
      this.scrollX = clamp(Math.round(((x - bx) / bw) * GRID - COLS / 2), 0, GRID - COLS);
      return NONE;
    }
    if (inside(x, y, [218, 35, 100, 12])) {
      this.stepCategory(x < 268 ? -1 : 1);
      return NONE;
    }
    const col = Math.floor((x - PX) / CELL);
    const row = Math.floor((y - PY) / CELL);
    if (col >= 0 && col < PCOLS && row >= 0 && row < 4) {
      const i = row * PCOLS + col;
      if (i < CATALOG[this.category]!.pieces.length) this.selectPiece(this.category, i);
      return NONE;
    }
    const b = BUTTONS.findIndex((bt) => inside(x, y, bt.rect));
    return b >= 0 ? this.button(b) : NONE;
  }

  /** Mouse over the map moves the cursor. */
  move(x: number, y: number): void {
    if (this.list || this.prompt) return;
    const tile = this.tileAt(x, y);
    if (tile) this.cursor = tile;
  }

  /** Mouse wheel scrolls the map (with Shift, sideways). */
  wheel(dy: number, sideways: boolean): void {
    const step = Math.sign(dy);
    if (sideways) this.scrollX = clamp(this.scrollX + step, 0, GRID - COLS);
    else this.scrollY = clamp(this.scrollY + step, 0, GRID - ROWS);
  }

  private tileAt(x: number, y: number): [number, number] | null {
    if (!inside(x, y, [MX, MY, COLS * T, ROWS * T])) return null;
    const col = Math.floor((x - MX) / T);
    const row = Math.floor((y - MY) / T);
    return [this.scrollX + col, GRID - 1 - (this.scrollY + row)];
  }

  private button(i: number): EditorAction {
    const label = BUTTONS[i]!.label;
    if (label !== 'New' && label !== 'Done') this.confirm = null;
    switch (label) {
      case 'Horizon':
        this.track.horizon = ((this.track.horizon + 1) % HORIZONS.length) as Horizon;
        this.dirty = true;
        this.say(`Horizon: ${HORIZONS[this.track.horizon]}`);
        break;
      case 'Load': {
        const items = this.deps.trackNames();
        if (items.length) this.list = { items, selected: 0, top: 0 };
        break;
      }
      case 'New':
        if (this.dirty && this.confirm !== 'new') {
          this.confirm = 'new';
          this.say('Press New again to clear the track', 4000);
          break;
        }
        this.track = createEmptyTrack(this.track.horizon);
        this.name = '';
        this.dirty = false;
        this.confirm = null;
        this.say('New track');
        break;
      case 'Save':
        this.prompt = { text: this.name };
        break;
      case 'Done': {
        const n = startCount(this.track);
        if (n !== 1) {
          this.say(n === 0 ? 'The track needs a start/finish line' : 'Only one start/finish line, please', 4000);
          break;
        }
        return { type: 'done', track: cloneTrack(this.track), name: this.name };
      }
    }
    return NONE;
  }

  private load(i: number): void {
    this.busy = true;
    this.say('Loading...', 10000);
    void this.deps
      .loadTrack(i)
      .then((r) => {
        if (!r) {
          this.say("That track isn't available");
          return;
        }
        this.track = cloneTrack(r.track);
        this.name = r.name;
        this.dirty = false;
        this.confirm = null;
        this.centreOnStart();
        this.say(`Loaded '${r.name}'`);
      })
      .finally(() => (this.busy = false));
  }

  draw(c: CanvasRenderingContext2D, now: number): void {
    c.fillStyle = '#000000';
    c.fillRect(0, 0, 320, 200);
    this.drawMap(c, now);
    frame(c, MX - 3, MY - 3, COLS * T + 18, ROWS * T + 14);
    this.drawPanel(c);

    // Bottom line: what's under the cursor, or a message.
    c.font = 'bold 8px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = '#fcfcfc';
    const text = now < this.messageUntil ? this.message : tileName(this.track, ...this.cursor);
    c.fillText(text, 8, 195);

    if (this.list) this.drawList(c, this.list);
    if (this.prompt) this.drawPrompt(c, this.prompt.text, now);
  }

  private drawMap(c: CanvasRenderingContext2D, now: number): void {
    const t = this.track;
    c.save();
    c.beginPath();
    c.rect(MX, MY, COLS * T, ROWS * T);
    c.clip();
    const px = (x: number): number => MX + (x - this.scrollX) * T;
    const py = (z: number): number => MY + (GRID - 1 - z - this.scrollY) * T;
    const x0 = this.scrollX;
    const zTop = GRID - 1 - this.scrollY;
    for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) drawTerrain(c, t.terrain[x0 + i]![zTop - j]!, px(x0 + i), py(zTop - j), T);
    // Grid lines.
    c.fillStyle = '#000000';
    for (let i = 0; i <= COLS; i++) c.fillRect(MX + i * T, MY, 1, ROWS * T);
    for (let j = 0; j <= ROWS; j++) c.fillRect(MX, MY + j * T, COLS * T, 1);
    // Elements (pieces reach east and south from their anchor, so look one tile further west and north).
    for (let x = x0 - 1; x < x0 + COLS; x++) {
      for (let z = zTop + 1; z > zTop - ROWS; z--) {
        if (x < 0 || x >= GRID || z < 0 || z >= GRID) continue;
        const code = t.elements[x]![z]!;
        if (code === 0 || code >= 0xfd) continue;
        drawElement(c, code, px(x), py(z), T);
      }
    }
    // Cursor: the blinking tile, and where the piece would go.
    const [cx, cz] = this.cursor;
    if (!this.list && !this.prompt) {
      const { w, h } = this.pieceDef.terrain ? { w: 1, h: 1 } : footprintOf(this.code);
      c.globalAlpha = 0.55;
      if (this.pieceDef.terrain) drawTerrain(c, this.code, px(cx), py(cz), T);
      else drawElement(c, this.code, px(cx), py(cz), T);
      c.globalAlpha = 1;
      c.strokeStyle = '#fcfc54';
      c.lineWidth = 1;
      c.strokeRect(px(cx) + 0.5, py(cz) + 0.5, w * T, h * T);
      if (Math.floor(now / 300) % 2 === 0) {
        c.fillStyle = 'rgba(84, 252, 252, 0.6)';
        c.fillRect(px(cx) + 1, py(cz) + 1, T - 1, T - 1);
      }
    }
    c.restore();

    // Scroll bars: white thumbs on black.
    const [vx, vy, vw, vh] = VBAR;
    c.fillStyle = '#000000';
    c.fillRect(vx, vy, vw, vh);
    c.fillStyle = '#fcfcfc';
    c.fillRect(vx, vy + (this.scrollY / GRID) * vh, vw, (ROWS / GRID) * vh);
    const [hx, hy, hw, hh] = HBAR;
    c.fillStyle = '#000000';
    c.fillRect(hx, hy, hw, hh);
    c.fillStyle = '#fcfcfc';
    c.fillRect(hx + (this.scrollX / GRID) * hw, hy, (COLS / GRID) * hw, hh);
  }

  private drawPanel(c: CanvasRenderingContext2D): void {
    bevelButton(c, [218, 4, 100, 20], 'Track Editor');
    frame(c, 216, 31, 104, 160);
    const cat = CATALOG[this.category]!;
    c.font = 'bold 8px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#fcfcfc';
    c.fillText(`< ${cat.name} >`, 268, 41);
    cat.pieces.forEach((p, i) => {
      const x = PX + (i % PCOLS) * CELL;
      const y = PY + Math.floor(i / PCOLS) * CELL;
      const code = p.codes[i === this.piece ? this.rot % p.codes.length : 0]!;
      c.fillStyle = GRASS;
      c.fillRect(x, y, CELL - 2, CELL - 2);
      c.save();
      c.beginPath();
      c.rect(x, y, CELL - 2, CELL - 2);
      c.clip();
      if (p.terrain) drawTerrain(c, code, x + 2, y + 2, CELL - 6);
      else {
        const { w, h } = footprintOf(code);
        const s = (CELL - 4) / Math.max(w, h);
        drawElement(c, code, x + 1 + ((CELL - 4) - w * s) / 2, y + 1 + ((CELL - 4) - h * s) / 2, s);
      }
      c.restore();
      if (i === this.piece) {
        c.strokeStyle = '#fcfc54';
        c.lineWidth = 1;
        c.strokeRect(x - 0.5, y - 0.5, CELL - 1, CELL - 1);
      }
    });
    BUTTONS.forEach((b) => bevelButton(c, b.rect, b.label));
  }

  private drawList(c: CanvasRenderingContext2D, l: { items: string[]; selected: number; top: number }): void {
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

  private drawPrompt(c: CanvasRenderingContext2D, text: string, now: number): void {
    const x = 64;
    const y = 76;
    const w = 192;
    const h = 44;
    c.fillStyle = '#000000';
    c.fillRect(x, y, w, h);
    c.strokeStyle = '#a80000';
    c.lineWidth = 1;
    c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    c.font = 'bold 8px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = '#fcfcfc';
    c.fillText('Save Track as:', x + 8, y + 11);
    const caret = Math.floor(now / 300) % 2 === 0 ? '_' : ' ';
    c.fillText(text + caret, x + 8, y + 24);
    c.fillStyle = '#a8a8a8';
    c.fillText('Enter: save   Esc: cancel', x + 8, y + 36);
  }
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
