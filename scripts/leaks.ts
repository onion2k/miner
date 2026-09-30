/**
 * An hour of the game played through, cave after cave, watching the things
 * that must not keep growing: the bodies in the cave and the slots they sit in, the fuses, the
 * rubble, the save, the coins a machine has given up on, the patches swept.
 *
 * A map that is added to and never emptied does not throw, break a rule, or
 * move any gate's figure. It shows up an hour into a game as a machine that
 * has slowed to a crawl, on somebody else's computer. Nothing else here would
 * ever see it: the fuzzer plays 4,000 frames, the drone gate two minutes, and
 * the balance gate stops after two rooms.
 *
 * Every size is held two ways: under a ceiling that says what it could ever
 * reasonably be, and not still climbing by the end — the last third of the run
 * against the middle third, so a size that fills up early and settles is left
 * alone, and one that creeps all the way through is not.
 */
import { Autopilot, PATCH, type Profile } from '../src/autopilot';
import { BODY_CAPACITY, TILE, buildCave, type CaveSpec } from '../src/cave';
import { RUN } from '../src/caves';
import { Economy, memoryStore } from '../src/economy';
import { KIND_CAPACITY, Game } from '../src/game';
import { onward } from './run';

const DT = 1 / 60;

/**
 * What is watched, and how. Every size has a ceiling: what it could ever
 * reasonably be, not a guess at what the game does now, so tuning does not
 * move it and a leak cannot hide under it.
 *
 * `steady` is for the ones that must also not still be climbing at the end:
 * what is remembered and then meant to be forgotten again. What is in the
 * cave rises and falls with each cave, and a cave entered at the end would
 * read as a leak; what is done once a lamp or once a purchase only ever
 * climbs; and what follows how thick with coins a cave is follows the caves.
 * Those are held by their ceilings alone.
 */
/**
 * The most entries the autopilot's map of patches swept can hold: it keeps one for the tile a patch was
 * aimed at, and aims at one patch at a time, so at most one for every patch (`PATCH` across) of the
 * floor it can reach. The biggest cave in the run has the most of those. The map is the autopilot's, which
 * is built afresh with each cave, so nothing is carried from one cave's floor to the next.
 */
export function sweptCeiling(run: readonly CaveSpec[]): number {
  let most = 0;
  for (const spec of run) {
    const cave = buildCave(spec);
    const { cols, originX, originY } = cave.grid;
    const solid = cave.solid(
      true,
      spec.secrets.map(() => true),
      spec.walls.map(() => true),
    );
    const patches = new Set<number>();
    for (let t = 0; t < solid.length; t++) {
      if (solid[t]) continue;
      const x = originX + ((t % cols) + 0.5) * TILE,
        y = originY + (Math.floor(t / cols) + 0.5) * TILE;
      patches.add(Math.floor(x / PATCH) * 100000 + Math.floor(y / PATCH));
    }
    most = Math.max(most, patches.size);
  }
  return most;
}

export const WATCH: Partial<Record<string, { ceiling: number; steady?: boolean }>> = {
  bodies: { ceiling: BODY_CAPACITY },
  slots: { ceiling: BODY_CAPACITY },
  'fuses lit': { ceiling: KIND_CAPACITY[7] || 200 },
  rubble: { ceiling: 4000 },
  'lamps broken': { ceiling: 200 },
  'barrels saved': { ceiling: 400 },
  'save bytes': { ceiling: 200_000 },
  'left rows': { ceiling: 400 },
  bots: { ceiling: 3 },
  fountains: { ceiling: 8 },
  // held by its ceiling alone: it says how thick with coins the cave being cleared is, not how long anything is kept,
  // and the last caves are the biggest
  'shunned coins': { ceiling: 200 },
  // one entry at most for each patch of floor the autopilot can sweep, and a new autopilot is built with every
  // cave, so it is bounded by the floor of the biggest cave: worked out from the run, in `sweptCeiling`
  'patches swept': { ceiling: sweptCeiling(RUN) },
  'pilot log': { ceiling: 400 },
  // the catch-all for what is leaking and has no name here; noisy, so it is given a lot of room
  'heap MB': { ceiling: 600, steady: true },
};

