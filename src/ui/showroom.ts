import * as THREE from 'three';
import type { Sprite } from '../original/cockpit';

/*
 * The original's car selection screen: the car turning on a turntable on a stage (top), and below
 * it an acceleration graph (0-150 mph over 0-40 s), the car's description and the buttons Done,
 * Next, Last, Auto/Manual and Color. Layout measured from the original's 320x200 screen. The stage
 * picture and graph grid are the original's (SDCSEL.PVS, from the player's files) when available.
 */

export interface ShowroomCar {
  name: string;
  /** Description lines (the original's "edes" text when available). */
  description: string[];
  paints: number;
  /** Speed (mph) every half second from a standing start, flat out, up to 40 s. */
  curveMph: number[];
}

export interface ShowroomDeps {
  count: number;
  info: (index: number) => ShowroomCar;
  buildCar: (index: number, paint: number) => THREE.Object3D;
}

export type ShowroomAction = { type: 'done' } | { type: 'none' };

const BUTTONS = ['Done', 'Next', 'Last', 'Auto', 'Color'] as const;
/** Button rectangles (x, y, w, h). */
const BUTTON_RECTS: [number, number, number, number][] = [109, 127, 145, 163, 181].map((y) => [230, y, 87, 16]);
const STAGE_H = 103;
/** Turntable speed: about one turn in six seconds, like the original. */
const SPIN = Math.PI / 3;

