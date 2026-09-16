/**
 * The same seed, played twice, giving the same game — checked a hash at a
 * time, so a run that parts from itself says at which frame.
 *
 *   npm run determinism                    seeds 1-6, 3600 frames each
 *   npm run determinism -- --seeds 1-12 --frames 7200
 *
 * Everything that holds the game to a figure rests on this: the drone gate,
 * the balance gate, the fuzzer replaying a failure by seed, a bug reported
 * with the seed it happened on. What breaks it is chance taken from somewhere
 * other than the seeded `Math.random`, state left over in a module between
 * runs, or an order that is not the same twice — and none of that shows as a
 * failure anywhere else, only as figures that wander.
 *
 * The autopilot drives, so the two runs are played the same way without a
 * recording: it pushes, buys, breaks in and goes on, which is most of the
 * game, and it does it from the seed alone.
 */
import { Autopilot } from '../src/autopilot';
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';

const DT = 1 / 60;

export interface TwiceOptions {
  seed: number;
  frames: number;
  /** How many frames between hashes. */
  every?: number;
  /** For testing the check itself: something done to the game at each step of a pass. */
  meddle?: (game: Game, pass: number) => void;
}

export interface TwiceResult {
  seed: number;
  frames: number;
  /** The frame the two runs first parted at, or null if they never did. */
  diverged: number | null;
  /** The hashes of the first run, one per checkpoint. */
  checkpoints: string[];
  note: string;
}

/** A number in [0, 1) from a seed, the same one the gates and the fuzzer use. */
function seeded(n: number): () => number {
  let s = (n * 2654435761 + 1) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Everything the game is at this moment, as one number in hex: where every
 * body is and how fast it is going, what kind it is and whether it is asleep,
 * where the machines are, and the save. Two games with the same hash are the
 * same game, down to the last bit of every float.
 */
export function hashGame(game: Game): string {
  const { world } = game;
  // FNV-1a over the bits, which is enough to catch a coin a thousandth out of place
  let h = 0x811c9dc5;
  const bits = new DataView(new ArrayBuffer(8));
  const eat = (n: number) => {
    bits.setFloat64(0, n);
    for (let b = 0; b < 8; b++) {
      h ^= bits.getUint8(b);
      h = Math.imul(h, 0x01000193);
    }
  };
  eat(world.count);
  for (let i = 0; i < world.count; i++) {
    eat(world.alive[i]);
    if (!world.alive[i]) continue;
    eat(i);
    eat(world.kind[i]);
    eat(world.x[i]);
    eat(world.y[i]);
    eat(world.z[i]);
    eat(world.vx[i]);
    eat(world.vy[i]);
    eat(world.vz[i]);
    eat(world.asleep[i]);
    eat(world.carried[i]);
    eat(game.stock.origin[i]);
  }
  for (const m of [game.dozer, ...game.bots.map((b) => b.dozer)]) {
    eat(m.x);
    eat(m.y);
    eat(m.yaw);
    eat(m.speed);
  }
  for (const i of game.barrels.lit) {
    eat(i);
    eat(game.barrels.fuseLeft(i) ?? 0);
  }
  eat(game.t);
  for (const c of JSON.stringify(game.economy.save)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Play a seed twice, hashing every `every` frames, and say where the two runs first parted. */
export function playTwice({ seed, frames, every = 300, meddle }: TwiceOptions): TwiceResult {
  const saved = Math.random;
  try {
    const passes: string[][] = [];
    for (let pass = 0; pass < 2; pass++) {
      Math.random = seeded(seed);
      const game = new Game(new Economy(memoryStore()));
      const pilot = new Autopilot(game, 'thorough');
      const hashes: string[] = [];
      for (let f = 1; f <= frames; f++) {
        pilot.step(DT);
        meddle?.(game, pass);
        if (f % every === 0) hashes.push(hashGame(game));
      }
      passes.push(hashes);
    }
    const [one, two] = passes;
    const at = one.findIndex((h, k) => h !== two[k]);
    if (at < 0) return { seed, frames, diverged: null, checkpoints: one, note: `seed ${seed}: the same, twice` };
    const frame = (at + 1) * every;
    return {
      seed,
      frames,
      diverged: frame,
      checkpoints: one,
      note: `seed ${seed}: the two runs parted by frame ${frame} (${one[at]} against ${two[at]}); the last they agreed on was ${at ? `frame ${at * every}` : 'the start'}`,
    };
  } finally {
    Math.random = saved;
  }
}
