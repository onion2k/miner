/**
 * The half of the scene that does not move: the rock and floor and the
 * stones on them, the hole, the brick walls still standing, the lamps, and
 * the belts that run.
 *
 * Built as groups for the renderer from the cave and what has become of it,
 * and built again whenever any of that changes: a wall hit, a lamp knocked
 * over. The rock and floor, which are slow to build, only when a chamber
 * has been broken into or the way out opened, which is all that changes their
 * shape; the rest is quick.
 */
import { FLOW_CRUST, FLOW_DRIFT, FLOW_RIPPLE, packFlow } from 'artshape-render/game/flow';
import { MATERIAL_STRIDE, PATTERN_STRIDE, type GameGroup } from 'artshape-render/game/renderer';
import type { Mesh } from 'artshape-render/mesh/types';
import { LAMP_HEIGHT, TILE, type Cave } from './cave';
import { FLOW_LOOK, LAVA_LIGHT, RIDE, flowLights } from './currents';
import { WALL_STRENGTH } from './economy';
import { HOLE_CORD, HOLE_LAMP_HEIGHT, holeLamps, lampPose } from './lamps';
import { box, collar, cone, cylinder, gem, lump, moved, pit } from './meshes';
import { hide, identity, place, placePart } from './matrix';
import { BAR_COLOUR, FLOOR_TONES, GEM_ALBEDO, ROCK_TONES, WALL_COLOUR, type Rgb } from './palette';
import { BAR } from './physics';
import { buildTerrain, type Terrain } from './terrain';
import {
  PROP_MESHES,
  biomeStyle,
  decorate,
  groundTone,
  lampColour,
  runwayFeatures,
  tint,
  type Decor,
  type FeatureLight,
  type PropKind,
} from './biomes';
import { BRICK_SIZE, standingBricks } from './walls';

/** The collar of a drain: a hole's, a shade darker, so the two are not taken for each other from the ends of a current. */
const DRAIN_COLLAR: Rgb = [0.23, 0.16, 0.1];

/** The renderer's kind of flowing surface for each of the game's. */
const FLOW_KIND = { ripple: FLOW_RIPPLE, crust: FLOW_CRUST, drift: FLOW_DRIFT } as const;
/** How thick a current's strip is, and how far its top stands over the level of the floor, which is never higher than nought. */
const STRIP_THICK = 0.2,
  STRIP_TOP = 0.08;

/** What has become of the cave, as the static scene is drawn from it. */
export interface StaticState {
  /** The way out is open. */
  open: boolean;
  secrets: readonly boolean[];
  walls: readonly boolean[];
  wallDamage: readonly number[];
  lampsBroken: readonly number[];
  /** The belts bought and running, by their place in the cave's list. */
  belts: readonly number[];
}

export class StaticScene {
  private readonly meshes = {
    stones: [lump(1), lump(2), lump(3)],
    spire: cone(1, 1, 6),
    brick: box(1, 1, 1, true),
    stud: gem(1.05, 2.3),
    // a runway light's fitting: a short stud, its top just above the lens
    fitting: cylinder(0.5, 0.6, 6),
    lampPost: cylinder(0.14, LAMP_HEIGHT, 6),
    lampHead: moved(box(0.8, 0.8, 0.9, true), 0, 0, 0.1),
    // a shade hung from its top: a short drum
    hanging: moved(cylinder(0.6, 0.7, 10), 0, 0, -0.7),
    beltBase: box(1, 1, 1),
    rail: box(1, 1, 1),
    dropMark: box(1, 1, 1),
  };
  private readonly propMeshes = Object.fromEntries(
    Object.entries(PROP_MESHES).map(([kind, make]) => [kind, make()]),
  ) as Record<PropKind, Mesh>;
  /**
   * The floor round each hole and the pit under it, drawn at the hole. The collar leaves out the
   * three tiles each way the floor leaves out, and a little more so no seam shows between them; see
   * where it is placed for why that overlap does not flicker.
   */
  private readonly holes: { collar: Mesh; pit: Mesh }[];
  /** The same for each drain: cut as a hole is, but with no lamp over it and no glow, and a darker collar. */
  private readonly drains: { collar: Mesh; pit: Mesh }[];
  /**
   * Each current's strip, and a bank's for a stream: meshes of their real size, since a flowing surface is
   * drawn from the mesh's own units and one stretched to fit would have its ripples stretched with it.
   */
  private readonly strips: { bed: Mesh; bank: Mesh | null }[];
  /** The lights along the currents that give light, the same every time. */
  private readonly flowLit: FeatureLight[];
  /** The lamps hanging over the holes, all together. */
  private readonly overHoles: [number, number][];
  private terrain: (Terrain & { key: string; decor: Decor; runway: FeatureLight[]; features: FeatureLight[] }) | null =
    null;

