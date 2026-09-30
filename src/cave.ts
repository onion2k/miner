/**
 * The cave: a grid of tiles, each rock or open, carved as a few wobbly
 * ellipses and boxes, with heaps of coins in it, and somewhere a conveyor
 * could run. It has a way in, always open, and a way out, a cutting through
 * the rock at its edge that opens when the cave is cleared; the last cave has
 * none, and its vein trickles more in once it is clear, so there is still
 * something to push.
 *
 * This file is the machinery: the kinds of thing a cave is made of, how a
 * `CaveSpec` is carved into a `Cave`, and the questions asked of one. What a
 * cave actually holds is content, and is handed in (`caves.ts` has the run
 * the game plays), so the grid's size, its corner and its holes are the cave's
 * and never constants here. Without that there is no handing the game a
 * second cave.
 *
 * World units: a coin is about two across, a bulldozer about six, the whole
 * cave a couple of hundred across and more than that wide. Z is up and the
 * floor is z = 0.
 */

/** Every cave's tiles are the same size. */
export const TILE = 4;

export const ROCK = 0,
  OPEN = 1;
/** A hidden chamber's tiles, and the rock that breaks to open it, are SECRET + the chamber's index. */
export const SECRET = 16;
/** A brick wall's tiles are BRICK + the wall's index. */
export const BRICK = 32;
/** The tiles of the way out: rock, and nothing to break into, until the cave is cleared. */
export const EXIT = 64;

/** Where a cave's tiles are: how many, and where the corner of the grid is in the world. */
export interface Grid {
  cols: number;
  rows: number;
  originX: number;
  originY: number;
}

/** A way down: where it is, how wide and how deep. Anything that reaches it is banked. */
export interface HoleSpec {
  x: number;
  y: number;
  radius: number;
  depth: number;
}

/** Past the coins: ruby, emerald, sapphire, diamond, and the gold bar, which only the hidden chambers hold. */
export type GemKind = 1 | 2 | 3 | 4 | 5;

export interface Heap {
  x: number;
  y: number;
  coins: number;
  gems: [GemKind, number][];
}

export interface Vein {
  x: number;
  y: number;
  /** Seconds between drops. */
  every: number;
  coins: number;
  gems: [GemKind, number][];
}

/** A conveyor: a strip from one point to another, carrying what lands on it at `speed`. */
export interface BeltSpec {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  speed: number;
}

/** A conveyor bought for the cave: which, what it is and what it costs. */
export interface BeltOffer {
  id: string;
  spec: BeltSpec;
  cost: number;
}

/**
 * One piece of what is carved, in tiles from the grid's corner: a wobbly ellipse, or a box. Carved
 * in order, and a shape with `rock` set puts rock back, for a pillar or an island.
 */
export type Shape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; seed: number; rock?: true }
  | { kind: 'rect'; tiles: [number, number, number, number]; rock?: true };

/** A cutting through the rock at the cave's edge: the way out, or the way in. */
export interface Cutting {
  /** The tiles of the cutting, [x0, y0, x1, y1] inclusive, from a little inside the cave's floor out to near the grid's edge. */
  tiles: [number, number, number, number];
  /** Which way is out of the cave along it, as a unit step: [1, 0], [0, -1] and so on. */
  out: [number, number];
}

/**
 * A hidden chamber off a cave: rock that looks like any other, until the
 * player drives square into the stretch of it that is thin, which smashes
 * and opens a pocket with gold bars in it. What is in one is over and above
 * the cave: it does not count toward clearing it, and it goes with the cave
 * when the cave is left.
 *
 * In tiles, counted as the map is: `wall` is the rock that breaks, from the
 * cave's edge to the chamber; `chamber` the pocket behind it, carved as the
 * shapes are. Each is kept two tiles and more from any other open floor, so
 * nothing else shows it and nothing else reaches it.
 */
export interface Secret {
  wall: [number, number, number, number];
  chamber: { cx: number; cy: number; rx: number; ry: number; seed: number };
  loot: { coins: number; gems: [GemKind, number][] };
}

