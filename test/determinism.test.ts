/**
 * The same seed gives the same game, twice over. Everything that holds the
 * game to a figure — the drone gate, the balance gate, the fuzzer's replays —
 * rests on that; where it fails, those figures wander for reasons nobody can
 * see.
 */
import { describe, expect, it } from 'vitest';
import { hashGame, playTwice } from '../scripts/determinism';
import { Economy, memoryStore } from '../src/economy';
import { Game } from '../src/game';
import { withSeed } from './helpers';

describe('the same seed gives the same game', () => {
  it('plays out the same, twice from a seed, all the way down to the last coin', () => {
    const run = playTwice({ seed: 3, frames: 1200, every: 100 });
    expect(run.diverged, run.note).toBe(null);
    expect(run.checkpoints.length).toBe(12);
  });

  it('hashes what a game is, so anything moved shows', () => {
    const one = withSeed(5, () => {
      const game = new Game(new Economy(memoryStore()));
      for (let f = 0; f < 60; f++) game.step(1 / 60, { throttle: 1, steer: 0.2 });
      return { game, hash: hashGame(game) };
    });
    const two = withSeed(5, () => {
      const game = new Game(new Economy(memoryStore()));
      for (let f = 0; f < 60; f++) game.step(1 / 60, { throttle: 1, steer: 0.2 });
      return hashGame(game);
    });
    expect(two).toBe(one.hash);
    // a coin nudged by a thousandth, the dozer a shade round, a coin banked: all different games
    one.game.world.x[0] += 0.001;
    expect(hashGame(one.game)).not.toBe(one.hash);
    one.game.world.x[0] -= 0.001;
    expect(hashGame(one.game)).toBe(one.hash);
    one.game.dozer.yaw += 1e-6;
    expect(hashGame(one.game)).not.toBe(one.hash);
    one.game.dozer.yaw -= 1e-6;
    one.game.economy.deposit(1);
    expect(hashGame(one.game)).not.toBe(one.hash);
  });

  it('says where two runs first parted, when they do', () => {
    let frame = 0;
    const run = playTwice({
      seed: 4,
      frames: 400,
      every: 100,
      // a second run that nudges a coin part way through: the check must catch it, and say when
      meddle: (game, pass) => {
        if (pass === 1 && ++frame === 250) game.world.y[1] += 0.5;
      },
    });
    expect(run.diverged).toBe(300);
    expect(run.note).toMatch(/frame 300/);
  });
});
