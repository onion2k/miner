/**
 * The bank and what it buys: engine, blade, magnet, a belt for each room,
 * and drones. The rooms are not bought: the next opens when most of the one
 * being cleared is banked, and going on into it seals the one behind, with
 * whatever is still in it. Saved in the browser, so the cave is where you
 * left it.
 */
import { AREAS, ORDER, SECRETS, STASHES, WALLS } from './cave';
import type { DozerSpec } from './dozer';
import { KINDS, KIND_VALUE } from './physics';

/**
 * Where a body came from, for what is left of it: a room, by its index; then
 * the hidden chambers; then the stashes behind brick walls, side rooms and
 * pens; then the walls, for the treasure set in them. Everything after the
 * rooms is kept apart from its room's so it never counts toward clearing it.
 */
export const SOURCES = AREAS.length + SECRETS.length + STASHES.length + WALLS.length;
export const chamberSource = (k: number) => AREAS.length + k;
export const stashSource = (k: number) => AREAS.length + SECRETS.length + k;
export const wallSource = (w: number) => AREAS.length + SECRETS.length + STASHES.length + w;
/** The room a source belongs to, and is sealed with. */
export function areaOfSource(from: number): number {
  if (from < AREAS.length) return from;
  from -= AREAS.length;
  if (from < SECRETS.length) return SECRETS[from].area;
  from -= SECRETS.length;
  if (from < STASHES.length) return STASHES[from].area;
  return WALLS[from - STASHES.length].area;
}

export interface Save {
  bank: number;
  banked: number;
  engine: number;
  blade: number;
  areas: boolean[];
  belts: boolean[];
  drones: number;
  magnet: number;
  /** Which paint the dozer wears, and which it owns. */
  paint: string;
  paints: string[];
  horn: boolean;
  flag: boolean;
  /** The room being cleared. */
  room: number;
  /** How many of each kind from each room, and each chamber, are still in the cave, so a reload puts back what is left and not the lot. Empty when unknown. */
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
   * The barrels still about, as x, y, z and the room each belongs to, four
   * numbers a barrel; null in a save from before there were barrels, which
   * puts each room's back where it started.
   */
  barrels: number[] | null;
  /** The last room is cleared too. */
  done: boolean;
}

/** The share of a room's value that has to be banked before the next one opens: the last tenth is the player's to chase or leave. */
export const CLEAR_SHARE = 0.9;

/** What a room's heaps are worth, and how many of each kind they hold. */
export function roomStock(area: number): { value: number; kinds: number[] } {
  const kinds = new Array<number>(KINDS).fill(0);
  for (const h of AREAS[area].heaps) {
    kinds[0] += h.coins;
    for (const [k, n] of h.gems) kinds[k] += n;
  }
  return { value: kinds.reduce((sum, n, k) => sum + n * KIND_VALUE[k], 0), kinds };
}

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

export class Economy {
  save: Save;
  private listeners: ((id: string) => void)[] = [];
  /** Set by `reset`: nothing is saved again, so a coin banked while the page reloads cannot resurrect the old save. */
  private wiped = false;

