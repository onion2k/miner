/**
 * How much coin this machine can draw: the coins drawn at each rung of a
 * ladder of detail, from the most down, until a frame fits the budget.
 *
 * Handed what to time and how to change the detail, so it knows nothing of
 * the scene.
 */

const WARMUP = 4;
const SAMPLES = 24;

/**
 * What a frame costs, from `draw` starting to `done` resolving, which should
 * be the GPU finishing. Not the time between frames, which the display holds
 * to its refresh, so a fast machine would look no faster than 60 Hz. Samples
 * are spaced by a timeout, not an animation frame: a hidden tab gets none,
 * and a GPU left idle between samples drops to a slower power state than a
 * game keeps it in. Scheduling only ever adds time, so the lower quartile is
 * the frame's own cost; taken this way it repeats to a tenth or two, where
 * the median through the canvas wandered from 4 to 13 ms between runs.
 */
export async function frameCost(draw: () => boolean, done: () => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    await new Promise((r) => setTimeout(r, 0));
    const start = performance.now();
    const drew = draw();
    await done();
    if (drew && i >= WARMUP) times.push(performance.now() - start);
  }
  if (!times.length) return 0;
  times.sort((a, b) => a - b);
  return times[times.length >> 2];
}

/**
 * Down the ladder of `rungs` until a frame costs no more than `budget`
 * milliseconds, or there is no rung left: each rung set with `setLevel` and
 * timed with `measure`. What each rung tried cost; the level left set is the
 * last of them.
 */
export async function calibrate(
  rungs: number,
  budget: number,
  setLevel: (level: number) => void,
  measure: () => Promise<number>,
): Promise<number[]> {
  const costs: number[] = [];
  for (let level = 0; level < rungs; level++) {
    setLevel(level);
    costs.push(await measure());
    if (costs[level] <= budget) break;
  }
  return costs;
}
