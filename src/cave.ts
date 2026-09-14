/**
 * The cave: a grid of tiles, each rock or open, carved as a few wobbly
 * ellipses joined by corridors. Four of the corridors are blocked by gates —
 * rock that comes down when the room before is cleared — and each room has
 * heaps of coins, which is all it has, and somewhere a conveyor could run.
 * The last room also has a vein, which trickles more in once the whole cave
 * is clear, so there is still something to push.
 *
 * World units: a coin is about two across, a bulldozer about six, the whole
 * cave a couple of hundred across and more than that wide. Z is up and the
 * floor is z = 0.
 */

export const TILE = 4;
export const COLS = 104;
export const ROWS = 64;
/** World position of the grid's corner, chosen so tile (COLS / 2, ROWS / 2) is centred on the origin. */
export const ORIGIN_X = -(COLS / 2 + 0.5) * TILE;
export const ORIGIN_Y = -(ROWS / 2 + 0.5) * TILE;

export const ROCK = 0, OPEN = 1;
/** A gate tile's value is GATE + the index of the area it opens. */
export const GATE = 2;
/** A hidden chamber's tiles, and the rock that breaks to open it, are SECRET + the chamber's index. */
export const SECRET = 16;
/** A brick wall's tiles are BRICK + the wall's index. */
export const BRICK = 32;
/** Tiles counted from the middle of the grid, which is the hole: what the rooms are laid out from. */
const C = COLS / 2, R = ROWS / 2;

export const HOLE = { x: 0, y: 0, radius: 5.5, depth: 14 };

/** Past the coins: ruby, emerald, sapphire, diamond, and the gold bar, which only the hidden chambers hold. */
export type GemKind = 1 | 2 | 3 | 4 | 5;

export interface Heap {
  x: number; y: number;
  coins: number;
  gems: [GemKind, number][];
}

export interface Vein {
  x: number; y: number;
  /** Seconds between drops. */
  every: number;
  coins: number;
  gems: [GemKind, number][];
}

/** A conveyor: a strip from one point to another, carrying what lands on it at `speed`. */
export interface BeltSpec {
  x0: number; y0: number; x1: number; y1: number;
  width: number;
  speed: number;
}

export interface Area {
  name: string;
  /** What is in it, said when it opens. */
  blurb: string;
  heaps: Heap[];
  vein: Vein;
  /** Where the floor cracks and fountains of coins come up, now and then. */
  cracks: [number, number][];
  belt: { spec: BeltSpec; cost: number } | null;
}

/** Tile column and row to the world centre of that tile. */
export function tileCentre(tx: number, ty: number): [number, number] {
  return [ORIGIN_X + (tx + 0.5) * TILE, ORIGIN_Y + (ty + 0.5) * TILE];
}

/**
 * The shape of the cave, in tiles from the hole, which is where everything
 * is laid out from; a tile is TILE world units, so a tile n along is 4n in
 * the world. The hollow is in the middle; each other room is out one way
 * from it, down a corridor with a gate across it, and its extents along that
 * way are what says where its gate is, where the way into it starts, and
 * where going on into it seals the room behind.
 */
export const HOLLOW = { rx: 12, ry: 7, alcove: { along: 14, rx: 4.5, ry: 4 } };

/** A gated room, out from the hollow. `dir` is the way out; `along` and `across` are in tiles, the way out and square to it. */
export interface Wing {
  dir: [number, number];
  /** The room: its middle along and across, its half-lengths along and across. */
  room: { along: number; across: number; half: number; halfAcross: number; seed: number };
  /** The corridor from the hollow: from and to along it, and its tiles across, from and to. */
  corridor: { from: number; to: number; across: [number, number] };
  /** How far along the gate stands. */
  gate: number;
  /** Where the way in starts, along: the hollow's edge on that side, or for the galleries the alcove's mouth. */
  mouth: number;
}

