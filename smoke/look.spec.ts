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
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { start, swapped, watch, type SaveSetup } from './pushminer';

/** How far the pictures may differ before it is a change and not the GPU: a fiftieth of the pixels, each well off. */
const TOLERANCE = { maxDiffPixelRatio: 0.002, threshold: 0.02 };
/**
 * The same, for the pictures of the canvas alone: the map sits over its corner, and has pictures of its own, so
 * it is put away and these stay what they were, a check that the map changed nothing of the cave's drawing.
 */
const CANVAS_ONLY = { ...TOLERANCE, stylePath: fileURLToPath(new URL('./canvas-only.css', import.meta.url)) };

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

/**
 * The scoop loaded and raised, where the dozer stands: `n` coins from elsewhere laid in its mouth, taken up through
 * the input, as the key and the pad's button do, and the bucket let rise. Read back, so a scene that took nothing is
 * not a picture of an empty bucket.
 */
async function loadBucket(page: Page, n: number, view = { radius: 20, ahead: 0 }) {
  const held = await page.evaluate(
    ([n, view]) => {
      const api = window.pushminer!;
      const d = api.state().dozer;
      const coins = api
        .bodies('coin')
        .filter((b) => !b.carried)
        .sort((a, b) => Math.hypot(b.x - d.x, b.y - d.y) - Math.hypot(a.x - d.x, a.y - d.y))
        .slice(0, n);
      const c = Math.cos(d.yaw),
        s = Math.sin(d.yaw);
      coins.forEach((coin, k) => {
        const along = 5.3 + Math.floor(k / 6) * 0.9,
          across = ((k % 6) - 2.5) * 0.9;
        api.place(coin.slot, d.x + c * along - s * across, d.y + s * along + c * across, 0.6);
      });
      api.step(2);
      api.scoop();
      api.step(60);
      // aimed a little ahead of the machine, where the bucket is, which a narrow screen would otherwise cut off
      api.look(d.x + c * view.ahead, d.y + s * view.ahead, { azimuth: 0.7, polar: 1.0, radius: view.radius });
      api.step(1);
      return api.state().scoop;
    },
    [n, view] as const,
  );
  expect(held.held, 'the coins are in the bucket').toBe(n);
  expect(held.lift, 'and the bucket is up').toBe(1);
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

/** A new game as it opens: at the dark outer end of the way in, the runway lit down it into the Hollow. */
async function freshStart(page: Page, radius: number) {
  await start(page, { seed: 11, paused: true });
  const dark = await page.evaluate((radius) => {
    const api = window.pushminer!;
    api.pause();
    api.step(30);
    const { x, y, yaw } = api.state().dozer;
    api.look(x + Math.cos(yaw) * 18, y + Math.sin(yaw) * 18, { azimuth: yaw + Math.PI, polar: 0.62, radius });
    api.step(1);
    return api.state().darkness;
  }, radius);
  expect(dark, 'dark, but no darker than the arrival').toBeGreaterThan(0.3);
  await hideStats(page);
}

/**
 * The machine half way down the last three tiles of the way out, half in the dark with "Keep going" in full over it:
 * six units short of the leaving line, which is six short of the point `beyond`. Read back, so a scene that missed
 * the ramp is not a picture of something else.
 */
async function midRamp(page: Page, radius: number) {
  await start(page, { seed: 11, paused: true, save: inCave('south-gallery', { open: true }) });
  const shown = await page.evaluate((radius) => {
    const api = window.pushminer!;
    api.pause();
    const { beyond, out } = api.content().exit!;
    const x = beyond.x - out[0] * 12,
      y = beyond.y - out[1] * 12;
    api.teleport(x, y, Math.atan2(out[1], out[0]));
    api.step(30);
    api.look(x, y, { azimuth: -Math.PI / 2, polar: 0.62, radius });
    api.step(1);
    const s = api.state();
    return {
      dark: s.darkness,
      words: s.keepGoing,
      leaving: s.leaving,
      dom: +getComputedStyle(document.getElementById('keepGoing')!).opacity,
    };
  }, radius);
  expect(shown.leaving, 'not yet over the line').toBe(false);
  expect(shown.dark, 'half dark').toBeGreaterThan(0.4);
  expect(shown.dark).toBeLessThan(0.6);
  expect(shown.words, 'the words up').toBeGreaterThan(0.9);
  expect(shown.dom, 'and showing on the page').toBeCloseTo(shown.words, 2);
  await hideStats(page);
}

/** The cave as drawn, without the words over it. */
const cave = (page: Page) => page.locator('#view');

test.describe('what it looks like', () => {
  test('the hollow, from the start', async ({ page }) => {
    const problems = watch(page);
    await begin(page);
    await scene(page, { x: 0, y: 0, radius: 78 }, 180, [0, -14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('hollow.png', CANVAS_ONLY);
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
      await expect(cave(page)).toHaveScreenshot(`${id}.png`, CANVAS_ONLY);
      expect(problems).toEqual([]);
    });
  }

  // the Warrens: a cavern of noise and the hole in it, and then a winding tunnel and the next cavern from as high as the camera goes
  test('the warrens, a cavern and its hole', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('warrens'));
    const [hole] = await page.evaluate(() => window.pushminer!.content().holes);
    await scene(page, { x: hole.x, y: hole.y, radius: 80 }, 180, [hole.x, hole.y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('warrens.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('the warrens, a tunnel and a cavern from as high as the camera goes', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('warrens'));
    await scene(page, { x: 0, y: 0, radius: 170, polar: 0.5 }, 120);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('warrens-tunnels.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  // the Deep: its great hall with the first hole by the way in, and then the whole of the hall from as high as the camera goes,
  // where the shadows must not run out inside the picture
  test('the deep, its hall and the hole by the way in', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('deep'));
    const [hole] = await page.evaluate(() => window.pushminer!.content().holes);
    await scene(page, { x: hole.x + 20, y: hole.y, radius: 90 }, 180, [hole.x, hole.y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('deep.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('the deep, its hall from as high as the camera goes', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('deep'));
    await scene(page, { x: 0, y: 0, radius: 170, polar: 0.5 }, 120);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('deep-hall.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  // the West Gallery's way out, opened, with its burst: the way on to the Deep
  test('the west gallery, its way out opening', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('west-gallery'));
    await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      const { mouth, out } = api.content().exit!;
      api.teleport(mouth.x - out[0] * 40, mouth.y - out[1] * 40, Math.atan2(out[1], out[0]));
      api.step(60);
      api.openExit();
      api.step(14);
      api.look(mouth.x - out[0] * 20, mouth.y - out[1] * 20, { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 });
      api.step(1);
    });
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('west-exit.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  // several holes and belts in a cave: the North Vault's second hole among its heaps, and the East Gallery's two belts
  // running, each with the bar across where it ends
  // the map where it is busiest: the Warrens by its second hole, drones at work, the camera off its home heading
  test('the map in the warrens, by the second hole, with drones at work', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('warrens', { bank: 500, drones: 3 }));
    const hole = (await page.evaluate(() => window.pushminer!.content().holes))[1];
    await scene(page, { x: hole.x, y: hole.y, radius: 70 }, 1200, [hole.x, hole.y - 14, Math.PI / 2]);
    await expect(page.locator('#minimap')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('warrens-map.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the north vault, both its holes', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('north-vault'));
    const [a, b] = await page.evaluate(() => window.pushminer!.content().holes);
    expect(Math.hypot(a.x - b.x, a.y - b.y), 'two holes, apart').toBeGreaterThan(40);
    await scene(page, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, radius: 120 }, 180, [b.x - 12, b.y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('north-holes.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('the east gallery, both its belts running', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('east-gallery', { belts: ['east-belt', 'east-belt-bottom'] }));
    const hole = await page.evaluate(() => window.pushminer!.content().hole);
    expect(await page.evaluate(() => window.pushminer!.state().belts)).toHaveLength(2);
    await scene(page, { x: hole.x + 34, y: hole.y - 4, radius: 105 }, 180, [hole.x - 12, hole.y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('east-belts.png', CANVAS_ONLY);
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
    await expect(cave(page)).toHaveScreenshot('east-belt-ends.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  // the currents, plainly: a flat strip in the colour of what flows, which the machine's lights pick out of the dark. Each is
  // seen from above and a little way off, the machine at its head facing along it. A moving look comes with the renderer's.
  async function currentScene(page: Page, id: string, radius: number, aimAt: 'middle' | 'drain' = 'middle') {
    await begin(page, inCave(id));
    const { c, drain } = await page.evaluate(() => {
      const api = window.pushminer!.content();
      return { c: api.currents[0], drain: api.drains.length ? api.drains[0] : null };
    });
    const len = Math.hypot(c.to.x - c.from.x, c.to.y - c.from.y);
    const ux = (c.to.x - c.from.x) / len,
      uy = (c.to.y - c.from.y) / len;
    const at: [number, number, number] =
      aimAt === 'drain'
        ? [c.to.x - ux * 12, c.to.y - uy * 12, Math.atan2(uy, ux)]
        : [c.from.x - ux * 10, c.from.y - uy * 10, Math.atan2(uy, ux)];
    const look =
      aimAt === 'drain' && drain
        ? { x: drain.x - ux * 6, y: drain.y - uy * 6, radius, polar: 0.9 }
        : { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2, radius, polar: 0.95 };
    await scene(page, look, 120, at);
    await hideStats(page);
  }

  test('a current of water, the Hollow’s brook running to the hole', async ({ page }) => {
    const problems = watch(page);
    await currentScene(page, 'hollow', 60);
    await expect(cave(page)).toHaveScreenshot('current-water.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('a current of lava, the East Gallery’s, into its drain', async ({ page }) => {
    const problems = watch(page);
    await currentScene(page, 'east-gallery', 60);
    await expect(cave(page)).toHaveScreenshot('current-lava.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('a current of ice, the North Vault’s, fast, to the second hole', async ({ page }) => {
    const problems = watch(page);
    await currentScene(page, 'north-vault', 60);
    await expect(cave(page)).toHaveScreenshot('current-ice.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('a drain at the end of the South Gallery’s current, cut like a hole and with none of its glow', async ({
    page,
  }) => {
    const problems = watch(page);
    await currentScene(page, 'south-gallery', 38, 'drain');
    await expect(cave(page)).toHaveScreenshot('drain.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('the dozer, up close', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('south-gallery', { flag: true }));
    const [x, y] = await heart(page);
    await scene(page, { x, y, azimuth: 0.7, polar: 1.0, radius: 22 }, 120, [x, y, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('dozer.png', CANVAS_ONLY);
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
    await expect(cave(page)).toHaveScreenshot('spider.png', CANVAS_ONLY);
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
    await expect(cave(page)).toHaveScreenshot('spider-stride.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('the scoop, a loaded bucket up', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('south-gallery', { flag: true, scoop: 2 }));
    const [x, y] = await heart(page);
    await scene(page, { x, y, azimuth: 0.7, polar: 1.0, radius: 22 }, 120, [x, y, Math.PI / 2]);
    await loadBucket(page, 18);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('scoop.png', CANVAS_ONLY);
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
    await expect(cave(page)).toHaveScreenshot('drone.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  // the foot of the rock, up close, in every cave: where the floor meets the wall, and what lies there
  for (const [name, id] of [
    ['hollow', 'hollow'],
    ['jungle', 'south-gallery'],
    ['ice', 'north-vault'],
    ['lava', 'east-gallery'],
    ['future', 'west-gallery'],
    ['fungal', 'warrens'],
    ['geode', 'deep'],
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
      await expect(cave(page)).toHaveScreenshot(`foot-${name}.png`, CANVAS_ONLY);
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
    await expect(cave(page)).toHaveScreenshot('blast.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('geode stone, in the headlights beside a barrel', async ({ page }) => {
    const problems = watch(page);
    await begin(page);
    const geode = await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      api.step(120);
      const g = api.content().geodes[0];
      // a barrel set down beside it, and the machine backed off so that its lights fall on the pair
      api.place(api.bodies('barrel')[0].slot, g.x + 5, g.y - 3, 1.1);
      api.teleport(g.x - 15, g.y - 2, 0.12);
      api.step(60);
      return g;
    });
    await page.evaluate(
      ([x, y]) => {
        const api = window.pushminer!;
        api.look(x + 2, y, { azimuth: 0.5, polar: 1.0, radius: 30 });
        api.step(1);
      },
      [geode.x, geode.y],
    );
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('geode-stone.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('geode stone, cracked open and mid-crack', async ({ page }) => {
    const problems = watch(page);
    await begin(page);
    const geode = await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      api.step(120);
      const g = api.content().geodes[0];
      api.place(api.bodies('barrel')[0].slot, g.x + 4, g.y - 2, 1.1);
      api.teleport(g.x - 20, g.y - 2, 0.12);
      api.step(30);
      api.lightBarrel(api.bodies('barrel')[0].slot, 0.05);
      return g;
    });
    await page.evaluate(
      ([x, y]) => {
        const api = window.pushminer!;
        // the fuse burns out, the geode is gone, and the picture is taken while its gems are still in the air
        api.step(14);
        api.look(x, y, { azimuth: 0.5, polar: 1.0, radius: 30 });
        api.step(1);
      },
      [geode.x, geode.y],
    );
    expect((await page.evaluate(() => window.pushminer!.events())).some((e) => e.startsWith('geodeCracked'))).toBe(
      true,
    );
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('geode-cracked.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  test('the cave done, with the vein running', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('deep', { done: true, drones: 2, bank: 3000 }));
    const { x, y } = (await page.evaluate(() => window.pushminer!.content())).vein;
    await scene(page, { x, y, radius: 60 }, 240, [x - 10, y - 14, Math.PI / 2]);
    await hideStats(page);
    await expect(cave(page)).toHaveScreenshot('done.png', CANVAS_ONLY);
    expect(problems).toEqual([]);
  });

  // the way out: cracking open when the cave is cleared, driven down in the dark, and come out of into the next cave
  test('the way out opening, with its burst', async ({ page }) => {
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
    await expect(cave(page)).toHaveScreenshot('exit-opening.png', CANVAS_ONLY);
    await expect(page.locator('#cameraNote')).toHaveText('the way out is open');
    expect(problems).toEqual([]);
  });

  test('inside the cutting, its runway lit down it', async ({ page }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: inCave('south-gallery', { open: true }) });
    const dark = await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      const { mouth, beyond, out } = api.content().exit!;
      // a quarter of the way down from the mouth to the leaving line, where the runway lights it and it is not yet dark
      const at = { x: mouth.x + (beyond.x - mouth.x) * 0.25, y: mouth.y + (beyond.y - mouth.y) * 0.25 };
      api.teleport(at.x, at.y, Math.atan2(out[1], out[0]));
      api.step(30);
      api.look(at.x, at.y, { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 });
      api.step(1);
      return api.state().darkness;
    });
    expect(dark, 'lit, the dark being only the last three tiles').toBe(0);
    await hideStats(page);
    await expect(page).toHaveScreenshot('cutting.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('half way into the dark at the end of the way out, Keep going over it', async ({ page }) => {
    const problems = watch(page);
    await midRamp(page, 78);
    await expect(page).toHaveScreenshot('leaving.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('a fresh start in the hollow, the runway leading in', async ({ page }) => {
    const problems = watch(page);
    await freshStart(page, 78);
    await expect(page).toHaveScreenshot('fresh-start.png', TOLERANCE);
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
    });
    // built a frame after the black is drawn, and then up out of it over 0.4 s: the words are gone by 26 frames
    await swapped(page);
    await page.evaluate(() => window.pushminer!.step(26));
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

  test('the scoop on a phone, its button on the pad and a loaded bucket up', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('south-gallery', { scoop: 2 }));
    const [x, y] = await heart(page);
    await scene(page, { x, y, azimuth: 0.7, polar: 1.0, radius: 22 }, 120, [x, y, Math.PI / 2]);
    await loadBucket(page, 18, { radius: 34, ahead: 5 });
    await expect(page.locator('#scoopButton')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-scoop.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the warrens on a phone, a cavern and its hole', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('warrens', { bank: 500 }));
    const [hole] = await page.evaluate(() => window.pushminer!.content().holes);
    await scene(page, { x: hole.x, y: hole.y, radius: 84 }, 120, [hole.x, hole.y - 14, Math.PI / 2]);
    await expect(page.locator('#pad')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-warrens.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('the map on a phone in the warrens, by the second hole, with drones at work', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('warrens', { bank: 500, drones: 3 }));
    const hole = (await page.evaluate(() => window.pushminer!.content().holes))[1];
    await scene(page, { x: hole.x, y: hole.y, radius: 84 }, 1200, [hole.x, hole.y - 14, Math.PI / 2]);
    await expect(page.locator('#minimap')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-warrens-map.png', TOLERANCE);
    expect(problems).toEqual([]);
  });

  test('a fresh start in the hollow, on a phone', async ({ page }) => {
    const problems = watch(page);
    await freshStart(page, 84);
    await expect(page.locator('#pad')).toBeVisible();
    await expect(page).toHaveScreenshot('phone-fresh-start.png', TOLERANCE);
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

  test('half way into the dark at the end of the way out, on a phone', async ({ page }) => {
    const problems = watch(page);
    await midRamp(page, 84);
    await expect(page.locator('#pad')).toBeVisible();
    // the words are in the middle of the screen, whole, and clear of the map and the controls
    const [words, map, pad] = await Promise.all(
      ['#keepGoing', '#minimap', '#pad'].map((sel) =>
        page.locator(sel).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
      ),
    );
    expect(words.left, 'on the screen').toBeGreaterThanOrEqual(0);
    expect(words.right, 'and on it').toBeLessThanOrEqual(400);
    expect((words.left + words.right) / 2, 'centred').toBeCloseTo(200, 0);
    expect(words.bottom, 'above the controls').toBeLessThan(pad.top);
    expect(words.top, 'and below the map').toBeGreaterThan(map.bottom);
    await expect(page).toHaveScreenshot('phone-leaving.png', TOLERANCE);
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
    });
    // built a frame after the black is drawn, and then up out of it over 0.4 s: the words are gone by 26 frames
    await swapped(page);
    await page.evaluate(() => window.pushminer!.step(26));
    expect((await page.evaluate(() => window.pushminer!.state())).cave).toBe('south-gallery');
    // the three lines of the note keep clear of the map beside them
    const [note, map] = await Promise.all(
      ['#cameraNote', '#minimap'].map((sel) =>
        page.locator(sel).evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
      ),
    );
    expect(note.right, 'the note ends before the map begins').toBeLessThan(map.left);
    expect(note.left, 'and is on the screen').toBeGreaterThanOrEqual(0);
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

  test('the deep on a phone, its first hole and the hall', async ({ page }) => {
    const problems = watch(page);
    await begin(page, inCave('deep', { bank: 500 }));
    const [hole] = await page.evaluate(() => window.pushminer!.content().holes);
    await scene(page, { x: hole.x + 14, y: hole.y, radius: 84 }, 120, [hole.x, hole.y - 14, Math.PI / 2]);
    await expect(page.locator('#pad')).toBeVisible();
    await hideStats(page);
    await expect(page).toHaveScreenshot('phone-deep.png', TOLERANCE);
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
