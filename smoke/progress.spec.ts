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
import type { Row } from '../src/ledger';
import { runwayLights } from '../src/runway';
import { cardSays, ledgerSays, measuring, ready, screen, start, steerTo, swapped, watch } from './pushminer';

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

/**
 * The dozer put down at (x, y) facing north, and `n` coins laid in a block over its bucket's floor, from
 * what the cave has: the same every run, since the scene is seeded.
 */
async function layInMouth(page: Page, x: number, y: number, n: number) {
  await page.evaluate(
    ([x, y, n]) => {
      const api = window.pushminer!;
      api.teleport(x, y, Math.PI / 2);
      // the coins that are lying furthest from where the dozer is, so none is already in the mouth
      const coins = api
        .bodies('coin')
        .filter((b) => !b.carried)
        .sort((a, b) => Math.hypot(b.x - x, b.y - y) - Math.hypot(a.x - x, a.y - y))
        .slice(0, n);
      coins.forEach((c, k) => api.place(c.slot, x - 1.35 + (k % 4) * 0.9, y + 5.4 + Math.floor(k / 4) * 0.9, 0.6));
      api.step(2);
    },
    [x, y, n] as const,
  );
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

  // The scoop, bought and worked with the keyboard: Space raises the bucket with what is in it, Space again sets it
  // down a little further on, where more is gathered, Space raises the lot, and E tips it into the hole, which banks
  // it. Its keys are in the line of keys only once there is a scoop for them to work.
  await expect(page.locator('#helpScoop'), 'no keys listed for a scoop not yet bought').toBeHidden();
  const bought = await page.evaluate(() => {
    const p = window.pushminer!;
    p.deposit(5000);
    return p.buy('scoop');
  });
  expect(bought, 'the scoop bought').toBe(true);
  await expect(page.locator('#helpScoop'), 'Space and E are listed with the other keys').toBeVisible();
  await expect(page.locator('#helpScoop')).toContainText('tip');
  const scoop = () => page.evaluate(() => window.pushminer!.state().scoop);
  expect(await scoop(), 'the smallest size, in the blade’s place, down and empty').toMatchObject({
    size: 1,
    width: 9,
    up: false,
    held: 0,
  });
  const said = async (what: string) =>
    (await page.evaluate(() => window.pushminer!.events())).filter((e) => e.startsWith(what));
  await layInMouth(page, content.hole.x, content.hole.y - 24, 8);
  await said('');
  await page.keyboard.press('Space');
  await play(page, 2, 'the bucket going up');
  expect((await scoop()).held, 'Space raises it with what is in it').toBe(8);
  const carried = (await page.evaluate(() => window.pushminer!.bodies('coin'))).filter((b) => b.carried);
  expect(carried, 'and they are carried').toHaveLength(8);
  const mine = carried.map((b) => b.slot);
  expect(await said('scooped')).toEqual(['scooped 8']);
  await play(page, 40, 'the bucket up');
  expect(await scoop(), 'the bucket is up').toMatchObject({ up: true, lift: 1 });
  // a little way on with it, stopped, and set down
  await page.evaluate(() => window.pushminer!.drive(1, 0));
  await play(page, 20, 'carrying it');
  await page.evaluate(() => window.pushminer!.release());
  await play(page, 90, 'stopped');
  await page.keyboard.press('Space');
  await play(page, 40, 'the bucket coming down');
  expect(await scoop(), 'Space again lowers it, and what it held is set down').toMatchObject({
    up: false,
    lift: 0,
    held: 0,
  });
  expect(await said('set down')).toEqual(['set down 8']);
  const lying = async () => (await page.evaluate(() => window.pushminer!.bodies('coin'))).filter((b) => !b.carried);
  for (const slot of mine)
    expect(
      (await lying()).map((b) => b.slot),
      `coin ${slot} is on the floor again`,
    ).toContain(slot);
  // four more, just past the mouth: driven into, they are gathered in with the eight
  const more = await page.evaluate(() => {
    const api = window.pushminer!;
    const d = api.state().dozer;
    const coins = api
      .bodies('coin')
      .filter((b) => !b.carried)
      .sort((a, b) => Math.hypot(b.x - d.x, b.y - d.y) - Math.hypot(a.x - d.x, a.y - d.y))
      .slice(0, 4);
    coins.forEach((c, k) => api.place(c.slot, d.x + (k - 1.5) * 0.9, d.y + 10, 0.6));
    return coins.map((c) => c.slot);
  });
  await page.evaluate(() => window.pushminer!.drive(1, 0));
  await play(page, 45, 'gathering more');
  await page.evaluate(() => window.pushminer!.release());
  await play(page, 90, 'stopped again');
  await page.keyboard.press('Space');
  await play(page, 40, 'the bucket up with the lot');
  const lot = (await page.evaluate(() => window.pushminer!.bodies('coin'))).filter((b) => b.carried).map((b) => b.slot);
  expect(lot, 'the eight came along and are lifted again').toEqual(expect.arrayContaining(mine));
  expect(lot.filter((slot) => more.includes(slot)).length, 'with what was gathered since').toBeGreaterThanOrEqual(3);
  expect(await said('scooped')).toEqual([`scooped ${lot.length}`]);
  // driven up to the hole's lip with it, and stopped
  await page.evaluate(() => window.pushminer!.drive(1, 0));
  for (let f = 0; f < 600; f += 5) {
    await play(page, 5, 'carrying it to the hole');
    const s = await page.evaluate(() => window.pushminer!.state());
    if (Math.hypot(s.dozer.x - content.hole.x, s.dozer.y - content.hole.y) < content.hole.radius + 5.7) break;
  }
  await page.evaluate(() => window.pushminer!.release());
  await play(page, 90, 'stopped at the hole');
  const atLip = await page.evaluate(() => window.pushminer!.state());
  expect(atLip.scoop.held, 'still holding all of it').toBe(lot.length);
  // the drone bought earlier is banking coins of its own, so it is these coins that are watched, not the bank
  // (and by the haul and not the bank, since half of each coin banked in a cave is its toll's)
  const bankAtLip = atLip.banked;
  await page.keyboard.press('e');
  await play(page, 240, 'tipped into the hole');
  const tipped = await page.evaluate(() => window.pushminer!.state());
  expect(tipped.scoop, 'E tips it out, and the bucket comes down').toMatchObject({ held: 0, up: false, lift: 0 });
  const left = (await page.evaluate(() => window.pushminer!.bodies('coin'))).map((b) => b.slot);
  for (const slot of lot) expect(left, `coin ${slot} banked`).not.toContain(slot);
  expect(tipped.banked - bankAtLip, 'banked, by at least the load').toBeGreaterThanOrEqual(lot.length);
  expect(await said('tipped')).toEqual([`tipped ${lot.length}`]);

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
  expect(arrived.note, 'what was left behind is the card’s to say, and not the note’s').not.toContain('left behind');
  await info.attach('arriving', { body: await page.screenshot(), contentType: 'image/png' });

  // the card of the cave just left, under the note: its words are the figures the ledger gave for the Hollow, said
  // here from the numbers and not from the page's own way of saying them
  const ledger = await page.evaluate(() => window.pushminer!.state().ledger);
  expect(
    ledger.rows.map((r) => r.cave),
    'a row for the cave left, and only it',
  ).toEqual(['hollow']);
  const [hollow] = ledger.rows;
  expect(hollow.taken, 'the cave gave something up').toBeGreaterThan(0);
  expect(hollow.taken + hollow.drained + hollow.left, 'its parts add up to what it held').toBe(hollow.held);
  const figure = (n: number) => n.toLocaleString('en-US');
  const card = await cardSays(page);
  expect(card.shown, 'the card is up').toBe(true);
  expect(card.name).toBe('The Hollow');
  expect(card.figures).toBe(
    `${figure(hollow.taken)} brought out · ${figure(hollow.drained)} drained · ${figure(hollow.left)} left behind`,
  );
  expect(card.label, 'the bar says the same to whoever cannot see its colours').toBe(card.figures);
  expect(card.marks.map((m) => m.text)).toEqual(
    (
      [
        ['clean', hollow.marks.clean],
        ['every heap', hollow.marks.everyHeap],
        ['every find', hollow.marks.everyFind],
      ] as const
    ).map(([word, won]) => `${won ? '◆' : '◇'} ${word}`),
  );
  expect(
    card.marks.map((m) => m.won),
    'won ones are drawn as won',
  ).toEqual(Object.values(hollow.marks));
  expect(card.out, 'gold, by what was brought out').toBeCloseTo((hollow.taken / hollow.held) * 100, 1);
  expect(card.drained, 'blue, by what drained').toBeCloseTo((hollow.drained / hollow.held) * 100, 1);
  expect(card.note, 'the note is up with it').not.toBeNull();
  expect(card.card.top, 'under the note').toBeGreaterThanOrEqual(card.note!.bottom);
  expect(card.card.bottom, 'and on the screen').toBeLessThanOrEqual(800);
  await info.attach('the card', { body: await page.screenshot(), contentType: 'image/png' });

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

  // the card has had its six seconds, and goes with the note
  await play(page, 6 * 60, 'the card’s six seconds');
  expect((await cardSays(page)).shown, 'the card is gone with the note').toBe(false);
  expect((await screen(page)).note, 'and the note').toBeNull();

  // the workshop's foot carries the progress line and then the run's: what the ledger has brought out of what the mine holds
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  const ledgerNow = await page.evaluate(() => window.pushminer!.state().ledger);
  expect(ledgerNow.line).toBe(`brought out ${figure(hollow.taken + ledgerNow.now.taken)} of 68,850`);
  const foot = (await page.locator('#shopProgress').textContent())!;
  expect(foot, 'the progress line, then the run’s').toMatch(/^South Gallery: .+ · brought out [\d,]+ of 68,850$/);
  expect(foot.endsWith(ledgerNow.line), 'and the run’s is the ledger’s').toBe(true);
  // the ledger's button opens the panel, beside the workshop, and its rows are read as words
  await expect(page.locator('#ledger')).toBeHidden();
  await page.locator('#ledgerButton').click();
  const open = await ledgerSays(page);
  expect(open.shown, 'the ledger is open').toBe(true);
  expect(open.rows.map((r) => [r.name, r.now])).toEqual([
    ['The Hollow', false],
    ['South Gallery', true],
  ]);
  expect(open.rows[0].said).toBe(
    `${figure(hollow.taken)} of ${figure(hollow.held)} · ${figure(hollow.drained)} drained · ${figure(hollow.left)} left behind`,
  );
  expect(open.rows[0].marks).toEqual(card.marks.map((m) => m.text));
  expect(open.rows[1].said, 'the cave being played is “so far”').toBe(
    `${figure(ledgerNow.now.taken)} of ${figure(ledgerNow.now.held)} so far · ${figure(ledgerNow.now.drained)} drained`,
  );
  expect(open.rows[1].marks, 'and has no marks yet').toEqual([]);
  expect(open.total).toBe(`The mine: ${ledgerNow.line}`);
  await expect(page.locator('#shop'), 'the workshop stays open under it').toBeVisible();
  await info.attach('the ledger', { body: await page.screenshot(), contentType: 'image/png' });
  // shut by its own close button, opened again by the button, and shut by the workshop's own key, which shuts that too
  await page.locator('#ledgerClose').click();
  await expect(page.locator('#ledger')).toBeHidden();
  await page.locator('#ledgerButton').click();
  await expect(page.locator('#ledger')).toBeVisible();
  await page.locator('#ledgerButton').click();
  await expect(page.locator('#ledger'), 'the button that opened it shuts it').toBeHidden();
  await page.locator('#ledgerButton').click();
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  await expect(page.locator('#shop')).toBeHidden();
  await expect(page.locator('#ledger'), 'the workshop’s key shuts the workshop and the ledger with it').toBeHidden();
  // and opening the workshop shuts it, from the test API's hand as from the button's
  await page.evaluate(() => window.pushminer!.ledger(true));
  await expect(page.locator('#ledger'), 'open by itself, with the workshop shut').toBeVisible();
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  await expect(page.locator('#shop')).toBeVisible();
  await expect(page.locator('#ledger'), 'opening the workshop shuts it').toBeHidden();
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));

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
  // The scoop is still fitted, from where it was bought, and a bucket only dents brick: rammed flat out, the wall takes
  // nothing more, the machine says so, and the note says what to do. The blade fitted from the workshop's row, the same
  // run at it brings the wall down. The wall runs along y = -40 from x = 52 to 64, and is run at from the south.
  const ram = async (what: string) => {
    await page.evaluate(() => window.pushminer!.teleport(60, -54, Math.PI / 2));
    await page.evaluate(() => window.pushminer!.drive(1, 0));
    await play(page, 90, what);
    await page.evaluate(() => window.pushminer!.release());
  };
  const damage = () => page.evaluate(() => window.pushminer!.state().wallDamage[0]);
  const hurt = await damage();
  expect(await page.evaluate(() => window.pushminer!.state().fitted), 'the scoop is what is fitted').toBe('scoop');
  await page.evaluate(() => window.pushminer!.events());
  await ram('ramming the wall with the scoop');
  expect(await damage(), 'a bucket does the wall no more harm').toBe(hurt);
  expect(await page.evaluate(() => window.pushminer!.state().walls), 'and it stands').not.toContain(true);
  expect(await said('glanced'), 'the machine glanced off it').toContain('glanced wall');
  await expect(page.locator('#cameraNote'), 'and the note says why, and what to do').toContainText(
    'a bucket only dents it · fit the blade (B)',
  );
  // the blade fitted from the workshop, by its row: the scoop's keys go from the line of keys, and the bucket is empty
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  const fit = page.locator('#shop .rows:not(.cosmetics) button[data-id="fit:blade"]');
  await expect(fit, 'its row says it can be fitted').toContainText('fit');
  await expect(fit).not.toContainText('fitted');
  await fit.click();
  await expect(fit, 'and then that it is').toContainText('fitted');
  expect(await page.evaluate(() => window.pushminer!.state().fitted)).toBe('blade');
  await expect(page.locator('#helpScoop'), 'Space and E are gone from the line of keys').toBeHidden();
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  await ram('ramming the wall with the blade');
  expect(await damage(), 'the blade hurts it').toBeGreaterThan(hurt);
  for (let run = 0; run < 8 && !(await page.evaluate(() => window.pushminer!.state().walls[0])); run++)
    await ram('ramming the wall again');
  expect(await page.evaluate(() => window.pushminer!.state().walls), 'the wall down').toContain(true);
  expect(await said('wallDown')).toEqual(['wallDown 0']);
  // the scoop back for what follows: its keys are listed again
  await page.evaluate(() => window.pushminer!.buy('fit:scoop'));
  await expect(page.locator('#helpScoop')).toBeVisible();

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

