import type { Sprite } from '../original/cockpit';

/*
 * The original's replay screen: the race seen through one of four cameras (Inside the car,
 * Overhead, Track cams, Manual), "Replay" blinking top right, and the replay panel at the bottom:
 * the camera's picture, "menu", |<, stop, play, fast play, rewind, fast forward, the position bar
 * and the time counters. The panel pictures are the original's (SDGAME.PVS, from the player's
 * files) when available; positions are theirs. C cycles cameras, R hides the panel, D the dashboard.
 */

export type ReplayMode = 'stop' | 'play' | 'fast' | 'rewind' | 'forward';
export type ReplayCamera = 'inside' | 'overhead' | 'track' | 'manual';
export const CAMERAS: ReplayCamera[] = ['inside', 'overhead', 'track', 'manual'];

export type ReplayMenuItem = 'return' | 'evaluation' | 'restart' | 'continue' | 'main';
export type ReplayAction = { type: 'start' } | { type: 'item'; item: ReplayMenuItem } | { type: 'none' };

interface Button {
  /** Mode it sets, or 'menu' / 'start'. */
  id: ReplayMode | 'menu' | 'start';
  off: string;
  on?: string;
  rect: [number, number, number, number];
}
const BUTTONS: Button[] = [
  { id: 'menu', off: 'bof0', rect: [104, 156, 48, 18] },
  { id: 'start', off: 'bof1', on: 'bon1', rect: [144, 156, 48, 18] },
  { id: 'stop', off: 'bof2', on: 'bon2', rect: [184, 156, 56, 18] },
  { id: 'play', off: 'bof3', on: 'bon3', rect: [232, 156, 48, 18] },
  { id: 'fast', off: 'bof4', on: 'bon4', rect: [272, 156, 48, 18] },
  { id: 'rewind', off: 'bof5', on: 'bon5', rect: [104, 176, 48, 18] },
  { id: 'forward', off: 'bof6', on: 'bon6', rect: [272, 176, 48, 18] },
];
const CAMERA_PICTURE: Record<ReplayCamera, string> = { inside: 'rpic', overhead: 'rpac', track: 'rptc', manual: 'rpmc' };
const FALLBACK_LABEL: Record<string, string> = { menu: 'menu', start: '|<', stop: 'stop', play: '>', fast: '>>', rewind: '<<', forward: '>>|' };

const MENU: { item: ReplayMenuItem | null; label: string }[] = [
  { item: 'return', label: 'Return to REPLAY' },
  { item: 'evaluation', label: 'Return to Evaluation' },
  { item: 'restart', label: 'Re-Start Driving' },
  { item: 'continue', label: 'Continue Driving' },
  { item: null, label: 'Load REPLAY' },
  { item: null, label: 'Save REPLAY' },
  { item: 'main', label: 'Main Menu' },
];

