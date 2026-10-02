/**
 * `window.pushminer`: the game, for tests and for poking at from the
 * console. Everything a test needs to set a scene, play it exactly and read
 * back what happened, so no test waits on a clock or reaches into the
 * game's insides.
 *
 * Time is the test's to keep: `pause` stops the game where it is, and
 * `step` plays it on a frame at a time, exactly, drawing the last. `seed`
 * makes chance repeat. Anything that changes the game — driving, putting the
 * dozer or a body somewhere, opening the way out, lighting a barrel — goes through
 * here, and `state`, `bodies`, `events` and `invariants` read it back.
 *
 * The types are shared with the smoke tests, so a test that calls something
 * that is not here does not compile.
 */
import { arrival, chamberCentre, exitPoints, type Cave } from './cave';
import type { Game } from './game';
import type { MinimapView } from './minimap';
import { checkInvariants } from './invariants';
import { BARREL_KIND, GEODE_KIND, KIND_NAME } from './physics';
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
  /** The id of the cave the game is in, and whether its way out is open. */
  cave: string;
  open: boolean;
  /** How many runway lights are lit, down the way in and down the way out. */
  runway: { in: number; out: number };
  /** How dark it is where the dozer is, 0 to 1: the page fades to black by it down the way out. */
  darkness: number;
  /** How strongly "Keep going" shows, 0 to 1. */
  keepGoing: number;
  /** Driven out of the cave and black, waiting for the page to build the next. */
  leaving: boolean;
  /** Where the camera stands about what it looks at: round and down from straight up, in radians, and how far. */
  camera: { azimuth: number; polar: number; distance: number };
  done: boolean;
  secrets: boolean[];
  walls: boolean[];
  wallDamage: number[];
  lampsBroken: number[];
  /** The ids of the belts bought for this cave, which are the ones running. */
  belts: string[];
  /** What has gone down the cave's drains, in coins: lost, and counted against what is left behind. */
  drained: number;
  drones: number;
  horn: boolean;
  /** The size of scoop fitted, 0 for none, how many bodies it takes and how many it holds now, and how far up the bucket is, 0 to 1. */
  scoop: { size: number; load: number; held: number; lift: number };
  /** The body the machine stands on: 'dozer' on its tracks, or 'spider'. */
  body: string;
  /** How many bodies are in the cave, and how many of each kind, by name. */
  live: number;
  kinds: Record<string, number>;
  dozer: { x: number; y: number; yaw: number; speed: number };
  bots: { x: number; y: number; yaw: number; state: string }[];
  barrels: { count: number; lit: number[] };
  /** How many geodes still stand whole, and how many gems from cracked ones still lie in the cave. */
  geodes: { count: number; gems: number };
  fountains: number;
  trackMarks: number;
  /** Whether the sound is muted. */
  muted: boolean;
  /** The marks of the map as last drawn: where each lies on it, turned with the camera; null before the first. */
  minimap: MinimapView | null;
}

/** A body in the cave. */
export interface Body {
  slot: number;
  kind: string;
  x: number;
  y: number;
  z: number;
  asleep: boolean;
  /** Held in the scoop: with the machine, and not lying in the cave. */
  carried: boolean;
  /** Which source of the cave it came from: 0 the cave itself, then its chambers, side rooms and walls; null for none. */
  source: number | null;
}

/** A cutting at the cave's edge, for driving down. */
export interface CuttingAt {
  /** Where it meets the cave's floor, and a point down it past where the machine leaves the cave, which is the far end of a way out. */
  mouth: Point;
  beyond: Point;
  /** Which way is out of the cave along it, as a unit step. */
  out: [number, number];
}

/** Where things are in the cave, for setting a scene without importing the game's source. */
export interface Content {
  /** The cave's id and name. */
  id: string;
  name: string;
  /** The currents, and the drains they end in, which are not holes: nothing banks there. */
  currents: { id: string; flow: string; from: Point; to: Point; width: number; speed: number; drain: boolean }[];
  drains: (Point & { radius: number })[];
  /** The first hole, which is the only one in a cave with one; and all of them. */
  hole: Point & { radius: number };
  holes: (Point & { radius: number })[];
  heaps: (Point & { coins: number })[];
  /** Where the vein runs from once the last cave is cleared. */
  vein: Point;
  barrels: Point[];
  /** Where the geodes stand when the cave begins. */
  geodes: Point[];
  /** The belts that can be bought, by their ids. */
  belts: { id: string; from: Point; to: Point }[];
  /** Where the machine arrives, and which way it faces; and the way out, null in the last cave. */
  entry: Point & { yaw: number };
  exit: CuttingAt | null;
  lamps: Point[];
  chambers: Point[];
  walls: { tiles: Point[] }[];
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
  /** What has happened since this was last asked, a line each: "blast 12.0,4.0", "exitOpened". */
  events(): string[];
  /** The rules that must always hold, broken; empty when all is well. */
  invariants(): string[];

