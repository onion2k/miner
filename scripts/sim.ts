/**
 * The robo-dozers without the picture: the cave, the physics, the machines,
 * the way they find and what they go for, the same code the game runs,
 * stepped as fast as the computer goes. For measuring a change to how the
 * drones work before playing it: one run of the game is too much luck to
 * tell a better drone from a worse one, and eight seeds of this take seconds.
 *
 *   npm run sim                                   the south gallery, three drones, two minutes, seeds 1-8
 *   npm run sim -- --cave east-gallery --belt     the east gallery, with its belt running
 *   npm run sim -- --cave south-gallery --player patrol   the player driving in and out through the drones
 *   npm run sim -- --cave north-vault --secret    the north vault with its hidden chamber broken into
 *   npm run sim -- --cave north-vault --drones 2   the north vault's two holes, two drones
 *   npm run sim -- --drones 1 --seconds 300 --seeds 1-3 --each
 *
 * What it reports, per seed with --each and as a mean:
 *
 *   banked     what went down the hole, and the share of the cave's value that is
 *   pushes     how each push ended: at the hole, on a belt, the load lost, backing up to try again
 *   touching   how often two drones were in each other, sampled ten times a second
 *   held       how much of the time a loaded drone was held up by another drone in front of it
 *   yielding   how much of the time drones were out of another's way rather than working
 *   player     with --player patrol: its mean speed, trips made, and how often a drone blocked it
 *   chamber    with --secret: what came out of the hidden chamber, and how many of its gold bars
 *   hole share the smaller hole's share of what went down, in a cave with more than one
 */
import { RUN } from '../src/caves';
import { SIM_DEFAULTS, meanOf, simulate, type SimRow } from './simulate';

function options() {
  const args = process.argv.slice(2);
  const value = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
  };
  const seedSpec = value('seeds', '1-8');
  const seeds = seedSpec.includes('-')
    ? Array.from(
        { length: +seedSpec.split('-')[1] - +seedSpec.split('-')[0] + 1 },
        (_, k) => +seedSpec.split('-')[0] + k,
      )
    : seedSpec.split(',').map(Number);
  const cave = value('cave', SIM_DEFAULTS.cave);
  if (!RUN.some((c) => c.id === cave)) {
    console.error(`--cave is one of: ${RUN.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }
  return {
    cave,
    seeds,
    drones: +value('drones', String(SIM_DEFAULTS.drones)),
    seconds: +value('seconds', String(SIM_DEFAULTS.seconds)),
    belt: args.includes('--belt'),
    patrol: value('player', 'park') === 'patrol',
    secret: args.includes('--secret'),
    each: args.includes('--each'),
  };
}

function line(r: Omit<SimRow, 'seed'>, patrol: boolean, holes: number) {
  const f = (n: number, d = 0) => n.toFixed(d);
  return (
    `banked ${f(r.banked).padStart(4)} (${f(r.share, 1)}%)  pushes: hole ${f(r.hole, 1)} belt ${f(r.belt, 1)} lost ${f(r.lost, 1)} backUp ${f(r.backUp, 1)}` +
    `  touching ${f(r.touching, 1)}  held ${f(r.held, 1)}%  yielding ${f(r.yielding, 1)}%` +
    (patrol ? `  player: speed ${f(r.playerSpeed, 2)} trips ${f(r.trips, 1)} blocked ${f(r.blocked, 1)}` : '') +
    (holes > 1 ? `  hole share ${f(r.holeShare, 2)}` : '') +
    (r.bars ? `  chamber: ${f(r.fromChamber)} banked, ${f(r.barsOut, 1)} of ${f(r.bars)} bars` : '')
  );
}

const opts = options();
const holes = RUN.find((c) => c.id === opts.cave)!.holes.length;
const started = performance.now();
console.log(
  `${RUN.find((c) => c.id === opts.cave)!.name}${opts.belt ? ' with its belt' : ''}${opts.secret ? ' and its chamber open' : ''}, ${opts.drones} drone${opts.drones === 1 ? '' : 's'}, ${opts.seconds} s, seeds ${opts.seeds.join(',')}${opts.patrol ? ', player patrolling' : ''}`,
);
const rows = opts.seeds.map((seed) => {
  const r = simulate(opts, seed);
  if (opts.each) console.log(`  seed ${String(seed).padStart(2)}  ${line(r, opts.patrol, holes)}`);
  return r;
});
const mean = meanOf(rows);
console.log(`  mean     ${line(mean, opts.patrol, holes)}`);
console.log(`  (${((performance.now() - started) / 1000).toFixed(1)} s)`);
