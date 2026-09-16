/**
 * The half of the scene that moves: the coins, gems, bars and bricks where
 * the physics has them, the dozer and the drones, their tread bars running
 * round their tracks, the stripes on the running belts, the pennant, and the
 * marks the tracks have left.
 *
 * The groups are fixed once, and each frame only where everything is written
 * into them. It is handed the few things it does to the renderer as
 * functions, and never the renderer.
 */
import { mergeMeshes, type Mesh } from 'artshape-render/mesh/types';
import type { GameGroup } from 'artshape-render/game/renderer';
import { AREAS } from './cave';
import { TRACK_GAUGE, type Dozer } from './dozer';
import { ANCHORS, bladeMesh, machineMeshes, type MachineBody, type MachineMeshes } from './machine';
import { bar, box, coin, cylinder, gem, moved, square } from './meshes';
import { hide, place, placeAlong, placePart, placeQuat } from './matrix';
import type { LegPose } from './spider';
import { BARREL_COLOUR, BAR_COLOUR, COIN_COLOUR, GEM_ALBEDO, TRACK_MARK, WALL_COLOUR, type Rgb } from './palette';
import { BAR, BARREL_KIND, BRICK_KIND, KINDS, KIND_RADIUS, type World } from './physics';
import { MATERIAL_STRIDE } from 'artshape-render/game/renderer';
import { BRICK_SIZE } from './walls';

/** What the moving scene does to the renderer. */
export interface DynamicTarget {
  setDynamic(groups: GameGroup[]): void;
  move(group: number, matrices: Float32Array, count?: number): void;
  tint(group: number, materials: Float32Array): void;
}

export interface DynamicOptions {
  bodyCapacity: number;
  /** How many of each kind past the coins can be drawn at once; the last two are gold bars and bricks. */
  kindCapacity: readonly number[];
  bots: number;
  botScale: number;
  botBladeWidth: number;
  bladeWidth: number;
  paint: { colour: Rgb; roughness: number };
  /** The track marks, a page of placements each. */
  trackPages: readonly Float32Array[];
}

/** A drone as it is drawn: its machine. */
export interface DrawnBot {
  dozer: Dozer;
}

export interface DynamicFrame {
  world: World;
  brickGrade: Uint8Array;
  dozer: Dozer;
  bots: readonly DrawnBot[];
  /** The rooms whose belts run. */
  belts: readonly number[];
  flag: boolean;
  /** The track marks: each page's count, and which pages have changed. */
  tracks: { counts: readonly number[]; dirty: ReadonlySet<number> };
  /** The Spiderdozer's legs, where they are; null on tracks. */
  legs: readonly LegPose[] | null;
  /** How a barrel is, by slot: standing, its fuse lit, or lit and in the bright half of a flash. */
  barrel: (i: number) => 'idle' | 'lit' | 'flash';
  t: number;
}

const TREAD_BARS = 9;
/** How far a tread bar goes round its track. */
const TREAD_LOOP = 6.4;
const STRIPE_CAPACITY = 160;
/** The pennant: a pole and this many slats waving behind it. */
const FLAG_SLATS = 5;

/** The groups, in the order they are handed to the renderer. */
const COINS = 0,
  GEMS = 1,
  HULL = 5,
  DARK = 6,
  METAL = 7,
  GLASS = 8,
  BLADE = 9,
  TREADS = 10,
  BOT_HULL = 11,
  BOT_DARK = 12,
  BOT_METAL = 13,
  BOT_GLASS = 14,
  BOT_BLADE = 15,
  STRIPES = 16,
  POLE = 17,
  FLAG = 18,
  BARS = 19,
  RUBBLE = 20,
  BARRELS = 23,
  HOOPS = 24,
  LEGS_GROUP = 25,
  TRACKS = 26;
/** A leg is two bones, each a placement; eight legs. */
const LEG_PARTS = 2,
  LEG_COUNT = 8;
/** The bright steel and the glass, the same on every machine. */
const METAL_ALBEDO: Rgb = [0.6, 0.62, 0.66],
  METAL_ROUGHNESS = 0.3,
  GLASS_ALBEDO: Rgb = [0.2, 0.32, 0.42],
  GLASS_ROUGHNESS = 0.06,
  DARK_ALBEDO: Rgb = [0.15, 0.15, 0.17];
