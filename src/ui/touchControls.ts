import { INPUT } from '../physics/car';

/*
 * On-screen controls for phones and tablets, shown only while driving: steering on the left,
 * accelerate and brake on the right (several fingers at once; sliding a finger from one button to
 * the next works), and small buttons for gears, camera, restart and the replay/menu panel. They
 * feed the same per-tick input bitmask as the keyboard, so replays don't care which was used.
 */

/** A touch screen (no mouse to point with). */
export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

type Held = 'left' | 'right' | 'gas' | 'brake' | 'up' | 'down' | 'reset';
const BITS: Record<Held, number> = {
  left: INPUT.Left,
  right: INPUT.Right,
  gas: INPUT.Throttle,
  brake: INPUT.Brake,
  up: INPUT.GearUp,
  down: INPUT.GearDown,
  reset: INPUT.Reset,
};

export class TouchControls {
  private readonly root = document.createElement('div');
  private readonly buttons = new Map<HTMLElement, Held | 'cam' | 'menu'>();
  /** What each finger is on. */
  private readonly fingers = new Map<number, Held | null>();
  private readonly gears: HTMLElement[] = [];
  private shown = false;

  constructor(private readonly key: (code: string) => void) {
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:10;display:none;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';
    const pad = 'env(safe-area-inset-left, 0px)';
    const padR = 'env(safe-area-inset-right, 0px)';
    const big = 'width:min(19vw,150px);height:min(32vh,160px);font-size:min(7vw,34px)';
    this.add('left', '◀', `left:calc(${pad} + 2vw);bottom:4vh;${big}`);
    this.add('right', '▶', `left:calc(${pad} + 4vw + min(19vw,150px));bottom:4vh;${big}`);
    this.add('gas', 'GAS', `right:calc(${padR} + 2vw);bottom:4vh;${big}`);
    this.add('brake', 'BRAKE', `right:calc(${padR} + 4vw + min(19vw,150px));bottom:4vh;${big};font-size:min(4vw,22px)`);
    const small = 'width:min(11vw,64px);height:min(11vw,52px);font-size:min(3.4vw,17px)';
    this.add('menu', 'MENU', `left:calc(${pad} + 2vw);top:3vh;${small}`);
    this.add('cam', 'CAM', `right:calc(${padR} + 2vw);top:3vh;${small}`);
    this.add('reset', '↺', `right:calc(${padR} + 4vw + min(11vw,64px));top:3vh;${small}`);
    this.gears.push(this.add('up', 'A ▲', `right:calc(${padR} + 2vw);top:calc(6vh + min(11vw,52px));${small}`));
    this.gears.push(this.add('down', 'Z ▼', `right:calc(${padR} + 2vw);top:calc(9vh + 2 * min(11vw,52px));${small}`));
    document.body.appendChild(this.root);

    // One handler for every finger: what's under it now is what it presses.
    const update = (e: PointerEvent, lifted: boolean): void => {
      e.preventDefault();
      if (lifted) {
        this.fingers.delete(e.pointerId);
        return;
      }
      let what: Held | 'cam' | 'menu' | undefined;
      for (const [el, w] of this.buttons) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) what = w;
      }
      if (what === 'cam' || what === 'menu') {
        if (e.type === 'pointerdown') this.key(what === 'cam' ? 'KeyC' : 'Escape');
        this.fingers.set(e.pointerId, null);
      } else this.fingers.set(e.pointerId, what ?? null);
      this.paint();
    };
    this.root.addEventListener('pointerdown', (e) => {
      this.root.setPointerCapture(e.pointerId);
      update(e, false);
    });
    this.root.addEventListener('pointermove', (e) => {
      if (this.fingers.has(e.pointerId)) update(e, false);
    });
    for (const t of ['pointerup', 'pointercancel'] as const) {
      this.root.addEventListener(t, (e) => {
        update(e, true);
        this.paint();
      });
    }
  }

  private add(what: Held | 'cam' | 'menu', label: string, css: string): HTMLElement {
    const b = document.createElement('div');
    b.textContent = label;
    b.style.cssText =
      `position:absolute;${css};display:flex;align-items:center;justify-content:center;` +
      'border-radius:14px;border:2px solid rgba(255,255,255,0.45);background:rgba(40,40,40,0.35);' +
      'color:rgba(255,255,255,0.85);font-family:monospace;font-weight:bold;pointer-events:none';
    this.buttons.set(b, what);
    this.root.appendChild(b);
    return b;
  }

  /** Light up the buttons being pressed. */
  private paint(): void {
    const held = new Set(this.fingers.values());
    for (const [el, what] of this.buttons) el.style.background = held.has(what as Held) ? 'rgba(255,255,255,0.35)' : 'rgba(40,40,40,0.35)';
  }

  /** Shown while driving on a touch screen; the gear buttons only with the manual gearbox. */
  set(visible: boolean, manual: boolean): void {
    if (visible !== this.shown) {
      this.shown = visible;
      this.root.style.display = visible ? 'block' : 'none';
      if (!visible) {
        this.fingers.clear();
        this.paint();
      }
    }
    for (const g of this.gears) g.style.display = manual ? 'flex' : 'none';
  }

  mask(): number {
    let m = 0;
    for (const what of this.fingers.values()) if (what) m |= BITS[what];
    return m;
  }
}
