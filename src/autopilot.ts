/**
 * The player's dozer driven by the game itself: for measuring how the game
 * plays, from a new save to the cave cleared, without a person at the
 * controls.
 *
 * It pushes coins as a drone does — the same mind, `Bot`, driving the
 * player's own machine at its own size and with its upgrades — until what is
 * left is strays, which it sweeps up, driving over them for the magnet to
 * gather and taking the load to the hole. It does what a player does besides: buys the cheapest thing in the workshop it can
 * afford, as soon as it can; goes on into the next room when it is done with
 * this one; and, played thorough, breaks into the room's hidden chamber and
 * knocks down its brick walls first, by charging them square on.
 *
 * Two ways to play it. A `rusher` goes on as soon as the next room opens and
 * leaves the bonus loot. A `thorough` player breaks in everywhere, and goes
 * on only when there is nothing worth having left.
 *
 * It is handed the game, and knows nothing of the page.
 */
import {
  BRICK,
  COLS,
  GATE,
  HOLE,
  OPEN,
  ROWS,
  SECRET,
  SECRETS,
  TILE,
  WALLS,
  WINGS,
  sealPoint,
  tileCentre,
} from './cave';
import { areaOfSource } from './economy';
import type { Game } from './game';
import type { Drive } from './input';
import { KIND_VALUE } from './physics';
import { NO_SOURCE } from './stock';
import { Bot } from './tools';

export type Profile = 'thorough' | 'rusher';

export interface AutopilotOptions {
  /** Whether it buys from the workshop; left out, it does. */
  shop?: boolean;
}

/** Something it did worth knowing when: bought something, went on, broke in. `t` is game seconds. */
export interface PilotEvent {
  t: number;
  what: string;
}

/** How often it looks up from pushing to decide what to do, in seconds. */
const PLAN_EVERY = 0.5;
/** How far back from a face it lines up to charge it, and how near it has to get to that spot. */
const RUN_UP = 12,
  LINED_UP = 2.5;
/** How many charges at one face before it gives up on it. */
const CHARGES = 14;
/** Less than this share of what the room has held lying about, and a thorough player is done with it. */
const WORKED_OUT = 0.05;
/**
 * Sweeping up strays: it sweeps when the best coin to set up for has fewer
 * than `SWEEP_BELOW` others on its tile; strays are counted in patches `PATCH`
 * across; it gathers for `GATHER_FOR` seconds, or until it has `FULL_LOAD` on
 * the blade, and then takes the load to the hole.
 */
const SWEEP_BELOW = 3,
  PATCH = 8,
  GATHER_FOR = 30,
  FULL_LOAD = 25;
/** Nothing banked for this long, with nothing else to do, and it is stuck. */
const STUCK_AFTER = 180;

/** A face of rock or brick to charge: the tile to hit, and the way into it from the floor in front. */
interface Face {
  kind: 'chamber' | 'wall';
  index: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

type Plan =
  | { doing: 'work' }
  | {
      doing: 'charge';
      face: Face;
      phase: 'approach' | 'align' | 'ram' | 'back';
      timer: number;
      charges: number;
      fast: boolean;
    }
  | { doing: 'go on'; area: number }
  | {
      doing: 'sweep';
      phase: 'gather' | 'deliver' | 'back';
      target: [number, number] | null;
      timer: number;
      gathering: number;
    }
  | { doing: 'done' }
  | { doing: 'stuck' };

export class Autopilot {
  /** The mind that pushes coins, driving the player's own machine. */
  readonly machine: Bot;
  readonly log: PilotEvent[] = [];
  private plan: Plan = { doing: 'work' };
  private planIn = 0;
  private countedAt = -Infinity;
  /** What had been banked when it went into the room being cleared. */
  private roomBankedAt = 0;
  private lastBanked = 0;
  private sinceBanked = 0;
  /** The last pick found nothing it could set up behind: time to sweep up strays instead. */
  private strays = false;
  /** Patches of strays swept lately, by patch, and until when to leave them be. */
  private readonly swept = new Map<number, number>();
  /** The way to wherever it is driving, kept while it drives there. */
  private way: { x: number; y: number; field: Float32Array } | null = null;
  /** Faces given up on, by kind and index. */
  private readonly givenUp = new Set<string>();

