import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/calibrate';

describe('calibration', () => {
  it('steps down the ladder until a frame fits the budget, and stops there', async () => {
    const cost = [20, 12, 7, 3];
    let level = -1;
    const tried = await calibrate(
      4,
      8,
      (l) => (level = l),
      () => Promise.resolve(cost[level]),
    );
    expect(tried).toEqual([20, 12, 7]);
    expect(level).toBe(2);
  });

  it('ends on the last rung when nothing fits', async () => {
    let level = -1;
    const tried = await calibrate(
      3,
      1,
      (l) => (level = l),
      () => Promise.resolve(9),
    );
    expect(tried).toEqual([9, 9, 9]);
    expect(level).toBe(2);
  });
});