export const WINGS: Wing[] = [
  // the hollow has none
  null as unknown as Wing,
  { dir: [0, -1], room: { along: 13, across: 0, half: 4, halfAcross: 14, seed: 0.4 }, corridor: { from: 6, to: 10, across: [-2, 1] }, gate: 8, mouth: HOLLOW.ry },
  { dir: [0, 1], room: { along: 13, across: 0, half: 4, halfAcross: 15, seed: 3.3 }, corridor: { from: 6, to: 10, across: [-2, 1] }, gate: 8, mouth: HOLLOW.ry },
  { dir: [1, 0], room: { along: 27, across: 1, half: 5, halfAcross: 9, seed: 5.2 }, corridor: { from: 17, to: 22, across: [-1, 2] }, gate: 19, mouth: 17 },
  { dir: [-1, 0], room: { along: 27, across: -1, half: 5, halfAcross: 9, seed: 2.2 }, corridor: { from: 17, to: 22, across: [-2, 1] }, gate: 19, mouth: 17 },
];

const S = 1, N = 2, E = 3, W = 4;

export const AREAS: Area[] = [
  {
    name: 'The Hollow', blurb: 'coins and a few rubies',
    heaps: [
      { x: -30, y: 8, coins: 840, gems: [[1, 24]] },
      { x: 26, y: -8, coins: 840, gems: [[1, 22]] },
      { x: 6, y: 22, coins: 320, gems: [[1, 4]] },
    ],
    vein: { x: -36, y: -6, every: 1.2, coins: 1, gems: [[1, 0.04]] },
    cracks: [[-10, -14], [18, 12], [-28, -12], [34, 4]],
    belt: null,
  },
  {
    name: 'South Gallery',
    blurb: 'rubies and emeralds',
    heaps: [
      { x: -24, y: -52, coins: 960, gems: [[1, 22], [2, 12]] },
      { x: 22, y: -54, coins: 960, gems: [[1, 18], [2, 16]] },
    ],
    vein: { x: 40, y: -50, every: 0.9, coins: 1, gems: [[1, 0.08], [2, 0.03]] },
    cracks: [[0, -56], [-40, -50], [36, -58]],
    belt: { spec: { x0: -2, y0: -46, x1: -2, y1: -8, width: 7, speed: 9 }, cost: 250 },
  },
  {
    name: 'North Vault',
    blurb: 'emeralds, sapphires, diamonds',
    heaps: [
      { x: -28, y: 52, coins: 1000, gems: [[2, 22], [3, 14], [4, 2]] },
      { x: 24, y: 54, coins: 1000, gems: [[2, 18], [3, 16], [4, 2]] },
    ],
    vein: { x: -44, y: 54, every: 0.7, coins: 1, gems: [[2, 0.08], [3, 0.05], [4, 0.015]] },
    cracks: [[0, 56], [-44, 50], [40, 52]],
    belt: { spec: { x0: -2, y0: 46, x1: -2, y1: 8, width: 7, speed: 9 }, cost: 500 },
  },
  // The two galleries either side: long rooms running north and south, reached through
  // the alcoves off the hollow. Added after the vault, so a save's areas keep their places;
  // `ORDER` is the order they open in.
  {
    name: 'East Gallery',
    blurb: 'rubies and sapphires',
    heaps: [
      { x: 104, y: 22, coins: 700, gems: [[1, 22], [3, 24]] },
      { x: 110, y: -14, coins: 700, gems: [[1, 18], [3, 26]] },
    ],
    vein: { x: 100, y: -26, every: 0.85, coins: 1, gems: [[1, 0.07], [3, 0.03]] },
    cracks: [[108, 4], [102, 32], [112, -24]],
    belt: { spec: { x0: 110, y0: 2, x1: 8, y1: 2, width: 7, speed: 10 }, cost: 400 },
  },
  {
    name: 'West Gallery',
    blurb: 'sapphires and diamonds',
    heaps: [
      { x: -104, y: -22, coins: 700, gems: [[3, 26], [4, 10]] },
      { x: -110, y: 14, coins: 700, gems: [[3, 24], [4, 11]] },
    ],
    vein: { x: -100, y: 26, every: 0.65, coins: 1, gems: [[3, 0.07], [4, 0.025]] },
    cracks: [[-108, -4], [-102, -32], [-112, 24]],
    belt: { spec: { x0: -110, y0: -2, x1: -8, y1: -2, width: 7, speed: 10 }, cost: 600 },
  },
];

