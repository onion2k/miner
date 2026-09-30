/**
 * The bank and what it buys: engine, blade, magnet, a belt for the cave being
 * cleared, and drones; and where the player has got to in the run. The caves
 * are not bought: the way out of one opens when most of it is banked, and
 * driving out through it leaves the cave behind, with whatever is still in it,
 * for the next. Saved in the browser, so the game is where you left it.
 */
import type { CaveSpec } from './cave';
import type { DozerSpec } from './dozer';
import { KINDS, KIND_VALUE } from './physics';

/**
 * Where a body came from, for what is left of it: the cave itself, by 0; then
 * its hidden chambers; then the stashes behind brick walls, side rooms
 * and pens; then the walls, for the treasure set in them. Everything after
 * the cave is kept apart from it so it never counts toward clearing it.
 */
export interface Sources {
  /** How many sources a cave has: the cave, and every chamber, side room and wall. */
  readonly count: number;
  chamber(k: number): number;
  stash(k: number): number;
  wall(w: number): number;
}

/** The sources of a cave, numbered as above. */
export function sourcesOf(spec: CaveSpec): Sources {
  const { secrets, stashes, walls } = spec;
  return {
    count: 1 + secrets.length + stashes.length + walls.length,
    chamber: (k) => 1 + k,
    stash: (k) => 1 + secrets.length + k,
    wall: (w) => 1 + secrets.length + stashes.length + w,
  };
}

export interface Save {
  bank: number;
  banked: number;
  engine: number;
  blade: number;
  drones: number;
  magnet: number;
  /** Which paint the dozer wears, and which it owns. */
  paint: string;
  paints: string[];
  /** Which body the machine stands on — tracks, or the Spiderdozer's legs — and which it owns. */
  body: Body;
  bodies: Body[];
  horn: boolean;
  flag: boolean;
  /** The last cave is cleared too. */
  done: boolean;
  // What follows is the cave the player is in, and is sized to it and emptied when it is left.
  /** The id of the cave being cleared. */
  cave: string;
  /** Its way out is open. */
  open: boolean;
  /** The ids of the belts bought for it. */
  belts: string[];
  /** How many of each kind from the cave, and each chamber, side room and wall, are still in it, so a reload puts back what is left and not the lot. Empty when unknown. */
  left: number[][];
  /** Which hidden chambers have been broken into. */
  secrets: boolean[];
  /** Which brick walls have been knocked down. */
  walls: boolean[];
  /** How much of a beating each brick wall standing has taken. */
  wallDamage: number[];
  /** Where the bricks off them lie, as x, y, z and the wall's grade, four numbers a brick. */
  rubble: number[];
  /** The lamps knocked over, by their place in the cave's list. */
  lampsBroken: number[];
  /**
   * The barrels still about, as x, y and z, three numbers a barrel; null for
   * a cave not yet begun, which puts its barrels where they start.
   */
  barrels: number[] | null;
}

/** The share of a cave's value that has to be banked before its way out opens: the last tenth is the player's to chase or leave. */
export const CLEAR_SHARE = 0.9;

/** What a cave's heaps are worth, and how many of each kind they hold. */
export function caveStock(spec: CaveSpec): { value: number; kinds: number[] } {
  const kinds = new Array<number>(KINDS).fill(0);
  for (const h of spec.heaps) {
    kinds[0] += h.coins;
    for (const [k, n] of h.gems) kinds[k] += n;
  }
  return { value: kinds.reduce((sum, n, k) => sum + n * KIND_VALUE[k], 0), kinds };
}

/** The bodies the machine can stand on: the bulldozer's tracks, or the Spiderdozer's eight legs. */
export type Body = 'dozer' | 'spider';
export const SPIDER_COST = 800;

