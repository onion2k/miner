/**
 * The help you can buy: conveyor belts that carry what lands on them to the
 * hole, and drones that go and fetch things.
 */
import type { BeltSpec, Area } from './cave';
import { HOLE, TILE } from './cave';
import { KIND_VALUE, type Belt, type World } from './physics';

/** A belt's physics strip, from its spec. */
export function beltOf(spec: BeltSpec): Belt {
  const dx = spec.x1 - spec.x0, dy = spec.y1 - spec.y0;
  const len = Math.hypot(dx, dy) || 1;
  return {
    cx: (spec.x0 + spec.x1) / 2, cy: (spec.y0 + spec.y1) / 2,
    half: len / 2, width: spec.width,
    dx: dx / len, dy: dy / len, speed: spec.speed,
  };
}

import { BLADE_AT, Dozer, type DozerSpec } from './dozer';
import type { Drive } from './input';
import type { Nav } from './nav';

/** What a robo-dozer is: smaller and slower than the player's, and tireless. */
export const BOT_SCALE = 0.68;
export const BOT_SPEC: DozerSpec = { maxSpeed: 7.5, accel: 12, turnRate: 1.9, bladeWidth: 7, magnetRadius: 0, magnetStrength: 0 };
/** How far from the hole's centre a bot stops pushing and backs away. */
export const STOP_AT = HOLE.radius + 5;
/** Half the machine's width and a little, for whether it fits down a line; and with a load on the blade, wider. */
const CLEARANCE = 2.2, LOADED_CLEARANCE = 3.2;
/** Getting no nearer, down the way it is going, by half a tile in this long: it is stuck, however much it wriggles. */
const NO_HEADWAY = 3;
/** How far behind a coin, against the way it is to go, a machine sets up to push it. */
const SET_BACK = 5.5;
/** More coins than this on the tile where it would set up, and the coin is buried in a heap. */
const BURIED = 8;
/** Worth this much or more, and a thing is worth setting up in the middle of a heap to push: a diamond, a gold bar. */
const DEAR = 100;

type BotState = 'seek' | 'approach' | 'push' | 'backUp' | 'retreat';

/** Another machine, as traffic: where it is and going, who goes first among the robo-dozers, and how wide it is. */
interface Mover { x: number; y: number; yaw: number; speed: number; priority: number; rank: number; width: number; player: boolean }
/** The machines a robo-dozer has to mind: the others, and the player's. */
export interface Traffic { bots: Bot[]; player: Dozer }
/** How far ahead a machine looks for traffic, and how wide each kind is, blade and all. */
const LOOK = 14, BOT_WIDTH = 5, PLAYER_WIDTH = 7.5;
/** How far ahead in time two machines' ways are compared, for whether they will meet. */
const FORESEE = 2.5;
/** How many times a push that has stuck backs up and tries again before it is given up. */
const RETRIES = 2;

/**
 * A robo-dozer: it picks a coin, finds its way round to the side of it away
 * from the hole — away along the way to the hole, round corners and down
 * corridors, not as the crow flies — pushes the load down that way, backs
 * off, and goes again. It steers like the player's machine, the same tank
 * model and the same boxes, so what it does to the coins is what the player
 * could have done.
 */
export class Bot {
  readonly dozer: Dozer;
  state: BotState = 'seek';
  /** The coin it is after, and where it sets up to push it. */
  coin = -1;
  private setUp: [number, number] = [0, 0];
  private way: Float32Array | null = null;
  private timer = 0;
  private empty = 0;
  private tries = 0;
  /** The nearest it has got, down the way, and how long since it got nearer. */
  private best = Infinity;
  private since = 0;
  /** Coins it got stuck going for, and until when it leaves them be. */
  private readonly shunned = new Map<number, number>();
  private clock = 0;

  constructor(solid: Uint8Array, owner: number, x: number, y: number) {
    this.dozer = new Dozer(solid, BOT_SCALE, owner);
    this.dozer.x = x; this.dozer.y = y; this.dozer.yaw = Math.random() * Math.PI * 2;
  }

  get x() { return this.dozer.x; }
  get y() { return this.dozer.y; }
  get yaw() { return this.dozer.yaw; }

  /** Whether it has given up on a coin for now. */
  shuns(i: number): boolean { return (this.shunned.get(i) ?? 0) > this.clock; }

  /** Start again from nothing: after being moved, say. */
  reset() { this.state = 'seek'; this.coin = -1; this.way = null; this.timer = 0; this.headway(); }

