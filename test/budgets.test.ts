/**
 * The rule the budget gates hold a figure to. A gate that cannot tell a real slowing from wobble, or that
 * cannot fail at all, passes in silence; these are the working parts of the gates in `scripts/budgets.ts`
 * and `smoke/budgets.spec.ts`, tried on made-up figures.
 */
import { describe, expect, it } from 'vitest';
import { judge, median, overTheWorst } from '../scripts/judge';

describe('judge', () => {
  // a baseline of 2 times the reference: on a machine whose reference takes 10 ms, 20 ms
  const was = 2;
  const now = (ms: number, ref = 10) => ({ ms, ref });

  it('passes a figure at its baseline, and one within the tolerance', () => {
    expect(judge(now(20), was, 0.3, 1)).toBe('within tolerance');
    expect(judge(now(25), was, 0.3, 1)).toBe('within tolerance');
  });

  it('fails a figure over the tolerance and over the slack', () => {
    expect(judge(now(30), was, 0.3, 1)).toBe('SLOWER');
  });

  it('does not fail a figure over the tolerance that is under the slack: a hundredth of a millisecond of noise', () => {
    // 0.04 ms against a baseline of 0.02 ms is double, and nothing
    expect(judge(now(0.04, 1), 0.02, 0.3, 0.05)).toBe('within tolerance');
    expect(judge(now(0.2, 1), 0.02, 0.3, 0.05)).toBe('SLOWER');
  });

  it('does not fail a figure over the slack that is under the tolerance: a big figure’s ordinary wobble', () => {
    expect(judge(now(200, 100), 2, 0.3, 1)).toBe('within tolerance');
    expect(judge(now(27, 10), 2, 0.3, 1)).toBe('SLOWER');
  });

  it('measures against the reference timed beside it, so a slow machine does not fail and a slowed figure on a fast one does', () => {
    // the whole machine twice as slow: the figure and the reference both double
    expect(judge(now(40, 20), was, 0.3, 1)).toBe('within tolerance');
    // the figure alone doubled
    expect(judge(now(40, 10), was, 0.3, 1)).toBe('SLOWER');
  });

  it('says so when a figure is much faster, which is not a failure', () => {
    expect(judge(now(5), was, 0.3, 1)).toBe('faster');
  });
});

describe('median', () => {
  it('is the middle, the lower of two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([7])).toBe(7);
  });
});

describe('overTheWorst', () => {
  const old = ['a', 'b', 'c'];

  it('names a new cave that costs more than the worst of the old, past the allowance', () => {
    const r = overTheWorst({ a: 4.0, b: 5.0, c: 4.5, deep: 6.0 }, old, 0.1, 0.2);
    expect(r.worst).toBe(5);
    expect(r.over).toEqual(['deep']);
  });

  it('passes a new cave within the allowance of the worst, and one under it', () => {
    expect(overTheWorst({ a: 4, b: 5, c: 4.5, deep: 5.4 }, old, 0.1, 0.2).over).toEqual([]);
    expect(overTheWorst({ a: 4, b: 5, c: 4.5, deep: 3 }, old, 0.1, 0.2).over).toEqual([]);
  });

  it('allows at least the slack when the allowance in proportion would be smaller', () => {
    expect(overTheWorst({ a: 1, b: 1, c: 1, deep: 1.25 }, old, 0.1, 0.3).over).toEqual([]);
    expect(overTheWorst({ a: 1, b: 1, c: 1, deep: 1.35 }, old, 0.1, 0.3).over).toEqual(['deep']);
  });

  it('never names a cave in the reference: it is the worst or under it', () => {
    expect(overTheWorst({ a: 4, b: 9, c: 4.5 }, old, 0.1, 0.2).over).toEqual([]);
  });
});
