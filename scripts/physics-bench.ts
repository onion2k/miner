/**
 * How long the physics takes a frame, held to what it took before.
 *
 *   npm run bench              measure, and fail if any scenario has got slower by more than the tolerance
 *   npm run bench -- --update  write what it takes now as the new baseline
 *
 * Three scenarios, each from a seed, over the whole cave with every room's
 * heaps in it: the cave at rest, which is what most frames are; blades and
 * belts churning the heaps, which is what a busy frame is; and a heap
 * falling into the hollow all at once, which is the worst a frame gets.
 *
 * A time on one machine is not a time on another, or on the same one with
 * something else running. So each scenario is run several times, fresh, in a
 * worker of its own, and the fastest run is the one that counts: noise only
 * ever makes a run slower. And it is held to the baseline as a multiple of a
 * fixed piece of arithmetic timed alongside it, which goes faster and slower
 * with the machine much as the physics does, so a baseline written on one
 * machine means something on another. The milliseconds are reported too.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { AREAS, BODY_CAPACITY, HOLE, buildCave, type Heap } from '../src/cave';
import { makeWorld, type Pusher, type World } from '../src/physics';

const BASELINE = 'scripts/bench-baseline.json';
/**
 * How much slower than the baseline before it fails: a share of it, and at
 * least an absolute amount, so a scenario that costs next to nothing is not
 * failed for a hundredth of a millisecond of noise.
 */
const TOLERANCE = 0.2,
  SLACK_MS = 0.05;
const RUNS = 4;
const DT = 1 / 60;

interface Result {
  /** Milliseconds a frame, the fastest run. */
  ms: number;
  /** That against the reference arithmetic. */
  relative: number;
  /** Milliseconds the reference took, the fastest time. */
  ref: number;
  /** How many bodies were awake at the end, to show the scenario did what it says. */
  awake: number;
  live: number;
}

interface Scenario {
  name: string;
  frames: number;
  /** The world as the timing starts, and what to do before each timed frame. */
  setup: () => { world: World; before: (frame: number) => void };
}

function seeded(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Every room open and every heap dropped as the game drops them, settled. */
function cave(settle = true): World {
  seeded(1);
  const world = makeWorld(BODY_CAPACITY, buildCave().solid(AREAS.map(() => true)));
  const drop = (h: Heap) => {
    const R = Math.sqrt(h.coins) * 0.36 + 1.5,
      H = Math.sqrt(h.coins) * 0.3 + 1.5;
    const one = (kind: number) => {
      const z = 1 + Math.random() * H;
      const rr = R * (1 - z / (H + 2)) * Math.sqrt(Math.random()),
        a = Math.random() * Math.PI * 2;
      world.spawn(kind, h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, z);
    };
    for (let k = 0; k < h.coins; k++) one(0);
    for (const [kind, n] of h.gems) for (let k = 0; k < n; k++) one(kind);
  };
  for (const area of AREAS) for (const h of area.heaps) drop(h);
  if (settle) for (let f = 0; f < 420; f++) world.step(DT, () => {});
  return world;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'cave at rest',
    frames: 600,
    setup: () => ({ world: cave(), before: () => {} }),
  },
  {
    name: 'blades and belts through the heaps',
    frames: 600,
    setup: () => {
      const world = cave();
      // a blade and a hull on a circle through a heap in each room, as four machines would push
      const heaps = AREAS.map((a) => a.heaps[0]);
      const pushers: Pusher[] = heaps.flatMap((_, owner) => [0, 1].map(() => pusher(owner)));
      world.belts = AREAS.filter((a) => a.belt).map((a) => {
        const s = a.belt!.spec;
        const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
        return {
          cx: (s.x0 + s.x1) / 2,
          cy: (s.y0 + s.y1) / 2,
          half: len / 2,
          width: s.width,
          dx: (s.x1 - s.x0) / len,
          dy: (s.y1 - s.y0) / len,
          speed: 9,
        };
      });
      world.pushers = pushers;
      return {
        world,
        before: (frame) => {
          heaps.forEach((h, owner) => {
            const a = frame * DT * (0.5 + owner * 0.1),
              radius = 6 + owner;
            const x = h.x + Math.cos(a) * radius,
              y = h.y + Math.sin(a) * radius,
              yaw = a + Math.PI / 2;
            for (let k = 0; k < 2; k++) {
              const p = pushers[owner * 2 + k];
              const off = k === 0 ? 3.5 : 0;
              const nx = x + Math.cos(yaw) * off,
                ny = y + Math.sin(yaw) * off;
              p.px = frame ? p.x : nx;
              p.py = frame ? p.y : ny;
              p.vx = frame ? (nx - p.x) / DT : 0;
              p.vy = frame ? (ny - p.y) / DT : 0;
              p.x = nx;
              p.y = ny;
              p.yaw = yaw;
              p.spin = 0.5 + owner * 0.1;
              p.hy = k === 0 ? 4 : 2.5;
            }
            world.wakeNear(x + Math.cos(yaw) * 5, y + Math.sin(yaw) * 5, 6);
          });
        },
      };
    },
  },
  {
    name: 'a heap falling all at once',
    frames: 240,
    setup: () => {
      seeded(2);
      const world = makeWorld(BODY_CAPACITY, buildCave().solid(AREAS.map(() => true)));
      for (let k = 0; k < 4000; k++) {
        const r = Math.sqrt(Math.random()) * 14,
          a = Math.random() * Math.PI * 2;
        world.spawn(0, HOLE.x - 26 + Math.cos(a) * r, HOLE.y + 12 + Math.sin(a) * r, 2 + Math.random() * 18);
      }
      return { world, before: () => {} };
    },
  },
];