/**
 * A brick wall: a straight run of brick tiles, one thick. It takes a beating:
 * every hard enough hit from a machine driving square into it does damage, by
 * the engine and the speed, and the wall comes down when it has taken what
 * its grade stands — clay brick little, stone more, iron-bound a great deal.
 * It falls as bricks, which tumble and stay where they lie, to be pushed about,
 * or down the hole to be rid of. Some walls have treasure set in them — gold
 * bricks, gems in the face — which comes loose with the bricks.
 *
 * In tiles, from the grid's corner.
 */
export interface Wall {
  /** 1 clay brick, 2 stone, 3 iron-bound. */
  grade: 1 | 2 | 3;
  tiles: [number, number, number, number];
  /** What is set in it, over and above the cave. */
  treasure: [GemKind, number][];
}

/**
 * Something behind a brick wall, to be smashed into: a side room down a
 * corridor off a cave.
 * What is in it can be seen over the walls, and is over and above the cave,
 * like a hidden chamber's, and gone with the cave when it is left.
 *
 * In tiles, from the grid's corner: the `corridor`, and the `room`
 * carved as the others are; `at` the middle of what is in it.
 */
export interface Stash {
  name: string;
  at: [number, number];
  loot: { coins: number; gems: [GemKind, number][] };
  corridor?: [number, number, number, number];
  room?: { cx: number; cy: number; rx: number; ry: number; seed: number };
}

/** A barrel where it stands when its cave begins. */
export interface BarrelSpot {
  x: number;
  y: number;
}

/** A lamp on a post. */
export interface Lamp {
  x: number;
  y: number;
  /** How high its head stands. */
  height: number;
}

/**
 * A cave as content: everything `buildCave` carves from and everything the
 * game asks of it. Tiles are counted from the grid's corner, which is where
 * `shapes`, the chambers, walls and side rooms are laid out; heaps, holes,
 * belts, the vein and the cracks are in world units, where the tile at the
 * middle of the grid is centred on the origin.
 */
export interface CaveSpec {
  /** A stable name, kept in the save: 'hollow', 'south-gallery', and so on. */
  id: string;
  name: string;
  /** What is in it, said on arriving. */
  blurb: string;
  /** The look of the whole cave: null for the plain one. */
  biome: 'jungle' | 'ice' | 'lava' | 'future' | null;
  cols: number;
  rows: number;
  /** Carved in order; `rock: true` puts rock back (pillars, the island a ring of floor goes round). */
  shapes: Shape[];
  /** Every way down. The first is where a drone is sent home to. */
  holes: HoleSpec[];
  heaps: Heap[];
  /** Runs once the last cave is cleared: a cave with a way out has one too, to be kept when it is not the last. */
  vein: Vein;
  /** Where the floor cracks and fountains of coins come up, once the game is done. */
  cracks: [number, number][];
  /** The conveyors that can be bought for it. */
  belts: BeltOffer[];
  /** Where the machine arrives: always open. */
  entry: Cutting;
  /** The way out, shut until the cave is cleared; null in the last cave. */
  exit: Cutting | null;
  secrets: Secret[];
  walls: Wall[];
  stashes: Stash[];
  /** How many barrels it has. */
  barrels: number;
}

export interface Cave {
  spec: CaveSpec;
  grid: Grid;
  holes: readonly HoleSpec[];
  cells: Uint8Array;
  /** The lamps, the same ones every time the cave is built. */
  lamps: Lamp[];
  /** Where the barrels stand when the cave begins, the same every time. */
  barrels: BarrelSpot[];
  /**
   * A rock tile's cell is 1; the way out's is 1 until it is `open`, a hidden
   * chamber's, and the rock in front of it, until it is broken into, and a
   * brick wall's until it is knocked down.
   */
  solid(open: boolean, revealed?: boolean[], broken?: boolean[]): Uint8Array;
}

/**
 * The grid a spec's tiles make: its corner is chosen so that tile
 * (cols / 2, rows / 2) is centred on the world's origin.
 */
