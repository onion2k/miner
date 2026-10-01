/**
 * The machine as drawn: the player's dozer and the drones, built from parts
 * in `machine.ts`. What is drawn has to agree with what the physics pushes
 * with, take paint on the right parts and not the others, carry its lights
 * and its pennant where the lighting and the scene put them, and stay
 * within a triangle budget so the hero object never becomes the frame's cost.
 */
import { describe, expect, it } from 'vitest';
import { LIGHT_STRIDE } from 'artshape-render/game/lights';
import { lookAt, multiply, perspective } from 'artshape-render/gpu/camera';
import type { Mesh } from 'artshape-render/mesh/types';
import { BOT_SCALE, BOT_SPEC } from '../src/tools';
import { BLADE_AT, BLADE_HEIGHT, BLADE_RISE, Dozer, TRACK_GAUGE, WING_SWEEP, bladePieces } from '../src/dozer';
import { SceneLights } from '../src/lighting';
import { ANCHORS, ENVELOPE, TRIANGLE_BUDGET, bladeMesh, machineMeshes, scoopMesh } from '../src/machine';
import { MOUTH_DEEP, seat } from '../src/scoop';
import { GEODE_KIND, makeWorld } from '../src/physics';
import { GEODE_COLOUR } from '../src/palette';
import { PATTERN_STRIDE } from 'artshape-render/game/renderer';
import { DynamicScene } from '../src/scene-dynamic';
import { PAINTS } from '../src/economy';
import { runCapacity } from '../src/stock';
import { holeLamps } from '../src/lamps';
import { RUN, TEST_GRID, caveOf, gameIn, grid } from './helpers';

const machine = machineMeshes();
const tris = (m: Mesh) => m.indices.length / 3;
const vertices = function* (m: Mesh) {
  for (let i = 0; i < m.positions.length; i += 3)
    yield [m.positions[i], m.positions[i + 1], m.positions[i + 2]] as const;
};
const near = (m: Mesh, [x, y, z]: readonly number[], within: number) =>
  [...vertices(m)].some(([px, py, pz]) => Math.hypot(px - x, py - y, pz - z) <= within);

