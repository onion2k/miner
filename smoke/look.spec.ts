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

/** Where the camera stands for a cave: looking at a point, from round and above. */
interface View {
  x: number;
  y: number;
  azimuth?: number;
  polar?: number;
  radius?: number;
}

/** A save standing in the cave `id`. */
function inCave(id: string, more: SaveSetup = {}): SaveSetup {
  return { cave: id, ...more };
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

/**
 * The game started for a scene: seeded, paused, and the dozer put on the cave's floor by its hole. A machine
 * comes into a cave in the dark of its way in, and the page is black by how dark it is where the machine
 * stands, so a scene that did not move it would be a picture of the fade and not of the cave.
 */
async function begin(page: Page, save?: SaveSetup) {
  await start(page, { seed: 11, paused: true, save });
  const dark = await page.evaluate(() => {
    const api = window.pushminer!;
    api.pause();
    const hole = api.content().hole;
    api.teleport(hole.x, hole.y - 14, Math.PI / 2);
    api.step(1);
    return api.state().darkness;
  });
  expect(dark, 'the dozer on the floor, in the light').toBe(0);
}

/** The middle of the cave's heaps, so each picture is aimed at where its coins are and not at a hard-coded point. */
async function heart(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const heaps = window.pushminer!.content().heaps;
    const x = heaps.reduce((n, h) => n + h.x, 0) / heaps.length;
    const y = heaps.reduce((n, h) => n + h.y, 0) / heaps.length;
    return [x, y] as [number, number];
  });
}

/** The cave as drawn, without the words over it. */
const cave = (page: Page) => page.locator('#view');