test('a geode in the Hollow cracked by a barrel put beside it and lit: gems thrown out, and paid for at the hole', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  await start(page, { seed: 1, paused: true });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());
  expect(content.geodes.length, 'the Hollow has a geode').toBeGreaterThan(0);
  await play(page, 2, 'a fresh start');
  const before = await page.evaluate(() => window.pushminer!.state());
  expect(before.geodes, 'the geodes standing, and no gems out yet').toEqual({ count: content.geodes.length, gems: 0 });
  expect(await page.evaluate(() => window.pushminer!.bodies('geode')).then((b) => b.length)).toBe(
    content.geodes.length,
  );

  // a barrel put beside the first geode and lit: it goes off and the geode cracks
  const geode = content.geodes[0];
  await page.evaluate(
    ([x, y]) => {
      const p = window.pushminer!;
      const barrel = p.bodies('barrel')[0];
      p.place(barrel.slot, x + 3, y, 1.1);
      p.lightBarrel(barrel.slot, 0.5);
    },
    [geode.x, geode.y],
  );
  await play(page, 90, 'a barrel going off by a geode');
  const events = await page.evaluate(() => window.pushminer!.events());
  expect(
    events.filter((e) => e.startsWith('geodeCracked')),
    'the geode cracked',
  ).not.toHaveLength(0);
  const after = await page.evaluate(() => window.pushminer!.state());
  expect(after.geodes.count, 'one geode fewer at least').toBeLessThan(before.geodes.count);
  expect(after.geodes.gems, 'its gems out').toBeGreaterThan(0);
  expect((await screen(page)).note ?? '', 'and the words say so').toContain('geode');
  const gems = await page.evaluate(() => window.pushminer!.bodies().filter((b) => b.source !== null && b.source > 0));
  expect(gems.length, 'gems on the floor').toBe(after.geodes.gems);
  expect(gems.every((g) => g.kind !== 'coin' && g.kind !== 'geode')).toBe(true);

  // pushed down the hole, they pay: the bank rises by what they are worth, and the cave is no nearer cleared
  const worth = { ruby: 10, emerald: 25, sapphire: 40, diamond: 100, 'gold bar': 250 } as Record<string, number>;
  // by the haul, and not the bank: half of what is banked in the cave goes to its toll, a bonus like any other
  const bankBefore = after.banked;
  await page.evaluate(
    (slots) => {
      const p = window.pushminer!;
      slots.forEach((slot, n) => p.place(slot, (n % 4) * 0.4, Math.floor(n / 4) * 0.4, 1.5));
    },
    gems.map((g) => g.slot),
  );
  await play(page, 240, 'the gems down the hole');
  const paid = await page.evaluate(() => window.pushminer!.state());
  expect(paid.banked - bankBefore, 'paid for what went down').toBe(gems.reduce((sum, g) => sum + worth[g.kind], 0));
  expect(paid.toll.paid, 'the toll took about half').toBeGreaterThan(0);
  expect(paid.toll.paid + paid.bank, 'and the bank the rest').toBe(paid.banked);
  expect(paid.geodes.gems, 'none left lying').toBe(0);
  expect(paid.open, 'a bonus does not open the way out').toBe(false);
  expect(problems).toEqual([]);
});

