/**
 * The run the game is, as content: five caves one after another, each its own
 * grid, hole, heaps, vein, belt, hidden chamber, brick wall and side room, a
 * way in and (but for the last) a way out. Each is one `CaveSpec`, handed to
 * the game by whoever wires it up; nothing below the page imports this, so
 * another cave is another spec and the machinery in `cave.ts` does not change.
 *
 * The caves were the five rooms of one cave, and keep what was in them: the
 * heaps, gems, loot, wall grades, belt prices and barrels are as they were.
 * What is new is where they stand. Each is laid out afresh round its own hole
 * from the sketches the user agreed, with no heap further from the hole than
 * about one and a half times what it was (the haul limits in `scripts/hauls.ts`),
 * which is why the long galleries are no longer long, or have a belt from the
 * far end.
 *
 * Each cave is laid out in tiles from its hole: `plan` turns those into tiles
 * from the grid's corner for the carving and the chambers, and into world
 * units for the heaps. The hole stands where the cave wants it in its grid, not
 * at the middle of it, so a cave hugs its grid and its ways in and out are a
 * short cutting and not a long one out to the far side of the page.
 */
import { TILE, type BeltOffer, type CaveSpec, type Cutting, type Shape, type Stash, type Wall } from './cave';

/**
 * A cave's grid, with its hole at the tile `hx`, `hy` from the grid's corner, and the ways of saying
 * where a place in it is: counted in tiles east and north of the hole, or in world units from it.
 */
function plan(cols: number, rows: number, hx: number, hy: number) {
  return {
    cols,
    rows,
    /** The hole, where the tile it is over is centred in the world. */
    hole: { x: (hx - cols / 2) * TILE, y: (hy - rows / 2) * TILE, radius: 5.5, depth: 14 },
    /** An ellipse of floor, or of rock put back, its middle `a` tiles east and `b` north of the hole. */
    ellipse: (a: number, b: number, rx: number, ry: number, seed: number, rock = false): Shape =>
      rock
        ? { kind: 'ellipse', cx: hx + a, cy: hy + b, rx, ry, seed, rock: true }
        : { kind: 'ellipse', cx: hx + a, cy: hy + b, rx, ry, seed },
    /** A box of floor, or of rock put back, from the tile `a0`, `b0` to `a1`, `b1`, inclusive. */
    rect: (a0: number, b0: number, a1: number, b1: number, rock = false): Shape =>
      rock
        ? { kind: 'rect', tiles: [hx + a0, hy + b0, hx + a1, hy + b1], rock: true }
        : { kind: 'rect', tiles: [hx + a0, hy + b0, hx + a1, hy + b1] },
    /** The tiles from `a0`, `b0` to `a1`, `b1`, counted from the grid's corner. */
    tiles: (a0: number, b0: number, a1: number, b1: number): [number, number, number, number] => [
      hx + a0,
      hy + b0,
      hx + a1,
      hy + b1,
    ],
    /** A cutting over those tiles, out of the cave toward `out`. */
    cutting: (a0: number, b0: number, a1: number, b1: number, out: [number, number]): Cutting => ({
      tiles: [hx + a0, hy + b0, hx + a1, hy + b1],
      out,
    }),
    /** A point `dx` east and `dy` north of the hole, in world units. */
    pt: (dx: number, dy: number) => ({ x: (hx - cols / 2) * TILE + dx, y: (hy - rows / 2) * TILE + dy }),
    /** The same point, as the pair the cracks are listed in. */
    spot: (dx: number, dy: number): [number, number] => [(hx - cols / 2) * TILE + dx, (hy - rows / 2) * TILE + dy],
    /** A middle, in tiles from the grid's corner, for a room off the cave: `a` east and `b` north of the hole. */
    mid: (a: number, b: number): [number, number] => [hx + a, hy + b],
  };
}

/** A side room: a corridor out from a cave, a wall across it, and a room at the end. */
function sideRoom(
  name: string,
  grade: 1 | 2 | 3,
  corridor: [number, number, number, number],
  wall: [number, number, number, number],
  room: NonNullable<Stash['room']>,
  loot: Stash['loot'],
  treasure: Wall['treasure'] = [],
): { wall: Wall; stash: Stash } {
  return {
    wall: { grade, tiles: wall, treasure },
    stash: { name, at: [room.cx, room.cy], loot, corridor, room },
  };
}