export class Showroom {
  visible = false;
  index = 0;
  paint = 0;
  manual = false;
  private selected = 0;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 320 / 200, 0.1, 200);
  private car: THREE.Object3D | null = null;
  private angle = Math.PI * 0.8;
  private readonly bgCanvas = document.createElement('canvas');
  private readonly bg: THREE.CanvasTexture;
  /** Original stage picture and graph grid, when the player's files have them. */
  private stage: Sprite | null = null;
  private grid: Sprite | null = null;

  constructor(private readonly deps: ShowroomDeps) {
    this.bgCanvas.width = 320;
    this.bgCanvas.height = 200;
    this.bg = new THREE.CanvasTexture(this.bgCanvas);
    this.bg.colorSpace = THREE.SRGBColorSpace;
    this.bg.magFilter = THREE.NearestFilter;
    this.scene.background = this.bg;
    // Looking down at the turntable; the view is shifted so the car sits on it, above the panel.
    const d = 17;
    const tilt = (24 * Math.PI) / 180;
    this.camera.position.set(0, d * Math.sin(tilt), d * Math.cos(tilt));
    this.camera.lookAt(0, 0.5, 0);
    this.camera.setViewOffset(320, 200, 0, 48, 320, 200);
    this.paintStage();
  }

  setPictures(stage: Sprite | null, grid: Sprite | null): void {
    this.stage = stage;
    this.grid = grid;
    this.paintStage();
  }

  open(index: number, paint: number, manual: boolean): void {
    this.visible = true;
    this.index = index;
    this.paint = paint;
    this.manual = manual;
    this.selected = 0;
    this.rebuild();
  }

  close(): void {
    this.visible = false;
    this.setCar(null);
  }

  key(code: string): ShowroomAction {
    if (code === 'ArrowUp' || code === 'ArrowLeft') this.selected = (this.selected + BUTTONS.length - 1) % BUTTONS.length;
    else if (code === 'ArrowDown' || code === 'ArrowRight') this.selected = (this.selected + 1) % BUTTONS.length;
    else if (code === 'Escape') return { type: 'done' };
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') return this.activate(this.selected);
    return { type: 'none' };
  }

  click(x: number, y: number): ShowroomAction {
    const i = BUTTON_RECTS.findIndex(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh);
    if (i < 0) return { type: 'none' };
    this.selected = i;
    return this.activate(i);
  }

  private activate(i: number): ShowroomAction {
    const n = this.deps.count;
    switch (BUTTONS[i]) {
      case 'Done':
        return { type: 'done' };
      case 'Next':
        this.index = (this.index + 1) % n;
        this.paint = 0;
        this.rebuild();
        break;
      case 'Last':
        this.index = (this.index + n - 1) % n;
        this.paint = 0;
        this.rebuild();
        break;
      case 'Auto':
        this.manual = !this.manual;
        break;
      case 'Color':
        this.paint = (this.paint + 1) % Math.max(1, this.deps.info(this.index).paints);
        this.rebuild();
        break;
    }
    return { type: 'none' };
  }

  private rebuild(): void {
    this.setCar(this.deps.buildCar(this.index, this.paint));
  }

  private setCar(obj: THREE.Object3D | null): void {
    if (this.car) {
      this.scene.remove(this.car);
      this.car.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.car = obj;
    if (obj) {
      // Centre the car on the turntable, wheels on its top.
      const box = new THREE.Box3().setFromObject(obj);
      const holder = new THREE.Group();
      obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      holder.add(obj);
      this.car = holder;
      this.scene.add(holder);
    }
  }

  update(dt: number): void {
    this.angle += SPIN * dt;
    if (this.car) this.car.rotation.y = this.angle;
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  /** The stage behind the car: the original picture, or our own stand-in. */
  private paintStage(): void {
    const c = this.bgCanvas.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    if (this.stage) c.drawImage(this.stage.image, this.stage.x, this.stage.y);
    else {
      c.fillStyle = '#c8c8c8';
      c.fillRect(0, 0, 320, 50);
      c.fillStyle = '#c81c1c';
      c.fillRect(0, 50, 320, STAGE_H - 50);
      c.fillStyle = '#7c7c7c';
      c.beginPath();
      c.ellipse(160, 62, 112, 30, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#a8a8a8';
      c.beginPath();
      c.ellipse(160, 58, 104, 24, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#1c3cc8';
      c.fillRect(0, 0, 26, STAGE_H);
      c.fillRect(294, 0, 26, STAGE_H);
    }
    c.fillStyle = '#a8a8a8';
    c.fillRect(0, STAGE_H, 320, 200 - STAGE_H);
    this.bg.needsUpdate = true;
  }

  /** The bottom panel (graph, description, buttons), drawn on the 320x200 overlay. */
  drawPanel(c: CanvasRenderingContext2D, now: number): void {
    const info = this.deps.info(this.index);
    c.fillStyle = '#545454';
    c.fillRect(0, STAGE_H, 320, 2);
    c.fillStyle = '#a8a8a8';
    c.fillRect(0, STAGE_H + 2, 320, 200 - STAGE_H - 2);
    inset(c, 4, 106, 72, 91);
    inset(c, 82, 106, 141, 91);

    // Acceleration graph: 0-150 mph against 0-40 s.
    const px = (t: number): number => 28 + (t / 40) * 42;
    const py = (mph: number): number => 179 - (mph / 150) * 61;
    if (this.grid) c.drawImage(this.grid.image, this.grid.x, this.grid.y);
    else {
      c.fillStyle = '#fcfcfc';
      c.fillRect(25, 115, 47, 69);
      c.strokeStyle = '#a8a8a8';
      c.lineWidth = 1;
      for (let x = 28; x <= 70; x += 7) line(c, x + 0.5, 116, x + 0.5, 183);
      for (let y = 118; y <= 180; y += 6) line(c, 26, y + 0.5, 71, y + 0.5);
    }
    c.strokeStyle = '#000000';
    c.setLineDash([2, 2]);
    for (const mph of [50, 100]) line(c, 26, Math.round(py(mph)) + 0.5, 71, Math.round(py(mph)) + 0.5);
    c.setLineDash([]);
    c.strokeStyle = '#1c1cc8';
    c.beginPath();
    info.curveMph.forEach((v, i) => {
      const x = px(i * 0.5);
      const y = py(Math.min(150, v));
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.stroke();
    outlined(c, '150', 21, py(150), 'right', 7);
    outlined(c, '100', 21, py(100), 'right', 7);
    outlined(c, '50', 21, py(50), 'right', 7);
    outlined(c, '0', 21, py(0), 'right', 7);
    outlined(c, '0', px(0), 190, 'center', 7);
    outlined(c, '20', px(20), 190, 'center', 7);
    outlined(c, '40', px(40), 190, 'center', 7);

    // Description.
    c.font = '7px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = '#000000';
    info.description.slice(0, 10).forEach((t, i) => c.fillText(t.slice(0, 34), 88, 116 + i * 8));

    // Buttons; the selected one framed, blinking yellow and magenta like the original.
    const blink = Math.floor(now / 400) % 2 === 0 ? '#fcfc54' : '#fc54fc';
    BUTTON_RECTS.forEach(([x, y, w, h], i) => {
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
      if (i === this.selected) {
        c.strokeStyle = blink;
        c.lineWidth = 1;
        c.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      }
      const label = BUTTONS[i] === 'Auto' ? (this.manual ? 'Manual' : 'Auto') : BUTTONS[i]!;
      outlined(c, label, x + w / 2, y + h / 2, 'center', 9);
    });
  }
}

function line(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

/** A sunken panel: dark top/left edge, light bottom/right. */
function inset(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  c.fillStyle = '#545454';
  c.fillRect(x, y, w, 2);
  c.fillRect(x, y, 2, h);
  c.fillStyle = '#fcfcfc';
  c.fillRect(x, y + h - 1, w, 1);
  c.fillRect(x + w - 1, y, 1, h);
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