test('the Hollow’s toll, from a fresh save: half of each coin fills it, the bank has the other half, and paying it opens the way out', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watch(page);
  // a fresh game: no save, so nothing is paid, and the toll is owed in full
  await start(page, { seed: 3, paused: true });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(3);
  });
  const hole = (await page.evaluate(() => window.pushminer!.content())).hole;
  /** `n` coins from the heaps set down at the hole, a ring of them, and let fall. */
  const send = (n: number) =>
    page.evaluate(
      ([n, x, y]) => {
        const api = window.pushminer!;
        const coins = api.bodies('coin').filter((b) => !b.carried && Math.hypot(b.x - x, b.y - y) > 8);
        if (coins.length < n) throw new Error(`only ${coins.length} coins left to send`);
        coins.slice(0, n).forEach((c, k) => {
          const a = k * 2.399,
            r = 0.4 + (k % 7) * 0.25;
          api.place(c.slot, x + Math.cos(a) * r, y + Math.sin(a) * r, 2 + (k % 5) * 0.1);
        });
        api.step(300);
      },
      [n, hole.x, hole.y] as const,
    );
  const read = () => page.evaluate(() => window.pushminer!.state());

  await page.evaluate(() => window.pushminer!.step(2));
  /** `n` coins banked, in batches that fit round the hole. */
  const bank = async (n: number) => {
    for (let left = n; left > 0; left -= 400) await send(Math.min(400, left));
  };
  const fresh = await read();
  expect(fresh.toll, 'owed in full to begin with').toEqual({ paid: 0, of: 1000 });
  expect((await screen(page)).progress, 'the line says what is owed').toBe('The Hollow: toll 0 of 1,000');

  await bank(640);
  const part = await read();
  expect(part.toll, 'half of each coin went to the toll').toEqual({ paid: 320, of: 1000 });
  expect(part.bank, 'and half is the bank’s').toBe(320);
  expect(part.banked, 'every coin banked').toBe(640);
  expect(part.open).toBe(false);
  expect((await screen(page)).progress, 'the line fills').toBe('The Hollow: toll 320 of 1,000');
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);

  await bank(1358);
  const nearly = await read();
  expect([nearly.toll.paid, nearly.bank, nearly.open], 'of 1,998, half and half').toEqual([999, 999, false]);
  expect((await screen(page)).progress).toBe('The Hollow: toll 999 of 1,000');
  await page.evaluate(() => window.pushminer!.events());

  // the coin that pays it opens the way out, and the page says so
  await send(1);
  const paid = await read();
  expect(paid.toll, 'paid').toEqual({ paid: 1000, of: 1000 });
  expect(paid.bank, 'and the bank has had its half').toBe(999);
  expect(paid.open, 'the way out is open').toBe(true);
  const heard = await page.evaluate(() => window.pushminer!.events());
  expect(
    heard.filter((e) => e === 'tollPaid'),
    'told once',
  ).toHaveLength(1);
  expect(heard).toContain('exitOpened');
  const words = await screen(page);
  expect(words.progress, 'the line is as it is for any open cave').toContain('the way out is open');
  expect(words.progress).not.toContain('toll');

  // and the next coin is the player’s
  await send(1);
  const after = await read();
  expect([after.toll.paid, after.bank, after.banked], 'of 2,000, a thousand each').toEqual([1000, 1000, 2000]);
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
  // the whole ledger opens by itself once, after the note that the cave is cleared has had its six seconds, and not before
  await expect(page.locator('#ledger'), 'not while the note is up').toBeHidden();
  await play(page, 6 * 60, 'the note’s six seconds');
  const closing = await ledgerSays(page);
  expect(closing.shown, 'open by itself once the note has gone').toBe(true);
  const { now } = await page.evaluate(() => window.pushminer!.state().ledger);
  expect(now.vein, 'the last cave, done, with the vein running').toBe(true);
  expect(closing.rows).toEqual([
    {
      name: 'The Deep',
      said: `${now.taken.toLocaleString('en-US')} of ${now.held.toLocaleString('en-US')} · the vein runs on · ${now.drained.toLocaleString('en-US')} drained`,
      marks: [],
      now: true,
    },
  ]);
  await info.attach('the ledger at the end', { body: await page.screenshot(), contentType: 'image/png' });
  // shut, it stays shut, and a reload of a game that is done does not open it again
  await page.locator('#ledgerClose').click();
  await play(page, 6 * 60, 'a while on');
  await expect(page.locator('#ledger')).toBeHidden();
  await page.evaluate(() => window.pushminer!.save());
  await page.reload();
  await ready(page);
  await page.evaluate(() => window.pushminer!.step(6 * 60 + 5));
  await expect(page.locator('#ledger'), 'once, and not again after a reload').toBeHidden();
  expect(problems).toEqual([]);
});

