/**
 * Finding the way round the rock, for the robo-dozers.
 *
 * The open floor as tiles, and fields over them: how far each tile is from
 * somewhere, walking. The holes' field is kept, since every load goes to one;
 * a field toward anywhere else is made when a machine wants it, which for a
 * cave of a few thousand tiles is a moment's work. A tile beside the rock
 * costs more to cross than one in the open, so the way keeps to the middle
 * of a corridor, where a machine and its load fit.
 *
 * The way to somewhere other than the hole goes round the heaps as well:
 * a machine driving through a heap to get behind a coin shoves the heap
 * about and arrives with the wrong load. The way to the hole goes straight
 * through, since pushing a heap along is the point.
 *
 * A load does not have to go all the way to the hole: onto a running belt
 * is as good, and the belt does the rest of the carrying while the machine
 * goes back for more. `toDrop` is how far each tile is from wherever a load
 * can be left, the hole or a belt, a belt counting a little for handing the
 * load over and a little for the way it has still to ride.
 *
 * A field says which tile is next; `ahead` looks down the way for the
 * furthest point there is a clear line to, so a machine drives at a corner
 * and not from tile to tile.
 */
import { TILE, type Grid, type HoleSpec } from './cave';
import type { Belt } from './physics';

/** What crossing a tile costs over the open floor: beside the rock, and one further off. */
const BESIDE_ROCK = 3,
  NEAR_ROCK = 0.6;
/** What leaving a load on a belt counts for, against pushing it: getting it on, and each tile it has still to ride. */
const BELT_HANDOVER = 2,
  BELT_RIDE = 0.1;
/** What crossing a tile of coins costs, a coin at a time, and the most it can come to. */
const PER_COIN = 0.12,
  CROWD_MOST = 6;
