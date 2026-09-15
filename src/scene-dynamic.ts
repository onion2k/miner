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
import { BLADE_HEIGHT, TRACK_GAUGE, bladePieces, type Dozer } from './dozer';
import { bar, ball, box, coin, cylinder, gem, moved, square, turned } from './meshes';
import { place, placePart, placeQuat } from './matrix';
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
  BLADE = 7,
  TREADS = 8,
  BOT_HULL = 9,
  BOT_DARK = 10,
  BOT_BLADE = 11,
  STRIPES = 12,
  POLE = 13,
  FLAG = 14,
  BARS = 15,
  RUBBLE = 16,
  BARRELS = 19,
  HOOPS = 20,
  TRACKS = 21;
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
  private readonly hullM = new Float32Array(16);
  private readonly darkM = new Float32Array(16);
  private readonly bladeM = new Float32Array(16);
  private readonly treadM: Float32Array;
  private readonly botHullM: Float32Array;
  private readonly botDarkM: Float32Array;
  private readonly botBladeM: Float32Array;
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
    this.botHullM = new Float32Array(bots * 16);
    this.botDarkM = new Float32Array(bots * 16);
    this.botBladeM = new Float32Array(bots * 16);

    const hull = mergeMeshes([
      moved(box(5.4, 3.4, 1.7), 0, 0, 0.8), // the body
      moved(box(2.8, 2.8, 1.1), 1.1, 0, 2.5), // the hood
      moved(box(2.3, 3.0, 2.3), -1.5, 0, 2.5), // the cab
      moved(box(0.7, 0.5, 0.4), 2.5, 0.9, 2.9), // a headlamp each side
      moved(box(0.7, 0.5, 0.4), 2.5, -0.9, 2.9),
    ]);
    const dark = mergeMeshes([
      moved(box(6.6, 1.7, 1.9), 0, 2.15, 0), // the tracks
      moved(box(6.6, 1.7, 1.9), 0, -2.15, 0),
      moved(box(2.4, 3.1, 1.1), -1.5, 0, 3.2), // the glass, a band round the cab
      moved(cylinder(0.26, 1.7, 8), 1.7, 0.9, 3.5), // the exhaust
      moved(box(3.4, 0.45, 0.45), 2.6, 2.4, 1.7), // the blade's arms
      moved(box(3.4, 0.45, 0.45), 2.6, -2.4, 1.7),
      moved(box(0.9, 3.6, 0.4), -3.2, 0, 1.9), // a rear step
    ]);
    // the robo-dozer's beacon, on the cab roof, so it reads as a machine and not a second player
    const botExtras = mergeMeshes([moved(ball(0.45, 5, 8), -1.5, 0, 4.2), moved(cylinder(0.12, 0.6, 6), -1.5, 0, 3.6)]);
    const gemMesh = gem(1.05, 2.3);
    this.groups = [
      { mesh: coin(0.52, 0.26, 0), matrices: this.coinM, count: 0, albedo: COIN_COLOUR, roughness: 0.26 },
      { mesh: gemMesh, matrices: this.gemM[1], count: 0, albedo: GEM_ALBEDO[1], roughness: 0.28 },
      { mesh: gemMesh, matrices: this.gemM[2], count: 0, albedo: GEM_ALBEDO[2], roughness: 0.28 },
      { mesh: gemMesh, matrices: this.gemM[3], count: 0, albedo: GEM_ALBEDO[3], roughness: 0.28 },
      { mesh: gemMesh, matrices: this.gemM[4], count: 0, albedo: GEM_ALBEDO[4], roughness: 0.15 },
      { mesh: hull, matrices: this.hullM, albedo: options.paint.colour, roughness: options.paint.roughness },
      { mesh: dark, matrices: this.darkM, albedo: [0.15, 0.15, 0.17], roughness: 0.75 },
      { mesh: bladeMesh(options.bladeWidth), matrices: this.bladeM, albedo: [0.4, 0.42, 0.48], roughness: 0.35 },
      {
        mesh: box(0.55, 1.9, 0.35),
        matrices: this.treadM,
        count: TREAD_BARS * 2,
        albedo: [0.3, 0.3, 0.32],
        roughness: 0.8,
      },
      {
        mesh: mergeMeshes([hull, botExtras]),
        matrices: this.botHullM,
        count: 0,
        albedo: [0.88, 0.9, 0.92],
        roughness: 0.45,
      },
      { mesh: dark, matrices: this.botDarkM, count: 0, albedo: [0.95, 0.45, 0.1], roughness: 0.6 },
      {
        mesh: bladeMesh(options.botBladeWidth),
        matrices: this.botBladeM,
        count: 0,
        albedo: [0.4, 0.42, 0.48],
        roughness: 0.35,
      },
      { mesh: box(0.5, 1, 0.15), matrices: this.stripeM, count: 0, albedo: [0.9, 0.78, 0.3], roughness: 0.5 },
      { mesh: cylinder(0.09, 4.2, 6), matrices: this.poleM, count: 0, albedo: [0.3, 0.3, 0.32], roughness: 0.5 },
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

  private machines({ dozer, bots }: DynamicFrame) {
    const { target, treadM } = this;
    place(this.hullM, 0, dozer.x, dozer.y, 0, dozer.yaw);
    place(this.darkM, 0, dozer.x, dozer.y, 0, dozer.yaw);
    place(this.bladeM, 0, dozer.x, dozer.y, 0, dozer.yaw);
    target.move(HULL, this.hullM);
    target.move(DARK, this.darkM);
    target.move(BLADE, this.bladeM);
    // each track's bars, run round with how far the track has run; a drone's at its scale, its run
    // measured in the player's lengths so a bar laps a smaller track as often
    [dozer, ...bots.map((b) => b.dozer)].forEach((d, j) => {
      const k = d.scale;
      for (let i = 0; i < TREAD_BARS; i++) {
        const along = (run: number) =>
          (((((i * TREAD_PITCH + run / k) % TREAD_LOOP) + TREAD_LOOP) % TREAD_LOOP) - TREAD_LOOP / 2) * k;
        const o = j * TREAD_BARS * 2 + i * 2;
        placePart(treadM, o, d.x, d.y, 0, d.yaw, along(d.trackLeft), TRACK_GAUGE * k, 1.9 * k, 0, 0, k, k, k);
        placePart(treadM, o + 1, d.x, d.y, 0, d.yaw, along(d.trackRight), -TRACK_GAUGE * k, 1.9 * k, 0, 0, k, k, k);
      }
    });
    target.move(TREADS, treadM, (1 + bots.length) * TREAD_BARS * 2);
    const s = this.options.botScale;
    bots.forEach(({ dozer: b }, i) => {
      placePart(this.botHullM, i, b.x, b.y, 0, b.yaw, 0, 0, 0, 0, 0, s, s, s);
      placePart(this.botDarkM, i, b.x, b.y, 0, b.yaw, 0, 0, 0, 0, 0, s, s, s);
      placePart(this.botBladeM, i, b.x, b.y, 0, b.yaw, 0, 0, 0, 0, 0, s, s, s);
    });
    target.move(BOT_HULL, this.botHullM, bots.length);
    target.move(BOT_DARK, this.botDarkM, bots.length);
    target.move(BOT_BLADE, this.botBladeM, bots.length);
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
      placePart(this.poleM, 0, dozer.x, dozer.y, 0, dozer.yaw, -2.2, -1.1, 3.6);
      const wind = 0.5 + Math.min(1, Math.abs(dozer.speed) / 10);
      for (let k = 0; k < FLAG_SLATS; k++) {
        const wave = Math.sin(t * 9 * wind - k * 1.1) * 0.12 * (k + 1);
        const x = -2.2 - 0.2 - k * 0.38,
          sway = Math.cos(t * 9 * wind - k * 1.1) * 0.3;
        placePart(
          this.flagM,
          k,
          dozer.x,
          dozer.y,
          0,
          dozer.yaw,
          x,
          -1.1 + wave,
          7.3 - k * 0.03,
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
 * The blade, in the dozer's own frame: its pieces along the arc, each a plate
 * with a lip along the top and a cutting edge along the bottom.
 */
function bladeMesh(width: number): Mesh {
  return mergeMeshes(
    bladePieces(width).map((p) =>
      moved(
        turned(
          mergeMeshes([
            box(0.35, p.length, BLADE_HEIGHT, true),
            moved(box(0.7, p.length, 0.22, true), 0.17, 0, BLADE_HEIGHT / 2 - 0.11),
            moved(box(0.6, p.length, 0.18, true), 0.12, 0, -BLADE_HEIGHT / 2 + 0.09),
          ]),
          p.turn,
        ),
        p.x,
        p.y,
        BLADE_HEIGHT / 2,
      ),
    ),
  );
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
