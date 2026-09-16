/**
 * What the game looks like, held to pictures taken before. Every other check
 * is on what the game does; nothing until now noticed a palette gone muddy, a
 * light lost, rock drawn over floor, or the HUD sliding off the corner.
 *
 * Each scene is set through the test API with chance seeded from before the
 * game is built, the game paused, the
 * camera parked by hand, and a fixed number of frames stepped, so the same
 * machine draws the same pixels every run. The pictures are in
 * `smoke/screens/`. They are this machine's GPU: another one will draw them a
 * little differently, so the tolerance is loose and the pictures are not worth
 * arguing with from elsewhere.
 *
 *   npm run look               the scenes against the pictures
 *   npm run look:update        the pictures written again, after a change meant to alter them
 *
 * A failure leaves the picture, what was drawn and the difference in
 * `test-results/`. Look at all three before deciding which is right.
 */
import { expect, test, type Page } from '@playwright/test';
import { start, watch, type SaveSetup } from './pushminer';

/** How far the pictures may differ before it is a change and not the GPU: a fiftieth of the pixels, each well off. */
const TOLERANCE = { maxDiffPixelRatio: 0.002, threshold: 0.02 };

/**
 * The corner that counts the milliseconds a frame takes is different every
 * run, and says nothing about how the game looks. It is put away before the
 * picture is taken, and stays away, since nothing steps the game after.
 */
async function hideStats(page: Page) {
  await page.locator('#stats').evaluate((el: HTMLElement) => (el.hidden = true));
}

/** Where the camera stands for a room: looking at a point, from round and above. */
interface View {
  x: number;
  y: number;
  azimuth?: number;
  polar?: number;
  radius?: number;
}

/** A save with the room open and being cleared, and the rooms before it sealed. */
function inRoom(room: number, more: SaveSetup = {}): SaveSetup {
  return { room, areas: [0, 1, 2, 3, 4].map((a) => a === 0 || a === room), ...more };
}

/**
 * The game set to a scene and stopped: paused and seeded before anything
 * moves, the dozer put where the picture wants it, `frames` stepped so the
 * heaps settle and the lights come up, and the camera parked last.
 */
async function scene(page: Page, view: View, frames = 120, at?: [number, number, number]) {
  await page.evaluate(
    ({ view, frames, at }) => {
      const api = window.pushminer!;
      api.pause();
      if (at) api.teleport(at[0], at[1], at[2]);
      api.step(frames);
      api.look(view.x, view.y, {
        azimuth: view.azimuth ?? 0.9,
        polar: view.polar ?? 0.95,
        radius: view.radius ?? 70,
      });
      api.step(1);
    },
    { view, frames, at },
  );
}

/** The middle of a room's heaps, so each picture is aimed at where its coins are and not at a hard-coded point. */
async function heart(page: Page, room: number): Promise<[number, number]> {
  return page.evaluate((a) => {
    const heaps = window.pushminer!.content().rooms[a].heaps;
    const x = heaps.reduce((n, h) => n + h.x, 0) / heaps.length;
    const y = heaps.reduce((n, h) => n + h.y, 0) / heaps.length;
    return [x, y] as [number, number];
  }, room);
}

/** The cave as drawn, without the words over it. */
const cave = (page: Page) => page.locator('#view');

test.describe('what it looks like', () => {
  test('the hollow, from the start', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true });
    await scene(page, { x: 0, y: 0, radius: 78 }, 180);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('hollow.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  for (const [name, room] of [
    ['south, the jungle', 1],
    ['north, the ice', 2],
    ['east, the lava', 3],
    ['west, the future', 4],
  ] as const) {
    test(`the ${name}`, async ({ page }) => {
      const problems = watch(page);
      await start(page, { seed: 11, paused: true, save: inRoom(room) });
      const [x, y] = await heart(page, room);
      await scene(page, { x, y, radius: 90 }, 180, [x, y - 14, Math.PI / 2]);
      await hideStats(page);
      await expect(cave(page)).toHaveScreenshot(`room-${room}.png`, TOLERANCE);
      expect(problems).toEqual([]);
    });
  }

  test('a barrel going off, mid-blast', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true });
    const barrel = await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      api.step(120);
      const b = api.bodies('barrel')[0];
      api.lightBarrel(b.slot, 0.2);
      return b;
    });
    await page.evaluate(
      ([x, y]) => {
        const api = window.pushminer!;
        // the fuse burns out, and the picture is taken while the coins are still in the air
        api.step(24);
        api.look(x, y, { azimuth: 0.6, polar: 1.1, radius: 46 });
        api.step(1);
      },
      [barrel.x, barrel.y],
    );
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('blast.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the cave done, with the vein running', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: inRoom(4, { done: true, drones: 2, bank: 3000 }) });
    const [x, y] = await heart(page, 4);
    await scene(page, { x, y, radius: 90 }, 240, [x, y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('done.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the workshop, with everything to buy', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: inRoom(1, { bank: 4000, drones: 1, horn: true }) });
    const [x, y] = await heart(page, 1);
    await scene(page, { x, y, radius: 90 }, 120);
    // the key is read in a frame of the game, so one has to be stepped for it to land
    await page.keyboard.press('b');
    await page.evaluate(() => window.pushminer!.step(1));
    await expect(page.locator('#shop')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('workshop.png', TOLERANCE);
    expect(problems).toEqual([]);
  });
});

test.describe('what it looks like on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });

  test('the touch controls over the cave', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: inRoom(1, { bank: 500 }) });
    const [x, y] = await heart(page, 1);
    await scene(page, { x, y, radius: 84 }, 120);
    await expect(page.locator('#pad')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the workshop on a phone', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: inRoom(1, { bank: 4000, drones: 1, horn: true }) });
    const [x, y] = await heart(page, 1);
    await scene(page, { x, y, radius: 84 }, 120);
    await page.locator('#shopButton').click();
    await page.evaluate(() => window.pushminer!.step(1));
    await expect(page.locator('#shop')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-workshop.png', TOLERANCE);
    expect(problems).toEqual([]);
  });
});
