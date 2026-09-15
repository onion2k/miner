/**
 * What must always be true of the game, however it has been played: the
 * rules that, broken, are a bug whatever the feature was.
 *
 * Nothing solid is in the rock and nothing is not a number. The counts the
 * game keeps of what is in the cave agree with what is in it. Nothing from a
 * sealed room is still about. The bank is a number and the rooms are in an
 * order that makes sense. The save is plain data that comes back as it went.
 *
 * Checked by the fuzzer after everything it does, by the test API on asking,
 * and by the unit tests. Each broken rule is a line saying what and where.
 */
import { AREAS, COLS, ORDER, ORIGIN_X, ORIGIN_Y, ROWS, TILE } from './cave';
import { SOURCES, areaOfSource } from './economy';
import type { Game } from './game';
import { BARREL_KIND, KINDS, KIND_NAME } from './physics';
import { NO_SOURCE } from './stock';

/** How many broken rules of one sort are reported before the rest are only counted. */
const EACH = 3;

export function checkInvariants(game: Game): string[] {
  const out: string[] = [];
  const { world, stock, economy, barrels } = game;
  const save = economy.save;
  const report = (sort: string, found: string[]) => {
    if (!found.length) return;
    out.push(...found.slice(0, EACH).map((f) => `${sort}: ${f}`));
    if (found.length > EACH) out.push(`${sort}: and ${found.length - EACH} more`);
  };
  const inRock = (x: number, y: number) => {
    const tx = Math.floor((x - ORIGIN_X) / TILE),
      ty = Math.floor((y - ORIGIN_Y) / TILE);
    return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || world.solid[ty * COLS + tx] === 1;
  };
  const at = (i: number) =>
    `${KIND_NAME[world.kind[i]] ?? `kind ${world.kind[i]}`} ${i} at ${world.x[i].toFixed(1)},${world.y[i].toFixed(1)},${world.z[i].toFixed(1)}`;

  // the bodies: numbers, out of the rock, and counted as they are
  const notNumbers: string[] = [],
    buried: string[] = [];
  const kinds = new Array<number>(KINDS).fill(0);
  const bySource = Array.from({ length: SOURCES }, () => new Array<number>(KINDS).fill(0));
  const sealedIn: string[] = [];
  let live = 0;
  for (let i = 0; i < world.count; i++) {
    if (!world.alive[i]) continue;
    live++;
    const k = world.kind[i];
    if (k >= KINDS) {
      notNumbers.push(`slot ${i} is of no kind (${k})`);
      continue;
    }
    kinds[k]++;
    const values = [world.x[i], world.y[i], world.z[i], world.vx[i], world.vy[i], world.vz[i]];
    if (!values.every(Number.isFinite)) notNumbers.push(at(i));
    else if (!world.carried[i] && inRock(world.x[i], world.y[i])) buried.push(at(i));
    const from = stock.origin[i];
    if (from !== NO_SOURCE) {
      if (from >= SOURCES) notNumbers.push(`${at(i)} from no source (${from})`);
      else {
        bySource[from][k]++;
        if (economy.sealed(areaOfSource(from)))
          sealedIn.push(`${at(i)}, from sealed ${AREAS[areaOfSource(from)].name}`);
      }
    } else if (k === BARREL_KIND && economy.sealed(stock.home[i])) {
      sealedIn.push(`${at(i)}, of sealed ${AREAS[stock.home[i]].name}`);
    }
  }
  report('not a number', notNumbers);
  report('in the rock', buried);
  report('left behind in a sealed room', sealedIn);
  if (live !== world.live) out.push(`counts: the world says ${world.live} bodies and holds ${live}`);
  const miscounted: string[] = [];
  for (let k = 0; k < KINDS; k++)
    if (kinds[k] !== stock.kinds[k]) miscounted.push(`${KIND_NAME[k]}: counted ${stock.kinds[k]}, holds ${kinds[k]}`);
  for (let s = 0; s < SOURCES; s++)
    for (let k = 0; k < KINDS; k++)
      if (bySource[s][k] !== (stock.left[s][k] ?? 0))
        miscounted.push(`source ${s} ${KIND_NAME[k]}: counted ${stock.left[s][k]}, holds ${bySource[s][k]}`);
  report('counts', miscounted);

  // the barrels' fuses are on barrels
  const badFuses = barrels.lit.filter((i) => !world.alive[i] || world.kind[i] !== BARREL_KIND).map((i) => `slot ${i}`);
  report('a fuse on no barrel', badFuses);

  // the machines out of the rock
  const machines = [game.dozer, ...game.bots.map((b) => b.dozer)];
  const stuck = machines
    .map((m, j) => ({ m, j }))
    .filter(({ m }) => !Number.isFinite(m.x) || !Number.isFinite(m.y) || inRock(m.x, m.y))
    .map(({ m, j }) => `${j ? `drone ${j}` : 'the dozer'} at ${m.x.toFixed(1)},${m.y.toFixed(1)}`);
  report('a machine in the rock', stuck);

  // the bank and the rooms
  if (!Number.isFinite(save.bank) || save.bank < 0) out.push(`the bank: ${save.bank}`);
  if (!ORDER.includes(save.room)) out.push(`the room being cleared is no room: ${save.room}`);
  else if (!save.areas[save.room]) out.push(`the room being cleared, ${AREAS[save.room].name}, is not open`);
  if (!save.areas[0]) out.push('the hollow is shut');
  // no room past the next is open, and no room behind the one being cleared but the hollow
  const here = ORDER.indexOf(save.room);
  ORDER.forEach((a, n) => {
    if (n > here + 1 && save.areas[a]) out.push(`${AREAS[a].name} is open, past the next room`);
    if (n > 0 && n < here && save.areas[a]) out.push(`${AREAS[a].name} is open, behind the room being cleared`);
  });

  // the save is plain data, and comes back as it went
  const json = JSON.stringify(save);
  const back = JSON.stringify(JSON.parse(json));
  if (json !== back) out.push('the save does not come back from JSON as it went');
  return out;
}