  /**
   * `choose` names the coin to go for, or -1 with nothing worth it; the game
   * knows which room is being worked and what the other machines are after.
   */
  update(dt: number, world: World, load: number, nav: Nav, choose: (bot: Bot) => number, traffic: Traffic) {
    const d = this.dozer;
    let drive: Drive = { throttle: 0, steer: 0 };
    this.timer -= dt;
    this.clock += dt;
    switch (this.state) {
      case 'seek': {
        if (this.timer > 0) break;
        const i = choose(this);
        if (i < 0) { this.timer = 1; break; }
        const setUp = this.setUpFor(world, nav, i);
        if (!setUp) { this.shun(i, 8); this.timer = 0.1; break; }
        this.coin = i;
        this.setUp = setUp;
        this.way = nav.toward(setUp[0], setUp[1]);
        this.state = 'approach'; this.timer = 30; this.headway();
        break;
      }
      case 'approach': {
        if (!world.alive[this.coin]) { this.reset(); break; }
        const [tx, ty] = this.setUp;
        const dist = Math.hypot(tx - d.x, ty - d.y);
        const aim = dist < 10 && nav.clear(d.x, d.y, tx, ty, CLEARANCE) ? this.setUp : nav.ahead(this.way!, d.x, d.y, CLEARANCE, 6);
        if (!aim) { this.shun(this.coin, 20); this.reset(); break; }
        drive = this.toward(aim[0], aim[1], dist < 5 ? 0.5 : 1);
        if (dist < 3) { this.state = 'push'; this.timer = 30; this.empty = 0; this.tries = 0; this.headway(); }
        // the way's own measure, until the last few tiles, where a tile is too coarse to see it closing in
        else if (this.timer <= 0 || this.stalled(dt, dist < 12 ? dist / TILE : nav.distance(this.way!, d.x, d.y))) {
          // the way there is blocked, by a heap or another machine: that coin can wait
          this.shun(this.coin, 15);
          this.retreat();
        }
        break;
      }
      case 'push': {
        const dist = Math.hypot(HOLE.x - d.x, HOLE.y - d.y);
        // to the hole or a belt, whichever is nearer, as the way goes; aimed from the machine's middle,
        // clear by the width of a loaded blade, so its corners do not catch a corridor's
        const toHole = nav.dropIsHole(d.x, d.y) && nav.clear(d.x, d.y, HOLE.x, HOLE.y, LOADED_CLEARANCE);
        const aim = toHole ? [HOLE.x, HOLE.y] : nav.ahead(nav.toDrop, d.x, d.y, LOADED_CLEARANCE, 5);
        if (!aim) { this.retreat(); break; }
        drive = this.toward(aim[0], aim[1], 1);
        // a full blade is slow going, which is fine; one empty a while has lost its load and should look again
        this.empty = load === 0 ? this.empty + dt : 0;
        // the blade over a belt, and the load with it: the belt has it now
        const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
        const onBelt = this.timer < 29.2 && nav.onBelt(d.x + c * BLADE_AT * BOT_SCALE, d.y + s * BLADE_AT * BOT_SCALE, -1) !== null;
        if (dist < STOP_AT || onBelt || this.timer <= 0 || (this.timer < 28 && this.empty > 1.5)) this.retreat();
        else if (this.stalled(dt, nav.distance(nav.toDrop, d.x, d.y))) {
          // caught on a corner, most likely: a little way back and at it again, load and all
          if (this.tries++ < RETRIES) { this.state = 'backUp'; this.timer = 0.7; }
          else this.retreat();
        }
        break;
      }
      case 'backUp':
        drive = { throttle: -0.6, steer: 0 };
        if (this.timer <= 0) { this.state = 'push'; this.headway(); }
        break;
      case 'retreat':
        drive = { throttle: -1, steer: 0 };
        if (this.timer <= 0) this.reset();
        break;
    }
    drive = this.giveWay(drive, traffic, nav);
    d.update(dt, drive, BOT_SPEC, load);
  }

