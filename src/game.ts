/**
 * The game itself, without the picture, the page or the sound: the cave and
 * what is in it, the dozer and the drones, the bank and the rooms, walls,
 * chambers, lamps, barrels, the vein, and what each does to the others, a
 * step at a time.
 *
 * What happens is told to `events`, for whoever shows it: the browser turns
 * it into sparkle, dust, sound and words on the screen; the fuzzer and the
 * tests leave it out, or keep a note of it. Nothing here waits on anything
 * there, so the same game runs in the page and in Node, and what the tests
 * try is what is played.
 */
import {
  AREAS,
  BODY_CAPACITY,
  COLS,
  HOLE,
  ORDER,
  SECRET,
  SECRETS,
  WALLS,
  behindGate,
  buildCave,
  tileCentre,
  type Cave,
} from './cave';
import { Barrels, type Blast } from './barrels';
import { BLADE_AT, Dozer, separate } from './dozer';
import { Economy, WALL_STRENGTH, areaOfSource, chamberSource, wallSource } from './economy';
import { Impacts } from './impacts';
import type { Drive } from './input';
import { lampOn, lampsHit } from './lamps';
import { Nav } from './nav';
import { BARREL_KIND, BRICK_KIND, KIND_RADIUS, World, type Pusher } from './physics';
import { atNextGate, readyToOpen } from './progress';
import { NO_SOURCE, Stock, lootHeap } from './stock';
import { Tally } from './tally';
import { BOT_SCALE, BOT_SPEC, Bot, Foreman, Fountain, beltOf } from './tools';
import { VeinTrickle } from './vein';
import { looseBricks } from './walls';

/** How many of each kind the cave can hold at once, past the coins; the last three are gold bars, bricks and barrels. */
export const KIND_CAPACITY = [0, 320, 240, 260, 160, 60, 900, 40];
/** How often where the bricks and barrels lie is written into the save, in seconds. */
const RECORD_EVERY = 1;

/** A way the dozer faced and the direction it was going: what flies off a hit flies on that way. */
export type Heading = [number, number];

/** What happens, for whoever shows it. Every one may be left out. */
export interface GameEvents {
  /** Something banked, worth `value`, at (x, y), with the run this hot (0 to 1). */
  banked?(kind: number, value: number, x: number, y: number, heat: number): void;
  /** A room opened: its heaps are in the cave, and the rock at its gate is down. */
  roomOpened?(area: number): void;
  /** A room sealed behind the player, with `lost` in coins still in it, and where each thing in it was. */
  roomSealed?(area: number, lost: number, where: readonly [number, number, number][]): void;
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
  /** A crack in the last room's floor, before it sprays. */
  crack?(): void;
  /** The last room cleared: the cave is done. */
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

export class Game {
  readonly cave: Cave;
  readonly world: World;
  readonly dozer: Dozer;
  readonly nav: Nav;
  readonly bots: Bot[] = [];
  readonly fountains: Fountain[] = [];
  readonly stock: Stock;
  readonly barrels: Barrels;
  readonly tally = new Tally();
  /** The last room: once the cave is cleared its vein runs and its floor cracks, so there is still something to push. */
  readonly last = ORDER[ORDER.length - 1];
  /** Game time, in seconds. */
  t = 0;
  /** The player is at the next room's gate, and going further seals the one being cleared. */
  warning = false;
  private readonly impacts: Impacts;
  private readonly vein: VeinTrickle;
  private readonly foreman: Foreman;
  private readonly pushers: Pusher[] = [];
  private readonly botPushers: Pusher[] = [];
  private lastBank = -1;
  private recordAt = 0;

  constructor(
    readonly economy: Economy,
    private readonly events: GameEvents = {},
    cave: Cave = buildCave(),
  ) {
    const save = economy.save;
    this.cave = cave;
    this.world = new World(BODY_CAPACITY, cave.solid(save.areas, save.secrets, save.walls));
    this.dozer = new Dozer(this.world.solid);
    this.nav = new Nav(this.world.solid);
    if (save.done) this.fountains.push(new Fountain(AREAS[this.last]));
    this.vein = new VeinTrickle(AREAS[this.last].vein);
    for (let i = 0; i < save.drones; i++) this.bots.push(new Bot(this.world.solid, i + 1, ...botHome(i)));
    this.runBelts();

    this.stock = new Stock(this.world, KIND_CAPACITY, () => economy.current(), cave.barrels);
    this.barrels = new Barrels(this.world);
    const saved = { ...save, left: save.left };
    // the save keeps the live counts from here on, so it is never behind
    save.left = this.stock.left;
    this.stock.restore(saved, economy);
    // a moment of settling before anyone sees it, so the heaps are heaps
    for (let i = 0; i < 90; i++) this.world.step(1 / 60, () => {});
    economy.persist();

    this.impacts = new Impacts(cave.cells);
    this.dozer.onRock = (tx, ty, square) => this.onRock(tx, ty, square);
    // what the drones go for: the room being cleared, and any chamber broken into off it
    this.foreman = new Foreman(
      this.world,
      this.nav,
      this.bots,
      this.stock.origin,
      (from) => from !== NO_SOURCE && areaOfSource(from) === economy.current(),
    );
    economy.onChange((id) => this.changed(id));
  }

  /** The rooms whose belts run: bought, for rooms not sealed. */
  running(): number[] {
    const save = this.economy.save;
    return AREAS.map((_, a) => a).filter((a) => AREAS[a].belt && save.belts[a] && !this.economy.sealed(a));
  }