/** A coin of the cave moved to a point on a current, `along` from its head, and woken: its slot. */
async function coinOnCurrent(page: Page, current: number, along: number): Promise<number> {
  return page.evaluate(
    ([k, d]) => {
      const api = window.pushminer!;
      const c = api.content().currents[k];
      const len = Math.hypot(c.to.x - c.from.x, c.to.y - c.from.y);
      const coin = api.bodies('coin')[0];
      api.place(coin.slot, c.from.x + ((c.to.x - c.from.x) / len) * d, c.from.y + ((c.to.y - c.from.y) / len) * d, 1.2);
      return coin.slot;
    },
    [current, along] as const,
  );
}

test('a coin at the head of a current to a hole is banked, in the Hollow, with nothing lost', async ({ page }) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { cave: 'hollow' } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());
  expect(
    content.currents.map((c) => [c.flow, c.drain]),
    'a brook to the hole in the Hollow',
  ).toEqual([['water', false]]);
  expect(content.drains, 'and no drain').toEqual([]);
  // the brook is drawn flowing by the game's own clock: stepped, it has moved on by exactly the game's time, and a
  // game that stands still draws it standing still
  await play(page, 12, 'the brook flowing');
  const clocks = () => page.evaluate(() => [window.pushminer!.state().t, window.pushminer!.flowClock()]);
  const [t, drawn] = await clocks();
  expect(t).toBeGreaterThan(0);
  expect(drawn, 'the picture is at the game’s time').toBe(t);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await clocks(), 'two frames on with the game stopped, nothing has flowed').toEqual([t, drawn]);
  const before = await page.evaluate(() => window.pushminer!.state());
  await coinOnCurrent(page, 0, 2);
  for (let f = 0; f < 60 * 20; f += 20) {
    await play(page, 20, 'a coin on a current to a hole');
    if ((await page.evaluate(() => window.pushminer!.state().bank)) > before.bank) break;
  }
  const after = await page.evaluate(() => window.pushminer!.state());
  expect(after.bank, 'the coin banked').toBe(before.bank + 1);
  expect(after.drained, 'nothing lost').toBe(0);
  expect(problems).toEqual([]);
});