/** Every size worth watching, read off a game as it stands. */
export function sizes(game: Game, pilot?: Autopilot): Record<string, number> {
  const { world, economy } = game;
  game.persist();
  const save = economy.save;
  return {
    bodies: world.live,
    slots: world.count,
    'fuses lit': game.barrels.lit.length,
    rubble: save.rubble.length,
    'lamps broken': save.lampsBroken.length,
    'barrels saved': save.barrels?.length ?? 0,
    'save bytes': JSON.stringify(save).length,
    'left rows': save.left.reduce((n, row) => n + row.length, 0),
    bots: game.bots.length,
    fountains: game.fountains.length,
    // the most any one machine is holding, not the sum: a fleet that grows from one drone to three is not a leak
    'shunned coins': Math.max(0, ...[...game.bots, ...(pilot ? [pilot.machine] : [])].map((b) => b.shunning)),
    'patches swept': pilot?.sweptPatches ?? 0,
    'pilot log': pilot?.log.length ?? 0,
    'heap MB': Math.round(process.memoryUsage().heapUsed / 1e5) / 10,
  };
}

/**
 * Whether a size is still climbing at the end: the last third of the run
 * against the middle third, which leaves alone one that fills up early and
 * settles, and catches one that creeps all the way through. `slack` is what
 * it may drift by without counting, as a share and as a number, so a small
 * size wobbling by one or two is not a leak.
 */
export function grew(series: number[], share = 0.15, slack = 3): boolean {
  if (series.length < 6) return false;
  const third = Math.floor(series.length / 3);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const middle = mean(series.slice(third, third * 2));
  const last = mean(series.slice(-third));
  return last > middle * (1 + share) + slack;
}

/** What is wrong with a run's sizes: over a ceiling, or still growing at the end. */
export function trouble(samples: Record<string, number[]>): string[] {
  const out: string[] = [];
  for (const [key, series] of Object.entries(samples)) {
    const watch = WATCH[key];
    const most = Math.max(...series);
    if (watch && most > watch.ceiling) out.push(`${key} went to ${most}, over its ceiling of ${watch.ceiling}`);
    else if (watch?.steady && grew(series, key === 'heap MB' ? 0.5 : 0.15, key === 'heap MB' ? 20 : 3)) {
      const third = Math.floor(series.length / 3);
      const at = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
      out.push(
        `${key} grew all the way through: ${at(series.slice(0, third))} at the start, ${at(series.slice(third, third * 2))} in the middle, ${at(series.slice(-third))} by the end`,
      );
    }
  }
  return out;
}

export interface LeakOptions {
  seed: number;
  /** Game minutes to play. */
  minutes: number;
  profile?: Profile;
}

export interface LeakRun {
  seed: number;
  minutes: number;
  profile: Profile;
  /** Every size, sampled once a game minute. */
  samples: Record<string, number[]>;
  problems: string[];
  /** Real seconds it took. */
  seconds: number;
}

function seeded(n: number): () => number {
  let s = (n * 2654435761 + 3) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Play a long game, sampling the sizes once a game minute, and say what would not stay bounded. */
export function leakRun({ seed, minutes, profile = 'thorough' }: LeakOptions): LeakRun {
  const started = performance.now();
  const saved = Math.random;
  Math.random = seeded(seed);
  const samples: Record<string, number[]> = {};
  try {
    const economy = new Economy(memoryStore(), RUN);
    let game = new Game(economy, buildCave(economy.cave()));
    let pilot = new Autopilot(game, profile);
    const take = () => {
      for (const [key, n] of Object.entries(sizes(game, pilot))) (samples[key] ??= []).push(n);
    };
    for (let minute = 0; minute < minutes; minute++) {
      for (let f = 0; f < 3600; f++) {
        pilot.step(DT);
        // out through the way out: the cave behind is let go whole, and the next begun
        if (game.left) {
          game = onward(game, economy, RUN);
          pilot = new Autopilot(game, profile);
        }
      }
      take();
    }
    return {
      seed,
      minutes,
      profile,
      samples,
      problems: trouble(samples),
      seconds: (performance.now() - started) / 1000,
    };
  } catch (err) {
    return {
      seed,
      minutes,
      profile,
      samples,
      problems: [`seed ${seed}: threw ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`],
      seconds: (performance.now() - started) / 1000,
    };
  } finally {
    Math.random = saved;
  }
}
