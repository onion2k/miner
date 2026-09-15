import { describe, expect, it } from 'vitest';
import { MATERIAL_STRIDE, type GameGroup } from 'artshape-render/game/renderer';
import { lookAt, multiply, perspective } from 'artshape-render/gpu/camera';
import { AREAS, HOLE, SECRETS, WALLS, buildCave, gateTiles } from '../src/cave';
import { CAMERA_HOME, CameraRig } from '../src/camera';
import { placePointer } from '../src/hud';
import { SceneLights, type LightState } from '../src/lighting';
import { StaticScene, type StaticState } from '../src/scene-static';
import { layBricks } from '../src/walls';

const cave = buildCave();
const scene = new StaticScene(cave);
const state = (over: Partial<StaticState> = {}): StaticState => ({
  areas: AREAS.map((_, a) => a === 0),
  secrets: SECRETS.map(() => false),
  walls: WALLS.map(() => false),
  wallDamage: WALLS.map(() => 0),
  lampsBroken: [],
  belts: [],
  ...over,
});
function camera(x: number, y: number, aspect = 16 / 9) {
  const eye: [number, number, number] = [x, y - 78 * Math.sin(0.62), 78 * Math.cos(0.62)];
  const v = new Float32Array(16),
    p = new Float32Array(16),
    viewProjection = new Float32Array(16);
  lookAt(v, eye, [x, y, 0], [0, 0, 1]);
  perspective(p, (42 * Math.PI) / 180, aspect, 2, 700);
  multiply(viewProjection, p, v);
  return { viewProjection, fov: 42, aspect, target: [x, y, 0] as [number, number, number] };
}

describe('the static scene', () => {
  it('shuts the gates of rooms not open, and opens them', () => {
    const shut = AREAS.slice(1).reduce((n, _, a) => n + gateTiles(cave, a + 1).length, 0);
    const find = (s: StaticState) => scene.groups(s).find((g) => g.albedo?.[0] === 0.62)!;
    expect(find(state()).count).toBe(shut);
    expect(find(state({ areas: AREAS.map(() => true) })).count).toBe(0);
  });

  it('draws a wall still standing, brick by brick, and none once it is down', () => {
    const bricks = WALLS.reduce((n, _, w) => n + layBricks(w).length, 0);
    const brickGroup = (s: StaticState) => scene.groups(s).find((g) => g.materials && g.count === bricks);
    expect(brickGroup(state())).toBeDefined();
    const down = scene.groups(state({ walls: WALLS.map(() => true) }));
    expect(down.some((g) => g.materials && g.count === bricks)).toBe(false);
  });

  it('draws the rock and floor of a room not open all but black, and of an open one in colour', () => {
    const lum = (g: GameGroup) => g.materials![0] + g.materials![1] + g.materials![2];
    const shut = scene.groups(state());
    const open = scene.groups(state({ areas: AREAS.map(() => true) }));
    // the terrain comes first, one colour a group
    const surface = shut.filter((g) => g.materials?.length === MATERIAL_STRIDE && g.matrices.length === 16);
    expect(surface.length).toBeGreaterThan(10);
    const dark = surface.filter((g) => lum(g) < 0.02).length;
    expect(dark).toBeGreaterThan(0);
    const openSurface = open.filter((g) => g.materials?.length === MATERIAL_STRIDE && g.matrices.length === 16);
    expect(openSurface.filter((g) => lum(g) < 0.02).length).toBeLessThan(dark);
  });

  it('lays a lamp knocked over on the floor, its head dark', () => {
    const lamps = cave.lamps.length;
    const heads = (s: StaticState) => scene.groups(s).find((g) => g.materials && g.count === lamps)!;
    const up = heads(state()),
      down = heads(state({ lampsBroken: [0] }));
    expect(up.matrices[14]).toBeGreaterThan(4);
    expect(down.matrices[14]).toBeLessThan(1.5);
    expect(down.materials![0]).toBeLessThan(up.materials![0]);
  });

  it('rebuilds the rock only when a chamber is broken into', () => {
    const s = new StaticScene(cave);
    const first = s.groups(state())[0].mesh;
    expect(s.groups(state({ lampsBroken: [1] }))[0].mesh).toBe(first);
    expect(s.groups(state({ secrets: SECRETS.map((_, k) => k === 0) }))[0].mesh).not.toBe(first);
  });
});