  constructor(
    private readonly game: Game,
    readonly profile: Profile,
    private readonly options: AutopilotOptions = {},
  ) {
    this.machine = new Bot(game.world.solid, 0, game.dozer.x, game.dozer.y, {
      dozer: game.dozer,
      spec: () => game.economy.spec(),
    });
    this.lastBanked = game.economy.save.banked;
  }

  /** What it is doing now. */
  get doing(): Plan['doing'] {
    return this.plan.doing;
  }

  /** Whether the game is over for it: the cave cleared, or stuck with nothing it can do. */
  get over(): boolean {
    return this.plan.doing === 'done' || this.plan.doing === 'stuck';
  }

  /** A point a little past where going on into a room seals the one behind: somewhere to drive to, to go on. */
  pastSeal(area: number): { x: number; y: number } {
    const [sx, sy] = sealPoint(this.game.cave, area);
    const [dx, dy] = WINGS[area].dir;
    return { x: sx + dx * 4, y: sy + dy * 4 };
  }

  /** A step of the game, with the autopilot at the controls. */
  step(dt: number) {
    const { game } = this;
    const save = game.economy.save;
    if (save.banked !== this.lastBanked) {
      this.lastBanked = save.banked;
      this.sinceBanked = 0;
    } else this.sinceBanked += dt;
    if ((this.planIn -= dt) <= 0) {
      this.planIn = PLAN_EVERY;
      this.shop();
      this.decide();
    }
    const room = game.economy.current();
    game.step(dt, this.drive(dt));
    if (game.economy.current() !== room) {
      this.note(`into ${game.economy.current()}`);
      this.roomBankedAt = save.banked;
    }
  }

  private note(what: string) {
    this.log.push({ t: this.game.t, what });
  }

  /** The cheapest thing in the workshop it can afford, bought; nothing cosmetic. */
  private shop() {
    if (this.options.shop === false) return;
    const e = this.game.economy;
    for (;;) {
      const offer = e
        .offers()
        .filter((o) => o.available && !o.owned && o.cost <= e.bank)
        .sort((a, b) => a.cost - b.cost)
        .at(0);
      if (!offer || !e.buy(offer.id)) return;
      this.note(`bought ${offer.id}`);
    }
  }

  /** What to be doing: breaking in, pushing, going on, or nothing more. */
  private decide() {
    const { game } = this;
    const e = game.economy;
    if (e.save.done) {
      if (this.plan.doing !== 'done') this.note('done');
      this.plan = { doing: 'done' };
      return;
    }
    if (this.plan.doing === 'stuck') return;
    if (this.plan.doing === 'charge' || this.plan.doing === 'sweep') return;
    const next = e.next();
    if (this.profile === 'thorough') {
      const face = this.nextFace();
      if (face) {
        this.plan = { doing: 'charge', face, phase: 'approach', timer: 30, charges: 0, fast: false };
        return;
      }
    }
    if (next !== null && e.nextOpen()) {
      const lying = this.lying();
      const done =
        this.profile === 'rusher' ||
        lying < WORKED_OUT * (e.save.banked - this.roomBankedAt + lying) ||
        this.sinceBanked > 60;
      if (done) {
        if (this.plan.doing !== 'go on') this.plan = { doing: 'go on', area: next };
        return;
      }
    }
    if (this.sinceBanked > STUCK_AFTER) {
      this.note(`stuck in ${e.current()}`);
      this.plan = { doing: 'stuck' };
      return;
    }
    if (this.strays) {
      this.strays = false;
      this.plan = { doing: 'sweep', phase: 'gather', target: null, timer: 0, gathering: 0 };
      return;
    }
    this.plan = { doing: 'work' };
  }

