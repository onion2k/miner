/**
 * The fuzzer's end of fitting: the monkey changes the blade for the scoop and back, charges walls with either, and
 * reloads, and none of the rules breaks. Played for a few thousand frames a seed, which is why it is not in the
 * quick run beside `test/refit.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { fuzz } from '../../scripts/fuzzer';

describe('the fuzzer works the fitting', () => {
  it('refits, charges with either fitted, and reloads with what is fitted as it was, on a few seeds', () => {
    const done: Record<string, number> = {};
    for (const seed of [1, 2, 3, 4]) {
      const result = fuzz(seed, 2400);
      if (result.failure)
        expect.fail(`seed ${seed}: ${result.failure.problems.join('; ')}\n${result.failure.log.join('\n')}`);
      for (const [name, n] of Object.entries(result.done)) done[name] = (done[name] ?? 0) + n;
    }
    expect(done.refit, 'refitted').toBeGreaterThan(0);
    expect(done.charge, 'charged').toBeGreaterThan(0);
    expect(done.reload, 'reloaded').toBeGreaterThan(0);
  });
});
