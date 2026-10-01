/**
 * The run in one go, in a real browser: a lamp knocked over, barrels driven
 * into and pushed down the hole, the Spiderdozer, a drone bought and set to
 * work, the horn; then the Hollow cleared, its way out opening with a burst,
 * and driven down with the keys into the dark, through the swap and out into
 * the South Gallery, where a hidden chamber is broken into and a brick wall
 * brought down; and a reload after each of the ways out opening and arriving.
 * The end of the run is its own test, in the last cave. Played through the
 * test API with the game paused and stepped a frame at a time, so it is the
 * same every run and waits on no clock — but everything that follows each of
 * those, the scene rebuilt, the rock reshaped, the bodies spawned, the
 * particles and the words on the screen, is the game's own.
 *
 * After every stage the game's invariants are checked, and at the end the
 * page must have logged no errors.
 */
import { expect, test, type Page } from '@playwright/test';
import { ARRIVAL_DARK, buildCave } from '../src/cave';
import { RUN } from '../src/caves';
import { runwayLights } from '../src/runway';
import { measuring, ready, screen, start, steerTo, swapped, watch } from './pushminer';

/** How many runway lights a cave stands, down each cutting, as the lights work it out and the page should show. */
function runwayOf(id: string, open: boolean) {
  const lights = runwayLights(buildCave(RUN.find((c) => c.id === id)!), open);
  return { in: lights.filter((l) => l.cutting === 'in').length, out: lights.filter((l) => l.cutting === 'out').length };
}

/** Play `frames` frames, and check nothing that must hold has broken. */
async function play(page: Page, frames: number, stage: string) {
  const broken = await page.evaluate((n) => {
    window.pushminer!.step(n);
    return window.pushminer!.invariants();
  }, frames);
  expect(broken, `invariants after ${stage}`).toEqual([]);
}

/** The belts the workshop is selling, by id: the shop opened with its key, read, and shut again. */
async function shopBelts(page: Page) {
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  const ids = await page.$$eval('#shop .rows:not(.cosmetics) button', (buttons) =>
    buttons.map((b) => (b as HTMLElement).dataset.id ?? ''),
  );
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  return ids.filter((id) => id.startsWith('belt:'));
}

