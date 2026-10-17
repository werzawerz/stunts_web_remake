import type { Cockpit, Sprite } from '../original/cockpit';
import { drawCracks, drawFireball, drawPleaseWait } from './crash';
import { drawEvaluation, type EvaluationData } from './evaluation';

/*
 * 320x200 overlay drawn with Canvas 2D: the race clock and messages, and the in-car view. When the
 * original Stunts files are available each car gets its own original cockpit (see
 * src/original/cockpit.ts); otherwise a generic dashboard of our own, laid out like the original.
 */

export const SCREEN_W = 320;
export const SCREEN_H = 200;

export interface HudState {
  view: 'cockpit' | 'chase' | 'free';
  speedKmh: number;
  rpm: number;
  maxRpm: number;
  gear: number;
  steer: number;
  timeSec: number;
  /** Shortcut penalty so far (the original shows it mid-lap in the in-car view). */
  penaltySec: number;
  wrongWay: boolean;
  finished: boolean;
  crashed: boolean;
  crashReason: string;
  help: string;
  /** Crash effects: windscreen cracks (in-car view), fireball (outside), "Please Wait...". */
  crashFx?: {
    cracks: [number, number][][] | null;
    fire: { x: number; y: number; r: number } | null;
    frame: number;
    pleaseWait: boolean;
  };
  /** The evaluation screen, covering everything, when set. */
  evaluation?: EvaluationData | null;
}

const formatTime = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

