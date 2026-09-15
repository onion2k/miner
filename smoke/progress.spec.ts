/**
 * The whole cave in one go, in a real browser: every room opened and gone on
 * into, sealing the one behind; a hidden chamber broken into and a brick wall
 * brought down in each; a lamp knocked over; a drone bought and set to work;
 * the horn; and the cave finished, with its vein. Driven through the game's
 * own economy and by putting the dozer where it needs to be, rather than by
 * playing it, so it takes seconds — but everything that follows each of
 * those, the scene rebuilt, the rock reshaped, the bodies spawned and sealed
 * away, the particles and the words on the screen, is the game's own.
 *
 * What it looks for is that none of it throws or logs an error, and that
 * each step leaves the game where it should.
 */
import { expect, test, type Page } from '@playwright/test';
import { AREAS, ORDER, SECRETS, WALLS, WINGS, buildCave, sealPoint } from '../src/cave';

interface Exposed {
  calibration: number[];
  world: {
    live: number;
    count: number;
    alive: Uint8Array;
    kind: Uint8Array;
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    wake(i: number): void;
  };
  dozer: { x: number; y: number; yaw: number; speed: number };
  economy: {
    save: {
      areas: boolean[];
      secrets: boolean[];
      walls: boolean[];
      lampsBroken: number[];
      rubble: number[];
      horn: boolean;
      done: boolean;
      barrels: number[] | null;
    };
    current(): number;
    open(): void;
    reveal(k: number): void;
    hitWall(w: number, damage: number): number;
    deposit(value: number): void;
    readonly bank: number;
    buy(id: string): boolean;
  };
  cave: { lamps: { x: number; y: number; area: number }[] };
  bots: { x: number; y: number }[];
  fountains: unknown[];
  barrels: { lit: number[]; light(i: number, seconds: number): void };
}

const cave = buildCave();

/** Somewhere a little past the line that seals the room behind, down a room's corridor: in the room, on floor. */
function pastSeal(area: number): [number, number] {
  const [x, y] = sealPoint(cave, area);
  const [dx, dy] = WINGS[area].dir;
  return [x + dx * 4, y + dy * 4];
}

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  return problems;
}

/** A value from the game, by a function of what it exposes, run in the page with `arg`. */
function game<A, T>(page: Page, fn: (g: Exposed, arg: A) => T, arg: A): Promise<T> {
  return page.evaluate(`(${fn.toString()})(globalThis, ${JSON.stringify(arg)})`);
}