test('the run: lamps, barrels, a drone, the horn, the way out, the swap, a chamber and a wall', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const problems = watch(page);
  await start(page, { seed: 1, paused: true });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());

  // a fresh start is at the dark outer end of the way in, with the runway lit down it and no way out to light
  await play(page, 2, 'a fresh start');
  const fresh = await page.evaluate(() => window.pushminer!.state());
  expect(fresh.runway.in, 'the way in’s runway is lit').toBeGreaterThan(0);
  expect(fresh.runway, 'and no runway down a way out that is shut').toEqual({ ...runwayOf('hollow', false), out: 0 });
  expect(fresh.darkness, 'a start no darker than the arrival').toBeLessThanOrEqual(ARRIVAL_DARK);

  // a lamp in the hollow, knocked over by driving onto it
  const lamp = 0;
  await page.evaluate(([x, y]) => window.pushminer!.teleport(x, y), [content.lamps[lamp].x, content.lamps[lamp].y]);
  await play(page, 2, 'a lamp');
  expect(await page.evaluate(() => window.pushminer!.state().lampsBroken), 'lamp knocked over').toContain(lamp);

  // a barrel in the hollow driven into: its fuse lit, then gone off
  const barrel = content.barrels[0];
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

  // the Spiderdozer, bought and stood on: it walks, the game is none the wiser, and it can be swapped back
  await page.evaluate(() => {
    window.pushminer!.deposit(1000);
    window.pushminer!.buy('body:spider');
  });
  expect(await page.evaluate(() => window.pushminer!.state().body), 'standing on legs').toBe('spider');
  await page.evaluate(() => window.pushminer!.drive(1, 0.2));
  await play(page, 120, 'the Spiderdozer walking');
  await page.evaluate(() => window.pushminer!.release());
  expect(await page.evaluate(() => window.pushminer!.buy('body:dozer')), 'back on tracks').toBe(true);
  expect(await page.evaluate(() => window.pushminer!.state().body)).toBe('dozer');
  await play(page, 30, 'back on tracks');

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

  // the workshop sells the belts of the cave the player is in, and the hollow has none
  expect(content.belts, 'the hollow has no belt').toEqual([]);
  expect(await shopBelts(page), 'no belt for sale in the hollow').toEqual([]);

  // the cave cleared: its way out opens, with a burst at its mouth, and the page says so
  const before = await page.evaluate(() => window.pushminer!.state());
  expect(before.open, 'the way out is shut').toBe(false);
  const shut = await screen(page);
  expect(shut.arrows, 'no arrow on the page, in any cave').toBe(0);
  expect(shut.map.visible, 'the map is up').toBe(true);
  expect(shut.map.exit, 'the way out is not on the map while it is shut').toBe(false);
  expect(shut.map.holes, 'the hole is on it').toBeGreaterThanOrEqual(1);
  await page.evaluate(() => window.pushminer!.openExit());
  await play(page, 10, 'the way out opening');
  const opened = await page.evaluate(() => window.pushminer!.state());
  expect(opened.open, 'the way out is open').toBe(true);
  expect(opened.runway, 'its runway lit as it opens').toEqual(runwayOf('hollow', true));
  expect(opened.runway.out, 'a runway down the way out').toBeGreaterThan(0);
  expect(await page.evaluate(() => window.pushminer!.events()), 'the way out opened').toContain('exitOpened');
  const words = await screen(page);
  expect(words.note, 'the note says so').toBe('the way out is open');
  expect(words.map.exit, 'the way out is on the map once it is open').toBe(true);
  expect(words.arrows, 'and no arrow').toBe(0);
  expect(words.progress).toContain('the way out is open');
  expect(words.fade, 'still light on the floor').toBe(0);
  await info.attach('the way out open', { body: await page.screenshot(), contentType: 'image/png' });

  // a reload keeps it open
  await page.evaluate(() => window.pushminer!.save());
  await page.reload();
  await ready(page);
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(2);
  });
  const reloaded = await page.evaluate(() => window.pushminer!.state());
  expect([reloaded.cave, reloaded.open], 'the way out is still open after a reload').toEqual(['hollow', true]);
  expect((await page.evaluate(() => window.pushminer!.content())).exit, 'and in the same place').toEqual(content.exit);
  expect(reloaded.runway, 'and its runway lit again').toEqual(runwayOf('hollow', true));

  // driven down with the controls, from wherever the machine stands in the hollow: dark by how far down the
  // cutting, black at the leaving line
  const { beyond } = content.exit!;
  const from = (await page.evaluate(() => window.pushminer!.state())).dozer;
  expect(Math.hypot(beyond.x - from.x, beyond.y - from.y), 'a good way to go, by the controls alone').toBeGreaterThan(
    40,
  );
  const dark: number[] = [];
  let speedBefore = 0;
  await steerTo(page, beyond, (s) => s.cave !== 'hollow', {
    frames: 60 * 60,
    seen: async (s) => {
      if (s.cave !== 'hollow') return;
      speedBefore = s.dozer.speed;
      dark.push(s.darkness);
      // the black layer is the darkness, in the frame just drawn, and the map goes dark with it
      const shown = await screen(page);
      expect(shown.fade, `the fade at darkness ${s.darkness}`).toBeCloseTo(s.darkness, 2);
      expect(shown.map.opacity, `the map at darkness ${s.darkness}`).toBeCloseTo(1 - s.darkness, 2);
      expect(shown.arrows).toBe(0);
    },
  });
  // after a reload the machine is where it comes in: dark at the outer end of the way in, and lightening along it
  const onFloor = dark.indexOf(0);
  expect(dark[0], 'dark where the machine comes in').toBeGreaterThan(ARRIVAL_DARK * 0.7);
  expect(onFloor, 'out into the light of the cave').toBeGreaterThan(0);
  for (let i = 1; i <= onFloor; i++) expect(dark[i], 'lighter the further in').toBeLessThanOrEqual(dark[i - 1]);
  const lastLight = dark.lastIndexOf(0);
  expect(lastLight, 'and light again all across the cave').toBeGreaterThan(onFloor);
  expect(dark.length - lastLight, 'then down the way out').toBeGreaterThan(10);
  expect(Math.max(...dark), 'nearly black at the leaving line').toBeGreaterThan(0.85);
  for (let i = lastLight + 1; i < dark.length; i++)
    expect(dark[i], 'darker the further down').toBeGreaterThanOrEqual(dark[i - 1]);
  // the next cave is built a frame after the black is drawn
  await swapped(page);
  const last = await page.evaluate(() => window.pushminer!.state());
  expect(last.cave, 'on into the next cave').toBe('south-gallery');
  expect(last.open, 'its way out is shut').toBe(false);
  expect(last.runway, 'the next cave’s way in is lit, and its way out dark').toEqual({
    ...runwayOf('south-gallery', false),
    out: 0,
  });
  expect(last.dozer.speed, 'at the speed it had').toBeGreaterThan(speedBefore * 0.8);
  expect(last.darkness, 'arrives in the dark').toBeGreaterThan(ARRIVAL_DARK * 0.7);
  expect((await screen(page)).fade, 'and the page is dark with it').toBeCloseTo(last.darkness, 2);
  expect((await screen(page)).map.opacity, 'and so is the map').toBeCloseTo(1 - last.darkness, 2);
  expect(await page.evaluate(() => window.pushminer!.invariants()), 'invariants on arriving').toEqual([]);

  // what the swap logged, and what it said on arriving
  const log = await page.evaluate(() => window.pushminer!.events());
  expect(log.some((e) => e.startsWith('caveLeft hollow '))).toBe(true);
  const swap = log.find((e) => e.startsWith('swap south-gallery '));
  expect(swap, 'the swap timed and logged').toBeDefined();
  expect(+swap!.split(' ')[2], 'the swap, in ms').toBeLessThan(1000);
  const arrived = await screen(page);
  // the map is of the new cave: its way out shut, its hole as far from the dozer as the cave says
  expect(arrived.map.visible, 'the map comes along into the next cave').toBe(true);
  expect(arrived.map.exit, 'the new cave’s way out is shut, so not on its map').toBe(false);
  const arrivedState = await page.evaluate(() => window.pushminer!.state());
  const arrivedHole = (await page.evaluate(() => window.pushminer!.content())).hole;
  const [mapHole] = arrivedState.minimap!.holes;
  if (mapHole.rim) expect(Math.max(Math.abs(mapHole.x), Math.abs(mapHole.y)), 'on the rim').toBeCloseTo(100, 3);
  else {
    // a little of give, since the map is drawn a few times a second and the machine is moving
    const far = Math.hypot(arrivedHole.x - arrivedState.dozer.x, arrivedHole.y - arrivedState.dozer.y);
    expect(Math.abs(Math.hypot(mapHole.x, mapHole.y) - far), 'as far off on the map as in the cave').toBeLessThan(4);
  }
  expect(arrived.note).toContain('South Gallery');
  expect(arrived.note).toContain('rubies and emeralds');
  expect(arrived.progress).toContain('South Gallery');
  await info.attach('arriving', { body: await page.screenshot(), contentType: 'image/png' });

  // on in, out of the dark, along the way in
  const now = await page.evaluate(() => window.pushminer!.content());
  const lightening: number[] = [];
  await steerTo(page, { x: now.hole.x, y: now.hole.y }, (s) => s.darkness === 0, {
    frames: 60 * 10,
    seen: (s) => void lightening.push(s.darkness),
  });
  for (let i = 1; i < lightening.length; i++) expect(lightening[i]).toBeLessThanOrEqual(lightening[i - 1]);
  // the map followed the dozer in, and is the same one the hole lies on
  const driven = (await page.evaluate(() => window.pushminer!.state())).minimap!;
  expect(driven.holes[0], 'the hole has come nearer on the map as the dozer drove at it').not.toEqual(mapHole);
  expect((await screen(page)).fade, 'light again on the floor').toBe(0);
  await info.attach('in the south gallery', { body: await page.screenshot(), contentType: 'image/png' });

  // and now the South Gallery's belt is for sale
  expect(now.belts.length, 'a belt in the South Gallery').toBeGreaterThan(0);
  expect(await shopBelts(page), 'the South Gallery’s belts for sale').toEqual(now.belts.map((b) => `belt:${b.id}`));

  // the cave's hidden chamber broken into, and its brick wall brought down, a hit short of it first
  const south = await page.evaluate(() => window.pushminer!.content());
  expect(south.chambers.length, 'a chamber in the South Gallery').toBeGreaterThan(0);
  const live = (await page.evaluate(() => window.pushminer!.state())).live;
  await page.evaluate(() => window.pushminer!.reveal(0));
  await play(page, 30, 'the chamber');
  const chamber = await page.evaluate(() => window.pushminer!.state());
  expect(chamber.secrets[0], 'the chamber open').toBe(true);
  expect(chamber.live, 'the chamber loot').toBeGreaterThan(live);
  expect(south.walls.length, 'a wall in the South Gallery').toBeGreaterThan(0);
  expect(await page.evaluate(() => window.pushminer!.hitWall(0, 1)), 'the wall hurt').toBeLessThan(1);
  await page.evaluate(() => window.pushminer!.hitWall(0, 1e6));
  await play(page, 90, 'the wall');
  expect(await page.evaluate(() => window.pushminer!.state().walls), 'the wall down').toContain(true);

  // a reload after arriving keeps the place: in the next cave
  await page.evaluate(() => window.pushminer!.save());
  await page.reload();
  await ready(page);
  const after = await page.evaluate(() => window.pushminer!.state());
  expect([after.cave, after.open]).toEqual(['south-gallery', false]);
  expect(after.live, 'coins in the cave').toBeGreaterThan(300);
  await page.evaluate(() => window.pushminer!.step(30));
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
  expect(problems).toEqual([]);
});

