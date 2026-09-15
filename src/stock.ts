/**
 * What is in the cave: every coin, gem, bar and brick the world holds, where
 * each came from, and how much of each room, chamber, side room and wall is
 * still lying about. Put back from the save when the game starts, added to
 * as rooms open and walls come down, and taken from as things go down the
 * hole or are sealed in with their room.
 *
 * It keeps its own counts rather than asking the world, and hands the counts
 * of what is left to the save as they are, so the save is never behind.
 */
import {
  AREAS,
  SECRETS,
  STASHES,
  WALLS,
  chamberCentre,
  stashCentre,
  tileCentre,
  type BarrelSpot,
  type Heap,
} from './cave';
import { SOURCES, areaOfSource, chamberSource, roomStock, stashSource, wallSource } from './economy';
import { BARREL_KIND, BRICK_KIND, KINDS, KIND_RADIUS, KIND_VALUE, type World } from './physics';

/** Where a body came from when it came from nowhere that counts: a brick. */
export const NO_SOURCE = 255;

/** A hidden chamber's loot, as a heap in the middle of it. */
export function lootHeap(k: number): Heap {
  const [x, y] = chamberCentre(k);
  return { x, y, ...SECRETS[k].loot };
}

/** A side room's loot, likewise. */
export function stashHeap(k: number): Heap {
  const [x, y] = stashCentre(k);
  return { x, y, ...STASHES[k].loot };
}

/** What was set in a wall now down, put back by where the wall stood. */
export function treasureHeap(w: number): Heap {
  const [x0, y0, x1, y1] = WALLS[w].tiles,
    [x, y] = tileCentre((x0 + x1) / 2, (y0 + y1) / 2);
  return { x, y, coins: 0, gems: WALLS[w].treasure };
}

/** The parts of the game's progress that say what is to be put back. */
export interface Progress {
  current(): number;
  next(): number | null;
  nextOpen(): boolean;
  sealed(area: number): boolean;
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
  /** Every barrel still about, four numbers each: x, y, z and its room; null for none ever placed. */
  barrels: readonly number[] | null;
}

export class Stock {
  /** Which source each body came from, by slot. */
  readonly origin: Uint8Array;
  /** The grade of wall each brick came from, by slot. */
  readonly brickGrade: Uint8Array;
  /** The room each barrel belongs to, and is sealed with, by slot. */
  readonly home: Uint8Array;
  /** How many of each kind are in the world. */
  readonly kinds = new Array<number>(KINDS).fill(0);
  /** How many of each kind are left from each source. */
  readonly left: number[][] = Array.from({ length: SOURCES }, () => new Array<number>(KINDS).fill(0));
  private readonly stocks = AREAS.map((_, a) => roomStock(a));

  /**
   * `capacity[kind]` is how many of each kind past the coins may be in the
   * world at once, for drawing; `current` is the room being cleared, which is
   * where anything spawned without a source is counted. `barrels` is where
   * each room's barrels stand when it opens.
   */
  constructor(
    private readonly world: World,
    private readonly capacity: readonly number[],
    private readonly current: () => number,
    private readonly barrels: readonly BarrelSpot[] = [],
    private readonly random: () => number = Math.random,
  ) {
    this.origin = new Uint8Array(world.capacity);
    this.brickGrade = new Uint8Array(world.capacity);
    this.home = new Uint8Array(world.capacity);
  }

