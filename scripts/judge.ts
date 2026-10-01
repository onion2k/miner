/**
 * How a measured figure is held to what it was: the rule every budget gate shares, so that what a gate says
 * is the same rule whether it was timed in Node or in the page, and is tested once.
 *
 * A time on one machine is not a time on another, or on the same one with something else running, so a
 * figure is held as a multiple of a fixed piece of arithmetic timed beside it (`reference.ts`). It fails
 * only when it is over its baseline by more than the tolerance in proportion and by more than the slack in
 * milliseconds: the first alone fails a figure that costs next to nothing for a hundredth of a millisecond
 * of noise, and the second alone fails a big one for a wobble it always had.
 */

/** What a gate measured: the time, and that as a multiple of the reference timed beside it. */
export interface Timed {
  ms: number;
  ref: number;
}

export type Verdict = 'SLOWER' | 'faster' | 'within tolerance';

/**
 * `now` against a baseline `relative` figure. `expected` is what the baseline comes to on this machine as
 * it is now, for the absolute allowance.
 */
export function judge(now: Timed, baselineRelative: number, tolerance: number, slackMs: number): Verdict {
  const relative = now.ms / now.ref;
  const change = relative / baselineRelative - 1;
  const expected = baselineRelative * now.ref;
  if (change > tolerance && now.ms - expected > slackMs) return 'SLOWER';
  if (change < -tolerance && expected - now.ms > slackMs) return 'faster';
  return 'within tolerance';
}

/** The middle of a list of numbers: the lower middle for an even count. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

/**
 * A frame cost, held to the worst of the caves as they stood before the bigger ones were made, in the same
 * view and the same run. `costs` is each cave's median frame cost in one view, by id; `reference` is the
 * ids that stand for "as they stood"; a cave over that worst by more than `allowance` (a share of it, and at
 * least `slackMs`) is named. A cave in the reference is never named, since it is the worst or under it.
 */
export function overTheWorst(
  costs: Readonly<Record<string, number>>,
  reference: readonly string[],
  allowance: number,
  slackMs: number,
): { worst: number; over: string[] } {
  const worst = Math.max(...reference.map((id) => costs[id]));
  const limit = worst + Math.max(worst * allowance, slackMs);
  return {
    worst,
    over: Object.keys(costs).filter((id) => costs[id] > limit),
  };
}