// ---- 1. The Hollow: one oval, the hole in the middle, three heaps round it ----

const hollow = (() => {
  const p = plan(60, 40, 30, 20);
  return {
    id: 'hollow',
    name: 'The Hollow',
    blurb: 'coins and a few rubies',
    biome: null,
    cols: p.cols,
    rows: p.rows,
    shapes: [p.ellipse(0, 0, 15, 10, 1.7)],
    holes: [p.hole],
    heaps: [
      { ...p.pt(-30, 8), coins: 840, gems: [[1, 24]] },
      { ...p.pt(26, -8), coins: 840, gems: [[1, 22]] },
      { ...p.pt(6, 18), coins: 320, gems: [[1, 4]] },
    ],
    vein: { ...p.pt(-36, -6), every: 1.2, coins: 1, gems: [[1, 0.04]] },
    cracks: [p.spot(-10, -14), p.spot(18, 12), p.spot(-28, -12), p.spot(34, 4)],
    belts: [],
    entry: p.cutting(-28, -2, -12, 1, [-1, 0]),
    exit: p.cutting(12, -2, 27, 1, [1, 0]),
    secrets: [],
    walls: [],
    stashes: [],
    barrels: 3,
  } satisfies CaveSpec;
})();

// ---- 2. The South Gallery: two lobes, the hole at the waist between them ----

const southGallery = (() => {
  const p = plan(94, 54, 50, 26);
  const cellar = sideRoom(
    'South Cellar',
    1,
    p.tiles(10, -16, 13, -4),
    p.tiles(10, -9, 13, -9),
    { cx: p.mid(11.5, -18)[0], cy: p.mid(11.5, -18)[1], rx: 8, ry: 3, seed: 1.9 },
    {
      coins: 400,
      gems: [
        [1, 20],
        [2, 12],
        [5, 2],
      ],
    },
    [[2, 3]],
  );
  const belt: BeltOffer = {
    id: 'south-belt',
    spec: { x0: p.pt(64, 6).x, y0: p.pt(64, 6).y, x1: p.pt(9, 1).x, y1: p.pt(9, 1).y, width: 7, speed: 9 },
    cost: 250,
  };
  return {
    id: 'south-gallery',
    name: 'South Gallery',
    blurb: 'rubies and emeralds',
    biome: 'jungle',
    cols: p.cols,
    rows: p.rows,
    shapes: [
      p.ellipse(-16, 1, 13, 11, 0.4),
      p.ellipse(0, 0, 9, 7, 3.3),
      p.rect(6, -3, 14, 4),
      p.ellipse(24, 3, 13, 12, 5.2),
    ],
    holes: [p.hole],
    heaps: [
      {
        ...p.pt(-56, 6),
        coins: 960,
        gems: [
          [1, 22],
          [2, 12],
        ],
      },
      {
        ...p.pt(72, 8),
        coins: 960,
        gems: [
          [1, 18],
          [2, 16],
        ],
      },
    ],
    vein: {
      ...p.pt(112, -14),
      every: 0.9,
      coins: 1,
      gems: [
        [1, 0.08],
        [2, 0.03],
      ],
    },
    cracks: [p.spot(-60, -24), p.spot(100, -6), p.spot(120, 30)],
    belts: [belt],
    entry: p.cutting(-48, -6, -24, -3, [-1, 0]),
    exit: p.cutting(24, 10, 27, 25, [0, 1]),
    secrets: [
      {
        wall: p.tiles(-24, 12, -21, 13),
        chamber: { cx: p.mid(-22.5, 16.5)[0], cy: p.mid(-22.5, 16.5)[1], rx: 4.5, ry: 3, seed: 1.1 },
        loot: {
          coins: 60,
          gems: [
            [2, 6],
            [5, 3],
          ],
        },
      },
    ],
    walls: [cellar.wall],
    stashes: [cellar.stash],
    barrels: 5,
  } satisfies CaveSpec;
})();