test('a coin on a current to a drain is lost, in the South Gallery: the bank as it was, a note, and both on the map', async ({
  page,
}, info) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { cave: 'south-gallery' } });
  await page.evaluate(() => {
    window.pushminer!.pause();
    window.pushminer!.seed(1);
  });
  const content = await page.evaluate(() => window.pushminer!.content());
  expect(content.currents.map((c) => [c.flow, c.drain])).toEqual([['water', true]]);
  expect(content.drains, 'a drain, which is not a hole').toHaveLength(1);
  expect(content.holes, 'one hole, as it was').toHaveLength(1);
  // the machine beside the drain, so that the map has both in its window
  const { drains } = content;
  await page.evaluate(([x, y]) => window.pushminer!.teleport(x - 12, y, 0), [drains[0].x, drains[0].y]);
  const before = await page.evaluate(() => window.pushminer!.state());
  await coinOnCurrent(page, 0, 2);
  await page.evaluate(() => window.pushminer!.events());
  for (let f = 0; f < 60 * 20; f += 20) {
    await play(page, 20, 'a coin on a current to a drain');
    if ((await page.evaluate(() => window.pushminer!.state().drained)) > 0) break;
  }
  const after = await page.evaluate(() => window.pushminer!.state());
  expect(after.drained, 'the coin lost').toBe(1);
  expect(after.bank, 'the bank unchanged').toBe(before.bank);
  expect(after.live, 'and gone from the cave').toBe(before.live - 1);
  expect(await page.evaluate(() => window.pushminer!.events())).toContain('drained 0 1');
  expect((await screen(page)).note, 'the page says what was lost').toBe('1 lost down the drain');
  await play(page, 30, 'the map');
  const map = (await page.evaluate(() => window.pushminer!.state())).minimap!;
  expect(
    map.currents.map((c) => c.flow),
    'the current on the map',
  ).toEqual(['water']);
  expect(map.drains, 'the drain on it, and not as a hole').toHaveLength(1);
  expect(map.holes.length, 'the hole too, which is a different mark').toBeLessThanOrEqual(1);
  await info.attach('a drain', { body: await page.screenshot(), contentType: 'image/png' });
  // saved and reloaded: what was lost is remembered
  await page.evaluate(() => window.pushminer!.save());
  await page.reload();
  await ready(page);
  expect((await page.evaluate(() => window.pushminer!.state())).drained, 'lost, and still lost').toBe(1);
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
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

