import { describe, expect, it } from 'vitest';
import {
  AREAS,
  BRICK,
  COLS,
  GATE,
  HOLE,
  OPEN,
  ORDER,
  ROWS,
  SECRET,
  SECRETS,
  STASHES,
  WALLS,
  areaAt,
  atGate,
  behindGate,
  buildCave,
  chamberCentre,
  pastGate,
  stashCentre,
  tileCentre,
} from '../src/cave';
import { flood, tileAt } from './helpers';

const cave = buildCave();
const { cells } = cave;
const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS ? 0 : cells[ty * COLS + tx]);
const centreOf = (t: number) => tileCentre(t % COLS, (t / COLS) | 0);
const everyGateOpen = AREAS.map(() => true);
/** The floor joined to the hole with every gate down, walls and chambers still standing. */
const main = flood(tileAt(HOLE.x, HOLE.y), (t) => cells[t] === OPEN || (cells[t] >= GATE && cells[t] < SECRET));

describe('the cave', () => {
  it('is the same every time it is built', () => {
    expect(buildCave().cells).toEqual(cells);
    expect(buildCave().lamps).toEqual(cave.lamps);
  });

  it('opens its rooms in an order that starts at the hollow and has each room once', () => {
    expect(ORDER[0]).toBe(0);
    expect([...ORDER].sort()).toEqual(AREAS.map((_, a) => a));
  });

  it('has every heap on floor joined to the hole, counted in its own room', () => {
    AREAS.forEach((area, a) => {
      for (const h of area.heaps) {
        expect(main.has(tileAt(h.x, h.y)), `${area.name} heap at ${h.x},${h.y}`).toBe(true);
        expect(areaAt(h.x, h.y), `${area.name} heap at ${h.x},${h.y}`).toBe(a);
      }
    });
  });

  it('keeps each room shut off from the hole until its gate is opened', () => {
    for (let a = 1; a < AREAS.length; a++) {
      const unlocked = AREAS.map((_, b) => b !== a);
      const solid = cave.solid(unlocked);
      const reach = flood(tileAt(HOLE.x, HOLE.y), (t) => solid[t] === 0);
      for (const h of AREAS[a].heaps)
        expect(reach.has(tileAt(h.x, h.y)), `${AREAS[a].name} heap reachable with its gate shut`).toBe(false);
      const open = cave.solid(everyGateOpen);
      const reachOpen = flood(tileAt(HOLE.x, HOLE.y), (t) => open[t] === 0);
      for (const h of AREAS[a].heaps) expect(reachOpen.has(tileAt(h.x, h.y))).toBe(true);
    }
  });

  it('runs every belt over floor', () => {
    for (const area of AREAS) {
      const b = area.belt?.spec;
      if (!b) continue;
      for (let s = 0; s <= 1; s += 0.02) {
        const t = tileAt(b.x0 + (b.x1 - b.x0) * s, b.y0 + (b.y1 - b.y0) * s);
        expect(main.has(t) || cells[t] >= BRICK, `${area.name} belt at ${s.toFixed(2)} of its length`).toBe(true);
      }
    }
  });

  it('puts every lamp on open floor in the room it lights, clear of the hole', () => {
    expect(cave.lamps.length).toBeGreaterThan(0);
    for (const l of cave.lamps) {
      expect(cells[tileAt(l.x, l.y)], `lamp at ${l.x},${l.y}`).toBe(OPEN);
      expect(l.area).toBe(areaAt(l.x, l.y));
      expect(Math.hypot(l.x - HOLE.x, l.y - HOLE.y)).toBeGreaterThan(HOLE.radius + 4);
    }
  });

  it('stands a few barrels in every room, out on open floor, clear of the heaps, belts, lamps and hole', () => {
    AREAS.forEach((area, a) => {
      const mine = cave.barrels.filter((b) => b.area === a);
      expect(mine.length, area.name).toBeGreaterThanOrEqual(3);
      for (const b of mine) {
        expect(areaAt(b.x, b.y)).toBe(a);
        const t = tileAt(b.x, b.y);
        expect(main.has(t), `${area.name} barrel at ${b.x},${b.y} joined to the hole`).toBe(true);
        expect(cells[t]).toBe(OPEN);
        expect(Math.hypot(b.x - HOLE.x, b.y - HOLE.y)).toBeGreaterThan(HOLE.radius + 10);
        for (const h of AREAS.flatMap((r) => r.heaps))
          expect(Math.hypot(h.x - b.x, h.y - b.y)).toBeGreaterThan(Math.sqrt(h.coins) * 0.36 + 4);
        for (const l of cave.lamps) expect(Math.hypot(l.x - b.x, l.y - b.y)).toBeGreaterThan(4);
      }
    });
    for (const b of cave.barrels) {
      const nearest = Math.min(...cave.barrels.filter((o) => o !== b).map((o) => Math.hypot(o.x - b.x, o.y - b.y)));
      expect(nearest).toBeGreaterThan(15);
    }
  });

  it('closes each side room off behind its wall, inside its own room', () => {
    STASHES.forEach((st, k) => {
      const inside = flood(tileAt(...stashCentre(k)), (t) => cells[t] === OPEN);
      expect(inside.size, `${st.name} has floor`).toBeGreaterThan(0);
      for (const t of inside) {
        expect(main.has(t), `${st.name} reaches the cave without its wall broken`).toBe(false);
        const [x, y] = centreOf(t);
        for (let o = 1; o < AREAS.length; o++) {
          if (o !== st.area)
            expect(pastGate(o, x, y) || atGate(o, x, y), `${st.name} in ${AREAS[o].name}'s gate zone`).toBe(false);
        }
        if (st.area > 0) expect(behindGate(st.area, x, y), `${st.name} tile not sealed with its room`).toBe(true);
      }
    });
  });

  it('stands every brick wall with floor on both faces', () => {
    WALLS.forEach((w, i) => {
      const [x0, y0, x1, y1] = w.tiles;
      const alongX = x1 - x0 >= y1 - y0;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const a = alongX ? at(x, y - 1) : at(x - 1, y),
            b = alongX ? at(x, y + 1) : at(x + 1, y);
          expect(a === OPEN || a >= BRICK, `wall ${i} at ${x},${y}`).toBe(true);
          expect(b === OPEN || b >= BRICK, `wall ${i} at ${x},${y}`).toBe(true);
        }
      }
    });
  });

  it('hides each chamber in rock, with its breakable face on its own room', () => {
    SECRETS.forEach((s, k) => {
      const mine: [number, number][] = [];
      for (let ty = 0; ty < ROWS; ty++)
        for (let tx = 0; tx < COLS; tx++) if (cells[ty * COLS + tx] === SECRET + k) mine.push([tx, ty]);
      expect(mine.length, `chamber ${k}`).toBeGreaterThan(0);
      const [w0x, w0y, w1x, w1y] = s.wall;
      const isWall = (x: number, y: number) => x >= w0x && x <= w1x && y >= w0y && y <= w1y;
      let faces = 0;
      for (const [x, y] of mine) {
        const [wx, wy] = tileCentre(x, y);
        for (let o = 1; o < AREAS.length; o++) {
          if (o !== s.area)
            expect(pastGate(o, wx, wy) || atGate(o, wx, wy), `chamber ${k} in ${AREAS[o].name}'s gate zone`).toBe(
              false,
            );
        }
        if (isWall(x, y)) {
          if (
            [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ].some(([dx, dy]) => at(x + dx, y + dy) === OPEN && areaAt(...tileCentre(x + dx, y + dy)) === s.area)
          )
            faces++;
          continue;
        }
        // behind the face, nothing open near enough to see into it through the rock
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const c = at(x + dx, y + dy);
            const leak = (c === OPEN || (c >= GATE && c !== SECRET + k)) && !isWall(x + dx, y + dy);
            expect(leak, `chamber ${k} tile ${x},${y} beside open floor at ${x + dx},${y + dy}`).toBe(false);
          }
        }
      }
      expect(faces, `chamber ${k} has a face to break`).toBeGreaterThan(0);
      expect(cells[tileAt(...chamberCentre(k))]).toBe(SECRET + k);
    });
  });
});