test('the North Vault’s two holes each bank what goes down them', async ({ page }) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { cave: 'north-vault' } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());
  expect(content.holes, 'two holes in the North Vault').toHaveLength(2);
  expect(content.hole, 'the first is the one the machine is told of').toEqual(content.holes[0]);
  // a coin off the heap set over each hole in turn, and let fall: banked, each time, and nothing breaks
  for (const [k, hole] of content.holes.entries()) {
    const before = await page.evaluate(() => window.pushminer!.state().bank);
    const slot = await page.evaluate(
      ([x, y]) => {
        const api = window.pushminer!;
        const coin = api.bodies('coin').find((b) => Math.hypot(b.x - x, b.y - y) > 30)!;
        api.place(coin.slot, x, y, 1.5);
        return coin.slot;
      },
      [hole.x, hole.y],
    );
    await play(page, 120, `a coin down hole ${k}`);
    expect(await page.evaluate(() => window.pushminer!.state().bank), `banked down hole ${k}`).toBe(before + 1);
    expect(slot).toBeGreaterThanOrEqual(0);
  }
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
  expect(problems).toEqual([]);
});

test('the Warrens, reached by a save, has two holes that each bank, no belt, and a West Gallery after it', async ({
  page,
}) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { cave: 'warrens' } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());
  expect(content.id).toBe('warrens');
  expect(content.holes, 'two holes in the Warrens').toHaveLength(2);
  expect(content.belts, 'no belt to buy in the Warrens').toEqual([]);
  expect(content.exit, 'a way out, to the West Gallery').not.toBeNull();
  for (const [k, hole] of content.holes.entries()) {
    const before = await page.evaluate(() => window.pushminer!.state().bank);
    const slot = await page.evaluate(
      ([x, y]) => {
        const api = window.pushminer!;
        const coin = api.bodies('coin').find((b) => Math.hypot(b.x - x, b.y - y) > 30)!;
        api.place(coin.slot, x, y, 1.5);
        return coin.slot;
      },
      [hole.x, hole.y],
    );
    await play(page, 120, `a coin down hole ${k}`);
    expect(await page.evaluate(() => window.pushminer!.state().bank), `banked down hole ${k}`).toBe(before + 1);
    expect(slot).toBeGreaterThanOrEqual(0);
  }
  // out through the way out, and into the West Gallery
  await page.evaluate(() => window.pushminer!.openExit());
  const { beyond, out } = content.exit!;
  await page.evaluate(
    ([x, y, yaw]) => window.pushminer!.teleport(x, y, yaw),
    [beyond.x, beyond.y, Math.atan2(out[1], out[0])],
  );
  await play(page, 3, 'out of the Warrens');
  await swapped(page);
  expect((await page.evaluate(() => window.pushminer!.state())).cave).toBe('west-gallery');
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
  expect(problems).toEqual([]);
});

