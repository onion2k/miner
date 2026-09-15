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
 * and the same every run; leave it out to measure.
 */
export async function start(page: Page, options: { save?: SaveSetup; coins?: number | null } = {}) {
  const { save, coins = 3 } = options;
  if (save)
    await page.addInitScript((s) => {
      if (sessionStorage.getItem('pushminer-test-seeded')) return;
      localStorage.setItem('pushminer-save-v1', JSON.stringify(s));
      sessionStorage.setItem('pushminer-test-seeded', '1');
    }, save);
  await page.goto(coins === null ? '/' : `/?coins=${coins}`);
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
