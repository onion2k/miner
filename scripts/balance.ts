/**
 * The whole game played through by the autopilot over many seeds side by
 * side, and how it paced: see `balancer.ts`.
 *
 *   npm run balance                              thorough and rusher, seeds 1-6, the whole cave
 *   npm run balance -- --profile thorough --seeds 1-12
 *   npm run balance -- --rooms 2 --cap 30        the first two rooms only, giving up at 30 game minutes
 *   npm run balance -- --purchases --json runs.json   and every purchase, and every run written out
 *   npm run balance:check                        the first two rooms held to balance-baseline.json
 *   npm run balance:check -- --update            what they do now written as the new baseline
 *
 * Reports, for each way of playing, the minutes each room took, the whole
 * game, when the workshop's purchases came and how far apart, and what was
 * banked, spent and left in the bank. Fails if any seed broke a rule, threw,
 * or got stuck.
 *
 * The check is for a change that was not meant to change the pacing: a
 * shorter game, from the same seeds, of the Hollow and the South Gallery,
 * each way of playing, held to the baseline within a tolerance either way —
 * quicker is as much a change to the balance as slower. A change meant to
 * move it updates the baseline, and says why.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { Profile } from '../src/autopilot';
import { playThrough, type PlayOptions, type PlayRun } from './balancer';

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN;
}

/** Every run asked for, side by side. */
export async function runAll(jobs: PlayOptions[]): Promise<PlayRun[]> {
  const queue = [...jobs];
  const results: PlayRun[] = [];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(jobs.length, availableParallelism() - 1)) }, async () => {
      for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
        const at = job;
        results.push(
          await new Promise<PlayRun>((resolve, reject) => {
            const worker = new Worker(new URL(`file://${process.argv[1]}`), { workerData: at });
            worker.once('message', resolve);
            worker.once('error', reject);
          }),
        );
      }
    }),
  );
  return results.sort((a, b) => a.profile.localeCompare(b.profile) || a.seed - b.seed);
}

/** How a way of playing paced, over its seeds, as lines to print. */
export function report(runs: PlayRun[]): string[] {
  const out: string[] = [];
  const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '-');
  const most = runs.reduce((m, r) => Math.max(m, r.rooms.length), 0);
  const rooms = Array.from({ length: most }, (_, k) => {
    const times = runs.flatMap((r) => (r.rooms[k] ? [r.rooms[k].minutes] : []));
    const banked = runs.flatMap((r) => (r.rooms[k] ? [r.rooms[k].banked] : []));
    return `${runs.find((r) => r.rooms[k])!.rooms[k].name} ${f(median(times))} min (${f(Math.min(...times))}-${f(Math.max(...times))}), banks ${f(mean(banked), 0)}`;
  });
  const finished = runs.filter((r) => r.finished);
  const minutes = finished.map((r) => r.minutes);
  out.push(
    `${runs[0].profile}: ${finished.length}/${runs.length} finished, ${f(median(minutes))} min (${f(Math.min(...minutes))}-${f(Math.max(...minutes))})`,
  );
  out.push(`  rooms: ${rooms.join('; ')}`);
  // the gaps between purchases, over the game: steady is gaps much the same all through
  const gaps = runs.flatMap((r) => r.purchases.slice(1).map((p, k) => p.minute - r.purchases[k].minute));
  const bought = runs.map((r) => r.purchases.length);
  const thirds = [0, 1, 2].map((k) =>
    mean(
      runs.map(
        (r) =>
          r.purchases.filter((p) => p.minute >= (r.minutes * k) / 3 && p.minute < (r.minutes * (k + 1)) / 3).length,
      ),
    ),
  );
  out.push(
    `  purchases: ${f(mean(bought))} (${f((mean(runs.map((r) => r.spent)) / runs[0].workshop) * 100, 0)}% of the workshop), a thing every ${f(median(gaps))} min, longest wait ${f(mean(runs.map((r) => Math.max(0, ...r.purchases.slice(1).map((p, k) => p.minute - r.purchases[k].minute)))))} min; by thirds of the game ${thirds.map((n) => f(n)).join(' / ')}`,
  );
  out.push(
    `  banked ${f(mean(runs.map((r) => r.banked)), 0)}, spent ${f(mean(runs.map((r) => r.spent)), 0)}, left in the bank ${f(mean(runs.map((r) => r.banked - r.spent)), 0)}; chambers ${f(mean(runs.map((r) => r.chambers)))}, walls ${f(mean(runs.map((r) => r.walls)))}`,
  );
  out.push(`  last bought: ${runs.map((r) => r.purchases.at(-1)?.id ?? '-').join(', ')}`);
  return out;
}

