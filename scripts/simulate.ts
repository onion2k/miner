/**
 * One run of the drones without the picture, from a seed: what `npm run sim`
 * reports and what `npm run sim:check` holds to its baseline. See sim.ts.
 */
import { AREAS, BODY_CAPACITY, HOLE, SECRETS, buildCave, chamberCentre, gateCentre, type Heap } from '../src/cave';
import { World, BAR, KIND_VALUE, type Pusher } from '../src/physics';
import { Dozer, BLADE_AT, separate } from '../src/dozer';
import { Bot, BOT_SCALE, BOT_SPEC, Foreman, beltOf } from '../src/tools';
import { Nav } from '../src/nav';
import { chamberSource, roomStock } from '../src/economy';

export interface SimOptions {
  /** The room, 1 to the last: the hollow has no drones' work of its own. */
  room: number;
  drones: number;
  seconds: number;
  /** The room's belt bought and running. */
  belt: boolean;
  /** The player driving to and fro through the drones, rather than parked out of the way. */
  patrol: boolean;
  /** The room's hidden chamber broken into, its loot out on the floor. */
  secret: boolean;
}

export const SIM_DEFAULTS: SimOptions = { room: 1, drones: 3, seconds: 120, belt: false, patrol: false, secret: false };

const PLAYER_SPEC = { maxSpeed: 11, accel: 14, turnRate: 1.6, bladeWidth: 6.5, magnetRadius: 4, magnetStrength: 5 };
const DT = 1 / 60;

