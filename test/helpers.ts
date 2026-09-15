/** What the tests share: a seeded Math.random, a flood over the tiles, and the player's machine as it starts. */
import { COLS, ORIGIN_X, ORIGIN_Y, ROWS, TILE } from '../src/cave';
import type { DozerSpec } from '../src/dozer';

export const PLAYER_SPEC: DozerSpec = {
  maxSpeed: 11,
  accel: 14,
  turnRate: 1.6,
  bladeWidth: 6.5,
  magnetRadius: 4,
  magnetStrength: 5,
};

/** Math.random from a seed, for the length of `fn`, then put back. */
export function withSeed<T>(seed: number, fn: () => T): T {
  const random = Math.random;
  let s = (seed * 2654435761) >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = random;
  }
}

/** The tile a world point is in, or -1 off the grid. */
export function tileAt(x: number, y: number): number {
  const tx = Math.floor((x - ORIGIN_X) / TILE),
    ty = Math.floor((y - ORIGIN_Y) / TILE);
  return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS ? -1 : ty * COLS + tx;
}

/** Every tile reachable from `start` by edge-neighbours that `pass` lets through. */
export function flood(start: number, pass: (t: number) => boolean): Set<number> {
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const t = stack.pop()!;
    if (t < 0 || seen.has(t) || !pass(t)) continue;
    seen.add(t);
    const tx = t % COLS,
      ty = (t / COLS) | 0;
    if (tx > 0) stack.push(t - 1);
    if (tx < COLS - 1) stack.push(t + 1);
    if (ty > 0) stack.push(t - COLS);
    if (ty < ROWS - 1) stack.push(t + COLS);
  }
  return seen;
}

/** A grid all open but for a border of rock and whatever `rock` marks, for testing movement against a known shape. */
export function grid(rock: (tx: number, ty: number) => boolean = () => false): Uint8Array {
  const solid = new Uint8Array(COLS * ROWS);
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      solid[ty * COLS + tx] = tx === 0 || ty === 0 || tx === COLS - 1 || ty === ROWS - 1 || rock(tx, ty) ? 1 : 0;
    }
  }
  return solid;
}