describe('the machine as drawn', () => {
  it('stays inside the footprint the physics keeps clear, and the blade inside its pieces', () => {
    for (const [name, mesh] of [...Object.entries(machine), ...Object.entries(machineMeshes('spider'))]) {
      for (const [x, y, z] of vertices(mesh)) {
        expect(x, `${name} ahead`).toBeLessThanOrEqual(ENVELOPE.front);
        expect(x, `${name} behind`).toBeGreaterThanOrEqual(-ENVELOPE.back);
        expect(Math.abs(y), `${name} across`).toBeLessThanOrEqual(ENVELOPE.y);
        expect(z, `${name} up`).toBeLessThanOrEqual(ENVELOPE.z);
        expect(z, `${name} down`).toBeGreaterThanOrEqual(-0.05);
      }
    }
    expect(ENVELOPE.y).toBeLessThanOrEqual(TRACK_GAUGE + 0.95);
    for (const width of [6.5, 12.5]) {
      const blade = bladeMesh(width);
      const pieces = bladePieces(width);
      for (const [x, y, z] of vertices(blade)) {
        expect(x).toBeLessThanOrEqual(BLADE_AT + WING_SWEEP * width + 0.6);
        expect(x).toBeGreaterThanOrEqual(BLADE_AT - 1.0);
        expect(Math.abs(y)).toBeLessThanOrEqual(Math.max(...pieces.map((p) => Math.abs(p.y) + p.length / 2)) + 0.3);
        expect(z).toBeLessThanOrEqual(BLADE_HEIGHT + 0.3);
      }
    }
  });

  it('follows the blade width bought, edge to edge', () => {
    const across = (width: number) => Math.max(...[...vertices(bladeMesh(width))].map(([, y]) => Math.abs(y))) * 2;
    expect(across(6.5)).toBeGreaterThan(6.5 * 0.95);
    expect(across(12.5)).toBeGreaterThan(12.5 * 0.95);
    expect(across(12.5)).toBeGreaterThan(across(6.5) * 1.8);
  });

  it('is more than boxes, and under budget', () => {
    const total = Object.values(machine).reduce((n, m) => n + tris(m), 0) + tris(bladeMesh(6.5));
    expect(total).toBeGreaterThan(1500);
    expect(total).toBeLessThan(TRIANGLE_BUDGET);
    expect(tris(machine.drone)).toBeGreaterThan(20);
    for (const [name, mesh] of Object.entries(machine)) {
      expect(tris(mesh), `${name} has faces`).toBeGreaterThan(0);
      for (let i = 0; i < mesh.normals.length; i += 3)
        expect(Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2])).toBeCloseTo(1, 3);
    }
  });

  it('carries a lens at each headlamp, a roof under the pennant, and a beacon mount on a drone', () => {
    for (const lamp of ANCHORS.headlamps)
      expect(near(machine.glass, lamp, 0.5), `lens at ${lamp.join(',')}`).toBe(true);
    const [px, py, pz] = ANCHORS.pole;
    expect(
      [...vertices(machine.paint)].some(([x, y, z]) => Math.hypot(x - px, y - py) < 0.6 && z <= pz && z > pz - 1.5),
      'roof under the pole',
    ).toBe(true);
    expect(near(machine.drone, ANCHORS.beacon, 0.6)).toBe(true);
  });

  it('is lit from its own headlamps and cab light, where the mesh puts them', () => {
    const dozer = { x: 5, y: -14, yaw: 1.1 };
    const cave = caveOf('hollow');
    const eye: [number, number, number] = [5, -14 - 78 * Math.sin(0.62), 78 * Math.cos(0.62)];
    const v = new Float32Array(16),
      p = new Float32Array(16),
      viewProjection = new Float32Array(16);
    lookAt(v, eye, [5, -14, 0], [0, 0, 1]);
    perspective(p, (42 * Math.PI) / 180, 1.6, 2, 700);
    multiply(viewProjection, p, v);
    const lights = new SceneLights(256, 256).build({
      t: 0,
      view: { viewProjection, fov: 42, aspect: 1.6, target: [dozer.x, dozer.y, 0] },
      dozer,
      bots: [{ x: 20, y: 0, yaw: 0.3, scale: BOT_SCALE }],
      lamps: cave.lamps,
      lampOn: () => false,
      lampColour: () => [1, 1, 1],
      fuses: [],
      blasts: [],
      features: [],
      featureOn: () => true,
      fountains: [],
      vein: null,
      sealing: null,
      magnet: null,
      holes: cave.holes,
      holeLamps: holeLamps(cave.holes),
      holePulse: [0],
    });
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    const at = (a: readonly number[], m = { x: dozer.x, y: dozer.y }, k = 1) => [
      m.x + (c * a[0] - s * a[1]) * k,
      m.y + (s * a[0] + c * a[1]) * k,
      a[2] * k,
    ];
    const d = lights.lights.data;
    const positions = Array.from({ length: lights.lights.count }, (_, i) => [
      d[i * LIGHT_STRIDE],
      d[i * LIGHT_STRIDE + 1],
      d[i * LIGHT_STRIDE + 2],
    ]);
    const has = (p: number[]) => positions.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.05);
    for (const lamp of ANCHORS.headlamps) expect(has(at(lamp)), `headlamp at ${lamp.join(',')}`).toBe(true);
    expect(has(at(ANCHORS.cabLight)), 'cab light').toBe(true);
    // a drone's, at its scale
    const bc = Math.cos(0.3),
      bs = Math.sin(0.3);
    const botAt = (a: readonly number[]) => [
      20 + (bc * a[0] - bs * a[1]) * BOT_SCALE,
      (bs * a[0] + bc * a[1]) * BOT_SCALE,
      a[2] * BOT_SCALE,
    ];
    expect(has(botAt(ANCHORS.beacon)), 'beacon').toBe(true);
    expect(has(botAt(ANCHORS.droneLamp)), 'drone lamp').toBe(true);
  });
});

