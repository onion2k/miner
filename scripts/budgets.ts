/**
 * What building a cave costs, held to what it cost before: the work the swap into a cave does that can be
 * timed without a page, and the size of what it makes.
 *
 *   npm run budgets              measure, and fail if any figure is over its baseline
 *   npm run budgets -- --update  write what it is now as the new baseline
 *   npm run budgets -- --wobble N  measure N times over and print each figure's spread, for setting an allowance
 *
 * Per cave of the run:
 *
 * - the terrain's vertex count, held exactly: it is what the page uploads and draws, and it is the same
 *   every build, so any change in it is a change somebody made, and the baseline is written again with the
 *   commit that made it;
 * - the terrain's build time (the surface and what is stood on it), and the cave's own build time (carving,
 *   lamps and barrels: `placeBarrels` scans every tile against every lamp and heap);
 *
 * and the nav's rebuild time in the biggest cave, which is what a wall coming down or the way out opening
 * costs in the middle of a frame.
 *
 * Times are held as the judge says (`judge.ts`): the fastest of several runs, as a multiple of the
 * reference arithmetic timed beside it, with the tolerance and slack below. The smoke gates in
 * `smoke/budgets.spec.ts` hold the swap in the page and the frame.
 *
 * The baseline is the median of five whole runs, not the luckiest: a baseline written on a lucky run
 * fails the next ordinary one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCave } from '../src/cave';
import { RUN } from '../src/caves';
import { biomeStyle, decorate } from '../src/biomes';
import { Nav } from '../src/nav';
import { buildTerrain } from '../src/terrain';
import { judge, type Timed } from './judge';
import { reference } from './reference';

const BASELINE = 'scripts/budgets-baseline.json';
/**
 * How much over its baseline a time may be, as a share and as milliseconds, before it fails. Both must be
 * passed. Set from the wobble of each figure's ratio to the reference over twelve whole runs on the six
 * caves as they were before the Deep (`--wobble 12`), on a machine with another session's browsers running,
 * the highest against the lowest:
 *
 * - terrain: 11% to 49% (the small caves, which take 20 ms, the widest; the big ones 11% to 32%);
 * - build: 14% to 215% (a cave that builds in a millisecond or two is all timer and scheduler, which is
 *   what the slack is for; the ones that take 5 to 15 ms, 14% to 29%);
 * - nav: 9%.
 *
 * So terrain and build are allowed half as much again, past 15 ms and 3 ms, and nav a third, past 1 ms.
 * What they have to catch is a change in kind, a scan made to go twice round or a pass made quadratic,
 * which is a doubling or more.
 */
const TOLERANCE = { terrain: 0.5, build: 0.5, nav: 0.3 },
  SLACK_MS = { terrain: 15, build: 3, nav: 1 };
/** Runs of each, the fastest kept: noise only ever makes one slower. */
const RUNS = { terrain: 5, build: 7, nav: 40 };

interface Figures {
  vertices: number;
  terrain: Timed;
  build: Timed;
}

/** Fastest of `runs` goes of `fn`, in milliseconds, and its last result. */
function fastest<T>(runs: number, fn: () => T): { ms: number; out: T } {
  let ms = Infinity,
    out!: T;
  for (let k = 0; k < runs; k++) {
    const t = performance.now();
    out = fn();
    ms = Math.min(ms, performance.now() - t);
  }
  return { ms, out };
}

/** The reference arithmetic, warmed up, and the fastest time taken. */
function referenceMs(): number {
  for (let k = 0; k < 2; k++) reference();
  let ms = Infinity;
  for (let k = 0; k < 6; k++) ms = Math.min(ms, reference());
  return ms;
}

function measureCave(id: string): Figures {
  const spec = RUN.find((c) => c.id === id)!;
  const build = fastest(RUNS.build, () => buildCave(spec));
  const cave = build.out;
  const revealed = spec.secrets.map(() => false);
  const terrain = fastest(RUNS.terrain, () => {
    const built = buildTerrain(cave, revealed, biomeStyle(spec), false);
    decorate(spec, built.samples);
    return built;
  });
  let vertices = 0;
  for (const g of terrain.out.groups) vertices += g.mesh.positions.length / 3;
  return {
    vertices,
    terrain: { ms: terrain.ms, ref: referenceMs() },
    build: { ms: build.ms, ref: referenceMs() },
  };
}

/** The cave with the most tiles: where a nav rebuild costs most. */
const BIGGEST = RUN.reduce((big, c) => (c.cols * c.rows > big.cols * big.rows ? c : big));

function measureNav(): Timed & { cave: string } {
  const cave = buildCave(BIGGEST);
  const solid = cave.solid(false);
  const nav = new Nav(solid, cave.grid, cave.holes);
  for (let k = 0; k < 5; k++) nav.rebuild(solid);
  const { ms } = fastest(RUNS.nav, () => nav.rebuild(solid));
  return { cave: BIGGEST.id, ms, ref: referenceMs() };
}

interface Baseline {
  caves: Partial<Record<string, { vertices: number; terrain: number; build: number }>>;
  nav: { cave: string; relative: number };
  /** The milliseconds each was when written, for reading the file and not for holding anything to. */
  ms: Record<string, number>;
}

const rel = (t: Timed) => t.ms / t.ref;
const round = (n: number, places = 6) => Math.round(n * 10 ** places) / 10 ** places;

/** The first build in a process is cold: the code is not yet compiled, and what is timed would be the compiler. */
let warm = false;

function measureAll() {
  if (!warm) {
    warm = true;
    measureCave(RUN[0].id);
  }
  const caves = Object.fromEntries(RUN.map((c) => [c.id, measureCave(c.id)]));
  return { caves, nav: measureNav() };
}

