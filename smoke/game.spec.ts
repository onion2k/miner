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

/** What the game hangs on the window for poking at from outside. */
interface Exposed {
  calibration: number[];
  world: { live: number };
  dozer: { x: number; y: number; speed: number };
  economy: { save: { bank: number; lampsBroken: number[] } };
  trackMarks: { size: number };
}
/** Run a function on what the game exposes, in the page: it is sent over as its source, so it can use nothing from here. */
const exposed = <T>(page: Page, fn: (g: Exposed) => T): Promise<T> => page.evaluate(`(${fn.toString()})(globalThis)`);

/** Errors and failed requests while the page runs; WebGPU's own warnings are not errors. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  return problems;
}

/** Load the game and wait until it is past measuring the machine and the boot screen has gone. */
async function boot(page: Page) {
  await page.goto('/');
  try {
    await expect(page.locator('#boot')).toHaveClass(/gone/, { timeout: 60_000 });
  } catch {
    // what it was stuck on, or why WebGPU would not start
    throw new Error(`the game did not boot: ${await page.locator('#bootMsg').textContent()}`);
  }
  await expect
    .poll(() => page.evaluate(() => Array.isArray((globalThis as unknown as Exposed).calibration)))
    .toBe(true);
}

/** How many frames the page draws in a second. */
function framesInASecond(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0;
        const start = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - start < 1000) requestAnimationFrame(tick);
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

const hold = async (page: Page, key: string, ms: number) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

test('boots with no errors and draws the cave', async ({ page }, info) => {
  const problems = watch(page);
  await boot(page);
  // the frame loop is running
  expect(await framesInASecond(page)).toBeGreaterThan(20);
  const g = await page.evaluate(() => {
    const e = globalThis as unknown as Exposed;
    return { live: e.world.live, calibration: e.calibration };
  });
  expect(g.live, 'coins in the cave').toBeGreaterThan(500);
  info.annotations.push({
    type: 'frame cost per coin detail, ms',
    description: g.calibration.map((c) => c.toFixed(1)).join(', '),
  });
  const shot = await page.screenshot();
  await info.attach('cave', { body: shot, contentType: 'image/png' });
  const c = content(shot);
  // the hollow's lamps light most of what the camera starts on (about 0.64 lit, a spread of about 60);
  // a picture gone black is about 0.02, from the HUD alone
  expect(c.lit, 'share of the screen lit').toBeGreaterThan(0.2);
  expect(c.spread, 'variety in the picture').toBeGreaterThan(25);
  expect(problems).toEqual([]);
});

test('drives the dozer, and it leaves tracks', async ({ page }, info) => {
  const problems = watch(page);
  await boot(page);
  const start = await exposed(page, (g) => ({ x: g.dozer.x, y: g.dozer.y }));
  await page
    .locator('canvas')
    .click({ position: { x: 5, y: 5 } })
    .catch(() => {});
  await hold(page, 'w', 1200);
  await page.keyboard.down('w');
  await hold(page, 'a', 900);
  await page.keyboard.up('w');
  const after = await exposed(page, (g) => ({ x: g.dozer.x, y: g.dozer.y, marks: g.trackMarks.size }));
  expect(Math.hypot(after.x - start.x, after.y - start.y), 'distance driven').toBeGreaterThan(5);
  expect(after.marks, 'track marks laid').toBeGreaterThan(10);
  await info.attach('after driving', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('opens and closes the workshop', async ({ page }, info) => {
  const problems = watch(page);
  await boot(page);
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
  await boot(page);
  await hold(page, 'w', 800);
  const before = await exposed(page, (g) => g.world.live);
  await page.reload();
  await boot(page);
  const after = await exposed(page, (g) => g.world.live);
  // the same coins, give or take any that went down the hole on the way out
  expect(Math.abs(after - before)).toBeLessThan(50);
  expect(problems).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });

  test('boots with the touch controls and no errors', async ({ page }, info) => {
    const problems = watch(page);
    await boot(page);
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
});
