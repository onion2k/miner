/**
 * What the minimap shows, worked out apart from the page. The map is centred on the dozer and turned so that
 * the way the camera looks is up it, over a window a fixed size in the world whatever the cave: this works
 * out where each mark falls on it, and which of the floor's tiles are floor, and the page only draws what it
 * is told. Without it the map's turning would be done in the canvas, where a wrong quarter-turn or a mirrored
 * sign is only seen by looking, and no test could tell.
 *
 * Map space is the page's: x to the right, y down, the dozer at (0, 0), in world units, so that a mark at
 * (0, -30) is thirty units straight ahead on the screen.
 */
import { BRICK, EXIT, TILE, exitPoints, nearestHole, type BeltSpec, type Cave } from './cave';
import { KIND_VALUE } from './physics';

/** The grey of a floor tile, a brick wall that still stands and rock, in the image `floorImage` makes. */
export const FLOOR_LEVEL = 210,
  WALL_LEVEL = 120,
  ROCK_LEVEL = 40;

/** How far the map reaches from the dozer to its edge, in world units: fifty tiles across, in every cave. */
export const MAP_RANGE = 100;

/** How many specks fit across the window, which is as fine as the smallest map can show them. */
const SPECK_CELLS = 64;

/** The way on the floor that is up the map, for a camera at `azimuth` round: the camera sits behind what it looks at. */
export function cameraFacing(azimuth: number): number {
  return azimuth + Math.PI;
}

/** The bodies the cave holds, as the physics keeps them: only these fields are read. */
export interface MinimapBodies {
  count: number;
  alive: ArrayLike<number>;
  kind: ArrayLike<number>;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Held by the scoop: with the machine, not lying in the cave, so not a mark on the map. Left out, none is. */
  carried?: ArrayLike<number>;
}

export interface MinimapInput {
  cave: Cave;
  /** Whether the cave's way out is open. */
  open: boolean;
  /** Where the dozer is, and the way it faces on the floor, in radians. */
  dozer: { x: number; y: number; yaw: number };
  /** The way on the floor that is up the map, in radians: the camera's. */
  facing: number;
  bots: readonly { x: number; y: number }[];
  /** The belts that run. */
  belts: readonly BeltSpec[];
  bodies: MinimapBodies;
  /** How far the map reaches from the dozer to its edge; `MAP_RANGE` unless a test wants another. */
  range?: number;
}

export interface Mark {
  x: number;
  y: number;
}

export interface MinimapView {
  range: number;
  /** The dozer is at the middle; `heading` is the way it points in map space, radians from the right, down positive. */
  dozer: { x: 0; y: 0; heading: number };
  /** Each hole in the window, and the nearest too if it is outside, pinned to the rim, which is what `rim` says. */
  holes: (Mark & { radius: number; rim: boolean })[];
  /** The way out's mouth, once it is open. */
  exit?: Mark & { rim: boolean };
  bots: Mark[];
  /** Where valuable bodies lie, a mark to a bucket. */
  specks: Mark[];
  belts: { x0: number; y0: number; x1: number; y1: number }[];
  /**
   * Where the floor image goes, as a canvas transform [a, b, c, d, e, f] taking one image pixel (a tile) to map
   * units: turned, and placed so that the dozer's place in the cave is the middle.
   */
  floor: [number, number, number, number, number, number];
}

/** What is on the map: where everything is relative to the dozer, turned, and what to leave out. */
export function minimapView(input: MinimapInput): MinimapView {
  const { cave, open, dozer, bots, belts, bodies, range = MAP_RANGE } = input;
  const fx = Math.cos(input.facing),
    fy = Math.sin(input.facing);
  // to the right of the way it looks, over the floor seen from above, is a quarter-turn clockwise of forward
  const turn = (wx: number, wy: number): Mark => ({ x: wx * fy - wy * fx, y: -(wx * fx + wy * fy) });
  const at = (x: number, y: number) => turn(x - dozer.x, y - dozer.y);
  const inside = (m: Mark) => Math.abs(m.x) <= range && Math.abs(m.y) <= range;
  // out past the window, the rim of the square, the way it lies
  const pinned = (m: Mark): Mark => {
    const k = range / Math.max(Math.abs(m.x), Math.abs(m.y));
    return { x: m.x * k, y: m.y * k };
  };

  const near = nearestHole(cave.holes, dozer.x, dozer.y);
  const holes: MinimapView['holes'] = [];
  for (const h of cave.holes) {
    const m = at(h.x, h.y);
    if (inside(m)) holes.push({ ...m, radius: h.radius, rim: false });
    else if (h === near) holes.push({ ...pinned(m), radius: h.radius, rim: true });
  }

  let exit: MinimapView['exit'];
  const out = open ? exitPoints(cave) : null;
  if (out) {
    const m = at(out.mouth.x, out.mouth.y);
    exit = inside(m) ? { ...m, rim: false } : { ...pinned(m), rim: true };
  }

  const specks = new Map<number, Mark>();
  const cell = (2 * range) / SPECK_CELLS;
  for (let i = 0; i < bodies.count; i++) {
    if (!bodies.alive[i] || bodies.carried?.[i] || !(KIND_VALUE[bodies.kind[i]] > 0)) continue;
    const m = at(bodies.x[i], bodies.y[i]);
    if (!inside(m)) continue;
    const cx = Math.min(SPECK_CELLS - 1, Math.floor((m.x + range) / cell)),
      cy = Math.min(SPECK_CELLS - 1, Math.floor((m.y + range) / cell));
    const key = cy * SPECK_CELLS + cx;
    if (!specks.has(key)) specks.set(key, { x: (cx + 0.5) * cell - range, y: (cy + 0.5) * cell - range });
  }

  const heading = turn(Math.cos(dozer.yaw), Math.sin(dozer.yaw));
  const corner = at(cave.grid.originX, cave.grid.originY);
  return {
    range,
    dozer: { x: 0, y: 0, heading: Math.atan2(heading.y, heading.x) },
    holes,
    exit,
    bots: bots.map((b) => at(b.x, b.y)).filter(inside),
    specks: [...specks.values()],
    belts: belts.map((b) => {
      const p = at(b.x0, b.y0),
        q = at(b.x1, b.y1);
      return { x0: p.x, y0: p.y, x1: q.x, y1: q.y };
    }),
    // a tile along the image's x is a tile along the floor's x, and likewise y: put through the same turn
    floor: [fy * TILE, -fx * TILE, -fx * TILE, -fy * TILE, corner.x, corner.y],
  };
}

/** The floor as a grey image, a pixel a tile, the first row the lowest in the world. */
export interface FloorImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * The cave's floor and rock as they stand now: floor pale, rock dark, and a brick wall that still stands a grey
 * between. `solid` is the rock the game holds, which counts a hidden chamber, the way out before it opens and a
 * wall until it is down, so what is not yet found stays rock and the map gives nothing away.
 */
export function floorImage(cave: Cave, solid: Uint8Array): FloorImage {
  const { cols, rows } = cave.grid;
  const data = new Uint8Array(cols * rows);
  for (let i = 0; i < data.length; i++) {
    const c = cave.cells[i];
    data[i] = !solid[i] ? FLOOR_LEVEL : c >= BRICK && c < EXIT ? WALL_LEVEL : ROCK_LEVEL;
  }
  return { width: cols, height: rows, data };
}