describe('the lights', () => {
  const base = (over: Partial<LightState> = {}): LightState => ({
    t: 0,
    view: camera(0, -14),
    dozer: { x: 0, y: -14, yaw: Math.PI / 2 },
    bots: [],
    lamps: cave.lamps,
    lampOn: (k) => cave.lamps[k].area === 0,
    lampColour: () => [1, 0.8, 0.55],
    fuses: [],
    blasts: [],
    features: [],
    featureOn: () => true,
    fountains: [],
    vein: null,
    sealing: null,
    magnet: null,
    holePulse: 0,
    ...over,
  });

  it('light the dozer with two headlights, one shadowed, and a cab light, and the lamps in view', () => {
    const lights = new SceneLights(256, 256).build(base());
    expect(lights.shadowed).toHaveLength(1);
    expect(lights.lampsLit.length).toBeGreaterThan(0);
    expect(lights.lampsLit.every((k) => cave.lamps[k].area === 0)).toBe(true);
    // two headlights, the cab, the lamps, and the three over the hole, in view
    expect(lights.lights.count).toBe(3 + lights.lampsLit.length + 3);
  });

  it('add a drone’s two lights, the sealing line, the vein and the magnet when there are any', () => {
    const plain = new SceneLights(256, 256).build(base()).lights.count;
    const busy = new SceneLights(256, 256).build(
      base({
        bots: [{ x: 10, y: 0, yaw: 0 }],
        sealing: [0, -30],
        vein: { x: 5, y: 5 },
        magnet: { x: 0, y: -8, radius: 4, strength: 5 },
      }),
    ).lights.count;
    expect(busy).toBe(plain + 2 + 1 + 1 + 1);
  });

  it('light a biome’s features in view when their room is open, beating, and never crowd out the lamps', () => {
    const feature = (x: number, y: number, beat: 'steady' | 'blink') => ({
      x,
      y,
      z: 2,
      colour: [1, 0.4, 0.1] as [number, number, number],
      radius: 10,
      intensity: 5,
      beat,
      glow: 3,
      phase: 0,
      area: 1,
      biome: 'lava' as const,
    });
    const features = [feature(5, -14, 'steady'), feature(-5, -10, 'blink'), feature(900, 900, 'steady')];
    const lamps = new SceneLights(256, 256).build(base()).lights.count;
    const lit = new SceneLights(256, 256).build(base({ features, featureOn: () => true }));
    expect(lit.featuresLit).toEqual([0, 1]);
    expect(lit.lights.count).toBe(lamps + 2);
    expect(new SceneLights(256, 256).build(base({ features, featureOn: () => false })).featuresLit).toEqual([]);
    // a crowd of features still leaves room for the machines' own lights past the lamps
    const crowd = Array.from({ length: 200 }, (_, k) => feature((k % 20) - 10, -14 + Math.floor(k / 20), 'steady'));
    const busy = new SceneLights(64, 256).build(
      base({ features: crowd, featureOn: () => true, bots: [{ x: 0, y: 0, yaw: 0 }] }),
    );
    expect(busy.lights.count).toBeLessThanOrEqual(64);
    expect(busy.featuresLit.length).toBeLessThanOrEqual(48);
  });

  it('glow the hole only while something is going down it, and never past capacity', () => {
    const quiet = new SceneLights(256, 256).build(base()).count;
    expect(new SceneLights(256, 256).build(base({ holePulse: 1 })).count).toBe(quiet + 1);
    expect(new SceneLights(256, 4).build(base({ holePulse: 1 })).count).toBeLessThanOrEqual(4);
    expect(HOLE.radius).toBeGreaterThan(0);
  });
});