export function gridOf(spec: { cols: number; rows: number }): Grid {
  return {
    cols: spec.cols,
    rows: spec.rows,
    originX: -(spec.cols / 2 + 0.5) * TILE,
    originY: -(spec.rows / 2 + 0.5) * TILE,
  };
}

/** Tile column and row to the world centre of that tile. */
export function tileCentre(grid: Grid, tx: number, ty: number): [number, number] {
  return [grid.originX + (tx + 0.5) * TILE, grid.originY + (ty + 0.5) * TILE];
}

/** The hole nearest a point, by the distance to its middle. The first wins a tie. */
export function nearestHole(holes: readonly HoleSpec[], x: number, y: number): HoleSpec {
  let best = holes[0],
    bestD = Math.hypot(best.x - x, best.y - y);
  for (let k = 1; k < holes.length; k++) {
    const d = Math.hypot(holes[k].x - x, holes[k].y - y);
    if (d < bestD) {
      bestD = d;
      best = holes[k];
    }
  }
  return best;
}

/** Where a stash's middle is in the world, for its loot. */
export function stashCentre(cave: Cave, k: number): [number, number] {
  const [cx, cy] = cave.spec.stashes[k].at;
  return tileCentre(cave.grid, cx, cy);
}

/** Whether a brick wall runs along X, rather than along Y. */
export function wallAlongX(spec: CaveSpec, w: number): boolean {
  const [x0, y0, x1, y1] = spec.walls[w].tiles;
  return x1 - x0 >= y1 - y0;
}

/** Where a chamber's middle is in the world, for its loot. */
export function chamberCentre(cave: Cave, k: number): [number, number] {
  const { cx, cy } = cave.spec.secrets[k].chamber;
  return tileCentre(cave.grid, cx, cy);
}

/** The most bodies the cave can hold: every heap plus what the veins add. */
export const BODY_CAPACITY = 10000;

/** A small deterministic hash in 0..1, for the jitter on rocks. */
export function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Whether a cell is rock to look at: rock, the way out before it opens, or a chamber not yet broken into. A brick wall is drawn as bricks, on floor. */
export function rockish(cell: number, revealed: boolean[], open = false): boolean {
  return cell === ROCK || (cell === EXIT && !open) || (cell >= SECRET && cell < BRICK && !revealed[cell - SECRET]);
}

/** The ellipse's tiles set to `value`; with `onlyRock`, only those that were rock. */
function carveEllipse(
  cells: Uint8Array,
  grid: Grid,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  value = OPEN,
  onlyRock = false,
) {
  const { cols, rows } = grid;
  for (let ty = 1; ty < rows - 1; ty++) {
    for (let tx = 1; tx < cols - 1; tx++) {
      const dx = (tx - cx) / rx,
        dy = (ty - cy) / ry;
      const th = Math.atan2(dy, dx);
      const wobble = 1 + 0.09 * Math.sin(3 * th + seed) + 0.06 * Math.sin(7 * th + seed * 2.3);
      if (dx * dx + dy * dy < wobble * wobble && (!onlyRock || cells[ty * cols + tx] === ROCK))
        cells[ty * cols + tx] = value;
    }
  }
}

function carveRect(
  cells: Uint8Array,
  grid: Grid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value = OPEN,
  onlyRock = false,
) {
  const { cols } = grid;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (!onlyRock || cells[ty * cols + tx] === ROCK) cells[ty * cols + tx] = value;
  }
}

