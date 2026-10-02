/**
 * The run the game is, as content: six caves one after another, each its own
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
import {
  TILE,
  type BeltOffer,
  type CaveSpec,
  type CurrentSpec,
  type Cutting,
  type Flow,
  type HoleSpec,
  type Shape,
  type Stash,
  type Wall,
} from './cave';
import { DRAIN_GAP, HOLE_GAP } from './currents';

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
    /** Another hole of the cave's, `a` tiles east and `b` north of the first, the same size. */
    holeAt: (a: number, b: number) => ({
      x: (hx - cols / 2) * TILE + a * TILE,
      y: (hy - rows / 2) * TILE + b * TILE,
      radius: 5.5,
      depth: 14,
    }),
    /** An ellipse of floor, or of rock put back, its middle `a` tiles east and `b` north of the hole. */
    ellipse: (a: number, b: number, rx: number, ry: number, seed: number, rock = false): Shape =>
      rock
        ? { kind: 'ellipse', cx: hx + a, cy: hy + b, rx, ry, seed, rock: true }
        : { kind: 'ellipse', cx: hx + a, cy: hy + b, rx, ry, seed },
    /** A winding tunnel through points `a`, `b` tiles east and north of the hole, `width` tiles across. */
    tunnel: (points: [number, number][], width: number, seed: number): Shape => ({
      kind: 'tunnel',
      points: points.map(([a, b]): [number, number] => [hx + a, hy + b]),
      width,
      seed,
    }),
    /** A cavern of noise, `fill` of the box from the tile `a0`, `b0` to `a1`, `b1`, counted from the hole. */
    cavern: (a0: number, b0: number, a1: number, b1: number, seed: number, fill: number): Shape => ({
      kind: 'cavern',
      box: [hx + a0, hy + b0, hx + a1, hy + b1],
      seed,
      fill,
    }),
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

/** How wide a current is, a little wider than the belt it is built on, and how deep and wide a drain is. */
const CURRENT_WIDTH = 7;
const DRAIN = { radius: 3.5, depth: 10 };
/** How fast each flow runs: water and lava at about the pace of a belt, ice faster. */
const FLOW_SPEED: Record<Flow, number> = { water: 9, lava: 9, ice: 13 };

/**
 * A current that runs to a hole: it starts `from` units away from the hole's middle in the direction `deg`
 * degrees round it (0 east, 90 north), and runs at the hole, ending a rim's gap short of it so that the floor's
 * slope into the pit takes what it carries, as a belt's end does.
 */
function currentToHole(id: string, flow: Flow, hole: HoleSpec, deg: number, from: number): CurrentSpec {
  const a = (deg * Math.PI) / 180,
    ux = Math.cos(a),
    uy = Math.sin(a);
  const end = hole.radius + HOLE_GAP;
  return {
    id,
    flow,
    x0: hole.x + ux * from,
    y0: hole.y + uy * from,
    x1: hole.x + ux * end,
    y1: hole.y + uy * end,
    width: CURRENT_WIDTH,
    speed: FLOW_SPEED[flow],
  };
}

/**
 * A current that ends in a drain: it starts at (x, y), in world units as `npm run caves:map` prints them, and
 * runs `length` units in the direction `deg` degrees round (0 east, 90 north). The cave puts the drain a rim's
 * gap past its end (`DRAIN_GAP`), where the floor's slope takes what is carried over.
 */
