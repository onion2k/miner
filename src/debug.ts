/**
 * `window.pushminer`: the game, for tests and for poking at from the
 * console. Everything a test needs to set a scene, play it exactly and read
 * back what happened, so no test waits on a clock or reaches into the
 * game's insides.
 *
 * Time is the test's to keep: `pause` stops the game where it is, and
 * `step` plays it on a frame at a time, exactly, drawing the last. `seed`
 * makes chance repeat. Anything that changes the game — driving, putting the
 * dozer or a body somewhere, opening a room, lighting a barrel — goes through
 * here, and `state`, `bodies`, `events` and `invariants` read it back.
 *
 * The types are shared with the smoke tests, so a test that calls something
 * that is not here does not compile.
 */
import { AREAS, HOLE, SECRETS, WALLS, WINGS, gateCentre, sealPoint, type Cave } from './cave';
import type { Game } from './game';
import { checkInvariants } from './invariants';
import { BARREL_KIND, KIND_NAME } from './physics';
import { areaOfSource } from './economy';
import { NO_SOURCE } from './stock';
import { wallTiles } from './walls';

export interface Point {
  x: number;
  y: number;
}

export interface GameState {
  /** Game time, in seconds. */
  t: number;
  frame: number;
  paused: boolean;
  bank: number;
  banked: number;
  room: number;
  next: number | null;
  nextOpen: boolean;
  /** At the next room's gate, where going on seals the room behind. */
  warning: boolean;
  done: boolean;
  areas: boolean[];
  secrets: boolean[];
  walls: boolean[];
  wallDamage: number[];
  lampsBroken: number[];
  drones: number;
  horn: boolean;
  /** The body the machine stands on: 'dozer' on its tracks, or 'spider'. */
  body: string;
  /** How many bodies are in the cave, and how many of each kind, by name. */
  live: number;
  kinds: Record<string, number>;
  dozer: { x: number; y: number; yaw: number; speed: number };
  bots: { x: number; y: number; yaw: number; state: string }[];
  barrels: { count: number; lit: number[] };
  fountains: number;
  trackMarks: number;
  /** Whether the sound is muted. */
  muted: boolean;
}

/** A body in the cave. */
export interface Body {
  slot: number;
  kind: string;
  x: number;
  y: number;
  z: number;
  asleep: boolean;
  /** The room it came from and is sealed with, or null for none. */
  room: number | null;
}

/** Where things are in the cave, for setting a scene without importing the game's source. */
export interface Content {
  hole: Point & { radius: number };
  rooms: {
    area: number;
    name: string;
    heaps: (Point & { coins: number })[];
    barrels: Point[];
    /** Where its gate stands, and a point just past where going on into it seals the room behind; null for the hollow. */
    gate: Point | null;
    pastSeal: Point | null;
  }[];
  lamps: (Point & { area: number })[];
  chambers: { area: number }[];
  walls: { area: number; tiles: Point[] }[];
}

export interface PushminerApi {
  readonly version: 1;
  /** Booted, and the frame loop running. */
  readonly ready: boolean;

  pause(): void;
  resume(): void;
  /** Play `frames` frames of 1/60 s exactly, and draw the last. */
  step(frames?: number): void;
  /** Chance from a seed from now on: Math.random, everywhere. */
  seed(n: number): void;

  state(): GameState;
  bodies(kind?: string): Body[];
  content(): Content;
  /** What has happened since this was last asked, a line each: "blast 12.0,4.0", "roomOpened 1". */
  events(): string[];
  /** The rules that must always hold, broken; empty when all is well. */
  invariants(): string[];

  /** Drive as if the controls were held so, until `release`. */
  drive(throttle: number, steer: number): void;
  release(): void;
  honk(): void;
  /** The dozer put at a point facing `yaw`, stopped. */
  teleport(x: number, y: number, yaw?: number): void;
  /** A body moved to a point, still, and woken. */
  place(slot: number, x: number, y: number, z?: number): void;
  deposit(value: number): void;
  buy(id: string): boolean;
  /** The next room opened, as banking enough of this one would. */
  openNext(): void;
  reveal(chamber: number): void;
  hitWall(wall: number, damage: number): number;
  lightBarrel(slot: number, seconds?: number): boolean;
  /** The save written now, and what it is. */
  save(): string;

  /** The camera looking at a point, from `azimuth` round and `polar` down, `radius` away, at once. */
  look(x: number, y: number, view?: { azimuth?: number; polar?: number; radius?: number }): void;
  /** What drawing a frame of the scene as it stands costs, in milliseconds. */
  measureFrame(): Promise<number>;
  /** What each rung of coin detail cost when the game measured the machine at boot. */
  readonly calibration: number[];
  setCoinDetail(level: number): void;
  lampsLit(): number[];
}

/** What the page gives the API that is not the game's: time, the controls, the camera and the renderer. */
export interface DebugHost {
  game: Game;
  cave: Cave;
  ready(): boolean;
  paused(): boolean;
  setPaused(paused: boolean): void;
  /** Play one frame of `dt`, without drawing. */
  simulate(dt: number): void;
  draw(dt: number): void;
  frame(): number;
  setDrive(drive: { throttle: number; steer: number } | null): void;
  look(x: number, y: number, view: { azimuth?: number; polar?: number; radius?: number }): void;
  measureFrame(): Promise<number>;
  calibration(): number[];
  setCoinDetail(level: number): void;
  lampsLit(): number[];
  trackMarks(): number;
  muted(): boolean;
  events: string[];
}