test('a save in the West Gallery lands in the West Gallery, which has a way out to the Deep', async ({ page }) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { cave: 'west-gallery' } });
  expect((await page.evaluate(() => window.pushminer!.state())).cave).toBe('west-gallery');
  const exit = (await page.evaluate(() => window.pushminer!.content())).exit;
  expect(exit, 'a way out, since it is no longer the last cave').not.toBeNull();
  // out through it, and into the Deep
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.openExit();
  });
  await page.evaluate(
    ([x, y, yaw]) => window.pushminer!.teleport(x, y, yaw),
    [exit!.beyond.x, exit!.beyond.y, Math.atan2(exit!.out[1], exit!.out[0])],
  );
  await play(page, 3, 'out of the West Gallery');
  await swapped(page);
  const now = await page.evaluate(() => window.pushminer!.state());
  expect(now.cave).toBe('deep');
  const deep = await page.evaluate(() => window.pushminer!.content());
  expect(deep.holes, 'three holes in the Deep').toHaveLength(3);
  expect(deep.belts, 'two belts to buy in the Deep').toHaveLength(2);
  expect(deep.exit, 'the last cave, with no way out').toBeNull();
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
  expect(problems).toEqual([]);
});

test('a finished game in the West Gallery stays finished there, its vein running', async ({ page }) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { cave: 'west-gallery', done: true } });
  await page.evaluate(() => window.pushminer!.pause());
  const state = await page.evaluate(() => window.pushminer!.state());
  expect(state.cave).toBe('west-gallery');
  expect(state.done).toBe(true);
  expect(state.fountains, 'the floor cracks').toBe(1);
  await page.evaluate(() => window.pushminer!.openExit());
  await play(page, 30, 'a finished game in the West Gallery');
  const after = await page.evaluate(() => window.pushminer!.state());
  expect(after.cave).toBe('west-gallery');
  expect(after.open, 'not sent on').toBe(false);
  expect(problems).toEqual([]);
});

