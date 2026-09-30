/**
 * The whole game played through by the autopilot (`src/autopilot.ts`), from
 * a new save to the last cave cleared, with nothing drawn: how long each cave
 * takes, when each thing in the workshop is bought, and how the bank goes,
 * for tuning prices and loot against.
 *
 * From a seed, so a run can be played again exactly. The rules that must
 * always hold are checked as it goes; a broken one, or the autopilot stuck,
 * is reported as a problem.
 */
import { buildCave } from '../src/cave';
import { RUN } from '../src/caves';
import { Autopilot, type Profile } from '../src/autopilot';
import { Economy, memoryStore, workshopTotal } from '../src/economy';
import { Game, type GameEvents } from '../src/game';
import { checkInvariants } from '../src/invariants';
import { onward } from './run';

const DT = 1 / 60;
/** How often, in game seconds, the rules are checked and the bank written down. */
const CHECK_EVERY = 5,
  BANK_EVERY = 60;

export interface PlayOptions {
  seed: number;
  profile: Profile;
  /** How many caves to play, in the order of the run; left out, all of them. */
  caves?: number;
  /** Game minutes before it gives up. */
  capMinutes?: number;
}

export interface CaveRun {
  id: string;
  name: string;
  /** Game minutes spent in it, from arriving to driving out (or the game done). */
  minutes: number;
  /** What was banked while in it. */
  banked: number;
}

export interface PlayRun {
  seed: number;
  profile: Profile;
  /** Whether it got through all the caves asked for. */
  finished: boolean;
  /** Game minutes played. */
  minutes: number;
  caves: CaveRun[];
  /** The bank at the end of each game minute. */
  bank: number[];
  /** All that had been banked by the end of each game minute. */
  income: number[];
  purchases: { minute: number; id: string; cost: number }[];
  banked: number;
  spent: number;
  /** What the workshop costs all told, for what share of it was bought. */
  workshop: number;
  /** Chambers broken into and walls knocked down, in all the caves played. */
  chambers: number;
  walls: number;
  problems: string[];
  /** Real seconds it took to play. */
  seconds: number;
}

function seeded(n: number): () => number {
  let s = (n * 2654435761 + 7) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function playThrough({ seed, profile, caves = RUN.length, capMinutes = 90 }: PlayOptions): PlayRun {
  const started = performance.now();
  const saved = Math.random;
  Math.random = seeded(seed);
  const problems: string[] = [];
  const bank: number[] = [];
  const income: number[] = [];
  const purchases: PlayRun['purchases'] = [];
  const caveRuns: CaveRun[] = [];
  let game: Game | null = null;
  let spent = 0;
  // the chambers and walls of each cave are counted as they open, for the save forgets them when the cave is left
  let chambers = 0,
    walls = 0;
  const events: GameEvents = { chamberOpened: () => chambers++, wallDown: () => walls++ };
  try {
    const economy = new Economy(memoryStore(), RUN);
    const costOf = (id: string) => [...economy.offers(), ...economy.cosmetics()].find((o) => o.id === id)?.cost ?? 0;
    game = new Game(economy, buildCave(economy.cave()), events);
    let pilot = new Autopilot(game, profile);
    let enteredAt = 0,
      bankedAt = 0,
      logged = 0;
    const endCave = (id: string, name: string) => {
      caveRuns.push({ id, name, minutes: (game!.t - enteredAt) / 60, banked: economy.save.banked - bankedAt });
    };
    // what each purchase cost is read before it is made, from the prices showing
    let prices = new Map<string, number>();
    const cap = capMinutes * 60;
    let total = 0;
    let nextCheck = CHECK_EVERY,
      nextBank = BANK_EVERY;
    while (total < cap) {
      prices = new Map([...economy.offers()].map((o) => [o.id, o.cost]));
      const before = economy.cave();
      pilot.step(DT);
      total += DT;
      for (; logged < pilot.log.length; logged++) {
        const { t, what } = pilot.log[logged];
        if (what.startsWith('bought ')) {
          const id = what.slice(7);
          const cost = prices.get(id) ?? costOf(id);
          spent += cost;
          purchases.push({ minute: (total - game.t + t) / 60, id, cost });
        } else if (what.startsWith('stuck')) problems.push(`seed ${seed}: ${what} at ${(total / 60).toFixed(1)} min`);
      }
      if (game.left) {
        // out through the way out: the cave behind is done with, and the next begins
        endCave(before.id, before.name);
        if (caveRuns.length >= caves) break;
        game = onward(game, economy, RUN, events);
        pilot = new Autopilot(game, profile);
        logged = 0;
        enteredAt = game.t;
        bankedAt = economy.save.banked;
      }
      if (economy.save.done) {
        endCave(economy.cave().id, economy.cave().name);
        break;
      }
      if (pilot.over) break;
      if (total >= nextCheck) {
        nextCheck += CHECK_EVERY;
        const broken = checkInvariants(game);
        if (broken.length) {
          problems.push(...broken.map((p) => `seed ${seed} at ${(total / 60).toFixed(1)} min: ${p}`));
          break;
        }
      }
      if (total >= nextBank) {
        nextBank += BANK_EVERY;
        bank.push(economy.bank);
        income.push(economy.save.banked);
      }
    }
    bank.push(economy.bank);
    income.push(economy.save.banked);
    const save = economy.save;
    return {
      seed,
      profile,
      finished: caveRuns.length >= caves,
      minutes: total / 60,
      caves: caveRuns,
      bank,
      income,
      purchases,
      banked: save.banked,
      spent,
      workshop: workshopTotal(RUN),
      chambers,
      walls,
      problems,
      seconds: (performance.now() - started) / 1000,
    };
  } catch (err) {
    problems.push(`seed ${seed}: threw ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    return {
      seed,
      profile,
      finished: false,
      minutes: (game?.t ?? 0) / 60,
      caves: caveRuns,
      bank,
      income,
      purchases,
      banked: game?.economy.save.banked ?? 0,
      spent,
      workshop: workshopTotal(RUN),
      chambers,
      walls,
      problems,
      seconds: (performance.now() - started) / 1000,
    };
  } finally {
    Math.random = saved;
  }
}