  /** What is still lying about from the room being cleared and what is broken into off it, in coins. */
  private lying(): number {
    const { world, stock, economy } = this.game;
    const room = economy.current();
    let value = 0;
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || stock.origin[i] === NO_SOURCE) continue;
      if (areaOfSource(stock.origin[i]) === room) value += KIND_VALUE[world.kind[i]];
    }
    return value;
  }

  /** The next face to charge in the room being cleared: its hidden chamber, then its brick walls; null for none left. */
  private nextFace(): Face | null {
    const { game } = this;
    const save = game.economy.save;
    const room = game.economy.current();
    const faces: Face[] = [];
    SECRETS.forEach((s, k) => {
      if (s.area !== room || save.secrets[k] || this.givenUp.has(`chamber ${k}`)) return;
      faces.push(...this.faces('chamber', k, SECRET + k, s.wall));
    });
    WALLS.forEach((w, k) => {
      if (w.area !== room || save.walls[k] || this.givenUp.has(`wall ${k}`)) return;
      faces.push(...this.faces('wall', k, BRICK + k, w.tiles));
    });
    // the nearest first
    const { dozer } = game;
    faces.sort((a, b) => Math.hypot(a.x - dozer.x, a.y - dozer.y) - Math.hypot(b.x - dozer.x, b.y - dozer.y));
    return faces[0] ?? null;
  }

  /** The faces of a stretch of rock or brick that can be charged: a tile of it with floor in front that the dozer can get to. */
  private faces(kind: Face['kind'], index: number, cell: number, [x0, y0, x1, y1]: readonly number[]): Face[] {
    const { cave, nav, economy } = this.game;
    const out: Face[] = [];
    const openAt = (tx: number, ty: number) => {
      if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
      const c = cave.cells[ty * COLS + tx];
      return c === OPEN || (c >= GATE && c < SECRET && economy.save.areas[c - GATE]);
    };
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (cave.cells[ty * COLS + tx] !== cell) continue;
        for (const [ox, oy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          // the floor in front, and a run-up behind that, both reachable
          if (!openAt(tx + ox, ty + oy) || !openAt(tx + ox * 2, ty + oy * 2)) continue;
          const [fx, fy] = tileCentre(tx + ox * 3, ty + oy * 3);
          if (!Number.isFinite(nav.distance(nav.toHole, fx, fy))) continue;
          const [x, y] = tileCentre(tx, ty);
          out.push({ kind, index, x, y, nx: -ox, ny: -oy });
        }
      }
    }
    return out;
  }

  /** The controls for this step, for what it is doing. */
  private drive(dt: number): Drive {
    const { game } = this;
    const { world, nav, dozer } = game;
    const plan = this.plan;
    switch (plan.doing) {
      case 'work':
        return this.machine.decide(dt, world, world.loads[0] ?? 0, nav, (b) => this.choose(b), {
          bots: game.bots,
          player: dozer,
        });
      case 'go on': {
        const at = this.pastSeal(plan.area);
        return this.along(at.x, at.y);
      }
      case 'charge':
        return this.charge(dt, plan);
      case 'sweep':
        return this.sweep(dt, plan);
      case 'done':
      case 'stuck':
        return { throttle: 0, steer: 0 };
    }
  }

  /**
   * The coin to go for next, or -1 to sweep instead. The best in the room it
   * can set up behind, scored as the foreman scores for the drones. The
   * player's machine is bigger than a drone, so much of a heap has nowhere
   * behind it to set up; it looks at every coin rather than a handful, so it
   * does not keep picking only those.
   */
  private choose(bot: Bot): number {
    const { world, nav, t } = this.game;
    if (t - this.countedAt > 0.5) {
      this.countedAt = t;
      nav.count(world.count, world.alive, world.x, world.y);
    }
    const best = this.best(bot);
    // nothing it can set up behind, or only a coin on its own: a trip for one coin, when a sweep would bring in many
    if (best < 0 || nav.crowd[nav.tileOf(world.x[best], world.y[best])] < SWEEP_BELOW) {
      this.strays = true;
      return -1;
    }
    return best;
  }

  /** The best coin in the room to set up for, or -1 for none. */
  private best(bot: Bot): number {
    const { world, nav, stock, economy, bots } = this.game;
    const room = economy.current();
    let best = -1,
      bestScore = -Infinity;
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.z[i] < 0 || bot.shuns(i)) continue;
      const from = stock.origin[i];
      if (from === NO_SOURCE || areaOfSource(from) !== room) continue;
      const x = world.x[i],
        y = world.y[i];
      if (Math.hypot(x - HOLE.x, y - HOLE.y) < HOLE.radius + 6 || nav.onBelt(x, y)) continue;
      const toDrop = nav.distance(nav.toDrop, x, y);
      if (!Number.isFinite(toDrop)) continue;
      // what a drone is already after is the drone's
      if (
        bots.some((o) => o.coin >= 0 && world.alive[o.coin] && Math.hypot(world.x[o.coin] - x, world.y[o.coin] - y) < 6)
      )
        continue;
      const crowd = Math.min(12, nav.crowd[nav.tileOf(x, y)]);
      const score =
        KIND_VALUE[world.kind[i]] * 3 + crowd * 2 - Math.hypot(x - bot.x, y - bot.y) * 0.3 - toDrop * TILE * 0.08;
      if (score > bestScore && bot.setUpFor(world, nav, i)) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** Down the way to a point, round the rock. */
  private along(x: number, y: number): Drive {
    const { nav, dozer } = this.game;
    if (!this.way || this.way.x !== x || this.way.y !== y) this.way = { x, y, field: nav.toward(x, y) };
    const aim = Math.hypot(x - dozer.x, y - dozer.y) < 8 ? [x, y] : nav.ahead(this.way.field, dozer.x, dozer.y, 3.2, 6);
    return aim ? this.toward(aim[0], aim[1], 1) : { throttle: 0, steer: 0 };
  }

  /**
   * The last of a room, strays in corners and along the rock with nowhere to
   * set up behind them: driven over, patch after patch, for the magnet to pull
   * onto the blade, and what it has gathered pushed to the hole.
   */
  private sweep(dt: number, plan: Extract<Plan, { doing: 'sweep' }>): Drive {
    const { world, nav, dozer, t } = this.game;
    const load = world.loads[0] ?? 0;
    plan.timer -= dt;
    switch (plan.phase) {
      case 'gather': {
        plan.gathering += dt;
        const arrived = plan.target && Math.hypot(plan.target[0] - dozer.x, plan.target[1] - dozer.y) < 3;
        if (!plan.target || arrived || plan.timer <= 0) {
          if (plan.target) this.swept.set(nav.tileOf(plan.target[0], plan.target[1]), t + 40);
          plan.target = plan.gathering < GATHER_FOR && load < FULL_LOAD ? this.patch() : null;
          plan.timer = 12;
          if (!plan.target) {
            if (load > 0) plan.phase = 'deliver';
            else this.plan = { doing: 'work' };
            plan.timer = 30;
            return { throttle: 0, steer: 0 };
          }
        }
        return this.along(plan.target[0], plan.target[1]);
      }
      case 'deliver': {
        const dist = Math.hypot(HOLE.x - dozer.x, HOLE.y - dozer.y);
        if (dist < HOLE.radius + 5 || plan.timer <= 0) {
          plan.phase = 'back';
          plan.timer = 1;
        }
        const aim =
          nav.dropIsHole(dozer.x, dozer.y) && nav.clear(dozer.x, dozer.y, HOLE.x, HOLE.y, 3)
            ? [HOLE.x, HOLE.y]
            : nav.ahead(nav.toDrop, dozer.x, dozer.y, 3, 5);
        return aim ? this.toward(aim[0], aim[1], 1) : { throttle: -1, steer: 0 };
      }
      case 'back':
        if (plan.timer <= 0) this.plan = { doing: 'work' };
        return { throttle: -1, steer: 0 };
    }
  }

  /** The best patch of strays to drive over next: worth the most for how far off it is, and not swept lately; null for none. */
  private patch(): [number, number] | null {
    const { world, nav, stock, economy, dozer, t } = this.game;
    const room = economy.current();
    const value = new Map<number, number>();
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.z[i] < 0) continue;
      const from = stock.origin[i];
      if (from === NO_SOURCE || areaOfSource(from) !== room) continue;
      const x = world.x[i],
        y = world.y[i];
      if (Math.hypot(x - HOLE.x, y - HOLE.y) < HOLE.radius + 6) continue;
      const key = (Math.floor(x / PATCH) + 2048) * 4096 + Math.floor(y / PATCH) + 2048;
      value.set(key, (value.get(key) ?? 0) + KIND_VALUE[world.kind[i]]);
    }
    let best: [number, number] | null = null,
      bestScore = -Infinity;
    for (const [key, v] of value) {
      const px = Math.floor(key / 4096) - 2048,
        py = (key % 4096) - 2048;
      const x = (px + 0.5) * PATCH,
        y = (py + 0.5) * PATCH;
      const tile = nav.tileOf(x, y);
      if (tile < 0 || (this.swept.get(tile) ?? 0) > t || !Number.isFinite(nav.distance(nav.toDrop, x, y))) continue;
      const score = v - Math.hypot(x - dozer.x, y - dozer.y) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
    return best;
  }

  /** Line up square on to a face, a run-up back from it, and drive at it flat out; back off, and again, until it gives. */
  private charge(dt: number, plan: Extract<Plan, { doing: 'charge' }>): Drive {
    const { game } = this;
    const { dozer } = game;
    const save = game.economy.save;
    const { face } = plan;
    const broken = face.kind === 'chamber' ? save.secrets[face.index] : save.walls[face.index];
    const giveUp = () => {
      this.givenUp.add(`${face.kind} ${face.index}`);
      this.plan = { doing: 'work' };
      return { throttle: 0, steer: 0 };
    };
    if (broken) {
      this.note(`broke ${face.kind} ${face.index}`);
      this.plan = { doing: 'work' };
      return { throttle: 0, steer: 0 };
    }
    plan.timer -= dt;
    const sx = face.x - face.nx * RUN_UP,
      sy = face.y - face.ny * RUN_UP;
    switch (plan.phase) {
      case 'approach': {
        if (plan.timer <= 0) return giveUp();
        if (Math.hypot(sx - dozer.x, sy - dozer.y) < LINED_UP) {
          plan.phase = 'align';
          plan.timer = 3;
        }
        return this.along(sx, sy);
      }
      case 'align': {
        const want = Math.atan2(face.ny, face.nx);
        let diff = want - dozer.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < 0.06 || plan.timer <= 0) {
          plan.phase = 'ram';
          plan.timer = 4;
          plan.fast = false;
        }
        return { throttle: 0, steer: Math.max(-1, Math.min(1, diff * 3)) };
      }
      case 'ram': {
        if (Math.abs(dozer.speed) > 5) plan.fast = true;
        // it has hit, and stopped, or it has run out of time
        if ((plan.fast && Math.abs(dozer.speed) < 1) || plan.timer <= 0) {
          if (++plan.charges >= CHARGES) return giveUp();
          plan.phase = 'back';
          plan.timer = 1.2;
        }
        return { throttle: 1, steer: 0 };
      }
      case 'back': {
        if (plan.timer <= 0) {
          plan.phase = 'approach';
          plan.timer = 20;
        }
        return { throttle: -1, steer: 0 };
      }
    }
  }

  /** Steer to face a point and drive at it, turning on the spot when it is well off the nose. */
  private toward(tx: number, ty: number, pace: number): Drive {
    const { dozer } = this.game;
    let diff = Math.atan2(ty - dozer.y, tx - dozer.x) - dozer.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return {
      throttle: (Math.abs(diff) < 0.5 ? 1 : Math.abs(diff) < 1.3 ? 0.4 : 0) * pace,
      steer: Math.max(-1, Math.min(1, diff * 2.5)),
    };
  }
}