/** The order the rooms open in, one when the one before is cleared: by what is in them. */
export const ORDER = [0, 1, 3, 2, 4];

/**
 * A hidden chamber off a room: rock that looks like any other, until the
 * player drives square into the stretch of it that is thin, which smashes
 * and opens a pocket with gold bars in it. What is in one is over and above
 * the room: it does not count toward clearing it, and it goes with the room
 * when the room is sealed.
 *
 * In tiles, counted as the map is: `wall` is the rock that breaks, from the
 * room's edge to the chamber; `chamber` the pocket behind it, carved as the
 * rooms are. Each is kept two tiles and more from any other open floor, so
 * nothing else shows it and nothing else reaches it.
 */
export interface Secret {
  /** The room it is off. */
  area: number;
  wall: [number, number, number, number];
  chamber: { cx: number; cy: number; rx: number; ry: number; seed: number };
  loot: { coins: number; gems: [GemKind, number][] };
}

export const SECRETS: Secret[] = [
  // off the south gallery's east end
  { area: 1, wall: [C + 16, R - 13, C + 17, R - 12], chamber: { cx: C + 20.5, cy: R - 12.5, rx: 3.2, ry: 2.2, seed: 1.1 }, loot: { coins: 60, gems: [[2, 6], [5, 3]] } },
  // off the north vault's west end
  { area: 2, wall: [C - 17, R + 11, C - 16, R + 12], chamber: { cx: C - 20.5, cy: R + 12.5, rx: 3.2, ry: 2.2, seed: 2.7 }, loot: { coins: 80, gems: [[4, 3], [5, 5]] } },
  // above the east gallery's north end
  { area: 3, wall: [C + 28, R + 11, C + 29, R + 12], chamber: { cx: C + 27, cy: R + 14, rx: 3.5, ry: 1.8, seed: 0.6 }, loot: { coins: 80, gems: [[3, 6], [5, 4]] } },
  // below the west gallery's south end
  { area: 4, wall: [C - 29, R - 11, C - 28, R - 10], chamber: { cx: C - 28, cy: R - 13.5, rx: 3.5, ry: 2.2, seed: 3.9 }, loot: { coins: 100, gems: [[4, 5], [5, 6]] } },
];

/**
 * A brick wall: a straight run of brick tiles, one thick. It takes a beating:
 * every hard enough hit from a machine driving square into it does damage, by
 * the engine and the speed, and the wall comes down when it has taken what
 * its grade stands — clay brick little, stone more, iron-bound a great deal.
 * It falls as bricks, which tumble and stay where they lie, to be pushed about,
 * or down the hole to be rid of. Some walls have treasure set in them — gold
 * bricks, gems in the face — which comes loose with the bricks.
 *
 * In tiles, from the middle of the grid.
 */
export interface Wall {
  /** The room it is in, or off. */
  area: number;
  /** 1 clay brick, 2 stone, 3 iron-bound. */
  grade: 1 | 2 | 3;
  tiles: [number, number, number, number];
  /** What is set in it, over and above the room. */
  treasure: [GemKind, number][];
}

/**
 * Something behind a brick wall, to be smashed into: a side room down a
 * corridor off a room.
 * What is in it can be seen over the walls, from when its area opens, and is
 * over and above the area, like a hidden chamber's, and gone with the area
 * when it is sealed.
 *
 * In tiles, from the middle of the grid: the `corridor`, and the `room`
 * carved as the others are; `at` the middle of what is in it.
 */
export interface Stash {
  name: string;
  area: number;
  at: [number, number];
  loot: { coins: number; gems: [GemKind, number][] };
  corridor?: [number, number, number, number];
  room?: { cx: number; cy: number; rx: number; ry: number; seed: number };
}

export const WALLS: Wall[] = [];
export const STASHES: Stash[] = [];