test.describe('the toll on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });

  test('is on the line the phone shows, in the workshop’s foot, whole and on the screen, while its balance is nothing but what it has been given', async ({
    page,
  }) => {
    const problems = watch(page);
    await start(page, { seed: 1, paused: true });
    await page.evaluate(() => {
      window.pushminer!.pause();
      window.pushminer!.step(2);
    });
    // the counters at the top are not shown on a phone: the cave gets the screen, and the workshop is where the line is read
    await expect(page.locator('#bank'), 'no counters on a phone').toBeHidden();
    await page.locator('#shopButton').tap();
    await page.evaluate(() => window.pushminer!.step(2));
    const line = page.locator('#shopProgress');
    await expect(line, 'the toll, in words').toHaveText('The Hollow: toll 0 of 1,000 · brought out 0 of 68,850');
    await expect(line).toBeVisible();
    const box = (await line.boundingBox())!;
    expect(box.x, 'on the screen at the left').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'and not past the right').toBeLessThanOrEqual(400);
    await expect(page.locator('#shopBalance'), 'nothing banked yet').toHaveText('0');
    expect(problems).toEqual([]);
  });
});

/** A row of the ledger as the game writes it, for a save written by hand: what a cave held, took and drained, the rest left. */
function rowFor(cave: string, held: number, taken: number, drained: number, won: [boolean, boolean, boolean]): Row {
  return {
    cave,
    held,
    taken,
    toll: Math.floor(taken / 2),
    drained,
    left: held - taken - drained,
    finds: { chamber: 'none', sideRoom: 'none', wall: 'none', geodes: { cracked: 0, of: 0 } },
    marks: { clean: won[0], everyHeap: won[1], everyFind: won[2] },
  };
}

/** The six caves a run leaves, as a player who left each in turn would have them in the ledger. */
const SIX_ROWS: Row[] = [
  rowFor('hollow', 2620, 2580, 0, [true, false, true]),
  rowFor('south-gallery', 5755, 4310, 120, [false, true, false]),
  rowFor('east-gallery', 7990, 5200, 0, [true, false, false]),
  rowFor('north-vault', 9840, 8000, 40, [false, true, true]),
  rowFor('warrens', 8650, 6100, 310, [false, false, false]),
  rowFor('west-gallery', 12195, 12195, 0, [true, true, true]),
];

test.describe('the ledger on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });

  test('is opened from the workshop’s foot, whole and on the screen with all six caves and the one being played', async ({
    page,
  }, info) => {
    const problems = watch(page);
    await start(page, { seed: 1, paused: true, save: { cave: 'deep', ledger: SIX_ROWS, taken: 1900, drained: 60 } });
    await page.evaluate(() => window.pushminer!.pause());
    await page.locator('#shopButton').tap();
    await page.evaluate(() => window.pushminer!.step(2));
    // the foot's button is where a finger gets it: after the workshop is scrolled to it, what is on top of it is itself
    const button = page.locator('#ledgerButton');
    await button.scrollIntoViewIfNeeded();
    expect(await touchable(page, '#ledgerButton'), 'the ledger button in the foot').toEqual([]);
    expect(await touchable(page, '#reset'), 'and its neighbour').toEqual([]);
    const foot = await page.locator('#shopProgress').boundingBox();
    expect(foot!.x + foot!.width, 'the foot’s line is not past the right').toBeLessThanOrEqual(400);
    const taken = SIX_ROWS.reduce((n, r) => n + r.taken, 0) + 1900;
    const figure = (n: number) => n.toLocaleString('en-US');
    await expect(page.locator('#shopProgress')).toContainText(`brought out ${figure(taken)} of 68,850`);
    await button.tap();
    await page.evaluate(() => window.pushminer!.step(2));
    const says = await ledgerSays(page);
    expect(says.shown, 'the ledger stands where the workshop does').toBe(true);
    expect(says.rows.map((r) => r.name)).toEqual([
      'The Hollow',
      'South Gallery',
      'East Gallery',
      'North Vault',
      'The Warrens',
      'West Gallery',
      'The Deep',
    ]);
    expect(says.rows.map((r) => r.now)).toEqual([false, false, false, false, false, false, true]);
    SIX_ROWS.forEach((r, k) =>
      expect(says.rows[k].said).toBe(
        `${figure(r.taken)} of ${figure(r.held)} · ${figure(r.drained)} drained · ${figure(r.left)} left behind`,
      ),
    );
    expect(says.rows[6].said, 'the cave being played').toBe('1,900 of 21,800 so far · 60 drained');
    expect(says.rows[0].marks).toEqual(['◆ clean', '◇ every heap', '◆ every find']);
    expect(says.total).toBe(`The mine: brought out ${figure(taken)} of 68,850`);
    // every figure is on the screen, and nothing runs off the side
    const fits = await page.evaluate(() => {
      const panel = document.getElementById('ledger')!;
      const box = panel.getBoundingClientRect();
      const out: string[] = [];
      if (box.left < 0 || box.right > innerWidth) out.push(`the panel is across ${box.left} to ${box.right}`);
      if (box.top < 0 || box.bottom > innerHeight) out.push(`the panel is down ${box.top} to ${box.bottom}`);
      if (panel.scrollWidth > panel.clientWidth) out.push('the panel scrolls sideways');
      if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
      for (const el of Array.from(panel.querySelectorAll('.row span, .row small, .mark, .total'))) {
        const r = el.getBoundingClientRect();
        if (r.left < box.left - 0.5 || r.right > box.right + 0.5)
          out.push(`${el.textContent} is across ${r.left} to ${r.right}`);
        if (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5) out.push(`${el.textContent} is cut off`);
      }
      return out;
    });
    expect(fits, 'every figure on the screen, and no sideways scroll').toEqual([]);
    expect(await touchable(page, '#ledgerClose'), 'its own close button, where a finger gets it').toEqual([]);
    await expect(page.locator('#muteButton'), 'the options step aside, as they do for the workshop').toBeHidden();
    await info.attach('the ledger on a phone', { body: await page.screenshot(), contentType: 'image/png' });
    await page.locator('#ledgerClose').tap();
    await expect(page.locator('#ledger')).toBeHidden();
    await expect(page.locator('#shop'), 'the workshop is as it was under it').toBeVisible();
    await button.tap();
    await expect(page.locator('#ledger')).toBeVisible();
    // the shop's own button shuts the workshop, and the ledger with it
    await page.locator('#shopButton').tap();
    await page.evaluate(() => window.pushminer!.step(2));
    await expect(page.locator('#shop')).toBeHidden();
    await expect(page.locator('#ledger'), 'the workshop shut, and the ledger with it').toBeHidden();
    expect(problems).toEqual([]);
  });

  test('has its card on leaving a cave under the note and clear of the map, the options and the screen’s edge', async ({
    page,
  }) => {
    const problems = watch(page);
    await start(page, { seed: 11, paused: true, save: { cave: 'hollow', open: true } });
    await page.evaluate(() => {
      const api = window.pushminer!;
      api.pause();
      api.step(30);
      const { beyond, out } = api.content().exit!;
      api.teleport(beyond.x, beyond.y, Math.atan2(out[1], out[0]));
      api.step(2);
    });
    await swapped(page);
    await page.evaluate(() => window.pushminer!.step(26));
    const card = await cardSays(page);
    expect(card.shown, 'the card is up').toBe(true);
    const boxes = await page.evaluate(() => {
      const box = (id: string) => {
        const r = document.getElementById(id)!.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return { map: box('minimap'), options: box('options'), pad: box('pad') };
    });
    expect(card.card.left, 'on the screen at the left').toBeGreaterThanOrEqual(0);
    expect(card.card.right, 'and before the map begins').toBeLessThan(boxes.map.left);
    expect(card.card.top, 'under the note').toBeGreaterThanOrEqual(card.note!.bottom);
    expect(card.card.top, 'and under the options').toBeGreaterThanOrEqual(boxes.options.bottom);
    expect(card.card.bottom, 'and above the controls').toBeLessThan(boxes.pad.top);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(
      true,
    );
    expect(card.name).toBe('The Hollow');
    expect(card.figures).toContain('brought out');
    expect(problems).toEqual([]);
  });
});