test('the East Gallery’s two belts are bought one at a time, by name, and both run', async ({ page }) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { cave: 'east-gallery', bank: 5000 } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());
  expect(content.belts.map((b) => b.id)).toEqual(['east-belt', 'east-belt-bottom']);
  // the workshop lists each by where it runs, and they are bought with its own buttons
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  const titles = await page.$$eval('#shop .rows:not(.cosmetics) button[data-id^="belt:"]', (buttons) =>
    buttons.map((b) => b.textContent),
  );
  expect(titles[0]).toContain('Conveyor, top of the ring');
  expect(titles[1]).toContain('Conveyor, bottom of the ring');
  expect(await page.evaluate(() => window.pushminer!.state().belts), 'none bought yet').toEqual([]);
  await page.locator('#shop button[data-id="belt:east-belt-bottom"]').click();
  await page.evaluate(() => window.pushminer!.step(1));
  expect(await page.evaluate(() => window.pushminer!.state().belts), 'the bottom one, alone').toEqual([
    'east-belt-bottom',
  ]);
  await page.locator('#shop button[data-id="belt:east-belt"]').click();
  await page.evaluate(() => window.pushminer!.step(1));
  expect(await page.evaluate(() => window.pushminer!.state().belts).then((b) => [...b].sort())).toEqual([
    'east-belt',
    'east-belt-bottom',
  ]);
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  // both run: a coin set on the middle of each belt is carried along it, toward the hole, each at the belt's pace
  const slots = await page.evaluate((belts) => {
    const api = window.pushminer!;
    const coins = api.bodies('coin').slice(0, belts.length);
    belts.forEach((b, k) =>
      api.place(coins[k].slot, b.from.x + (b.to.x - b.from.x) * 0.5, b.from.y + (b.to.y - b.from.y) * 0.5, 1.2),
    );
    return coins.map((c) => c.slot);
  }, content.belts);
  await play(page, 30, 'both belts carrying');
  const moved = await page.evaluate(
    ([slots, belts]) => {
      const bodies = window.pushminer!.bodies('coin');
      return slots.map((slot, k) => {
        const c = bodies.find((b) => b.slot === slot);
        const mid = { x: (belts[k].from.x + belts[k].to.x) / 2, y: (belts[k].from.y + belts[k].to.y) / 2 };
        // how far along the belt toward its end it has gone, or -1 if it is gone (down the hole already)
        const len = Math.hypot(belts[k].to.x - belts[k].from.x, belts[k].to.y - belts[k].from.y);
        return c
          ? ((c.x - mid.x) * (belts[k].to.x - belts[k].from.x) + (c.y - mid.y) * (belts[k].to.y - belts[k].from.y)) /
              len
          : -1;
      });
    },
    [slots, content.belts] as const,
  );
  moved.forEach((along, k) => expect(along, `the coin on belt ${k} carried along it`).not.toBeCloseTo(0, 0));
  await play(page, 60 * 14, 'the belts carrying on');
  expect(await page.evaluate(() => window.pushminer!.state().belts)).toHaveLength(2);
  // and a reload keeps which are bought
  await page.evaluate(() => window.pushminer!.save());
  await page.reload();
  await ready(page);
  expect(await page.evaluate(() => window.pushminer!.state().belts).then((b) => [...b].sort())).toEqual([
    'east-belt',
    'east-belt-bottom',
  ]);
  await page.evaluate(() => window.pushminer!.step(30));
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
  expect(problems).toEqual([]);
});

