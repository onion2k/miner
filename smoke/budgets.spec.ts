/**
 * The two budgets that can only be measured in a page, on the real GPU: what the swap into a cave costs, and
 * what a frame of it costs to draw. The rest (the terrain's size and build time, the nav's rebuild) are
 * `scripts/budgets.ts`, and the physics' frame is `scripts/physics-bench.ts`.
 *
 * Every cave is measured in one page, one after another, by `goto`, which is the page's own swap. A machine's
 * state moves every cave's figure together by more than the caves differ from each other, so neither figure is
 * held to a number of milliseconds:
 *
 * - **the swap** is the fastest of several, as a multiple of a fixed piece of arithmetic timed in the same page
 *   (`scripts/reference.ts`), held to `scripts/budgets-baseline.json` by the rule in `scripts/judge.ts`; and
 *   none may pass a second, which is the budget the plan gives the screen going dark and coming back;
 * - **the frame** is each cave's fastest round of many, every cave taken in turn in each round (the order
 *   turned round every other round) in four views, down the way in with its runway lit, at the hole, at the heaps and from as high as the camera
 *   goes; a cave is held to the worst of the six caves that stood before the bigger ones were made, in the same
 *   view and the same run, with the allowance below. The plan said the median; it is the fastest round because
 *   what else the machine is doing comes and goes by more than the caves differ and only ever slows a frame.
 *
 *   npm run smoke -- smoke/budgets.spec.ts                      hold both
 *   BUDGETS_UPDATE=1 npm run smoke -- smoke/budgets.spec.ts     write the swap baseline again
 *
 * Each run leaves its figures in `test-results/budgets.json`, for setting an allowance from many runs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { RUN } from '../src/caves';
import { judge, median, overTheWorst } from '../scripts/judge';
import { reference } from '../scripts/reference';
import { start, watch } from './pushminer';

/** `BUDGETS_BASELINE` names another file to read and write, for trying the gate against a baseline that is not the project's. */
const BASELINE = process.env.BUDGETS_BASELINE ?? 'scripts/budgets-baseline.json';
/** The most a swap may take, in milliseconds of the page's own clock, while the screen is black. */
const SWAP_BUDGET_MS = 1000;
/** How many times each cave is swapped into, the fastest kept. */
const SWAPS = 6;
/**
 * How much over its baseline the swap may be, as a share and as milliseconds, before it fails. Set from six
 * whole runs on the six caves as they were, on a machine with another session's browsers running: each
 * cave's swap, as a multiple of the reference, strayed from its baseline by between -6% and +2%, and the
 * swaps within one run (the same cave six times over) by under 4%. So the allowance is a little over twice
 * the widest: 15%, and 25 ms, which is what the page's own timer and a garbage collection can add. What it
 * has to catch is a lever pulled the wrong way (a settling step added, a scan made to go twice round), which
 * is tens of milliseconds on the smaller caves and more on the Deep.
 */
const SWAP_TOLERANCE = 0.15,
  SWAP_SLACK_MS = 25;
/** The caves as they stood before the Phase 5: what a frame of any cave is held to the worst of. */
const OLD_CAVES = ['hollow', 'south-gallery', 'east-gallery', 'north-vault', 'warrens', 'west-gallery'];
/** Rounds of the frame measure: each cave in each view once a round, the fastest kept. */
const ROUNDS = 9;
/**
 * How much over the worst of the old caves a frame may be, as a share and as milliseconds. Set from five whole
 * runs on the six caves as they were, on a machine with another session's browsers and a model running on the
 * GPU: a frame is measured by the time the GPU takes to finish it, and so is slowed, the heavy ones most, by
 * whatever else is using the GPU, which comes in bursts of minutes. The same cave's fastest round, run to run,
 * went from 3.9 to 5.4 ms at the hole (the East Gallery, four runs of five at 3.9 to 4.1), 6.6 to 8.1 at the
 * heaps and 7.2 to 10.5 from high: up to 1.46 times. Pairing each round with the worst of its own round did no
 * better (a cave's ratio to another strayed by a fifth either way), and the lower quartile of the rounds did
 * not either. So a cave measured against the worst of the rest, both in one run, may read half as much again
 * by wobble alone, and the allowance is that. What it catches is a cave twice as heavy as the worst: a Deep
 * with a lamp every 8 and the whole of its dressing drew 13.2 ms from high against a worst of 5.9, and failed.
 * What it cannot is one a third heavier: a Deep with a lamp every 18 and 0.8 of its dressing, which is twice
 * what it has of both, drew 7.2 against 6.0 and passed. That wants a finer instrument (GPU timestamps, if the
 * renderer is given them) and is said so in the report.
 */
const FRAME_ALLOWANCE = 0.5,
  FRAME_SLACK_MS = 0.5;

const VIEWS = ['cutting', 'hole', 'heaps', 'high'] as const;
type View = (typeof VIEWS)[number];

/** The reference arithmetic, run in the page: warmed up twice, the fastest of six. */
async function pageReference(page: Page): Promise<number> {
  return page.evaluate((src) => {
    const run = (0, eval)(`(${src})`) as () => number;
    run();
    run();
    let best = Infinity;
    for (let k = 0; k < 6; k++) best = Math.min(best, run());
    return best;
  }, reference.toString());
}

