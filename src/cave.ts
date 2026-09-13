/**
 * The cave: a grid of tiles, each rock or open, carved as a few wobbly
 * ellipses joined by corridors. Four of the corridors are blocked by gates —
 * rock the player buys their way through — and each room has heaps of coins,
 * a vein that trickles more in, and somewhere a conveyor could run.
 *
 * World units: a coin is about two across, a bulldozer about six, the whole
 * cave a couple of hundred across and more than that wide. Z is up and the
 * floor is z = 0.
 */

export const TILE = 4;
export const COLS = 72;
export const ROWS = 36;
/** World position of the grid's corner, chosen so tile (COLS / 2, ROWS / 2) is centred on the origin. */
export const ORIGIN_X = -(COLS / 2 + 0.5) * TILE;
export const ORIGIN_Y = -(ROWS / 2 + 0.5) * TILE;

export const ROCK = 0, OPEN = 1;
/** A gate tile's value is GATE + the index of the area it opens. */
export const GATE = 2;

export const HOLE = { x: 0, y: 0, radius: 5.5, depth: 14 };

export type GemKind = 1 | 2 | 3 | 4;

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
  /** What opening it costs; the first area is open from the start. */
  cost: number;
  /** The area that has to be open before this one can be bought. */
  after: number;
  /** What the shop says about it. */
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

export const AREAS: Area[] = [
  {
    name: 'The Hollow', cost: 0, after: 0, blurb: '',
    heaps: [
      { x: -30, y: 8, coins: 840, gems: [[1, 6]] },
      { x: 26, y: -8, coins: 840, gems: [[1, 6]] },
      { x: 6, y: 22, coins: 320, gems: [] },
    ],
    vein: { x: -36, y: -6, every: 1.2, coins: 1, gems: [[1, 0.04]] },
    cracks: [[-10, -14], [18, 12], [-28, -12], [34, 4]],
    belt: null,
  },
  {
    name: 'South Gallery', cost: 300, after: 0,
    blurb: 'blast the rock south of the hollow: rubies and emeralds',
    heaps: [
      { x: -24, y: -52, coins: 960, gems: [[1, 14], [2, 6]] },
      { x: 22, y: -54, coins: 960, gems: [[1, 10], [2, 8]] },
    ],
    vein: { x: 40, y: -50, every: 0.9, coins: 1, gems: [[1, 0.08], [2, 0.03]] },
    cracks: [[0, -56], [-40, -50], [36, -58]],
    belt: { spec: { x0: -2, y0: -46, x1: -2, y1: -8, width: 7, speed: 9 }, cost: 450 },
  },
  {
    name: 'North Vault', cost: 1500, after: 1,
    blurb: 'blast the rock to the north: emeralds, sapphires, diamonds',
    heaps: [
      { x: -28, y: 52, coins: 1000, gems: [[2, 12], [3, 8], [4, 3]] },
      { x: 24, y: 54, coins: 1000, gems: [[2, 8], [3, 10], [4, 4]] },
    ],
    vein: { x: -44, y: 54, every: 0.7, coins: 1, gems: [[2, 0.08], [3, 0.05], [4, 0.015]] },
    cracks: [[0, 56], [-44, 50], [40, 52]],
    belt: { spec: { x0: -2, y0: 46, x1: -2, y1: 8, width: 7, speed: 9 }, cost: 900 },
  },
  // The two galleries either side: long rooms running north and south, reached through
  // the alcoves off the hollow. Added after the vault, so a save's areas keep their places.
  {
    name: 'East Gallery', cost: 800, after: 1,
    blurb: 'blast through the east alcove: rubies and sapphires',
    heaps: [
      { x: 104, y: 22, coins: 700, gems: [[1, 12], [3, 6]] },
      { x: 110, y: -14, coins: 700, gems: [[1, 8], [3, 8]] },
    ],
    vein: { x: 100, y: -26, every: 0.85, coins: 1, gems: [[1, 0.07], [3, 0.03]] },
    cracks: [[108, 4], [102, 32], [112, -24]],
    belt: { spec: { x0: 58, y0: 2, x1: 8, y1: 2, width: 7, speed: 10 }, cost: 650 },
  },
  {
    name: 'West Gallery', cost: 3000, after: 2,
    blurb: 'blast through the west alcove: sapphires and diamonds',
    heaps: [
      { x: -104, y: -22, coins: 700, gems: [[3, 12], [4, 5]] },
      { x: -110, y: 14, coins: 700, gems: [[3, 8], [4, 6]] },
    ],
    vein: { x: -100, y: 26, every: 0.65, coins: 1, gems: [[3, 0.07], [4, 0.025]] },
    cracks: [[-108, -4], [-102, -32], [-112, 24]],
    belt: { spec: { x0: -58, y0: -2, x1: -8, y1: -2, width: 7, speed: 10 }, cost: 1200 },
  },
];

