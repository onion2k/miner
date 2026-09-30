/**
 * What is in the cave: every coin, gem, bar and brick the world holds, where
 * each came from, and how much of the cave, each chamber, side room and wall
 * is still lying about. Put back from the save when the game starts, added to
 * as walls come down, and taken from as things go down the hole.
 *
 * It keeps its own counts rather than asking the world, and hands the counts
 * of what is left to the save as they are, so the save is never behind.
 */
import { chamberCentre, stashCentre, tileCentre, type BarrelSpot, type Cave, type Heap } from './cave';
import { caveStock, sourcesOf, type Sources } from './economy';
import { BARREL_KIND, BRICK_KIND, KINDS, KIND_RADIUS, KIND_VALUE, type World } from './physics';

/** Where a body came from when it came from nowhere that counts: a brick. */
export const NO_SOURCE = 255;

/** A hidden chamber's loot, as a heap in the middle of it. */
export function lootHeap(cave: Cave, k: number): Heap {
  const [x, y] = chamberCentre(cave, k);
  return { x, y, ...cave.spec.secrets[k].loot };
}

/** A side room's loot, likewise. */
export function stashHeap(cave: Cave, k: number): Heap {
  const [x, y] = stashCentre(cave, k);
  return { x, y, ...cave.spec.stashes[k].loot };
}

/** What was set in a wall now down, put back by where the wall stood. */
export function treasureHeap(cave: Cave, w: number): Heap {
  const wall = cave.spec.walls[w];
  const [x0, y0, x1, y1] = wall.tiles,
    [x, y] = tileCentre(cave.grid, (x0 + x1) / 2, (y0 + y1) / 2);
  return { x, y, coins: 0, gems: wall.treasure };
}

/** The parts of the save that say what was left. */
export interface SavedStock {
  /** What was left of each source, by kind, when last saved; any shape an older save had. */
  left: readonly (readonly number[] | number | undefined)[];
  done: boolean;
  secrets: readonly boolean[];
  walls: readonly boolean[];
  /** Every brick lying about, four numbers each: x, y, z and the grade of wall it came from. */
  rubble: readonly number[];
  /** Every barrel still about, three numbers each: x, y and z; null for none ever placed. */
  barrels: readonly number[] | null;
}

export class Stock {
  /** Which source each body came from, by slot. */
  readonly origin: Uint8Array;
  /** The grade of wall each brick came from, by slot. */
  readonly brickGrade: Uint8Array;
  /** How many of each kind are in the world. */
  readonly kinds = new Array<number>(KINDS).fill(0);
  /** How many of each kind are left from each source. */
  readonly left: number[][];
  private readonly sources: Sources;
  private readonly stocked: { value: number; kinds: number[] };

  /**
   * `cave` is what is being kept, for where its chambers and walls are and what is in it.
   * `capacity[kind]` is how many of each kind past the coins may be in the
   * world at once, for drawing; anything spawned without a source is counted
   * to the cave. `barrels` is where its barrels stand when it begins.
   */
  constructor(
    private readonly cave: Cave,
    private readonly world: World,
    private readonly capacity: readonly number[],
    private readonly barrels: readonly BarrelSpot[] = [],
    private readonly random: () => number = Math.random,
  ) {
    this.sources = sourcesOf(cave.spec);
    this.left = Array.from({ length: this.sources.count }, () => new Array<number>(KINDS).fill(0));
    this.stocked = caveStock(cave.spec);
    this.origin = new Uint8Array(world.capacity);
    this.brickGrade = new Uint8Array(world.capacity);
  }

  /** A body into the world from a source, if there is room for another of its kind. */
  spawn(kind: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, from = 0): boolean {
    if (kind > 0 && this.kinds[kind] >= this.capacity[kind]) return false;
    const i = this.world.spawn(kind, x, y, z, vx, vy, vz);
    if (i < 0) return false;
    this.origin[i] = from;
    this.kinds[kind]++;
    this.left[from][kind]++;
    return true;
  }