/** Where the camera stands for each view in the cave the page is in, and the dozer with it. */
async function setView(page: Page, view: View) {
  await page.evaluate((view) => {
    const api = window.pushminer!;
    const content = api.content();
    if (view === 'cutting') {
      // down the way in from where the machine arrives, which it still stands at after the swap, the runway lit down both sides
      const { x, y, yaw } = api.state().dozer;
      api.look(x + Math.cos(yaw) * 18, y + Math.sin(yaw) * 18, { azimuth: yaw + Math.PI, polar: 0.62, radius: 78 });
    } else if (view === 'hole') {
      const h = content.hole;
      api.teleport(h.x, h.y - 14, Math.PI / 2);
      api.look(h.x, h.y - 14, { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 });
    } else if (view === 'heaps') {
      // the heap nearest the middle of all of them, so the picture is aimed at coins and not at rock
      const cx = content.heaps.reduce((n, h) => n + h.x, 0) / content.heaps.length,
        cy = content.heaps.reduce((n, h) => n + h.y, 0) / content.heaps.length;
      const h = content.heaps.reduce((f, p) =>
        Math.hypot(p.x - cx, p.y - cy) < Math.hypot(f.x - cx, f.y - cy) ? p : f,
      );
      api.teleport(h.x, h.y - 10, Math.PI / 2);
      api.look(h.x, h.y, { azimuth: 0.9, polar: 0.95, radius: 90 });
    } else {
      // from as high as the camera goes, over the middle of the grid
      const h = content.hole;
      api.teleport(h.x, h.y - 14, Math.PI / 2);
      api.look(0, 0, { azimuth: -Math.PI / 2, polar: 0.5, radius: 170 });
    }
    api.step(3);
  }, view);
}

test('every cave swaps in under a second, and no slower than it did', async ({ page }, info) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await start(page, { seed: 5, paused: true });
  await page.evaluate(() => window.pushminer!.pause());
  const ref = await pageReference(page);
  // a swap to warm the page's code before any is timed: the first of a session is compiling
  await page.evaluate(() => window.pushminer!.goto('hollow'));
  await page.evaluate(() => window.pushminer!.events());

  const swaps: Record<string, number[]> = {};
  for (const { id } of RUN) {
    swaps[id] = [];
    for (let k = 0; k < SWAPS; k++) {
      const line = await page.evaluate((id) => {
        window.pushminer!.goto(id);
        return window.pushminer!.events().find((e) => e.startsWith('swap ')) ?? '';
      }, id);
      expect(line, `the swap into ${id} logged`).toMatch(new RegExp(`^swap ${id} \\d+$`));
      swaps[id].push(+line.split(' ')[2]);
    }
  }
  const fastest = Object.fromEntries(Object.entries(swaps).map(([id, ms]) => [id, Math.min(...ms)]));
  const figures = Object.fromEntries(
    Object.entries(swaps).map(([id, ms]) => [
      id,
      { fastest: Math.min(...ms), median: median(ms), slowest: Math.max(...ms) },
    ]),
  );
  writeFigures({ swap: { ref, figures } });
  info.annotations.push({
    type: 'swap, ms (fastest / median / slowest)',
    description: Object.entries(figures)
      .map(([id, f]) => `${id} ${f.fastest.toFixed(0)}/${f.median.toFixed(0)}/${f.slowest.toFixed(0)}`)
      .join(', '),
  });

  for (const [id, f] of Object.entries(figures))
    expect(f.median, `the swap into ${id}: its median, ms`).toBeLessThan(SWAP_BUDGET_MS);

  if (process.env.BUDGETS_UPDATE) {
    const was = readBaseline();
    was.swap = Object.fromEntries(Object.entries(fastest).map(([id, ms]) => [id, +(ms / ref).toFixed(6)]));
    was.swapMs = Object.fromEntries(Object.entries(fastest).map(([id, ms]) => [id, +ms.toFixed(1)]));
    writeFileSync(BASELINE, `${JSON.stringify(was, null, 2)}\n`);
    expect(problems).toEqual([]);
    return;
  }
  const baseline = readBaseline().swap;
  expect(baseline, 'a swap baseline: BUDGETS_UPDATE=1 npm run smoke -- smoke/budgets.spec.ts').toBeDefined();
  const slower: string[] = [];
  for (const [id, ms] of Object.entries(fastest)) {
    const was = baseline?.[id];
    if (was === undefined) {
      slower.push(`${id}: not in the baseline`);
      continue;
    }
    if (judge({ ms, ref }, was, SWAP_TOLERANCE, SWAP_SLACK_MS) === 'SLOWER')
      slower.push(`${id}: ${ms.toFixed(0)} ms, ${((ms / ref / was - 1) * 100).toFixed(0)}% over its baseline`);
  }
  expect(slower, 'swaps over their baselines').toEqual([]);
  expect(problems).toEqual([]);
});

