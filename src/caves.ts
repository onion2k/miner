/**
 * The cave the game is, as content: the five rooms round the hollow, their
 * heaps, veins, belts, gates, hidden chambers, brick walls and side rooms,
 * and the hole in the middle. It is one `CaveSpec`, handed to the game by
 * whoever wires it up; nothing below the page imports it, so another cave is
 * another spec and the machinery in `cave.ts` does not change.
 */
import type { Area, CaveSpec, GemKind, HollowShape, Secret, Stash, Wall, Wing } from './cave';

/** The grid's size, and the middle of it in tiles, which is the hole: what the rooms are laid out from. */
const COLS = 104,
  ROWS = 64;
const C = COLS / 2,
  R = ROWS / 2;

/**
 * The shape of the cave, in tiles from the hole, which is where everything
 * is laid out from; a tile is TILE world units, so a tile n along is 4n in
 * the world. The hollow is in the middle; each other room is out one way
 * from it, down a corridor with a gate across it, and its extents along that
 * way are what says where its gate is, where the way into it starts, and
 * where going on into it seals the room behind.
 */
const HOLLOW: HollowShape = { rx: 12, ry: 7, alcove: { along: 14, rx: 4.5, ry: 4 } };

const WINGS: Wing[] = [
  // the hollow has none
  null as unknown as Wing,
  {
    dir: [0, -1],
    room: { along: 13, across: 0, half: 4, halfAcross: 14, seed: 0.4 },
    corridor: { from: 6, to: 10, across: [-2, 1] },
    gate: 8,
    mouth: HOLLOW.ry,
  },
  {
    dir: [0, 1],
    room: { along: 13, across: 0, half: 4, halfAcross: 15, seed: 3.3 },
    corridor: { from: 6, to: 10, across: [-2, 1] },
    gate: 8,
    mouth: HOLLOW.ry,
  },
  {
    dir: [1, 0],
    room: { along: 27, across: 1, half: 5, halfAcross: 9, seed: 5.2 },
    corridor: { from: 17, to: 22, across: [-1, 2] },
    gate: 19,
    mouth: 17,
  },
  {
    dir: [-1, 0],
    room: { along: 27, across: -1, half: 5, halfAcross: 9, seed: 2.2 },
    corridor: { from: 17, to: 22, across: [-2, 1] },
    gate: 19,
    mouth: 17,
  },
];

const S = 1,
  N = 2,
  E = 3,
  W = 4;

const AREAS: Area[] = [
  {
    name: 'The Hollow',
    blurb: 'coins and a few rubies',
    heaps: [
      { x: -30, y: 8, coins: 840, gems: [[1, 24]] },
      { x: 26, y: -8, coins: 840, gems: [[1, 22]] },
      { x: 6, y: 22, coins: 320, gems: [[1, 4]] },
    ],
    vein: { x: -36, y: -6, every: 1.2, coins: 1, gems: [[1, 0.04]] },
    cracks: [
      [-10, -14],
      [18, 12],
      [-28, -12],
      [34, 4],
    ],
    belt: null,
  },
  {
    name: 'South Gallery',
    blurb: 'rubies and emeralds',
    heaps: [
      {
        x: -24,
        y: -52,
        coins: 960,
        gems: [
          [1, 22],
          [2, 12],
        ],
      },
      {
        x: 22,
        y: -54,
        coins: 960,
        gems: [
          [1, 18],
          [2, 16],
        ],
      },
    ],
    vein: {
      x: 40,
      y: -50,
      every: 0.9,
      coins: 1,
      gems: [
        [1, 0.08],
        [2, 0.03],
      ],
    },
    cracks: [
      [0, -56],
      [-40, -50],
      [36, -58],
    ],
    belt: { spec: { x0: -2, y0: -46, x1: -2, y1: -8, width: 7, speed: 9 }, cost: 250 },
  },
  {
    name: 'North Vault',
    blurb: 'emeralds, sapphires, diamonds',
    heaps: [
      {
        x: -28,
        y: 52,
        coins: 1000,
        gems: [
          [2, 22],
          [3, 14],
          [4, 2],
        ],
      },
      {
        x: 24,
        y: 54,
        coins: 1000,
        gems: [
          [2, 18],
          [3, 16],
          [4, 2],
        ],
      },
    ],
    vein: {
      x: -44,
      y: 54,
      every: 0.7,
      coins: 1,
      gems: [
        [2, 0.08],
        [3, 0.05],
        [4, 0.015],
      ],
    },
    cracks: [
      [0, 56],
      [-44, 50],
      [40, 52],
    ],
    belt: { spec: { x0: -2, y0: 46, x1: -2, y1: 8, width: 7, speed: 9 }, cost: 500 },
  },
  // The two galleries either side: long rooms running north and south, reached through
  // the alcoves off the hollow. Added after the vault, so a save's areas keep their places;
  // `ORDER` is the order they open in.
  {
    name: 'East Gallery',
    blurb: 'rubies and sapphires',
    heaps: [
      {
        x: 104,
        y: 22,
        coins: 700,
        gems: [
          [1, 22],
          [3, 24],
        ],
      },
      {
        x: 110,
        y: -14,
        coins: 700,
        gems: [
          [1, 18],
          [3, 26],
        ],
      },
    ],
    vein: {
      x: 100,
      y: -26,
      every: 0.85,
      coins: 1,
      gems: [
        [1, 0.07],
        [3, 0.03],
      ],
    },
    cracks: [
      [108, 4],
      [102, 32],
      [112, -24],
    ],
    belt: { spec: { x0: 110, y0: 2, x1: 8, y1: 2, width: 7, speed: 10 }, cost: 400 },
  },
  {
    name: 'West Gallery',
    blurb: 'sapphires and diamonds',
    heaps: [
      {
        x: -104,
        y: -22,
        coins: 700,
        gems: [
          [3, 26],
          [4, 10],
        ],
      },
      {
        x: -110,
        y: 14,
        coins: 700,
        gems: [
          [3, 24],
          [4, 11],
        ],
      },
    ],
    vein: {
      x: -100,
      y: 26,
      every: 0.65,
      coins: 1,
      gems: [
        [3, 0.07],
        [4, 0.025],
      ],
    },
    cracks: [
      [-108, -4],
      [-102, -32],
      [-112, 24],
    ],
    belt: { spec: { x0: -110, y0: -2, x1: -8, y1: -2, width: 7, speed: 10 }, cost: 600 },
  },
];

