import { describe, expect, it } from 'vitest';
import { SIM_DEFAULTS, simulate } from '../scripts/simulate';

describe('the drone simulation', () => {
  it('runs the same from the same seed, and leaves Math.random as it found it', () => {
    const random = Math.random;
    const options = { ...SIM_DEFAULTS, seconds: 6 };
    const a = simulate(options, 3),
      b = simulate(options, 3);
    expect(a).toEqual(b);
    expect(Math.random).toBe(random);
  });

  it('gets something down the hole', () => {
    // in the Hollow, whose heaps are a short push from the hole
    const r = simulate({ ...SIM_DEFAULTS, cave: 'hollow', seconds: 14 }, 1);
    expect(r.banked).toBeGreaterThan(0);
    expect(r.hole).toBeGreaterThan(0);
  });
});