test('the end: the last cave, the Deep, cleared, and the vein runs', async ({ page }, info) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { cave: 'deep' } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());
  expect(content.exit, 'no way out of the last cave').toBeNull();
  await page.evaluate(() => window.pushminer!.openExit());
  await play(page, 120, 'the end');
  const end = await page.evaluate(() => window.pushminer!.state());
  expect(end.done, 'the game done').toBe(true);
  expect(end.open, 'no way out opened').toBe(false);
  expect(end.runway, 'the last cave has its way in lit and no way out').toEqual({ ...runwayOf('deep', true), out: 0 });
  expect(end.runway.in, 'a lit way in').toBeGreaterThan(0);
  expect(end.fountains, 'the vein').toBe(1);
  expect((await screen(page)).progress).toBe('the cave is cleared');
  await info.attach('done', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

/** The size of the gap between two headings in degrees, however many turns each has been round. */
const apart = (a: number, b: number) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
};

/**
 * Drive the machine out of the cave `id` with the keys, from a little way back from the mouth, on down the
 * cutting and through the leaving line, and measure which way it heads on the screen in the very call that
 * steps it over the line (the cave is still the old one then) and on the first frame after the swap, and a
 * dozen frames on. The words and the black are read as the machine goes, to be what the game says.
 */
