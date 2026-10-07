/**
 * The game as a player gets it: served by Vite, run in Chromium on the real
 * GPU, with a fresh save each test. What the unit tests cannot reach — the
 * renderer, the HUD, the keyboard, the frame loop — checked for the things
 * that would make it plainly broken: an error, a black screen, a dozer that
 * does not move, a shop that does not open. Screenshots of each are kept in
 * test-results/ to look over.
 */
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { ready, start, watch } from './pushminer';

/** How many frames the page draws in a second. */
function framesInASecond(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0;
        const began = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - began < 1000) requestAnimationFrame(tick);
          else resolve(n);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Where each of `selectors` is on the page, the visible ones only, as boxes. */
async function boxes(page: Page, selectors: string[]) {
  return page.evaluate((list) => {
    const out: Record<string, { left: number; top: number; right: number; bottom: number }> = {};
    for (const sel of list) {
      for (const [k, el] of Array.from(document.querySelectorAll<HTMLElement>(sel)).entries()) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).display === 'none') continue;
        out[`${sel}#${k}`] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
    }
    return out;
  }, selectors);
}

type Box = { left: number; top: number; right: number; bottom: number };
const overlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The map is up, drawn on, clear of a tap, and clear of everything in `others` that is on the page. */
async function expectMapClear(page: Page, others: string[]) {
  const map = page.locator('#minimap');
  await expect(map).toBeVisible();
  expect(await page.locator('#pointer').count(), 'no arrow on the page').toBe(0);
  expect(await map.evaluate((el) => getComputedStyle(el).pointerEvents), 'taps pass through it').toBe('none');
  const marks = await page.evaluate(() => window.pushminer!.state().minimap);
  expect(marks, 'the map has been worked out').not.toBeNull();
  // something is drawn on it, and not only rock: the canvas is not blank
  const drawn = await map.evaluate((el: HTMLCanvasElement) => {
    const data = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 7) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  });
  expect(drawn, 'the map has more than one colour on it').toBeGreaterThan(3);
  const placed = await boxes(page, ['#minimap', ...others]);
  const mine = placed['#minimap#0'];
  for (const [name, box] of Object.entries(placed)) {
    if (name === '#minimap#0') continue;
    expect(overlap(mine, box), `the map overlaps ${name}`).toBe(false);
  }
  return mine;
}

/** How much a screenshot has in it: the spread of its brightness, and the share of it that is not near black. */
function content(png: Buffer) {
  const img = PNG.sync.read(png);
  let sum = 0,
    sq = 0,
    lit = 0;
  const n = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 4) {
    const y = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
    sum += y;
    sq += y * y;
    if (y > 40) lit++;
  }
  const mean = sum / n;
  return { spread: Math.sqrt(sq / n - mean * mean), lit: lit / n };
}

/**
 * The machine put on the cave's floor by its hole and the game stopped there. A new game starts at the dark
 * outer end of the way in, where the page is nearly black by design, so a picture of the cave is taken from
 * the floor.
 */
async function onTheFloor(page: Page) {
  await page.evaluate(() => {
    const api = window.pushminer!;
    api.pause();
    const hole = api.content().hole;
    api.teleport(hole.x, hole.y - 14, Math.PI / 2);
    api.step(60);
    // the camera eases after the machine, so it is put there too, at the distance it starts from
    api.look(hole.x, hole.y - 14, { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 });
    api.step(1);
  });
}

