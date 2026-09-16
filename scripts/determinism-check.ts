/**
 * Every seed played twice, side by side: see `determinism.ts`.
 *
 *   npm run determinism                      seeds 1-6, 3600 frames each
 *   npm run determinism -- --seeds 1-12 --frames 7200 --every 600
 *
 * Fails, and says at which frame, if any seed does not play out the same way
 * twice. A failure is not in the feature that was just written: it is chance
 * from somewhere other than the seed, or state left over between runs.
 */
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { playTwice, type TwiceOptions, type TwiceResult } from './determinism';

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const range = (value('seeds') ?? '1-6').split('-').map(Number);
  const seeds = Array.from({ length: (range[1] ?? range[0]) - range[0] + 1 }, (_, k) => range[0] + k);
  const frames = +(value('frames') ?? 3600);
  const every = +(value('every') ?? 300);
  const started = performance.now();
  const queue: TwiceOptions[] = seeds.map((seed) => ({ seed, frames, every }));
  const results: TwiceResult[] = [];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(seeds.length, availableParallelism() - 1)) }, async () => {
      for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
        const at = job;
        results.push(
          await new Promise<TwiceResult>((resolve, reject) => {
            const worker = new Worker(new URL(`file://${process.argv[1]}`), { workerData: at });
            worker.once('message', resolve);
            worker.once('error', reject);
          }),
        );
      }
    }),
  );
  results.sort((a, b) => a.seed - b.seed);
  const parted = results.filter((r) => r.diverged !== null);
  console.log(
    `${seeds.length} seed${seeds.length === 1 ? '' : 's'}, played twice, ${frames} frames each (${((performance.now() - started) / 1000).toFixed(1)} s)`,
  );
  for (const r of parted) console.error(`  ${r.note}`);
  if (parted.length) {
    console.error(
      `\n${parted.length} seed${parted.length === 1 ? ' does' : 's do'} not play out the same twice: look for chance taken from somewhere other than Math.random, state kept in a module between runs, or an order that is not the same twice`,
    );
    process.exitCode = 1;
  } else {
    console.log(`  the same twice, every seed (${results[0].checkpoints.length} checkpoints each)`);
  }
}

if (!isMainThread) {
  parentPort!.postMessage(playTwice(workerData as TwiceOptions));
} else {
  await main();
}
