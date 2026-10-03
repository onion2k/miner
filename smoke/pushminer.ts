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
    /** The way the machine heads on the screen, in degrees anticlockwise from the right: put there by `measuring`. */
    screenHeading?: () => number;
  }
}

/** More than any toll: a save that says so has paid its cave's toll, which loading clamps to the cave's own. */
export const PAID = 1e9;

/**
 * The parts of a save a test might want to set; the rest start as a new game's. The toll starts paid, so that what
 * a test banks is the player's bank and the cave is as the test set it; a test of the toll gives its own.
 */
export interface SaveSetup {
  bank?: number;
  /** What has been paid of the cave's toll: more than it asks is all of it. */
  toll?: number;
  /** The cave the save stands in, by its id, and whether its way out is open. */
  cave?: string;
  open?: boolean;
  done?: boolean;
  drones?: number;
  horn?: boolean;
  /** The size of scoop fitted, 0 for none to 3. */
  scoop?: number;
  flag?: boolean;
  lampsBroken?: number[];
  /** The ids of the belts bought for the cave. */
  belts?: string[];
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
    await page.addInitScript(
      (s) => {
        if (sessionStorage.getItem('pushminer-test-seeded')) return;
        localStorage.setItem('pushminer-save-v1', JSON.stringify(s));
        sessionStorage.setItem('pushminer-test-seeded', '1');
      },
      { toll: PAID, ...save },
    );
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

/**
 * Put in the page a way to read which way the machine heads on the screen: the machine and a point six units
 * ahead of it, each projected through the camera's own matrix, and the angle between the two, up the screen being
 * ninety. It is a function of the page and not of the test, so that it can be read in the very call that steps the
 * game: a frame later, the page's own frame loop has been round and the swap made.
 */
export async function measuring(page: Page) {
  await page.evaluate(() => {
    window.screenHeading = () => {
      const api = window.pushminer!;
      const { x, y, yaw } = api.state().dozer;
      const here = api.project(x, y, 1.5),
        ahead = api.project(x + Math.cos(yaw) * 6, y + Math.sin(yaw) * 6, 1.5);
      return (Math.atan2(here.y - ahead.y, ahead.x - here.x) * 180) / Math.PI;
    };
  });
}

/** Wait for the page to build the next cave after the machine has driven out: it does so a frame after the black is drawn. */
export async function swapped(page: Page) {
  await expect.poll(() => page.evaluate(() => !window.pushminer!.state().leaving), { timeout: 10_000 }).toBe(true);
}

/**
 * What the page shows of the way out: the black layer's opacity, the map's (shown or not, its opacity, and
 * whether it marks the way out and how many holes), any gold arrow left on the page, the note and the progress line.
 */
export async function screen(page: Page) {
  return page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)!.textContent;
    const map = document.getElementById('minimap') as HTMLElement;
    const marks = window.pushminer!.state().minimap;
    return {
      fade: +getComputedStyle(document.getElementById('fade')!).opacity,
      words: +getComputedStyle(document.getElementById('keepGoing')!).opacity,
      map: {
        visible: !map.hidden && getComputedStyle(map).display !== 'none',
        opacity: +getComputedStyle(map).opacity,
        exit: marks ? marks.exit !== undefined : null,
        holes: marks ? marks.holes.length : 0,
      },
      arrows: document.querySelectorAll('#pointer').length,
      note: document.getElementById('cameraNote')!.hidden ? null : text('cameraNote'),
      progress: text('progress'),
    };
  });
}

/**
 * Drive with the keys, as a player does, to a point and on through it: W held, and A or D held for as
 * long as the machine's heading is off the bearing of the point by more than a little, re-read every few
 * frames. Stops when `until` says so or after `frames`, and lets go of the keys. Each sample is handed to
 * `seen`, so a test can watch what the page does on the way.
 */
export async function steerTo(
  page: Page,
  target: { x: number; y: number },
  until: (state: SampleLike) => boolean,
  options: { frames?: number; every?: number; seen?: (state: SampleLike) => Promise<void> | void } = {},
) {
  const { frames = 60 * 40, every = 5, seen } = options;
  const held = new Set<string>();
  const hold = async (key: string, on: boolean) => {
    if (on === held.has(key)) return;
    if (on) await page.keyboard.down(key);
    else await page.keyboard.up(key);
    if (on) held.add(key);
    else held.delete(key);
  };
  try {
    await hold('w', true);
    for (let f = 0; f < frames; f += every) {
      // the heading is read in the call that steps, before the page's own frames can swap the cave
      const state = await page.evaluate((n) => {
        window.pushminer!.step(n);
        return { ...window.pushminer!.state(), heading: window.screenHeading?.() ?? null };
      }, every);
      if (seen) await seen(state);
      if (until(state)) return state;
      const want = Math.atan2(target.y - state.dozer.y, target.x - state.dozer.x);
      let err = want - state.dozer.yaw;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      await hold('a', err > 0.08);
      await hold('d', err < -0.08);
    }
    throw new Error(`did not get there in ${frames} frames`);
  } finally {
    for (const key of [...held]) await hold(key, false);
  }
}

type GameStateLike = ReturnType<PushminerApi['state']>;
/** A state, and the way the machine heads on the screen where `measuring` has been called. */
export type SampleLike = GameStateLike & { heading: number | null };
