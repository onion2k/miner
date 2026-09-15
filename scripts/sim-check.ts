/**
 * The drones held to what they did before: a fixed set of scenarios, eight
 * seeds each, run side by side, and each one's means set against the
 * baseline in sim-baseline.json.
 *
 *   npm run sim:check              fail if any scenario has got worse by more than its tolerance
 *   npm run sim:check -- --update  write what they do now as the new baseline
 *
 * A run is the same from the same seed, so a change to the physics, the cave
 * or the drones shows up as a change in the figures. Getting better passes,
 * and says so; the baseline wants updating then, so the next change is held
 * to the better figures. Getting worse fails.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { SIM_DEFAULTS, meanOf, simulate, type SimOptions, type SimRow } from './simulate';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** Beside this script in the source, found from where npm runs it: the package's root. */
const BASELINE = 'scripts/sim-baseline.json';

interface Scenario {
  name: string;
  options: Partial<SimOptions>;
}

const SCENARIOS: Scenario[] = [
  { name: 'south', options: { room: 1 } },
  { name: 'north', options: { room: 2 } },
  { name: 'east with belt', options: { room: 3, belt: true } },
  { name: 'west with belt', options: { room: 4, belt: true } },
  { name: 'south, player patrolling', options: { room: 1, patrol: true } },
  { name: 'north, chamber open', options: { room: 2, secret: true } },
];

/**
 * What is held to the baseline, and how far each may slip before it fails: a
 * share of the baseline for what should be high, and for what should be low
 * a share or an absolute allowance, whichever is the more generous, so a
 * figure near nothing is not failed for a fraction.
 */
const HELD: { key: keyof SimRow; better: 'higher' | 'lower'; share: number; slack?: number }[] = [
  { key: 'banked', better: 'higher', share: 0.05 },
  { key: 'lost', better: 'lower', share: 0.25, slack: 1 },
  { key: 'touching', better: 'lower', share: 0.25, slack: 2 },
  { key: 'held', better: 'lower', share: 0.25, slack: 2 },
  { key: 'blocked', better: 'lower', share: 0.25, slack: 2 },
  { key: 'barsOut', better: 'higher', share: 0.1 },
];

type Means = Partial<Record<string, number>>;

if (!isMainThread) {
  const { options } = workerData as { options: SimOptions };
  const mean = meanOf(SEEDS.map((seed) => simulate(options, seed)));
  parentPort!.postMessage(Object.fromEntries(HELD.map(({ key }) => [key, mean[key]])));
} else {
  await main();
}

async function main() {
  const update = process.argv.includes('--update');
  const started = performance.now();
  const limit = Math.max(1, Math.min(SCENARIOS.length, availableParallelism() - 1));
  const results = new Map<string, Means>();
  const queue = [...SCENARIOS];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const options = { ...SIM_DEFAULTS, ...s.options };
        results.set(
          s.name,
          await new Promise<Means>((resolve, reject) => {
            const worker = new Worker(new URL(`file://${process.argv[1]}`), { workerData: { options } });
            worker.once('message', resolve);
            worker.once('error', reject);
          }),
        );
      }
    }),
  );
  const seconds = ((performance.now() - started) / 1000).toFixed(1);

  if (update) {
    const out = Object.fromEntries(SCENARIOS.map((s) => [s.name, round(results.get(s.name)!)]));
    writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`baseline written for ${SCENARIOS.length} scenarios (${seconds} s)`);
    return;
  }

  let baseline: Partial<Record<string, Means>>;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Partial<Record<string, Means>>;
  } catch {
    console.error('no baseline: run npm run sim:check -- --update first');
    process.exitCode = 1;
    return;
  }

  let worse = 0,
    better = 0;
  for (const s of SCENARIOS) {
    const now = round(results.get(s.name)!),
      was = baseline[s.name];
    if (!was) {
      console.log(`${s.name}: not in the baseline`);
      worse++;
      continue;
    }
    const notes: string[] = [];
    for (const { key, better: dir, share, slack = 0 } of HELD) {
      const a = was[key],
        b = now[key];
      if (a === undefined || b === undefined || Math.abs(a - b) < 1e-9) continue;
      const allowed = Math.max(Math.abs(a) * share, slack);
      const got = dir === 'higher' ? a - b : b - a;
      const verdict = got > allowed ? 'WORSE' : got < 0 ? 'better' : 'within tolerance';
      if (verdict === 'WORSE') worse++;
      if (verdict === 'better') better++;
      notes.push(`${key} ${fmt(a)} -> ${fmt(b)} (${verdict})`);
    }
    console.log(`${s.name}: ${notes.length ? notes.join(', ') : 'unchanged'}`);
  }
  console.log(`(${seconds} s)`);
  if (worse) {
    console.error(`\n${worse} figure${worse === 1 ? '' : 's'} got worse beyond tolerance`);
    process.exitCode = 1;
  } else if (better) {
    console.log('\nsome figures improved: run npm run sim:check -- --update to hold the next change to them');
  }
}

function round(m: Means): Means {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round((v ?? 0) * 1000) / 1000]));
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