// ---- 3. The East Gallery: a ring round an island of rock, the hole on the west of it ----

const eastGallery = (() => {
  const p = plan(112, 60, 27, 32);
  const annex = sideRoom(
    'East Annex',
    2,
    p.tiles(55, -3, 68, -1),
    p.tiles(64, -3, 64, -1),
    { cx: p.mid(72, -2)[0], cy: p.mid(72, -2)[1], rx: 5, ry: 6, seed: 0.8 },
    {
      coins: 450,
      gems: [
        [1, 16],
        [3, 18],
        [5, 3],
      ],
    },
    [
      [3, 4],
      [5, 1],
    ],
  );
  const belt: BeltOffer = {
    id: 'east-belt',
    spec: { x0: p.pt(130, 34).x, y0: p.pt(130, 34).y, x1: p.pt(9, 3).x, y1: p.pt(9, 3).y, width: 7, speed: 10 },
    cost: 400,
  };
  return {
    id: 'east-gallery',
    name: 'East Gallery',
    blurb: 'rubies and sapphires',
    biome: 'lava',
    cols: p.cols,
    rows: p.rows,
    shapes: [p.ellipse(28, -1, 34, 19, 5.2), p.ellipse(30, -4, 20, 7, 2.4, true)],
    holes: [p.hole],
    heaps: [
      {
        ...p.pt(136, 36),
        coins: 700,
        gems: [
          [1, 22],
          [3, 24],
        ],
      },
      {
        ...p.pt(115, -62),
        coins: 700,
        gems: [
          [1, 18],
          [3, 26],
        ],
      },
    ],
    vein: {
      ...p.pt(210, -8),
      every: 0.85,
      coins: 1,
      gems: [
        [1, 0.07],
        [3, 0.03],
      ],
    },
    cracks: [p.spot(60, 56), p.spot(212, -12), p.spot(100, -66)],
    belts: [belt],
    entry: p.cutting(-25, -2, -6, 1, [-1, 0]),
    exit: p.cutting(20, 14, 23, 25, [0, 1]),
    secrets: [
      {
        wall: p.tiles(50, -18, 53, -16),
        chamber: { cx: p.mid(51.5, -22.5)[0], cy: p.mid(51.5, -22.5)[1], rx: 4.5, ry: 2.6, seed: 0.6 },
        loot: {
          coins: 80,
          gems: [
            [3, 6],
            [5, 4],
          ],
        },
      },
    ],
    walls: [annex.wall],
    stashes: [annex.stash],
    barrels: 5,
  } satisfies CaveSpec;
})();

// ---- 4. The North Vault: two caverns joined by a narrow neck ----

const northVault = (() => {
  const p = plan(86, 50, 29, 19);
  const loft = sideRoom(
    'North Loft',
    2,
    p.tiles(32, 8, 35, 19),
    p.tiles(32, 13, 35, 13),
    { cx: p.mid(33.5, 21)[0], cy: p.mid(33.5, 21)[1], rx: 9, ry: 3, seed: 4.4 },
    {
      coins: 500,
      gems: [
        [2, 16],
        [3, 12],
        [4, 4],
        [5, 3],
      ],
    },
    [
      [4, 2],
      [5, 1],
    ],
  );
  const belt: BeltOffer = {
    id: 'north-belt',
    spec: { x0: p.pt(64, 1).x, y0: p.pt(64, 1).y, x1: p.pt(9, 1).x, y1: p.pt(9, 1).y, width: 7, speed: 9 },
    cost: 500,
  };
  return {
    id: 'north-vault',
    name: 'North Vault',
    blurb: 'emeralds, sapphires, diamonds',
    biome: 'ice',
    cols: p.cols,
    rows: p.rows,
    shapes: [p.ellipse(0, 0, 10, 9, 2.2), p.rect(8, -2, 15, 1), p.ellipse(25, 0, 13, 12, 4.1)],
    holes: [p.hole],
    heaps: [
      {
        ...p.pt(64, -12),
        coins: 1000,
        gems: [
          [2, 22],
          [3, 14],
          [4, 2],
        ],
      },
      {
        ...p.pt(64, 14),
        coins: 1000,
        gems: [
          [2, 18],
          [3, 16],
          [4, 2],
        ],
      },
    ],
    vein: {
      ...p.pt(100, 10),
      every: 0.7,
      coins: 1,
      gems: [
        [2, 0.08],
        [3, 0.05],
        [4, 0.015],
      ],
    },
    cracks: [p.spot(-20, 10), p.spot(90, -14), p.spot(100, 20)],
    belts: [belt],
    entry: p.cutting(-27, -2, -6, 1, [-1, 0]),
    exit: p.cutting(32, -2, 52, 1, [1, 0]),
    secrets: [
      {
        wall: p.tiles(-9, -10, -6, -8),
        chamber: { cx: p.mid(-7.5, -13.5)[0], cy: p.mid(-7.5, -13.5)[1], rx: 4.5, ry: 3, seed: 2.7 },
        loot: {
          coins: 80,
          gems: [
            [4, 3],
            [5, 5],
          ],
        },
      },
    ],
    walls: [loft.wall],
    stashes: [loft.stash],
    barrels: 5,
  } satisfies CaveSpec;
})();