/** A side room: a corridor out from a room, a wall across it, and a room at the end. */
function sideRoom(name: string, area: number, grade: 1 | 2 | 3, corridor: [number, number, number, number], wall: [number, number, number, number], room: Stash['room'] & object, loot: Stash['loot'], treasure: [GemKind, number][] = []) {
  WALLS.push({ area, grade, tiles: wall, treasure });
  STASHES.push({ name, area, at: [room.cx, room.cy], loot, corridor, room });
}

sideRoom('South Cellar', S, 1, [C - 2, R - 22, C + 1, R - 16], [C - 2, R - 20, C + 1, R - 20], { cx: C, cy: R - 25, rx: 9, ry: 3, seed: 1.9 }, { coins: 400, gems: [[1, 20], [2, 12], [5, 2]] }, [[2, 3]]);
sideRoom('East Annex', E, 2, [C + 31, R, C + 37, R + 2], [C + 35, R, C + 35, R + 2], { cx: C + 42, cy: R + 1, rx: 5, ry: 6, seed: 0.8 }, { coins: 450, gems: [[1, 16], [3, 18], [5, 3]] }, [[3, 4], [5, 1]]);
sideRoom('North Loft', N, 2, [C - 2, R + 16, C + 1, R + 22], [C - 2, R + 20, C + 1, R + 20], { cx: C, cy: R + 25, rx: 9, ry: 3, seed: 4.4 }, { coins: 500, gems: [[2, 16], [3, 12], [4, 4], [5, 3]] }, [[4, 2], [5, 1]]);
sideRoom('West Annex', W, 3, [C - 37, R - 2, C - 31, R], [C - 35, R - 2, C - 35, R], { cx: C - 42, cy: R - 1, rx: 5, ry: 6, seed: 3.1 }, { coins: 500, gems: [[3, 16], [4, 8], [5, 4]] }, [[4, 3], [5, 2]]);

/** Where a stash's middle is in the world, for its loot. */
export function stashCentre(k: number): [number, number] {
  const [cx, cy] = STASHES[k].at;
  return [ORIGIN_X + (cx + 0.5) * TILE, ORIGIN_Y + (cy + 0.5) * TILE];
}

/** Whether a brick wall runs along X, rather than along Y. */
export function wallAlongX(w: number): boolean {
  const [x0, y0, x1, y1] = WALLS[w].tiles;
  return x1 - x0 >= y1 - y0;
}

/** Where a chamber's middle is in the world, for its loot. */
export function chamberCentre(k: number): [number, number] {
  const { cx, cy } = SECRETS[k].chamber;
  return [ORIGIN_X + (cx + 0.5) * TILE, ORIGIN_Y + (cy + 0.5) * TILE];
}

/** The most bodies the cave can hold: every heap plus what the veins add. */
export const BODY_CAPACITY = 10000;

/** A small deterministic hash in 0..1, for the jitter on rocks. */
export function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A lamp on a post, standing at the foot of the rock. `area` is the room it lights, which is when it is lit. */
export interface Lamp {
  x: number; y: number;
  area: number;
}

export interface Cave {
  cells: Uint8Array;
  /** The lamps, the same ones every time the cave is built. */
  lamps: Lamp[];
  /**
   * A rock tile's cell is 1; a gate's is 1 until its area is opened, a hidden
   * chamber's, and the rock in front of it, until it is broken into, and a
   * brick wall's until it is knocked down.
   */
  solid(unlocked: boolean[], revealed?: boolean[], broken?: boolean[]): Uint8Array;
}

/** Whether a cell is rock to look at: rock, or a chamber not yet broken into. A brick wall is drawn as bricks, on floor. */
function rockish(cell: number, revealed: boolean[]): boolean {
  return cell === ROCK || (cell >= SECRET && cell < BRICK && !revealed[cell - SECRET]);
}

