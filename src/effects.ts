/**
 * The bursts of particles the game throws: glass, chips, dust, sparkle.
 *
 * Each is the description of a burst and nothing more, handed back for
 * whoever draws them to emit, so this knows nothing of the renderer beyond
 * the shape of what it takes.
 */
import type { Emit } from 'artshape-render/game/particles';
import type { Rgb } from './palette';

/** A lamp knocked over: glass, and if it was lit, the last of its light going out of it as sparks. */
export function glass(x: number, y: number, z: number, dirX: number, dirY: number, lit: boolean): Emit[] {
  const out: Emit[] = [
    {
      position: [x, y, z],
      velocity: [dirX * 3, dirY * 3, 4],
      spread: 6,
      count: 40,
      life: 0.9,
      lifeSpread: 0.4,
      size: 0.18,
      growth: -0.1,
      colour: lit ? [2.4, 2.0, 1.4] : [0.6, 0.65, 0.7],
      alpha: 1,
      gravity: 1.6,
      floor: 0,
    },
  ];
  if (lit)
    out.push({
      position: [x, y, z],
      velocity: [0, 0, 2],
      spread: 3,
      count: 25,
      life: 0.5,
      lifeSpread: 0.3,
      size: 0.12,
      growth: -0.2,
      colour: [3, 2.2, 0.9],
      alpha: 0,
      gravity: 0.6,
      floor: 0,
    });
  return out;
}

/**
 * Something banked: a spray of sparkle up out of the hole, in its colour made
 * bright, bigger and longer the hotter the run (`heat`, 0 to 1).
 */
export function sparkle(x: number, y: number, colour: Rgb, gem: boolean, heat: number): Emit {
  return {
    position: [x, y, 0.5],
    velocity: [0, 0, 12 + heat * 10],
    spread: 6 + heat * 6,
    count: (gem ? 40 : 8) + Math.round(heat * 30),
    life: 0.9 + heat * 0.5,
    lifeSpread: 0.4,
    size: (gem ? 0.45 : 0.3) + heat * 0.15,
    growth: -0.2,
    colour,
    alpha: 0,
    gravity: 0.8,
    floor: -30,
  };
}

/** The rock in front of a hidden chamber bursting: chips flying on the way the dozer was going, and a cloud of dust. */
export function rockBurst(x: number, y: number, dirX: number, dirY: number): Emit[] {
  return [
    {
      position: [x, y, 2],
      velocity: [dirX * 14, dirY * 14, 9],
      spread: 12,
      count: 70,
      life: 1.3,
      lifeSpread: 0.5,
      size: 0.45,
      growth: -0.2,
      colour: [0.32, 0.33, 0.4],
      alpha: 1,
      gravity: 1.6,
      floor: 0,
    },
    {
      position: [x, y, 1.5],
      velocity: [dirX * 3, dirY * 3, 4],
      spread: 7,
      count: 50,
      life: 2.2,
      lifeSpread: 0.6,
      size: 1.4,
      growth: 1.8,
      colour: [0.42, 0.4, 0.46],
      alpha: 0.7,
      gravity: 0.1,
      floor: 0,
    },
  ];
}

/** Where a brick wall stood as it comes down: dust the colour of its bricks, drifting on the way it was pushed. */
export function wallDust(x: number, y: number, dirX: number, dirY: number, brick: Rgb): Emit {
  return {
    position: [x, y, 2],
    velocity: [dirX * 4, dirY * 4, 3],
    spread: 8,
    count: 60,
    life: 2.4,
    lifeSpread: 0.7,
    size: 1.5,
    growth: 1.8,
    colour: brick.map((v) => v * 0.6 + 0.2) as Rgb,
    alpha: 0.6,
    gravity: 0.1,
    floor: 0,
  };
}

/** A brick wall hit and still standing: bits of brick back toward the dozer, more the worse the wall (`gone`, 0 to 1), and dust. */
export function wallHit(x: number, y: number, dirX: number, dirY: number, gone: number, brick: Rgb): Emit[] {
  return [
    {
      position: [x, y, 2],
      velocity: [-dirX * 4, -dirY * 4, 4],
      spread: 5,
      count: Math.round(12 + gone * 30),
      life: 1,
      lifeSpread: 0.3,
      size: 0.35,
      growth: -0.2,
      colour: brick,
      alpha: 1,
      gravity: 1.4,
      floor: 0,
    },
    {
      position: [x, y, 1.5],
      velocity: [0, 0, 2],
      spread: 4,
      count: 20,
      life: 1.2,
      lifeSpread: 0.3,
      size: 0.8,
      growth: 1,
      colour: [0.5, 0.45, 0.42],
      alpha: 0.5,
      gravity: 0.2,
      floor: 0,
    },
  ];
}

/** The rock at a gate, coming down when a room opens or going up when one is sealed. */
export function gateCloud(x: number, y: number): Emit {
  return {
    position: [x, y, 1.5],
    velocity: [0, 0, 5],
    spread: 6,
    count: 60,
    life: 1.6,
    lifeSpread: 0.5,
    size: 1.2,
    growth: 1.5,
    colour: [0.45, 0.4, 0.5],
    alpha: 0.8,
    gravity: 0.15,
    floor: 0,
  };
}

/** A puff where something was, as a sealed room takes what was left in it. */
export function puff(x: number, y: number, z: number): Emit {
  return {
    position: [x, y, z + 0.3],
    velocity: [0, 0, 2],
    spread: 1.5,
    count: 3,
    life: 0.8,
    lifeSpread: 0.3,
    size: 0.5,
    growth: 0.8,
    colour: [0.5, 0.45, 0.4],
    alpha: 0.6,
    gravity: 0.1,
    floor: 0,
  };
}

/** Dust off a cracking floor while it glows, or a plume while it sprays. */
export function fountainDust(x: number, y: number, spraying: boolean): Emit {
  return {
    position: [x, y, 0.3],
    velocity: [0, 0, spraying ? 9 : 2],
    spread: 3,
    count: 4,
    life: 1.2,
    lifeSpread: 0.5,
    size: 0.8,
    growth: 1.2,
    colour: [0.6, 0.45, 0.3],
    alpha: 0.5,
    gravity: 0.05,
    floor: 0,
  };
}
