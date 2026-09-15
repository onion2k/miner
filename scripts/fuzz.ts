/**
 * The monkey, over many seeds side by side: see `fuzzer.ts`.
 *
 *   npm run fuzz                         seeds 1-12, 4000 frames each
 *   npm run fuzz -- --seeds 1-50 --frames 10000
 *   npm run fuzz -- --seed 17            one seed again, with what was done before it went wrong
 *
 * Fails, and says how to play the failure again, if any seed breaks a rule
 * or throws. Says how much of each thing was done and happened, so a monkey
 * that stopped getting about is noticed.
 */
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fuzz, type FuzzResult } from './fuzzer';

if (!isMainThread) {
  const { seed, frames } = workerData as { seed: number; frames: number };
  parentPort!.postMessage(fuzz(seed, frames));
} else {
  await main();
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const one = value('seed');
  const range = (value('seeds') ?? '1-12').split('-').map(Number);
  const seeds = one !== undefined ? [+one] : Array.from({ length: range[1] - range[0] + 1 }, (_, k) => range[0] + k);
  const frames = +(value('frames') ?? 4000);
  const started = performance.now();
  const queue = [...seeds];
  const results: FuzzResult[] = [];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(seeds.length, availableParallelism() - 1)) }, async () => {
      for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) {
        results.push(
          await new Promise<FuzzResult>((resolve, reject) => {
            const worker = new Worker(new URL(`file://${process.argv[1]}`), { workerData: { seed, frames } });
            worker.once('message', resolve);
            worker.once('error', reject);
          }),
        );
      }
    }),
  );
  results.sort((a, b) => a.seed - b.seed);
  const sum = (key: 'done' | 'happened') => {
    const out: Record<string, number> = {};
    for (const r of results) for (const [k, n] of Object.entries(r[key])) out[k] = (out[k] ?? 0) + n;
    return Object.entries(out)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
  };
  const failed = results.filter((r) => r.failure);
  console.log(
    `${seeds.length} seed${seeds.length === 1 ? '' : 's'}, ${frames} frames each (${((performance.now() - started) / 1000).toFixed(1)} s)`,
  );
  console.log(`  done: ${sum('done')}`);
  console.log(`  happened: ${sum('happened')}`);
  for (const r of failed) {
    const f = r.failure!;
    console.error(`\nseed ${f.seed} failed at frame ${f.frame}:`);
    for (const p of f.problems) console.error(`  ${p}`);
    console.error('  after:');
    for (const l of f.log) console.error(`    ${l}`);
    console.error(`  again: npm run fuzz -- --seed ${f.seed} --frames ${frames}`);
  }
  if (failed.length) process.exitCode = 1;
  else console.log('  no rule broken');
}