/** The ellipse's tiles set to `value`; with `onlyRock`, only those that were rock. */
function carveEllipse(cells: Uint8Array, cx: number, cy: number, rx: number, ry: number, seed: number, value = OPEN, onlyRock = false) {
  for (let ty = 1; ty < ROWS - 1; ty++) {
    for (let tx = 1; tx < COLS - 1; tx++) {
      const dx = (tx - cx) / rx, dy = (ty - cy) / ry;
      const th = Math.atan2(dy, dx);
      const wobble = 1 + 0.09 * Math.sin(3 * th + seed) + 0.06 * Math.sin(7 * th + seed * 2.3);
      if (dx * dx + dy * dy < wobble * wobble && (!onlyRock || cells[ty * COLS + tx] === ROCK)) cells[ty * COLS + tx] = value;
    }
  }
}

function carveRect(cells: Uint8Array, x0: number, y0: number, x1: number, y1: number, value = OPEN, onlyRock = false) {
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (!onlyRock || cells[ty * COLS + tx] === ROCK) cells[ty * COLS + tx] = value;
  }
}

export function buildCave(): Cave {
  const cells = new Uint8Array(COLS * ROWS).fill(ROCK);
  // the hollow, with an alcove each side
  carveEllipse(cells, C, R, HOLLOW.rx, HOLLOW.ry, 1.7);
  carveEllipse(cells, C - HOLLOW.alcove.along, R - 1, HOLLOW.alcove.rx, HOLLOW.alcove.ry, 4.1);
  carveEllipse(cells, C + HOLLOW.alcove.along, R + 1, HOLLOW.alcove.rx, HOLLOW.alcove.ry, 2.9);
  // each wing: its room, and its corridor from the hollow with a gate across it
  for (let a = 1; a < WINGS.length; a++) {
    const { dir: [dx, dy], room, corridor, gate } = WINGS[a];
    const tile = (along: number, across: number): [number, number] => (dx ? [C + dx * along, R + across] : [C + across, R + dy * along]);
    const [cx, cy] = tile(room.along, room.across);
    carveEllipse(cells, cx, cy, dx ? room.half : room.halfAcross, dx ? room.halfAcross : room.half, room.seed);
    const [ax, ay] = tile(corridor.from, corridor.across[0]), [bx, by] = tile(corridor.to, corridor.across[1]);
    carveRect(cells, Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    const [gx0, gy0] = tile(gate, corridor.across[0]), [gx1, gy1] = tile(gate, corridor.across[1]);
    carveRect(cells, Math.min(gx0, gx1), Math.min(gy0, gy1), Math.max(gx0, gx1), Math.max(gy0, gy1), GATE + a);
  }
  // the side rooms, down their corridors
  for (const { corridor, room: c } of STASHES) {
    if (corridor) carveRect(cells, corridor[0], corridor[1], corridor[2], corridor[3], OPEN, true);
    if (c) carveEllipse(cells, c.cx, c.cy, c.rx, c.ry, c.seed, OPEN, true);
  }
  // the brick walls, across the corridors and standing in the rooms
  WALLS.forEach(({ tiles }, w) => carveRect(cells, tiles[0], tiles[1], tiles[2], tiles[3], BRICK + w));
  // the hidden chambers, in what is left of the rock
  SECRETS.forEach(({ wall, chamber: c }, k) => {
    carveEllipse(cells, c.cx, c.cy, c.rx, c.ry, c.seed, SECRET + k, true);
    carveRect(cells, wall[0], wall[1], wall[2], wall[3], SECRET + k, true);
  });
  return {
    cells,
    lamps: placeLamps(cells),
    solid(unlocked, revealed = [], broken = []) {
      const out = new Uint8Array(COLS * ROWS);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        out[i] = c === OPEN ? 0
          : c >= BRICK ? (broken[c - BRICK] ? 0 : 1)
          : c >= SECRET ? (revealed[c - SECRET] ? 0 : 1)
          : c >= GATE ? (unlocked[c - GATE] ? 0 : 1) : 1;
      }
      return out;
    },
  };
}

/** How far apart lamps stand along the rock, in world units, and how far off its face; and how far apart across the open floor. */
const LAMP_SPACING = 10, LAMP_OFF_ROCK = 1.4, FLOOR_LAMP_SPACING = 20;