  /** A brick off a wall of `grade`: counted in the world, but from no source, since it is worth nothing. Its slot, or -1. */
  spawnBrick(grade: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): number {
    if (this.kinds[BRICK_KIND] >= this.capacity[BRICK_KIND]) return -1;
    const i = this.world.spawn(BRICK_KIND, x, y, z, vx, vy, vz);
    if (i < 0) return -1;
    this.origin[i] = NO_SOURCE;
    this.brickGrade[i] = grade;
    this.kinds[BRICK_KIND]++;
    return i;
  }

  /** A barrel standing at (x, y): counted in the world, from no source, since it is worth nothing. Its slot, or -1. */
  spawnBarrel(x: number, y: number, z = KIND_RADIUS[BARREL_KIND] + 0.05): number {
    if (this.kinds[BARREL_KIND] >= (this.capacity[BARREL_KIND] ?? Infinity)) return -1;
    const i = this.world.spawn(BARREL_KIND, x, y, z);
    if (i < 0) return -1;
    this.origin[i] = NO_SOURCE;
    this.kinds[BARREL_KIND]++;
    return i;
  }

  /** A barrel gone off, by its slot: out of the world and the counts. */
  removeBarrel(i: number) {
    if (!this.world.alive[i] || this.world.kind[i] !== BARREL_KIND) return;
    this.world.remove(i);
    this.kinds[BARREL_KIND]--;
  }

  /** A heap from a source, with `share[kind]` of each kind in it: all of them for one just opened. */
  spawnHeap(from: number, h: Heap, share: readonly number[] = new Array<number>(KINDS).fill(1)) {
    const counts = new Array<number>(KINDS).fill(0);
    counts[0] = Math.round(h.coins * share[0]);
    for (const [kind, n] of h.gems) counts[kind] += Math.round(n * share[kind]);
    this.spawnCounted(from, h, counts);
  }

  /** A heap from a source with `counts[kind]` of each kind in it, the coins spread as the heap's own coins would be. */
  private spawnCounted(from: number, h: Heap, counts: readonly number[]) {
    const coins = counts[0];
    const R = Math.sqrt(coins) * 0.36 + 1.5,
      H = Math.sqrt(coins) * 0.3 + 1.5;
    const drop = (kind: number) => {
      const z = 1 + this.random() * H;
      const rr = R * (1 - z / (H + 2)) * Math.sqrt(this.random()),
        a = this.random() * Math.PI * 2;
      this.spawn(kind, h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, z, 0, 0, 0, from);
    };
    for (let k = 0; k < coins; k++) drop(0);
    for (let kind = 1; kind < KINDS; kind++) for (let k = 0; k < counts[kind]; k++) drop(kind);
  }