/** A barrel's colour standing, lit, and in a flash; roughness last. */
const BARREL_IDLE = [...BARREL_COLOUR, 0.5],
  BARREL_LIT = [0.8, 0.12, 0.06, 0.4],
  BARREL_FLASH = [3.2, 2.6, 1.0, 0.3];

/** How far a tread bar is along its track, for the run the track has done; the spacing of the tread bars, too. */
export const TREAD_PITCH = TREAD_LOOP / TREAD_BARS;

export class DynamicScene {
  readonly groups: GameGroup[];
  private readonly coinM: Float32Array;
  private readonly gemM: Float32Array[];
  private readonly rubbleM: Float32Array[];
  /** The one matrix every part of the player's machine is placed by, and the drones' each. */
  private readonly machineM = new Float32Array(16);
  private readonly botM: Float32Array;
  private readonly treadM: Float32Array;
  /** The machine's parts as it stands now, for whoever asks what is painted and what is not. */
  machineParts: MachineMeshes;
  /** The group the Spiderdozer's legs are drawn in. */
  readonly legsGroup = LEGS_GROUP;
  private readonly legM = new Float32Array(LEG_COUNT * LEG_PARTS * 16);
  private body: MachineBody = 'dozer';
  private readonly stripeM = new Float32Array(STRIPE_CAPACITY * 16);
  private readonly poleM = new Float32Array(16);
  private readonly flagM = new Float32Array(FLAG_SLATS * 16);
  private readonly counts = new Array<number>(KINDS).fill(0);
  private readonly rubble = [0, 0, 0];
  private readonly barrelM: Float32Array;
  private readonly barrelMat: Float32Array<ArrayBuffer>;