test.describe('the scoop on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });

  test('has its button on the pad once bought: tapped, the bucket goes up and down, and a tip button is there beside it while it is up', async ({
    page,
  }) => {
    const problems = watch(page);
    // with the horn too, which is the fullest the pad gets
    await start(page, { seed: 1, paused: true, save: { horn: true } });
    await page.evaluate(() => window.pushminer!.pause());
    const button = page.locator('#scoopButton'),
      tip = page.locator('#tipButton'),
      horn = page.locator('#hornButton');
    await expect(button, 'no button before there is a scoop').toBeHidden();
    await expect(tip).toBeHidden();
    await page.evaluate(() => {
      window.pushminer!.deposit(5000);
      window.pushminer!.buy('scoop');
    });
    await expect(button, 'the button once it is bought').toBeVisible();
    await expect(tip, 'nothing to tip while the bucket is down').toBeHidden();
    await expect(horn).toBeVisible();
    // fitting the blade takes the scoop's buttons from the pad, and fitting the scoop brings them back; the horn stays
    await page.evaluate(() => window.pushminer!.buy('fit:blade'));
    await expect(button, 'no scoop button with the blade fitted').toBeHidden();
    await expect(tip).toBeHidden();
    await expect(horn).toBeVisible();
    await page.evaluate(() => window.pushminer!.buy('fit:scoop'));
    await expect(button, 'and it is back with the scoop').toBeVisible();
    expect(await reachable(page), 'bucket down: every button is where a finger gets it').toEqual([]);
    const content = await page.evaluate(() => window.pushminer!.content());
    const held = () => page.evaluate(() => window.pushminer!.state().scoop.held);
    await layInMouth(page, content.hole.x, content.hole.y - 24, 6);
    await button.tap();
    await page.evaluate(() => window.pushminer!.step(40));
    expect(await held(), 'tapped: up, with what was in it').toBe(6);
    await expect(tip, 'a button to tip it, now there is something to tip').toBeVisible();
    await expect(horn, 'and the horn is still there').toBeVisible();
    expect(await reachable(page), 'bucket up: every button is where a finger gets it').toEqual([]);
    // tapped again it comes down, and sets its load down
    await button.tap();
    await page.evaluate(() => window.pushminer!.step(40));
    expect(await page.evaluate(() => window.pushminer!.state().scoop)).toMatchObject({ held: 0, up: false, lift: 0 });
    await expect(tip).toBeHidden();
    // up once more, and tipped
    await button.tap();
    await page.evaluate(() => window.pushminer!.step(40));
    expect(await held(), 'up again with it').toBe(6);
    await page.evaluate(() => window.pushminer!.events());
    await tip.tap();
    await page.evaluate(() => window.pushminer!.step(40));
    expect(await held(), 'tipped out').toBe(0);
    expect((await page.evaluate(() => window.pushminer!.events())).filter((e) => e.startsWith('tipped'))).toEqual([
      'tipped 6',
    ]);
    await expect(tip, 'and the bucket came down').toBeHidden();
    // the blade fitted with a load up: it is set down, and both buttons go, the tip's with the scoop's
    await layInMouth(page, content.hole.x, content.hole.y - 24, 6);
    await button.tap();
    await page.evaluate(() => window.pushminer!.step(40));
    await expect(tip, 'up again').toBeVisible();
    await page.evaluate(() => window.pushminer!.buy('fit:blade'));
    await page.evaluate(() => window.pushminer!.step(2));
    await expect(button).toBeHidden();
    await expect(tip, 'the tip button goes with the bucket').toBeHidden();
    expect(await held(), 'the load was set down').toBe(0);
    await page.evaluate(() => window.pushminer!.buy('fit:scoop'));
    await expect(button).toBeVisible();
    await expect(tip, 'a bucket just refitted is down').toBeHidden();
    expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
    // a reload with the scoop bought shows the button from the start
    await page.evaluate(() => window.pushminer!.save());
    await page.reload();
    await ready(page);
    await expect(button, 'there again after a reload').toBeVisible();
    expect(problems).toEqual([]);
  });
});