  constructor() {
    this.save = {
      bank: 0,
      banked: 0,
      engine: 0,
      blade: 0,
      areas: AREAS.map((_, a) => a === 0),
      belts: AREAS.map(() => false),
      drones: 0,
      magnet: 0,
      paint: 'yellow',
      paints: ['yellow'],
      horn: false,
      flag: false,
      room: ORDER[0],
      left: Array.from({ length: SOURCES }, () => []),
      secrets: SECRETS.map(() => false),
      walls: WALLS.map(() => false),
      wallDamage: WALLS.map(() => 0),
      rubble: [],
      barrels: null,
      lampsBroken: [],
      done: false,
    };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as Omit<Partial<Save>, 'left'> & { left?: number[] | number[][] };
        this.save = {
          ...this.save,
          ...s,
          areas: [true, ...(s.areas ?? []).slice(1)],
          belts: s.belts ?? this.save.belts,
          left: this.save.left,
          secrets: SECRETS.map((_, k) => s.secrets?.[k] ?? false),
          walls: WALLS.map((_, w) => s.walls?.[w] ?? false),
          wallDamage: WALLS.map((_, w) => s.wallDamage?.[w] ?? 0),
        };
        // a save from before an area existed has it shut
        while (this.save.areas.length < AREAS.length) this.save.areas.push(false);
        while (this.save.belts.length < AREAS.length) this.save.belts.push(false);
        if (s.room === undefined) {
          // A save from before rooms were sealed, or from when they were bought in any
          // order: the furthest room it had is the one being cleared, the ones before
          // it are sealed, and what it had left of the room is that room's.
          const furthest = ORDER.reduce((f, a, n) => (this.save.areas[a] ? n : f), 0);
          this.save.room = ORDER[furthest];
          ORDER.forEach((a, n) => {
            this.save.areas[a] = n === 0 || n === furthest;
          });
          if (s.left?.length === 5 && typeof s.left[0] === 'number')
            this.save.left[this.save.room] = s.left as number[];
        } else if (Array.isArray(s.left)) {
          this.save.left = Array.from({ length: SOURCES }, (_, a) => (s.left as number[][])[a] ?? []);
        }
      }
    } catch {
      /* a browser with no storage plays from the start */
    }
  }

  get bank() {
    return this.save.bank;
  }

  /** The room being cleared. */
  current(): number {
    return this.save.room;
  }

  /** The room after the current one, or null at the last. */
  next(): number | null {
    const n = ORDER.indexOf(this.save.room) + 1;
    return n < ORDER.length ? ORDER[n] : null;
  }

  /** Whether the next room's gate is open, and it is waiting to be gone on into. */
  nextOpen(): boolean {
    const next = this.next();
    return next !== null && this.save.areas[next];
  }

  /** A room the player has gone on from: its gate is shut, and what was in it is gone. */
  sealed(area: number): boolean {
    return ORDER.indexOf(area) < ORDER.indexOf(this.save.room);
  }

  /** Enough of the current room is banked: the next one opens, or at the last the cave is done. */
  open() {
    if (this.save.done || this.nextOpen()) return;
    const next = this.next();
    if (next === null) this.save.done = true;
    else this.save.areas[next] = true;
    this.persist();
    for (const fn of this.listeners) fn(next === null ? 'done' : `area${next}`);
  }

  /** The player has gone on into the next room: the one behind is sealed. The hollow has no gate to shut. */
  moveOn() {
    const old = this.save.room,
      next = this.next();
    if (next === null || !this.nextOpen()) return;
    if (old !== ORDER[0]) this.save.areas[old] = false;
    this.save.room = next;
    this.persist();
    for (const fn of this.listeners) fn(`sealed${old}`);
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
    const strength = WALL_STRENGTH[WALLS[w].grade];
    this.save.wallDamage[w] = Math.min(strength, this.save.wallDamage[w] + damage);
    if (this.save.wallDamage[w] >= strength) {
      this.save.walls[w] = true;
      this.persist();
      for (const fn of this.listeners) fn(`wall${w}`);
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
    for (const fn of this.listeners) fn(`secret${k}`);
  }

  /** Something to do when a purchase lands or a room opens: the game rebuilds what changed. */
  onChange(fn: (id: string) => void) {
    this.listeners.push(fn);
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
    // a belt for each room still to be cleared; a sealed room's belt runs into rock
    for (const a of ORDER) {
      const belt = AREAS[a].belt;
      if (!belt || this.sealed(a)) continue;
      out.push({
        id: `belt${a}`,
        title: `Conveyor to the ${AREAS[a].name}`,
        sub: s.areas[a] ? 'push coins onto it and it carries them to the hole' : 'once the room is open',
        cost: belt.cost,
        owned: s.belts[a],
        available: s.areas[a],
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
      // a paint already owned is put on, not bought again
      if (id.startsWith('paint:') && !offer.active) {
        this.save.paint = id.slice(6);
        this.persist();
        for (const fn of this.listeners) fn(id);
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
    } else if (id.startsWith('belt')) s.belts[+id.slice(4)] = true;
    this.persist();
    for (const fn of this.listeners) fn(id);
    return true;
  }

  reset() {
    this.wiped = true;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to remove */
    }
    location.reload();
  }

  persist() {
    if (this.wiped) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.save));
    } catch {
      /* fine */
    }
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
