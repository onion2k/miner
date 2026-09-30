/**
 * The cave: a grid of tiles, each rock or open, carved as a few wobbly
 * ellipses joined by corridors. Four of the corridors are blocked by gates —
 * rock that comes down when the room before is cleared — and each room has
 * heaps of coins, which is all it has, and somewhere a conveyor could run.
 * The last room also has a vein, which trickles more in once the whole cave
 * is clear, so there is still something to push.
 *
 * This file is the machinery: the kinds of thing a cave is made of, how a
 * `CaveSpec` is carved into a `Cave`, and the questions asked of one. What a
 * cave actually holds is content, and is handed in (`caves.ts` has the one the
 * game plays), so the grid's size, its corner and its holes are the cave's
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
/** A gate tile's value is GATE + the index of the area it opens. */
export const GATE = 2;
/** A hidden chamber's tiles, and the rock that breaks to open it, are SECRET + the chamber's index. */
export const SECRET = 16;
/** A brick wall's tiles are BRICK + the wall's index. */
export const BRICK = 32;

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

/**
 * The hollow in the middle, and an alcove out each side of it, in tiles from
 * the middle of the grid; a tile is TILE world units, so a tile n along is 4n
 * in the world. Each other room is out one way from it (see `Wing`), and its
 * extents along that way are what says where its gate is, where the way into
 * it starts, and where going on into it seals the room behind.
 */
export interface HollowShape {
  rx: number;
  ry: number;
  alcove: { along: number; rx: number; ry: number };
}

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

/** A barrel where it stands when its room opens. */
export interface BarrelSpot {
  x: number;
  y: number;
  area: number;
}

/** A lamp on a post. `area` is the room it lights, which is when it is lit. */
export interface Lamp {
  x: number;
  y: number;
  area: number;
  /** How high its head stands. */
  height: number;
}

/**
 * A cave as content: everything `buildCave` carves from and everything the
 * game asks of it, in tiles from the middle of the grid, which is where
 * the rooms are laid out from.
 */
export interface CaveSpec {
  cols: number;
  rows: number;
  /** Every way down. The first is where a drone is sent home to. */
  holes: HoleSpec[];
  hollow: HollowShape;
  wings: Wing[];
  areas: Area[];
  /** The order the rooms open in, one when the one before is cleared: by what is in them. */
  order: number[];
  secrets: Secret[];
  walls: Wall[];
  stashes: Stash[];
  /** How many barrels each room has, the hollow first. */
  barrelsIn: number[];
}

