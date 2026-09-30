/**
 * Going on from one cave to the next, for everything that plays the game
 * without the page: the autopilot's balance runs, the fuzzer, the leak and
 * determinism checks. A `Game` is one cave; when it tells of `caveLeft` its
 * owner lets it go and builds the next, carrying the dozer's speed on. The
 * page does the same, with a scene to swap as well, in `main.ts`.
 */
import { buildCave, type CaveSpec } from '../src/cave';
import type { Economy } from '../src/economy';
import { Game, type GameEvents } from '../src/game';

/**
 * The game for the cave the economy has moved on to, with `game`, the one just left, let go of: it no
 * longer hears of what is bought, and the next is told everything `events` is.
 */
export function onward(game: Game, economy: Economy, run: readonly CaveSpec[], events: GameEvents = {}): Game {
  const spec = run.find((c) => c.id === economy.save.cave);
  if (!spec) throw new Error(`the save is in ${economy.save.cave}, which is not in the run`);
  const speed = game.dozer.speed;
  game.dispose();
  return new Game(economy, buildCave(spec), events, { speed });
}