const BASELINE = 'scripts/balance-baseline.json';
const CHECK = { seeds: [1, 2, 3, 4, 5, 6], rooms: 2, capMinutes: 60 };
/** How far each figure may move from the baseline, as a share of it, before the check fails. */
const TOLERANCE = { minutes: 0.2, banked: 0.15, purchases: 0.2 };

type Figures = Record<string, number>;

/** The figures the check holds, for a way of playing: the median minutes each room took, and the mean banked and bought. */
function figures(runs: PlayRun[]): Figures {
  const out: Figures = {};
  for (let k = 0; k < CHECK.rooms; k++) {
    const times = runs.map((r) => r.rooms[k]?.minutes ?? CHECK.capMinutes);
    out[`room ${k + 1} minutes`] = Math.round(median(times) * 100) / 100;
  }
  out.banked = Math.round(mean(runs.map((r) => r.banked)));
  out.purchases = Math.round(mean(runs.map((r) => r.purchases.length)) * 100) / 100;
  return out;
}

async function check(update: boolean) {
  const started = performance.now();
  const profiles: Profile[] = ['thorough', 'rusher'];
  const runs = await runAll(
    profiles.flatMap((profile) =>
      CHECK.seeds.map((seed) => ({ seed, profile, rooms: CHECK.rooms, capMinutes: CHECK.capMinutes })),
    ),
  );
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const now = Object.fromEntries(profiles.map((p) => [p, figures(runs.filter((r) => r.profile === p))]));
  const problems = runs.flatMap((r) => [
    ...r.problems,
    ...(r.finished
      ? []
      : [`${r.profile} seed ${r.seed}: did not get through ${CHECK.rooms} rooms in ${CHECK.capMinutes} min`]),
  ]);
  if (update) {
    if (problems.length) {
      for (const p of problems) console.error(`  ${p}`);
      console.error('not written: fix these first');
      process.exitCode = 1;
      return;
    }
    writeFileSync(BASELINE, `${JSON.stringify(now, null, 2)}\n`);
    console.log(`balance baseline written (${seconds} s)`);
    return;
  }
  let baseline: Partial<Record<string, Partial<Figures>>>;
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Partial<Record<string, Partial<Figures>>>;
  } catch {
    console.error('no baseline: run npm run balance:check -- --update first');
    process.exitCode = 1;
    return;
  }
  let moved = 0;
  for (const profile of profiles) {
    const notes = Object.entries(now[profile]).map(([key, b]) => {
      const a = baseline[profile]?.[key];
      if (a === undefined) {
        moved++;
        return `${key} ${b} (not in the baseline)`;
      }
      if (a === b) return null;
      const share = key.endsWith('minutes')
        ? TOLERANCE.minutes
        : key === 'banked'
          ? TOLERANCE.banked
          : TOLERANCE.purchases;
      const out = Math.abs(b - a) > Math.abs(a) * share;
      if (out) moved++;
      return `${key} ${a} -> ${b} (${out ? 'MOVED' : 'within tolerance'})`;
    });
    const said = notes.filter(Boolean);
    console.log(`balance, ${profile}: ${said.length ? said.join(', ') : 'unchanged'}`);
  }
  console.log(`(${seconds} s)`);
  for (const p of problems) console.error(`  ${p}`);
  if (moved || problems.length) {
    if (moved)
      console.error(
        `\nthe pacing moved beyond tolerance: if that was meant, npm run balance:check -- --update, and say why`,
      );
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) return check(args.includes('--update'));
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const range = (value('seeds') ?? '1-6').split('-').map(Number);
  const seeds = Array.from({ length: (range[1] ?? range[0]) - range[0] + 1 }, (_, k) => range[0] + k);
  const profiles = (value('profile') ? [value('profile')] : ['thorough', 'rusher']) as Profile[];
  const rooms = value('rooms') !== undefined ? +value('rooms')! : undefined;
  const capMinutes = +(value('cap') ?? 90);
  const started = performance.now();
  const runs = await runAll(profiles.flatMap((profile) => seeds.map((seed) => ({ seed, profile, rooms, capMinutes }))));
  console.log(`${runs.length} play-throughs (${((performance.now() - started) / 1000).toFixed(1)} s)`);
  for (const profile of profiles)
    for (const line of report(runs.filter((r) => r.profile === profile))) console.log(line);
  if (args.includes('--purchases'))
    for (const r of runs)
      console.log(`  ${r.profile} ${r.seed}: ${r.purchases.map((p) => `${p.minute.toFixed(1)} ${p.id}`).join(', ')}`);
  const json = value('json');
  if (json) writeFileSync(json, JSON.stringify(runs));
  const problems = runs.flatMap((r) => r.problems);
  for (const p of problems) console.error(`  ${p}`);
  if (problems.length) process.exitCode = 1;
}

if (!isMainThread) {
  parentPort!.postMessage(playThrough(workerData as PlayOptions));
} else {
  await main();
}