test('every cave draws a frame no heavier than the worst of the old ones, in each view', async ({ page }, info) => {
  test.setTimeout(420_000);
  const problems = watch(page);
  await start(page, { seed: 5, paused: true });
  await page.evaluate(() => window.pushminer!.pause());
  const ids = RUN.map((c) => c.id);
  expect(ids, 'the old caves are all in the run').toEqual(expect.arrayContaining(OLD_CAVES));

  const samples: Record<View, Record<string, number[]>> = {
    cutting: Object.fromEntries(ids.map((id) => [id, []])),
    hole: Object.fromEntries(ids.map((id) => [id, []])),
    heaps: Object.fromEntries(ids.map((id) => [id, []])),
    high: Object.fromEntries(ids.map((id) => [id, []])),
  };
  for (let round = 0; round < ROUNDS; round++) {
    // the order turned round every other round, so a machine that warms or cools through the run favours no cave
    for (const id of round % 2 ? [...ids].reverse() : ids) {
      await page.evaluate((id) => window.pushminer!.goto(id), id);
      for (const view of VIEWS) {
        await setView(page, view);
        samples[view][id].push(await page.evaluate(() => window.pushminer!.measureFrame()));
      }
    }
  }
  // the fastest round of each, not the median: what else the machine is doing comes and goes through a run, by more
  // than the caves differ, and it only ever makes a frame slower (the rounds of one run were 14 ms and 7 ms for the
  // same cave a minute apart), so the round it interfered with least is the frame's own cost
  const medians = Object.fromEntries(
    VIEWS.map((v) => [v, Object.fromEntries(ids.map((id) => [id, Math.min(...samples[v][id])]))]),
  ) as Record<View, Record<string, number>>;
  writeFigures({
    frame: {
      samples,
      fastest: medians,
      medians: Object.fromEntries(
        VIEWS.map((v) => [v, Object.fromEntries(ids.map((id) => [id, median(samples[v][id])]))]),
      ),
    },
  });

  const lines: string[] = [];
  const over: string[] = [];
  for (const view of VIEWS) {
    const { worst, over: heavy } = overTheWorst(medians[view], OLD_CAVES, FRAME_ALLOWANCE, FRAME_SLACK_MS);
    lines.push(
      `${view}: worst old ${worst.toFixed(2)}; ${ids.map((id) => `${id} ${medians[view][id].toFixed(2)}`).join(', ')}`,
    );
    for (const id of heavy)
      over.push(`${id} in the ${view} view: ${medians[view][id].toFixed(2)} ms against a worst of ${worst.toFixed(2)}`);
  }
  info.annotations.push({ type: 'frame, ms', description: lines.join(' | ') });
  console.log(lines.join('\n'));
  expect(over, 'caves heavier than the worst of the old ones').toEqual([]);
  expect(problems).toEqual([]);
});

interface Baseline {
  caves?: unknown;
  nav?: unknown;
  ms?: unknown;
  swap?: Record<string, number>;
  swapMs?: Record<string, number>;
}

function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
}

/** What a run measured, kept beside the others for looking at: one file, each test adding its part. */
function writeFigures(part: Record<string, unknown>) {
  mkdirSync('test-results', { recursive: true });
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync('test-results/budgets.json', 'utf8')) as Record<string, unknown>;
  } catch {
    /* the first of the run */
  }
  writeFileSync('test-results/budgets.json', JSON.stringify({ ...all, ...part }, null, 1));
}

/**
 * What one update of the map costs, the view and the draw: half a millisecond, in the cave with the most bodies
 * and the biggest floor, with drones at work, and on a screen at three times the pixels, which is the biggest
 * canvas it is drawn on. The map is worked out about fifteen times a second, so this is what it takes from the
 * frames. The run of updates is taken to the end (the canvas read back once), so the browser's rasterising is counted and not left to it.
 */
const MAP_BUDGET_MS = 0.5;
test.describe('the map', () => {
  test.use({ deviceScaleFactor: 3 });
  test(`costs under ${MAP_BUDGET_MS} ms an update in the biggest caves`, async ({ page }, info) => {
    const problems = watch(page);
    await start(page, { seed: 5, paused: true, save: { cave: 'deep', bank: 50000, drones: 3 } });
    await page.evaluate(() => window.pushminer!.pause());
    const costs: Record<string, number> = {};
    for (const id of ['deep', 'warrens', 'hollow']) {
      await page.evaluate((id) => {
        const api = window.pushminer!;
        api.goto(id);
        const hole = api.content().hole;
        api.teleport(hole.x, hole.y - 14, Math.PI / 2);
        api.step(600);
      }, id);
      // warmed up, and the fastest of five rounds of two hundred, since only a slower round says what else the machine was doing
      const rounds: number[] = [];
      for (let k = 0; k < 5; k++) rounds.push(await page.evaluate(() => window.pushminer!.measureMap(200)));
      costs[id] = Math.min(...rounds);
      expect(costs[id], `an update of the map in ${id}`).toBeLessThan(MAP_BUDGET_MS);
    }
    await info.attach('map-cost.json', { body: JSON.stringify(costs, null, 2), contentType: 'application/json' });
    console.info('map update, ms:', JSON.stringify(costs));
    expect(problems).toEqual([]);
  });
});
