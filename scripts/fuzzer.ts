/**
 * The game played by a monkey: the real game, without the picture, driven
 * at random and made to do at random everything a player can make happen —
 * charging walls, chambers, lamps and barrels; pushing anything at all down
 * the hole; setting barrels off; buying things; opening rooms and going on
 * into them; honking; saving and loading — and checked after every few
 * frames for anything that must always hold and does not (`invariants.ts`),
 * and for anything thrown.
 *
 * Only what a player could do: a chamber is broken into, or a wall hit, only
 * in a room the player can reach. A monkey that did what no player can would
 * find bugs no player will.
 *
 * From a seed, so a failure can be played again exactly: `npm run fuzz --
 * --seed N` does, and prints what was done before it went wrong.
 */
import { AREAS, SECRETS, WALLS, WINGS, sealPoint, tileCentre, type Cave } from '../src/cave';
import { Economy, memoryStore } from '../src/economy';
import { Game, KIND_CAPACITY, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { BARREL_KIND, KIND_NAME, KIND_RADIUS } from '../src/physics';
import { wallTiles } from '../src/walls';

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
  let frame = 0;
  const fail = (problems: string[]): FuzzResult => ({
    seed,
    frames: frame,
    failure: { seed, frame, problems, log: log.slice(-LOG_TAIL) },
    done,
    happened,
  });

  try {
    let store = memoryStore();
    let game = new Game(new Economy(store), events);
    const cave: Cave = game.cave;
    let drive = { throttle: 0, steer: 0 };
    let busy = 0;
    const pick = <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(random() * xs.length)] : undefined);
    const between = (a: number, b: number) => a + random() * (b - a);
    /** The rooms the player can reach: the one being cleared, and the next if it is open. */
    const reachable = () => {
      const e = game.economy;
      const next = e.next();
      return [e.current(), ...(next !== null && e.nextOpen() ? [next] : [])];
    };
    const inReach = (area: number) => reachable().includes(area);
    /** Somewhere to be: by a heap, a barrel, a lamp, a wall, a chamber or a coin, in reach. */
    const somewhere = (): [number, number] | undefined => {
      const { world } = game;
      const places: [number, number][] = [];
      for (const a of reachable()) for (const h of AREAS[a].heaps) places.push([h.x, h.y]);
      for (const b of cave.barrels) if (inReach(b.area)) places.push([b.x, b.y]);
      cave.lamps.forEach((l) => inReach(l.area) && places.push([l.x, l.y]));
      WALLS.forEach((w, k) => inReach(w.area) && places.push(...wallTiles(k)));
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
      return tileCentre(52, 32);
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
          world.x[i] = between(-1, 1);
          world.y[i] = between(-1, 1);
          world.z[i] = 2;
          world.vx[i] = world.vy[i] = world.vz[i] = 0;
          world.wake(i);
          act('down the hole', `${KIND_NAME[world.kind[i]]} ${i}`);
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
          const i = game.stock.spawnBarrel(game.economy.current(), x, y, KIND_RADIUS[BARREL_KIND] + 0.05);
          if (i >= 0) game.barrels.light(i, between(0.1, 1.5));
          act('barrel', `at ${x.toFixed(1)},${y.toFixed(1)}: slot ${i}`);
        },
      ],
      [
        4,
        () => {
          const e = game.economy;
          e.deposit(Math.floor(between(0, 3000)));
          const offer = pick([...e.offers(), ...e.cosmetics()].filter((o) => o.available));
          const bought = offer ? e.buy(offer.id) : false;
          act('shop', `${offer?.id ?? 'nothing'}: ${bought ? 'bought' : 'not'}`);
        },
      ],
      [
        3,
        () => {
          game.economy.open();
          act('open', `the next room: ${game.economy.save.areas.map(Number).join('')}`);
        },
      ],
      [
        3,
        () => {
          const e = game.economy;
          const next = e.next();
          if (next === null || !e.nextOpen()) return;
          const [sx, sy] = sealPoint(cave, next);
          const [dx, dy] = WINGS[next].dir;
          Object.assign(game.dozer, { x: sx + dx * 4, y: sy + dy * 4, speed: 0 });
          act('go on', `into ${AREAS[next].name}`);
        },
      ],
      [
        2,
        () => {
          const k = pick(SECRETS.map((s, k) => (inReach(s.area) ? k : -1)).filter((k) => k >= 0));
          if (k === undefined) return;
          game.economy.reveal(k);
          act('reveal', `chamber ${k}`);
        },
      ],
      [
        3,
        () => {
          const w = pick(WALLS.map((wall, w) => (inReach(wall.area) ? w : -1)).filter((w) => w >= 0));
          if (w === undefined) return;
          const damage = Math.floor(between(1, 300));
          game.economy.hitWall(w, damage);
          act('hit wall', `${w} for ${damage}`);
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
          store = memoryStore(json);
          game = new Game(new Economy(store), events, cave);
          const after = game.economy.save;
          const same = (['bank', 'room', 'done', 'drones', 'body'] as const).filter((k) => before[k] !== after[k]);
          const sameLists = (['areas', 'secrets', 'walls', 'lampsBroken', 'belts'] as const).filter(
            (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
          );
          const problems = [...same, ...sameLists].map(
            (k) => `reload: ${k} was ${JSON.stringify(before[k])}, came back ${JSON.stringify(after[k])}`,
          );
          if (game.stock.kinds[BARREL_KIND] !== barrels)
            problems.push(`reload: ${barrels} barrels came back ${game.stock.kinds[BARREL_KIND]}`);
          // what was left of every room, chamber, side room and wall comes back exactly, bar what there is no room to draw
          const was = JSON.parse(json) as { left: number[][] };
          game.stock.left.forEach((kinds, source) =>
            kinds.forEach((n, kind) => {
              const had = was.left[source]?.[kind] ?? 0;
              const full = game.stock.kinds[kind] >= (KIND_CAPACITY[kind] || Infinity);
              if (n !== had && !(full && n < had))
                problems.push(`reload: source ${source} had ${had} ${KIND_NAME[kind]}, came back ${n}`);
            }),
          );
          if (problems.length) throw new Reload(problems);
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
      game.step(DT, drive);
      if (acted || frame % CHECK_EVERY === 0) {
        const problems = checkInvariants(game);
        if (problems.length) return fail(problems);
      }
    }
    return { seed, frames, failure: null, done, happened };
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
