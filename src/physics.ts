/**
 * The physics is a package of its own now, artshape-physics, which knows
 * nothing of coins or caves: a body is a ball of some radius, the rock is a
 * grid of tiles, and what falls into a hole is reported back. What is here
 * is the game's side of it — the kinds of thing there are to push, what each
 * is worth and is called, and a world made from this cave: its grid, its
 * rock, its one hole and the radius of each kind.
 *
 * Everything in the game that steps or reads bodies still imports from here,
 * so the package stays behind one door.
 */
import { World, type WorldOptions } from 'artshape-physics/world';
import { COLS, HOLE, ORIGIN_X, ORIGIN_Y, ROWS, TILE } from './cave';

export { World, type Belt, type Pusher } from 'artshape-physics/world';

export const KIND_VALUE = [1, 10, 25, 40, 100, 250, 0, 0];
/** Collision radius per kind: coin, ruby, emerald, sapphire, diamond, gold bar, brick, barrel. */
export const KIND_RADIUS = [0.42, 1.0, 1.0, 1.0, 1.15, 0.8, 0.75, 1.05];
export const KIND_NAME = ['coin', 'ruby', 'emerald', 'sapphire', 'diamond', 'gold bar', 'brick', 'barrel'];
/** How many kinds of thing there are to push. */
export const KINDS = KIND_VALUE.length;
/** The gold bar, found only in the hidden chambers and the side rooms. */
export const BAR = 5;
/** A brick from a wall knocked down: pushed about like anything else, worth nothing, and gone after a while. */
export const BRICK_KIND = 6;
/** A barrel that goes off: pushed about like anything else, worth nothing. See `barrels.ts`. */
export const BARREL_KIND = 7;

/**
 * A world for this cave: the tile grid and the hole as `cave.ts` has them,
 * the radius of each kind, and `solid` for which tiles are rock, which the
 * game rewrites in place as gates open and walls come down. Chance is
 * Math.random unless told otherwise, so a seeded run is the same twice.
 */
export function makeWorld(capacity: number, solid: Uint8Array, random?: () => number): World {
  const options: WorldOptions = {
    capacity,
    grid: { cols: COLS, rows: ROWS, originX: ORIGIN_X, originY: ORIGIN_Y, tile: TILE },
    solid,
    radii: KIND_RADIUS,
    holes: [{ x: HOLE.x, y: HOLE.y, radius: HOLE.radius, depth: HOLE.depth }],
    random,
  };
  return new World(options);
}