function currentToDrain(id: string, flow: Flow, x: number, y: number, deg: number, length: number): CurrentSpec {
  const a = (deg * Math.PI) / 180;
  // The drain's middle goes on a whole unit each way, which is the lattice the floor is drawn on: a collar laid
  // off it meets the floor in a ragged edge. The current is turned the little it takes to run at where that puts it.
  const past = DRAIN.radius + DRAIN_GAP;
  const dx = Math.round(x + Math.cos(a) * (length + past)) - x,
    dy = Math.round(y + Math.sin(a) * (length + past)) - y;
  const reach = Math.hypot(dx, dy);
  return {
    id,
    flow,
    x0: x,
    y0: y,
    x1: x + (dx / reach) * (reach - past),
    y1: y + (dy / reach) * (reach - past),
    width: CURRENT_WIDTH,
    speed: FLOW_SPEED[flow],
    drain: { ...DRAIN },
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
    // a brook from the south, which the first push to go astray is glad of: it runs into the hole
    currents: [currentToHole('hollow-brook', 'water', p.hole, 300, 30)],
    entry: p.cutting(-28, -2, -12, 1, [-1, 0]),
    exit: p.cutting(12, -2, 27, 1, [1, 0]),
    secrets: [],
    walls: [],
    stashes: [],
    barrels: 3,
    geodes: {
      count: 1,
      holds: [
        [1, 3],
        [2, 2],
        [3, 1],
      ],
    },
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
    // a runnel along the foot of the west lobe, under the west heap: what slips off it is gone
    currents: [currentToDrain('south-runnel', 'water', -66, -12, 345, 16)],
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
    geodes: {
      count: 2,
      holds: [
        [1, 2],
        [2, 2],
        [3, 2],
      ],
    },
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
    label: 'Conveyor, top of the ring',
    spec: { x0: p.pt(130, 34).x, y0: p.pt(130, 34).y, x1: p.pt(9, 3).x, y1: p.pt(9, 3).y, width: 7, speed: 10 },
    cost: 400,
  };
  // along the bottom of the ring, under the island's west tip, from the bottom heap, aimed at the hole so that what
  // it carries is over the rim when it leaves the belt: the belt ends near enough for that, as the top one does
  const from = p.pt(114, -70),
    to = p.pt(5.5, -3.4);
  const bottomBelt: BeltOffer = {
    id: 'east-belt-bottom',
    label: 'Conveyor, bottom of the ring',
    spec: { x0: from.x, y0: from.y, x1: to.x, y1: to.y, width: 7, speed: 10 },
    cost: 450,
  };
  return {
    id: 'east-gallery',
    name: 'East Gallery',
    blurb: 'rubies and sapphires',
    biome: 'lava',
    cols: p.cols,
    rows: p.rows,
    shapes: [p.ellipse(28, -1, 34, 19, 5.2), p.ellipse(31.5, -2.6, 20, 5.5, 2.4, true)],
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
    belts: [belt, bottomBelt],
    // a flow of lava past the top heap's east side, which pours away into a drain
    currents: [currentToDrain('east-lava', 'lava', 46, 32, 90, 16)],
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
    geodes: {
      count: 2,
      holds: [
        [1, 2],
        [2, 2],
        [3, 3],
      ],
    },
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
    holes: [p.hole, p.holeAt(25, 0)],
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
    // a fast stream of ice down into the second hole, from the north of its cavern
    currents: [currentToHole('north-ice', 'ice', p.holeAt(25, 0), 85, 34)],
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
    geodes: {
      count: 3,
      holds: [
        [1, 2],
        [2, 2],
        [3, 1],
        [4, 1],
      ],
    },
  } satisfies CaveSpec;
})();

// ---- 5. The Warrens: five caverns in a chain, joined by winding tunnels, a hole in the second and the fourth ----

const warrens = (() => {
  // everything below is counted in tiles from the second cavern's middle, and its hole stands a little west of that, clear of the
  // cavern's eastern rim where the drones wait
  const p = plan(120, 60, 38, 42);
  const room = sideRoom(
    'Warren Store',
    2,
    p.tiles(-2, -26, 1, -8),
    p.tiles(-2, -20, 1, -20),
    { cx: p.mid(0, -30)[0], cy: p.mid(0, -30)[1], rx: 8, ry: 5, seed: 2.6 },
    {
      coins: 450,
      gems: [
        [2, 16],
        [3, 14],
        [5, 2],
      ],
    },
    [[3, 3]],
  );
  return {
    id: 'warrens',
    name: 'The Warrens',
    blurb: 'emeralds and sapphires, in caverns joined by tunnels',
    biome: 'fungal',
    cols: p.cols,
    rows: p.rows,
    shapes: [
      p.cavern(-29, -26, -15, -2, 1.3, 0.62),
      p.cavern(-7, -12, 7, 12, 2.4, 0.62),
      p.cavern(15, -34, 29, -10, 3.5, 0.62),
      p.cavern(37, -14, 51, 10, 4.6, 0.62),
      p.cavern(59, -30, 73, -6, 5.7, 0.62),
      p.tunnel(
        [
          [-22, -14],
          [-13, -12],
          [-9, -4],
          [0, 0],
        ],
        4,
        1.1,
      ),
      p.tunnel(
        [
          [0, 0],
          [8, 0],
          [12, -12],
          [19, -16],
          [22, -22],
        ],
        4,
        2.2,
      ),
      p.tunnel(
        [
          [22, -22],
          [30, -24],
          [34, -12],
          [41, -6],
          [44, -2],
        ],
        4,
        3.3,
      ),
      p.tunnel(
        [
          [44, -2],
          [53, 0],
          [57, -12],
          [62, -16],
          [66, -18],
        ],
        4,
        4.4,
      ),
    ],
    holes: [p.holeAt(-2, 0), p.holeAt(44, -2)],
    heaps: [
      {
        ...p.pt(-72, -48),
        coins: 440,
        gems: [
          [2, 22],
          [3, 14],
        ],
      },
      {
        ...p.pt(20, -8),
        coins: 440,
        gems: [
          [2, 22],
          [3, 14],
        ],
      },
      {
        ...p.pt(196, -8),
        coins: 440,
        gems: [
          [2, 22],
          [3, 14],
        ],
      },
    ],
    vein: {
      ...p.pt(272, -64),
      every: 0.75,
      coins: 1,
      gems: [
        [2, 0.07],
        [3, 0.05],
      ],
    },
    cracks: [p.spot(-88, -56), p.spot(88, -88), p.spot(196, 8)],
    belts: [],
    // one into the fourth cavern's hole, down from the north-east above its heap, and one into a drain beside the
    // first cavern's heap, on the side away from the tunnel
    currents: [
      currentToHole('warrens-spring', 'water', p.holeAt(44, -2), 45, 26),
      currentToDrain('warrens-sump', 'water', -182, -26, 90, 22),
    ],
    lampSpacing: 18,
    // its glowing caps want the dark between them
    floorLampSpacing: 28,
    dressing: 0.6,
    entry: p.cutting(-36, -16, -26, -13, [-1, 0]),
    exit: p.cutting(64, -24, 78, -21, [1, 0]),
    secrets: [
      {
        wall: p.tiles(-10, 5, -8, 6),
        chamber: { cx: p.mid(-13.5, 5.5)[0], cy: p.mid(-13.5, 5.5)[1], rx: 3.8, ry: 3, seed: 5.1 },
        loot: {
          coins: 80,
          gems: [
            [3, 5],
            [5, 5],
          ],
        },
      },
    ],
    walls: [room.wall],
    stashes: [room.stash],
    barrels: 5,
    geodes: {
      count: 2,
      holds: [
        [1, 3],
        [2, 2],
        [3, 1],
        [4, 1],
      ],
    },
  } satisfies CaveSpec;
})();