  /** Drive as if the controls were held so, until `release`. */
  drive(throttle: number, steer: number): void;
  release(): void;
  honk(): void;
  /** The scoop's button pressed, as Space or the pad's does it: through the input, so it takes effect on the next step. */
  scoop(): void;
  /** The dozer put at a point facing `yaw`, stopped. */
  teleport(x: number, y: number, yaw?: number): void;
  /** A body moved to a point, still, and woken. */
  place(slot: number, x: number, y: number, z?: number): void;
  deposit(value: number): void;
  buy(id: string): boolean;
  /** The way out opened, as banking enough of the cave would. */
  openExit(): void;
  /** The page's swap done again for the cave the save is in, as a change of cave does it: for seeing what a run of changes leaves behind. */
  rebuild(): void;
  /** Into any cave of the run, begun afresh, by the page's swap: for measuring every cave one after another in one page. */
  goto(id: string): void;
  reveal(chamber: number): void;
  hitWall(wall: number, damage: number): number;
  lightBarrel(slot: number, seconds?: number): boolean;
  /** The save written now, and what it is. */
  save(): string;

  /** The camera looking at a point, from `azimuth` round and `polar` down, `radius` away, at once. */
  look(x: number, y: number, view?: { azimuth?: number; polar?: number; radius?: number }): void;
  /** A point of the world, as pixels of the canvas where it is drawn, for measuring which way things face on the screen. */
  project(x: number, y: number, z?: number): Point;
  /** What drawing a frame of the scene as it stands costs, in milliseconds. */
  measureFrame(): Promise<number>;
  /** What one update of the map costs, view and draw, in milliseconds, averaged over `runs`. */
  measureMap(runs?: number): number;
  /** What each rung of coin detail cost when the game measured the machine at boot. */
  readonly calibration: number[];
  setCoinDetail(level: number): void;
  lampsLit(): number[];
}

