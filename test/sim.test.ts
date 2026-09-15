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
    const r = simulate({ ...SIM_DEFAULTS, seconds: 25 }, 1);
    expect(r.banked).toBeGreaterThan(0);
    expect(r.hole).toBeGreaterThan(0);
  });
});