/** A small seeded generator in place of Math.random, so a seed is the same run every time. */
function seedRandom(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function simulate(opts: SimOptions, seed: number) {
  const random = Math.random;
  try {
    return runSeeded(opts, seed);
  } finally {
    Math.random = random;
  }
}

function runSeeded(opts: SimOptions, seed: number) {
  seedRandom(seed);
  const { room } = opts;
  const cave = buildCave();
  const secret = SECRETS.findIndex((sc) => sc.area === room);
  const revealed = SECRETS.map((_, k) => opts.secret && k === secret);
  const world = new World(
    BODY_CAPACITY,
    cave.solid(
      AREAS.map((_, a) => a === 0 || a === room),
      revealed,
    ),
  );
  // the room's heaps, as the game drops them, and the chamber's loot if it is open
  const origin = new Uint8Array(BODY_CAPACITY);
  const dropHeap = (h: Heap, from: number) => {
    const R = Math.sqrt(h.coins) * 0.36 + 1.5,
      H = Math.sqrt(h.coins) * 0.3 + 1.5;
    const drop = (kind: number) => {
      const z = 1 + Math.random() * H;
      const rr = R * (1 - z / (H + 2)) * Math.sqrt(Math.random()),
        a = Math.random() * Math.PI * 2;
      const i = world.spawn(kind, h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, z);
      if (i >= 0) origin[i] = from;
    };
    for (let k = 0; k < h.coins; k++) drop(0);
    for (const [kind, n] of h.gems) for (let k = 0; k < n; k++) drop(kind);
  };
  for (const h of AREAS[room].heaps) dropHeap(h, room);
  const loot =
    opts.secret && secret >= 0
      ? { ...SECRETS[secret].loot, x: chamberCentre(secret)[0], y: chamberCentre(secret)[1] }
      : null;
  if (loot) dropHeap(loot, chamberSource(secret));
  for (let i = 0; i < 90; i++) world.step(DT, () => {});
  if (opts.belt && AREAS[room].belt) world.belts = [beltOf(AREAS[room].belt.spec)];

  const nav = new Nav(world.solid);
  nav.setBelts(world.belts);
  const player = new Dozer(world.solid);
  const bots: Bot[] = [];
  for (let i = 0; i < opts.drones; i++) bots.push(new Bot(world.solid, i + 1, HOLE.x + 14 + i * 6, HOLE.y + 10));
  const traffic = { bots, player };
  let t = 0;
  const foreman = new Foreman(
    world,
    nav,
    bots,
    origin,
    (from) => from === room || (secret >= 0 && from === chamberSource(secret)),
  );
  const choose = (bot: Bot) => foreman.choose(bot, t);

  // the player: parked out of the way, or driving between the hole and the middle of the room's heaps
  const heaps = AREAS[room].heaps;
  const middle: [number, number] = [
    heaps.reduce((s, h) => s + h.x, 0) / heaps.length,
    heaps.reduce((s, h) => s + h.y, 0) / heaps.length,
  ];
  const [gx, gy] = gateCentre(cave, room);
  const nearHole: [number, number] = [HOLE.x + (gx / Math.hypot(gx, gy)) * 9, HOLE.y + (gy / Math.hypot(gx, gy)) * 9];
  const legs = [middle, nearHole].map((p) => ({ at: p, way: nav.toward(p[0], p[1]) }));
  let leg = 0;
  if (opts.patrol) {
    player.x = nearHole[0];
    player.y = nearHole[1];
  } else {
    player.x = -40;
    player.y = 16;
  }

  let banked = 0,
    fromChamber = 0,
    barsOut = 0;
  const ends = { hole: 0, belt: 0, lost: 0, backUp: 0 };
  let touching = 0,
    pushSamples = 0,
    held = 0,
    yielding = 0,
    samples = 0;
  let playerSpeed = 0,
    playerMoving = 0,
    trips = 0,
    blocked = 0;
  const was = bots.map((b) => b.state);
  const pushers: Pusher[] = [],
    botPushers: Pusher[] = [];

  for (let f = 0; f < opts.seconds * 60; f++) {
    t += DT;
    if (opts.patrol) {
      const { at, way } = legs[leg];
      if (Math.hypot(at[0] - player.x, at[1] - player.y) < 4) {
        leg = 1 - leg;
        trips++;
      }
      const aim = nav.ahead(way, player.x, player.y, 3, 5) ?? at;
      let diff = Math.atan2(aim[1] - player.y, aim[0] - player.x) - player.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      player.update(
        DT,
        { throttle: Math.abs(diff) < 0.6 ? 1 : 0, steer: Math.max(-1, Math.min(1, diff * 2.5)) },
        PLAYER_SPEC,
        world.loads[0] ?? 0,
      );
    }
    for (const b of bots) b.update(DT, world, world.loads[b.dozer.owner] ?? 0, nav, choose, traffic);

    // how each push ended, from the state it went to next
    bots.forEach((b, i) => {
      if (was[i] === 'push' && b.state !== 'push') {
        const c = Math.cos(b.yaw),
          s = Math.sin(b.yaw);
        if (b.state === 'backUp') ends.backUp++;
        else if (Math.hypot(b.x - HOLE.x, b.y - HOLE.y) < 11) ends.hole++;
        else if (nav.onBelt(b.x + c * BLADE_AT * BOT_SCALE, b.y + s * BLADE_AT * BOT_SCALE, 0)) ends.belt++;
        else ends.lost++;
      }
      was[i] = b.state;
    });

    // the rest of the game's frame, for the machines and the coins
    const machines = [player, ...bots.map((b) => b.dozer)];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < machines.length; i++)
        for (let j = i + 1; j < machines.length; j++) separate(machines[i], machines[j]);
    }
    player.pushers(PLAYER_SPEC, pushers);
    for (const b of bots) {
      b.dozer.pushers(BOT_SPEC, botPushers);
      pushers.push(...botPushers);
      const c = Math.cos(b.yaw),
        s = Math.sin(b.yaw);
      if (Math.abs(b.dozer.speed) > 0.5)
        world.wakeNear(
          b.x + c * BLADE_AT * BOT_SCALE,
          b.y + s * BLADE_AT * BOT_SCALE,
          BOT_SPEC.bladeWidth * BOT_SCALE * 0.75 + 1.5,
        );
    }
    world.pushers = pushers;
    if (opts.patrol && Math.abs(player.speed) > 0.5) {
      const c = Math.cos(player.yaw),
        s = Math.sin(player.yaw);
      world.wakeNear(player.x + c * BLADE_AT, player.y + s * BLADE_AT, PLAYER_SPEC.bladeWidth * 0.75 + 1.5);
    }
    world.step(DT, (kind, _x, _y, i) => {
      banked += KIND_VALUE[kind];
      if (origin[i] === chamberSource(secret)) {
        fromChamber += KIND_VALUE[kind];
        if (kind === BAR) barsOut++;
      }
    });

    if (f % 6 === 0) {
      samples++;
      for (let i = 0; i < bots.length; i++) {
        const a = bots[i];
        if (a.yielding) yielding++;
        for (let j = i + 1; j < bots.length; j++) if (Math.hypot(a.x - bots[j].x, a.y - bots[j].y) < 4.6) touching++;
        if (a.state === 'push') {
          pushSamples++;
          const inFront = bots.some(
            (o) =>
              o !== a &&
              Math.hypot(o.x - a.x, o.y - a.y) < 9 &&
              Math.cos(a.yaw) * (o.x - a.x) + Math.sin(a.yaw) * (o.y - a.y) > 0,
          );
          if (inFront && Math.abs(a.dozer.speed) < 2) held++;
        }
      }
      if (opts.patrol) {
        if (Math.abs(player.speed) > 0.01) {
          playerSpeed += Math.abs(player.speed);
          playerMoving++;
        }
        const c = Math.cos(player.yaw),
          s = Math.sin(player.yaw);
        const inWay = bots.some((o) => {
          const dx = o.x - player.x,
            dy = o.y - player.y,
            along = c * dx + s * dy;
          return along > 0 && along < 8 && Math.abs(-s * dx + c * dy) < 6;
        });
        if (inWay && Math.abs(player.speed) < 4) blocked++;
      }
    }
  }
  const pct = (n: number, of: number) => (of ? (100 * n) / of : 0);
  return {
    seed,
    banked,
    share: pct(banked, roomStock(room).value),
    ...ends,
    touching,
    held: pct(held, pushSamples),
    yielding: pct(yielding, samples * Math.max(1, bots.length)),
    playerSpeed: playerMoving ? playerSpeed / playerMoving : 0,
    trips,
    blocked,
    fromChamber,
    barsOut,
    bars: loot ? (loot.gems.find(([k]) => k === BAR)?.[1] ?? 0) : 0,
  };
}

export type SimRow = ReturnType<typeof simulate>;

/** The mean of each figure over some runs. */
export function meanOf(rows: SimRow[]): SimRow {
  return Object.fromEntries(
    Object.keys(rows[0]).map((k) => [k, rows.reduce((s, r) => s + r[k as keyof SimRow], 0) / rows.length]),
  ) as SimRow;
}