  /** Where to set up to push a coin: behind it, against the way it is to go, to the hole or a belt. Null if that is rock, or there is no way. */
  private setUpFor(world: World, nav: Nav, i: number): [number, number] | null {
    const cx = world.x[i], cy = world.y[i];
    if (!Number.isFinite(nav.distance(nav.toDrop, cx, cy))) return null;
    const on = nav.dropIsHole(cx, cy) && nav.clear(cx, cy, HOLE.x, HOLE.y, 0.5) ? [HOLE.x, HOLE.y] : nav.ahead(nav.toDrop, cx, cy, 0.5, 3);
    if (!on) return null;
    let ux = on[0] - cx, uy = on[1] - cy;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len; uy /= len;
    // Straight behind it, and then nearer. Not in the rock, and not in the middle of a heap, where
    // behind a coin is more heap. A dear enough thing is worth more trouble: set up in a heap for it,
    // or at a slant, where straight behind is rock — a hidden chamber, a corner — since a push from
    // the side still moves it out to where it can be pushed again.
    const dear = KIND_VALUE[world.kind[i]] >= DEAR;
    for (const back of [SET_BACK, SET_BACK * 0.6]) {
      for (const turn of dear ? [0, 0.5, -0.5, 1, -1] : [0]) {
        const c = Math.cos(turn), s = Math.sin(turn);
        const sx = cx - (ux * c - uy * s) * back, sy = cy - (ux * s + uy * c) * back;
        const t = nav.tileOf(sx, sy);
        if (nav.clear(sx, sy, sx, sy, CLEARANCE * 0.8) && t >= 0 && (dear || nav.crowd[t] <= BURIED)) return [sx, sy];
      }
    }
    return null;
  }

  /** Whether it is out of another machine's way this moment, rather than about its own business. */
  yielding = false;

  /** Who goes first among the robo-dozers: one bringing a load back to the hole, then the rest. */
  get priority(): number { return this.state === 'push' ? 1 : 0; }

