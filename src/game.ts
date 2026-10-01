/**
 * The game itself, without the picture, the page or the sound: the cave it
 * is handed and what is in it, the dozer and the drones, the bank and the way
 * out, walls, chambers, lamps, barrels, the vein, and what each does to the
 * others, a step at a time. One `Game` is one cave: driving out through its
 * way out ends it, and whoever owns it builds the next.
 *
 * What happens is told to `events`, for whoever shows it: the browser turns
 * it into sparkle, dust, sound and words on the screen; the fuzzer and the
 * tests leave it out, or keep a note of it. Nothing here waits on anything
 * there, so the same game runs in the page and in Node, and what the tests
 * try is what is played.
 */
import {
  SECRET,
  arrival,
  darkness,
  downWayOut,
  exitFaces,
  nearestHole,
  pastLeavingLine,
  tileCentre,
  type Cave,
} from './cave';
import { Barrels, type Blast } from './barrels';
import { BLADE_AT, Dozer, separate } from './dozer';
import { CLEAR_SHARE, Economy, WALL_STRENGTH } from './economy';
import { Impacts } from './impacts';
import type { Drive } from './input';
import { lampOn, lampsHit } from './lamps';
import { Nav } from './nav';
import { BARREL_KIND, BRICK_KIND, KIND_RADIUS, makeWorld, type Pusher, type World } from './physics';
import { NO_SOURCE, Stock, capacityOf, lootHeap, type Capacity } from './stock';
import { Tally } from './tally';
import { BOT_SCALE, BOT_SPEC, Bot, Foreman, Fountain, beltOf } from './tools';
import { VeinTrickle } from './vein';
import { looseBricks } from './walls';

/** How many steps the heaps settle for before anyone sees a cave, unless the cave's own content says otherwise. */
export const SETTLE_STEPS = 90;
/** How often where the bricks and barrels lie is written into the save, in seconds. */
const RECORD_EVERY = 1;

/** A way the dozer faced and the direction it was going: what flies off a hit flies on that way. */
export type Heading = [number, number];

/** What happens, for whoever shows it. Every one may be left out. */
export interface GameEvents {
  /** Something banked, worth `value`, at (x, y), with the run this hot (0 to 1). */
  banked?(kind: number, value: number, x: number, y: number, heat: number): void;
  /** The cave cleared and its way out opened: the rock at its mouth, at `faces`, is down. */
  exitOpened?(faces: readonly [number, number][], heading: Heading): void;
  /** The player has driven out through the way out of the cave `from`, leaving `lost` in coins still in it. The game is finished with. */
  caveLeft?(from: string, lost: number): void;
  /** A hidden chamber smashed open, the rock in front of it at `faces`. */
  chamberOpened?(chamber: number, faces: readonly [number, number][], heading: Heading): void;
  /** A brick wall hit and still standing, at the tile (x, y): how much of it is gone, and how many hits like it are left in it. */
  wallHit?(wall: number, x: number, y: number, gone: number, hitsLeft: number, heading: Heading): void;
  /** A brick wall knocked down, its bricks loose. */
  wallDown?(wall: number, heading: Heading): void;
  /** The rock in front of a chamber knocked, not hard enough: it sounds hollow. */
  knock?(): void;
  /** A lamp knocked over, lit or not. */
  lampBroken?(lamp: number, lit: boolean, heading: Heading): void;
  /** A barrel's fuse lit by the player. */
  fuseLit?(barrel: number): void;
  /** A barrel gone off. */
  blast?(blast: Blast): void;
  /** A crack in the last cave's floor, before it sprays. */
  crack?(): void;
  /** The last cave cleared: the game is done. */
  done?(): void;
  /** Something bought, by its id in the workshop. */
  bought?(id: string): void;
  /** The rock, a wall, a lamp or the belts are not as they were: the static half of the scene wants building again. */
  staticChanged?(): void;
  /** The machines have moved this step, before the coins: for the marks their tracks leave. */
  machinesMoved?(): void;
}

/** The player's controls, beyond driving, for a step. */
export interface Controls {
  horn?: boolean;
}

/** How long, in game seconds, the screen takes to come up from black once the machine has come into a cave. */
export const RISE_SECONDS = 0.4;

