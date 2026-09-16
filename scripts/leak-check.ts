/**
 * Long games played side by side, watching what must stay bounded: see
 * `leaks.ts`.
 *
 *   npm run leaks                              an hour each way, seed 1
 *   npm run leaks -- --minutes 20 --seeds 1-4 --profile rusher
 *   npm run leaks -- --show                    every size, minute by minute
 *
 * In `npm run check` this runs short, twenty minutes each way, which is long
 * enough for the rooms to turn over two or three times. An hour is worth
 * running by hand after anything that keeps a list, a map or a cache.
 */
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { Profile } from '../src/autopilot';
import { leakRun, type LeakOptions, type LeakRun } from './leaks';

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const range = (value('seeds') ?? '1').split('-').map(Number);
  const seeds = Array.from({ length: (range[1] ?? range[0]) - range[0] + 1 }, (_, k) => range[0] + k);
  const minutes = +(value('minutes') ?? 60);
  const profiles = (value('profile') ? [value('profile')] : ['thorough', 'rusher']) as Profile[];
  const started = performance.now();
  const queue: LeakOptions[] = profiles.flatMap((profile) => seeds.map((seed) => ({ seed, minutes, profile })));
  const runs: LeakRun[] = [];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(queue.length, availableParallelism() - 1)) }, async () => {
      for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
        const at = job;
        runs.push(
          await new Promise<LeakRun>((resolve, reject) => {
            const worker = new Worker(new URL(`file://${process.argv[1]}`), { workerData: at });
            worker.once('message', resolve);
            worker.once('error', reject);
          }),
        );
      }
    }),
  );
  runs.sort((a, b) => a.profile.localeCompare(b.profile) || a.seed - b.seed);
  console.log(
    `${runs.length} game${runs.length === 1 ? '' : 's'} of ${minutes} minutes (${((performance.now() - started) / 1000).toFixed(1)} s)`,
  );
  // what each size reached, over every run: the figures to look at when one of them is questioned
  const most: Record<string, number> = {};
  for (const r of runs)
    for (const [key, series] of Object.entries(r.samples)) most[key] = Math.max(most[key] ?? 0, ...series);
  console.log(
    `  most it reached: ${Object.entries(most)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')}`,
  );
  if (args.includes('--show'))
    for (const r of runs) {
      console.log(`  ${r.profile} ${r.seed}:`);
      for (const [key, series] of Object.entries(r.samples)) console.log(`    ${key.padEnd(14)} ${series.join(' ')}`);
    }
  const problems = runs.flatMap((r) => r.problems.map((p) => `${r.profile} seed ${r.seed}: ${p}`));
  for (const p of problems) console.error(`  ${p}`);
  if (problems.length) {
    console.error(
      `\n${problems.length} thing${problems.length === 1 ? '' : 's'} would not stay bounded: something is kept and never let go of, or a ceiling wants raising for a reason worth writing down`,
    );
    process.exitCode = 1;
  } else console.log('  everything stayed bounded');
}

if (!isMainThread) {
  parentPort!.postMessage(leakRun(workerData as LeakOptions));
} else {
  await main();
}
