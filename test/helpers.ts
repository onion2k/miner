/**
 * What the tests share: the run of caves the game plays, a game made on any
 * one of them, a seeded Math.random, a flood over a cave's tiles, and the
 * player's machine as it starts.
 */
import { TILE, buildCave, gridOf, type Cave, type CaveSpec } from '../src/cave';
import { RUN } from '../src/caves';
import type { DozerSpec } from '../src/dozer';
import { Economy, memoryStore, type Save } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { held, type Row } from '../src/ledger';

export { RUN };

/** A world's size, in bodies, for the tests that want a world and not a cave's own. */
export const TEST_BODIES = 10000;

/** The spec of a cave in the run, by its id. */
export function specOf(id: string): CaveSpec {
  const spec = RUN.find((c) => c.id === id);
  if (!spec) throw new Error(`no cave called ${id} in the run`);
  return spec;
}

const built = new Map<string, Cave>();
/** A cave of the run carved, the once, for the tests that only read it. */
export function caveOf(id: string): Cave {
  let cave = built.get(id);
  if (!cave) built.set(id, (cave = buildCave(specOf(id))));
  return cave;
}

/** The ids of the run, in order. */
export const IDS = RUN.map((c) => c.id);

/** More than any toll: a save that says so has paid its cave's toll, which loading clamps to the cave's own. */
export const PAID = 1e9;

/**
 * A save, as JSON, of a new game standing in the cave `id`: whatever else is given set over it. The
 * per-cave lists come back sized to that cave when it is loaded. The toll starts paid, so that a coin
 * banked raises the bank as the tests that are not about the toll expect; a patch with `toll` says otherwise.
 */
export function saveIn(id: string, patch: Partial<Save> = {}): string {
  const fresh = new Economy(memoryStore(), RUN).save;
  // a scoop given is fitted, as buying one fits it, unless the patch says otherwise
  const fitted = patch.scoop ? 'scoop' : 'blade';
  return JSON.stringify({ ...fresh, toll: PAID, fitted, ...patch, cave: id });
}

/** An economy whose cave's toll has been paid, so that what it banks is the player's: for the tests that are not about the toll. */
export function payToll<E extends Economy>(economy: E): E {
  economy.save.toll = economy.tollDue();
  return economy;
}

/** An economy for the run, over a save kept in memory, from `json` if given. */
export function newEconomy(json: string | null = null, run: readonly CaveSpec[] = RUN) {
  return new Economy(memoryStore(json), run);
}

/** A game on the cave the save is in, from a save in memory, told of what happens if `events` says. */
export function newGame(json: string | null = null, events: GameEvents = {}) {
  const economy = newEconomy(json);
  return new Game(economy, caveOf(economy.cave().id), events);
}

/** A game in the cave `id`, from a new save with `patch` set on it. */
export function gameIn(id: string, patch: Partial<Save> = {}, events: GameEvents = {}) {
  return newGame(saveIn(id, patch), events);
}

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

/** The tile a world point is in in a cave, or -1 off the grid. */
export function tileIn(cave: Cave, x: number, y: number): number {
  const { cols, rows, originX, originY } = cave.grid;
  const tx = Math.floor((x - originX) / TILE),
    ty = Math.floor((y - originY) / TILE);
  return tx < 0 || ty < 0 || tx >= cols || ty >= rows ? -1 : ty * cols + tx;
}

/** Every tile reachable from `start` by edge-neighbours that `pass` lets through, in a cave's grid. */
export function floodIn(cave: Cave, start: number, pass: (t: number) => boolean): Set<number> {
  const { cols, rows } = cave.grid;
  const seen = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const t = stack.pop()!;
    if (t < 0 || seen.has(t) || !pass(t)) continue;
    seen.add(t);
    const tx = t % cols,
      ty = (t / cols) | 0;
    if (tx > 0) stack.push(t - 1);
    if (tx < cols - 1) stack.push(t + 1);
    if (ty > 0) stack.push(t - cols);
    if (ty < rows - 1) stack.push(t + cols);
  }
  return seen;
}

/** A grid the size of the old cave, 104 by 64, for the tests of movement and the rock that need a known shape and not a cave. */
export const TEST_GRID = gridOf({ cols: 104, rows: 64 });
export const { cols: COLS, rows: ROWS, originX: ORIGIN_X, originY: ORIGIN_Y } = TEST_GRID;

/** The tile a world point is in on the test grid, or -1 off it. */
export function tileAt(x: number, y: number): number {
  const tx = Math.floor((x - ORIGIN_X) / TILE),
    ty = Math.floor((y - ORIGIN_Y) / TILE);
  return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS ? -1 : ty * COLS + tx;
}

/** The test grid all open but for a border of rock and whatever `rock` marks. */
export function grid(rock: (tx: number, ty: number) => boolean = () => false): Uint8Array {
  return openGrid(COLS, ROWS, rock);
}

/** The solid cells of a grid of `cols` by `rows`, all open but for a border of rock and whatever `rock` marks, for testing movement against a known shape. */
export function openGrid(cols: number, rows: number, rock: (tx: number, ty: number) => boolean = () => false) {
  const solid = new Uint8Array(cols * rows);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      solid[ty * cols + tx] = tx === 0 || ty === 0 || tx === cols - 1 || ty === rows - 1 || rock(tx, ty) ? 1 : 0;
    }
  }
  return solid;
}

/**
 * The row of the cave an economy is in, as it stands, for a test of the economy alone that moves on without a game to
 * say what the ledger would: what the save has taken and drained, and none of what a game's stock would tell.
 */
export function leavingRow(economy: Economy): Row {
  const { save } = economy;
  const total = held(economy.cave());
  return {
    cave: save.cave,
    held: total,
    taken: save.taken,
    toll: save.toll,
    drained: save.drained,
    left: Math.max(0, total - save.taken - save.drained),
    finds: { chamber: 'none', sideRoom: 'none', wall: 'none', geodes: { cracked: save.cracked, of: 0 } },
    marks: { clean: save.drained === 0, everyHeap: false, everyFind: false },
  };
}