  constructor(
    private readonly target: DynamicTarget,
    private readonly options: DynamicOptions,
  ) {
    const { bodyCapacity, kindCapacity, bots } = options;
    this.coinM = new Float32Array(bodyCapacity * 16);
    this.gemM = kindCapacity.map((n) => new Float32Array(Math.max(1, n) * 16));
    this.rubbleM = [1, 2, 3].map(() => new Float32Array(kindCapacity[BRICK_KIND] * 16));
    this.barrelM = new Float32Array(Math.max(1, kindCapacity[BARREL_KIND]) * 16);
    this.barrelMat = new Float32Array(Math.max(1, kindCapacity[BARREL_KIND]) * MATERIAL_STRIDE);
    this.treadM = new Float32Array((1 + bots) * TREAD_BARS * 2 * 16);
    this.botM = new Float32Array(bots * 16);

    const machine = machineMeshes();
    this.machineParts = machine;
    const gemMesh = gem(1.05, 2.3);
    this.groups = [
      { mesh: coin(0.52, 0.26, 0), matrices: this.coinM, count: 0, albedo: COIN_COLOUR, roughness: 0.26 },
      { mesh: gemMesh, matrices: this.gemM[1], count: 0, albedo: GEM_ALBEDO[1], roughness: 0.28 },
      { mesh: gemMesh, matrices: this.gemM[2], count: 0, albedo: GEM_ALBEDO[2], roughness: 0.28 },
      { mesh: gemMesh, matrices: this.gemM[3], count: 0, albedo: GEM_ALBEDO[3], roughness: 0.28 },
      { mesh: gemMesh, matrices: this.gemM[4], count: 0, albedo: GEM_ALBEDO[4], roughness: 0.15 },
      {
        mesh: machine.paint,
        matrices: this.machineM,
        albedo: options.paint.colour,
        roughness: options.paint.roughness,
      },
      { mesh: machine.dark, matrices: this.machineM, albedo: DARK_ALBEDO, roughness: 0.75 },
      { mesh: machine.metal, matrices: this.machineM, albedo: METAL_ALBEDO, roughness: METAL_ROUGHNESS },
      { mesh: machine.glass, matrices: this.machineM, albedo: GLASS_ALBEDO, roughness: GLASS_ROUGHNESS },
      { mesh: bladeMesh(options.bladeWidth), matrices: this.machineM, albedo: [0.4, 0.42, 0.48], roughness: 0.35 },
      {
        mesh: box(0.55, 1.9, 0.35),
        matrices: this.treadM,
        count: TREAD_BARS * 2,
        albedo: [0.3, 0.3, 0.32],
        roughness: 0.8,
      },
      // the robo-dozers: the same parts, white where the player's are painted, with their beacon and aerial in orange
      { mesh: machine.paint, matrices: this.botM, count: 0, albedo: [0.88, 0.9, 0.92], roughness: 0.45 },
      {
        mesh: mergeMeshes([machine.dark, machine.drone]),
        matrices: this.botM,
        count: 0,
        albedo: [0.95, 0.45, 0.1],
        roughness: 0.6,
      },
      { mesh: machine.metal, matrices: this.botM, count: 0, albedo: METAL_ALBEDO, roughness: METAL_ROUGHNESS },
      { mesh: machine.glass, matrices: this.botM, count: 0, albedo: GLASS_ALBEDO, roughness: GLASS_ROUGHNESS },
      {
        mesh: bladeMesh(options.botBladeWidth),
        matrices: this.botM,
        count: 0,
        albedo: [0.4, 0.42, 0.48],
        roughness: 0.35,
      },
      { mesh: box(0.5, 1, 0.15), matrices: this.stripeM, count: 0, albedo: [0.9, 0.78, 0.3], roughness: 0.5 },
      {
        mesh: cylinder(0.09, ANCHORS.poleHeight, 6),
        matrices: this.poleM,
        count: 0,
        albedo: [0.3, 0.3, 0.32],
        roughness: 0.5,
      },
      {
        mesh: box(0.4, 0.06, 0.9, true),
        matrices: this.flagM,
        count: 0,
        albedo: flagColour(options.paint.colour),
        roughness: 0.6,
      },
      // a gold bar, lying on the floor where the physics holds its ball
      {
        mesh: bar(2.6, 1.3, 0.9, KIND_RADIUS[BAR]),
        matrices: this.gemM[BAR],
        count: 0,
        albedo: BAR_COLOUR,
        roughness: 0.18,
      },
      // bricks off the walls, lying where the physics holds their balls
      ...[1, 2, 3].map((grade) => ({
        mesh: moved(
          box(BRICK_SIZE[0], BRICK_SIZE[1] * 0.55, BRICK_SIZE[2], true),
          0,
          0,
          BRICK_SIZE[2] / 2 - KIND_RADIUS[BRICK_KIND],
        ),
        matrices: this.rubbleM[grade - 1],
        count: 0,
        albedo: WALL_COLOUR[grade].slice(0, 3) as Rgb,
        roughness: WALL_COLOUR[grade][3],
      })),
      // the barrels, where the physics holds their balls: the body, which flashes when lit, and its hoops
      { mesh: barrelBody(KIND_RADIUS[BARREL_KIND]), matrices: this.barrelM, materials: this.barrelMat, count: 0 },
      {
        mesh: barrelHoops(KIND_RADIUS[BARREL_KIND]),
        matrices: this.barrelM,
        count: 0,
        albedo: [0.85, 0.65, 0.08] as Rgb,
        roughness: 0.45,
      },
      // the Spiderdozer's legs, a bone a placement, from a unit cylinder stood along each
      { mesh: cylinder(1, 1, 7), matrices: this.legM, count: 0, albedo: METAL_ALBEDO, roughness: METAL_ROUGHNESS },
      // the marks the tracks have left, a page a group, so a new mark writes one page and not all of them
      ...options.trackPages.map((matrices) => ({
        mesh: square(),
        matrices,
        count: 0,
        albedo: TRACK_MARK,
        roughness: 0.98,
      })),
    ];
    target.setDynamic(this.groups);
  }

  /** The coins drawn at a level of detail, from the ladder in `meshes.ts`. */
  setCoinDetail(level: number) {
    this.groups[COINS].mesh = coin(0.52, 0.26, level);
    this.target.setDynamic(this.groups);
  }

  /** The body the machine stands on: its tracks, or the Spiderdozer's legs. */
  setBody(body: MachineBody) {
    if (body === this.body) return;
    this.body = body;
    this.machineParts = machineMeshes(body);
    this.groups[HULL].mesh = this.machineParts.paint;
    this.groups[DARK].mesh = this.machineParts.dark;
    this.groups[METAL].mesh = this.machineParts.metal;
    this.groups[GLASS].mesh = this.machineParts.glass;
    this.target.setDynamic(this.groups);
  }

  /** A wider blade bought. */
  setBlade(width: number) {
    this.groups[BLADE].mesh = bladeMesh(width);
    this.target.setDynamic(this.groups);
  }

  /** A new coat of paint, and a pennant that shows against it. */
  setPaint(paint: { colour: Rgb; roughness: number }) {
    this.target.tint(HULL, new Float32Array([...paint.colour, paint.roughness]));
    this.target.tint(FLAG, new Float32Array([...flagColour(paint.colour), 0.6]));
  }