/**
 * Lamps along the edges of the floor: on open tiles against the rock, the
 * post set in from the rock face, one every so far. Not on a belt's line, in
 * a heap, by a gate, or against a brick wall or a hidden chamber's rock,
 * which come down; every tile is tried in the same order, so the same lamps
 * come every time. A pen has none.
 */
function placeLamps(cells: Uint8Array): Lamp[] {
  const out: Lamp[] = [];
  const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS ? ROCK : cells[ty * COLS + tx]);
  const nearHeap = (x: number, y: number, margin = 4) => AREAS.some((a) => a.heaps.some((h) => Math.hypot(h.x - x, h.y - y) < Math.sqrt(h.coins) * 0.36 + margin));
  const nearBelt = (x: number, y: number) => AREAS.some((a) => {
    const b = a.belt?.spec;
    if (!b) return false;
    const dx = b.x1 - b.x0, dy = b.y1 - b.y0, len2 = dx * dx + dy * dy;
    const k = Math.max(0, Math.min(1, ((x - b.x0) * dx + (y - b.y0) * dy) / len2));
    return Math.hypot(x - (b.x0 + dx * k), y - (b.y0 + dy * k)) < b.width / 2 + 3;
  });
  for (let ty = 1; ty < ROWS - 1; ty++) {
    for (let tx = 1; tx < COLS - 1; tx++) {
      if (at(tx, ty) !== OPEN) continue;
      // against plain rock on one side, and nothing that comes down or opens within a tile
      let nx = 0, ny = 0, unsure = false;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const c = at(tx + ox, ty + oy);
          if (c >= GATE) unsure = true;
          if (c === ROCK && (ox === 0 || oy === 0)) { nx -= ox; ny -= oy; }
        }
      }
      if (unsure || (nx === 0 && ny === 0)) continue;
      const [cx, cy] = tileCentre(tx, ty);
      const len = Math.hypot(nx, ny);
      const x = cx - (nx / len) * (TILE / 2 - LAMP_OFF_ROCK), y = cy - (ny / len) * (TILE / 2 - LAMP_OFF_ROCK);
      if (Math.hypot(x - HOLE.x, y - HOLE.y) < HOLE.radius + 8 || nearHeap(x, y) || nearBelt(x, y)) continue;
      if (out.some((l) => Math.hypot(l.x - x, l.y - y) < LAMP_SPACING)) continue;
      out.push({ x, y, area: areaAt(x, y) });
    }
  }
  // and across the middle of the floor, on a grid, so nowhere is out of reach of one: not in a heap,
  // on a belt, by the hole, or on or beside anything that comes down or opens
  const step = Math.round(FLOOR_LAMP_SPACING / TILE);
  for (let ty = 1; ty < ROWS - 1; ty++) {
    for (let tx = 1; tx < COLS - 1; tx++) {
      if ((tx - COLS / 2) % step !== 0 || (ty - ROWS / 2) % step !== 0) continue;
      if (at(tx, ty) !== OPEN) continue;
      let clear = true;
      for (let oy = -1; oy <= 1 && clear; oy++) for (let ox = -1; ox <= 1; ox++) if (at(tx + ox, ty + oy) !== OPEN) { clear = false; break; }
      if (!clear) continue;
      const [x, y] = tileCentre(tx, ty);
      if (Math.hypot(x - HOLE.x, y - HOLE.y) < HOLE.radius + 10 || nearHeap(x, y, 1.5) || nearBelt(x, y)) continue;
      if (out.some((l) => Math.hypot(l.x - x, l.y - y) < 12)) continue;
      out.push({ x, y, area: areaAt(x, y) });
    }
  }
  return out;
}

export interface WallInstance {
  x: number; y: number;
  height: number;
  /** 0 for the rock beside the floor, 1 for the ring behind it. */
  ring: number;
  shade: number;
}

