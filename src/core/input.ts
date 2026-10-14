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
    if (k.has('ArrowUp') || k.has('KeyW')) m |= INPUT.Throttle;
    if (k.has('ArrowDown') || k.has('KeyS')) m |= INPUT.Brake;
    if (k.has('ArrowLeft') || k.has('KeyA')) m |= INPUT.Left;
    if (k.has('ArrowRight') || k.has('KeyD')) m |= INPUT.Right;
    if (k.has('KeyR')) m |= INPUT.Reset;
    return m;
  }
}