export interface Paint {
  id: string;
  name: string;
  colour: [number, number, number];
  roughness: number;
  cost: number;
}
export const PAINTS: Paint[] = [
  { id: 'yellow', name: 'Works Yellow', colour: [0.96, 0.7, 0.12], roughness: 0.45, cost: 0 },
  { id: 'red', name: 'Fire Engine', colour: [0.85, 0.12, 0.1], roughness: 0.4, cost: 150 },
  { id: 'blue', name: 'Deep Sea', colour: [0.12, 0.35, 0.85], roughness: 0.4, cost: 150 },
  { id: 'mint', name: 'Mint Choc', colour: [0.45, 0.85, 0.65], roughness: 0.5, cost: 200 },
  { id: 'pink', name: 'Bubblegum', colour: [0.95, 0.45, 0.7], roughness: 0.5, cost: 200 },
  { id: 'black', name: 'Midnight', colour: [0.08, 0.08, 0.1], roughness: 0.25, cost: 300 },
  { id: 'chrome', name: 'Chrome', colour: [0.9, 0.9, 0.95], roughness: 0.05, cost: 800 },
];
export const HORN_COST = 80;
export const FLAG_COST = 120;

const KEY = 'pushminer-save-v1';

// The cave holds about 19,000 all told, and nothing refills it until the end, so
// the prices add up to a little less than that: the whole workshop and a coat
// of paint, for a player who gets nearly everything in.
// `ram` is how hard the engine hits a brick wall driven square into it at speed: a clay brick wall
// comes down to one such hit from the start, stone to one from a Mk 3, iron-bound to one from a Mk 5,
// and any of them to enough hits from a lesser engine
const ENGINE: { maxSpeed: number; accel: number; turnRate: number; ram: number; cost: number }[] = [
  { maxSpeed: 11, accel: 14, turnRate: 1.6, ram: 40, cost: 0 },
  { maxSpeed: 14, accel: 20, turnRate: 1.9, ram: 55, cost: 50 },
  { maxSpeed: 17, accel: 28, turnRate: 2.2, ram: 110, cost: 150 },
  { maxSpeed: 21, accel: 38, turnRate: 2.5, ram: 140, cost: 400 },
  { maxSpeed: 25, accel: 50, turnRate: 2.8, ram: 260, cost: 900 },
  { maxSpeed: 30, accel: 64, turnRate: 3.1, ram: 330, cost: 1800 },
];
/** What a grade of brick wall is called, and how much beating it stands. */
export const WALL_NAME = ['', 'clay brick', 'stone', 'iron-bound'];
export const WALL_STRENGTH = [0, 40, 110, 260];
/** A hit counts from this speed, and at this one and above is a full one. */
const RAM_FROM = 3,
  RAM_FULL = 11;
const BLADE: { width: number; cost: number }[] = [
  { width: 6.5, cost: 0 },
  { width: 8, cost: 80 },
  { width: 10, cost: 300 },
  { width: 12.5, cost: 800 },
];
const MAGNET: { radius: number; strength: number; cost: number }[] = [
  { radius: 4, strength: 5, cost: 0 },
  { radius: 6, strength: 9, cost: 100 },
  { radius: 8.5, strength: 14, cost: 300 },
  { radius: 11, strength: 20, cost: 700 },
  { radius: 14, strength: 28, cost: 1400 },
  { radius: 18, strength: 38, cost: 2600 },
];
export const MAX_DRONES = 3;
const DRONE_COST = [600, 1200, 2200];

export interface Offer {
  id: string;
  title: string;
  sub: string;
  cost: number;
  owned: boolean;
  /** Whether it can be bought at all yet, apart from the money. */
  available: boolean;
  /** For a thing that is worn: whether it is worn now. Owned and not active means clicking puts it on. */
  active?: boolean;
}

/** Where the save is kept: the browser's storage, or, for the game run without a page, anywhere. */
export interface SaveStore {
  load(): string | null;
  store(json: string): void;
  clear(): void;
}

/** The browser's storage, and nothing at all where there is none, or it will not be written. */
export const browserStore: SaveStore = {
  load() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  store(json) {
    try {
      localStorage.setItem(KEY, json);
    } catch {
      /* fine */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to remove */
    }
  },
};

/** A save kept in memory, starting from `json` if given: for the game run without a page. */
export function memoryStore(json: string | null = null): SaveStore & { json: string | null } {
  return {
    json,
    load() {
      return this.json;
    },
    store(next) {
      this.json = next;
    },
    clear() {
      this.json = null;
    },
  };
}