function main() {
  const args = process.argv.slice(2);
  const wobble = args.indexOf('--wobble');
  if (wobble >= 0) return spread(+args[wobble + 1] || 12);
  if (args.includes('--update')) {
    const runs = Array.from({ length: 5 }, measureAll);
    const now = runs[0];
    // the median run's ratio for each figure, and the same vertices every time
    const mid = (pick: (r: ReturnType<typeof measureAll>) => Timed): Timed => {
      const sorted = runs.map(pick).sort((a, b) => rel(a) - rel(b));
      return sorted[sorted.length >> 1];
    };
    for (const id of Object.keys(now.caves)) {
      now.caves[id].terrain = mid((r) => r.caves[id].terrain);
      now.caves[id].build = mid((r) => r.caves[id].build);
    }
    Object.assign(
      now.nav,
      mid((r) => r.nav),
    );
    // The file is shared with the page's gates (`smoke/budgets.spec.ts`), which keep the swap in it; what they
    // wrote is kept, or writing this gate's figures alone would quietly take the swap's baseline away.
    let kept: Record<string, unknown> = {};
    try {
      kept = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, unknown>;
    } catch {
      /* no baseline yet: nothing to keep */
    }
    const out: Baseline & Record<string, unknown> = {
      ...kept,
      caves: Object.fromEntries(
        Object.entries(now.caves).map(([id, f]) => [
          id,
          { vertices: f.vertices, terrain: round(rel(f.terrain)), build: round(rel(f.build)) },
        ]),
      ),
      nav: { cave: now.nav.cave, relative: round(rel(now.nav)) },
      ms: {
        ...Object.fromEntries(
          Object.entries(now.caves).flatMap(([id, f]) => [
            [`${id} terrain`, round(f.terrain.ms, 2)],
            [`${id} build`, round(f.build.ms, 2)],
          ]),
        ),
        [`${now.nav.cave} nav`]: round(now.nav.ms, 2),
      },
    };
    writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`);
    report(now);
    console.log('baseline written');
    return;
  }

  const now = measureAll();
  let was: Baseline;
  try {
    was = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  } catch {
    console.error('no baseline: run npm run budgets -- --update first');
    process.exitCode = 1;
    return;
  }
  let failed = 0;
  const fail = (line: string) => {
    failed++;
    console.log(`FAIL ${line}`);
  };
  for (const [id, f] of Object.entries(now.caves)) {
    const b = was.caves[id];
    if (!b) {
      fail(`${id}: not in the baseline (npm run budgets -- --update, once its figures have been looked at)`);
      continue;
    }
    const v = f.vertices === b.vertices ? 'as held' : `was ${b.vertices}`;
    if (f.vertices !== b.vertices) fail(`${id}: ${f.vertices} terrain vertices, ${v}: held exactly`);
    else console.log(`${id}: ${f.vertices} terrain vertices (${v})`);
    for (const [what, t, base, slack] of [
      ['terrain', f.terrain, b.terrain, SLACK_MS.terrain],
      ['build', f.build, b.build, SLACK_MS.build],
    ] as const) {
      const verdict = judge(t, base, TOLERANCE[what], slack);
      const line = `${id}: ${what} ${t.ms.toFixed(1)} ms, ${pct(rel(t) / base)} on the baseline (${verdict})`;
      if (verdict === 'SLOWER') fail(line);
      else console.log(line);
    }
  }
  {
    const id = now.nav.cave;
    const verdict = judge(now.nav, was.nav.relative, TOLERANCE.nav, SLACK_MS.nav);
    const line = `${id}: nav rebuild ${now.nav.ms.toFixed(2)} ms, ${pct(rel(now.nav) / was.nav.relative)} on the baseline (${verdict})`;
    if (verdict === 'SLOWER') fail(line);
    else console.log(line);
    if (was.nav.cave !== now.nav.cave) fail(`the biggest cave is ${now.nav.cave}, the baseline's is ${was.nav.cave}`);
  }
  if (failed) {
    console.error(`\n${failed} budget${failed === 1 ? '' : 's'} over`);
    process.exitCode = 1;
  }
}

function pct(ratio: number): string {
  return `${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%`;
}

function report(now: ReturnType<typeof measureAll>) {
  for (const [id, f] of Object.entries(now.caves))
    console.log(
      `${id}: ${f.vertices} vertices, terrain ${f.terrain.ms.toFixed(1)} ms, build ${f.build.ms.toFixed(1)} ms`,
    );
  console.log(`${now.nav.cave}: nav rebuild ${now.nav.ms.toFixed(2)} ms`);
}

/** The whole measurement `n` times over, and how far each time's ratio to the reference strayed: for setting an allowance. */
function spread(n: number) {
  const series: Record<string, number[]> = {};
  const note = (key: string, t: Timed) => (series[key] ??= []).push(rel(t));
  for (let k = 0; k < n; k++) {
    const now = measureAll();
    for (const [id, f] of Object.entries(now.caves)) {
      note(`${id} terrain`, f.terrain);
      note(`${id} build`, f.build);
    }
    note(`${now.nav.cave} nav`, now.nav);
  }
  for (const [key, values] of Object.entries(series)) {
    const lo = Math.min(...values),
      hi = Math.max(...values),
      mid = values.reduce((a, b) => a + b, 0) / values.length;
    console.log(
      `${key}: ratio to the reference ${lo.toPrecision(3)} to ${hi.toPrecision(3)}, mean ${mid.toPrecision(3)}, widest ${((hi / lo - 1) * 100).toFixed(0)}% lowest to highest, ${((hi / mid - 1) * 100).toFixed(0)}% over the mean`,
    );
  }
}

main();