/** The order the rooms open in, one when the one before is cleared: by what is in them. */
const ORDER = [0, 1, 3, 2, 4];

const SECRETS: Secret[] = [
  // off the south gallery's east end
  {
    area: 1,
    wall: [C + 16, R - 13, C + 17, R - 12],
    chamber: { cx: C + 20.5, cy: R - 12.5, rx: 3.2, ry: 2.2, seed: 1.1 },
    loot: {
      coins: 60,
      gems: [
        [2, 6],
        [5, 3],
      ],
    },
  },
  // off the north vault's west end
  {
    area: 2,
    wall: [C - 17, R + 11, C - 16, R + 12],
    chamber: { cx: C - 20.5, cy: R + 12.5, rx: 3.2, ry: 2.2, seed: 2.7 },
    loot: {
      coins: 80,
      gems: [
        [4, 3],
        [5, 5],
      ],
    },
  },
  // above the east gallery's north end
  {
    area: 3,
    wall: [C + 28, R + 11, C + 29, R + 12],
    chamber: { cx: C + 27, cy: R + 14, rx: 3.5, ry: 1.8, seed: 0.6 },
    loot: {
      coins: 80,
      gems: [
        [3, 6],
        [5, 4],
      ],
    },
  },
  // below the west gallery's south end
  {
    area: 4,
    wall: [C - 29, R - 11, C - 28, R - 10],
    chamber: { cx: C - 28, cy: R - 13.5, rx: 3.5, ry: 2.2, seed: 3.9 },
    loot: {
      coins: 100,
      gems: [
        [4, 5],
        [5, 6],
      ],
    },
  },
];

const WALLS: Wall[] = [];
const STASHES: Stash[] = [];

/** A side room: a corridor out from a room, a wall across it, and a room at the end. */
function sideRoom(
  name: string,
  area: number,
  grade: 1 | 2 | 3,
  corridor: [number, number, number, number],
  wall: [number, number, number, number],
  room: Stash['room'] & object,
  loot: Stash['loot'],
  treasure: [GemKind, number][] = [],
) {
  WALLS.push({ area, grade, tiles: wall, treasure });
  STASHES.push({ name, area, at: [room.cx, room.cy], loot, corridor, room });
}

sideRoom(
  'South Cellar',
  S,
  1,
  [C - 2, R - 22, C + 1, R - 16],
  [C - 2, R - 20, C + 1, R - 20],
  { cx: C, cy: R - 25, rx: 9, ry: 3, seed: 1.9 },
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
sideRoom(
  'East Annex',
  E,
  2,
  [C + 31, R, C + 37, R + 2],
  [C + 35, R, C + 35, R + 2],
  { cx: C + 42, cy: R + 1, rx: 5, ry: 6, seed: 0.8 },
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
sideRoom(
  'North Loft',
  N,
  2,
  [C - 2, R + 16, C + 1, R + 22],
  [C - 2, R + 20, C + 1, R + 20],
  { cx: C, cy: R + 25, rx: 9, ry: 3, seed: 4.4 },
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
sideRoom(
  'West Annex',
  W,
  3,
  [C - 37, R - 2, C - 31, R],
  [C - 35, R - 2, C - 35, R],
  { cx: C - 42, cy: R - 1, rx: 5, ry: 6, seed: 3.1 },
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

/** How many barrels each room has, the hollow first. */
const BARRELS_IN = [3, 5, 5, 5, 5];

/** The cave as it is: five rooms round a hollow, with the hole in the middle of it. */
export const FIVE_ROOMS: CaveSpec = {
  cols: COLS,
  rows: ROWS,
  holes: [{ x: 0, y: 0, radius: 5.5, depth: 14 }],
  hollow: HOLLOW,
  wings: WINGS,
  areas: AREAS,
  order: ORDER,
  secrets: SECRETS,
  walls: WALLS,
  stashes: STASHES,
  barrelsIn: BARRELS_IN,
};