  constructor(private readonly cave: Cave) {
    this.holes = cave.holes.map((h) => ({
      collar: collar(TILE * 3 + 0.2, h.radius),
      pit: pit(h.radius, h.depth),
    }));
    this.drains = cave.drains.map((d) => ({
      collar: collar(TILE * 3 + 0.2, d.radius),
      pit: pit(d.radius, d.depth),
    }));
    this.strips = cave.currents.map((c) => {
      const length = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
      return {
        bed: box(length, c.width, STRIP_THICK),
        bank: c.flow === 'water' ? box(length, FLOW_LOOK.water.foamWidth, STRIP_THICK) : null,
      };
    });
    this.flowLit = cave.currents.flatMap((c) =>
      flowLights(c).map(([x, y], k): FeatureLight => ({
        x,
        y,
        z: LAVA_LIGHT.z,
        colour: [...LAVA_LIGHT.colour],
        radius: LAVA_LIGHT.radius,
        intensity: LAVA_LIGHT.intensity,
        beat: 'flicker',
        // the flow glows of itself: a glow on the screen over each light would be a row of lamps down it
        glow: 0,
        phase: k * 0.37,
        biome: 'lava',
      })),
    );
    this.overHoles = holeLamps(cave.holes).flat();
  }

  /** The lights that are part of the biomes, and the runway's along the cuttings, as the terrain last built stands. */
  get features(): readonly FeatureLight[] {
    return this.terrain?.features ?? [];
  }

  groups(state: StaticState): GameGroup[] {
    return [
      ...this.ground(state),
      // A hundredth under the floor: where it overlaps the floor the floor wins the depth test
      // outright, rather than the two fighting over which is drawn.
      ...this.holes.flatMap((hole, k): GameGroup[] => {
        const h = this.cave.holes[k];
        return [
          { mesh: hole.collar, matrices: at(h.x, h.y, -0.01), albedo: [0.33, 0.23, 0.145], roughness: 0.95 },
          { mesh: hole.pit, matrices: at(h.x, h.y, 0), albedo: [0.04, 0.035, 0.05], roughness: 0.95 },
        ];
      }),
      ...this.drains.flatMap((drain, k): GameGroup[] => {
        const d = this.cave.drains[k];
        return [
          { mesh: drain.collar, matrices: at(d.x, d.y, -0.01), albedo: DRAIN_COLLAR, roughness: 0.95 },
          { mesh: drain.pit, matrices: at(d.x, d.y, 0), albedo: [0.02, 0.02, 0.03], roughness: 0.95 },
        ];
      }),
      // the currents are always there, so they come before what comes and goes; the belts, which are bought, are last
      ...this.currents(),
      ...this.lamps(state),
      ...this.walls(state),
      ...this.belts(state),
    ];
  }