describe('the dynamic scene’s machines', () => {
  const build = () => {
    const tints: number[] = [];
    const target = {
      setDynamic: () => undefined,
      move: () => undefined,
      tint: (group: number) => tints.push(group),
    };
    const scene = new DynamicScene(target, {
      bodyCapacity: runCapacity(RUN).bodies,
      kindCapacity: runCapacity(RUN).kinds,
      belts: caveOf('south-gallery').spec.belts.map((b) => b.spec),
      bots: 3,
      botScale: BOT_SCALE,
      botBladeWidth: BOT_SPEC.bladeWidth,
      bladeWidth: 6.5,
      paint: PAINTS[0],
      trackPages: [],
    });
    return { scene, tints };
  };

  it('paints the hull and the pennant, and nothing that is glass, steel or rubber', () => {
    const { scene, tints } = build();
    scene.setPaint(PAINTS[1]);
    const painted = tints.map((g) => scene.groups[g].mesh);
    expect(painted).toHaveLength(2);
    expect(painted).toContain(machineMeshesOf(scene).paint);
    for (const other of ['dark', 'metal', 'glass'] as const)
      expect(painted).not.toContain(machineMeshesOf(scene)[other]);
  });

  it('draws each drone from the same parts as the player, at its scale, with its own extras', () => {
    const { scene } = build();
    const parts = machineMeshesOf(scene);
    const drones = scene.groups.filter((g) => g.matrices.length === 3 * 16);
    expect(drones.length).toBeGreaterThanOrEqual(4);
    const meshes = drones.map((g) => g.mesh);
    for (const part of ['paint', 'dark', 'metal', 'glass'] as const) {
      const shared = meshes.some((m) => m === parts[part] || m.indices.length >= parts[part].indices.length);
      expect(shared, `drones carry the ${part}`).toBe(true);
    }
  });
});

describe('the geode as drawn', () => {
  it('has veins of crystal across its stone, the same on every one, so it is told from rubble and rock', () => {
    const scene = new DynamicScene(
      { setDynamic: () => undefined, move: () => undefined, tint: () => undefined },
      {
        bodyCapacity: runCapacity(RUN).bodies,
        kindCapacity: runCapacity(RUN).kinds,
        belts: [],
        bots: 0,
        botScale: BOT_SCALE,
        botBladeWidth: BOT_SPEC.bladeWidth,
        bladeWidth: 6.5,
        paint: PAINTS[0],
        trackPages: [],
      },
    );
    const group = scene.groups[scene.geodesGroup];
    const places = group.matrices.length / 16;
    expect(places).toBeGreaterThanOrEqual(runCapacity(RUN).kinds[GEODE_KIND]);
    const patterns = group.patterns!;
    expect(patterns, 'a pattern for every geode there is room for').toHaveLength(places * PATTERN_STRIDE);
    for (let i = 0; i < places; i++) {
      const at = patterns.subarray(i * PATTERN_STRIDE, (i + 1) * PATTERN_STRIDE);
      expect(at[0], 'marbling: thin veins').toBe(3);
      expect(at[1], 'a few veins across a stone its size').toBeGreaterThan(0);
      // the same seed on each: a geode's place in the group moves up when one before it cracks, and its veins must not change with it
      expect(at[2]).toBe(patterns[2]);
      const vein = [...at.subarray(4, 7)];
      vein.forEach((c, k) => expect(c, 'brighter than the stone').toBeGreaterThan(GEODE_COLOUR[k]));
      expect(vein[2], 'violet: more blue than green').toBeGreaterThan(vein[1]);
    }
  });
});

describe('the Spiderdozer as drawn', () => {
  it('is the same hull on legs: no tracks, no tread bars, and the legs drawn only when it is worn', () => {
    const tints: number[] = [];
    const moves = new Map<number, number>();
    const target = {
      setDynamic: () => undefined,
      move: (group: number, _m: Float32Array, count?: number) => moves.set(group, count ?? -1),
      tint: (group: number) => tints.push(group),
    };
    const scene = new DynamicScene(target, {
      bodyCapacity: runCapacity(RUN).bodies,
      kindCapacity: runCapacity(RUN).kinds,
      belts: caveOf('south-gallery').spec.belts.map((b) => b.spec),
      bots: 3,
      botScale: BOT_SCALE,
      botBladeWidth: BOT_SPEC.bladeWidth,
      bladeWidth: 6.5,
      paint: PAINTS[0],
      trackPages: [],
    });
    const tracked = scene.machineParts;
    scene.setBody('spider');
    const spider = scene.machineParts;
    // a body of its own, in two parts, and eyes of its own; the cab's glass and the headlamps kept
    expect(spider.paint.positions).not.toEqual(tracked.paint.positions);
    expect(spider.glass.indices.length).toBeGreaterThan(tracked.glass.indices.length);
    for (const lamp of ANCHORS.headlamps) expect(near(spider.glass, lamp, 0.5), `lens at ${lamp.join(',')}`).toBe(true);
    // nothing of it touches the floor: the tracks are gone, and the wheels with them
    for (const mesh of [spider.dark, spider.metal, spider.paint])
      for (let i = 2; i < mesh.positions.length; i += 3) expect(mesh.positions[i]).toBeGreaterThan(0.3);
    expect(spider.metal.indices.length).toBeLessThan(tracked.metal.indices.length);
    expect(scene.groups[scene.legsGroup].count).toBe(0);
    // and it is the legged parts the player's groups now draw, not the tracked ones
    const drawn = () => scene.groups.map((g) => g.mesh);
    // the tracked parts stay drawn only by the drones, which keep their tracks
    const drones = (mesh: Mesh) =>
      scene.groups.filter((g) => g.mesh === mesh).every((g) => g.matrices.length === 3 * 16);
    for (const part of ['paint', 'dark', 'metal', 'glass'] as const) {
      expect(drawn(), `the spider's ${part} drawn`).toContain(spider[part]);
      expect(drones(tracked[part]), `the tracked ${part} left to the drones`).toBe(true);
    }
    scene.setBody('dozer');
    expect(scene.machineParts.dark.positions).toEqual(tracked.dark.positions);
    expect(drawn()).not.toContain(spider.dark);
  });
});