async function blink(page: Page, id: string, turn: number) {
  const problems = watch(page);
  await start(page, { seed: 5, paused: true, save: { cave: id, open: true } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(5);
  });
  await measuring(page);
  const { mouth, beyond, out } = (await page.evaluate(() => window.pushminer!.content())).exit!;
  await page.evaluate(
    ([x, y, yaw]) => {
      window.pushminer!.teleport(x, y, yaw);
      // the camera follows once for each call that draws, and not each frame, so it is let catch up call by call
      for (let f = 0; f < 180; f++) window.pushminer!.step(1);
    },
    [mouth.x - out[0] * 24, mouth.y - out[1] * 24, Math.atan2(out[1], out[0])],
  );

  // down the cutting: lit, then the words come up with the dark
  const ramp: number[] = [];
  const cut = await steerTo(page, beyond, (s) => s.leaving, {
    frames: 60 * 30,
    seen: async (s) => {
      if (s.leaving) return;
      const shown = await screen(page);
      expect(shown.words, `the words at ${s.keepGoing}`).toBeCloseTo(s.keepGoing, 2);
      expect(shown.fade, `the black at ${s.darkness}`).toBeCloseTo(s.darkness, 2);
      if (s.darkness === 0) expect(s.keepGoing, 'no words while it is lit').toBe(0);
      if (s.keepGoing > 0) ramp.push(s.keepGoing);
    },
  });
  expect(ramp.length, 'words seen coming up').toBeGreaterThan(2);
  for (let i = 1; i < ramp.length; i++) expect(ramp[i], 'rising down the cutting').toBeGreaterThanOrEqual(ramp[i - 1]);
  expect(ramp[ramp.length - 1], 'full at the line').toBeGreaterThan(0.9);
  expect(cut.darkness, 'black at the cut').toBe(1);
  expect(cut.keepGoing, 'and the words full').toBe(1);
  expect(cut.heading).not.toBeNull();

  // the swap, then the first frame of the new cave
  await swapped(page);
  const first = await page.evaluate(() => {
    window.pushminer!.step(1);
    const opacity = (id: string) => +getComputedStyle(document.getElementById(id)!).opacity;
    return {
      s: window.pushminer!.state(),
      heading: window.screenHeading!(),
      words: opacity('keepGoing'),
      fade: opacity('fade'),
    };
  });
  expect(first.s.cave, 'into the next cave').not.toBe(id);

  // criterion 5: the same way on the screen, within 5 degrees; tilt and distance kept; the camera turned by the turn
  expect(
    apart(first.heading, cut.heading!),
    `${id}: heading ${cut.heading} before, ${first.heading} after`,
  ).toBeLessThan(5);
  expect(first.s.camera.polar, 'tilt kept').toBeCloseTo(cut.camera.polar, 6);
  expect(first.s.camera.distance, 'distance kept').toBeCloseTo(cut.camera.distance, 6);
  const turned = ((first.s.camera.azimuth - cut.camera.azimuth) * 180) / Math.PI - (turn * 180) / Math.PI;
  expect(apart(turned, 0), 'the camera turned by the change’s turn').toBeLessThan(0.01);

  // criterion 6: no swing over the frames after
  const later: number[] = [];
  const azimuths: number[] = [];
  for (let f = 0; f < 12; f++) {
    const now = await page.evaluate(() => {
      window.pushminer!.step(1);
      return { azimuth: window.pushminer!.state().camera.azimuth, heading: window.screenHeading!() };
    });
    later.push(now.heading);
    azimuths.push(now.azimuth);
  }
  for (const h of later) expect(apart(h, first.heading), `no swing: ${later.join(', ')}`).toBeLessThan(1);
  for (const a of azimuths) expect(apart(((a - first.s.camera.azimuth) * 180) / Math.PI, 0)).toBeLessThan(0.01);

  // criterion 3 and 4 in the page: up from black over 0.4 s, the words falling with it, and gone
  expect(first.s.darkness, 'nearly black on the first frame').toBeGreaterThan(0.9);
  expect(first.words, 'the words fading on the first frame').toBeGreaterThan(0.9);
  expect(first.fade, 'and the page as black').toBeCloseTo(first.s.darkness, 2);
  await page.evaluate(() => window.pushminer!.step(30));
  const up = await page.evaluate(() => window.pushminer!.state());
  const shown = await screen(page);
  expect(up.keepGoing, 'the words gone').toBe(0);
  expect(shown.words).toBe(0);
  expect(shown.fade, 'the black down to the arrival’s').toBeCloseTo(up.darkness, 2);
  expect(up.darkness, 'and no more than that').toBeLessThanOrEqual(0.45);
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
  expect(problems).toEqual([]);
  return { before: cut.heading!, after: first.heading };
}

