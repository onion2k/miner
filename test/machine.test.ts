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
import { BLADE_AT, BLADE_HEIGHT, TRACK_GAUGE, WING_SWEEP, bladePieces } from '../src/dozer';
import { SceneLights } from '../src/lighting';
import { ANCHORS, ENVELOPE, TRIANGLE_BUDGET, bladeMesh, machineMeshes } from '../src/machine';
import { DynamicScene } from '../src/scene-dynamic';
import { PAINTS } from '../src/economy';
import { KIND_CAPACITY } from '../src/game';
import { BODY_CAPACITY, buildCave } from '../src/cave';

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
    const cave = buildCave();
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
      holePulse: 0,
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
      bodyCapacity: BODY_CAPACITY,
      kindCapacity: KIND_CAPACITY,
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
      bodyCapacity: BODY_CAPACITY,
      kindCapacity: KIND_CAPACITY,
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

/** The machine's parts as the scene holds them, by the groups the player's dozer is drawn with. */
function machineMeshesOf(scene: DynamicScene) {
  return scene.machineParts;
}