export class Dashboard {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  /** Backing-store pixels per 320x200 "screen" pixel: 1 = authentic chunky, higher = smooth. */
  private scale = 1;
  /** Original cockpit of the current car, if the Stunts files are available. */
  original: Cockpit | null = null;
  /** The original's explosion frames (SDGAME2.PVS ex01..ex03), if available. */
  explosion: Sprite[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_W;
    this.canvas.height = SCREEN_H;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Layout stays in 320x200 coordinates; only the canvas resolution changes. */
  setScale(scale: number): void {
    this.scale = Math.max(1, Math.round(scale));
    this.canvas.width = SCREEN_W * this.scale;
    this.canvas.height = SCREEN_H * this.scale;
  }

  /** Draw a full screen of our own (menus) in 320x200 coordinates. */
  drawScreen(paint: (c: CanvasRenderingContext2D) => void): void {
    const c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.clearRect(0, 0, SCREEN_W, SCREEN_H);
    c.imageSmoothingEnabled = false;
    paint(c);
  }

  draw(s: HudState): void {
    const c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.clearRect(0, 0, SCREEN_W, SCREEN_H);
    c.imageSmoothingEnabled = false;
    if (s.evaluation) {
      drawEvaluation(c, s.evaluation);
      return;
    }
    const fx = s.crashFx;
    // The cracked windscreen is behind the dashboard, like the original's.
    if (fx?.cracks && s.view === 'cockpit') drawCracks(c, fx.cracks);
    if (fx?.fire && s.view !== 'cockpit') {
      const sp = this.explosion[Math.floor(fx.frame / 2) % Math.max(1, this.explosion.length)];
      if (sp) {
        // 32x19 at chase distance, like the original; scaled with distance.
        const k = fx.fire.r / 14;
        const w = sp.image.width * k;
        const h = sp.image.height * k;
        c.drawImage(sp.image, Math.round(fx.fire.x - w / 2), Math.round(fx.fire.y - h / 2), Math.round(w), Math.round(h));
      } else drawFireball(c, fx.fire.x, fx.fire.y, fx.fire.r, fx.frame);
    }
    const original = s.view === 'cockpit' && this.original !== null;
    if (original) this.originalCockpit(s, this.original!);
    else if (s.view === 'cockpit') this.cockpit(s);
    else if (s.view === 'chase') this.mini(s);

    const clockY = original ? 22 : 12;
    if (s.view !== 'free') this.text(formatTime(s.timeSec), SCREEN_W / 2, clockY, 11, '#fcfcfc', 'center');
    if (s.view === 'cockpit' && s.penaltySec > 0)
      this.text(`+${s.penaltySec}s`, SCREEN_W / 2 + 46, clockY, 9, '#fc5454', 'left');
    if (s.wrongWay && !s.crashed) this.text('Wrong Way', SCREEN_W / 2, 62, 12, '#fcfcfc', 'center');
    if (fx?.pleaseWait) drawPleaseWait(c, SCREEN_W, SCREEN_H);
    if (s.help) this.text(s.help, SCREEN_W / 2, s.view === 'cockpit' ? 26 : SCREEN_H - 16, 7, '#fcfcfc', 'center');
  }

  private text(t: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign): void {
    const c = this.ctx;
    c.font = `bold ${size}px monospace`;
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#000000';
    c.fillText(t, x + 1, y + 1);
    c.fillStyle = color;
    c.fillText(t, x, y);
  }

  private sprite(sp: Sprite | undefined, x = sp?.x ?? 0, y = sp?.y ?? 0): void {
    if (sp) this.ctx.drawImage(sp.image, x, y);
  }

  /** The car's own original dashboard with live needles, steering dot and gear knob. */
  private originalCockpit(s: HudState, k: Cockpit): void {
    const c = this.ctx;
    this.sprite(k.roof);
    this.sprite(k.dash);
    this.sprite(k.instruments);
    const ins = k.instruments ?? { x: 0, y: 0 };
    const drawNeedle = (n: Cockpit['speedo'], step: number): void => {
      if (!n) return;
      const tip = n.tips[Math.max(0, Math.min(n.tips.length - 1, Math.floor(step)))]!;
      c.strokeStyle = '#fc3c1c';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(ins.x + n.cx + 0.5, ins.y + n.cy + 0.5);
      c.lineTo(ins.x + tip[0] + 0.5, ins.y + tip[1] + 0.5);
      c.stroke();
    };
    drawNeedle(k.speedo, s.speedKmh / 1.609344 / 2.5);
    drawNeedle(k.revs, s.rpm / 128);
    this.sprite(k.wheel);
    // The ZR1's display sits in the wheel hub: its digits go over the wheel.
    if (k.digits) {
      // Digital speedometer: mph, right-aligned, no leading zeros.
      const mph = String(Math.min(999, Math.round(s.speedKmh / 1.609344)));
      const n = k.digits.at.length;
      const text = mph.padStart(n, ' ').slice(-n);
      k.digits.at.forEach(([dx, dy], i) => {
        const ch = text[i]!;
        if (ch === ' ') return;
        c.drawImage(k.digits!.glyphs[Number(ch)]!.image, ins.x + dx, ins.y + dy);
      });
    }
    // Steering dot on the wheel rim: right turns use the table, left turns mirror it.
    if (k.dot && k.dotPath.length > 1) {
      const step = Math.round(Math.abs(s.steer) * (k.dotPath.length - 1));
      const [cx] = k.dotPath[0]!;
      const [px, py] = k.dotPath[step]!;
      const x = s.steer < 0 ? 2 * cx - px : px;
      c.drawImage(k.dot.image, Math.round(x - k.dot.image.width / 2), Math.round(py - k.dot.image.height / 2));
    }
    if (k.gearbox) {
      this.sprite(k.gearbox);
      const knob = s.gear >= 1 ? k.knobs[s.gear - 1] : undefined;
      if (k.knob && knob && (knob[0] !== 0 || knob[1] !== 0)) {
        c.drawImage(
          k.knob.image,
          Math.round(k.gearbox.x + knob[0] - k.knob.image.width / 2),
          Math.round(k.gearbox.y + knob[1] - k.knob.image.height / 2),
        );
      }
    }
  }

  private mini(s: HudState): void {
    const gear = s.gear < 0 ? 'R' : String(s.gear);
    this.text(`${Math.round(s.speedKmh)} km/h  ${gear}`, SCREEN_W - 4, SCREEN_H - 5, 10, '#fcfcfc', 'right');
  }

  private cockpit(s: HudState): void {
    const c = this.ctx;
    // Dashboard panel with a raised cowl over the instruments.
    c.fillStyle = '#141414';
    c.beginPath();
    c.moveTo(0, 150);
    c.lineTo(70, 146);
    c.quadraticCurveTo(160, 118, 250, 146);
    c.lineTo(320, 150);
    c.lineTo(320, 200);
    c.lineTo(0, 200);
    c.closePath();
    c.fill();
    c.strokeStyle = '#2050c8';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 150);
    c.lineTo(70, 146);
    c.quadraticCurveTo(160, 118, 250, 146);
    c.lineTo(320, 150);
    c.stroke();

    // Switch panels left and right.
    for (const [x0, cols] of [
      [8, 4],
      [262, 4],
    ] as const) {
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < 3; j++) {
          c.fillStyle = (i + j) % 3 === 0 ? '#a01c1c' : '#5c5c5c';
          c.fillRect(x0 + i * 12, 162 + j * 11, 9, 6);
        }
      }
    }

    // Instruments.
    this.gauge(122, 168, 24, s.rpm / (s.maxRpm * 1.1), 8, 'RPM');
    this.gauge(198, 168, 24, s.speedKmh / 400, 8, 'KM/H');

    // Gear indicator between the dials.
    c.fillStyle = '#000000';
    c.fillRect(152, 176, 16, 13);
    c.strokeStyle = '#7c7c7c';
    c.lineWidth = 1;
    c.strokeRect(152.5, 176.5, 15, 12);
    this.text(s.gear < 0 ? 'R' : String(s.gear), 160, 187, 10, '#fcfc54', 'center');
    this.text(String(Math.round(s.speedKmh)).padStart(3, ' '), 160, 172, 8, '#54fc54', 'center');

    // Steering wheel rim around the instruments, turned with the steering input.
    const cx = 160;
    const cy = 214;
    const r = 86;
    const rot = s.steer * 1.6;
    c.save();
    c.translate(cx, cy);
    c.rotate(rot);
    c.strokeStyle = '#2c2c2c';
    c.lineWidth = 10;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = '#4c4c4c';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, r + 4, Math.PI * 1.1, Math.PI * 1.9);
    c.stroke();
    // Spokes and a top marker so rotation is visible.
    c.strokeStyle = '#2c2c2c';
    c.lineWidth = 9;
    for (const a of [Math.PI * 0.15, Math.PI * 0.85]) {
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      c.stroke();
    }
    c.fillStyle = '#fcfc54';
    c.fillRect(-3, -r - 5, 6, 10);
    c.restore();
  }

  private gauge(x: number, y: number, r: number, frac: number, ticks: number, label: string): void {
    const c = this.ctx;
    c.fillStyle = '#000000';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#8c8c8c';
    c.lineWidth = 2;
    c.stroke();
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    c.strokeStyle = '#fcfcfc';
    c.lineWidth = 1;
    for (let i = 0; i <= ticks; i++) {
      const a = a0 + (sweep * i) / ticks;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * (r - 6), y + Math.sin(a) * (r - 6));
      c.lineTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2));
      c.stroke();
    }
    c.font = '5px monospace';
    c.fillStyle = '#a8a8a8';
    c.textAlign = 'center';
    c.fillText(label, x, y + 12);
    const a = a0 + sweep * Math.min(Math.max(frac, 0), 1.02);
    c.strokeStyle = '#fc3c1c';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
    c.stroke();
    c.fillStyle = '#5c5c5c';
    c.fillRect(x - 2, y - 2, 4, 4);
  }
}