test('the whole cave: rooms, chambers, walls, lamps, a drone, the horn, and the end', async ({ page }, info) => {
  test.setTimeout(180_000);
  const problems = watch(page);
  await page.goto('/?coins=3');
  await expect(page.locator('#boot')).toHaveClass(/gone/, { timeout: 60_000 });
  const settle = () => page.waitForTimeout(400);

  // a lamp in the hollow, knocked over by driving onto it
  const lamp = cave.lamps.findIndex((l) => l.area === 0);
  await game(page, (g, [x, y]) => Object.assign(g.dozer, { x, y, speed: 0 }), [cave.lamps[lamp].x, cave.lamps[lamp].y]);
  await settle();
  expect(await game(page, (g, k) => g.economy.save.lampsBroken.includes(k), lamp), 'lamp knocked over').toBe(true);

  // a barrel in the hollow driven into: its fuse lit, then gone off
  const barrel = cave.barrels.find((b) => b.area === 0)!;
  await game(page, (g, [x, y]) => Object.assign(g.dozer, { x, y: y - 8, yaw: Math.PI / 2, speed: 0 }), [
    barrel.x,
    barrel.y,
  ]);
  const barrelsBefore = await game(page, (g) => g.barrels.lit.length, null);
  expect(barrelsBefore).toBe(0);
  await page.keyboard.down('w');
  await expect
    .poll(() => game(page, (g) => g.barrels.lit.length, null), { message: 'fuse lit', timeout: 5000 })
    .toBe(1);
  await page.keyboard.up('w');
  await expect
    .poll(() => game(page, (g) => g.economy.save.barrels?.length ?? -1, null), {
      message: 'barrel gone off',
      timeout: 8000,
    })
    .toBe((cave.barrels.filter((b) => b.area === 0).length - 1) * 4);

  // the other barrels pushed down the hole, one lit and one not: gone, and nothing banked for them
  const bankBefore = await game(page, (g) => g.economy.bank, null);
  await game(
    page,
    (g) => {
      let n = 0;
      for (let i = 0; i < g.world.count && n < 2; i++) {
        if (!g.world.alive[i] || g.world.kind[i] !== 7) continue;
        if (n === 0) g.barrels.light(i, 10);
        g.world.x[i] = n * 0.5;
        g.world.y[i] = 0;
        g.world.z[i] = 1.5;
        g.world.wake(i);
        n++;
      }
    },
    null,
  );
  await expect
    .poll(() => game(page, (g) => g.economy.save.barrels?.length ?? -1, null), {
      message: 'barrels down the hole',
      timeout: 8000,
    })
    .toBe(Math.max(0, cave.barrels.filter((b) => b.area === 0).length - 3) * 4);
  expect(await game(page, (g) => g.barrels.lit.length, null), 'the lit one forgotten').toBe(0);
  expect(await game(page, (g) => g.economy.bank, null), 'nothing banked for a barrel').toBe(bankBefore);

  // a drone, bought and working
  await game(page, (g) => g.economy.deposit(5000), null);
  expect(await game(page, (g) => g.economy.buy('drone'), null), 'drone bought').toBe(true);
  const droneAt = await game(page, (g) => [g.bots[0].x, g.bots[0].y], null);
  await expect
    .poll(
      async () => {
        const [x, y] = await game(page, (g) => [g.bots[0].x, g.bots[0].y], null);
        return Math.hypot(x - droneAt[0], y - droneAt[1]);
      },
      { message: 'drone moving', timeout: 10_000 },
    )
    .toBeGreaterThan(1);

  // the horn
  await game(page, (g) => (g.economy.save.horn = true), null);
  await page.keyboard.press('h');

  for (let n = 1; n < ORDER.length; n++) {
    const room = ORDER[n],
      name = AREAS[room].name;
    const before = await game(page, (g) => g.world.live, null);
    await game(page, (g) => g.economy.open(), null);
    await settle();
    expect(await game(page, (g, a) => g.economy.save.areas[a], room), `${name} open`).toBe(true);
    expect(await game(page, (g) => g.world.live, null), `${name}'s heaps in the cave`).toBeGreaterThan(before);

    // on into it: the room behind is sealed
    await game(page, (g, [x, y, yaw]) => Object.assign(g.dozer, { x, y, yaw, speed: 0 }), [...pastSeal(room), 0]);
    await settle();
    expect(await game(page, (g) => g.economy.current(), null), `gone on into ${name}`).toBe(room);
    if (n > 1)
      expect(await game(page, (g, a) => g.economy.save.areas[a], ORDER[n - 1]), 'the room behind sealed').toBe(false);

    // its hidden chamber broken into
    const chamber = SECRETS.findIndex((s) => s.area === room);
    if (chamber >= 0) {
      const live = await game(page, (g) => g.world.live, null);
      await game(page, (g, k) => g.economy.reveal(k), chamber);
      await settle();
      expect(await game(page, (g, k) => g.economy.save.secrets[k], chamber), `${name}'s chamber open`).toBe(true);
      expect(await game(page, (g) => g.world.live, null), `${name}'s chamber loot`).toBeGreaterThan(live);
    }

    // its brick wall brought down, a hit short of it first
    const wall = WALLS.findIndex((w) => w.area === room);
    if (wall >= 0) {
      expect(await game(page, (g, w) => g.economy.hitWall(w, 1), wall), `${name}'s wall hurt`).toBeLessThan(1);
      await game(page, (g, w) => g.economy.hitWall(w, 1e6), wall);
      await page.waitForTimeout(1200);
      expect(await game(page, (g, w) => g.economy.save.walls[w], wall), `${name}'s wall down`).toBe(true);
      expect(await game(page, (g) => g.economy.save.rubble.length, null), 'rubble recorded').toBeGreaterThan(0);
    }
    await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
  }

  // the last room cleared: the cave is done, and the vein runs
  await game(page, (g) => g.economy.open(), null);
  await settle();
  expect(await game(page, (g) => g.economy.save.done, null), 'cave done').toBe(true);
  expect(await game(page, (g) => g.fountains.length, null), 'the vein').toBe(1);
  await page.waitForTimeout(1000);
  await info.attach('done', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});
