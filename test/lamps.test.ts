import { describe, expect, it } from 'vitest';
import { lookAt, multiply, perspective } from 'artshape-render/gpu/camera';
import { AREAS, LAMP_HEIGHT, buildCave } from '../src/cave';
import { LAMP_KNOCK, LAMP_REACH, fallYaw, lampOn, lampPose, lampsHit, lampsInView, type View } from '../src/lamps';
import { project } from '../src/matrix';

const { lamps } = buildCave();

/** A camera over a point, from where the game starts it, at a screen shape. */
function view(x: number, y: number, aspect: number): View {
  const polar = 0.62,
    radius = 78,
    fov = 42;
  const eye: [number, number, number] = [x, y - radius * Math.sin(polar), radius * Math.cos(polar)];
  const v = new Float32Array(16),
    p = new Float32Array(16),
    viewProjection = new Float32Array(16);
  lookAt(v, eye, [x, y, 0], [0, 0, 1]);
  perspective(p, (fov * Math.PI) / 180, aspect, 2, 700);
  multiply(viewProjection, p, v);
  return { viewProjection, fov, aspect, target: [x, y, 0] };
}

describe('the lamps', () => {
  it('are lit standing in an open room, and not otherwise', () => {
    const k = lamps.findIndex((l) => l.area === 1);
    const areas = AREAS.map((_, a) => a === 0);
    expect(lampOn(lamps, k, { lampsBroken: [], areas })).toBe(false);
    areas[1] = true;
    expect(lampOn(lamps, k, { lampsBroken: [], areas })).toBe(true);
    expect(lampOn(lamps, k, { lampsBroken: [k], areas })).toBe(false);
  });

  it('are knocked over by the hull or the blade coming near, and only those standing', () => {
    const k = 0,
      l = lamps[k];
    expect(lampsHit(lamps, [], l.x + LAMP_KNOCK - 0.1, l.y, Math.PI / 2, 4.3)).toContain(k);
    expect(lampsHit(lamps, [], l.x + LAMP_KNOCK + 3, l.y, Math.PI / 2, 4.3)).not.toContain(k);
    // the blade reaches out ahead of the machine
    expect(lampsHit(lamps, [], l.x - 7, l.y, 0, 4.3)).toContain(k);
    expect(lampsHit(lamps, [k], l.x, l.y, 0, 4.3)).not.toContain(k);
  });

  it('light the screen: none missed whose light reaches it, the nearest the eye first', () => {
    for (const aspect of [16 / 9, 0.46]) {
      const v = view(10, -20, aspect);
      const lit = lampsInView(lamps, () => true, v, []);
      expect(lit.length).toBeGreaterThan(0);
      expect(lit.length).toBeLessThan(lamps.length);
      // a lamp whose pool of light touches a point on the screen is among them
      lamps.forEach((l, k) => {
        for (const [ox, oy] of [
          [0, 0],
          [LAMP_REACH * 0.9, 0],
          [-LAMP_REACH * 0.9, 0],
          [0, LAMP_REACH * 0.9],
          [0, -LAMP_REACH * 0.9],
        ]) {
          const q = project(v.viewProjection, l.x + ox, l.y + oy, 0);
          if (q && Math.abs(q[0]) < 1 && Math.abs(q[1]) < 1) expect(lit, `lamp ${k} lights the screen`).toContain(k);
        }
      });
      const d = (k: number) => Math.hypot(lamps[k].x - 10, lamps[k].y + 20);
      for (let i = 1; i < lit.length; i++) expect(d(lit[i])).toBeGreaterThanOrEqual(d(lit[i - 1]));
    }
  });

  it('fall the same way every time, and lie on the floor', () => {
    expect(fallYaw(5)).toBe(fallYaw(5));
    const l = lamps[3];
    const up = lampPose(l, 3, false),
      down = lampPose(l, 3, true);
    expect(up.head[2]).toBeCloseTo(l.height - 0.3, 6);
    expect(down.head[2]).toBeLessThan(1.5);
    expect(Math.hypot(down.head[0] - l.x, down.head[1] - l.y)).toBeGreaterThan(l.height * 0.9);
    expect(up.postScale).toBeCloseTo(l.height / LAMP_HEIGHT, 6);
  });
});