  /** The rock and the floor, the stones and spires on them. */
  private ground(state: StaticState): GameGroup[] {
    const key = state.secrets.map((r) => (r ? 1 : 0)).join('') + (state.open ? 'o' : '');
    if (this.terrain?.key !== key) {
      const { spec } = this.cave;
      const built = buildTerrain(this.cave, [...state.secrets], biomeStyle(spec), state.open);
      const decor = decorate(spec, built.samples),
        runway = runwayFeatures(this.cave, state.open);
      // put together here, once, so the lighting is not handed a new list every frame
      this.terrain = { key, ...built, decor, runway, features: [...decor.lights, ...runway, ...this.flowLit] };
    }
    const terrain = this.terrain;
    const surface: GameGroup[] = terrain.groups.map((g) => {
      const c = groundTone(this.cave.spec, g.palette, g.rock, g.tone);
      return { mesh: g.mesh, matrices: identity(), materials: new Float32Array(c) };
    });
    const stones: GameGroup[] = this.meshes.stones.map((mesh, shape) => {
      const mine = terrain.stones.filter((st) => st.shape === shape);
      const [m, mat] = pool(mine.length);
      mine.forEach((st, i) => {
        placePart(m, i, st.x, st.y, st.z, st.yaw, 0, 0, 0, 0, st.tilt, st.size[0], st.size[1], st.size[2]);
        const base = tint(
          this.cave.spec,
          (st.rock ? ROCK_TONES[1] : FLOOR_TONES[0]).slice(0, 3) as Rgb,
          st.x,
          st.y,
          (b) => (st.rock ? b.stone.rock : b.stone.floor),
        );
        const k = 0.75 + st.shade * 0.5;
        mat.set([base[0] * k, base[1] * k, base[2] * k, 0.9], i * MATERIAL_STRIDE);
      });
      return { mesh, matrices: m, materials: mat, count: mine.length };
    });
    const [spireM, spireMat] = pool(terrain.spires.length);
    terrain.spires.forEach((sp, i) => {
      placePart(spireM, i, sp.x, sp.y, sp.z, sp.yaw, 0, 0, 0, 0, sp.tilt, sp.radius, sp.radius, sp.height);
      const k = 0.8 + sp.shade * 0.4;
      const top = tint(
        this.cave.spec,
        ROCK_TONES[2].slice(0, 3) as Rgb,
        sp.x,
        sp.y,
        (b) => b.rock[2].slice(0, 3) as Rgb,
      );
      spireMat.set([top[0] * k, top[1] * k, top[2] * k, 0.85], i * MATERIAL_STRIDE);
    });
    return [
      ...surface,
      ...stones,
      { mesh: this.meshes.spire, matrices: spireM, materials: spireMat, count: terrain.spires.length },
      ...this.props(terrain.decor),
      ...this.fittings(terrain.runway),
    ];
  }

  /** The runway lights' fittings: a short stud under each, glowing amber so it reads in the dark. */
  private fittings(runway: readonly FeatureLight[]): GameGroup[] {
    const [m, mat] = pool(runway.length);
    runway.forEach((l, i) => {
      placePart(m, i, l.x, l.y, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1);
      mat.set([1.8, 0.95, 0.3, 0.4], i * MATERIAL_STRIDE);
    });
    return [{ mesh: this.meshes.fitting, matrices: m, materials: mat, count: runway.length }];
  }

  /** What stands in the biome: a group for each kind of thing, each thing its own colour. */
  private props(decor: Decor): GameGroup[] {
    const byKind = new Map<PropKind, Decor['props']>();
    for (const p of decor.props) {
      const list = byKind.get(p.kind);
      if (list) list.push(p);
      else byKind.set(p.kind, [p]);
    }
    const out: GameGroup[] = [];
    for (const [kind, list] of byKind) {
      const [m, mat] = pool(list.length);
      list.forEach((p, i) => {
        placePart(m, i, p.x, p.y, p.z, p.yaw, 0, 0, 0, 0, p.tilt, p.size[0], p.size[1], p.size[2]);
        mat.set([p.colour[0], p.colour[1], p.colour[2], p.roughness], i * MATERIAL_STRIDE);
      });
      out.push({ mesh: this.propMeshes[kind], matrices: m, materials: mat, count: list.length });
    }
    return out;
  }