/** The rock tiles worth drawing: those within two of an open tile. */
export function wallInstances(cave: Cave, revealed: boolean[] = []): WallInstance[] {
  const out: WallInstance[] = [];
  const { cells } = cave;
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (!rockish(cells[ty * COLS + tx], revealed)) continue;
      let ring = 3;
      for (let dy = -2; dy <= 2 && ring > 0; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          if (!rockish(cells[ny * COLS + nx], revealed)) ring = Math.min(ring, Math.max(Math.abs(dx), Math.abs(dy)) - 1);
        }
      }
      if (ring > 1) continue;
      const [x, y] = tileCentre(tx, ty);
      const h = hash(tx, ty);
      out.push({ x, y, ring, height: ring === 0 ? 4.5 + h * 3 : 7 + h * 4, shade: hash(tx, ty, 7) });
    }
  }
  return out;
}

/** The gate tiles of an area, as world centres. */
export function gateTiles(cave: Cave, area: number): [number, number][] {
  const out: [number, number][] = [];
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (cave.cells[ty * COLS + tx] === GATE + area) out.push(tileCentre(tx, ty));
    }
  }
  return out;
}

/** Every open tile (gates included, chambers once broken into), for the floor. */
export function floorTiles(cave: Cave, revealed: boolean[] = []): [number, number][] {
  const out: [number, number][] = [];
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (rockish(cave.cells[ty * COLS + tx], revealed)) continue;
      const [x, y] = tileCentre(tx, ty);
      // the hole's collar covers these
      if (Math.abs(x - HOLE.x) < TILE * 2 && Math.abs(y - HOLE.y) < TILE * 2) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/** How far out a point is along a wing, and how far across it, in world units. */
function alongWing(area: number, x: number, y: number): [number, number] {
  const [dx, dy] = WINGS[area].dir;
  return dx ? [dx * x, y] : [dy * y, x];
}

/**
 * The band a room lies across, from the hollow out: a little wider than the
 * room itself. It keeps a hidden chamber, side room or pen off one room, out
 * past the corner of another, from counting as the way into that other.
 */
function inBand(area: number, x: number, y: number): boolean {
  const { room } = WINGS[area];
  const [, across] = alongWing(area, x, y);
  return Math.abs(across - room.across * TILE) < (room.halfAcross + 3) * TILE;
}

/** Where a wing's room starts, along it, in world units: its near edge. */
const nearEdge = (area: number) => (WINGS[area].room.along - WINGS[area].room.half) * TILE;

/**
 * Whether a point is well inside a room, through the gate and the corridor
 * and out among its heaps: where the player has gone on into it. The hollow
 * has no gate, and nobody goes on into it.
 */
export function pastGate(area: number, x: number, y: number): boolean {
  return area > 0 && inBand(area, x, y) && alongWing(area, x, y)[0] > nearEdge(area) + 8;
}

/** Where, down a room's corridor, going on seals the room behind: the line `pastGate` draws, in the corridor's middle. */
export function sealPoint(cave: Cave, area: number): [number, number] {
  const [gx, gy] = gateCentre(cave, area);
  const [dx, dy] = WINGS[area].dir, at = nearEdge(area) + 8;
  return dx ? [dx * at, gy] : [gx, dy * at];
}

/** Whether a point is up to a room's gate, or through it and not yet past: where going on is a turn of the wheel away. */
export function atGate(area: number, x: number, y: number): boolean {
  return area > 0 && inBand(area, x, y) && alongWing(area, x, y)[0] > WINGS[area].mouth * TILE - 6;
}

/** Whether a machine at a point would be shut in, or in the rock, when a room's gate closes. */
export function behindGate(area: number, x: number, y: number): boolean {
  return area > 0 && inBand(area, x, y) && alongWing(area, x, y)[0] > WINGS[area].mouth * TILE - 3;
}

/** The middle of an area's gate, for pointing at. */
export function gateCentre(cave: Cave, area: number): [number, number] {
  const tiles = gateTiles(cave, area);
  return [tiles.reduce((s, t) => s + t[0], 0) / tiles.length, tiles.reduce((s, t) => s + t[1], 0) / tiles.length];
}

/** Which area a world point is in, by the room's rough extent: 1 south, 2 north, 3 east, 4 west, 0 otherwise. */
export function areaAt(x: number, y: number): number {
  for (let a = 1; a < WINGS.length; a++) if (behindGate(a, x, y)) return a;
  return 0;
}