/** What the whole workshop costs: every engine, blade and magnet, every drone and every cave's belts; paint aside. */
export function workshopTotal(run: readonly CaveSpec[]): number {
  const sum = (xs: readonly { cost: number }[]) => xs.reduce((n, x) => n + x.cost, 0);
  const belts = run.reduce((n, c) => n + sum(c.belts), 0);
  return sum(ENGINE) + sum(BLADE) + sum(MAGNET) + DRONE_COST.reduce((n, c) => n + c, 0) + belts;
}

/** The caves the old rooms became, by the room's number in the old map: the hollow, south, north, east, west. */
const OLD_ROOMS = ['hollow', 'south-gallery', 'north-vault', 'east-gallery', 'west-gallery'];
/** The order the old rooms opened in, and the room each of the old chambers, side rooms and walls was off. */
const OLD_ORDER = [0, 1, 3, 2, 4];
const OLD_SECRET_ROOM = [1, 2, 3, 4],
  OLD_STASH_ROOM = [1, 3, 2, 4],
  OLD_WALL_ROOM = [1, 3, 2, 4];
/** Where the old save's `left` rows began for the chambers, side rooms and walls, after its five rooms. */
const OLD_LEFT_SECRETS = 5,
  OLD_LEFT_STASHES = 9,
  OLD_LEFT_WALLS = 13;

const finite = (n: unknown, fallback: number, most = Infinity) =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(n, most) : fallback;
const numbers = (xs: unknown): number[] =>
  Array.isArray(xs) ? xs.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [];

export class Economy {
  save: Save;
  private listeners = new Set<(id: string) => void>();
  /** Set by `reset`: nothing is saved again, so a coin banked while the page reloads cannot resurrect the old save. */
  private wiped = false;
  private current: { spec: CaveSpec; sources: Sources };

