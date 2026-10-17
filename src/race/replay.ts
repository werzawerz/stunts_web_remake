/*
 * Replays: the simulation is deterministic, so a run is just its start and the input bitmask of
 * every tick. Any moment is found by simulating forward from the nearest snapshot (one per second),
 * so rewinding, fast forward and "continue driving from here" are cheap.
 */

export interface Frame<S> {
  tick: number;
  state: S;
}

/** Up to 10 minutes, like the original's replay buffer. */
export const MAX_REPLAY_TICKS = 60 * 60 * 10;
const SNAPSHOT_EVERY = 60;

export class Replay<S> {
  private readonly snapshots = new Map<number, S>();

  /**
   * @param inputs one input bitmask per tick
   * @param start  the state at tick 0 (a fresh copy each call)
   * @param step   advance a state by one tick with an input (mutates it)
   */
  constructor(
    readonly inputs: readonly number[],
    start: () => S,
    private readonly step: (s: S, input: number) => void,
  ) {
    this.snapshots.set(0, start());
  }

  get length(): number {
    return this.inputs.length;
  }

  /** The state after `tick` ticks (0 = the start), as a fresh copy. */
  frameAt(tick: number): Frame<S> {
    const t = Math.max(0, Math.min(this.length, Math.floor(tick)));
    let from = Math.floor(t / SNAPSHOT_EVERY) * SNAPSHOT_EVERY;
    while (!this.snapshots.has(from)) from -= SNAPSHOT_EVERY;
    const state = structuredClone(this.snapshots.get(from)!);
    for (let k = from; k < t; k++) {
      this.step(state, this.inputs[k]!);
      if ((k + 1) % SNAPSHOT_EVERY === 0 && !this.snapshots.has(k + 1)) this.snapshots.set(k + 1, structuredClone(state));
    }
    return { tick: t, state };
  }

  /** Advance a frame by one tick (playing forward without seeking). */
  advance(f: Frame<S>): void {
    if (f.tick >= this.length) return;
    this.step(f.state, this.inputs[f.tick]!);
    f.tick++;
    if (f.tick % SNAPSHOT_EVERY === 0 && !this.snapshots.has(f.tick)) this.snapshots.set(f.tick, structuredClone(f.state));
  }
}
