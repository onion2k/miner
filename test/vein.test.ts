import { describe, expect, it } from 'vitest';
import { VeinTrickle } from '../src/vein';
import { withSeed } from './helpers';

describe('the vein', () => {
  it('drops a coin or a gem about as often as it says, and gems about as often as it says', () => {
    withSeed(5, () => {
      const vein = new VeinTrickle({ x: 10, y: 20, every: 0.5, coins: 1, gems: [[1, 0.2]] });
      const drops: number[] = [];
      for (let f = 0; f < 60 * 600; f++)
        vein.update(1 / 60, (kind, x, y) => {
          expect(Math.hypot(x - 10, y - 20)).toBeCloseTo(0.6, 5);
          drops.push(kind);
        });
      expect(drops.length).toBeGreaterThan(1000);
      expect(drops.length).toBeLessThan(1400);
      const rubies = drops.filter((k) => k === 1).length / drops.length;
      expect(rubies).toBeGreaterThan(0.15);
      expect(rubies).toBeLessThan(0.25);
    });
  });
});
