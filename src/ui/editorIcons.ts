/*
 * Stand-in icons for the track editor when the player's Stunts files (SDTEDIT.PES) aren't there:
 * terrain tiles in the editor's EGA colours, and pieces drawn from the centre lines our track
 * builder lays down. With the files, the original's own icons are used instead.
 */

import * as THREE from 'three';
import { footprintOf, placeAt } from '../track/editor';
import { TILE } from '../track/constants';
import { buildTrack } from '../track/trackBuilder';
import { decodeTerrain, decodeTile, type Surface } from '../track/tiles';
import { createEmptyTrack } from '../track/trkFormat';

export const EGA = [
  '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
];
const GRASS = EGA[2]!;
const HILL = EGA[10]!;
const WATER = EGA[9]!;
const ROAD: Record<Surface, string> = { paved: EGA[8]!, dirt: EGA[6]!, ice: EGA[15]! };

/** Centre lines of a piece in tiles from its anchor tile's NW corner (u east, v south). */
const outlines = new Map<number, [number, number][][]>();

function outlineOf(code: number): [number, number][][] {
  let o = outlines.get(code);
  if (o) return o;
  o = [];
  const ax = 10;
  const az = 15;
  const t = createEmptyTrack();
  if (placeAt(t, ax, az, code)) {
    try {
      const built = buildTrack(t, null);
      for (const p of built.pieces) {
        if (p.anchor[0] === ax && p.anchor[1] === az) o.push(p.path.map(([e, n]): [number, number] => [e / TILE - ax, az + 1 - n / TILE]));
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

/** A terrain tile, 15x15 pixels from (x, y). */
export function drawTerrainFallback(c: CanvasRenderingContext2D, code: number, x: number, y: number): void {
  const s = 15;
  const t = decodeTerrain(code);
  c.fillStyle = t.kind === 'water' ? WATER : t.kind === 'hill' ? HILL : t.kind === 'flat' ? GRASS : slopeFill(c);
  c.fillRect(x, y, s, s);
  if (t.kind === 'coast') {
    c.fillStyle = GRASS;
    c.fillRect(x, y, s, s);
    const pts = { SW: [x, y + s], SE: [x + s, y + s], NE: [x + s, y], NW: [x, y] } as const;
    const order = ['SW', 'SE', 'NE', 'NW'] as const;
    const i = order.indexOf(t.water);
    c.fillStyle = WATER;
    c.beginPath();
    c.moveTo(...pts[order[(i + 3) % 4]!]);
    c.lineTo(...pts[t.water]);
    c.lineTo(...pts[order[(i + 1) % 4]!]);
    c.fill();
  }
}

/** A piece with its anchor tile's top-left corner at (x, y), s pixels per tile. */
export function drawElementFallback(c: CanvasRenderingContext2D, code: number, x: number, y: number, s = 16): void {
  const info = decodeTile(code);
  const { w, h } = footprintOf(code);
  const cx = x + (w * s) / 2;
  const cy = y + (h * s) / 2;
  if (info.kind === 'scenery' || info.kind === 'building') {
    c.fillStyle = info.kind === 'scenery' ? EGA[2]! : EGA[12]!;
    c.strokeStyle = '#000';
    c.fillRect(cx - s * 0.25, cy - s * 0.25, s * 0.5, s * 0.5);
    return;
  }
  const raised = info.kind === 'elevatedRoad' || info.kind === 'elevatedCorner' || info.kind === 'ramp';
  c.lineJoin = 'round';
  c.lineWidth = Math.max(1.5, s * 0.32);
  c.strokeStyle = raised ? EGA[7]! : 'surface' in info ? ROAD[info.surface] : ROAD.paved;
  for (const p of outlineOf(code)) {
    c.beginPath();
    p.forEach(([u, v], i) => (i ? c.lineTo(x + u * s, y + v * s) : c.moveTo(x + u * s, y + v * s)));
    c.stroke();
  }
  if (info.kind === 'start') {
    c.fillStyle = EGA[15]!;
    c.fillRect(cx - s * 0.3, cy - 1, s * 0.6, 2);
  }
}