  /** A body into the world from a source, if there is room for another of its kind. */
  spawn(kind: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, from = this.current()): boolean {
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

  /** A barrel for a room, standing at (x, y): counted in the world, from no source, since it is worth nothing. Its slot, or -1. */
  spawnBarrel(area: number, x: number, y: number, z = KIND_RADIUS[BARREL_KIND] + 0.05): number {
    if (this.kinds[BARREL_KIND] >= (this.capacity[BARREL_KIND] ?? Infinity)) return -1;
    const i = this.world.spawn(BARREL_KIND, x, y, z);
    if (i < 0) return -1;
    this.origin[i] = NO_SOURCE;
    this.home[i] = area;
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
    const coins = Math.round(h.coins * share[0]);
    const R = Math.sqrt(coins) * 0.36 + 1.5,
      H = Math.sqrt(coins) * 0.3 + 1.5;
    const drop = (kind: number) => {
      const z = 1 + this.random() * H;
      const rr = R * (1 - z / (H + 2)) * Math.sqrt(this.random()),
        a = this.random() * Math.PI * 2;
      this.spawn(kind, h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, z, 0, 0, 0, from);
    };
    for (let k = 0; k < coins; k++) drop(0);
    for (const [kind, n] of h.gems) for (let k = 0, m = Math.round(n * share[kind]); k < m; k++) drop(kind);
  }

  /**
   * Put the cave back as the save left it. The rooms in play, as much of each
   * as was left, the heaps smaller where they started; a room with nothing
   * saved whole, unless the cave is done and the last room was emptied long
   * ago. The hidden chambers broken into off rooms not sealed, the side rooms
   * off rooms in play, and treasure off walls knocked down, each from what
   * was left of it. And the bricks, where they lay.
   */
  restore(saved: SavedStock, progress: Progress) {
    const hadOf = (from: number): number[] | null => {
      const was = saved.left[from];
      // a save from before the gold bars has a kind fewer; one from before sources were kept per room has a number
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
    const next = progress.next();
    const inPlay = [progress.current(), ...(next !== null && progress.nextOpen() ? [next] : [])];
    for (const a of inPlay) {
      const had = hadOf(a);
      if (!had && saved.done) continue;
      const share = shareOf(had, this.stocks[a].kinds);
      AREAS[a].heaps.forEach((h) => this.spawnHeap(a, h, share));
    }
    SECRETS.forEach((secret, k) => {
      if (saved.secrets[k] && !progress.sealed(secret.area)) spawnSaved(chamberSource(k), lootHeap(k));
    });
    STASHES.forEach((stash, k) => {
      if (inPlay.includes(stash.area)) spawnSaved(stashSource(k), stashHeap(k));
    });
    WALLS.forEach((wall, w) => {
      if (saved.walls[w] && wall.treasure.length && inPlay.includes(wall.area) && hadOf(wallSource(w)))
        spawnSaved(wallSource(w), treasureHeap(w));
    });
    for (let k = 0; k + 3 < saved.rubble.length; k += 4) {
      const [x, y, z, grade] = saved.rubble.slice(k, k + 4);
      if (this.spawnBrick(grade, x, y, z) < 0) break;
    }
    // the barrels where they were left, or for a save from before there were any, each room's where they start
    if (saved.barrels === null) {
      for (const b of this.barrels) if (inPlay.includes(b.area)) this.spawnBarrel(b.area, b.x, b.y);
    } else {
      for (let k = 0; k + 3 < saved.barrels.length; k += 4) {
        const [x, y, z, area] = saved.barrels.slice(k, k + 4);
        if (inPlay.includes(area)) this.spawnBarrel(area, x, y, z);
      }
    }
  }

  /** A room just opened: its heaps, its barrels, and what is in its side rooms, to be seen over their walls. */
  openRoom(area: number) {
    AREAS[area].heaps.forEach((h) => this.spawnHeap(area, h));
    for (const b of this.barrels) if (b.area === area) this.spawnBarrel(area, b.x, b.y);
    STASHES.forEach((stash, k) => {
      if (stash.area === area) this.spawnHeap(stashSource(k), stashHeap(k));
    });
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

  /**
   * A room sealed: everything from it, and from any chamber, side room or wall
   * off it, taken out of the world wherever it has got to. Each is told to
   * `gone` as it goes, before it is removed.
   */
  seal(area: number, gone: (x: number, y: number, z: number) => void = () => {}) {
    const { world } = this;
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i]) continue;
      if (world.kind[i] === BARREL_KIND) {
        if (this.home[i] !== area) continue;
        gone(world.x[i], world.y[i], world.z[i]);
        this.removeBarrel(i);
        continue;
      }
      if (this.origin[i] === NO_SOURCE || areaOfSource(this.origin[i]) !== area) continue;
      gone(world.x[i], world.y[i], world.z[i]);
      this.kinds[world.kind[i]]--;
      this.left[this.origin[i]][world.kind[i]]--;
      world.remove(i);
    }
  }

  /** What is still in the cave from a room, in coins. */
  lying(area: number): number {
    return this.left[area].reduce((sum, n, k) => sum + n * KIND_VALUE[k], 0);
  }

  /** How much of a room is banked, 0 to 1. */
  banked(area: number): number {
    return Math.max(0, Math.min(1, 1 - this.lying(area) / this.stocks[area].value));
  }

  /** Where every barrel is, four numbers each with its room, for the save. */
  barrelRecord(): number[] {
    const { world } = this;
    const out: number[] = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.kind[i] !== BARREL_KIND) continue;
      out.push(+world.x[i].toFixed(2), +world.y[i].toFixed(2), +world.z[i].toFixed(2), this.home[i]);
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