  /** The lamps: a post each, standing or lying where it fell, a head on it, dark on one knocked over; and those over the hole. */
  private lamps(state: StaticState): GameGroup[] {
    const { lamps } = this.cave;
    const [postM] = pool(lamps.length),
      [headM, headMat] = pool(lamps.length);
    lamps.forEach((l, k) => {
      const down = state.lampsBroken.includes(k);
      const pose = lampPose(l, k, down);
      placePart(postM, k, ...pose.post, pose.yaw, 0, 0, 0, 0, pose.pitch, 1, 1, pose.postScale);
      placePart(headM, k, ...pose.head, pose.yaw, 0, 0, 0, 0, pose.pitch, 1, 1, 1);
      // the glass the colour of the lamp's light, which a biome's lamps change
      const light = lampColour(this.cave.spec, l.x, l.y),
        bright = Math.max(...light);
      const glass = light.map((c) => c / bright) as Rgb;
      headMat.set(
        down ? [0.18, 0.17, 0.16, 0.6] : [glass[0], glass[1] * 1.07, glass[2] * 1.09, 0.3],
        k * MATERIAL_STRIDE,
      );
    });
    // the lamps over the hole: a cord up into the dark, and a shade on the end of it
    const { overHoles } = this;
    const cordM = new Float32Array(overHoles.length * 16),
      shadeM = new Float32Array(overHoles.length * 16);
    overHoles.forEach(([x, y], i) => {
      placePart(cordM, i, x, y, HOLE_LAMP_HEIGHT, 0, 0, 0, 0, 0, 0, 0.4, 0.4, HOLE_CORD / LAMP_HEIGHT);
      placePart(shadeM, i, x, y, HOLE_LAMP_HEIGHT, 0, 0, 0, 0, 0, 0, 1.3, 1.3, 1.1);
    });
    const { lampPost, lampHead, hanging } = this.meshes;
    return [
      { mesh: lampPost, matrices: cordM, count: overHoles.length, albedo: [0.15, 0.15, 0.17], roughness: 0.6 },
      { mesh: hanging, matrices: shadeM, count: overHoles.length, albedo: [0.75, 1.0, 0.7], roughness: 0.3 },
      { mesh: lampPost, matrices: postM, count: lamps.length, albedo: [0.22, 0.22, 0.25], roughness: 0.5 },
      { mesh: lampHead, matrices: headM, materials: headMat, count: lamps.length },
    ];
  }

  /**
   * The brick walls still standing, each brick a shade off the next and showing the beating the
   * wall has taken. A gold brick is gold, and a gem set in a wall sits in the top of its brick.
   */
  private walls(state: StaticState): GameGroup[] {
    const bricks: { b: ReturnType<typeof standingBricks>[number]; grade: number }[] = [];
    this.cave.spec.walls.forEach((wall, w) => {
      if (state.walls[w]) return;
      const hurt = state.wallDamage[w] / WALL_STRENGTH[wall.grade];
      for (const b of standingBricks(this.cave, w, hurt)) bricks.push({ b, grade: wall.grade });
    });
    const studs = bricks.filter(({ b }) => b.treasure !== undefined && b.treasure !== BAR);
    const [brickM, brickMat] = pool(bricks.length);
    bricks.forEach(({ b, grade }, i) => {
      placePart(brickM, i, b.x, b.y, b.z, b.yaw, 0, 0, 0, 0, b.tilt, b.length, BRICK_SIZE[1], BRICK_SIZE[2]);
      const k = b.shade;
      const [r, g, bl, rough] = WALL_COLOUR[grade];
      brickMat.set(b.treasure === BAR ? [...BAR_COLOUR, 0.2] : [r * k, g * k, bl * k, rough], i * MATERIAL_STRIDE);
    });
    const [studM, studMat] = pool(studs.length);
    studs.forEach(({ b }, i) => {
      placePart(studM, i, b.x, b.y, b.z + BRICK_SIZE[2] / 2, 0, 0, 0, 0, 0, 0, 0.45, 0.45, 0.45);
      studMat.set([...GEM_ALBEDO[b.treasure!], 0.2], i * MATERIAL_STRIDE);
    });
    return [
      { mesh: this.meshes.brick, matrices: brickM, materials: brickMat, count: bricks.length },
      { mesh: this.meshes.stud, matrices: studM, materials: studMat, count: studs.length },
    ];
  }