function pusher(owner: number): Pusher {
  return { x: 0, y: 0, z: 1.2, yaw: 0, hx: 0.4, hy: 4, hz: 1.2, vx: 0, vy: 0, spin: 0, px: 0, py: 0, owner };
}

/**
 * The reference: typed-array arithmetic of the physics' own kind, a pass of
 * springs over a grid of points, the same work every time.
 */
function reference(): number {
  const n = 200_000;
  const x = new Float32Array(n),
    v = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.37) * 3;
  const t = performance.now();
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 1; i < n - 1; i++) {
      const f = x[i - 1] + x[i + 1] - 2 * x[i];
      v[i] = v[i] * 0.99 + f * 0.1;
    }
    for (let i = 0; i < n; i++) x[i] += Math.sqrt(v[i] * v[i] + 1e-6) * Math.sign(v[i]) * 0.01;
  }
  return performance.now() - t;
}

function measure(s: Scenario): Result {
  const random = Math.random;
  let best = Infinity,
    ref = Infinity,
    awake = 0,
    live = 0;
  // the reference warmed up first, and timed more often than the physics: it is the shorter, and the noisier
  for (let k = 0; k < 3; k++) reference();
  for (let k = 0; k < RUNS * 3; k++) ref = Math.min(ref, reference());
  for (let run = 0; run < RUNS; run++) {
    const { world, before } = s.setup();
    const t = performance.now();
    for (let f = 0; f < s.frames; f++) {
      before(f);
      world.step(DT, () => {});
    }
    best = Math.min(best, (performance.now() - t) / s.frames);
    awake = 0;
    for (let i = 0; i < world.count; i++) if (world.alive[i] && !world.asleep[i]) awake++;
    live = world.live;
  }
  Math.random = random;
  return { ms: best, relative: best / ref, ref, awake, live };
}

if (!isMainThread) {
  const { index } = workerData as { index: number };
  parentPort!.postMessage(measure(SCENARIOS[index]));
} else {
  await main();
}

async function main() {
  const update = process.argv.includes('--update');
  const results: Result[] = [];
  // one at a time, so no scenario is timed while another runs beside it
  for (let index = 0; index < SCENARIOS.length; index++) {
    results.push(
      await new Promise<Result>((resolve, reject) => {
        const worker = new Worker(new URL(`file://${process.argv[1]}`), { workerData: { index } });
        worker.once('message', resolve);
        worker.once('error', reject);
      }),
    );
  }

  if (update) {
    const out = Object.fromEntries(
      SCENARIOS.map((s, k) => [
        s.name,
        { relative: results[k].relative, ms: round(results[k].ms), ref: round(results[k].ref) },
      ]),
    );
    writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    SCENARIOS.forEach((s, k) => console.log(`${s.name}: ${line(results[k])}`));
    console.log('baseline written');
    return;
  }

  let baseline: Partial<Record<string, { relative: number; ms: number }>>;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as typeof baseline;
  } catch {
    console.error('no baseline: run npm run bench -- --update first');
    process.exitCode = 1;
    return;
  }
  let slower = 0;
  SCENARIOS.forEach((s, k) => {
    const now = results[k],
      was = baseline[s.name];
    if (!was) {
      console.log(`${s.name}: ${line(now)}, not in the baseline`);
      slower++;
      return;
    }
    const change = now.relative / was.relative - 1;
    // what the baseline's time comes to on this machine as it is now, for the absolute allowance
    const expected = was.relative * now.ref;
    const verdict =
      change > TOLERANCE && now.ms - expected > SLACK_MS
        ? 'SLOWER'
        : change < -TOLERANCE && expected - now.ms > SLACK_MS
          ? 'faster'
          : 'within tolerance';
    if (verdict === 'SLOWER') slower++;
    console.log(
      `${s.name}: ${line(now)}, ${change >= 0 ? '+' : ''}${(change * 100).toFixed(0)}% on the baseline (${verdict})`,
    );
  });
  if (slower) {
    console.error(
      `\n${slower} scenario${slower === 1 ? '' : 's'} slower than the baseline by more than ${TOLERANCE * 100}% and ${SLACK_MS} ms`,
    );
    process.exitCode = 1;
  }
}

function line(r: Result): string {
  return `${r.ms.toFixed(3)} ms a frame (${r.relative.toPrecision(3)} of the reference), ${r.awake} of ${r.live} awake`;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
