/**
 * The whole cave in one go, in a real browser: every room opened and gone on
 * into, sealing the one behind; a hidden chamber broken into and a brick wall
 * brought down in each; a lamp knocked over; barrels driven into and pushed
 * down the hole; a drone bought and set to work; the horn; and the cave
 * finished, with its vein. Played through the test API with the game paused
 * and stepped a frame at a time, so it is the same every run and waits on no
 * clock — but everything that follows each of those, the scene rebuilt, the
 * rock reshaped, the bodies spawned and sealed away, the particles and the
 * words on the screen, is the game's own.
 *
 * After every stage the game's invariants are checked, and at the end the
 * page must have logged no errors.
 */
import { expect, test, type Page } from '@playwright/test';
import { start, watch } from './pushminer';

/** Play `frames` frames, and check nothing that must hold has broken. */
async function play(page: Page, frames: number, stage: string) {
  const broken = await page.evaluate((n) => {
    window.pushminer!.step(n);
    return window.pushminer!.invariants();
  }, frames);
  expect(broken, `invariants after ${stage}`).toEqual([]);
}

test('the whole cave: rooms, chambers, walls, lamps, barrels, a drone, the horn, and the end', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const problems = watch(page);
  await start(page);
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());
  const hollow = content.rooms[0];

  // a lamp in the hollow, knocked over by driving onto it
  const lamp = content.lamps.findIndex((l) => l.area === 0);
  await page.evaluate(([x, y]) => window.pushminer!.teleport(x, y), [content.lamps[lamp].x, content.lamps[lamp].y]);
  await play(page, 2, 'a lamp');
  expect(await page.evaluate(() => window.pushminer!.state().lampsBroken), 'lamp knocked over').toContain(lamp);

  // a barrel in the hollow driven into: its fuse lit, then gone off
  const barrel = hollow.barrels[0];
  await page.evaluate(
    ([x, y]) => {
      window.pushminer!.teleport(x, y - 8, Math.PI / 2);
      window.pushminer!.drive(1, 0);
    },
    [barrel.x, barrel.y],
  );
  let lit = false;
  for (let f = 0; f < 120 && !lit; f += 5) {
    await play(page, 5, 'driving at a barrel');
    lit = (await page.evaluate(() => window.pushminer!.state().barrels.lit.length)) > 0;
  }
  expect(lit, 'fuse lit').toBe(true);
  await page.evaluate(() => window.pushminer!.release());
  const barrelsBefore = await page.evaluate(() => window.pushminer!.state().barrels.count);
  await play(page, 60 * 4, 'a barrel going off');
  expect(await page.evaluate(() => window.pushminer!.state().barrels.count), 'barrel gone off').toBe(barrelsBefore - 1);
  expect((await page.evaluate(() => window.pushminer!.events())).some((e) => e.startsWith('blast'))).toBe(true);

  // the other barrels pushed down the hole, one lit and one not: gone, and nothing banked for them
  const bankBefore = await page.evaluate(() => window.pushminer!.state().bank);
  await page.evaluate(() => {
    const p = window.pushminer!;
    p.bodies('barrel').forEach((b, n) => {
      if (n === 0) p.lightBarrel(b.slot, 10);
      p.place(b.slot, n * 0.5, 0, 1.5);
    });
  });
  await play(page, 120, 'barrels down the hole');
  expect(await page.evaluate(() => window.pushminer!.state().barrels), 'barrels gone, the fuse forgotten').toEqual({
    count: 0,
    lit: [],
  });
  expect(await page.evaluate(() => window.pushminer!.state().bank), 'nothing banked for a barrel').toBe(bankBefore);

  // a drone, bought and working
  await page.evaluate(() => {
    window.pushminer!.deposit(5000);
    window.pushminer!.buy('drone');
  });
  const droneAt = await page.evaluate(() => window.pushminer!.state().bots[0]);
  await play(page, 60 * 5, 'a drone');
  const droneNow = await page.evaluate(() => window.pushminer!.state().bots[0]);
  expect(Math.hypot(droneNow.x - droneAt.x, droneNow.y - droneAt.y), 'drone moving').toBeGreaterThan(1);

  // the horn
  await page.evaluate(() => {
    const p = window.pushminer!;
    p.buy('horn');
    p.honk();
  });
  await play(page, 30, 'the horn');

  for (let n = 1; n < content.rooms.length; n++) {
    const room = (await page.evaluate(() => window.pushminer!.state().next))!;
    const { name, pastSeal } = content.rooms[room];
    const before = await page.evaluate(() => window.pushminer!.state().live);
    await page.evaluate(() => window.pushminer!.openNext());
    await play(page, 10, `${name} opening`);
    const opened = await page.evaluate(() => window.pushminer!.state());
    expect(opened.areas[room], `${name} open`).toBe(true);
    expect(opened.live, `${name}'s heaps in the cave`).toBeGreaterThan(before);

    // on into it: the room behind is sealed
    const behind = opened.room;
    await page.evaluate(([x, y]) => window.pushminer!.teleport(x, y, 0), [pastSeal!.x, pastSeal!.y]);
    await play(page, 10, `going on into ${name}`);
    const inside = await page.evaluate(() => window.pushminer!.state());
    expect(inside.room, `gone on into ${name}`).toBe(room);
    if (behind !== 0) expect(inside.areas[behind], 'the room behind sealed').toBe(false);

    // its hidden chamber broken into
    const chamber = content.chambers.findIndex((c) => c.area === room);
    if (chamber >= 0) {
      const live = inside.live;
      await page.evaluate((k) => window.pushminer!.reveal(k), chamber);
      await play(page, 30, `${name}'s chamber`);
      const s = await page.evaluate(() => window.pushminer!.state());
      expect(s.secrets[chamber], `${name}'s chamber open`).toBe(true);
      expect(s.live, `${name}'s chamber loot`).toBeGreaterThan(live);
    }

    // its brick wall brought down, a hit short of it first
    const wall = content.walls.findIndex((w) => w.area === room);
    if (wall >= 0) {
      expect(await page.evaluate((w) => window.pushminer!.hitWall(w, 1), wall), `${name}'s wall hurt`).toBeLessThan(1);
      await page.evaluate((w) => window.pushminer!.hitWall(w, 1e6), wall);
      await play(page, 90, `${name}'s wall`);
      expect(await page.evaluate(() => window.pushminer!.state().walls), `${name}'s wall down`).toContain(true);
    }
    await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
  }

  // the last room cleared: the cave is done, and the vein runs
  await page.evaluate(() => window.pushminer!.openNext());
  await play(page, 120, 'the end');
  const end = await page.evaluate(() => window.pushminer!.state());
  expect(end.done, 'cave done').toBe(true);
  expect(end.fountains, 'the vein').toBe(1);
  await info.attach('done', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});
