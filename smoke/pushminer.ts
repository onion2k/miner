/**
 * What the smoke tests share: starting the game in a page, from a save if
 * the test wants one, and waiting until it is ready; and watching the page
 * for errors. Everything else a test does goes through `window.pushminer`,
 * the game's test API (`src/debug.ts`), whose types these tests compile
 * against.
 */
import { expect, type Page } from '@playwright/test';
import type { PushminerApi } from '../src/debug';

declare global {
  interface Window {
    pushminer?: PushminerApi;
  }
}

/** The parts of a save a test might want to set; the rest start as a new game's. */
export interface SaveSetup {
  bank?: number;
  areas?: boolean[];
  room?: number;
  done?: boolean;
  drones?: number;
  horn?: boolean;
  flag?: boolean;
  lampsBroken?: number[];
  barrels?: number[] | null;
}

/** Errors on the page, and requests that failed, collected as they happen. */
export function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
  return problems;
}

/**
 * The game in the page, from a save if given (written before the page's own
 * scripts run, and only on the first load, so a reload keeps what was
 * played), and ready. `coins` skips measuring the machine, which is quicker
 * and the same every run; leave it out to measure. `seed` makes chance the
 * same from before the game is built, heaps and all, for a test that wants
 * the same cave every run, and `paused` stops it before a frame of its own
 * has run, so everything after is the test's own stepping.
 */
export async function start(
  page: Page,
  options: { save?: SaveSetup; coins?: number | null; seed?: number; paused?: boolean } = {},
) {
  const { save, coins = 3, seed, paused: startPaused } = options;
  // chance from a seed before the page's own scripts run, so even where the heaps are is the same every run
  if (seed !== undefined)
    await page.addInitScript((n) => {
      let s = (n * 2654435761) >>> 0;
      Math.random = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
    }, seed);
  if (save)
    await page.addInitScript((s) => {
      if (sessionStorage.getItem('pushminer-test-seeded')) return;
      localStorage.setItem('pushminer-save-v1', JSON.stringify(s));
      sessionStorage.setItem('pushminer-test-seeded', '1');
    }, save);
  const query = new URLSearchParams();
  if (coins !== null) query.set('coins', String(coins));
  if (startPaused) query.set('paused', '1');
  await page.goto(query.size ? `/?${query.toString()}` : '/');
  await ready(page);
}

/** Wait until the game is booted and its frame loop running, or say what the boot screen was stuck on. */
export async function ready(page: Page) {
  try {
    await expect.poll(() => page.evaluate(() => window.pushminer?.ready ?? false), { timeout: 60_000 }).toBe(true);
    await expect(page.locator('#boot')).toHaveClass(/gone/);
  } catch {
    throw new Error(`the game did not boot: ${await page.locator('#bootMsg').textContent()}`);
  }
}
