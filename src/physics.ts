/**
 * The physics is a package of its own now, artshape-physics, which knows
 * nothing of coins or caves: a body is a ball of some radius, the rock is a
 * grid of tiles, and what falls into a hole is reported back. What is here
 * is the game's side of it — the kinds of thing there are to push, what each
 * is worth and is called, and a world made from a cave: its grid, its
 * rock, its holes and the radius of each kind.
 *
 * Everything in the game that steps or reads bodies still imports from here,
 * so the package stays behind one door.
 */
import { World, type WorldOptions } from 'artshape-physics/world';
import { TILE, type Grid, type HoleSpec } from './cave';

export { World, type Belt, type Pusher } from 'artshape-physics/world';

export const KIND_VALUE = [1, 10, 25, 40, 100, 250, 0, 0, 0];
/** Collision radius per kind: coin, ruby, emerald, sapphire, diamond, gold bar, brick, barrel, geode. */
export const KIND_RADIUS = [0.42, 1.0, 1.0, 1.0, 1.15, 0.8, 0.75, 1.05, 1.6];
export const KIND_NAME = ['coin', 'ruby', 'emerald', 'sapphire', 'diamond', 'gold bar', 'brick', 'barrel', 'geode'];
/** How many kinds of thing there are to push. */
export const KINDS = KIND_VALUE.length;
/** The gold bar, found only in the hidden chambers and the side rooms. */
export const BAR = 5;
/** A brick from a wall knocked down: pushed about like anything else, worth nothing, and gone after a while. */
export const BRICK_KIND = 6;
/** A barrel that goes off: pushed about like anything else, worth nothing. See `barrels.ts`. */
export const BARREL_KIND = 7;
/** A boulder worth nothing whole, cracked into gems by a barrel's blast. See `geode-stones.ts`. (The Deep's biome is also called geode.) */
export const GEODE_KIND = 8;

/**
 * The cave as it was on artshape-physics 0.1.0, where the game was tuned. Since
 * 0.3.0 each body is judged for sleep on a window of its own, and in this cave
 * two coins resting against each other never sleep on the same step: 257 of
 * the 9073 bodies in the cave at rest stayed awake for ever, and a heap dropped
 * at once never settled. Judged together they sleep together. And since 0.3.0
 * anything rolling slower than about 1.2 a second is slowed to a stop, which is
 * how a golf putt dies at the lip; here a coin nudged at the hole stopped short
 * of it, and the South Gallery took a thorough player a sixth longer to clear.
 * `settle` at 1 turns that off.
 */
const TUNING = { sleepTogether: true, settle: 1 };

/**
 * A world for a cave: its tile grid and its holes, the radius of each kind,
 * and `solid` for which tiles are rock, which the game rewrites in place as
 * gates open and walls come down. Chance is Math.random unless told
 * otherwise, so a seeded run is the same twice.
 */
export function makeWorld(
  capacity: number,
  solid: Uint8Array,
  grid: Grid,
  holes: readonly HoleSpec[],
  random?: () => number,
): World {
  const options: WorldOptions = {
    capacity,
    grid: { cols: grid.cols, rows: grid.rows, originX: grid.originX, originY: grid.originY, tile: TILE },
    solid,
    radii: KIND_RADIUS,
    holes: holes.map((h) => ({ x: h.x, y: h.y, radius: h.radius, depth: h.depth })),
    random,
    tuning: TUNING,
  };
  return new World(options);
}