describe('the arrow to the next gate', () => {
  const vp = camera(0, -14).viewProjection;
  it('hangs over a gate in view', () => {
    const p = placePointer(vp, { x: 0, y: -10 }, { x: 0, y: -14 }, 1280, 800, false, 0)!;
    expect(p.over).toBe(true);
    expect(p.x).toBeCloseTo(640, -1);
  });

  it('sits at the edge of the screen toward one out of view, clear of the counters and buttons', () => {
    for (const [tx, ty] of [
      [400, -14],
      [-400, -14],
      [0, 300],
      [0, -300],
      [300, 300],
    ]) {
      const p = placePointer(vp, { x: tx, y: ty }, { x: 0, y: -14 }, 1280, 800, false, 0)!;
      expect(p.over).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(56 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(1280 - 56 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(84 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(800 - 110 + 1e-6);
      if (p.over) continue;
      // pointing the way it lies: right for one to the east, up the screen for one to the north
      if (tx > 0) expect(p.ux).toBeGreaterThan(0);
      if (tx < 0) expect(p.ux).toBeLessThan(0);
      if (ty > 0 && tx === 0) expect(p.uy).toBeLessThan(0);
    }
  });
});

describe('the camera rig', () => {
  function rig(saved: string | null, canFree = true) {
    const orbit = {
      currentAzimuth: CAMERA_HOME.azimuth,
      distance: 78,
      set: [] as { azimuth?: number }[],
      setSpherical(s: { azimuth?: number }) {
        this.set.push(s);
        if (s.azimuth !== undefined) this.currentAzimuth = s.azimuth;
      },
      update() {},
    };
    const cam = { target: [0, 0, 0] as [number, number, number] };
    let stored = saved;
    const r = new CameraRig(orbit, cam, { x: 0, y: 0 }, { get: () => stored, set: (m) => (stored = m) }, canFree);
    return { r, orbit, cam, stored: () => stored };
  }

  it('remembers its mode, cycles through them, and leaves free out where nothing can drag it', () => {
    expect(rig('chase').r.mode).toBe('chase');
    expect(rig('free', false).r.mode).toBe('fixed');
    const { r, stored } = rig(null);
    expect([r.cycle(), r.cycle(), r.cycle()]).toEqual(['chase', 'free', 'fixed']);
    expect(stored()).toBe('fixed');
    const phone = rig(null, false).r;
    expect([phone.cycle(), phone.cycle()]).toEqual(['chase', 'fixed']);
  });

  it('aims ahead of a machine on the move, and holds still while it shuffles in the window', () => {
    const { r, cam } = rig(null);
    for (let f = 0; f < 60; f++) r.update(1 / 60, f / 60, { x: 1, y: 0, yaw: 0, speed: 0 });
    expect(cam.target[0]).toBeCloseTo(0, 5);
    for (let f = 0; f < 240; f++) r.update(1 / 60, 1 + f / 60, { x: 20, y: 0, yaw: 0, speed: 10 });
    expect(cam.target[0]).toBeGreaterThan(20);
  });

  it('swings round behind the machine when chasing, unless the player has the camera', () => {
    const { r, orbit } = rig('chase');
    r.grab(0);
    for (let f = 0; f < 60; f++) r.update(1 / 60, f / 60, { x: 0, y: 0, yaw: 0, speed: 5 });
    expect(orbit.currentAzimuth).toBeCloseTo(CAMERA_HOME.azimuth, 5);
    for (let f = 0; f < 600; f++) r.update(1 / 60, 10 + f / 60, { x: 0, y: 0, yaw: 0, speed: 5 });
    expect(Math.abs(Math.cos(orbit.currentAzimuth) + 1)).toBeLessThan(0.01);
  });
});
