/**
 * The game played by a monkey: the real game, without the picture, driven
 * at random and made to do at random everything a player can make happen —
 * charging walls, chambers, lamps and barrels; pushing anything at all down
 * the hole, or onto a current or down a drain; raising the scoop with what is in it,
 * carrying it, setting it down and tipping it out; setting barrels off; buying things; opening the way out and
 * driving out through it, on into the next cave; honking; saving and
 * loading — and checked after every few frames for anything that must always
 * hold and does not (`invariants.ts`), and for anything thrown.
 *
 * Only what a player could do. A monkey that did what no player can would
 * find bugs no player will.
 *
 * From a seed, so a failure can be played again exactly: `npm run fuzz --
 * --seed N` does, and prints what was done before it went wrong.
 */
import { Autopilot } from '../src/autopilot';
import { buildCave, tileCentre } from '../src/cave';
import { RUN } from '../src/caves';
import { Economy, memoryStore } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { BARREL_KIND, GEODE_KIND, KIND_NAME, KIND_RADIUS } from '../src/physics';
import { wallTiles } from '../src/walls';
import { onward } from './run';

const DT = 1 / 60;
/** How many frames between checks, when nothing has just been done. */
const CHECK_EVERY = 10;
/** How many of the last things done a failure reports. */
const LOG_TAIL = 25;

export interface FuzzFailure {
  seed: number;
  frame: number;
  problems: string[];
  /** The last things done before it, oldest first. */
  log: string[];
}

export interface FuzzResult {
  seed: number;
  frames: number;
  failure: FuzzFailure | null;
  /** How often each thing was done, and each event happened: to see that the monkey got about. */
  done: Record<string, number>;
  happened: Record<string, number>;
  /** The cave the game began in, which the seed picks, and every cave it was in at some time. */
  started: string;
  visited: string[];
}