function seeded(n: number): () => number {
  let s = (n * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createApi(host: DebugHost): PushminerApi {
  const { game, cave } = host;
  const { world, economy } = game;
  return {
    version: 1,
    get ready() {
      return host.ready();
    },
    pause: () => host.setPaused(true),
    resume: () => host.setPaused(false),
    step(frames = 1) {
      for (let f = 0; f < frames; f++) host.simulate(1 / 60);
      host.draw(1 / 60);
    },
    seed(n) {
      Math.random = seeded(n);
    },

    state() {
      const save = economy.save;
      const kinds: Record<string, number> = {};
      KIND_NAME.forEach((name, k) => (kinds[name] = game.stock.kinds[k]));
      return {
        t: game.t,
        frame: host.frame(),
        paused: host.paused(),
        bank: save.bank,
        banked: save.banked,
        room: save.room,
        next: economy.next(),
        nextOpen: economy.nextOpen(),
        warning: game.warning,
        done: save.done,
        areas: [...save.areas],
        secrets: [...save.secrets],
        walls: [...save.walls],
        wallDamage: [...save.wallDamage],
        lampsBroken: [...save.lampsBroken],
        drones: save.drones,
        horn: save.horn,
        body: save.body,
        live: world.live,
        kinds,
        dozer: { x: game.dozer.x, y: game.dozer.y, yaw: game.dozer.yaw, speed: game.dozer.speed },
        bots: game.bots.map((b) => ({ x: b.x, y: b.y, yaw: b.yaw, state: b.state })),
        barrels: { count: game.stock.kinds[BARREL_KIND], lit: game.barrels.lit },
        fountains: game.fountains.length,
        trackMarks: host.trackMarks(),
        muted: host.muted(),
      };
    },
    bodies(kind) {
      const out: Body[] = [];
      for (let i = 0; i < world.count; i++) {
        if (!world.alive[i]) continue;
        const name = KIND_NAME[world.kind[i]];
        if (kind !== undefined && name !== kind) continue;
        const from = game.stock.origin[i];
        out.push({
          slot: i,
          kind: name,
          x: world.x[i],
          y: world.y[i],
          z: world.z[i],
          asleep: !!world.asleep[i],
          room: world.kind[i] === BARREL_KIND ? game.stock.home[i] : from === NO_SOURCE ? null : areaOfSource(from),
        });
      }
      return out;
    },
    content() {
      return {
        hole: { x: HOLE.x, y: HOLE.y, radius: HOLE.radius },
        rooms: AREAS.map((area, a) => {
          let pastSeal: Point | null = null;
          if (a > 0) {
            const [sx, sy] = sealPoint(cave, a);
            const [dx, dy] = WINGS[a].dir;
            pastSeal = { x: sx + dx * 4, y: sy + dy * 4 };
          }
          const gate = a > 0 ? gateCentre(cave, a) : null;
          return {
            area: a,
            name: area.name,
            heaps: area.heaps.map((h) => ({ x: h.x, y: h.y, coins: h.coins })),
            barrels: cave.barrels.filter((b) => b.area === a).map((b) => ({ x: b.x, y: b.y })),
            gate: gate && { x: gate[0], y: gate[1] },
            pastSeal,
          };
        }),
        lamps: cave.lamps.map((l) => ({ x: l.x, y: l.y, area: l.area })),
        chambers: SECRETS.map((s) => ({ area: s.area })),
        walls: WALLS.map((w, k) => ({ area: w.area, tiles: wallTiles(k).map(([x, y]) => ({ x, y })) })),
      };
    },
    events() {
      return host.events.splice(0);
    },
    invariants: () => checkInvariants(game),

    drive: (throttle, steer) => host.setDrive({ throttle, steer }),
    release: () => host.setDrive(null),
    honk: () => game.honk(),
    teleport(x, y, yaw) {
      Object.assign(game.dozer, { x, y, speed: 0, yawRate: 0 });
      if (yaw !== undefined) game.dozer.yaw = yaw;
    },
    place(slot, x, y, z) {
      if (!world.alive[slot]) return;
      world.x[slot] = x;
      world.y[slot] = y;
      if (z !== undefined) world.z[slot] = z;
      world.vx[slot] = world.vy[slot] = world.vz[slot] = 0;
      world.wake(slot);
    },
    deposit: (value) => economy.deposit(value),
    buy: (id) => economy.buy(id),
    openNext: () => economy.open(),
    reveal: (k) => economy.reveal(k),
    hitWall: (w, damage) => economy.hitWall(w, damage),
    lightBarrel: (slot, seconds) => game.barrels.light(slot, seconds),
    save() {
      game.persist();
      return JSON.stringify(economy.save);
    },

    look: (x, y, view = {}) => host.look(x, y, view),
    measureFrame: () => host.measureFrame(),
    get calibration() {
      return host.calibration();
    },
    setCoinDetail: (level) => host.setCoinDetail(level),
    lampsLit: () => host.lampsLit(),
  };
}