test('boots with no errors and draws the cave', async ({ page }, info) => {
  const problems = watch(page);
  // measured, as a player's boot is
  await start(page, { coins: null });
  // the frame loop is running
  expect(await framesInASecond(page)).toBeGreaterThan(20);
  const { live, calibration } = await page.evaluate(() => ({
    live: window.pushminer!.state().live,
    calibration: window.pushminer!.calibration,
  }));
  expect(live, 'coins in the cave').toBeGreaterThan(500);
  info.annotations.push({
    type: 'frame cost per coin detail, ms',
    description: calibration.map((c) => c.toFixed(1)).join(', '),
  });
  await onTheFloor(page);
  const shot = await page.screenshot();
  await info.attach('cave', { body: shot, contentType: 'image/png' });
  const c = content(shot);
  // the lamps light most of what the camera starts on (about 0.6 lit, a spread of about 60);
  // a picture gone black is about 0.02, from the HUD alone
  expect(c.lit, 'share of the screen lit').toBeGreaterThan(0.2);
  expect(c.spread, 'variety in the picture').toBeGreaterThan(25);
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
  expect(problems).toEqual([]);
});

test('has the map in the bottom-right corner, clear of the counters and the help', async ({ page }) => {
  const problems = watch(page);
  await start(page, { paused: true });
  await page.evaluate(() => window.pushminer!.step(30));
  await page.keyboard.press('v');
  await page.evaluate(() => window.pushminer!.step(1));
  const mine = await expectMapClear(page, ['#bank', '#stats', '#help', '#cameraNote', '#toast']);
  expect(mine.right, 'in the right-hand corner').toBeCloseTo(1280 - 16, 0);
  expect(mine.bottom, 'at the bottom').toBeCloseTo(800 - 16, 0);
  expect(mine.right - mine.left, 'about 120 px').toBeCloseTo(120, 0);
  expect(problems).toEqual([]);
});

test('boots with stages of the renderer turned off from the address, and the cave lit from the sky', async ({
  page,
}, info) => {
  // the switches for finding a fault from the machine that has it: every stage off at once, and daylight
  const problems = watch(page);
  await page.goto('/?coins=3&off=shadows,occlusion,post,effects,particles,points&day');
  await ready(page);
  // the boot screen is still fading over the frame when the game says it is ready: put away, so the cave is what is measured
  await page.locator('#boot').evaluate((el: HTMLElement) => (el.style.display = 'none'));
  await onTheFloor(page);
  const shot = await page.screenshot();
  await info.attach('daylight, stages off', { body: shot, contentType: 'image/png' });
  // lit by the sky alone, with every lamp off: a cave with the switches ignored would be black
  expect(content(shot).lit, 'share of the screen lit').toBeGreaterThan(0.2);
  expect(problems).toEqual([]);
});