export function buildCave(spec: CaveSpec): Cave {
  const grid = gridOf(spec),
    { cols, rows } = grid;
  const cells = new Uint8Array(cols * rows).fill(ROCK);
  // what the cave is carved of, in order: a pillar put back in rock comes after the floor it stands in
  for (const shape of spec.shapes) {
    const value = shape.rock ? ROCK : OPEN;
    if (shape.kind === 'ellipse') carveEllipse(cells, grid, shape.cx, shape.cy, shape.rx, shape.ry, shape.seed, value);
    else carveRect(cells, grid, ...shape.tiles, value);
  }
  // the way in is open floor, through whatever stands in it; the way out is rock, until it is opened
  carveRect(cells, grid, ...spec.entry.tiles);
  if (spec.exit) carveRect(cells, grid, ...spec.exit.tiles, EXIT, true);
  // the side rooms, down their corridors
  for (const { corridor, room: c } of spec.stashes) {
    if (corridor) carveRect(cells, grid, corridor[0], corridor[1], corridor[2], corridor[3], OPEN, true);
    if (c) carveEllipse(cells, grid, c.cx, c.cy, c.rx, c.ry, c.seed, OPEN, true);
  }
  // the brick walls, across the corridors and standing in the rooms
  spec.walls.forEach(({ tiles }, w) => carveRect(cells, grid, tiles[0], tiles[1], tiles[2], tiles[3], BRICK + w));
  // the hidden chambers, in what is left of the rock
  spec.secrets.forEach(({ wall, chamber: c }, k) => {
    carveEllipse(cells, grid, c.cx, c.cy, c.rx, c.ry, c.seed, SECRET + k, true);
    carveRect(cells, grid, wall[0], wall[1], wall[2], wall[3], SECRET + k, true);
  });
  const lamps = placeLamps(cells, spec, grid);
  return {
    spec,
    grid,
    holes: spec.holes,
    cells,
    lamps,
    barrels: placeBarrels(cells, spec, grid, lamps),
    solid(open, revealed = [], broken = []) {
      const out = new Uint8Array(cols * rows);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        // the way out is looked at first: its value is past the walls', which would take it for one
        out[i] =
          c === OPEN
            ? 0
            : c >= EXIT
              ? open
                ? 0
                : 1
              : c >= BRICK
                ? broken[c - BRICK]
                  ? 0
                  : 1
                : c >= SECRET
                  ? revealed[c - SECRET]
                    ? 0
                    : 1
                  : 1;
      }
      return out;
    },
  };
}

/** How high a lamp on a post stands. */
export const LAMP_HEIGHT = 5.6;
/** How far apart lamps stand along the rock, in world units, and how far off its face; and how far apart across the open floor. */
const LAMP_SPACING = 10,
  LAMP_OFF_ROCK = 1.4,
  FLOOR_LAMP_SPACING = 20;

/** How far apart barrels stand, at least. */
const BARREL_SPACING = 16;

/** Whether a point is within `margin` of the rim of any hole, past its radius. */
export function nearHole(holes: readonly HoleSpec[], x: number, y: number, margin: number): boolean {
  return holes.some((h) => Math.hypot(x - h.x, y - h.y) < h.radius + margin);
}

/** The world rectangle of a cutting's tiles: its corner and far corner. */
function cuttingBox(grid: Grid, c: Cutting): [number, number, number, number] {
  const [x0, y0, x1, y1] = c.tiles;
  return [
    grid.originX + x0 * TILE,
    grid.originY + y0 * TILE,
    grid.originX + (x1 + 1) * TILE,
    grid.originY + (y1 + 1) * TILE,
  ];
}

/**
 * Whether a point is on a cutting, or within `margin` tiles of one: where no lamp, barrel or dressing
 * is put, which is what keeps a cutting dark but for the machine's own lights.
 */
export function nearCutting(grid: Grid, spec: CaveSpec, x: number, y: number, margin = 0): boolean {
  const m = margin * TILE;
  return [spec.entry, spec.exit].some((c) => {
    if (!c) return false;
    const [x0, y0, x1, y1] = cuttingBox(grid, c);
    return x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m;
  });
}

/**
 * Where the barrels stand: out on the floor the dozer drives, with floor all
 * round, clear of the heaps, the belts, the lamps, the holes, the cuttings
 * and anything that opens; spread about, and the same every time. Not behind
 * a brick wall, where they would be no use to anyone.
 */