  /**
   * Put the cave back as the save left it: its heaps, as much of them as was
   * left, smaller where they started; whole for a save with nothing said of
   * it, unless the game is done and the last cave was emptied long ago. The
   * hidden chambers broken into, the side rooms, and treasure off walls knocked
   * down, each from what was left of it. And the bricks, where they lay.
   */
  restore(saved: SavedStock) {
    const hadOf = (from: number): number[] | null => {
      const was = saved.left[from];
      // a save from before the gold bars has a kind fewer; one from before sources were kept has a number
      if (was === undefined || typeof was === 'number' || was.length < 5) return null;
      return Array.from({ length: KINDS }, (_, k) => was[k] ?? 0);
    };
    const shareOf = (had: number[] | null, stock: readonly number[]) =>
      stock.map((n, k) => (had && n ? Math.min(1, had[k] / n) : 1));
    const spawnSaved = (from: number, heap: Heap) => {
      const stock = new Array<number>(KINDS).fill(0);
      stock[0] = heap.coins;
      for (const [kind, n] of heap.gems) stock[kind] += n;
      this.spawnHeap(from, heap, shareOf(hadOf(from), stock));
    };
    const had = hadOf(0);
    if (had || !saved.done) {
      // exactly what was left of each kind, shared out over the cave's heaps as they started: a share
      // rounded heap by heap would come back with a few more or fewer than went
      const heaps = this.cave.spec.heaps;
      const counts = heaps.map(() => new Array<number>(KINDS).fill(0));
      for (let kind = 0; kind < KINDS; kind++) {
        const per = heaps.map((h) =>
          kind === 0 ? h.coins : h.gems.reduce((n, [k, m]) => n + (k === kind ? m : 0), 0),
        );
        const total = per.reduce((x, y) => x + y, 0);
        if (!total) continue;
        const want = had ? Math.min(had[kind], total) : total;
        const exact = per.map((n) => (n * want) / total);
        exact.forEach((e, j) => (counts[j][kind] = Math.floor(e)));
        let over = want - counts.reduce((n, c) => n + c[kind], 0);
        for (const j of exact.map((_, j) => j).sort((p, q) => (exact[q] % 1) - (exact[p] % 1))) {
          if (over-- <= 0) break;
          counts[j][kind]++;
        }
      }
      heaps.forEach((h, j) => this.spawnCounted(0, h, counts[j]));
    }
    const { cave, sources } = this;
    cave.spec.secrets.forEach((_, k) => {
      if (saved.secrets[k]) spawnSaved(sources.chamber(k), lootHeap(cave, k));
    });
    cave.spec.stashes.forEach((_, k) => spawnSaved(sources.stash(k), stashHeap(cave, k)));
    cave.spec.walls.forEach((wall, w) => {
      if (saved.walls[w] && wall.treasure.length && hadOf(sources.wall(w)))
        spawnSaved(sources.wall(w), treasureHeap(cave, w));
    });
    for (let k = 0; k + 3 < saved.rubble.length; k += 4) {
      const [x, y, z, grade] = saved.rubble.slice(k, k + 4);
      if (this.spawnBrick(grade, x, y, z) < 0) break;
    }
    // the barrels where they were left, or for a cave just begun, where they start
    if (saved.barrels === null) {
      for (const b of this.barrels) this.spawnBarrel(b.x, b.y);
    } else {
      for (let k = 0; k + 2 < saved.barrels.length; k += 3) {
        const [x, y, z] = saved.barrels.slice(k, k + 3);
        this.spawnBarrel(x, y, z);
      }
    }
  }

  /**
   * A body gone down the hole, by its slot, before the world frees it: taken
   * off the counts. Its value, which for a brick is nothing.
   */
  collect(kind: number, i: number): number {
    this.kinds[kind]--;
    if (kind === BRICK_KIND || kind === BARREL_KIND) return 0;
    this.left[this.origin[i]][kind]--;
    return KIND_VALUE[kind];
  }

  /** What is still in the cave from a source, in coins: the cave itself by default, or a chamber, side room or wall. */
  lying(from = 0): number {
    return this.left[from].reduce((sum, n, k) => sum + n * KIND_VALUE[k], 0);
  }

  /** What is still in the cave from every source, in coins: what leaving it loses. */
  lyingAll(): number {
    return this.left.reduce((sum, _, from) => sum + this.lying(from), 0);
  }

  /** How much of the cave itself is banked, 0 to 1: what a chamber or side room holds is over and above it. */
  banked(): number {
    return Math.max(0, Math.min(1, 1 - this.lying() / this.stocked.value));
  }

  /** Where every barrel is, three numbers each, for the save. */
  barrelRecord(): number[] {
    const { world } = this;
    const out: number[] = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.kind[i] !== BARREL_KIND) continue;
      out.push(+world.x[i].toFixed(2), +world.y[i].toFixed(2), +world.z[i].toFixed(2));
    }
    return out;
  }

  /** Where every brick lies, four numbers each, for the save. */
  rubble(): number[] {
    const { world } = this;
    const out: number[] = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.kind[i] !== BRICK_KIND) continue;
      out.push(+world.x[i].toFixed(2), +world.y[i].toFixed(2), +world.z[i].toFixed(2), this.brickGrade[i]);
    }
    return out;
  }
}
