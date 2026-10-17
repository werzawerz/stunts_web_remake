import { createCar, stepCar, type CarSpec, type CarState, type Heading } from '../physics/car';
import type { CollisionWorld } from '../physics/collision';
import type { Vec3 } from '../physics/vec';
import { INPUT } from '../physics/car';

/*
 * A ghost: a recorded lap (its inputs from the moment the clock started) driven again by the
 * deterministic simulation, in step with the player's lap clock. It doesn't touch anything.
 */

/** Ticks the car stands on the start line before the run (it settles onto the road). */
const SETTLE = 90;

/**
 * A car standing on the start line, settled onto the road: the start of every run, replay and
 * ghost. (Dropped in from above, the fall itself counted as moving and started the lap clock.)
 */
export function startOnLine(spec: CarSpec, pos: Vec3, heading: Heading, manual: boolean, world: CollisionWorld): CarState {
  const car = createCar(spec, pos, heading, 0, manual);
  for (let i = 0; i < SETTLE; i++) stepCar(car, spec, 0, world);
  car.ticks = 0;
  return car;
}

export class Ghost {
  car!: CarState;
  /** Inputs applied so far (= the player's lap ticks it has caught up with). */
  tick = 0;
  readonly manual: boolean;
  /** The lap's inputs from its first key press (older laps logged the wait on the line too). */
  readonly inputs: readonly number[];

  constructor(
    readonly spec: CarSpec,
    inputs: readonly number[],
    private readonly pos: Vec3,
    private readonly heading: Heading,
    private readonly world: CollisionWorld,
  ) {
    const first = inputs.findIndex((i) => i !== 0);
    this.inputs = first > 0 ? inputs.slice(first) : inputs;
    // The lap log doesn't say which gearbox was used: gear-key presses mean a manual one.
    this.manual = this.inputs.some((i) => (i & (INPUT.GearUp | INPUT.GearDown)) !== 0);
    this.reset();
  }

  reset(): void {
    this.car = startOnLine(this.spec, this.pos, this.heading, this.manual, this.world);
    this.tick = 0;
  }

  /** Catch up with the player's lap: `lapTicks` inputs applied. */
  follow(lapTicks: number): void {
    while (this.tick < lapTicks) {
      stepCar(this.car, this.spec, this.inputs[this.tick] ?? 0, this.world);
      this.tick++;
    }
  }
}