  /**
   * The drive it wanted, changed for the other machines about. One that goes
   * first and is coming at this one, with this one in the path it and its
   * load will take, has the way made for it: this one goes off to the side
   * of that path, or, with no room at the side, on ahead of it or back out
   * of the way, whichever way the other is going. One in this one's own path
   * that does not have to make way — the player, or a loaded machine ahead
   * going the same way — is steered round if there is room and followed if
   * not; one that does have to is left to do it, and not waited on. Two
   * empty machines settle it by number, so they do not both step the same way.
   *
   * The player is steered round and never made way for. Tried, a machine
   * that stepped aside whenever the player drove at it spent a quarter of
   * its time doing so, and the player got about no quicker for it: in a
   * corridor there is nowhere to step, and a machine backing out ahead of
   * the player is slower than the player.
   */
  private giveWay(want: Drive, traffic: Traffic, nav: Nav): Drive {
    const mine = this.priority;
    let yieldTo: Mover | null = null, yieldAt = Infinity;
    let blocker: Mover | null = null, blockerAt = Infinity;
    const myC = Math.cos(this.yaw), myS = Math.sin(this.yaw);
    // where this one is going: its speed now, or, setting off, the pace its drive asks for
    const mySpeed = Math.abs(this.dozer.speed) > 0.5 ? this.dozer.speed : want.throttle * BOT_SPEC.maxSpeed * 0.5;
    const movers: Mover[] = [
      { x: traffic.player.x, y: traffic.player.y, yaw: traffic.player.yaw, speed: traffic.player.speed, priority: 0, rank: 0, width: PLAYER_WIDTH, player: true },
      ...traffic.bots.filter((b) => b !== this).map((b) => ({ x: b.x, y: b.y, yaw: b.yaw, speed: b.dozer.speed, priority: b.priority, rank: b.dozer.owner, width: BOT_WIDTH, player: false })),
    ];
    this.yielding = false;
    for (const o of movers) {
      const dx = this.x - o.x, dy = this.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > LOOK + 4) continue;
      const lane = (o.width + BOT_WIDTH) / 2 + 1;
      // a loaded machine that has stopped is about to go on, the way it faces
      const oSpeed = Math.abs(o.speed) > 0.5 ? o.speed : o.priority === 1 ? 3 : 0;
      // how near the two come in the next few seconds, each going on as it is
      const vx = myC * mySpeed - Math.cos(o.yaw) * oSpeed, vy = myS * mySpeed - Math.sin(o.yaw) * oSpeed;
      const v2 = vx * vx + vy * vy;
      const tNear = v2 > 1e-4 ? Math.max(0, Math.min(FORESEE, -(dx * vx + dy * vy) / v2)) : 0;
      const near = Math.hypot(dx + vx * tNear, dy + vy * tNear);
      if (near > lane) continue;
      // two loaded machines do not dodge each other, and lose their loads doing it: the one behind follows
      const first = !o.player && (o.priority > mine || (o.priority === mine && mine === 0 && o.rank < this.dozer.owner));
      if (first && oSpeed !== 0 && d < yieldAt) { yieldTo = { ...o, speed: oSpeed }; yieldAt = d; continue; }
      // one that has to make way for this one is left to do it; only one that does not is steered round or followed
      const makesWay = !o.player && (mine > o.priority || (o.priority === mine && mine === 0 && this.dozer.owner < o.rank));
      const along = myC * -dx + myS * -dy;
      if (!makesWay && want.throttle !== 0 && along * Math.sign(want.throttle) > 0 && d < blockerAt) { blocker = o; blockerAt = d; }
    }
    if (yieldTo) {
      this.headway();
      this.yielding = true;
      const goes = Math.sign(yieldTo.speed) || 1;
      const c = Math.cos(yieldTo.yaw) * goes, s = Math.sin(yieldTo.yaw) * goes;
      const across = -s * (this.x - yieldTo.x) + c * (this.y - yieldTo.y);
      const side = across >= 0 ? 1 : -1;
      const lane = (yieldTo.width + BOT_WIDTH) / 2 + 2;
      for (const k of [side, -side]) {
        // out to the side, far enough to clear it and its load, and a little on the way it is going
        const px = this.x - s * k * (lane - Math.abs(across) + 1) + c * 2, py = this.y + c * k * (lane - Math.abs(across) + 1) + s * 2;
        if (nav.clear(this.x, this.y, px, py, CLEARANCE)) return this.toward(px, py, 0.8);
      }
      // no room at the side, a corridor say: go the way it is going, ahead of it, until there is
      const ahead = nav.ahead(nav.toHole, this.x, this.y, CLEARANCE, 3);
      const alongMine = myC * c + myS * s;
      return { throttle: alongMine >= 0 ? 0.9 : -0.9, steer: ahead && alongMine >= 0 ? this.toward(ahead[0], ahead[1], 1).steer * 0.5 : 0 };
    }
    if (blocker) {
      this.headway();
      const c = myC, s = myS, dx = blocker.x - this.x, dy = blocker.y - this.y;
      const across = -s * dx + c * dy;
      const side = across >= 0 ? -1 : 1;
      const lane = (blocker.width + BOT_WIDTH) / 2 + 2;
      const reach = Math.max(4, c * dx + s * dy);
      const px = this.x + c * reach - s * side * lane, py = this.y + s * reach + c * side * lane;
      if (want.throttle > 0 && nav.clear(this.x, this.y, px, py, CLEARANCE)) return this.toward(px, py, 0.7);
      // no way round: close up no nearer than a machine's length, at its pace
      return { throttle: blockerAt < 6 ? 0 : want.throttle * 0.4, steer: want.steer };
    }
    return want;
  }

  private retreat() { this.state = 'retreat'; this.timer = 1.1; }

  private headway() { this.best = Infinity; this.since = 0; }

  /** Whether it has gone `NO_HEADWAY` seconds without getting a tile nearer, `left` being how far it has to go. */
  private stalled(dt: number, left: number): boolean {
    if (left < this.best - 0.5) { this.best = left; this.since = 0; return false; }
    return (this.since += dt) > NO_HEADWAY;
  }

  private shun(i: number, seconds: number) {
    if (i < 0) return;
    this.shunned.set(i, this.clock + seconds);
    if (this.shunned.size > 64) for (const [k, until] of this.shunned) if (until <= this.clock) this.shunned.delete(k);
  }

  /** Steer to face a point and drive at it, turning on the spot when it is well off the nose. */
  private toward(tx: number, ty: number, pace: number): Drive {
    const d = this.dozer;
    let diff = Math.atan2(ty - d.y, tx - d.x) - d.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, diff * 2.5));
    const throttle = (Math.abs(diff) < 0.5 ? 1 : Math.abs(diff) < 1.3 ? 0.4 : 0) * pace;
    return { throttle, steer };
  }
}

/**
 * What the robo-dozers go for. They work the room being cleared, and only
 * that: not the next one before the player has gone on into it, and not the
 * strays of one sealed. Its coins are listed now and then; a machine takes
 * the best of a handful, for value, company, nearness and how far it has to
 * go to the hole, and leaves alone what another machine is already after.
 */
export class Foreman {
  private workable: number[] = [];
  private listedAt = -Infinity;

