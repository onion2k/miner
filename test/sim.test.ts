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

  it('reports the smaller hole’s share of what was banked: nothing in a cave with one hole, at most half in one with two', () => {
    const one = simulate({ ...SIM_DEFAULTS, cave: 'hollow', seconds: 14 }, 1);
    expect(one.banked).toBeGreaterThan(0);
    expect(one.holeShare).toBe(0);
    // Twenty seconds is the least that banks anything on this seed (ten and fourteen bank nothing, and a share of
    // nothing proves nothing); thirty took long enough to pass five seconds with the rest of the suite running.
    const two = simulate({ ...SIM_DEFAULTS, cave: 'north-vault', drones: 2, seconds: 20 }, 1);
    expect(two.banked).toBeGreaterThan(0);
    expect(two.holeShare).toBeGreaterThanOrEqual(0);
    expect(two.holeShare).toBeLessThanOrEqual(0.5);
  });
});