export interface Cave {
  spec: CaveSpec;
  grid: Grid;
  holes: readonly HoleSpec[];
  cells: Uint8Array;
  /** The lamps, the same ones every time the cave is built. */
  lamps: Lamp[];
  /** Where each room's barrels stand when it opens, the same every time. */
  barrels: BarrelSpot[];
  /**
   * A rock tile's cell is 1; a gate's is 1 until its area is opened, a hidden
   * chamber's, and the rock in front of it, until it is broken into, and a
   * brick wall's until it is knocked down.
   */
  solid(unlocked: boolean[], revealed?: boolean[], broken?: boolean[]): Uint8Array;
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

/** Whether a cell is rock to look at: rock, or a chamber not yet broken into. A brick wall is drawn as bricks, on floor. */
export function rockish(cell: number, revealed: boolean[]): boolean {
  return cell === ROCK || (cell >= SECRET && cell < BRICK && !revealed[cell - SECRET]);
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
  // tiles counted from the middle of the grid, which is where the rooms are laid out from
  const C = cols / 2,
    R = rows / 2;
  const { hollow, wings } = spec;
  const cells = new Uint8Array(cols * rows).fill(ROCK);
  // the hollow, with an alcove each side
  carveEllipse(cells, grid, C, R, hollow.rx, hollow.ry, 1.7);
  carveEllipse(cells, grid, C - hollow.alcove.along, R - 1, hollow.alcove.rx, hollow.alcove.ry, 4.1);
  carveEllipse(cells, grid, C + hollow.alcove.along, R + 1, hollow.alcove.rx, hollow.alcove.ry, 2.9);
  // each wing: its room, and its corridor from the hollow with a gate across it
  for (let a = 1; a < wings.length; a++) {
    const {
      dir: [dx, dy],
      room,
      corridor,
      gate,
    } = wings[a];
    const tile = (along: number, across: number): [number, number] =>
      dx ? [C + dx * along, R + across] : [C + across, R + dy * along];
    const [cx, cy] = tile(room.along, room.across);
    carveEllipse(cells, grid, cx, cy, dx ? room.half : room.halfAcross, dx ? room.halfAcross : room.half, room.seed);
    const [ax, ay] = tile(corridor.from, corridor.across[0]),
      [bx, by] = tile(corridor.to, corridor.across[1]);
    carveRect(cells, grid, Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    const [gx0, gy0] = tile(gate, corridor.across[0]),
      [gx1, gy1] = tile(gate, corridor.across[1]);
    carveRect(cells, grid, Math.min(gx0, gx1), Math.min(gy0, gy1), Math.max(gx0, gx1), Math.max(gy0, gy1), GATE + a);
  }
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
    solid(unlocked, revealed = [], broken = []) {
      const out = new Uint8Array(cols * rows);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        out[i] =
          c === OPEN
            ? 0
            : c >= BRICK
              ? broken[c - BRICK]
                ? 0
                : 1
              : c >= SECRET
                ? revealed[c - SECRET]
                  ? 0
                  : 1
                : c >= GATE
                  ? unlocked[c - GATE]
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

/**
 * Where each room's barrels stand: out on the floor the dozer drives, with
 * floor all round, clear of the heaps, the belts, the lamps, the holes and
 * anything that comes down or opens; spread about, and the same every time.
 * Not behind a brick wall, where they would be no use to anyone.
 */
function placeBarrels(cells: Uint8Array, spec: CaveSpec, grid: Grid, lamps: readonly Lamp[]): BarrelSpot[] {
  const { cols, rows } = grid;
  const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= cols || ty >= rows ? ROCK : cells[ty * cols + tx]);
  // the floor joined to a hole with every gate down and every wall standing
  const joined = new Uint8Array(cols * rows);
  const stack = spec.holes.map(
    (h) => Math.floor((h.y - grid.originY) / TILE) * cols + Math.floor((h.x - grid.originX) / TILE),
  );
  while (stack.length) {
    const t = stack.pop()!;
    const c = cells[t];
    if (joined[t] || !(c === OPEN || (c >= GATE && c < SECRET))) continue;
    joined[t] = 1;
    const tx = t % cols;
    if (tx > 0) stack.push(t - 1);
    if (tx < cols - 1) stack.push(t + 1);
    if (t >= cols) stack.push(t - cols);
    if (t < cols * (rows - 1)) stack.push(t + cols);
  }
  const candidates: { x: number; y: number; area: number; rank: number }[] = [];
  for (let ty = 2; ty < rows - 2; ty++) {
    for (let tx = 2; tx < cols - 2; tx++) {
      if (!joined[ty * cols + tx] || at(tx, ty) !== OPEN) continue;
      let clear = true;
      for (let oy = -1; oy <= 1 && clear; oy++)
        for (let ox = -1; ox <= 1; ox++) if (at(tx + ox, ty + oy) !== OPEN) clear = false;
      if (!clear) continue;
      const [x, y] = tileCentre(grid, tx, ty);
      if (nearHole(spec.holes, x, y, 12) || nearHeap(spec, x, y, 5) || nearBelt(spec, x, y, 4)) continue;
      if (lamps.some((l) => Math.hypot(l.x - x, l.y - y) < 5)) continue;
      candidates.push({ x, y, area: areaAt(spec, x, y), rank: hash(tx, ty, 91) });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const out: BarrelSpot[] = [];
  for (const c of candidates) {
    if (out.filter((b) => b.area === c.area).length >= (spec.barrelsIn[c.area] ?? 0)) continue;
    if (out.some((b) => Math.hypot(b.x - c.x, b.y - c.y) < BARREL_SPACING)) continue;
    out.push({ x: c.x, y: c.y, area: c.area });
  }
  return out;
}

/** Whether a point is within `margin` of the edge of any room's heap. */
function nearHeap(spec: CaveSpec, x: number, y: number, margin = 4): boolean {
  return spec.areas.some((a) => a.heaps.some((h) => Math.hypot(h.x - x, h.y - y) < Math.sqrt(h.coins) * 0.36 + margin));
}

/** Whether a point is within `margin` of the side of any room's belt. */
function nearBelt(spec: CaveSpec, x: number, y: number, margin = 3): boolean {
  return spec.areas.some((a) => {
    const b = a.belt?.spec;
    if (!b) return false;
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
 * a heap, by a gate, or against a brick wall or a hidden chamber's rock,
 * which come down; every tile is tried in the same order, so the same lamps
 * come every time. A pen has none.
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
          if (c >= GATE) unsure = true;
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
      if (out.some((l) => Math.hypot(l.x - x, l.y - y) < LAMP_SPACING)) continue;
      out.push({ x, y, area: areaAt(spec, x, y), height: LAMP_HEIGHT });
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
      if (out.some((l) => Math.hypot(l.x - x, l.y - y) < 12)) continue;
      out.push({ x, y, area: areaAt(spec, x, y), height: LAMP_HEIGHT });
    }
  }
  return out;
}

/** The gate tiles of an area, as world centres. */
export function gateTiles(cave: Cave, area: number): [number, number][] {
  const { cols, rows } = cave.grid;
  const out: [number, number][] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (cave.cells[ty * cols + tx] === GATE + area) out.push(tileCentre(cave.grid, tx, ty));
    }
  }
  return out;
}

/** How far out a point is along a wing, and how far across it, in world units. */
function alongWing(spec: CaveSpec, area: number, x: number, y: number): [number, number] {
  const [dx, dy] = spec.wings[area].dir;
  return dx ? [dx * x, y] : [dy * y, x];
}

/**
 * The band a room lies across, from the hollow out: a little wider than the
 * room itself. It keeps a hidden chamber, side room or pen off one room, out
 * past the corner of another, from counting as the way into that other.
 */
function inBand(spec: CaveSpec, area: number, x: number, y: number): boolean {
  const { room } = spec.wings[area];
  const [, across] = alongWing(spec, area, x, y);
  return Math.abs(across - room.across * TILE) < (room.halfAcross + 3) * TILE;
}

/** Where a wing's room starts, along it, in world units: its near edge. */
const nearEdge = (spec: CaveSpec, area: number) => (spec.wings[area].room.along - spec.wings[area].room.half) * TILE;

/**
 * Whether a point is well inside a room, through the gate and the corridor
 * and out among its heaps: where the player has gone on into it. The hollow
 * has no gate, and nobody goes on into it.
 */
export function pastGate(spec: CaveSpec, area: number, x: number, y: number): boolean {
  return area > 0 && inBand(spec, area, x, y) && alongWing(spec, area, x, y)[0] > nearEdge(spec, area) + 8;
}

/** Where, down a room's corridor, going on seals the room behind: the line `pastGate` draws, in the corridor's middle. */
export function sealPoint(cave: Cave, area: number): [number, number] {
  const [gx, gy] = gateCentre(cave, area);
  const [dx, dy] = cave.spec.wings[area].dir,
    at = nearEdge(cave.spec, area) + 8;
  return dx ? [dx * at, gy] : [gx, dy * at];
}

/** Whether a point is up to a room's gate, or through it and not yet past: where going on is a turn of the wheel away. */
export function atGate(spec: CaveSpec, area: number, x: number, y: number): boolean {
  return area > 0 && inBand(spec, area, x, y) && alongWing(spec, area, x, y)[0] > spec.wings[area].mouth * TILE - 6;
}

/** Whether a machine at a point would be shut in, or in the rock, when a room's gate closes. */
export function behindGate(spec: CaveSpec, area: number, x: number, y: number): boolean {
  return area > 0 && inBand(spec, area, x, y) && alongWing(spec, area, x, y)[0] > spec.wings[area].mouth * TILE - 3;
}

/** The middle of an area's gate, for pointing at. */
export function gateCentre(cave: Cave, area: number): [number, number] {
  const tiles = gateTiles(cave, area);
  return [tiles.reduce((s, t) => s + t[0], 0) / tiles.length, tiles.reduce((s, t) => s + t[1], 0) / tiles.length];
}

/** Which area a world point is in, by the room's rough extent: 1 south, 2 north, 3 east, 4 west, 0 otherwise. */
export function areaAt(spec: CaveSpec, x: number, y: number): number {
  for (let a = 1; a < spec.wings.length; a++) if (behindGate(spec, a, x, y)) return a;
  return 0;
}