test('drives the dozer by the keyboard, and it leaves tracks', async ({ page }, info) => {
  const problems = watch(page);
  await start(page);
  const before = await page.evaluate(() => window.pushminer!.state().dozer);
  await page.keyboard.down('w');
  await expect
    .poll(
      () =>
        page.evaluate(
          ([x, y]) => {
            const d = window.pushminer!.state().dozer;
            return Math.hypot(d.x - x, d.y - y);
          },
          [before.x, before.y],
        ),
      { timeout: 5000 },
    )
    .toBeGreaterThan(5);
  await page.keyboard.down('a');
  await page.waitForTimeout(600);
  await page.keyboard.up('a');
  await page.keyboard.up('w');
  expect(await page.evaluate(() => window.pushminer!.state().trackMarks), 'track marks laid').toBeGreaterThan(10);
  await info.attach('after driving', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('mutes and unmutes the sound from the keyboard', async ({ page }) => {
  const problems = watch(page);
  await start(page, { paused: true });
  const muted = () => page.evaluate(() => window.pushminer!.state().muted);
  expect(await muted()).toBe(false);
  // the key is read in a frame of the game, so one is stepped for it to land
  await page.keyboard.press('m');
  await page.evaluate(() => window.pushminer!.step(1));
  expect(await muted(), 'muted by M').toBe(true);
  await page.keyboard.press('m');
  await page.evaluate(() => window.pushminer!.step(1));
  expect(await muted(), 'unmuted by M again').toBe(false);
  expect(problems).toEqual([]);
});

test('opens and closes the workshop', async ({ page }, info) => {
  const problems = watch(page);
  await start(page);
  const shop = page.locator('#shop');
  await expect(shop).toBeHidden();
  await page.keyboard.press('b');
  await expect(shop).toBeVisible();
  await expect(shop.locator('button').first()).toBeVisible();
  // the workshop fills the corner the map is in, so the map steps aside while it is open
  await expect(page.locator('#minimap')).toBeHidden();
  await info.attach('workshop', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('b');
  await expect(shop).toBeHidden();
  await expect(page.locator('#minimap')).toBeVisible();
  expect(problems).toEqual([]);
});

test('shows the whole workshop at a desk with nothing to scroll, in the cave with the most to sell', async ({
  page,
}) => {
  const problems = watch(page);
  // the east gallery has two belts, so its workshop is the longest there is
  await start(page, { save: { cave: 'east-gallery' } });
  await page.keyboard.press('b');
  const shop = page.locator('#shop');
  await expect(shop).toBeVisible();
  const seen = await page.evaluate(() => {
    const shop = document.getElementById('shop')!;
    const scrolls = (e: Element) => e.scrollHeight > e.clientHeight + 1;
    const rows = Array.from(shop.querySelectorAll('.rows button')).map((b) => {
      const r = b.getBoundingClientRect();
      return { id: (b as HTMLElement).dataset.id, top: r.top, bottom: r.bottom, left: r.left, height: r.height };
    });
    return {
      rows,
      scrolling: [shop, ...Array.from(shop.querySelectorAll('.rows'))].filter(scrolls).length,
      panel: shop.getBoundingClientRect().toJSON() as { top: number; bottom: number },
      height: innerHeight,
    };
  });
  expect(
    seen.rows.map((r) => r.id).filter((id) => /^(engine|blade|scoop|magnet|drone|belt:)/.test(id ?? '')),
    'everything the workshop sells here',
  ).toHaveLength(7);
  expect(seen.rows.length, 'and the paint shop under it').toBeGreaterThan(7);
  expect(seen.scrolling, 'no list of it scrolls, and nor does the panel').toBe(0);
  // what is fitted is a pair, side by side, as the paints are, and not two rows more
  const [blade, scoop] = ['fit:blade', 'fit:scoop'].map((id) => seen.rows.find((r) => r.id === id)!);
  expect(blade, 'a row to fit the blade').toBeDefined();
  expect(scoop, 'and one to fit the scoop').toBeDefined();
  expect(scoop.top, 'side by side').toBeCloseTo(blade.top, 0);
  expect(scoop.left, 'the scoop’s to the right of the blade’s').toBeGreaterThan(blade.left);
  expect(seen.panel.top, 'the panel is on the screen').toBeGreaterThanOrEqual(0);
  expect(seen.panel.bottom).toBeLessThanOrEqual(seen.height);
  for (const r of seen.rows) {
    expect(r.top, `${r.id} is on the screen`).toBeGreaterThanOrEqual(seen.panel.top);
    expect(r.bottom, `${r.id} is on the screen`).toBeLessThanOrEqual(seen.panel.bottom);
    // small, but still something a pointer can hit
    expect(r.height, `${r.id} is big enough to press`).toBeGreaterThanOrEqual(24);
  }
  expect(problems).toEqual([]);
});

test('keeps the game where it was across a reload', async ({ page }) => {
  const problems = watch(page);
  await start(page);
  await page.evaluate(() => {
    const p = window.pushminer!;
    p.pause();
    p.deposit(123);
    p.drive(1, 0);
    p.step(60);
    p.release();
  });
  const before = await page.evaluate(() => {
    const p = window.pushminer!;
    p.save();
    return p.state();
  });
  await page.reload();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  await expect.poll(() => page.evaluate(() => window.pushminer?.ready ?? false), { timeout: 60_000 }).toBe(true);
  const after = await page.evaluate(() => window.pushminer!.state());
  expect(after.bank).toBe(before.bank);
  expect(after.cave).toBe(before.cave);
  // the same coins, give or take any that were on their way down the hole
  expect(Math.abs(after.live - before.live)).toBeLessThan(20);
  expect(after.barrels.count).toBe(before.barrels.count);
  expect(problems).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });

  test('boots with the touch controls and no errors', async ({ page }, info) => {
    const problems = watch(page);
    await start(page);
    await expect(page.locator('#pad')).toBeVisible();
    await expect(page.locator('#trackLeft')).toBeVisible();
    await expect(page.locator('#trackRight')).toBeVisible();
    // the counters and the keyboard help are left off a phone, for the cave
    await expect(page.locator('#bank')).toBeHidden();
    await info.attach('phone', { body: await page.screenshot(), contentType: 'image/png' });
    // nothing wider than the screen
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
    expect(problems).toEqual([]);
  });

  test('has the map in the top-right corner, inside the safe area, clear of the sliders, buttons and note', async ({
    page,
  }) => {
    const problems = watch(page);
    await start(page, { paused: true });
    await page.evaluate(() => window.pushminer!.step(30));
    // the note at the top, shown by pressing a button that sets it
    await page.locator('#cameraButton').tap();
    await page.evaluate(() => window.pushminer!.step(1));
    await expect(page.locator('#cameraNote')).toBeVisible();
    const mine = await expectMapClear(page, [
      '#trackLeft',
      '#trackRight',
      '#pad button',
      '#options button',
      '#cameraNote',
      '#toast',
    ]);
    const inset = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;top:env(safe-area-inset-top);right:env(safe-area-inset-right);width:0;height:0';
      document.body.append(probe);
      const r = probe.getBoundingClientRect();
      probe.remove();
      return { top: r.top, right: innerWidth - r.right };
    });
    expect(mine.right, 'inside the right edge, and the safe area').toBeLessThanOrEqual(400 - 12 - inset.right + 0.5);
    expect(mine.top, 'inside the top edge, and the safe area').toBeGreaterThanOrEqual(12 + inset.top - 0.5);
    expect(mine.right, 'in the right half').toBeGreaterThan(200);
    expect(mine.top, 'in the top half').toBeLessThan(200);
    expect(mine.right - mine.left, 'about 88 px').toBeCloseTo(88, 0);
    expect(problems).toEqual([]);
  });

  test('mutes and unmutes the sound from its button, and the button says which', async ({ page }) => {
    const problems = watch(page);
    await start(page, { paused: true });
    const button = page.locator('#muteButton');
    const muted = () => page.evaluate(() => window.pushminer!.state().muted);
    expect(await muted()).toBe(false);
    await expect(button).toHaveAttribute('aria-label', 'mute');
    await button.tap();
    expect(await muted(), 'muted by the button').toBe(true);
    await expect(button).toHaveAttribute('aria-label', 'unmute');
    await button.tap();
    expect(await muted(), 'unmuted by the button').toBe(false);
    await expect(button).toHaveAttribute('aria-label', 'mute');
    expect(problems).toEqual([]);
  });
});

test.describe('on a phone turned on its side', () => {
  test.use({ viewport: { width: 860, height: 400 }, hasTouch: true, isMobile: true });

  test('keeps the map clear of the slider that runs the height of the screen', async ({ page }) => {
    const problems = watch(page);
    await start(page, { paused: true });
    await page.evaluate(() => window.pushminer!.step(30));
    await page.locator('#cameraButton').tap();
    await page.evaluate(() => window.pushminer!.step(1));
    const mine = await expectMapClear(page, [
      '#trackLeft',
      '#trackRight',
      '#pad button',
      '#options button',
      '#cameraNote',
    ]);
    expect(mine.top, 'still at the top').toBeLessThan(40);
    expect(mine.right, 'inside the screen').toBeLessThanOrEqual(860);
    expect(problems).toEqual([]);
  });
});