function placeBarrels(cells: Uint8Array, spec: CaveSpec, grid: Grid, lamps: readonly Lamp[]): BarrelSpot[] {
  const { cols, rows } = grid;
  const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= cols || ty >= rows ? ROCK : cells[ty * cols + tx]);
  // the floor joined to a hole with every wall standing
  const joined = new Uint8Array(cols * rows);
  const stack = spec.holes.map(
    (h) => Math.floor((h.y - grid.originY) / TILE) * cols + Math.floor((h.x - grid.originX) / TILE),
  );
  while (stack.length) {
    const t = stack.pop()!;
    const c = cells[t];
    if (joined[t] || !(c === OPEN || (c >= BRICK && c < EXIT))) continue;
    joined[t] = 1;
    const tx = t % cols;
    if (tx > 0) stack.push(t - 1);
    if (tx < cols - 1) stack.push(t + 1);
    if (t >= cols) stack.push(t - cols);
    if (t < cols * (rows - 1)) stack.push(t + cols);
  }
  const candidates: { x: number; y: number; rank: number }[] = [];
  for (let ty = 2; ty < rows - 2; ty++) {
    for (let tx = 2; tx < cols - 2; tx++) {
      if (!joined[ty * cols + tx] || at(tx, ty) !== OPEN) continue;
      let clear = true;
      for (let oy = -1; oy <= 1 && clear; oy++)
        for (let ox = -1; ox <= 1; ox++) if (at(tx + ox, ty + oy) !== OPEN) clear = false;
      if (!clear) continue;
      const [x, y] = tileCentre(grid, tx, ty);
      if (nearHole(spec.holes, x, y, 12) || nearHeap(spec, x, y, 5) || nearBelt(spec, x, y, 4)) continue;
      if (nearCutting(grid, spec, x, y, 2)) continue;
      if (lamps.some((l) => Math.hypot(l.x - x, l.y - y) < 5)) continue;
      candidates.push({ x, y, rank: hash(tx, ty, 91) });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const out: BarrelSpot[] = [];
  for (const c of candidates) {
    if (out.length >= spec.barrels) break;
    if (out.some((b) => Math.hypot(b.x - c.x, b.y - c.y) < BARREL_SPACING)) continue;
    out.push({ x: c.x, y: c.y });
  }
  return out;
}

/** Whether a point is within `margin` of the edge of any heap. */
function nearHeap(spec: CaveSpec, x: number, y: number, margin = 4): boolean {
  return spec.heaps.some((h) => Math.hypot(h.x - x, h.y - y) < Math.sqrt(h.coins) * 0.36 + margin);
}

/** Whether a point is within `margin` of the side of any belt that can be bought. */
function nearBelt(spec: CaveSpec, x: number, y: number, margin = 3): boolean {
  return spec.belts.some(({ spec: b }) => {
    const dx = b.x1 - b.x0,
      dy = b.y1 - b.y0,
      len2 = dx * dx + dy * dy;
    const k = Math.max(0, Math.min(1, ((x - b.x0) * dx + (y - b.y0) * dy) / len2));
    return Math.hypot(x - (b.x0 + dx * k), y - (b.y0 + dy * k)) < b.width / 2 + margin;
  });
}

/**
 * Lamps along the edges of the floor: on open tiles against the rock, the
 * post set in from the rock face, one every so far. Not on a belt's line, in
 * a heap, on or beside a cutting, or against a brick wall or a hidden
 * chamber's rock, which come down; every tile is tried in the same order, so
 * the same lamps come every time.
 */
function placeLamps(cells: Uint8Array, spec: CaveSpec, grid: Grid): Lamp[] {
  const { cols, rows } = grid;
  const out: Lamp[] = [];
  const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= cols || ty >= rows ? ROCK : cells[ty * cols + tx]);
  for (let ty = 1; ty < rows - 1; ty++) {
    for (let tx = 1; tx < cols - 1; tx++) {
      if (at(tx, ty) !== OPEN) continue;
      // against plain rock on one side, and nothing that comes down or opens within a tile
      let nx = 0,
        ny = 0,
        unsure = false;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const c = at(tx + ox, ty + oy);
          if (c >= SECRET) unsure = true;
          if (c === ROCK && (ox === 0 || oy === 0)) {
            nx -= ox;
            ny -= oy;
          }
        }
      }
      if (unsure || (nx === 0 && ny === 0)) continue;
      const [cx, cy] = tileCentre(grid, tx, ty);
      const len = Math.hypot(nx, ny);
      const x = cx - (nx / len) * (TILE / 2 - LAMP_OFF_ROCK),
        y = cy - (ny / len) * (TILE / 2 - LAMP_OFF_ROCK);
      if (nearHole(spec.holes, x, y, 8) || nearHeap(spec, x, y) || nearBelt(spec, x, y)) continue;
      if (nearCutting(grid, spec, x, y, 1)) continue;
      if (out.some((l) => Math.hypot(l.x - x, l.y - y) < LAMP_SPACING)) continue;
      out.push({ x, y, height: LAMP_HEIGHT });
    }
  }
  // and across the middle of the floor, on a grid, so nowhere is out of reach of one: not in a heap,
  // on a belt, by a hole, or on or beside anything that comes down or opens
  const step = Math.round(FLOOR_LAMP_SPACING / TILE);
  for (let ty = 1; ty < rows - 1; ty++) {
    for (let tx = 1; tx < cols - 1; tx++) {
      if ((tx - cols / 2) % step !== 0 || (ty - rows / 2) % step !== 0) continue;
      if (at(tx, ty) !== OPEN) continue;
      let clear = true;
      for (let oy = -1; oy <= 1 && clear; oy++)
        for (let ox = -1; ox <= 1; ox++)
          if (at(tx + ox, ty + oy) !== OPEN) {
            clear = false;
            break;
          }
      if (!clear) continue;
      const [x, y] = tileCentre(grid, tx, ty);
      if (nearHole(spec.holes, x, y, 10) || nearHeap(spec, x, y, 1.5) || nearBelt(spec, x, y)) continue;
      if (nearCutting(grid, spec, x, y, 1)) continue;
      if (out.some((l) => Math.hypot(l.x - x, l.y - y) < 12)) continue;
      out.push({ x, y, height: LAMP_HEIGHT });
    }
  }
  return out;
}

