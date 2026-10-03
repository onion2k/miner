/**
 * The ledger: what each cave held, what was brought out of it, what was paid in toll, what went down its drains,
 * what was left behind, which finds were found, and three marks for how it was done. Worked out without the page,
 * from the game and its save, so that the card shown on leaving a cave, the panel of the whole run and the test
 * API read the same figures and none is worked out twice. Nothing in it, or in what it keeps in the save, counts
 * time: a player is told how well a cave was done, never how fast.
 *
 * Without it the player is told only of what is banked, and a cave left with a chamber unopened or a heap down a
 * drain looks the same as one cleaned out.
 */
import type { Cave, CaveSpec } from './cave';
import type { Economy } from './economy';
import { KIND_VALUE } from './physics';
import { figure } from './figure';
import type { Stock } from './stock';
import { stashBehind } from './walls';

/** Whether a kind of find is there to be found in a cave: none in it, found, or still to find. */
export type Found = 'none' | 'found' | 'left';
const FOUND: readonly Found[] = ['none', 'found', 'left'];

/** One cave of the ledger, for the cave being played at any moment and, written when it is left, for each cave behind. */
export interface Row {
  /** The id of the cave's spec. */
  cave: string;
  /** Everything obtainable in it, by every source. */
  held: number;
  /** What was banked in it, by every source, the toll's half of every coin included. */
  taken: number;
  /** What was paid of its toll. */
  toll: number;
  /** What went down its drains. */
  drained: number;
  /** What was not brought out, whether it lies, is not yet opened, or was lost whole: never below nought. */
  left: number;
  finds: { chamber: Found; sideRoom: Found; wall: Found; geodes: { cracked: number; of: number } };
  marks: { clean: boolean; everyHeap: boolean; everyFind: boolean };
  /** Set only on the last cave once it is done, whose vein runs coins in without end: `taken` may pass `held`. */
  vein?: boolean;
}

/** What the ledger reads of a game: the cave it is in, its stock of bodies and the economy that holds its save. */
export interface Played {
  readonly cave: Cave;
  readonly economy: Economy;
  readonly stock: Pick<Stock, 'lying' | 'kinds'>;
}

/** A parcel of coins and gems, in coins. */
function worth(coins: number, gems: readonly (readonly [number, number])[]): number {
  return gems.reduce((sum, [kind, n]) => sum + n * KIND_VALUE[kind], coins * KIND_VALUE[0]);
}

/** What a cave holds, by where it is: the heaps, the chambers, the side rooms, the walls' treasure and the geodes' gems. */
export function heldBy(spec: CaveSpec): {
  heaps: number;
  chambers: number;
  sideRooms: number;
  walls: number;
  geodes: number;
} {
  const sum = (loots: readonly { coins: number; gems: readonly (readonly [number, number])[] }[]) =>
    loots.reduce((n, l) => n + worth(l.coins, l.gems), 0);
  return {
    heaps: sum(spec.heaps),
    chambers: sum(spec.secrets.map((s) => s.loot)),
    sideRooms: sum(spec.stashes.map((s) => s.loot)),
    walls: spec.walls.reduce((n, w) => n + worth(0, w.treasure), 0),
    // each geode holds the same, and the cave stands `count` of them
    geodes: (spec.geodes?.count ?? 0) * worth(0, spec.geodes?.holds ?? []),
  };
}

/** Everything obtainable in a cave, by every source. */
export function held(spec: CaveSpec): number {
  const by = heldBy(spec);
  return by.heaps + by.chambers + by.sideRooms + by.walls + by.geodes;
}

/** What the whole run holds. */
export function runHeld(run: readonly CaveSpec[]): number {
  return run.reduce((n, spec) => n + held(spec), 0);
}

/** The row of the cave being played, as it stands. */
export function rowOf(game: Played): Row {
  const { economy, stock, cave } = game;
  const { spec } = cave;
  const save = economy.save;
  const total = held(spec);
  const secrets: Found = !spec.secrets.length ? 'none' : save.secrets.every(Boolean) ? 'found' : 'left';
  const walls: Found = !spec.walls.length ? 'none' : save.walls.every(Boolean) ? 'found' : 'left';
  // a side room is reached through the wall that stands in front of it, and found when that wall is down
  const behindWall = spec.stashes.map((stash) =>
    spec.walls.some((_, w) => !save.walls[w] && stashBehind(cave, w) === stash),
  );
  const sideRoom: Found = !spec.stashes.length ? 'none' : behindWall.some(Boolean) ? 'left' : 'found';
  const geodes = { cracked: Math.min(save.cracked, spec.geodes?.count ?? 0), of: spec.geodes?.count ?? 0 };
  const row: Row = {
    cave: spec.id,
    held: total,
    taken: save.taken,
    toll: save.toll,
    drained: save.drained,
    left: Math.max(0, total - save.taken - save.drained),
    finds: { chamber: secrets, sideRoom, wall: walls, geodes },
    marks: {
      clean: save.drained === 0,
      everyHeap: stock.lying(0) === 0,
      everyFind: secrets !== 'left' && walls !== 'left' && geodes.cracked >= geodes.of,
    },
  };
  if (economy.isLast() && save.done) row.vein = true;
  return row;
}