// ---- 6. The West Gallery: a long hall with two rows of pillars, the hole at its near end, and a way out to the Deep ----

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
    // a drain off the lane the belt runs along, and well north of the two heaps at the far end: nearer, it took
    // what rolled off the top one as it settled, with nobody touching anything
    currents: [currentToDrain('west-seep', 'water', 48, 22, 340, 16)],
    entry: p.cutting(-4, -25, -1, -10, [0, -1]),
    // up out of the hall's north wall, in the middle of it, clear of the annex's room to the east and the pillars to the south
    exit: p.cutting(18, 10, 21, 26, [0, 1]),
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
    geodes: {
      count: 3,
      holds: [
        [1, 3],
        [2, 3],
        [3, 2],
        [4, 1],
      ],
    },
  } satisfies CaveSpec;
})();

// ---- 7. The Deep: a great hall with pillars and islands, winding side passages, three holes, the last cave ----

const deep = (() => {
  // the hole by the way in is the plan's; every other place is counted in tiles from it: the hall is 124 wide, so the grid is
  // 160 by 84, twice the East Gallery's area
  const p = plan(160, 84, 30, 42);
  const vault = sideRoom(
    'Deep Vault',
    3,
    p.tiles(84, 18, 87, 33),
    p.tiles(84, 26, 87, 26),
    { cx: p.mid(85.5, 35)[0], cy: p.mid(85.5, 35)[1], rx: 8, ry: 3.4, seed: 6.1 },
    {
      coins: 600,
      gems: [
        [4, 14],
        [5, 6],
      ],
    },
    [
      [4, 4],
      [5, 2],
    ],
  );
  // a heap's gems: the richest in the game, sapphires and diamonds
  const richHeap = (a: number, b: number, coins: number, sapphires: number, diamonds: number) => ({
    ...p.pt(a * 4, b * 4),
    coins,
    gems: [
      [3, sapphires],
      [4, diamonds],
    ] as [3 | 4, number][],
  });
  const h1 = p.hole,
    h2 = p.holeAt(58, -10),
    h3 = p.holeAt(108, 4);
  /** A belt from a heap to a hole, ending a little past the rim on the heap's side so what it carries goes over. */
  const beltTo = (id: string, label: string, from: [number, number], hole: { x: number; y: number }, cost: number) => {
    const start = p.pt(from[0] * 4, from[1] * 4);
    const len = Math.hypot(start.x - hole.x, start.y - hole.y);
    const end = { x: hole.x + ((start.x - hole.x) / len) * 7.5, y: hole.y + ((start.y - hole.y) / len) * 7.5 };
    return {
      id,
      label,
      spec: { x0: start.x, y0: start.y, x1: end.x, y1: end.y, width: 7, speed: 10 },
      cost,
    } satisfies BeltOffer;
  };
  return {
    id: 'deep',
    name: 'The Deep',
    blurb: 'diamonds and gold bars, in a great hall',
    biome: 'geode',
    cols: p.cols,
    rows: p.rows,
    shapes: [
      p.rect(-14, -8, 14, 8),
      p.ellipse(56, 0, 62, 24, 1.3),
      // the side passages, each a winding way out of the hall into a cavern of its own
      p.tunnel(
        [
          [6, 6],
          [4, 14],
          [10, 22],
          [12, 28],
        ],
        4,
        2.1,
      ),
      p.cavern(-2, 26, 28, 38, 3.2, 0.62),
      p.tunnel(
        [
          [58, -14],
          [54, -22],
          [60, -28],
        ],
        4,
        4.3,
      ),
      p.cavern(44, -38, 76, -27, 5.4, 0.62),
      p.tunnel(
        [
          [108, 12],
          [112, 20],
          [106, 28],
        ],
        4,
        6.5,
      ),
      p.cavern(96, 26, 124, 38, 7.6, 0.62),
      p.tunnel(
        [
          [98, -8],
          [104, -22],
          [100, -30],
        ],
        4,
        8.7,
      ),
      p.cavern(88, -38, 118, -28, 9.8, 0.62),
      // the pillars and islands of the hall, put back in rock
      p.rect(46, 10, 49, 13, true),
      p.rect(62, 14, 65, 17, true),
      p.rect(82, 10, 85, 13, true),
      p.rect(98, 14, 101, 17, true),
      p.rect(24, -19, 27, -16, true),
      p.rect(40, -16, 43, -13, true),
      p.rect(76, -20, 79, -17, true),
      p.rect(96, -14, 99, -11, true),
      p.ellipse(80, 2, 7, 5, 2.9, true),
      p.ellipse(34, -2, 5, 4, 3.7, true),
    ],
    holes: [h1, h2, h3],
    heaps: [
      richHeap(24, -12, 450, 12, 6),
      richHeap(30, 16, 450, 12, 6),
      richHeap(84, -16, 450, 12, 6),
      richHeap(92, 13, 450, 12, 6),
      richHeap(12, 32, 450, 12, 6),
      richHeap(60, -33, 450, 12, 6),
      richHeap(110, 32, 450, 12, 6),
      richHeap(100, -31, 450, 12, 6),
    ],
    vein: {
      ...p.pt(464, -24),
      every: 0.6,
      coins: 1,
      gems: [
        [3, 0.06],
        [4, 0.03],
      ],
    },
    cracks: [p.spot(120, -60), p.spot(280, -24), p.spot(400, -20), p.spot(280, -56)],
    belts: [
      beltTo('deep-belt-north', 'Conveyor, north-west hall', [30, 16], h1, 700),
      beltTo('deep-belt-south', 'Conveyor, south-east hall', [84, -16], h2, 800),
    ],
    // one into the far hole, which has no belt, from the north, and one into a drain beside the south-west heap
    currents: [
      currentToHole('deep-spring', 'water', h3, 90, 34),
      currentToDrain('deep-sump', 'water', -126, -78, 105, 16),
    ],
    entry: p.cutting(-28, -2, -12, 1, [-1, 0]),
    exit: null,
    secrets: [
      {
        wall: p.tiles(-12, 9, -9, 10),
        chamber: { cx: p.mid(-10.5, 13.5)[0], cy: p.mid(-10.5, 13.5)[1], rx: 4.5, ry: 3, seed: 7.3 },
        loot: {
          coins: 120,
          gems: [
            [4, 6],
            [5, 8],
          ],
        },
      },
    ],
    walls: [vault.wall],
    stashes: [vault.stash],
    barrels: 6,
    geodes: {
      count: 4,
      holds: [
        [1, 5],
        [2, 4],
        [3, 4],
        [4, 3],
      ],
    },
    // twice the bodies of the East Gallery: the rest of the settling is done in the frames after, and the heaps are far
    // down the way in from where the machine arrives
    settle: 45,
    // a great length of rock face for its floor, with three times the lamps and four times the dressing of the East Gallery
    // at the usual spacing, and a frame over a third heavier to draw from high up; at these it draws no heavier than the East
    // Gallery does (see `smoke/budgets.spec.ts`), and keeps its neon, which goes from the future altogether below a share of 0.35
    lampSpacing: 26,
    // the crystals' own glow is the point of the Deep, so the hall is lit sparsely between them
    floorLampSpacing: 40,
    dressing: 0.4,
  } satisfies CaveSpec;
})();

/** The caves in order, from the first to the last: the run. */
export const RUN: CaveSpec[] = [hollow, southGallery, eastGallery, northVault, warrens, westGallery, deep];
