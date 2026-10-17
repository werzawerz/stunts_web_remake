import { describe, expect, it } from 'vitest';
import { engineHz } from './sound';

describe('engine sound', () => {
  it('pitch follows the revs like the original (measured on a 900-7700 rpm car)', () => {
    expect(engineHz(900)).toBeCloseTo(5.1, 1); // ~4.7 Hz measured at idle
    expect(engineHz(7700)).toBeCloseTo(43.8, 1); // ~44 Hz measured just before the upshift
  });
});