  /** Everything where it is this frame. How many bodies are awake, for the counters. */
  write(f: DynamicFrame): number {
    const awake = this.bodies(f.world, f.brickGrade);
    this.barrels(f.world, f.barrel);
    this.machines(f);
    this.stripes(f.belts, f.t);
    this.pennant(f.dozer, f.flag, f.t);
    // only the pages of track marks that changed; the count kept on the group too, for when the groups are set again
    for (const p of f.tracks.dirty) {
      this.groups[TRACKS + p].count = f.tracks.counts[p];
      this.target.move(TRACKS + p, this.options.trackPages[p], f.tracks.counts[p]);
    }
    return awake;
  }

  private bodies(world: World, brickGrade: Uint8Array): number {
    const { counts, rubble, coinM, gemM, rubbleM } = this;
    counts.fill(0);
    rubble.fill(0);
    let awake = 0;
    const { x, y, z, q, kind, alive, asleep } = world;
    for (let i = 0; i < world.count; i++) {
      if (!alive[i]) continue;
      if (!asleep[i]) awake++;
      const k = kind[i];
      if (k === BRICK_KIND) {
        const g = brickGrade[i] - 1;
        if (rubble[g] * 16 < rubbleM[g].length) placeQuat(rubbleM[g], rubble[g]++, x[i], y[i], z[i], q, i * 4);
        continue;
      }
      const m = k === 0 ? coinM : gemM[k];
      if (counts[k] * 16 >= m.length) continue;
      placeQuat(m, counts[k]++, x[i], y[i], z[i], q, i * 4);
    }
    this.target.move(COINS, coinM, counts[0]);
    for (let k = 1; k <= 4; k++) this.target.move(GEMS + k - 1, gemM[k], counts[k]);
    this.target.move(BARS, gemM[BAR], counts[BAR]);
    for (let g = 0; g < 3; g++) this.target.move(RUBBLE + g, rubbleM[g], rubble[g]);
    return awake;
  }

  /** The barrels where they are, each coloured for how it is. */
  private barrels(world: World, state: DynamicFrame['barrel']) {
    const { barrelM, barrelMat } = this;
    const { x, y, z, q, kind, alive } = world;
    let n = 0;
    for (let i = 0; i < world.count && n * 16 < barrelM.length; i++) {
      if (!alive[i] || kind[i] !== BARREL_KIND) continue;
      placeQuat(barrelM, n, x[i], y[i], z[i], q, i * 4);
      const s = state(i);
      barrelMat.set(s === 'flash' ? BARREL_FLASH : s === 'lit' ? BARREL_LIT : BARREL_IDLE, n * MATERIAL_STRIDE);
      n++;
    }
    this.target.move(BARRELS, barrelM, n);
    this.target.move(HOOPS, barrelM, n);
    if (n) this.target.tint(BARRELS, barrelMat);
  }

  private machines(f: DynamicFrame) {
    const { dozer, bots } = f;
    const { target, treadM } = this;
    place(this.machineM, 0, dozer.x, dozer.y, 0, dozer.yaw);
    for (const g of [HULL, DARK, METAL, GLASS, BLADE]) target.move(g, this.machineM);
    // each track's bars, run round with how far the track has run; a drone's at its scale, its run
    // measured in the player's lengths so a bar laps a smaller track as often
    [dozer, ...bots.map((b) => b.dozer)].forEach((d, j) => {
      const k = d.scale;
      // the Spiderdozer has no tracks to run bars round
      if (j === 0 && this.body === 'spider') {
        for (let i = 0; i < TREAD_BARS * 2; i++) hide(treadM, i);
        return;
      }
      for (let i = 0; i < TREAD_BARS; i++) {
        const along = (run: number) =>
          (((((i * TREAD_PITCH + run / k) % TREAD_LOOP) + TREAD_LOOP) % TREAD_LOOP) - TREAD_LOOP / 2) * k;
        const o = j * TREAD_BARS * 2 + i * 2;
        placePart(treadM, o, d.x, d.y, 0, d.yaw, along(d.trackLeft), TRACK_GAUGE * k, 1.9 * k, 0, 0, k, k, k);
        placePart(treadM, o + 1, d.x, d.y, 0, d.yaw, along(d.trackRight), -TRACK_GAUGE * k, 1.9 * k, 0, 0, k, k, k);
      }
    });
    target.move(TREADS, treadM, (1 + bots.length) * TREAD_BARS * 2);
    // the legs: a femur from each hip to its knee, a tibia on to the foot
    const legs = this.body === 'spider' ? f.legs : null;
    const bones = legs ? Math.min(legs.length, LEG_COUNT) * LEG_PARTS : 0;
    legs?.slice(0, LEG_COUNT).forEach((l, k) => {
      placeAlong(this.legM, k * LEG_PARTS, l.hip, l.knee, 0.32);
      placeAlong(this.legM, k * LEG_PARTS + 1, l.knee, l.foot, 0.21);
    });
    this.groups[LEGS_GROUP].count = bones;
    target.move(LEGS_GROUP, this.legM, bones);
    const s = this.options.botScale;
    bots.forEach(({ dozer: b }, i) => placePart(this.botM, i, b.x, b.y, 0, b.yaw, 0, 0, 0, 0, 0, s, s, s));
    for (const g of [BOT_HULL, BOT_DARK, BOT_METAL, BOT_GLASS, BOT_BLADE]) target.move(g, this.botM, bots.length);
  }