/**
 * Whether a finger on the element `selector` names gets it: at its middle and near each of its corners, the thing on
 * top there is the element itself, and the element is on the screen. What is in the way is said.
 */
async function touchable(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const b = document.querySelector<HTMLElement>(selector)!;
    const r = b.getBoundingClientRect();
    const under: string[] = [];
    if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)
      under.push(`${selector} is off the screen`);
    const inset = 4;
    for (const [x, y] of [
      [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
      [r.left + inset, r.top + inset],
      [r.right - inset, r.top + inset],
      [r.left + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ]) {
      const top = document.elementFromPoint(x, y);
      if (top !== b && !b.contains(top)) {
        under.push(
          `${selector} is under ${top instanceof HTMLElement ? top.id || top.className || top.tagName : 'nothing'}`,
        );
        break;
      }
    }
    return under;
  }, selector);
}

/**
 * Whether a finger on each button of a phone gets that button: at its middle and near each of its corners, the
 * thing on top there is the button itself. A slider's hit area is wider than what is drawn of it, so a button
 * whose box is clear of a slider's box can still be under the slider; this asks what the finger asks.
 */
async function reachable(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const under: string[] = [];
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('#pad button, #options button'))) {
      if (b.hidden) continue;
      const r = b.getBoundingClientRect();
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)
        under.push(`${b.id} is off the screen`);
      const inset = 4;
      for (const [x, y] of [
        [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
        [r.left + inset, (r.top + r.bottom) / 2],
        [r.right - inset, (r.top + r.bottom) / 2],
        [(r.left + r.right) / 2, r.top + inset],
        [(r.left + r.right) / 2, r.bottom - inset],
      ]) {
        const top = document.elementFromPoint(x, y);
        if (top !== b && !b.contains(top)) {
          under.push(
            `${b.id} is under ${top instanceof HTMLElement ? top.id || top.className || top.tagName : 'nothing'}`,
          );
          break;
        }
      }
    }
    return under;
  });
}

for (const [name, viewport] of [
  ['a Pixel 7a', { width: 412, height: 839 }],
  ['a small phone', { width: 320, height: 640 }],
  ['a phone on its side', { width: 839, height: 412 }],
] as const) {
  test.describe(`the buttons on ${name}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('are each where a finger gets them and not a slider: the controls along the bottom, the options in the top left corner', async ({
      page,
    }) => {
      const problems = watch(page);
      // everything owned and the bucket up, which is the most buttons there are at once
      await start(page, { seed: 1, paused: true, save: { horn: true, scoop: 1 } });
      await page.evaluate(() => {
        const p = window.pushminer!;
        p.pause();
        p.scoop();
        p.step(30);
      });
      for (const id of ['shopButton', 'hornButton', 'scoopButton', 'tipButton'])
        await expect(page.locator(`#pad #${id}`), `${id} is a control, along the bottom`).toBeVisible();
      // what is set once and left is out of the way of the thumbs, in the corner
      for (const id of ['muteButton', 'cameraButton', 'controlsButton']) {
        const b = page.locator(`#options #${id}`);
        await expect(b, `${id} is an option, in the corner`).toBeVisible();
        const box = (await b.boundingBox())!;
        expect(box.y + box.height, `${id} at the top`).toBeLessThan(viewport.height / 4);
        expect(box.x + box.width, `${id} on the left`).toBeLessThan(viewport.width / 2);
      }
      expect(await reachable(page), 'a lever each track').toEqual([]);
      // and with the steering lying across on the right, which is the other way of driving
      await page.locator('#controlsButton').tap();
      await expect(page.locator('#steer')).toBeVisible();
      expect(await reachable(page), 'throttle and steering').toEqual([]);
      // the word at the top is not laid over the options: said, then looked for
      await page.evaluate(() => window.pushminer!.step(1));
      const note = (await page.locator('#cameraNote').boundingBox())!;
      for (const id of ['muteButton', 'cameraButton', 'controlsButton']) {
        const box = (await page.locator(`#${id}`).boundingBox())!;
        const apart =
          box.x + box.width <= note.x ||
          box.x >= note.x + note.width ||
          box.y + box.height <= note.y ||
          box.y >= note.y + note.height;
        expect(apart, `the note clear of ${id}`).toBe(true);
      }
      expect(problems).toEqual([]);
    });
  });
}

test('Space after buying the scoop from the workshop works the scoop and does not buy the next size', async ({
  page,
}) => {
  const problems = watch(page);
  await start(page, { seed: 1, paused: true, save: { bank: 5000 } });
  await page.evaluate(() => window.pushminer!.pause());
  await page.keyboard.press('b');
  await page.evaluate(() => window.pushminer!.step(1));
  await page.locator('#shop .rows:not(.cosmetics) button[data-id="scoop"]').click();
  expect(await page.evaluate(() => window.pushminer!.state().scoop.size), 'bought from its row').toBe(1);
  await page.keyboard.press('Space');
  await page.evaluate(() => window.pushminer!.step(2));
  expect(await page.evaluate(() => window.pushminer!.state().scoop.size), 'Space did not press the row again').toBe(1);
  expect(problems).toEqual([]);
});
