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
  const shot = await page.screenshot();
  await info.attach('cave', { body: shot, contentType: 'image/png' });
  const c = content(shot);
  // the hollow's lamps light most of what the camera starts on (about 0.64 lit, a spread of about 60);
  // a picture gone black is about 0.02, from the HUD alone
  expect(c.lit, 'share of the screen lit').toBeGreaterThan(0.2);
  expect(c.spread, 'variety in the picture').toBeGreaterThan(25);
  expect(await page.evaluate(() => window.pushminer!.invariants())).toEqual([]);
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
    .poll(() => page.evaluate(() => window.pushminer!.state().dozer.y), { timeout: 5000 })
    .toBeGreaterThan(before.y + 5);
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
  await info.attach('workshop', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('b');
  await expect(shop).toBeHidden();
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
  expect(after.room).toBe(before.room);
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