/** Race clock in the counters' style: m:ss,hh */
const counter = (ticks: number): string => {
  const sec = ticks / 60;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2).replace('.', ',')}`;
};

export class ReplayView {
  visible = false;
  mode: ReplayMode = 'stop';
  camera: ReplayCamera = 'overhead';
  panelHidden = false;
  dashHidden = false;
  /** Manual camera: yaw (rad) and distance (m) around the car. */
  manualYaw = Math.PI;
  manualDist = 18;
  pictures: Map<string, Sprite> | null = null;
  private selected = 3;
  private menu: { selected: number; enabled: Set<ReplayMenuItem> } | null = null;

  open(mode: ReplayMode): void {
    this.visible = true;
    this.mode = mode;
    this.menu = null;
    this.selected = mode === 'play' ? 3 : 2;
  }

  close(): void {
    this.visible = false;
    this.menu = null;
  }

  get menuOpen(): boolean {
    return this.menu !== null;
  }

  openMenu(enabled: ReplayMenuItem[]): void {
    this.mode = 'stop';
    this.menu = { selected: 0, enabled: new Set(['return', ...enabled]) };
  }

  key(code: string, enabled: () => ReplayMenuItem[]): ReplayAction {
    const enter = code === 'Enter' || code === 'NumpadEnter';
    const m = this.menu;
    if (m) {
      const move = (d: number): void => {
        for (let k = 1; k <= MENU.length; k++) {
          const i = (m.selected + d * k + MENU.length * 2) % MENU.length;
          const it = MENU[i]!.item;
          if (it && m.enabled.has(it)) {
            m.selected = i;
            return;
          }
        }
      };
      if (code === 'ArrowUp') move(-1);
      else if (code === 'ArrowDown') move(1);
      else if (code === 'Escape') this.menu = null;
      else if (enter) {
        const item = MENU[m.selected]!.item!;
        this.menu = null;
        if (item !== 'return') return { type: 'item', item };
      }
      return { type: 'none' };
    }
    if (code === 'ArrowLeft' || code === 'ArrowUp') this.selected = (this.selected + BUTTONS.length - 1) % BUTTONS.length;
    else if (code === 'ArrowRight' || code === 'ArrowDown') this.selected = (this.selected + 1) % BUTTONS.length;
    else if (enter) return this.press(this.selected, enabled);
    else if (code === 'Space') this.mode = this.mode === 'play' ? 'stop' : 'play';
    else if (code === 'Escape') this.openMenu(enabled());
    else if (code === 'KeyC') this.camera = CAMERAS[(CAMERAS.indexOf(this.camera) + 1) % CAMERAS.length]!;
    else if (code === 'KeyR') this.panelHidden = !this.panelHidden;
    else if (code === 'KeyD') this.dashHidden = !this.dashHidden;
    else if (this.camera === 'manual') {
      // Manual camera: Q/E swing round the car, W/S zoom (the panel's arrows and +/-).
      if (code === 'KeyQ') this.manualYaw -= 0.2;
      else if (code === 'KeyE') this.manualYaw += 0.2;
      else if (code === 'KeyW' || code === 'Equal' || code === 'NumpadAdd') this.manualDist = Math.max(5, this.manualDist * 0.85);
      else if (code === 'KeyS' || code === 'Minus' || code === 'NumpadSubtract') this.manualDist = Math.min(120, this.manualDist / 0.85);
    }
    return { type: 'none' };
  }

  click(x: number, y: number, enabled: () => ReplayMenuItem[]): ReplayAction {
    if (this.menu) {
      const row = Math.floor((y - 65) / 10);
      if (row >= 0 && row < MENU.length && x >= 72 && x < 248) {
        const it = MENU[row]!.item;
        if (it && this.menu.enabled.has(it)) {
          this.menu.selected = row;
          return this.key('Enter', enabled);
        }
      }
      return { type: 'none' };
    }
    if (this.panelHidden) return { type: 'none' };
    // The camera box: click the picture to change camera.
    if (x < 104 && y >= 151) {
      this.camera = CAMERAS[(CAMERAS.indexOf(this.camera) + 1) % CAMERAS.length]!;
      return { type: 'none' };
    }
    const i = BUTTONS.findIndex(({ rect: [bx, by, bw, bh] }) => x >= bx && x < bx + bw && y >= by && y < by + bh);
    if (i < 0) return { type: 'none' };
    this.selected = i;
    return this.press(i, enabled);
  }

  private press(i: number, enabled: () => ReplayMenuItem[]): ReplayAction {
    const id = BUTTONS[i]!.id;
    if (id === 'menu') {
      this.openMenu(enabled());
      return { type: 'none' };
    }
    if (id === 'start') {
      this.mode = 'stop';
      return { type: 'start' };
    }
    this.mode = this.mode === id && id !== 'stop' ? 'stop' : id;
    return { type: 'none' };
  }

  /** Draw the replay overlay (after the dashboard). */
  draw(c: CanvasRenderingContext2D, tick: number, total: number, now: number): void {
    if (Math.floor(now / 500) % 2 === 0) outlined(c, 'Replay', 308, 18, 'right', 9);
    if (!this.panelHidden) this.drawPanel(c, tick, total);
    if (this.menu) this.drawMenu(c);
  }

  private drawPanel(c: CanvasRenderingContext2D, tick: number, total: number): void {
    const pic = (n: string): Sprite | undefined => this.pictures?.get(n);
    const panel = pic('rply');
    const cam = pic(CAMERA_PICTURE[this.camera]);
    if (panel && cam) {
      c.drawImage(cam.image, cam.x, cam.y);
      c.drawImage(panel.image, panel.x, panel.y);
    } else {
      c.fillStyle = '#7c7c7c';
      c.fillRect(0, 151, 320, 49);
      c.fillStyle = '#5454fc';
      c.fillRect(8, 157, 88, 37);
      outlined(c, this.camera.toUpperCase(), 52, 175, 'center', 8);
      c.fillStyle = '#000000';
      c.fillRect(152, 175, 120, 9);
      c.fillRect(152, 186, 55, 9);
      c.fillRect(216, 186, 56, 9);
    }
    BUTTONS.forEach((b, i) => {
      const [x, y, w, h] = b.rect;
      const active = b.id === this.mode;
      const sp = active && b.on ? pic(b.on) : undefined;
      if (sp) c.drawImage(sp.image, sp.x, sp.y);
      else if (!panel) {
        c.fillStyle = active ? '#54a854' : '#a8a8a8';
        c.fillRect(x + 3, y + 1, w - 6, h - 2);
        outlined(c, FALLBACK_LABEL[b.id]!, x + w / 2, y + h / 2, 'center', 8);
      }
      if (i === this.selected && !this.menu) {
        c.strokeStyle = '#fc0000';
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    });
    // Position bar and counters.
    c.fillStyle = '#0000a8';
    c.fillRect(153, 176, 118, 7);
    const p = total > 0 ? tick / total : 0;
    c.fillStyle = '#fcfcfc';
    c.fillRect(Math.round(153 + p * 114), 176, 4, 7);
    c.fillStyle = '#a80000';
    c.fillRect(Math.round(154 + p * 114), 177, 2, 5);
    c.font = 'bold 8px monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#54fcfc';
    c.fillText(counter(tick), 180, 191);
    c.fillText(counter(total), 244, 191);
  }

  private drawMenu(c: CanvasRenderingContext2D): void {
    const m = this.menu!;
    const x = 64;
    const y = 44;
    const w = 184;
    const h = 22 + MENU.length * 10 + 6;
    c.fillStyle = '#000000';
    c.fillRect(x, y, w, h);
    c.strokeStyle = '#a80000';
    c.lineWidth = 1;
    c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    c.font = 'bold 8px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = '#fcfcfc';
    c.fillText('Replay Menu', x + 8, y + 10);
    MENU.forEach((e, i) => {
      const ty = y + 26 + i * 10;
      const on = e.item !== null && m.enabled.has(e.item);
      if (i === m.selected) {
        c.fillStyle = '#fcfcfc';
        c.fillRect(x + 7, ty - 5, c.measureText(e.label).width + 3, 10);
        c.fillStyle = '#000000';
      } else c.fillStyle = on ? '#fcfcfc' : '#2828a8';
      c.fillText(e.label, x + 8, ty);
    });
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