/** The eight ways out of a tile, with what each step costs in tiles. */
const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export class Nav {
  private solid!: Uint8Array;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cost: Float32Array;
  /** How many coins lie on each tile, as last counted: what the way round the heaps goes round. */
  readonly crowd: Uint16Array;
  /** How far each tile is from the nearest hole, in tiles and the extra the rock costs; Infinity where there is no way. */
  readonly toHole: Float32Array;
  /**
   * How far each tile is from each hole on its own, by the hole's place in the cave's list, for telling which
   * hole a coin is nearest along the floor. A cave with one hole has only `toHole`, and the list is that.
   */
  readonly toEach: Float32Array[];
  /** How far each tile is from somewhere a load can be left: a hole, or a running belt. */
  readonly toDrop: Float32Array;
  /** The same for a load that is for one hole only, by the hole's place in the list: that hole, or a running belt. One hole has only `toDrop`. */
  readonly toDropEach: Float32Array[];
  private belts: Belt[] = [];
  /**
   * How far each tile is from a running belt alone, handover and ride counted, as last laid. The drop fields
   * are the nearer of this and the hole's own field, so a belt bought or sold is one pass and not one for each hole.
   */
  private readonly toBelt: Float32Array;
  /** The tiles by each hole, as last found: they change only with the rock. */
  private seeds: number[][] = [];
  private readonly heap: Int32Array;
  private readonly heapKey: Float32Array;

  constructor(
    solid: Uint8Array,
    private readonly grid: Grid,
    /** Every hole a load can be pushed down: the drones aim at the nearest. */
    readonly holes: readonly HoleSpec[],
  ) {
    this.cols = grid.cols;
    this.rows = grid.rows;
    const tiles = grid.cols * grid.rows;
    this.cost = new Float32Array(tiles);
    this.crowd = new Uint16Array(tiles);
    this.toHole = new Float32Array(tiles);
    this.toEach = holes.length > 1 ? holes.map(() => new Float32Array(tiles)) : [this.toHole];
    this.toDrop = new Float32Array(tiles);
    this.toDropEach = holes.length > 1 ? holes.map(() => new Float32Array(tiles)) : [this.toDrop];
    this.toBelt = new Float32Array(tiles);
    this.heap = new Int32Array(tiles * 8);
    this.heapKey = new Float32Array(tiles * 8);
    this.rebuild(solid);
  }

  /** The rock has changed: a gate came down or went up. */
  rebuild(solid: Uint8Array) {
    this.solid = solid;
    const { cols, rows } = this;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const t = ty * cols + tx;
        if (solid[t]) {
          this.cost[t] = Infinity;
          continue;
        }
        let near = 0;
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            if (!this.rock(tx + ox, ty + oy)) continue;
            near = Math.max(near, Math.max(Math.abs(ox), Math.abs(oy)) === 1 ? 2 : 1);
          }
        }
        this.cost[t] = 1 + (near === 2 ? BESIDE_ROCK : near === 1 ? NEAR_ROCK : 0);
      }
    }
    this.seeds = this.holeTiles();
    // One pass for each hole. The nearest hole's field, and the field to the holes and belts together,
    // are the nearer of those, and need no pass of their own: a shortest way from a set of places is
    // the shortest of the ways from each.
    if (!this.holes.length) this.toHole.fill(Infinity);
    this.holes.forEach((_, k) => this.fill(this.toEach[k], this.seeds[k], false));
    this.fillDrop();
  }

  /** The hole nearest a point along the floor, by its place in the cave's list; -1 off the grid or with no way to any. */
  holeOf(x: number, y: number): number {
    const t = this.tileOf(x, y);
    if (t < 0) return -1;
    let best = -1,
      nearest = Infinity;
    for (let k = 0; k < this.toEach.length; k++) {
      if (this.toEach[k][t] < nearest) {
        nearest = this.toEach[k][t];
        best = k;
      }
    }
    return best;
  }

  /** How far a point is from one hole along the floor, in tiles and the extra the rock costs; Infinity with no way there. */
  distanceTo(hole: number, x: number, y: number): number {
    return this.distance(this.toEach[hole], x, y);
  }

  /** The belts running now: bought, and in a room not sealed. */
  setBelts(belts: Belt[]) {
    this.belts = belts;
    this.fillDrop();
  }

  /**
   * Whether the best place to leave a load from here is the hole itself, and not a belt: the nearest hole, or
   * the one hole `hole` if the load is for that one.
   */
  dropIsHole(x: number, y: number, hole = -1): boolean {
    const t = this.tileOf(x, y);
    if (t < 0) return false;
    return hole < 0 ? this.toDrop[t] >= this.toHole[t] - 1e-3 : this.toDropEach[hole][t] >= this.toEach[hole][t] - 1e-3;
  }

  /** The field to follow to leave a load: to the nearest hole or belt, or to the one hole `hole` or a belt. */
  dropField(hole = -1): Float32Array {
    return hole < 0 ? this.toDrop : this.toDropEach[hole];
  }

  /** Whether a point is on a running belt, within `margin` of its edges. */
  onBelt(x: number, y: number, margin = 0): Belt | null {
    for (const b of this.belts) {
      const dx = x - b.cx,
        dy = y - b.cy;
      const along = dx * b.dx + dy * b.dy,
        across = -dx * b.dy + dy * b.dx;
      if (Math.abs(along) <= b.half + margin && Math.abs(across) <= b.width / 2 + margin) return b;
    }
    return null;
  }

  /** The open tiles by each hole, in one pass over the floor, that its field runs out from. */
  private holeTiles(): number[][] {
    const { cols, grid } = this;
    const seeds: number[][] = this.holes.map(() => []);
    const tiles = cols * this.rows;
    for (let t = 0; t < tiles; t++) {
      if (this.solid[t]) continue;
      const x = grid.originX + ((t % cols) + 0.5) * TILE,
        y = grid.originY + (((t / cols) | 0) + 0.5) * TILE;
      for (let k = 0; k < seeds.length; k++) {
        const h = this.holes[k];
        if (Math.hypot(x - h.x, y - h.y) < h.radius + TILE) seeds[k].push(t);
      }
    }
    return seeds;
  }

  /** The nearest-hole field, and the drop fields, from the holes' own fields and the belts'. */
  private fillDrop() {
    const beltTiles: number[] = [],
      beltValues: number[] = [];
    if (this.belts.length) {
      const { cols, grid } = this;
      const tiles = cols * this.rows;
      for (let t = 0; t < tiles; t++) {
        if (this.solid[t]) continue;
        const x = grid.originX + ((t % cols) + 0.5) * TILE,
          y = grid.originY + (((t / cols) | 0) + 0.5) * TILE;
        const b = this.onBelt(x, y);
        if (!b) continue;
        // how far it has to ride, from here to the belt's end
        const along = (x - b.cx) * b.dx + (y - b.cy) * b.dy;
        beltTiles.push(t);
        beltValues.push(BELT_HANDOVER + ((b.half - along) / TILE) * BELT_RIDE);
      }
    }
    if (beltTiles.length) this.fill(this.toBelt, beltTiles, false, beltValues);
    else this.toBelt.fill(Infinity);
    const { toBelt } = this;
    const n = toBelt.length;
    if (this.holes.length > 1) {
      for (let k = 0; k < this.holes.length; k++) {
        const each = this.toEach[k],
          dropEach = this.toDropEach[k];
        for (let t = 0; t < n; t++) dropEach[t] = Math.min(each[t], toBelt[t]);
      }
      this.toHole.fill(Infinity);
      for (const each of this.toEach)
        for (let t = 0; t < n; t++) if (each[t] < this.toHole[t]) this.toHole[t] = each[t];
    }
    const { toHole, toDrop } = this;
    for (let t = 0; t < n; t++) toDrop[t] = Math.min(toHole[t], toBelt[t]);
  }

  /** Count the coins onto the tiles again. */
  count(n: number, alive: Uint8Array, x: Float32Array, y: Float32Array) {
    this.crowd.fill(0);
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const t = this.tileOf(x[i], y[i]);
      if (t >= 0 && this.crowd[t] < 65535) this.crowd[t]++;
    }
  }

  /** A field of how far every tile is from a point; Infinity if the point is in rock. */
  toward(x: number, y: number): Float32Array {
    const field = new Float32Array(this.cols * this.rows);
    const t = this.tileOf(x, y);
    this.fill(field, t >= 0 && !this.solid[t] ? [t] : [], true);
    return field;
  }

  tileOf(x: number, y: number): number {
    const { cols, rows, grid } = this;
    const tx = Math.floor((x - grid.originX) / TILE),
      ty = Math.floor((y - grid.originY) / TILE);
    return tx < 0 || ty < 0 || tx >= cols || ty >= rows ? -1 : ty * cols + tx;
  }

  centre(t: number): [number, number] {
    const { cols, grid } = this;
    return [grid.originX + ((t % cols) + 0.5) * TILE, grid.originY + (((t / cols) | 0) + 0.5) * TILE];
  }

  /** How far a point is from wherever a field runs to; Infinity with no way there. */
  distance(field: Float32Array, x: number, y: number): number {
    const t = this.tileOf(x, y);
    return t < 0 ? Infinity : field[t];
  }

  /**
   * Where to aim, from a point, to go down a field: the furthest of the next
   * `steps` tiles along the way that a machine `radius` across can see clear.
   * Null with no way on from here.
   */
  ahead(field: Float32Array, x: number, y: number, radius: number, steps: number): [number, number] | null {
    let t = this.tileOf(x, y);
    if (t < 0) return null;
    if (!Number.isFinite(field[t])) t = this.nearestOpen(field, x, y);
    if (t < 0) return null;
    let aim: [number, number] | null = null;
    for (let k = 0; k < steps; k++) {
      const next = this.downhill(field, t);
      if (next < 0) break;
      t = next;
      const c = this.centre(t);
      if (aim && !this.clear(x, y, c[0], c[1], radius)) break;
      aim = c;
    }
    return aim ?? (Number.isFinite(field[t]) ? this.centre(t) : null);
  }

  /** Whether a machine `radius` across could go straight from one point to another without touching rock. */
  clear(x0: number, y0: number, x1: number, y1: number, radius: number): boolean {
    const len = Math.hypot(x1 - x0, y1 - y0),
      n = Math.max(1, Math.ceil(len / 1.5));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n,
        y = y0 + ((y1 - y0) * k) / n;
      for (const [ox, oy] of [
        [-radius, -radius],
        [radius, -radius],
        [-radius, radius],
        [radius, radius],
      ]) {
        const t = this.tileOf(x + ox, y + oy);
        if (t < 0 || this.solid[t]) return false;
      }
    }
    return true;
  }

  /** The neighbouring tile furthest down a field, never cutting a corner of rock; -1 at the bottom. */
  private downhill(field: Float32Array, t: number): number {
    const { cols } = this;
    const tx = t % cols,
      ty = (t / cols) | 0;
    let best = -1,
      bestValue = field[t];
    for (const [ox, oy] of STEPS) {
      if (this.rock(tx + ox, ty + oy)) continue;
      if (ox && oy && (this.rock(tx + ox, ty) || this.rock(tx, ty + oy))) continue;
      const n = (ty + oy) * cols + tx + ox;
      if (field[n] < bestValue) {
        bestValue = field[n];
        best = n;
      }
    }
    return best;
  }

  /** The open tile with a way on nearest a point that is in rock or cut off. */
  private nearestOpen(field: Float32Array, x: number, y: number): number {
    let best = -1,
      bestD = Infinity;
    const t0 = this.tileOf(x, y);
    if (t0 < 0) return -1;
    const { cols } = this;
    const tx = t0 % cols,
      ty = (t0 / cols) | 0;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        if (this.rock(tx + ox, ty + oy)) continue;
        const n = (ty + oy) * cols + tx + ox;
        if (!Number.isFinite(field[n])) continue;
        const [cx, cy] = this.centre(n);
        const d = Math.hypot(cx - x, cy - y);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    return best;
  }

  private rock(tx: number, ty: number): boolean {
    return tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows || this.solid[ty * this.cols + tx] === 1;
  }

  /** Dijkstra out from the seeds, each starting at its value or 0, over the tiles' costs, and round the heaps if `round`. */
  private fill(field: Float32Array, seeds: number[], round: boolean, values?: number[]) {
    field.fill(Infinity);
    const { heap, heapKey, crowd, cols } = this;
    const cost = round ? this.cost.map((c, t) => c + Math.min(CROWD_MOST, crowd[t] * PER_COIN)) : this.cost;
    let size = 0;
    const push = (t: number, key: number) => {
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKey[p] <= key) break;
        heap[i] = heap[p];
        heapKey[i] = heapKey[p];
        i = p;
      }
      heap[i] = t;
      heapKey[i] = key;
    };
    const pop = (): number => {
      const top = heap[0];
      const t = heap[--size],
        key = heapKey[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && heapKey[c + 1] < heapKey[c]) c++;
        if (heapKey[c] >= key) break;
        heap[i] = heap[c];
        heapKey[i] = heapKey[c];
        i = c;
      }
      heap[i] = t;
      heapKey[i] = key;
      return top;
    };
    seeds.forEach((s, k) => {
      const v = values?.[k] ?? 0;
      if (v < field[s]) {
        field[s] = v;
        push(s, v);
      }
    });
    while (size > 0) {
      const key = heapKey[0],
        t = pop();
      if (key > field[t]) continue;
      const tx = t % cols,
        ty = (t / cols) | 0;
      for (const [ox, oy, step] of STEPS) {
        if (this.rock(tx + ox, ty + oy)) continue;
        if (ox && oy && (this.rock(tx + ox, ty) || this.rock(tx, ty + oy))) continue;
        const n = (ty + oy) * cols + tx + ox;
        const d = field[t] + (step * (cost[t] + cost[n])) / 2;
        if (d < field[n] && size < heap.length) {
          field[n] = d;
          push(n, d);
        }
      }
    }
  }
}