describe('the belts of the cave being played', () => {
  it('are drawn from the cave the page has swapped to, and the old cave’s are let go', () => {
    const moves = new Map<number, number>();
    const target = {
      setDynamic: () => undefined,
      move: (group: number, _m: Float32Array, count?: number) => moves.set(group, count ?? -1),
      tint: () => undefined,
    };
    const scene = new DynamicScene(target, {
      bodyCapacity: runCapacity(RUN).bodies,
      kindCapacity: runCapacity(RUN).kinds,
      belts: caveOf('south-gallery').spec.belts.map((b) => b.spec),
      bots: 3,
      botScale: BOT_SCALE,
      botBladeWidth: BOT_SPEC.bladeWidth,
      bladeWidth: 6.5,
      paint: PAINTS[0],
      trackPages: [],
    });
    const cave = caveOf('south-gallery');
    const game = gameIn('south-gallery');
    const length = (b: { spec: { x0: number; y0: number; x1: number; y1: number } }) =>
      Math.hypot(b.spec.x1 - b.spec.x0, b.spec.y1 - b.spec.y0);
    const frame = (belts: number[]) =>
      scene.write({
        world: game.world,
        brickGrade: game.stock.brickGrade,
        dozer: game.dozer,
        bots: [],
        belts,
        flag: false,
        legs: null,
        tracks: { counts: [], dirty: new Set() },
        barrel: () => 'idle',
        t: 0,
      });
    // the group the bars on the running belts are drawn in
    const STRIPES = 16;
    frame([0]);
    const south = moves.get(STRIPES)!;
    expect(south, 'the south gallery’s belt running, with its bars').toBe(Math.floor(length(cave.spec.belts[0]) / 2.6));
    // the east gallery's belt is longer, so it carries more bars: they are its bars that are drawn after the swap
    const east = caveOf('east-gallery');
    expect(length(east.spec.belts[0])).not.toBeCloseTo(length(cave.spec.belts[0]), 0);
    scene.setBelts(east.spec.belts.map((b) => b.spec));
    frame([0]);
    const after = moves.get(STRIPES)!;
    expect(after).toBe(Math.min(160, Math.floor(length(east.spec.belts[0]) / 2.6)));
    expect(after).not.toBe(south);
  });
});

/** The machine's parts as the scene holds them, by the groups the player's dozer is drawn with. */
function machineMeshesOf(scene: DynamicScene) {
  return scene.machineParts;
}