/** What the page gives the API that is not the game's: time, the controls, the camera and the renderer. */
export interface DebugHost {
  /** The game and cave being played: they change when the player drives out through the way out, so they are asked for each time. */
  game(): Game;
  cave(): Cave;
  /** Swap to the game and scene of the cave the save is in, as a change of cave does. */
  rebuild(): void;
  /** Where the camera is, as it was last drawn. */
  camera(): { azimuth: number; polar: number; distance: number };
  /** A point of the world, as pixels of the canvas where it is drawn: the camera's own view and projection. */
  project(x: number, y: number, z: number): Point;
  ready(): boolean;
  paused(): boolean;
  setPaused(paused: boolean): void;
  /** Play one frame of `dt`, without drawing. */
  simulate(dt: number): void;
  draw(dt: number): void;
  frame(): number;
  setDrive(drive: { throttle: number; steer: number } | null): void;
  /** The scoop's button, pressed as the keyboard's and the pad's are. */
  pressScoop(): void;
  look(x: number, y: number, view: { azimuth?: number; polar?: number; radius?: number }): void;
  measureFrame(): Promise<number>;
  measureMap(runs: number): number;
  calibration(): number[];
  setCoinDetail(level: number): void;
  lampsLit(): number[];
  /** How many runway lights the scene stands, by the cutting each is in. */
  runway(): { in: number; out: number };
  trackMarks(): number;
  muted(): boolean;
  minimap(): MinimapView | null;
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
  const game = () => host.game();
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
      const g = game();
      const save = g.economy.save;
      const kinds: Record<string, number> = {};
      KIND_NAME.forEach((name, k) => (kinds[name] = g.stock.kinds[k]));
      return {
        t: g.t,
        frame: host.frame(),
        paused: host.paused(),
        bank: save.bank,
        banked: save.banked,
        cave: save.cave,
        open: save.open,
        runway: host.runway(),
        darkness: g.darkness(),
        keepGoing: g.keepGoing(),
        leaving: g.left,
        camera: host.camera(),
        done: save.done,
        secrets: [...save.secrets],
        walls: [...save.walls],
        wallDamage: [...save.wallDamage],
        lampsBroken: [...save.lampsBroken],
        belts: [...save.belts],
        drained: save.drained,
        drones: save.drones,
        horn: save.horn,
        scoop: { size: save.scoop, load: g.economy.scoopLoad(), held: g.scoop.held.length, lift: g.scoop.lift },
        body: save.body,
        live: g.world.live,
        kinds,
        dozer: { x: g.dozer.x, y: g.dozer.y, yaw: g.dozer.yaw, speed: g.dozer.speed },
        bots: g.bots.map((b) => ({ x: b.x, y: b.y, yaw: b.yaw, state: b.state })),
        barrels: { count: g.stock.kinds[BARREL_KIND], lit: g.barrels.lit },
        geodes: {
          count: g.stock.kinds[GEODE_KIND],
          gems: g.stock.left[g.economy.sources.geodes()]?.reduce((n, m) => n + m, 0) ?? 0,
        },
        fountains: g.fountains.length,
        trackMarks: host.trackMarks(),
        muted: host.muted(),
        minimap: host.minimap(),
      };
    },
    bodies(kind) {
      const { world, stock } = game();
      const out: Body[] = [];
      for (let i = 0; i < world.count; i++) {
        if (!world.alive[i]) continue;
        const name = KIND_NAME[world.kind[i]];
        if (kind !== undefined && name !== kind) continue;
        const from = stock.origin[i];
        out.push({
          slot: i,
          kind: name,
          x: world.x[i],
          y: world.y[i],
          z: world.z[i],
          asleep: !!world.asleep[i],
          carried: !!world.carried[i],
          source: from === NO_SOURCE ? null : from,
        });
      }
      return out;
    },
    content() {
      const cave = host.cave();
      const { spec } = cave;
      const holes = cave.holes.map((h) => ({ x: h.x, y: h.y, radius: h.radius }));
      const at = arrival(cave);
      const points = exitPoints(cave);
      const exit: CuttingAt | null =
        points && spec.exit ? { mouth: points.mouth, beyond: points.beyond, out: spec.exit.out } : null;
      return {
        id: spec.id,
        name: spec.name,
        hole: holes[0],
        holes,
        currents: cave.currents.map((c) => ({
          id: c.id,
          flow: c.flow,
          from: { x: c.x0, y: c.y0 },
          to: { x: c.x1, y: c.y1 },
          width: c.width,
          speed: c.speed,
          drain: !!c.drain,
        })),
        drains: cave.drains.map((d) => ({ x: d.x, y: d.y, radius: d.radius })),
        heaps: spec.heaps.map((h) => ({ x: h.x, y: h.y, coins: h.coins })),
        vein: { x: spec.vein.x, y: spec.vein.y },
        barrels: cave.barrels.map((b) => ({ x: b.x, y: b.y })),
        geodes: cave.geodes.map((g) => ({ x: g.x, y: g.y })),
        belts: spec.belts.map((b) => ({
          id: b.id,
          from: { x: b.spec.x0, y: b.spec.y0 },
          to: { x: b.spec.x1, y: b.spec.y1 },
        })),
        entry: { x: at.x, y: at.y, yaw: at.yaw },
        exit,
        lamps: cave.lamps.map((l) => ({ x: l.x, y: l.y })),
        chambers: spec.secrets.map((_, k) => {
          const [x, y] = chamberCentre(cave, k);
          return { x, y };
        }),
        walls: spec.walls.map((_, k) => ({ tiles: wallTiles(cave, k).map(([x, y]) => ({ x, y })) })),
      };
    },
    events() {
      return host.events.splice(0);
    },
    invariants: () => checkInvariants(game()),

    drive: (throttle, steer) => host.setDrive({ throttle, steer }),
    release: () => host.setDrive(null),
    honk: () => game().honk(),
    scoop: () => host.pressScoop(),
    teleport(x, y, yaw) {
      const { dozer } = game();
      Object.assign(dozer, { x, y, speed: 0, yawRate: 0 });
      if (yaw !== undefined) dozer.yaw = yaw;
    },
    place(slot, x, y, z) {
      const { world } = game();
      if (!world.alive[slot]) return;
      world.x[slot] = x;
      world.y[slot] = y;
      if (z !== undefined) world.z[slot] = z;
      world.vx[slot] = world.vy[slot] = world.vz[slot] = 0;
      world.wake(slot);
    },
    deposit: (value) => game().economy.deposit(value),
    buy: (id) => game().economy.buy(id),
    openExit: () => game().economy.open(),
    rebuild: () => host.rebuild(),
    goto(id) {
      game().economy.travel(id);
      host.rebuild();
    },
    reveal: (k) => game().economy.reveal(k),
    hitWall: (w, damage) => game().economy.hitWall(w, damage),
    lightBarrel: (slot, seconds) => game().barrels.light(slot, seconds),
    save() {
      game().persist();
      return JSON.stringify(game().economy.save);
    },

    look: (x, y, view = {}) => host.look(x, y, view),
    project: (x, y, z = 0) => host.project(x, y, z),
    measureFrame: () => host.measureFrame(),
    measureMap: (runs = 200) => host.measureMap(runs),
    get calibration() {
      return host.calibration();
    },
    setCoinDetail: (level) => host.setCoinDetail(level),
    lampsLit: () => host.lampsLit(),
  };
}
