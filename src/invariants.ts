/**
 * What must always be true of the game, however it has been played: the
 * rules that, broken, are a bug whatever the feature was.
 *
 * Nothing solid is in the rock and nothing is not a number. What the scoop
 * holds is carried, worth something, and no more than it takes. The counts the
 * game keeps of what is in the cave agree with what is in it. The world's
 * holes are the cave's holes and then its drains. The bank is a
 * number, the scoop is a size the workshop sells, the save's cave is in the
 * run and every list of it is the cave's size, and the way out is open only
 * when enough is banked. The save is plain
 * data that comes back as it went.
 *
 * Checked by the fuzzer after everything it does, by the test API on asking,
 * and by the unit tests. Each broken rule is a line saying what and where.
 */
import { EXIT, TILE } from './cave';
import { CLEAR_SHARE, FORMER_LAST, SCOOP_SIZES } from './economy';
import type { Game } from './game';
import { BARREL_KIND, GEODE_KIND, KINDS, KIND_NAME, KIND_VALUE } from './physics';
import { SCOOP_MOST } from './scoop';
import { NO_SOURCE } from './stock';

/** How many broken rules of one sort are reported before the rest are only counted. */
const EACH = 3;

export function checkInvariants(game: Game): string[] {
  const out: string[] = [];
  // a game that has been left is of a cave the save is no longer in: there is nothing of it to hold to the save
  if (game.left) return out;
  const { world, stock, economy, barrels, cave } = game;
  const save = economy.save;
  const { spec } = cave;
  const { sources } = economy;
  const { cols, rows, originX, originY } = cave.grid;
  const report = (sort: string, found: string[]) => {
    if (!found.length) return;
    out.push(...found.slice(0, EACH).map((f) => `${sort}: ${f}`));
    if (found.length > EACH) out.push(`${sort}: and ${found.length - EACH} more`);
  };
  const inRock = (x: number, y: number) => {
    const tx = Math.floor((x - originX) / TILE),
      ty = Math.floor((y - originY) / TILE);
    return tx < 0 || ty < 0 || tx >= cols || ty >= rows || world.solid[ty * cols + tx] === 1;
  };
  const at = (i: number) =>
    `${KIND_NAME[world.kind[i]] ?? `kind ${world.kind[i]}`} ${i} at ${world.x[i].toFixed(1)},${world.y[i].toFixed(1)},${world.z[i].toFixed(1)}`;

  // the bodies: numbers, out of the rock, and counted as they are
  const notNumbers: string[] = [],
    buried: string[] = [];
  const kinds = new Array<number>(KINDS).fill(0);
  const bySource = Array.from({ length: sources.count }, () => new Array<number>(KINDS).fill(0));
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
      if (from >= sources.count) notNumbers.push(`${at(i)} from no source (${from})`);
      else bySource[from][k]++;
    }
  }
  report('not a number', notNumbers);
  report('in the rock', buried);
  if (live !== world.live) out.push(`counts: the world says ${world.live} bodies and holds ${live}`);
  const miscounted: string[] = [];
  for (let k = 0; k < KINDS; k++)
    if (kinds[k] !== stock.kinds[k]) miscounted.push(`${KIND_NAME[k]}: counted ${stock.kinds[k]}, holds ${kinds[k]}`);
  for (let s = 0; s < sources.count; s++)
    for (let k = 0; k < KINDS; k++)
      if (bySource[s][k] !== (stock.left[s][k] ?? 0))
        miscounted.push(`source ${s} ${KIND_NAME[k]}: counted ${stock.left[s][k]}, holds ${bySource[s][k]}`);
  report('counts', miscounted);

  // the scoop holds bodies that are there, held, out of the rock and worth something, as many as it takes and no more; and nothing
  // is held by the world that the scoop does not hold, which would hang in the air for ever
  const holds = new Set(game.scoop.held);
  const misheld: string[] = [];
  for (const i of game.scoop.held) {
    if (!world.alive[i]) misheld.push(`slot ${i} is held and is not in the world`);
    else if (!world.carried[i]) misheld.push(`${at(i)} is held, and not carried`);
    else if (!(KIND_VALUE[world.kind[i]] > 0)) misheld.push(`${at(i)} is held and is worth nothing`);
    // the physics does not look at a carried body, so the scoop alone keeps it out of the rock
    else if (inRock(world.x[i], world.y[i])) misheld.push(`${at(i)} is held, in the rock`);
  }
  if (holds.size !== game.scoop.held.length) misheld.push('a body is held twice');
  if (game.scoop.held.length && !save.scoop) misheld.push(`${game.scoop.held.length} held, and there is no scoop`);
  if (game.scoop.held.length > SCOOP_MOST)
    misheld.push(`${game.scoop.held.length} held, and a lift takes ${SCOOP_MOST}`);
  if (game.scoop.held.length !== game.scoop.places.length) misheld.push('a held body with no place in the bucket');
  for (let i = 0; i < world.count; i++)
    if (world.alive[i] && world.carried[i] && !holds.has(i))
      misheld.push(`${at(i)} is carried, and the scoop does not hold it`);
  report('the scoop', misheld);

  // a whole geode is of no source, and the source of the geodes' gems holds gems and nothing else
  const geodeSource = sources.geodes();
  const strange: string[] = [];
  for (let i = 0; i < world.count; i++)
    if (world.alive[i] && world.kind[i] === GEODE_KIND && stock.origin[i] !== NO_SOURCE)
      strange.push(`${at(i)} is from source ${stock.origin[i]}`);
  if (geodeSource >= 0)
    for (let k = 0; k < KINDS; k++)
      if ((k === 0 || k >= KINDS - 3) && bySource[geodeSource][k])
        strange.push(`the geodes' gems include ${bySource[geodeSource][k]} ${KIND_NAME[k]}`);
  report('a geode', strange);

  // the barrels' fuses are on barrels
  const badFuses = barrels.lit.filter((i) => !world.alive[i] || world.kind[i] !== BARREL_KIND).map((i) => `slot ${i}`);
  report('a fuse on no barrel', badFuses);

  // the world holds the cave's holes and then its drains, which is what tells a hole that banks from one that does not
  if (world.holes.length !== cave.holes.length + cave.drains.length)
    out.push(
      `the world has ${world.holes.length} holes, and the cave ${cave.holes.length} and ${cave.drains.length} drains`,
    );

  // the machines out of the rock
  const machines = [game.dozer, ...game.bots.map((b) => b.dozer)];
  const stuck = machines
    .map((m, j) => ({ m, j }))
    .filter(({ m }) => !Number.isFinite(m.x) || !Number.isFinite(m.y) || inRock(m.x, m.y))
    .map(({ m, j }) => `${j ? `drone ${j}` : 'the dozer'} at ${m.x.toFixed(1)},${m.y.toFixed(1)}`);
  report('a machine in the rock', stuck);

  // the bank, and where the player has got to
  if (!Number.isFinite(save.bank) || save.bank < 0) out.push(`the bank: ${save.bank}`);
  if (!Number.isInteger(save.scoop) || save.scoop < 0 || save.scoop > SCOOP_SIZES) out.push(`the scoop: ${save.scoop}`);
  if (!Number.isFinite(save.drained) || save.drained < 0) out.push(`down the drains: ${save.drained}`);
  if (!economy.run.some((c) => c.id === save.cave)) out.push(`the save's cave is not in the run: ${save.cave}`);
  else if (save.cave !== spec.id) out.push(`the game is in ${spec.id} and the save in ${save.cave}`);
  // every list of the cave is the cave's size, and nothing in it is out of the grid
  const sized = (name: string, list: readonly unknown[], want: number) => {
    if (list.length !== want) out.push(`the save's ${name} is ${list.length} long, and the cave has ${want}`);
  };
  sized('secrets', save.secrets, spec.secrets.length);
  sized('walls', save.walls, spec.walls.length);
  sized('wallDamage', save.wallDamage, spec.walls.length);
  sized('left', save.left, sources.count);
  if (save.rubble.length % 4) out.push(`the rubble is ${save.rubble.length} numbers, not a multiple of four`);
  if (save.barrels && save.barrels.length % 3)
    out.push(`the barrels are ${save.barrels.length} numbers, not a multiple of three`);
  if (save.geodes && save.geodes.length % 3)
    out.push(`the geodes are ${save.geodes.length} numbers, not a multiple of three`);
  for (const k of save.lampsBroken)
    if (!(k >= 0 && k < cave.lamps.length)) out.push(`a lamp knocked over that the cave has not: ${k}`);
  for (const id of save.belts)
    if (!spec.belts.some((b) => b.id === id)) out.push(`a belt bought that the cave has not: ${id}`);
  // the way out is open only when enough is banked, and never in the last cave, which ends instead
  if (save.open && economy.isLast()) out.push('the last cave has its way out open, and has none');
  // a game finished in the cave the run used to end in stays finished there, its way out shut
  if (save.done && !economy.isLast() && (spec.id !== FORMER_LAST || save.open))
    out.push(`the game is done in ${spec.id}, which is not the last cave`);
  // a game not yet stepped has not had the chance to notice that a save it was given has cleared the cave
  if (game.t > 0 && stock.banked() >= CLEAR_SHARE && !save.open && !save.done)
    out.push(`enough is banked (${Math.floor(stock.banked() * 100)}%) and the way out is shut`);
  // the way out's rock is solid exactly when it is shut
  for (let t = 0; t < cave.cells.length; t++) {
    if (cave.cells[t] === EXIT && world.solid[t] !== (save.open ? 0 : 1)) {
      out.push(`the way out is ${save.open ? 'open' : 'shut'} and its rock is not, at tile ${t}`);
      break;
    }
  }

  // the save is plain data, and comes back as it went
  const json = JSON.stringify(save);
  const back = JSON.stringify(JSON.parse(json));
  if (json !== back) out.push('the save does not come back from JSON as it went');
  return out;
}