// ---- the way in and the way out ----

/**
 * A point against a cutting: how far along it the point is, from the cutting's inner end toward its
 * outer one, in world units; how long the cutting is; and whether the point is inside it.
 */
function alongCutting(
  grid: Grid,
  c: Cutting,
  x: number,
  y: number,
): { along: number; length: number; inside: boolean } {
  const [bx0, by0, bx1, by1] = cuttingBox(grid, c);
  const [ox, oy] = c.out;
  const inside = x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
  if (ox) {
    const inner = ox > 0 ? bx0 : bx1;
    return { along: (x - inner) * ox, length: bx1 - bx0, inside };
  }
  const inner = oy > 0 ? by0 : by1;
  return { along: (y - inner) * oy, length: by1 - by0, inside };
}

/** How far short of a way out's outer end the leaving line is: past it, the machine has gone. */
export const LEAVING_SHORT = 3 * TILE;
/** How dark it is at the outer end of the way in, where the machine arrives. */
export const ARRIVAL_DARK = 0.85;

/**
 * How dark it is at a point, 0 to 1: nothing outside the cuttings; down the
 * way out, rising from nothing at the cave's floor to black at the leaving
 * line; down the way in, from ARRIVAL_DARK at its outer end, falling to
 * nothing at the floor. The page fades to black by it, so the swap to the
 * next cave is made in the dark.
 */
export function darkness(cave: Cave, open: boolean, x: number, y: number): number {
  const { spec, grid } = cave;
  let d = 0;
  const a = alongCutting(grid, spec.entry, x, y);
  if (a.inside) d = ARRIVAL_DARK * Math.max(0, Math.min(1, a.along / a.length));
  if (open && spec.exit) {
    const e = alongCutting(grid, spec.exit, x, y);
    if (e.inside) d = Math.max(d, Math.max(0, Math.min(1, e.along / (e.length - LEAVING_SHORT))));
  }
  return d;
}