  /** `run` is the caves in order: the save has a place for what is in the one the player is in. */
  constructor(
    private readonly saves: SaveStore,
    readonly run: readonly CaveSpec[],
  ) {
    this.save = this.fresh(run[0]);
    this.current = { spec: run[0], sources: sourcesOf(run[0]) };
    try {
      const raw = saves.load();
      if (raw) this.load(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      /* a browser with no storage plays from the start */
    }
    this.current = { spec: this.savedCave(), sources: sourcesOf(this.savedCave()) };
  }

  /** What a cave starts with: nothing done in it, and no word on what is left. The run-wide things as a new game has them. */
  private fresh(cave: CaveSpec): Save {
    return {
      bank: 0,
      banked: 0,
      engine: 0,
      blade: 0,
      drones: 0,
      magnet: 0,
      paint: 'yellow',
      paints: ['yellow'],
      body: 'dozer',
      bodies: ['dozer'],
      horn: false,
      flag: false,
      done: false,
      ...this.perCave(cave),
    };
  }

  /** The fields that belong to the cave being played, as they begin. */
  private perCave(cave: CaveSpec) {
    return {
      cave: cave.id,
      open: false,
      belts: [] as string[],
      left: Array.from({ length: sourcesOf(cave).count }, () => [] as number[]),
      secrets: cave.secrets.map(() => false),
      walls: cave.walls.map(() => false),
      wallDamage: cave.walls.map(() => 0),
      rubble: [] as number[],
      lampsBroken: [] as number[],
      barrels: null as number[] | null,
    };
  }

  /** The spec of the cave the save is in. */
  private savedCave(): CaveSpec {
    return this.run.find((c) => c.id === this.save.cave) ?? this.run[0];
  }

  /**
   * Put a save read from outside over a new one. What is run-wide is checked, each value kept to what
   * it could be; a save of the old shape, from when the caves were rooms of one, is carried over; and
   * the lists of the cave are sized to the cave, whatever the save had.
   */
  private load(s: Record<string, unknown>) {
    const save = this.save;
    save.bank = finite(s.bank, 0);
    save.banked = finite(s.banked, 0);
    save.engine = Math.floor(finite(s.engine, 0, ENGINE.length - 1));
    save.blade = Math.floor(finite(s.blade, 0, BLADE.length - 1));
    save.magnet = Math.floor(finite(s.magnet, 0, MAGNET.length - 1));
    save.drones = Math.floor(finite(s.drones, 0, MAX_DRONES));
    const paints = Array.isArray(s.paints) ? s.paints.filter((p) => PAINTS.some((q) => q.id === p)) : [];
    save.paints = paints.length ? (paints as string[]) : ['yellow'];
    save.paint = PAINTS.some((p) => p.id === s.paint) ? (s.paint as string) : 'yellow';
    const bodies = Array.isArray(s.bodies) ? s.bodies.filter((b) => b === 'dozer' || b === 'spider') : [];
    save.bodies = bodies.length ? (bodies as Body[]) : ['dozer'];
    save.body = s.body === 'spider' ? 'spider' : 'dozer';
    save.horn = s.horn === true;
    save.flag = s.flag === true;
    save.done = s.done === true;
    if (s.cave === undefined) return this.carryOver(s);
    const cave = this.run.find((c) => c.id === s.cave);
    // a cave that is not in the run is refused by name, and the run begins again from its first
    if (!cave) return;
    const fresh = this.perCave(cave);
    const sources = fresh.left.length;
    Object.assign(save, fresh, {
      open: s.open === true && cave !== this.run[this.run.length - 1],
      belts: (Array.isArray(s.belts) ? s.belts : []).filter((id) => cave.belts.some((b) => b.id === id)),
      left: fresh.left.map((_, k) => numbers((Array.isArray(s.left) ? s.left : [])[k])),
      secrets: cave.secrets.map((_, k) => (s.secrets as unknown[] | undefined)?.[k] === true),
      walls: cave.walls.map((_, w) => (s.walls as unknown[] | undefined)?.[w] === true),
      wallDamage: cave.walls.map((_, w) => finite((s.wallDamage as unknown[] | undefined)?.[w], 0)),
      rubble: numbers(s.rubble).slice(0, numbers(s.rubble).length - (numbers(s.rubble).length % 4)),
      lampsBroken: numbers(s.lampsBroken),
      barrels: s.barrels === null || s.barrels === undefined ? null : numbers(s.barrels),
    });
    if (save.barrels) save.barrels = save.barrels.slice(0, save.barrels.length - (save.barrels.length % 3));
    if (save.left.length !== sources) save.left = fresh.left;
  }

  /**
   * A save from when the caves were five rooms of one: the room being cleared becomes the cave of the
   * same name, with what was left of it and of its chamber, side room and wall, and its belt. Where the
   * rubble and the barrels lay was in the old map's coordinates, and which lamps were broken was by the
   * old map's list, so those start afresh. The next room's gate being open is the way out being open.
   */
  private carryOver(s: Record<string, unknown>) {
    const save = this.save;
    const areas = Array.isArray(s.areas) ? (s.areas as unknown[]).map((a) => a === true) : [true];
    areas[0] = true;
    while (areas.length < OLD_ROOMS.length) areas.push(false);
    // a save from before rooms were sealed, or from when they were bought in any order: the furthest
    // room it had is the one being cleared
    const furthest = OLD_ORDER.reduce((f, a, n) => (areas[a] ? n : f), 0);
    const room = typeof s.room === 'number' && OLD_ORDER.includes(s.room) ? s.room : OLD_ORDER[furthest];
    const cave = this.run.find((c) => c.id === OLD_ROOMS[room]) ?? this.run[0];
    const fresh = this.perCave(cave);
    Object.assign(save, fresh);
    const last = cave === this.run[this.run.length - 1];
    const after = OLD_ORDER.indexOf(room) + 1;
    save.open = !last && after < OLD_ORDER.length && areas[OLD_ORDER[after]];
    const belts = Array.isArray(s.belts) ? (s.belts as unknown[]) : [];
    if (belts[room] === true && cave.belts.length) save.belts = [cave.belts[0].id];
    // what was left: a flat row of kinds, for the oldest, or a row a source
    const left = s.left;
    const sources = sourcesOf(cave);
    if (Array.isArray(left) && left.length === 5 && typeof left[0] === 'number') save.left[0] = numbers(left);
    else if (Array.isArray(left)) {
      save.left[0] = numbers(left[room]);
      cave.secrets.forEach((_, k) => {
        const old = OLD_SECRET_ROOM.indexOf(room);
        if (old >= 0) save.left[sources.chamber(k)] = numbers(left[OLD_LEFT_SECRETS + old]);
      });
      cave.stashes.forEach((_, k) => {
        const old = OLD_STASH_ROOM.indexOf(room);
        if (old >= 0) save.left[sources.stash(k)] = numbers(left[OLD_LEFT_STASHES + old]);
      });
      cave.walls.forEach((_, w) => {
        const old = OLD_WALL_ROOM.indexOf(room);
        if (old >= 0) save.left[sources.wall(w)] = numbers(left[OLD_LEFT_WALLS + old]);
      });
    }
    // the one chamber and the one wall off the room
    const secret = OLD_SECRET_ROOM.indexOf(room),
      wall = OLD_WALL_ROOM.indexOf(room);
    if (cave.secrets.length && secret >= 0) save.secrets[0] = (s.secrets as unknown[] | undefined)?.[secret] === true;
    if (cave.walls.length && wall >= 0) {
      save.walls[0] = (s.walls as unknown[] | undefined)?.[wall] === true;
      save.wallDamage[0] = finite((s.wallDamage as unknown[] | undefined)?.[wall], 0);
    }
  }

  get bank() {
    return this.save.bank;
  }

  /** The cave being cleared. */
  cave(): CaveSpec {
    return this.current.spec;
  }

  /** Where each body in it is from, in this cave's numbering. */
  get sources(): Sources {
    return this.current.sources;
  }

  /** The place of the cave being cleared in the run, from 0. */
  index(): number {
    return this.run.indexOf(this.current.spec);
  }

  /** Whether the cave being cleared is the last of the run. */
  isLast(): boolean {
    return this.index() === this.run.length - 1;
  }

  /** Enough of the cave is banked: its way out opens, or at the last the game is done. */
  open() {
    if (this.save.done || this.save.open) return;
    const last = this.isLast();
    if (last) this.save.done = true;
    else this.save.open = true;
    this.persist();
    for (const fn of [...this.listeners]) fn(last ? 'done' : 'exit');
  }

  /**
   * The player has driven out through the way out: the next cave, and everything of the one behind
   * that belongs to it left behind. What is run-wide goes on.
   */
  moveOn() {
    if (!this.save.open || this.isLast()) return;
    const old = this.current.spec;
    const next = this.run[this.index() + 1];
    Object.assign(this.save, this.perCave(next));
    this.current = { spec: next, sources: sourcesOf(next) };
    this.persist();
    for (const fn of [...this.listeners]) fn(`left:${old.id}`);
  }

  deposit(value: number) {
    this.save.bank += value;
    this.save.banked += value;
    this.persist();
  }

  spec(): DozerSpec {
    const e = ENGINE[this.save.engine];
    const m = MAGNET[this.save.magnet];
    return {
      maxSpeed: e.maxSpeed,
      accel: e.accel,
      turnRate: e.turnRate,
      bladeWidth: BLADE[this.save.blade].width,
      magnetRadius: m.radius,
      magnetStrength: m.strength,
    };
  }

  /** How much a hit at this speed does to a brick wall, with the engine fitted now; 0 for too slow to count. */
  ram(speed: number): number {
    if (speed < RAM_FROM + 1) return 0;
    return ENGINE[this.save.engine].ram * Math.min(1, (speed - RAM_FROM) / (RAM_FULL - RAM_FROM));
  }

  /**
   * A brick wall hit: the damage goes on it, and if it has taken what its
   * grade stands, down it comes. Returns how much of it is gone, 0 to 1.
   */
  hitWall(w: number, damage: number): number {
    if (this.save.walls[w]) return 1;
    const strength = WALL_STRENGTH[this.cave().walls[w].grade];
    this.save.wallDamage[w] = Math.min(strength, this.save.wallDamage[w] + damage);
    if (this.save.wallDamage[w] >= strength) {
      this.save.walls[w] = true;
      this.persist();
      for (const fn of [...this.listeners]) fn(`wall${w}`);
      return 1;
    }
    this.persist();
    return this.save.wallDamage[w] / strength;
  }

  /** A lamp knocked over. */
  breakLamp(k: number) {
    if (this.save.lampsBroken.includes(k)) return;
    this.save.lampsBroken.push(k);
    this.persist();
  }

  /** A hidden chamber broken into. */
  reveal(k: number) {
    if (this.save.secrets[k]) return;
    this.save.secrets[k] = true;
    this.persist();
    for (const fn of [...this.listeners]) fn(`secret${k}`);
  }

  /**
   * Something to do when a purchase lands or the way out opens: the game rebuilds what changed. Gives
   * back what stops it, for a game that is finished with.
   */
  onChange(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** How many are listening for changes, for what must not grow. */
  get listening(): number {
    return this.listeners.size;
  }

  offers(): Offer[] {
    const s = this.save;
    const out: Offer[] = [];
    const e = s.engine + 1 < ENGINE.length ? ENGINE[s.engine + 1] : null;
    out.push({
      id: 'engine',
      title: `Engine ${e ? `Mk ${s.engine + 2}` : 'maxed'}`,
      sub: e
        ? `top speed ${e.maxSpeed}, turns faster, hits walls ${e.ram >= 2 * ENGINE[s.engine].ram ? 'twice as hard' : 'harder'}`
        : `Mk ${s.engine + 1}: as fast as it goes`,
      cost: e?.cost ?? 0,
      owned: !e,
      available: !!e,
    });
    const b = s.blade + 1 < BLADE.length ? BLADE[s.blade + 1] : null;
    out.push({
      id: 'blade',
      title: `Wider blade${b ? '' : ' (maxed)'}`,
      sub: b ? `${b.width} across, up from ${BLADE[s.blade].width}` : `${BLADE[s.blade].width} across: the widest made`,
      cost: b?.cost ?? 0,
      owned: !b,
      available: !!b,
    });
    const m = s.magnet + 1 < MAGNET.length ? MAGNET[s.magnet + 1] : null;
    out.push({
      id: 'magnet',
      title: `Magnet ${m ? `Mk ${s.magnet + 2}` : 'maxed'}`,
      sub: m
        ? `pulls coins from ${m.radius} away, up from ${MAGNET[s.magnet].radius}`
        : `reaches ${MAGNET[s.magnet].radius}: nothing escapes it`,
      cost: m?.cost ?? 0,
      owned: !m,
      available: !!m,
    });
    // the belts that can be bought for the cave being cleared: one left in a cave behind runs into rock
    const cave = this.cave();
    for (const belt of cave.belts) {
      out.push({
        id: `belt:${belt.id}`,
        title: belt.label ?? `Conveyor to the ${cave.name.replace(/^The /, '')}`,
        sub: 'push coins onto it and it carries them to the hole',
        cost: belt.cost,
        owned: s.belts.includes(belt.id),
        available: true,
      });
    }
    const d = s.drones < MAX_DRONES ? DRONE_COST[s.drones] : null;
    out.push({
      id: 'drone',
      title: `Robo-dozer ${d ? s.drones + 1 : 'fleet complete'}`,
      sub: d
        ? 'a small bulldozer that drives itself: finds a heap, pushes it in, goes again'
        : `${MAX_DRONES} robo-dozers, working`,
      cost: d ?? 0,
      owned: !d,
      available: !!d,
    });
    return out;
  }

  paint(): Paint {
    return PAINTS.find((p) => p.id === this.save.paint) ?? PAINTS[0];
  }

  /** The things that change how the dozer looks and sounds, not what it does. */
  cosmetics(): Offer[] {
    const s = this.save;
    const out: Offer[] = PAINTS.map((p) => ({
      id: `paint:${p.id}`,
      title: p.name,
      sub:
        s.paint === p.id
          ? 'on the dozer now'
          : s.paints.includes(p.id)
            ? 'in the shed: click to wear it'
            : 'a coat of paint for the hull',
      cost: p.cost,
      owned: s.paints.includes(p.id),
      available: true,
      active: s.paint === p.id,
    }));
    // the bodies: the tracks it came with, and the Spiderdozer, bought once and swapped to and from like a paint
    out.push({
      id: 'body:dozer',
      title: 'Tracks',
      sub: s.body === 'dozer' ? 'standing on them now' : 'in the shed: click to stand on them',
      cost: 0,
      owned: true,
      available: true,
      active: s.body === 'dozer',
    });
    out.push({
      id: 'body:spider',
      title: 'Spiderdozer',
      sub:
        s.body === 'spider'
          ? 'walking on them now'
          : s.bodies.includes('spider')
            ? 'in the shed: click to walk'
            : 'the same machine on eight legs, walking like a spider',
      cost: SPIDER_COST,
      owned: s.bodies.includes('spider'),
      available: true,
      active: s.body === 'spider',
    });
    out.push({
      id: 'horn',
      title: 'Air horn',
      sub: s.horn ? 'press H. The coins jump.' : 'press H to honk. Startles the coins.',
      cost: HORN_COST,
      owned: s.horn,
      available: true,
    });
    out.push({
      id: 'flag',
      title: 'Pennant',
      sub: 'a little flag on a pole on the cab',
      cost: FLAG_COST,
      owned: s.flag,
      available: true,
    });
    return out;
  }

  buy(id: string): boolean {
    const offer = [...this.offers(), ...this.cosmetics()].find((o) => o.id === id);
    if (!offer || !offer.available) return false;
    if (offer.owned) {
      // a paint or a body already owned is put on, not bought again
      if (id.startsWith('paint:') && !offer.active) {
        this.save.paint = id.slice(6);
        this.persist();
        for (const fn of [...this.listeners]) fn(id);
        return true;
      }
      if (id.startsWith('body:') && !offer.active) {
        this.save.body = id.slice(5) as Body;
        this.persist();
        for (const fn of [...this.listeners]) fn(id);
        return true;
      }
      return false;
    }
    if (this.save.bank < offer.cost) return false;
    this.save.bank -= offer.cost;
    const s = this.save;
    if (id === 'engine') s.engine++;
    else if (id === 'blade') s.blade++;
    else if (id === 'drone') s.drones++;
    else if (id === 'magnet') s.magnet++;
    else if (id === 'horn') s.horn = true;
    else if (id === 'flag') s.flag = true;
    else if (id.startsWith('paint:')) {
      s.paints.push(id.slice(6));
      s.paint = id.slice(6);
    } else if (id === 'body:spider') {
      s.bodies.push('spider');
      s.body = 'spider';
    } else if (id.startsWith('belt:')) s.belts.push(id.slice(5));
    this.persist();
    for (const fn of [...this.listeners]) fn(id);
    return true;
  }

  reset() {
    this.wiped = true;
    this.saves.clear();
    location.reload();
  }

  persist() {
    if (this.wiped) return;
    this.saves.store(JSON.stringify(this.save));
  }
}

/** The shop's rows, rebuilt into `rows` whenever the bank or the stock changes. */
export function renderShop(rows: HTMLElement, economy: Economy, offers = economy.offers()) {
  const bank = economy.bank;
  const existing = Array.from(rows.children) as HTMLButtonElement[];
  offers.forEach((o, i) => {
    let btn = existing[i] as HTMLButtonElement | undefined;
    if (!btn) {
      const made = document.createElement('button');
      made.addEventListener('click', () => {
        if (economy.buy(made.dataset.id!))
          renderShop(rows, economy, rows.classList.contains('cosmetics') ? economy.cosmetics() : undefined);
      });
      rows.appendChild(made);
      btn = made;
    }
    btn.dataset.id = o.id;
    const wearable = o.owned && o.active === false;
    btn.disabled = !wearable && (o.owned || !o.available || bank < o.cost);
    btn.className = o.active ? 'owned active' : o.owned ? 'owned' : '';
    const cost = o.active ? 'worn' : o.owned ? (wearable ? 'wear' : '✓') : !o.available ? 'locked' : `${o.cost}`;
    btn.innerHTML = `<span>${o.title}<small>${o.sub}</small></span><span class="cost">${cost}</span>`;
  });
  while (rows.children.length > offers.length) rows.lastChild!.remove();
}