export class Game {
  readonly cave: Cave;
  /** What the cave can hold at once, worked out from its content. */
  readonly capacity: Capacity;
  readonly world: World;
  readonly dozer: Dozer;
  readonly nav: Nav;
  readonly bots: Bot[] = [];
  readonly fountains: Fountain[] = [];
  readonly stock: Stock;
  readonly barrels: Barrels;
  readonly tally: Tally;
  /** Game time, in seconds. */
  t = 0;
  /** Driven out through the way out: this game is finished with, and stands still. */
  left = false;
  private readonly impacts: Impacts;
  private readonly vein: VeinTrickle;
  private readonly foreman: Foreman;
  private readonly pushers: Pusher[] = [];
  private readonly botPushers: Pusher[] = [];
  private lastBank = -1;
  private recordAt = 0;
  private readonly unlisten: () => void;
  /** Made by driving in from another cave, so the screen comes up from black at the start. */
  private readonly arrived: boolean;

  /**
   * `cave` is the one being played, and `economy` holds the save of it. `arrival` is how the machine comes
   * in: the speed it had in the cave it left.
   */
  constructor(
    readonly economy: Economy,
    cave: Cave,
    private readonly events: GameEvents = {},
    arrived?: { speed: number },
  ) {
    this.arrived = !!arrived;
    const save = economy.save;
    this.cave = cave;
    this.capacity = capacityOf(cave.spec);
    this.tally = new Tally(cave.holes.length);
    this.world = makeWorld(
      this.capacity.bodies,
      cave.solid(save.open, save.secrets, save.walls),
      cave.grid,
      cave.holes,
    );
    this.dozer = new Dozer(this.world.solid, cave.grid);
    const at = arrival(cave);
    Object.assign(this.dozer, { x: at.x, y: at.y, yaw: at.yaw, speed: arrived?.speed ?? 0 });
    this.nav = new Nav(this.world.solid, cave.grid, cave.holes);
    if (save.done) this.fountains.push(new Fountain(cave.spec));
    this.vein = new VeinTrickle(cave.spec.vein);
    for (let i = 0; i < save.drones; i++)
      this.bots.push(new Bot(this.world.solid, cave.grid, i + 1, ...botHome(cave, i)));
    this.runBelts();

    this.stock = new Stock(cave, this.world, this.capacity.kinds, cave.barrels);
    this.barrels = new Barrels(this.world);
    const saved = { ...save, left: save.left };
    // the save keeps the live counts from here on, so it is never behind
    save.left = this.stock.left;
    this.stock.restore(saved);
    // a moment of settling before anyone sees it, so the heaps are heaps
    for (let i = 0; i < (cave.spec.settle ?? SETTLE_STEPS); i++) this.world.step(1 / 60, () => {});
    economy.persist();

    this.impacts = new Impacts(cave.cells, cave.grid, cave.spec);
    this.dozer.onRock = (tx, ty, square) => this.onRock(tx, ty, square);
    // what the drones go for: the cave being cleared, and any chamber broken into off it
    this.foreman = new Foreman(this.world, this.nav, this.bots, this.stock.origin, (from) => from !== NO_SOURCE);
    this.unlisten = economy.onChange((id) => this.changed(id));
  }

  /** Let go of the economy: a game that is finished with no longer hears of what is bought. */
  dispose() {
    this.unlisten();
  }

  /** The belts of this cave that run: bought, by their place in its list. */
  running(): number[] {
    const { belts } = this.cave.spec;
    return belts.map((_, b) => b).filter((b) => this.economy.save.belts.includes(belts[b].id));
  }

  /**
   * How dark it is where the dozer is, 0 to 1. Down the way out it is black only for the last of the cutting,
   * and black while this game waits to be swapped for the next, which is built behind the black. In a game
   * made by arriving it comes up from black over RISE_SECONDS, to what the place on the way in says.
   */
  darkness(): number {
    if (this.left) return 1;
    const here = darkness(this.cave, this.economy.save.open, this.dozer.x, this.dozer.y);
    return Math.max(here, this.rise());
  }