/** The most bodies the cave can hold: every heap plus what the veins add. */
export const BODY_CAPACITY = 10000;

/** A small deterministic hash in 0..1, for the jitter on rocks. */
export function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface Cave {
  cells: Uint8Array;
  /** A rock tile's cell is 1; a gate's is 1 until its area is bought. */
  solid(unlocked: boolean[]): Uint8Array;
}

function carveEllipse(cells: Uint8Array, cx: number, cy: number, rx: number, ry: number, seed: number) {
  for (let ty = 1; ty < ROWS - 1; ty++) {
    for (let tx = 1; tx < COLS - 1; tx++) {
      const dx = (tx - cx) / rx, dy = (ty - cy) / ry;
      const th = Math.atan2(dy, dx);
      const wobble = 1 + 0.09 * Math.sin(3 * th + seed) + 0.06 * Math.sin(7 * th + seed * 2.3);
      if (dx * dx + dy * dy < wobble * wobble) cells[ty * COLS + tx] = OPEN;
    }
  }
}

function carveRect(cells: Uint8Array, x0: number, y0: number, x1: number, y1: number, value = OPEN) {
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) cells[ty * COLS + tx] = value;
}

export function buildCave(): Cave {
  const cells = new Uint8Array(COLS * ROWS).fill(ROCK);
  // tiles counted from the middle of the grid, which is the hole
  const C = COLS / 2, R = ROWS / 2;
  // the hollow, with an alcove each side
  carveEllipse(cells, C, R, 12, 7, 1.7);
  carveEllipse(cells, C - 14, R - 1, 4.5, 4, 4.1);
  carveEllipse(cells, C + 14, R + 1, 4.5, 4, 2.9);
  // the south gallery and its corridor, gated
  carveEllipse(cells, C, R - 13, 14, 4, 0.4);
  carveRect(cells, C - 2, R - 10, C + 1, R - 6);
  carveRect(cells, C - 2, R - 8, C + 1, R - 8, GATE + 1);
  // the north vault and its corridor, gated
  carveEllipse(cells, C, R + 13, 15, 4, 3.3);
  carveRect(cells, C - 2, R + 6, C + 1, R + 10);
  carveRect(cells, C - 2, R + 8, C + 1, R + 8, GATE + 2);
  // the east gallery, out through the east alcove, gated
  carveEllipse(cells, C + 27, R + 1, 5, 9, 5.2);
  carveRect(cells, C + 17, R - 1, C + 22, R + 2);
  carveRect(cells, C + 19, R - 1, C + 19, R + 2, GATE + 3);
  // the west gallery, out through the west alcove, gated
  carveEllipse(cells, C - 27, R - 1, 5, 9, 2.2);
  carveRect(cells, C - 22, R - 2, C - 17, R + 1);
  carveRect(cells, C - 19, R - 2, C - 19, R + 1, GATE + 4);
  return {
    cells,
    solid(unlocked) {
      const out = new Uint8Array(COLS * ROWS);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        out[i] = c === OPEN ? 0 : c >= GATE ? (unlocked[c - GATE] ? 0 : 1) : 1;
      }
      return out;
    },
  };
}

export interface WallInstance {
  x: number; y: number;
  height: number;
  /** 0 for the rock beside the floor, 1 for the ring behind it. */
  ring: number;
  shade: number;
}

/** The rock tiles worth drawing: those within two of an open tile. */
export function wallInstances(cave: Cave): WallInstance[] {
  const out: WallInstance[] = [];
  const { cells } = cave;
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (cells[ty * COLS + tx] !== ROCK) continue;
      let ring = 3;
      for (let dy = -2; dy <= 2 && ring > 0; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          if (cells[ny * COLS + nx] !== ROCK) ring = Math.min(ring, Math.max(Math.abs(dx), Math.abs(dy)) - 1);
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

/** Every open tile (gates included), for the floor. */
export function floorTiles(cave: Cave): [number, number][] {
  const out: [number, number][] = [];
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (cave.cells[ty * COLS + tx] === ROCK) continue;
      const [x, y] = tileCentre(tx, ty);
      // the hole's collar covers these
      if (Math.abs(x - HOLE.x) < TILE * 2 && Math.abs(y - HOLE.y) < TILE * 2) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/** Which area a world point is in, by the room's rough extent: 1 south, 2 north, 3 east, 4 west, 0 otherwise. */
export function areaAt(x: number, y: number): number {
  return x > 70 ? 3 : x < -70 ? 4 : y < -34 ? 1 : y > 34 ? 2 : 0;
}