describe('the scoop as drawn', () => {
  const [lo, hi] = [6.5, 12.5];

  it('stands where the blade does, as wide as it, with a floor as deep as the mouth and no higher than the blade', () => {
    for (const width of [lo, 8, 10, hi]) {
      const bucket = scoopMesh(width);
      const pieces = bladePieces(width);
      const reach = Math.max(...pieces.map((p) => Math.abs(p.y) + p.length / 2)) + 0.3;
      let front = -Infinity,
        across = 0;
      for (const [x, y, z] of vertices(bucket)) {
        expect(x, `${width}: not behind the blade`).toBeGreaterThanOrEqual(BLADE_AT - 1.0);
        expect(Math.abs(y), `${width}: no wider than the blade`).toBeLessThanOrEqual(reach);
        expect(z, `${width}: no higher than the blade`).toBeLessThanOrEqual(BLADE_HEIGHT + 0.3);
        expect(z, `${width}: on the floor and not under it`).toBeGreaterThanOrEqual(-0.05);
        front = Math.max(front, x);
        across = Math.max(across, Math.abs(y));
      }
      expect(front, `${width}: its lip is at the mouth's far edge`).toBeGreaterThanOrEqual(BLADE_AT + MOUTH_DEEP);
      expect(across * 2, `${width}: edge to edge`).toBeGreaterThan(width * 0.95);
    }
  });

  it('holds every body the scoop seats, on its floor and between its cheeks, at any width', () => {
    for (const width of [lo, 8, 10, hi]) {
      const bucket = scoopMesh(width);
      const floor = [...vertices(bucket)].filter(([x, , z]) => z < 0.4 && x > BLADE_AT);
      const wide = Math.max(...floor.map(([, y]) => Math.abs(y)));
      const long = Math.max(...floor.map(([x]) => x));
      for (let n = 0; n < 40; n++) {
        const s = seat(n, width);
        expect(Math.abs(s.y), `${width}: ${n} across`).toBeLessThan(wide);
        expect(s.x, `${width}: ${n} along`).toBeLessThan(long);
      }
    }
  });

  it('is under the triangle budget in the blade’s place, and not a box', () => {
    const total =
      Object.values(machine).reduce((n, m) => n + tris(m), 0) +
      tris(scoopMesh(hi)) +
      tris(bladeMesh(BOT_SPEC.bladeWidth));
    expect(total).toBeLessThan(TRIANGLE_BUDGET);
    expect(tris(scoopMesh(lo))).toBeGreaterThan(100);
    for (let i = 0; i < scoopMesh(lo).normals.length; i += 3) {
      const m = scoopMesh(lo);
      expect(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2])).toBeCloseTo(1, 3);
    }
  });

  it('takes the blade’s place once fitted, whatever width is bought after, and rises and tips with what it holds', () => {
    const moved = new Map<number, Float32Array>();
    const target = {
      setDynamic: () => undefined,
      move: (group: number, m: Float32Array) => moved.set(group, Float32Array.from(m)),
      tint: () => undefined,
    };
    const scene = new DynamicScene(target, {
      bodyCapacity: runCapacity(RUN).bodies,
      kindCapacity: runCapacity(RUN).kinds,
      belts: [],
      bots: 3,
      botScale: BOT_SCALE,
      botBladeWidth: BOT_SPEC.bladeWidth,
      bladeWidth: 6.5,
      paint: PAINTS[0],
      trackPages: [],
    });
    const BLADE_GROUP = 9;
    const plain = scene.groups[BLADE_GROUP].mesh;
    expect(plain.positions).toEqual(bladeMesh(6.5).positions);
    scene.setScoop(true);
    expect(scene.groups[BLADE_GROUP].mesh.positions, 'the bucket, in the blade’s group').toEqual(
      scoopMesh(6.5).positions,
    );
    scene.setBlade(10);
    expect(scene.groups[BLADE_GROUP].mesh.positions, 'a wider blade bought: a wider bucket').toEqual(
      scoopMesh(10).positions,
    );
    expect(scene.groups[BLADE_GROUP].matrices, 'a matrix of its own').not.toBe(scene.groups[5].matrices);

    const solid = grid();
    const dozer = new Dozer(solid, TEST_GRID);
    Object.assign(dozer, { x: 3, y: -5, yaw: 0.6 });
    const frame = (scoop?: { lift: number; dump: number }) => ({
      world: makeWorld(10, solid, TEST_GRID, []),
      brickGrade: new Uint8Array(10),
      dozer,
      bots: [],
      belts: [],
      flag: false,
      tracks: { counts: [], dirty: new Set<number>() },
      legs: null,
      barrel: () => 'idle' as const,
      scoop,
      t: 0,
    });
    scene.write(frame());
    const down = moved.get(BLADE_GROUP)!;
    const hull = moved.get(5)!;
    down.forEach((v, k) => expect(v, 'at rest it is placed as the machine is').toBeCloseTo(hull[k], 6));
    scene.write(frame({ lift: 1, dump: 0 }));
    const up = moved.get(BLADE_GROUP)!;
    expect(up[2] * BLADE_AT + up[14], 'the lip raised by the blade’s rise').toBeCloseTo(BLADE_RISE, 5);
    expect(moved.get(5)![14], 'the hull stays on the floor').toBe(0);
    expect(up[2], 'tipped back about its lip').not.toBeCloseTo(0, 3);
  });
});