// ---- 5. The West Gallery: a long hall with two rows of pillars, the hole at its near end ----

const westGallery = (() => {
  const p = plan(54, 56, 11, 27);
  const annex = sideRoom(
    'West Annex',
    3,
    p.tiles(32, 11, 35, 18),
    p.tiles(32, 15, 35, 15),
    { cx: p.mid(33.5, 21)[0], cy: p.mid(33.5, 21)[1], rx: 7, ry: 2.6, seed: 3.1 },
    {
      coins: 500,
      gems: [
        [3, 16],
        [4, 8],
        [5, 4],
      ],
    },
    [
      [4, 3],
      [5, 2],
    ],
  );
  const belt: BeltOffer = {
    id: 'west-belt',
    spec: { x0: p.pt(146, -14).x, y0: p.pt(146, -14).y, x1: p.pt(8, -1).x, y1: p.pt(8, -1).y, width: 7, speed: 10 },
    cost: 600,
  };
  // two rows of pillars down the hall, north of the lane the belt runs along
  const pillars: Shape[] = [];
  for (let a = 10; a <= 28; a += 9) {
    pillars.push(p.rect(a, 3, a + 1, 4, true));
    pillars.push(p.rect(a + 6, 8, a + 7, 9, true));
  }
  return {
    id: 'west-gallery',
    name: 'West Gallery',
    blurb: 'sapphires and diamonds',
    biome: 'future',
    cols: p.cols,
    rows: p.rows,
    shapes: [p.rect(-8, -10, 40, 12), ...pillars],
    holes: [p.hole],
    heaps: [
      {
        ...p.pt(140, -24),
        coins: 700,
        gems: [
          [3, 26],
          [4, 10],
        ],
      },
      {
        ...p.pt(140, -4),
        coins: 700,
        gems: [
          [3, 24],
          [4, 11],
        ],
      },
    ],
    vein: {
      ...p.pt(152, -10),
      every: 0.65,
      coins: 1,
      gems: [
        [3, 0.07],
        [4, 0.025],
      ],
    },
    cracks: [p.spot(60, -20), p.spot(100, 10), p.spot(150, 24)],
    belts: [belt],
    entry: p.cutting(-4, -25, -1, -10, [0, -1]),
    exit: null,
    secrets: [
      {
        wall: p.tiles(22, -12, 25, -11),
        chamber: { cx: p.mid(23.5, -15.5)[0], cy: p.mid(23.5, -15.5)[1], rx: 4.5, ry: 3, seed: 3.9 },
        loot: {
          coins: 100,
          gems: [
            [4, 5],
            [5, 6],
          ],
        },
      },
    ],
    walls: [annex.wall],
    stashes: [annex.stash],
    barrels: 5,
  } satisfies CaveSpec;
})();

/** The caves in order, from the first to the last: the run. */
export const RUN: CaveSpec[] = [hollow, southGallery, eastGallery, northVault, westGallery];