test('the camera keeps the machine’s heading on the screen at a change that turns: South Gallery to East Gallery', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const seen = await blink(page, 'south-gallery', -Math.PI / 2);
  // up the screen going in, and up it going on: the dozer faces north out and east in, and the camera turned a quarter
  expect(seen.before, 'up the screen').toBeGreaterThan(80);
  expect(seen.before).toBeLessThan(100);
  info.annotations.push({
    type: 'heading, degrees',
    description: `before ${seen.before.toFixed(2)}, after ${seen.after.toFixed(2)}`,
  });
});

test('and at one that does not: Hollow to South Gallery', async ({ page }, info) => {
  test.setTimeout(120_000);
  const seen = await blink(page, 'hollow', 0);
  // right across the screen out, and right across it in
  expect(Math.abs(seen.before), 'across the screen').toBeLessThan(10);
  info.annotations.push({
    type: 'heading, degrees',
    description: `before ${seen.before.toFixed(2)}, after ${seen.after.toFixed(2)}`,
  });
});

test('the black is drawn, with the words in it, before the next cave is built', async ({ page }) => {
  const problems = watch(page);
  await start(page, { seed: 5, paused: true, save: { cave: 'hollow', open: true } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(5);
    window.pushminer!.step(5);
    window.pushminer!.events();
  });
  // over the line, and the frame of that step: read in the same call, before the page's frame loop has been round
  const between = await page.evaluate(() => {
    const api = window.pushminer!;
    const { beyond, out } = api.content().exit!;
    api.teleport(beyond.x, beyond.y, Math.atan2(out[1], out[0]));
    api.step(1);
    const opacity = (id: string) => +getComputedStyle(document.getElementById(id)!).opacity;
    return {
      log: api.events(),
      cave: api.state().cave,
      leaving: api.state().leaving,
      fade: opacity('fade'),
      words: opacity('keepGoing'),
    };
  });
  expect(between.log, 'told the black is on and has not swapped').toEqual([
    'caveLeft hollow ' + between.log[0].split(' ')[2],
    'blackout',
  ]);
  expect(between.leaving, 'waiting to build').toBe(true);
  expect(between.fade, 'the black layer full').toBe(1);
  expect(between.words, 'the words showing').toBe(1);
  // then the page's own frame builds it
  await swapped(page);
  const log = await page.evaluate(() => window.pushminer!.events());
  expect(
    log.findIndex((e) => e.startsWith('swap south-gallery ')),
    'the swap came after the blackout',
  ).toBeGreaterThanOrEqual(0);
  expect(problems).toEqual([]);
});
