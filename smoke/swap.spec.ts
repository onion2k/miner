/**
 * Going from one cave to the next, for what it costs and what it leaves. The
 * swap is made while the screen is black, so it has a second to do it in;
 * and it is made again at every way out, so whatever of the old cave the
 * renderer or the page kept would pile up across a run. The renderer's
 * buffers and textures are counted by wrapping what makes them, and each
 * cave's swap is timed by the page, which logs it.
 *
 * The run is gone through the way it is played, cave to cave, the machine put
 * past the leaving line of each way out; the last cave is then swapped into
 * twenty times over with `rebuild`, which is the page's own swap for the cave
 * the save is in, and what a run of twenty changes would leave is what those
 * twenty leave.
 */
import { expect, test, type Page } from '@playwright/test';
import { start, swapped, watch } from './pushminer';

/** The most the swap may take, in milliseconds of the page's own clock, while the screen is black. */
const SWAP_BUDGET_MS = 1000;
/** How many times the last cave is swapped into over. */
const CHANGES = 20;

/** The renderer's buffers and textures still held, counted as they are made and destroyed. */
async function counting(page: Page) {
  await page.addInitScript(() => {
    const live = new Set<object>();
    (window as unknown as { gpuLive: () => number }).gpuLive = () => live.size;
    for (const make of ['createBuffer', 'createTexture'] as const) {
      const proto = GPUDevice.prototype as unknown as Record<string, (...a: unknown[]) => { destroy(): void }>;
      const original = proto[make];
      proto[make] = function (this: GPUDevice, ...args: unknown[]) {
        const thing = original.apply(this, args);
        live.add(thing);
        const destroy = thing.destroy.bind(thing);
        thing.destroy = () => {
          live.delete(thing);
          destroy();
        };
        return thing;
      };
    }
  });
}

const held = (page: Page) => page.evaluate(() => (window as unknown as { gpuLive: () => number }).gpuLive());

test('every way out swaps in under a second, and twenty swaps leave no more behind than one', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const problems = watch(page);
  await counting(page);
  await start(page, { seed: 3, paused: true, save: { cave: 'hollow', open: true } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(3);
    window.pushminer!.step(5);
  });

  // marks laid in the first cave, to be gone from the next: its coordinates are the same numbers again
  await page.evaluate(() => {
    window.pushminer!.drive(1, 0.3);
    window.pushminer!.step(90);
    window.pushminer!.release();
  });
  const marked = (await page.evaluate(() => window.pushminer!.state())).trackMarks;
  expect(marked, 'tracks left in the first cave').toBeGreaterThan(10);

  const swaps: Record<string, number> = {};
  for (;;) {
    const content = await page.evaluate(() => window.pushminer!.content());
    if (!content.exit) break;
    const from = content.id;
    const { beyond, out } = content.exit;
    await page.evaluate(() => window.pushminer!.openExit());
    await page.evaluate(
      ([x, y, yaw]) => window.pushminer!.teleport(x, y, yaw),
      [beyond.x, beyond.y, Math.atan2(out[1], out[0])],
    );
    await page.evaluate(() => window.pushminer!.step(3));
    await swapped(page);
    const now = await page.evaluate(() => window.pushminer!.state());
    expect(now.cave, `out of ${from}`).not.toBe(from);
    if (from === 'hollow') expect(now.trackMarks, 'the old cave’s tracks forgotten').toBeLessThan(marked / 2);
    const log = await page.evaluate(() => window.pushminer!.events());
    const line = log.find((e) => e.startsWith(`swap ${now.cave} `));
    expect(line, `the swap into ${now.cave} logged`).toBeDefined();
    swaps[now.cave] = +line!.split(' ')[2];
    expect(swaps[now.cave], `the swap into ${now.cave}, ms`).toBeLessThan(SWAP_BUDGET_MS);
    expect(await page.evaluate(() => window.pushminer!.invariants()), `invariants in ${now.cave}`).toEqual([]);
  }
  info.annotations.push({
    type: 'swap, ms',
    description: Object.entries(swaps)
      .map(([cave, ms]) => `${cave} ${ms.toFixed(0)}`)
      .join(', '),
  });
  expect(Object.keys(swaps), 'every cave after the first swapped into, in the order of the run').toEqual([
    'south-gallery',
    'east-gallery',
    'north-vault',
    'warrens',
    'west-gallery',
    'deep',
  ]);

  // the last cave, swapped into again and again
  const first = { buffers: await held(page), marks: (await page.evaluate(() => window.pushminer!.state())).trackMarks };
  await page.evaluate(() => window.pushminer!.step(60));
  for (let n = 0; n < CHANGES; n++) await page.evaluate(() => window.pushminer!.rebuild());
  await page.evaluate(() => window.pushminer!.step(60));
  const last = { buffers: await held(page), marks: (await page.evaluate(() => window.pushminer!.state())).trackMarks };
  expect(last.buffers, 'renderer buffers and textures held').toBeLessThanOrEqual(first.buffers);
  expect(last.marks, 'track marks kept').toBeLessThanOrEqual(first.marks + 40);
  const state = await page.evaluate(() => window.pushminer!.state());
  expect(state.cave).toBe('deep');
  expect(state.live, 'the cave is whole again').toBeGreaterThan(300);
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
  expect(problems).toEqual([]);
});
