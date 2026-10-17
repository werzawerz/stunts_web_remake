import { INPUT } from '../physics/car';

/** Keyboard → per-tick input bitmask (the only thing the simulation sees, so replays are trivial). */
export class KeyboardInput {
  private readonly down = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  mask(): number {
    const k = this.down;
    let m = 0;
    // The original's keys: arrows drive, A shifts up and Z down with the manual gearbox.
    if (k.has('ArrowUp')) m |= INPUT.Throttle;
    if (k.has('ArrowDown')) m |= INPUT.Brake;
    if (k.has('ArrowLeft')) m |= INPUT.Left;
    if (k.has('ArrowRight')) m |= INPUT.Right;
    if (k.has('KeyA')) m |= INPUT.GearUp;
    if (k.has('KeyZ')) m |= INPUT.GearDown;
    if (k.has('KeyR')) m |= INPUT.Reset;
    return m;
  }
}