  /**
   * Each running belt: its bed, a rail down either side, and a bar across where it ends. With two belts in
   * a cave, the bar is what says where each one delivers, and it is taller than the bed so it shows on both sides.
   */
  private belts(state: StaticState): GameGroup[] {
    const out: GameGroup[] = [];
    for (const a of state.belts) {
      const s = this.cave.spec.belts[a].spec;
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0),
        yaw = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      const cx = (s.x0 + s.x1) / 2,
        cy = (s.y0 + s.y1) / 2;
      const base = new Float32Array(16);
      placePart(base, 0, cx, cy, 0, yaw, 0, 0, 0, 0, 0, len, s.width, 0.35);
      const rails = new Float32Array(32);
      placePart(rails, 0, cx, cy, 0, yaw, 0, s.width / 2 + 0.3, 0, 0, 0, len, 0.6, 0.9);
      placePart(rails, 1, cx, cy, 0, yaw, 0, -s.width / 2 - 0.3, 0, 0, 0, len, 0.6, 0.9);
      out.push({ mesh: this.meshes.beltBase, matrices: base, albedo: [0.12, 0.12, 0.14], roughness: 0.7 });
      out.push({ mesh: this.meshes.rail, matrices: rails, albedo: [0.75, 0.55, 0.2], roughness: 0.4 });
      const mark = new Float32Array(16);
      placePart(mark, 0, s.x1, s.y1, 0, yaw, 0, 0, 0, 0, 0, 1.4, s.width + 1.8, 0.55);
      out.push({ mesh: this.meshes.dropMark, matrices: mark, albedo: [0.4, 0.9, 0.45], roughness: 0.45 });
    }
    return out;
  }

  /**
   * Each current, as what flows: a strip its own size laid along it, level with the floor, drawn as the
   * renderer's flowing surface, whose pattern runs along the strip's own length at the pace of what the
   * current carries. A stream has foam along each bank, a narrow strip of its own, so its edge shows where no
   * light falls on the water. Drawn for as long as the cave stands, since a current is never switched off.
   */
  private currents(): GameGroup[] {
    const out: GameGroup[] = [];
    this.cave.currents.forEach((c, k) => {
      const { bed, bank } = this.strips[k];
      const yaw = Math.atan2(c.y1 - c.y0, c.x1 - c.x0);
      const cx = (c.x0 + c.x1) / 2,
        cy = (c.y0 + c.y1) / 2;
      const look = FLOW_LOOK[c.flow];
      const speed = c.speed * RIDE;
      const laid = (across: number, lift: number) => {
        const m = new Float32Array(16);
        // across is to the left of the flow; the strip is turned to lie along it and is not scaled
        const x = cx - Math.sin(yaw) * across,
          y = cy + Math.cos(yaw) * across;
        placePart(m, 0, x, y, STRIP_TOP - STRIP_THICK + lift, yaw, 0, 0, 0, 0, 0, 1, 1, 1);
        return m;
      };
      const flowing = (scale: number, second: Rgb) =>
        packFlow(new Float32Array(PATTERN_STRIDE), 0, {
          kind: FLOW_KIND[look.kind],
          scale,
          speed,
          glow: look.glow,
          second,
        });
      out.push({
        mesh: bed,
        matrices: laid(0, 0),
        patterns: flowing(look.scale, [...look.second]),
        albedo: [...look.albedo],
        roughness: look.roughness,
      });
      if (bank && c.flow === 'water') {
        const water = FLOW_LOOK.water;
        // foam with the water showing through it at the ripples' crests, a hair above the stream so the two do not fight
        for (const side of [-1, 1])
          out.push({
            mesh: bank,
            matrices: laid((side * c.width) / 2, 0.01),
            patterns: flowing(water.foamScale, [...water.second]),
            albedo: [...water.foam],
            roughness: 0.6,
          });
      }
    });
    return out;
  }
}

/** Placements and materials for `n` of something, at least one of each, the one hidden if there are none. */
function pool(n: number): [Float32Array, Float32Array] {
  const m = new Float32Array(Math.max(1, n) * 16);
  if (!n) hide(m, 0);
  return [m, new Float32Array(Math.max(1, n) * MATERIAL_STRIDE)];
}

function at(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16);
  place(m, 0, x, y, z);
  return m;
}