test.describe('what it looks like', () => {
  test('the hollow, from the start', async ({ page }) => {
    const problems = watch(page);
    await begin(page);
    await scene(page, { x: 0, y: 0, radius: 78 }, 180, [0, -14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('hollow.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  for (const [name, id] of [
    ['south gallery, the jungle', 'south-gallery'],
    ['north vault, the ice', 'north-vault'],
    ['east gallery, the lava', 'east-gallery'],
    ['west gallery, the future', 'west-gallery'],
  ] as const) {
    test(`the ${name}`, async ({ page }) => {
      const problems = watch(page);
      await begin(page, inCave(id));
      const [x, y] = await heart(page);
      await scene(page, { x, y, radius: 90 }, 180, [x, y - 14, Math.PI / 2]);
      await hideStats(page);
      await expect(cave(page)).toHaveScreenshot(`${id}.png`, TOLERANCE);
      expect(problems).toEqual([]);
    });
  }

  // several holes and belts in a cave: the North Vault's second hole among its heaps, and the East Gallery's two belts
  // running, each with the bar across where it ends
  test('the north vault, both its holes', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('north-vault'));
    const [a, b] = await page.evaluate(() => window.pushminer!.content().holes);
    expect(Math.hypot(a.x - b.x, a.y - b.y), 'two holes, apart').toBeGreaterThan(40);
    await scene(page, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, radius: 120 }, 180, [b.x - 12, b.y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('north-holes.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the east gallery, both its belts running', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('east-gallery', { belts: ['east-belt', 'east-belt-bottom'] }));
    const hole = await page.evaluate(() => window.pushminer!.content().hole);
    expect(await page.evaluate(() => window.pushminer!.state().belts)).toHaveLength(2);
    await scene(page, { x: hole.x + 34, y: hole.y - 4, radius: 105 }, 180, [hole.x - 12, hole.y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('east-belts.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('where the east gallery’s belts end, up close', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('east-gallery', { belts: ['east-belt', 'east-belt-bottom'] }));
    const ends = await page.evaluate(() => window.pushminer!.content().belts.map((b) => b.to));
    await scene(
      page,
      { x: (ends[0].x + ends[1].x) / 2, y: (ends[0].y + ends[1].y) / 2, azimuth: 0.9, polar: 1.0, radius: 38 },
      120,
      [ends[0].x + 10, ends[0].y + 14, Math.PI / 2],
    );
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('east-belt-ends.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the dozer, up close', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('south-gallery', { flag: true }));
    const [x, y] = await heart(page);
    await scene(page, { x, y, azimuth: 0.7, polar: 1.0, radius: 22 }, 120, [x, y, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('dozer.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the Spiderdozer, standing and mid-stride', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('south-gallery', { bank: 1000 }));
    await page.evaluate(() => {
      const api = window.pushminer!;
      api.buy('body:spider');
      api.step(120);
      const d = api.state().dozer;
      api.look(d.x, d.y, { azimuth: 0.7, polar: 1.0, radius: 22 });
      api.step(1);
    });
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('spider.png', TOLERANCE);
    // walking: set down on open floor, driven across it, and the picture taken while a set of legs is in the air
    const [x, y] = await heart(page);
    await page.evaluate(
      ([x, y]) => {
        const api = window.pushminer!;
        api.teleport(x - 16, y + 12, 0);
        api.step(30);
        api.drive(1, 0);
        api.step(75);
        api.release();
        const d = api.state().dozer;
        api.look(d.x, d.y, { azimuth: 2.3, polar: 1.05, radius: 20 });
        api.step(1);
      },
      [x, y],
    );
    await expect(cave(page)).toHaveScreenshot('spider-stride.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('a drone, up close', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('south-gallery', { drones: 1 }));
    const at = await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      api.step(120);
      const b = api.state().bots[0];
      api.look(b.x, b.y, { azimuth: 0.7, polar: 1.0, radius: 16 });
      api.step(1);
      return b;
    });
    expect(at).toBeDefined();
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('drone.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  // the foot of the rock, up close, in every cave: where the floor meets the wall, and what lies there
  for (const [name, id] of [
    ['hollow', 'hollow'],
    ['jungle', 'south-gallery'],
    ['ice', 'north-vault'],
    ['lava', 'east-gallery'],
    ['future', 'west-gallery'],
  ] as const) {
    test(`the foot of the rock in the ${name}`, async ({ page }) => {
      const problems = watch(page);
      await begin(page, inCave(id));
      await page.evaluate(() => {
        const api = window.pushminer!;
        api.step(60);
        // by the cave's edge: the heap furthest from the hole, and on outward from it toward the wall
        const heaps = api.content().heaps;
        const h = heaps.reduce((f, p) => (Math.hypot(p.x, p.y) > Math.hypot(f.x, f.y) ? p : f));
        const len = Math.hypot(h.x, h.y) || 1;
        api.look(h.x + (h.x / len) * 9, h.y + (h.y / len) * 9, { azimuth: 0.9, polar: 1.05, radius: 26 });
        api.step(1);
      });
      await hideStats(page);
      await expect(cave(page)).toHaveScreenshot(`foot-${name}.png`, TOLERANCE);
      expect(problems).toEqual([]);
    });
  }

  test('a barrel going off, mid-blast', async ({ page }) => {
    const problems = watch(page);
    await begin(page);
    const barrel = await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      api.step(120);
      const b = api.bodies('barrel')[0];
      // the barrels stand clear of the heaps, so a handful of coins is carried over and set round this one,
      // for the blast to throw
      api
        .bodies('coin')
        .slice(0, 60)
        .forEach((c, n) => {
          const a = n * 2.4;
          api.place(c.slot, b.x + Math.cos(a) * (1.5 + (n % 5)), b.y + Math.sin(a) * (1.5 + (n % 5)), 1 + (n % 3));
        });
      api.step(30);
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
    await begin(page, inCave('west-gallery', { done: true, drones: 2, bank: 3000 }));
    const { x, y } = (await page.evaluate(() => window.pushminer!.content())).vein;
    await scene(page, { x, y, radius: 60 }, 240, [x - 10, y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('done.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  // the way out: cracking open when the cave is cleared, driven down in the dark, and come out of into the next cave
  test('the way out opening, with its burst and the arrow', async ({ page }) => {
    const problems = watch(page);
    await begin(page);
    const mouth = await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      const { mouth, out } = api.content().exit!;
      api.teleport(mouth.x - out[0] * 40, mouth.y - out[1] * 40, Math.atan2(out[1], out[0]));
      api.step(60);
      api.openExit();
      // the rock has burst and the dust is still rising
      api.step(14);
      api.look(mouth.x - out[0] * 20, mouth.y - out[1] * 20, { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 });
      api.step(1);
      return mouth;
    });
    expect(mouth).toBeDefined();
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('exit-opening.png', TOLERANCE);
    await expect(page.locator('#cameraNote')).toHaveText('the way out is open');
    expect(problems).toEqual([]);
  });

  test('inside the cutting, with only the headlights', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: inCave('south-gallery', { open: true }) });
    const dark = await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      const { mouth, beyond, out } = api.content().exit!;
      // a quarter of the way down from the mouth to the leaving line, where it is dark and the headlights still show it
      const at = { x: mouth.x + (beyond.x - mouth.x) * 0.25, y: mouth.y + (beyond.y - mouth.y) * 0.25 };
      api.teleport(at.x, at.y, Math.atan2(out[1], out[0]));
      api.step(30);
      api.look(at.x, at.y, { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 });
      api.step(1);
      return api.state().darkness;
    });
    expect(dark, 'dark, but not yet black').toBeGreaterThan(0.25);
    expect(dark).toBeLessThan(0.7);
    await hideStats(page);
    await expect(page).toHaveScreenshot('cutting.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('arriving in the next cave, dark, with its name', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: inCave('hollow', { open: true }) });
    await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      api.step(30);
      // driven out past the leaving line, by the test API's hand on the machine; the swap is the page's own
      const { beyond, out } = api.content().exit!;
      api.teleport(beyond.x, beyond.y, Math.atan2(out[1], out[0]));
      api.step(2);
      api.step(20);
    });
    const now = await page.evaluate(() => window.pushminer!.state());
    expect(now.cave).toBe('south-gallery');
    await hideStats(page);
    await expect(page).toHaveScreenshot('arriving.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the workshop, with everything to buy', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('south-gallery', { bank: 4000, drones: 1, horn: true }));
    const [x, y] = await heart(page);
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
    await begin(page, inCave('south-gallery', { bank: 500 }));
    const [x, y] = await heart(page);
    await scene(page, { x, y, radius: 84 }, 120);
    await expect(page.locator('#pad')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the way out open, on a phone', async ({ page }) => {
    const problems = watch(page);
    await begin(page);
    await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      const { mouth, out } = api.content().exit!;
      api.teleport(mouth.x - out[0] * 40, mouth.y - out[1] * 40, Math.atan2(out[1], out[0]));
      api.step(60);
      api.openExit();
      api.step(14);
      api.look(mouth.x - out[0] * 20, mouth.y - out[1] * 20, { azimuth: -Math.PI / 2, polar: 0.62, radius: 84 });
      api.step(1);
    });
    await expect(page.locator('#pad')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-exit.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('arriving in the next cave, on a phone', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: inCave('hollow', { open: true }) });
    await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      api.step(30);
      const { beyond, out } = api.content().exit!;
      api.teleport(beyond.x, beyond.y, Math.atan2(out[1], out[0]));
      api.step(2);
      api.step(20);
    });
    expect((await page.evaluate(() => window.pushminer!.state())).cave).toBe('south-gallery');
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-arriving.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the workshop in the east gallery on a phone, its two belts named', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('east-gallery', { bank: 4000, drones: 1, horn: true }));
    const [x, y] = await heart(page);
    await scene(page, { x, y, radius: 84 }, 120);
    await page.locator('#shopButton').click();
    await page.evaluate(() => window.pushminer!.step(1));
    await expect(page.locator('#shop')).toBeVisible();
    const fits = await page.$$eval('#shop button[data-id^="belt:"]', (buttons) =>
      buttons.map((b) => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= window.innerWidth),
    );
    expect(fits, 'both belt buttons fit the screen, names and all').toEqual([true, true]);
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-workshop-east.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the workshop on a phone', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('south-gallery', { bank: 4000, drones: 1, horn: true }));
    const [x, y] = await heart(page);
    await scene(page, { x, y, radius: 84 }, 120);
    await page.locator('#shopButton').click();
    await page.evaluate(() => window.pushminer!.step(1));
    await expect(page.locator('#shop')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-workshop.png', TOLERANCE);
    expect(problems).toEqual([]);
  });
});