  /** The bars across each running belt, carried along it. */
  private stripes(belts: readonly number[], t: number) {
    let n = 0;
    for (const a of belts) {
      const s = AREAS[a].belt!.spec;
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0),
        yaw = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      const cx = (s.x0 + s.x1) / 2,
        cy = (s.y0 + s.y1) / 2;
      const gap = 2.6,
        bars = Math.floor(len / gap);
      for (let i = 0; i < bars && n < STRIPE_CAPACITY; i++) {
        const along = ((((i * gap + t * s.speed) % len) + len) % len) - len / 2;
        placePart(this.stripeM, n++, cx, cy, 0.35, yaw, along, 0, 0, 0, 0, 1, s.width * 0.9, 1);
      }
    }
    this.target.move(STRIPES, this.stripeM, n);
  }

  /** The pennant: a pole on the cab's roof, and slats that wave behind it, harder the faster the dozer goes. */
  private pennant(dozer: Dozer, flag: boolean, t: number) {
    if (flag) {
      const [px, py, pz] = ANCHORS.pole;
      placePart(this.poleM, 0, dozer.x, dozer.y, 0, dozer.yaw, px, py, pz);
      const wind = 0.5 + Math.min(1, Math.abs(dozer.speed) / 10);
      for (let k = 0; k < FLAG_SLATS; k++) {
        const wave = Math.sin(t * 9 * wind - k * 1.1) * 0.12 * (k + 1);
        const x = px - 0.2 - k * 0.38,
          sway = Math.cos(t * 9 * wind - k * 1.1) * 0.3;
        placePart(
          this.flagM,
          k,
          dozer.x,
          dozer.y,
          0,
          dozer.yaw,
          x,
          py + wave,
          pz + ANCHORS.poleHeight - 0.5 - k * 0.03,
          sway,
          0,
          1,
          1,
          1 - k * 0.12,
        );
      }
    }
    this.target.move(POLE, this.poleM, flag ? 1 : 0);
    this.target.move(FLAG, this.flagM, flag ? FLAG_SLATS : 0);
  }
}

/**
 * A barrel, about its middle, which is where the physics holds its ball: a
 * body bulging at its waist, `radius` from the middle to its ends.
 */
function barrelBody(radius: number): Mesh {
  const h = radius * 1.9;
  return mergeMeshes([
    moved(cylinder(radius * 0.8, h * 0.22, 14), 0, 0, -h / 2),
    moved(cylinder(radius * 0.88, h * 0.56, 14), 0, 0, -h * 0.28),
    moved(cylinder(radius * 0.8, h * 0.22, 14), 0, 0, h * 0.28),
  ]);
}

/** A barrel's two hoops, standing proud of its body a little above and below its waist. */
function barrelHoops(radius: number): Mesh {
  const h = radius * 1.9;
  return mergeMeshes([
    moved(cylinder(radius * 0.92, h * 0.07, 14), 0, 0, -h * 0.25),
    moved(cylinder(radius * 0.92, h * 0.07, 14), 0, 0, h * 0.18),
  ]);
}

/** The pennant is red, unless the hull is: then it is white, so it shows. */
export function flagColour([r, g, b]: Rgb): Rgb {
  return r > 0.6 && g < 0.5 && b < 0.75 ? [0.95, 0.95, 0.95] : [0.9, 0.15, 0.15];
}