function seeded(n: number): () => number {
  let s = (n * 2654435761 + 1) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Play `frames` frames of the game at random from `seed`. */
export function fuzz(seed: number, frames: number): FuzzResult {
  const random = seeded(seed);
  const saved = Math.random;
  Math.random = random;
  const happened: Record<string, number> = {};
  const done: Record<string, number> = {};
  const count = (into: Record<string, number>, key: string) => (into[key] = (into[key] ?? 0) + 1);
  const events: GameEvents = new Proxy(
    {},
    {
      get: (_, name: string) => () => count(happened, name),
    },
  );
  const log: string[] = [];
  // the seed picks the cave the game begins in, through a fresh save made before it starts, as a player's save
  // would be, so the caves with two holes and two belts are played and not only the first
  const started = RUN[seed % RUN.length].id;
  const visited = new Set<string>([started]);
  let frame = 0;
  const fail = (problems: string[]): FuzzResult => ({
    seed,
    frames: frame,
    failure: { seed, frame, problems, log: log.slice(-LOG_TAIL) },
    done,
    happened,
    started,
    visited: [...visited],
  });

  try {
    let store = memoryStore(JSON.stringify({ cave: started }));
    const first = new Economy(store, RUN);
    let game = new Game(first, buildCave(first.cave()), events);
    /** The autopilot, while the monkey has handed it the controls to drive out through the way out. */
    const hand: { pilot: Autopilot | null } = { pilot: null };
    let drive = { throttle: 0, steer: 0 };
    let busy = 0;
    /** The frames the monkey presses one of the scoop's buttons on, and which. */
    const presses = new Map<number, 'lift' | 'tip'>();
    const pick = <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(random() * xs.length)] : undefined);
    const between = (a: number, b: number) => a + random() * (b - a);
    /** Somewhere to be: by a heap, a barrel, a lamp, a wall, a chamber or a coin. */
    const somewhere = (): [number, number] | undefined => {
      const { world, cave } = game;
      const places: [number, number][] = [];
      for (const h of cave.spec.heaps) places.push([h.x, h.y]);
      for (const b of cave.barrels) places.push([b.x, b.y]);
      cave.lamps.forEach((l) => places.push([l.x, l.y]));
      cave.spec.walls.forEach((_, k) => places.push(...wallTiles(cave, k)));
      for (let n = 0; n < 8 && world.live; n++) {
        const i = Math.floor(random() * world.count);
        if (world.alive[i]) places.push([world.x[i], world.y[i]]);
      }
      return pick(places);
    };
    /** Somewhere open near a point, for the dozer: the nearest tile the dozer is not in the rock at. */
    const openNear = (x: number, y: number): [number, number] => {
      const solid = game.world.solid;
      for (let r = 0; r < 40; r += 2) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const px = x + Math.cos(a) * r,
            py = y + Math.sin(a) * r;
          const t = game.nav.tileOf(px, py);
          if (t >= 0 && !solid[t]) return [px, py];
        }
      }
      return [game.cave.holes[0].x + 12, game.cave.holes[0].y];
    };
    const act = (name: string, detail: string) => {
      count(done, name);
      log.push(`frame ${frame}: ${name} ${detail}`);
    };

    const actions: [number, () => void][] = [
      [
        30,
        () => {
          drive = { throttle: between(-0.6, 1), steer: between(-1, 1) };
          busy = Math.floor(between(30, 180));
          act('drive', `${drive.throttle.toFixed(2)},${drive.steer.toFixed(2)} for ${busy}`);
        },
      ],
      [
        8,
        () => {
          const at = somewhere();
          if (!at) return;
          const [x, y] = openNear(at[0] + between(-8, 8), at[1] + between(-8, 8));
          Object.assign(game.dozer, { x, y, yaw: between(0, Math.PI * 2), speed: 0 });
          act('teleport', `${x.toFixed(1)},${y.toFixed(1)}`);
        },
      ],
      [
        10,
        () => {
          // at something, flat out
          const at = somewhere();
          if (!at) return;
          const a = between(0, Math.PI * 2);
          const [x, y] = openNear(at[0] - Math.cos(a) * 10, at[1] - Math.sin(a) * 10);
          Object.assign(game.dozer, { x, y, yaw: Math.atan2(at[1] - y, at[0] - x), speed: between(0, 14) });
          drive = { throttle: 1, steer: between(-0.2, 0.2) };
          busy = Math.floor(between(40, 120));
          act('charge', `at ${at[0].toFixed(1)},${at[1].toFixed(1)} from ${x.toFixed(1)},${y.toFixed(1)}`);
        },
      ],
      [
        6,
        () => {
          const { world } = game;
          const slots = [...Array(world.count).keys()].filter((i) => world.alive[i] && !world.carried[i]);
          const i = pick(slots);
          if (i === undefined) return;
          // over one of the cave's holes: the world's middle is rock in most caves, and a body put there is in it
          const hole = pick(game.cave.holes)!;
          world.x[i] = hole.x + between(-1, 1);
          world.y[i] = hole.y + between(-1, 1);
          world.z[i] = 2;
          world.vx[i] = world.vy[i] = world.vz[i] = 0;
          world.wake(i);
          act('down the hole', `${KIND_NAME[world.kind[i]]} ${i}`);
        },
      ],
      [
        4,
        () => {
          // onto a current, at its head, to be carried along it: to a hole, and banked, or to a drain, and lost
          const { world, cave } = game;
          const c = pick(cave.currents);
          if (!c) return;
          const slots = [...Array(world.count).keys()].filter((i) => world.alive[i] && !world.carried[i]);
          const i = pick(slots);
          if (i === undefined) return;
          const len = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
          const along = between(1, len * 0.5),
            across = between(-c.width * 0.4, c.width * 0.4);
          world.x[i] = c.x0 + ((c.x1 - c.x0) / len) * along - ((c.y1 - c.y0) / len) * across;
          world.y[i] = c.y0 + ((c.y1 - c.y0) / len) * along + ((c.x1 - c.x0) / len) * across;
          world.z[i] = 1.2;
          world.vx[i] = world.vy[i] = world.vz[i] = 0;
          world.wake(i);
          act('onto a current', `${KIND_NAME[world.kind[i]]} ${i} on ${c.id}`);
        },
      ],
      [
        3,
        () => {
          // anything at all down a drain, a lit barrel and a brick included
          const { world, cave } = game;
          const drain = pick(cave.drains);
          if (!drain) return;
          const slots = [...Array(world.count).keys()].filter((i) => world.alive[i] && !world.carried[i]);
          const i = pick(slots);
          if (i === undefined) return;
          world.x[i] = drain.x + between(-1, 1);
          world.y[i] = drain.y + between(-1, 1);
          world.z[i] = 2;
          world.vx[i] = world.vy[i] = world.vz[i] = 0;
          world.wake(i);
          act('down the drain', `${KIND_NAME[world.kind[i]]} ${i}`);
        },
      ],
      [
        4,
        () => {
          const { world } = game;
          const barrels = [...Array(world.count).keys()].filter((i) => world.alive[i] && world.kind[i] === BARREL_KIND);
          const i = pick(barrels);
          if (i === undefined) return;
          const seconds = between(0.05, 3);
          game.barrels.light(i, seconds);
          act('light', `barrel ${i} for ${seconds.toFixed(2)}s`);
        },
      ],
      [
        3,
        () => {
          // a barrel where the coins are, going off soon
          const at = somewhere();
          if (!at) return;
          const [x, y] = openNear(at[0], at[1]);
          const i = game.stock.spawnBarrel(x, y, KIND_RADIUS[BARREL_KIND] + 0.05);
          if (i >= 0) game.barrels.light(i, between(0.1, 1.5));
          act('barrel', `at ${x.toFixed(1)},${y.toFixed(1)}: slot ${i}`);
        },
      ],
      [
        3,
        () => {
          // a barrel brought to a geode and lit, as a player would do it: the geode stands in the middle of its blast
          const { world } = game;
          const geodes = [...Array(world.count).keys()].filter((i) => world.alive[i] && world.kind[i] === GEODE_KIND);
          const g = pick(geodes);
          if (g === undefined) return;
          const a = random() * Math.PI * 2,
            reach = between(2.5, 6);
          const [x, y] = openNear(world.x[g] + Math.cos(a) * reach, world.y[g] + Math.sin(a) * reach);
          const i = game.stock.spawnBarrel(x, y, KIND_RADIUS[BARREL_KIND] + 0.05);
          if (i >= 0) game.barrels.light(i, between(0.05, 0.6));
          act('crack a geode', `geode ${g} from barrel ${i} at ${x.toFixed(1)},${y.toFixed(1)}`);
        },
      ],
      [
        4,
        () => {
          const e = game.economy;
          e.deposit(Math.floor(between(0, 3000)));
          const offer = pick([...e.offers(), ...e.cosmetics()].filter((o) => o.available));
          const bought = offer ? e.buy(offer.id) : false;
          if (bought && offer?.id.startsWith('belt:')) count(happened, `bought ${offer.id}`);
          act('shop', `${offer?.id ?? 'nothing'}: ${bought ? 'bought' : 'not'}`);
        },
      ],
      [
        3,
        () => {
          // every belt a cave sells, each on its own: the monkey chooses among the ones not yet bought, so a cave
          // with two gets both, and a cave with two holes or two belts is played with them running
          const e = game.economy;
          const unbought = game.cave.spec.belts.filter((b) => !e.save.belts.includes(b.id));
          const belt = pick(unbought);
          if (!belt) return;
          e.deposit(belt.cost);
          const bought = e.buy(`belt:${belt.id}`);
          act('buy a belt', `${belt.id}: ${bought ? 'bought' : 'not'}`);
          if (bought) count(happened, `bought belt:${belt.id}`);
        },
      ],
      [
        3,
        () => {
          game.economy.open();
          act('open', `the way out of ${game.economy.save.cave}: ${game.economy.save.open}`);
        },
      ],
      [
        4,
        () => {
          // with the way out open, to it, and out through it by the autopilot's route: from where the
          // dozer is, or from its mouth
          const { economy, cave } = game;
          if (!economy.save.open || !cave.spec.exit) return;
          if (random() < 0.5) {
            const [x0, y0, x1, y1] = cave.spec.exit.tiles;
            const [ox, oy] = cave.spec.exit.out;
            const [x, y] = tileCentre(
              cave.grid,
              ox ? (ox > 0 ? x0 : x1) : (x0 + x1) / 2,
              oy ? (oy > 0 ? y0 : y1) : (y0 + y1) / 2,
            );
            Object.assign(game.dozer, { x: x - ox * 12, y: y - oy * 12, yaw: Math.atan2(oy, ox), speed: 0 });
          }
          hand.pilot = new Autopilot(game, 'rusher', { shop: false });
          busy = 900;
          act('drive out', `of ${economy.save.cave} from ${game.dozer.x.toFixed(1)},${game.dozer.y.toFixed(1)}`);
        },
      ],
      [
        2,
        () => {
          const k = pick(game.cave.spec.secrets.map((_, k) => k));
          if (k === undefined) return;
          game.economy.reveal(k);
          act('reveal', `chamber ${k}`);
        },
      ],
      [
        3,
        () => {
          const w = pick(game.cave.spec.walls.map((_, w) => w));
          if (w === undefined) return;
          const damage = Math.floor(between(1, 300));
          game.economy.hitWall(w, damage);
          act('hit wall', `${w} for ${damage}`);
        },
      ],
      [
        5,
        () => {
          // the scoop, worked as a player would: bought if it is not yet, then driven into something and raised,
          // driven about with it, and lowered or tipped, which may be anywhere: the hole, a wall or a corner
          const e = game.economy;
          const size = 1 + Math.floor(random() * 3);
          while (e.save.scoop < size) {
            e.deposit(1e5);
            if (!e.buy('scoop')) break;
          }
          const at = somewhere();
          if (!at) return;
          const [x, y] = openNear(at[0] + between(-4, 4), at[1] + between(-4, 4));
          // facing it, from where it can be driven at: a little way back
          const yaw = between(0, Math.PI * 2);
          const [bx, by] = openNear(x - Math.cos(yaw) * 5, y - Math.sin(yaw) * 5);
          Object.assign(game.dozer, { x: bx, y: by, yaw: Math.atan2(at[1] - by, at[0] - bx), speed: 0 });
          drive = { throttle: between(0, 0.8), steer: between(-0.3, 0.3) };
          busy = Math.floor(between(20, 90));
          const either = () => (random() < 0.5 ? 'lift' : 'tip');
          presses.set(frame + 1 + Math.floor(between(0, 25)), 'lift');
          presses.set(frame + busy + 1, either());
          if (random() < 0.5) presses.set(frame + busy + 30 + Math.floor(between(0, 200)), either());
          act('scoop', `size ${e.save.scoop} at ${at[0].toFixed(1)},${at[1].toFixed(1)}`);
        },
      ],
      [
        2,
        () => {
          game.economy.save.horn = true;
          game.honk();
          act('honk', '');
        },
      ],
      [
        6,
        () => {
          drive = { throttle: 0, steer: 0 };
          busy = Math.floor(between(60, 300));
          act('wait', `${busy}`);
        },
      ],
      [
        2,
        () => {
          // saved and loaded: the game comes back as it was
          const before = game.economy.save;
          game.persist();
          const json = store.json!;
          const live = game.world.live;
          const barrels = game.stock.kinds[BARREL_KIND];
          const geodes = game.stock.kinds[GEODE_KIND];
          store = memoryStore(json);
          const economy = new Economy(store, RUN);
          game = new Game(economy, buildCave(economy.cave()), events);
          visited.add(economy.save.cave);
          const after = game.economy.save;
          const same = (['bank', 'toll', 'cave', 'open', 'done', 'drones', 'body', 'drained'] as const).filter(
            (k) => before[k] !== after[k],
          );
          const sameLists = (['secrets', 'walls', 'lampsBroken', 'belts'] as const).filter(
            (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
          );
          const problems = [...same, ...sameLists].map(
            (k) => `reload: ${k} was ${JSON.stringify(before[k])}, came back ${JSON.stringify(after[k])}`,
          );
          if (game.stock.kinds[BARREL_KIND] !== barrels)
            problems.push(`reload: ${barrels} barrels came back ${game.stock.kinds[BARREL_KIND]}`);
          if (game.stock.kinds[GEODE_KIND] !== geodes)
            problems.push(`reload: ${geodes} geodes came back ${game.stock.kinds[GEODE_KIND]}`);
          // what was left of the cave, every chamber, side room and wall comes back exactly, bar what there is no room to draw
          const was = JSON.parse(json) as { left: number[][] };
          game.stock.left.forEach((kinds, source) =>
            kinds.forEach((n, kind) => {
              const had = was.left[source]?.[kind] ?? 0;
              const full = game.stock.kinds[kind] >= (game.capacity.kinds[kind] || Infinity);
              if (n !== had && !(full && n < had))
                problems.push(`reload: source ${source} had ${had} ${KIND_NAME[kind]}, came back ${n}`);
            }),
          );
          if (problems.length) throw new Reload(problems);
          hand.pilot = null;
          presses.clear();
          act('reload', `${live} bodies, ${game.world.live} back`);
        },
      ],
    ];
    const total = actions.reduce((s, [w]) => s + w, 0);

    for (frame = 0; frame < frames; frame++) {
      let acted = false;
      if (busy <= 0) {
        let roll = random() * total;
        for (const [w, fn] of actions) {
          if ((roll -= w) > 0) continue;
          drive = { throttle: 0, steer: 0 };
          busy = 1;
          fn();
          acted = true;
          break;
        }
      }
      busy--;
      if (hand.pilot && busy > 0) hand.pilot.step(DT);
      else {
        hand.pilot = null;
        game.step(DT, drive, { scoop: presses.get(frame) });
        presses.delete(frame);
      }
      // out through the way out: on into the next cave, as whoever owns the game does
      if (game.left) {
        const was = game.economy.save.cave;
        game = onward(game, game.economy, RUN, events);
        visited.add(game.economy.save.cave);
        hand.pilot = null;
        log.push(`frame ${frame}: left ${was} for ${game.economy.save.cave}`);
      }
      if (acted || frame % CHECK_EVERY === 0) {
        const problems = checkInvariants(game);
        if (problems.length) return fail(problems);
      }
    }
    return { seed, frames, failure: null, done, happened, started, visited: [...visited] };
  } catch (err) {
    if (err instanceof Reload) return fail(err.problems);
    return fail([`threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`]);
  } finally {
    Math.random = saved;
  }
}

class Reload extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}