  /**
   * How strongly "Keep going" shows, 0 to 1: it comes up with the darkness down the way out, so the player
   * drives on into the dark and not to a stop in it; it is full while the next cave is built; and on
   * arriving it fades with the rise. It shows nowhere else, the arrival in the way in included.
   */
  keepGoing(): number {
    if (this.left) return 1;
    const { open } = this.economy.save;
    const down = open && downWayOut(this.cave, this.dozer.x, this.dozer.y);
    const ahead = down ? Math.min(1, 2 * darkness(this.cave, open, this.dozer.x, this.dozer.y)) : 0;
    return Math.max(ahead, this.rise());
  }

  /** How far the screen is still down from the black the machine arrived in: 1 at the start, 0 after RISE_SECONDS. */
  private rise(): number {
    return this.arrived ? Math.max(0, 1 - this.t / RISE_SECONDS) : 0;
  }

  /**
   * A step of `dt` seconds with the player driving as `drive` says: the
   * machines, the drones, the barrels' fuses, the vein and the cracking
   * floors, the coins, the bank, and driving out through the way out. A game
   * that has been left stands still.
   */
  step(dt: number, drive: Drive, controls: Controls = {}) {
    if (this.left) return;
    const { world, dozer, economy } = this;
    const save = economy.save;
    this.t += dt;
    if (controls.horn && save.horn) this.honk();

    const spec = economy.spec();
    dozer.update(dt, drive, spec, world.load);
    this.knockLamps();
    const choose = (bot: Bot) => this.foreman.choose(bot, this.t);
    const traffic = { bots: this.bots, player: dozer };
    for (const b of this.bots) b.update(dt, world, world.loads[b.dozer.owner] ?? 0, this.nav, choose, traffic);
    // no machine drives through another: every pair, twice, so a push out of one
    // that shoves into a third is settled in the same step
    const machines = [dozer, ...this.bots.map((b) => b.dozer)];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < machines.length; i++)
        for (let j = i + 1; j < machines.length; j++) separate(machines[i], machines[j]);
    }
    this.events.machinesMoved?.();
    const pushers = dozer.pushers(spec, this.pushers);
    for (const b of this.bots) {
      b.dozer.pushers(BOT_SPEC, this.botPushers);
      pushers.push(...this.botPushers);
      if (Math.abs(b.dozer.speed) > 0.5)
        world.wakeNear(
          b.x + Math.cos(b.yaw) * BLADE_AT * BOT_SCALE,
          b.y + Math.sin(b.yaw) * BLADE_AT * BOT_SCALE,
          BOT_SPEC.bladeWidth * BOT_SCALE * 0.75 + 1.5,
        );
    }
    world.pushers = pushers;
    // the player's machine on the move into a barrel lights its fuse; a drone's does not
    if (Math.abs(dozer.speed) > 0.3 || Math.abs(dozer.yawRate) > 0.3) {
      for (const i of this.barrels.hitBy(pushers, dozer.owner)) this.events.fuseLit?.(i);
    }
    // the heap ahead of the blade wakes before the blade arrives
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    if (Math.abs(dozer.speed) > 0.5 || Math.abs(dozer.yawRate) > 0.2)
      world.wakeNear(dozer.x + c * BLADE_AT, dozer.y + s * BLADE_AT, spec.bladeWidth * 0.75 + 1.5);
    // the magnet sits a little ahead of the blade's face, and reaches out from there
    const mx = dozer.x + c * (BLADE_AT + 1.2),
      my = dozer.y + s * (BLADE_AT + 1.2);
    world.magnet = { x: mx, y: my, radius: spec.magnetRadius, strength: spec.magnetStrength };
    world.wakeNear(mx, my, spec.magnetRadius);

    // the vein and the cracking floors, once the game is done
    if (save.done && world.live <= this.capacity.bodies - 60)
      this.vein.update(dt, (kind, x, y, z, vx, vy, vz) => this.stock.spawn(kind, x, y, z, vx, vy, vz));
    for (const f of this.fountains) {
      f.update(
        dt,
        (kind, x, y, z, vx, vy, vz) => this.stock.spawn(kind, x, y, z, vx, vy, vz),
        () => this.events.crack?.(),
      );
    }

    // the coins, and the barrels going off among them
    world.step(dt, (kind, x, y, i) => this.collect(kind, x, y, i));
    this.tally.fade(dt);
    for (const blast of this.barrels.update(dt, (i) => this.stock.removeBarrel(i))) this.events.blast?.(blast);

    // enough of the cave banked, its way out opens; through the way out, the cave is left behind
    if (economy.bank !== this.lastBank) {
      this.lastBank = economy.bank;
      if (!save.done && !save.open && this.stock.banked() >= CLEAR_SHARE) economy.open();
    }
    if (save.open && pastLeavingLine(this.cave, dozer.x, dozer.y)) {
      this.leave();
      return;
    }

    if (this.t >= this.recordAt) {
      this.recordAt = this.t + RECORD_EVERY;
      this.record();
    }
  }

  /**
   * Driven out through the way out: the economy moves on to the next cave, and whatever is left in this
   * one is lost with it. The owner is told, and builds the next game; this one stands still from now.
   */
  private leave() {
    const from = this.economy.save.cave;
    const lost = this.stock.lyingAll();
    this.left = true;
    this.economy.moveOn();
    this.events.caveLeft?.(from, lost);
  }

  /** The horn: everything near enough the dozer hops, which is what a horn is for. */
  honk() {
    const { world, dozer } = this;
    const { x, y, z, vz, alive, asleep } = world;
    for (let i = 0; i < world.count; i++) {
      if (!alive[i]) continue;
      const d = Math.hypot(x[i] - dozer.x, y[i] - dozer.y);
      if (d > 14 || z[i] > 3) continue;
      if (asleep[i]) world.wake(i);
      vz[i] += 5 * (1 - d / 14) + Math.random() * 2;
      world.wx[i] += (Math.random() - 0.5) * 6;
      world.wy[i] += (Math.random() - 0.5) * 6;
    }
  }

  /** Where every brick and barrel lies, into the save; it goes out with the next thing banked, or `persist`. */
  record() {
    if (this.left) return;
    const save = this.economy.save;
    save.rubble = this.stock.rubble();
    save.barrels = this.stock.barrelRecord();
  }

  /** The save written now, with everything where it is: not from a game that has been left, whose bodies are of a cave the save is no longer in. */
  persist() {
    if (!this.left) this.record();
    this.economy.persist();
  }

  // ---- what happens ----

  private collect(kind: number, x: number, y: number, i: number) {
    if (kind === BARREL_KIND) this.barrels.forget(i);
    const value = this.stock.collect(kind, i);
    // a brick or a barrel down the hole is only gone: nothing banked, and nothing to show for it
    if (kind === BRICK_KIND || kind === BARREL_KIND) return;
    this.economy.deposit(value);
    const hole = this.cave.holes.indexOf(nearestHole(this.cave.holes, x, y));
    const heat = this.tally.add(kind, hole);
    this.events.banked?.(kind, value, x, y, heat);
  }

  private heading(): Heading {
    return [Math.cos(this.dozer.yaw), Math.sin(this.dozer.yaw)];
  }

  /** The rock where it stands now: the way out, chambers and walls as they are. Everything that goes by the rock is told. */
  private reshape() {
    const { world, economy } = this;
    const save = economy.save;
    world.solid = this.cave.solid(save.open, save.secrets, save.walls);
    this.dozer.solid = world.solid;
    for (const b of this.bots) {
      b.dozer.solid = world.solid;
      b.reset();
    }
    this.nav.rebuild(world.solid);
    this.runBelts();
    this.events.staticChanged?.();
  }

  private runBelts() {
    this.world.belts = this.running().map((b) => beltOf(this.cave.spec.belts[b].spec));
    this.nav.setBelts(this.world.belts);
  }

  /** Knock over any lamp the player's machine is into: its hull, or its blade. */
  private knockLamps() {
    const { cave, dozer, economy } = this;
    const hits = lampsHit(cave.lamps, economy.save.lampsBroken, dozer.x, dozer.y, dozer.yaw, BLADE_AT);
    for (const k of hits) {
      const lit = lampOn(cave.lamps, k, economy.save);
      economy.breakLamp(k);
      this.events.lampBroken?.(k, lit, this.heading());
    }
    if (hits.length) this.events.staticChanged?.();
  }

  /** The dozer up against rock that may not be only rock: a brick wall, or the rock in front of a chamber. */
  private onRock(tx: number, ty: number, square: number) {
    const { economy } = this;
    const save = economy.save;
    const hit = this.impacts.hit(tx, ty, square, this.dozer.speed, this.t, {
      wallsDown: save.walls,
      secretsOpen: save.secrets,
      ram: (speed) => economy.ram(speed),
    });
    if (!hit) return;
    if (hit.type === 'reveal') economy.reveal(hit.chamber);
    else if (hit.type === 'knock') this.events.knock?.();
    else {
      const wall = this.cave.spec.walls[hit.wall];
      const gone = economy.hitWall(hit.wall, hit.damage);
      // one that comes down says so itself, through the economy's change
      if (gone >= 1) return;
      const left = Math.ceil((WALL_STRENGTH[wall.grade] - save.wallDamage[hit.wall]) / hit.damage);
      this.events.wallHit?.(hit.wall, hit.x, hit.y, gone, left, this.heading());
      this.events.staticChanged?.();
    }
  }

  /** Something in the economy changed: the way out, a chamber, a wall, the end, or something bought. A game that has been left hears nothing. */
  private changed(id: string) {
    if (this.left) return;
    const { stock, world } = this;
    if (id === 'exit') {
      // nothing lies in the rock, so nothing is in the way of its coming down
      this.persist();
      this.reshape();
      this.events.exitOpened?.(exitFaces(this.cave), this.heading());
    } else if (id.startsWith('secret')) {
      const k = +id.slice(6);
      stock.spawnHeap(this.economy.sources.chamber(k), lootHeap(this.cave, k));
      this.persist();
      this.reshape();
      this.events.chamberOpened?.(k, this.chamberFaces(k), this.heading());
    } else if (id.startsWith('wall')) {
      const w = +id.slice(4);
      this.knockOver(w);
      this.persist();
      this.reshape();
      this.events.wallDown?.(w, this.heading());
    } else if (id === 'done') {
      this.fountains.push(new Fountain(this.cave.spec));
      this.events.done?.();
    } else {
      if (id.startsWith('belt:')) {
        this.runBelts();
        this.events.staticChanged?.();
      } else if (id === 'drone') {
        this.bots.push(new Bot(world.solid, this.cave.grid, this.bots.length + 1, ...botHome(this.cave, 0)));
      }
      this.events.bought?.(id);
    }
    world.wakeAll();
  }

  /** The rock in front of a hidden chamber, as the world centres of its tiles. */
  private chamberFaces(k: number): [number, number][] {
    const { cells, grid } = this.cave;
    const [w0x, w0y, w1x, w1y] = this.cave.spec.secrets[k].wall;
    const out: [number, number][] = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== SECRET + k) continue;
      const tx = i % grid.cols,
        ty = (i / grid.cols) | 0;
      if (tx >= w0x && tx <= w1x && ty >= w0y && ty <= w1y) out.push(tileCentre(grid, tx, ty));
    }
    return out;
  }

  /** A brick wall knocked down: every brick in it loose and tumbling, and what was set in it with them. */
  private knockOver(w: number) {
    const { grade } = this.cave.spec.walls[w];
    for (const piece of looseBricks(this.cave, w, this.dozer, KIND_RADIUS[BRICK_KIND])) {
      const { x, y, z, vx, vy, vz } = piece;
      if (piece.treasure !== undefined) {
        this.stock.spawn(piece.treasure, x, y, z, vx, vy, vz, this.economy.sources.wall(w));
        continue;
      }
      const i = this.stock.spawnBrick(grade, x, y, z, vx, vy, vz);
      if (i >= 0) [this.world.wx[i], this.world.wy[i], this.world.wz[i]] = piece.spin;
    }
  }
}

/** Where a drone is put back to, out of the way by the first hole. */
export function botHome(cave: Cave, j: number): [number, number] {
  const hole = cave.holes[0];
  return [hole.x + 14 + j * 6, hole.y + 10];
}