  /**
   * A step of `dt` seconds with the player driving as `drive` says: the
   * machines, the drones, the barrels' fuses, the vein and the cracking
   * floors, the coins, the bank, and getting on through the cave.
   */
  step(dt: number, drive: Drive, controls: Controls = {}) {
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

    // the vein and the cracking floors, once the cave is done
    if (save.done && world.live <= BODY_CAPACITY - 60)
      this.vein.update(dt, (kind, x, y, z, vx, vy, vz) => this.stock.spawn(kind, x, y, z, vx, vy, vz, this.last));
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

    // enough of the room banked, the next opens; through the next room's gate, the room behind is sealed
    if (economy.bank !== this.lastBank) {
      this.lastBank = economy.bank;
      if (readyToOpen(economy, this.stock.banked(economy.current()))) economy.open();
    }
    this.warning = false;
    const where = atNextGate(economy, dozer.x, dozer.y);
    if (where === 'through') economy.moveOn();
    else if (where === 'at') this.warning = true;

    if (this.t >= this.recordAt) {
      this.recordAt = this.t + RECORD_EVERY;
      this.record();
    }
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
    const save = this.economy.save;
    save.rubble = this.stock.rubble();
    save.barrels = this.stock.barrelRecord();
  }

  /** The save written now, with everything where it is. */
  persist() {
    this.record();
    this.economy.persist();
  }

  // ---- what happens ----

  private collect(kind: number, x: number, y: number, i: number) {
    if (kind === BARREL_KIND) this.barrels.forget(i);
    const value = this.stock.collect(kind, i);
    // a brick or a barrel down the hole is only gone: nothing banked, and nothing to show for it
    if (kind === BRICK_KIND || kind === BARREL_KIND) return;
    this.economy.deposit(value);
    const heat = this.tally.add(kind);
    this.events.banked?.(kind, value, x, y, heat);
  }

  private heading(): Heading {
    return [Math.cos(this.dozer.yaw), Math.sin(this.dozer.yaw)];
  }

  /** The rock where it stands now: gates, chambers and walls as they are. Everything that goes by the rock is told. */
  private reshape() {
    const { world, economy } = this;
    const save = economy.save;
    world.solid = this.cave.solid(save.areas, save.secrets, save.walls);
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
    this.world.belts = this.running().map((a) => beltOf(AREAS[a].belt!.spec));
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
      const wall = WALLS[hit.wall];
      const gone = economy.hitWall(hit.wall, hit.damage);
      // one that comes down says so itself, through the economy's change
      if (gone >= 1) return;
      const left = Math.ceil((WALL_STRENGTH[wall.grade] - save.wallDamage[hit.wall]) / hit.damage);
      this.events.wallHit?.(hit.wall, hit.x, hit.y, gone, left, this.heading());
      this.events.staticChanged?.();
    }
  }

  /** Something in the economy changed: a room, a chamber, a wall, the end, or something bought. */
  private changed(id: string) {
    const { stock, world } = this;
    if (id.startsWith('area')) {
      const a = +id.slice(4);
      stock.openRoom(a);
      // the heaps are in the save now, or a reload before the next coin would find the room empty
      this.persist();
      this.reshape();
      this.events.roomOpened?.(a);
    } else if (id.startsWith('sealed')) {
      const old = +id.slice(6);
      // what is left of the room behind goes, and what is left in any chamber, side room or wall off
      // it: bars not got out before going on are lost with the room
      const lost = stock.lying(old);
      const where: [number, number, number][] = [];
      stock.seal(old, (x, y, z, i) => {
        where.push([x, y, z]);
        this.barrels.forget(i);
      });
      // no machine is shut in with the rock, or in it
      this.bots.forEach((b, j) => {
        if (!behindGate(old, b.x, b.y)) return;
        [b.dozer.x, b.dozer.y] = botHome(j);
        b.dozer.speed = 0;
      });
      this.persist();
      this.reshape();
      this.events.roomSealed?.(old, lost, where);
    } else if (id.startsWith('secret')) {
      const k = +id.slice(6);
      stock.spawnHeap(chamberSource(k), lootHeap(k));
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
      this.fountains.push(new Fountain(AREAS[this.last]));
      this.events.done?.();
    } else {
      if (id.startsWith('belt')) {
        this.runBelts();
        this.events.staticChanged?.();
      } else if (id === 'drone') {
        this.bots.push(new Bot(world.solid, this.bots.length + 1, ...botHome(0)));
      }
      this.events.bought?.(id);
    }
    world.wakeAll();
  }

  /** The rock in front of a hidden chamber, as the world centres of its tiles. */
  private chamberFaces(k: number): [number, number][] {
    const { cells } = this.cave;
    const [w0x, w0y, w1x, w1y] = SECRETS[k].wall;
    const out: [number, number][] = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== SECRET + k) continue;
      const tx = i % COLS,
        ty = (i / COLS) | 0;
      if (tx >= w0x && tx <= w1x && ty >= w0y && ty <= w1y) out.push(tileCentre(tx, ty));
    }
    return out;
  }

  /** A brick wall knocked down: every brick in it loose and tumbling, and what was set in it with them. */
  private knockOver(w: number) {
    const { grade } = WALLS[w];
    for (const piece of looseBricks(w, this.dozer, KIND_RADIUS[BRICK_KIND])) {
      const { x, y, z, vx, vy, vz } = piece;
      if (piece.treasure !== undefined) {
        this.stock.spawn(piece.treasure, x, y, z, vx, vy, vz, wallSource(w));
        continue;
      }
      const i = this.stock.spawnBrick(grade, x, y, z, vx, vy, vz);
      if (i >= 0) [this.world.wx[i], this.world.wy[i], this.world.wz[i]] = piece.spin;
    }
  }
}

/** Where a drone is put back to, out of the way by the hole. */
export function botHome(j: number): [number, number] {
  return [HOLE.x + 14 + j * 6, HOLE.y + 10];
}