  constructor(
    private readonly world: World,
    private readonly nav: Nav,
    private readonly bots: Bot[],
    /** Where each body came from, by slot: a room, or a hidden chamber after the rooms. */
    private readonly origin: Uint8Array,
    /** Whether bodies from a place are the drones' to work: the room being cleared, and what is broken into off it. */
    private readonly works: (from: number) => boolean,
  ) {}

  /** The coin for a machine to go for, or -1 with nothing worth it; `now` is the game's clock, in seconds. */
  choose(bot: Bot, now: number): number {
    const { world, nav, bots } = this;
    if (now - this.listedAt > 0.5) {
      this.listedAt = now;
      nav.count(world.count, world.alive, world.x, world.y);
      this.workable = [];
      for (let i = 0; i < world.count; i++) {
        if (!world.alive[i] || !this.works(this.origin[i]) || world.z[i] < 0) continue;
        if (Math.hypot(world.x[i] - HOLE.x, world.y[i] - HOLE.y) < STOP_AT + 4) continue;
        // on a belt, and on its way
        if (nav.onBelt(world.x[i], world.y[i])) continue;
        this.workable.push(i);
      }
    }
    const { workable } = this;
    const n = workable.length;
    if (!n) return -1;
    let best = -1, bestScore = -Infinity;
    for (let k = 0, m = Math.min(n, 48); k < m; k++) {
      const i = n <= 48 ? workable[k] : workable[(Math.random() * n) | 0];
      if (!world.alive[i] || bot.shuns(i)) continue;
      const x = world.x[i], y = world.y[i];
      const taken = bots.some((o) => o !== bot && o.coin >= 0 && world.alive[o.coin] && Math.hypot(world.x[o.coin] - x, world.y[o.coin] - y) < 6);
      if (taken) continue;
      const toDrop = nav.distance(nav.toDrop, x, y);
      if (!Number.isFinite(toDrop)) continue;
      // a coin with others round it is a load, and a stray on its own is a trip for one coin;
      // one buried in the middle of a heap is turned down when the machine looks for where to set up
      const crowd = Math.min(12, nav.crowd[nav.tileOf(x, y)]);
      const score = KIND_VALUE[world.kind[i]] * 3 + crowd * 2 - Math.hypot(x - bot.x, y - bot.y) * 0.3 - toDrop * TILE * 0.08;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
}

/**
 * A fountain: now and then the floor of a room cracks, glows for a moment,
 * and throws up a spray of coins for a few seconds. Nothing to react to,
 * just somewhere to wander over to.
 */
export class Fountain {
  state: 'idle' | 'warn' | 'spray' = 'idle';
  x = 0; y = 0;
  /** How bright the crack is, 0 to 1, for the light and the glow. */
  glow = 0;
  private timer: number;
  private spill = 0;

  constructor(private area: Area) {
    this.timer = 12 + Math.random() * 18;
  }

  /** Steps the fountain; `spawn` is asked for each coin, and `crack` once when the floor goes. */
  update(dt: number, spawn: (kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number) => boolean, crack: () => void) {
    this.timer -= dt;
    switch (this.state) {
      case 'idle':
        this.glow = Math.max(0, this.glow - dt);
        if (this.timer <= 0) {
          const [x, y] = this.area.cracks[(Math.random() * this.area.cracks.length) | 0];
          this.x = x; this.y = y;
          this.state = 'warn'; this.timer = 2.6;
          crack();
        }
        return;
      case 'warn':
        this.glow = Math.min(1, this.glow + dt / 2);
        if (this.timer <= 0) { this.state = 'spray'; this.timer = 3.5; }
        return;
      case 'spray': {
        this.glow = 1;
        this.spill += dt * 22;
        while (this.spill >= 1) {
          this.spill--;
          let kind = 0;
          const roll = Math.random();
          let acc = 0;
          for (const [k, p] of this.area.vein.gems) { acc += p * 2; if (roll < acc) { kind = k; break; } }
          const a = Math.random() * Math.PI * 2, spread = 3 + Math.random() * 5;
          if (!spawn(kind, this.x, this.y, 0.8, Math.cos(a) * spread, Math.sin(a) * spread, 18 + Math.random() * 10)) { this.timer = 0; break; }
        }
        if (this.timer <= 0) { this.state = 'idle'; this.timer = 28 + Math.random() * 22; }
        return;
      }
    }
  }
}