/** Whether a point is down the way out, past its leaving line: where the machine has gone on into the next cave. */
export function pastLeavingLine(cave: Cave, x: number, y: number): boolean {
  const { spec, grid } = cave;
  if (!spec.exit) return false;
  const e = alongCutting(grid, spec.exit, x, y);
  return e.inside && e.along > e.length - LEAVING_SHORT;
}

/**
 * Whether a point is down the way out: in its cutting, and more than a tile past the mouth. The machine
 * there has left the cave's floor, so what it needs to be told is no longer where the way out is.
 */
export function downWayOut(cave: Cave, x: number, y: number): boolean {
  const points = exitPoints(cave);
  if (!points || !cave.spec.exit) return false;
  if (!alongCutting(cave.grid, cave.spec.exit, x, y).inside) return false;
  const [ox, oy] = cave.spec.exit.out;
  return (x - points.mouth.x) * ox + (y - points.mouth.y) * oy > TILE;
}

/**
 * Where the machine arrives, and which way it faces: one tile in from the outer end of the way in,
 * facing into the cave, along the middle of the cutting.
 */
export function arrival(cave: Cave): { x: number; y: number; yaw: number } {
  const { spec, grid } = cave;
  const [x0, y0, x1, y1] = spec.entry.tiles;
  const [ox, oy] = spec.entry.out;
  const tx = ox < 0 ? x0 - ox : ox > 0 ? x1 - ox : (x0 + x1) / 2,
    ty = oy < 0 ? y0 - oy : oy > 0 ? y1 - oy : (y0 + y1) / 2;
  const [x, y] = tileCentre(grid, tx, ty);
  // a cutting an even number of tiles across has its middle on a tile's edge
  return { x, y, yaw: Math.atan2(-oy, -ox) };
}

/**
 * Two points down the way out, along its middle: its mouth, the first tile of it that is rock, where it
 * meets the cave's floor, for an arrow to point at; and one a tile short of its outer end, which is past
 * the leaving line, for something that wants to drive on out. The mouth is found in the cells and not
 * taken from the cutting's box, since the box's inner end may lie in floor that was carved already. Null
 * in the last cave, which has no way out.
 */
export function exitPoints(cave: Cave): { mouth: { x: number; y: number }; beyond: { x: number; y: number } } | null {
  const { spec, grid, cells } = cave;
  if (!spec.exit) return null;
  const [x0, y0, x1, y1] = spec.exit.tiles;
  const [ox, oy] = spec.exit.out;
  const mid = (a: number, b: number) => (a + b) / 2;
  // along the cutting from its inner end outward, down the middle
  const at = (along: number): [number, number] =>
    ox ? [ox > 0 ? x0 + along : x1 - along, mid(y0, y1)] : [mid(x0, x1), oy > 0 ? y0 + along : y1 - along];
  const length = ox ? x1 - x0 + 1 : y1 - y0 + 1;
  let first = 0;
  while (first < length - 1) {
    const [tx, ty] = at(first);
    if (cells[Math.floor(ty) * grid.cols + Math.floor(tx)] === EXIT) break;
    first++;
  }
  const [mx, my] = tileCentre(grid, ...at(first)),
    [bx, by] = tileCentre(grid, ...at(length - 2));
  return { mouth: { x: mx, y: my }, beyond: { x: bx, y: by } };
}

/** The tiles of the way out that meet the cave's floor, as world centres: where the rock bursts when it opens. */
export function exitFaces(cave: Cave): [number, number][] {
  const { cells, grid } = cave;
  const { cols, rows } = grid;
  const out: [number, number][] = [];
  for (let t = 0; t < cells.length; t++) {
    if (cells[t] !== EXIT) continue;
    const tx = t % cols,
      ty = (t / cols) | 0;
    const beside = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => {
      const nx = tx + dx,
        ny = ty + dy;
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && cells[ny * cols + nx] === OPEN;
    });
    if (beside) out.push(tileCentre(grid, tx, ty));
  }
  return out;
}
