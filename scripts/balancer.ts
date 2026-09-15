/**
 * The whole game played through by the autopilot (`src/autopilot.ts`), from
 * a new save to the cave cleared, with nothing drawn: how long each room
 * takes, when each thing in the workshop is bought, and how the bank goes,
 * for tuning prices and loot against.
 *
 * From a seed, so a run can be played again exactly. The rules that must
 * always hold are checked as it goes; a broken one, or the autopilot stuck,
 * is reported as a problem.
 */
import { AREAS, ORDER } from '../src/cave';
import { Autopilot, type Profile } from '../src/autopilot';
import { Economy, memoryStore, workshopTotal } from '../src/economy';
import { Game } from '../src/game';
import { checkInvariants } from '../src/invariants';

const DT = 1 / 60;
/** How often, in game seconds, the rules are checked and the bank written down. */
const CHECK_EVERY = 5,
  BANK_EVERY = 60;

export interface PlayOptions {
  seed: number;
  profile: Profile;
  /** How many rooms to play, in the order they open; left out, all of them. */
  rooms?: number;
  /** Game minutes before it gives up. */
  capMinutes?: number;
}

export interface RoomRun {
  area: number;
  name: string;
  /** Game minutes spent in it, from going in to going on (or the cave done). */
  minutes: number;
  /** What was banked while in it. */
  banked: number;
}

export interface PlayRun {
  seed: number;
  profile: Profile;
  /** Whether it got through all the rooms asked for. */
  finished: boolean;
  /** Game minutes played. */
  minutes: number;
  rooms: RoomRun[];
  /** The bank at the end of each game minute. */
  bank: number[];
  /** All that had been banked by the end of each game minute. */
  income: number[];
  purchases: { minute: number; id: string; cost: number }[];
  banked: number;
  spent: number;
  /** What the workshop costs all told, for what share of it was bought. */
  workshop: number;
  /** Chambers broken into and walls knocked down. */
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

export function playThrough({ seed, profile, rooms = ORDER.length, capMinutes = 90 }: PlayOptions): PlayRun {
  const started = performance.now();
  const saved = Math.random;
  Math.random = seeded(seed);
  const problems: string[] = [];
  const bank: number[] = [];
  const income: number[] = [];
  const purchases: PlayRun['purchases'] = [];
  const roomRuns: RoomRun[] = [];
  let game: Game | null = null;
  let spent = 0;
  try {
    const economy = new Economy(memoryStore());
    const costOf = (id: string) => [...economy.offers(), ...economy.cosmetics()].find((o) => o.id === id)?.cost ?? 0;
    game = new Game(economy, {});
    const pilot = new Autopilot(game, profile);
    let enteredAt = 0,
      bankedAt = 0,
      logged = 0;
    const endRoom = (area: number) => {
      roomRuns.push({
        area,
        name: AREAS[area].name,
        minutes: (game!.t - enteredAt) / 60,
        banked: economy.save.banked - bankedAt,
      });
    };
    // what each purchase cost is read before it is made, from the prices showing
    let prices = new Map<string, number>();
    const cap = capMinutes * 60;
    let room = economy.current();
    let nextCheck = CHECK_EVERY,
      nextBank = BANK_EVERY;
    while (game.t < cap) {
      prices = new Map([...economy.offers()].map((o) => [o.id, o.cost]));
      pilot.step(DT);
      for (; logged < pilot.log.length; logged++) {
        const { t, what } = pilot.log[logged];
        if (what.startsWith('bought ')) {
          const id = what.slice(7);
          const cost = prices.get(id) ?? costOf(id);
          spent += cost;
          purchases.push({ minute: t / 60, id, cost });
        } else if (what.startsWith('stuck')) problems.push(`seed ${seed}: ${what} at ${(t / 60).toFixed(1)} min`);
      }
      if (economy.current() !== room) {
        // gone on: the room behind is done with
        endRoom(room);
        room = economy.current();
        enteredAt = game.t;
        bankedAt = economy.save.banked;
        if (roomRuns.length >= rooms) break;
      }
      if (economy.save.done) {
        endRoom(room);
        break;
      }
      if (pilot.over) break;
      if (game.t >= nextCheck) {
        nextCheck += CHECK_EVERY;
        const broken = checkInvariants(game);
        if (broken.length) {
          problems.push(...broken.map((p) => `seed ${seed} at ${(game!.t / 60).toFixed(1)} min: ${p}`));
          break;
        }
      }
      if (game.t >= nextBank) {
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
      finished: roomRuns.length >= rooms,
      minutes: game.t / 60,
      rooms: roomRuns,
      bank,
      income,
      purchases,
      banked: save.banked,
      spent,
      workshop: workshopTotal(),
      chambers: save.secrets.filter(Boolean).length,
      walls: save.walls.filter(Boolean).length,
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
      rooms: roomRuns,
      bank,
      income,
      purchases,
      banked: game?.economy.save.banked ?? 0,
      spent,
      workshop: workshopTotal(),
      chambers: 0,
      walls: 0,
      problems,
      seconds: (performance.now() - started) / 1000,
    };
  } finally {
    Math.random = saved;
  }
}