/** A row read from outside, kept only as a row: every figure a number and every word one the ledger knows, or nothing. */
export function validRow(raw: unknown, run: readonly CaveSpec[]): Row | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (typeof r.cave !== 'string' || !run.some((c) => c.id === r.cave)) return null;
  const { held: h, taken, toll, drained, left } = r;
  if (!count(h) || !count(taken) || !count(toll) || !count(drained) || !count(left)) return null;
  const f = r.finds as Record<string, unknown> | null | undefined;
  const m = r.marks as Record<string, unknown> | null | undefined;
  if (typeof f !== 'object' || f === null || typeof m !== 'object' || m === null) return null;
  const found = (v: unknown): v is Found => FOUND.includes(v as Found);
  const g = f.geodes as Record<string, unknown> | null | undefined;
  if (!found(f.chamber) || !found(f.sideRoom) || !found(f.wall)) return null;
  if (typeof g !== 'object' || g === null || !count(g.cracked) || !count(g.of)) return null;
  if (typeof m.clean !== 'boolean' || typeof m.everyHeap !== 'boolean' || typeof m.everyFind !== 'boolean') return null;
  const row: Row = {
    cave: r.cave,
    held: h,
    taken,
    toll,
    drained,
    left,
    finds: { chamber: f.chamber, sideRoom: f.sideRoom, wall: f.wall, geodes: { cracked: g.cracked, of: g.of } },
    marks: { clean: m.clean, everyHeap: m.everyHeap, everyFind: m.everyFind },
  };
  if (r.vein === true) row.vein = true;
  return row;
}

/** The rows of a save read from outside: the good ones, once for each cave, in the run's order, and no more than a run can leave. */
export function validRows(raw: unknown, run: readonly CaveSpec[]): Row[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const item of raw) {
    const row = validRow(item, run);
    if (!row || seen.has(row.cave)) continue;
    seen.add(row.cave);
    rows.push(row);
  }
  // the last cave is never left, so a run has one row fewer than it has caves
  return rows.sort((a, b) => cavePlace(run, a) - cavePlace(run, b)).slice(0, run.length - 1);
}

/** Where a row's cave is in the run, from 0. */
export const cavePlace = (run: readonly CaveSpec[], row: { cave: string }) => run.findIndex((c) => c.id === row.cave);

/** What the run has brought out so far, of what it holds: "brought out 12,340 of 68,850". */
export function runLine(economy: Economy, game: Played): string {
  const done = economy.save.ledger.reduce((n, r) => n + r.taken, 0);
  return `brought out ${figure(done + rowOf(game).taken)} of ${figure(runHeld(economy.run))}`;
}

// ---- what is shown ----

/** How a cave's bar is cut, as shares of its length, 0 to 100: gold for what was brought out, blue for the drained, grey for the rest. */
export interface Bar {
  out: number;
  drained: number;
  left: number;
}

/** The bar of a row. A cave that took more than it held, as the last does once its vein runs, is cut by what it took. */
export function barOf(row: Row): Bar {
  const total = row.taken + row.drained + row.left;
  if (!(total > 0)) return { out: 0, drained: 0, left: 0 };
  return { out: (row.taken / total) * 100, drained: (row.drained / total) * 100, left: (row.left / total) * 100 };
}

/** The three marks of a cave, each a word and whether it was won. `text` is what is written: ◆ won, ◇ not. */
export interface MarkView {
  word: string;
  won: boolean;
  text: string;
}

export function marksOf(row: Row): MarkView[] {
  const mark = (word: string, won: boolean): MarkView => ({ word, won, text: `${won ? '◆' : '◇'} ${word}` });
  return [
    mark('clean', row.marks.clean),
    mark('every heap', row.marks.everyHeap),
    mark('every find', row.marks.everyFind),
  ];
}

/** The card shown on leaving a cave. */
export interface CardView {
  name: string;
  bar: Bar;
  figures: string;
  marks: MarkView[];
}

export function cardOf(row: Row, name: string): CardView {
  return {
    name,
    bar: barOf(row),
    figures: `${figure(row.taken)} brought out · ${figure(row.drained)} drained · ${figure(row.left)} left behind`,
    marks: marksOf(row),
  };
}

/** A line of the whole ledger: a cave left, or the one being played, which is dimmed and says "so far". */
export interface RowView {
  name: string;
  bar: Bar;
  /** "2,580 of 2,620", and for the one being played "1,900 of 7,990 so far". */
  text: string;
  /** What is told of the rest of the bar: what was drained and, for a cave left, what was left behind. */
  detail: string;
  /** The marks of a cave left; the one being played has none yet. */
  marks: MarkView[];
  soFar: boolean;
}

/** The whole ledger: a row for each cave left, then the cave being played, then the line for the run. */
export interface LedgerView {
  rows: RowView[];
  now: RowView;
  /** "brought out 12,340 of 68,850". */
  line: string;
  /** The same as the panel's last line says it. */
  foot: string;
}

export function ledgerOf(economy: Economy, game: Played): LedgerView {
  const name = (id: string) => economy.run.find((c) => c.id === id)?.name ?? id;
  const behind = economy.save.ledger.map((row): RowView => ({
    name: name(row.cave),
    bar: barOf(row),
    text: `${figure(row.taken)} of ${figure(row.held)}`,
    detail: `${figure(row.drained)} drained · ${figure(row.left)} left behind`,
    marks: marksOf(row),
    soFar: false,
  }));
  const row = rowOf(game);
  const now: RowView = {
    name: name(row.cave),
    bar: barOf(row),
    text: row.vein
      ? `${figure(row.taken)} of ${figure(row.held)} · the vein runs on`
      : `${figure(row.taken)} of ${figure(row.held)} so far`,
    detail: `${figure(row.drained)} drained`,
    marks: [],
    soFar: true,
  };
  const line = runLine(economy, game);
  return { rows: behind, now, line, foot: `The mine: ${line}` };
}
