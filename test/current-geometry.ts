/**
 * What a current's route must keep clear of, written out for the tests and for whoever lays a new one: every
 * rule of the plan's fourth criterion, each answered by what stands in the cave and not by the code that
 * built the cave round it. A current that breaks one is a line saying which.
 */
import { OPEN, TILE, nearCutting, type Cave, type CurrentSpec, type HoleSpec } from '../src/cave';

/** How far a point is from a segment, and how far along it, 0 to 1. */
export function toSegment(
  x: number,
  y: number,
  [x0, y0, x1, y1]: [number, number, number, number],
): { d: number; k: number } {
  const dx = x1 - x0,
    dy = y1 - y0;
  const k = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
  return { d: Math.hypot(x - (x0 + dx * k), y - (y0 + dy * k)), k };
}

/** The nearest two points of two segments, by the least distance between their ends and the other's line; crossing counts as 0. */
export function segmentGap(a: [number, number, number, number], b: [number, number, number, number]): number {
  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = cross(a[0], a[1], a[2], a[3], b[0], b[1]),
    d2 = cross(a[0], a[1], a[2], a[3], b[2], b[3]),
    d3 = cross(b[0], b[1], b[2], b[3], a[0], a[1]),
    d4 = cross(b[0], b[1], b[2], b[3], a[2], a[3]);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    toSegment(b[0], b[1], a).d,
    toSegment(b[2], b[3], a).d,
    toSegment(a[0], a[1], b).d,
    toSegment(a[2], a[3], b).d,
  );
}

const line = (c: CurrentSpec): [number, number, number, number] => [c.x0, c.y0, c.x1, c.y1];

/** The open tile a point is over, or false: floor for the physics to carry a body over. */
function onFloor(cave: Cave, x: number, y: number): boolean {
  const { cols, rows, originX, originY } = cave.grid;
  const tx = Math.floor((x - originX) / TILE),
    ty = Math.floor((y - originY) / TILE);
  return tx >= 0 && ty >= 0 && tx < cols && ty < rows && cave.cells[ty * cols + tx] === OPEN;
}

/** Every rule a current's route keeps, and each broken one said. `drain` is where its drain stands, if it has one. */
export function routeProblems(
  cave: Cave,
  c: CurrentSpec,
  drain: HoleSpec | null,
  others: CurrentSpec[] = [],
): string[] {
  const out: string[] = [];
  const { spec } = cave;
  const me = line(c);
  const len = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
  const ux = (c.x1 - c.x0) / len,
    uy = (c.y1 - c.y0) / len;
  const half = c.width / 2;

  // floor for the whole of its length and width, and the drain's pit with a tile of floor round it, as a hole has
  let off = 0;
  for (let along = 0; along <= len; along += 1)
    for (let across = -half; across <= half; across += 1)
      if (!onFloor(cave, c.x0 + ux * along - uy * across, c.y0 + uy * along + ux * across)) off++;
  if (off) out.push(`${off} samples of the strip are not on floor`);
  if (drain) {
    let rock = 0;
    for (let dx = -drain.radius - TILE; dx <= drain.radius + TILE; dx += TILE / 2)
      for (let dy = -drain.radius - TILE; dy <= drain.radius + TILE; dy += TILE / 2)
        if (!onFloor(cave, drain.x + dx, drain.y + dy)) rock++;
    if (rock) out.push(`${rock} samples by the drain are not on floor`);
  }

  // the way in and the way out, and a tile either side of them
  for (let along = 0; along <= len; along += 2)
    for (let across = -half; across <= half; across += 2)
      if (nearCutting(cave.grid, spec, c.x0 + ux * along - uy * across, c.y0 + uy * along + ux * across, 1)) {
        out.push('it is on or beside a cutting');
        along = len + 1;
        break;
      }

  // heaps, with the margin a lamp or barrel keeps
  for (const h of spec.heaps) {
    const reach = Math.sqrt(h.coins) * 0.36 + 1.5;
    if (toSegment(h.x, h.y, me).d < reach + half + 1)
      out.push(`it touches the heap at ${h.x.toFixed(0)},${h.y.toFixed(0)}`);
  }
  // belts that can be bought
  for (const { spec: b } of spec.belts)
    if (segmentGap(me, [b.x0, b.y0, b.x1, b.y1]) < half + b.width / 2 + 1) out.push('it is too near a belt');
  // barrels and lamps, where the cave stands them
  for (const b of cave.barrels)
    if (toSegment(b.x, b.y, me).d < half + 2 + 1.05)
      out.push(`it is on the barrel at ${b.x.toFixed(0)},${b.y.toFixed(0)}`);
  for (const l of cave.lamps)
    if (toSegment(l.x, l.y, me).d < half + 1.5) out.push(`it is on the lamp at ${l.x.toFixed(0)},${l.y.toFixed(0)}`);
  // holes: none but the one it ends at may be near; that one is met at its end and no sooner
  for (const h of cave.holes) {
    const { d, k } = toSegment(h.x, h.y, me);
    const mine = !drain && k === 1 && d < h.radius + 4;
    if (!mine && d < h.radius + half + 2) out.push(`it is by the hole at ${h.x.toFixed(0)},${h.y.toFixed(0)}`);
  }
  // a drain, away from everything it is not for
  if (drain) {
    for (const b of cave.barrels)
      if (Math.hypot(b.x - drain.x, b.y - drain.y) < drain.radius + 3) out.push('the drain is by a barrel');
    for (const l of cave.lamps)
      if (Math.hypot(l.x - drain.x, l.y - drain.y) < drain.radius + 1.5) out.push('the drain is by a lamp');
    for (const h of cave.holes)
      if (Math.hypot(h.x - drain.x, h.y - drain.y) < h.radius + drain.radius + 6) out.push('the drain is by a hole');
    for (const h of spec.heaps)
      if (Math.hypot(h.x - drain.x, h.y - drain.y) < Math.sqrt(h.coins) * 0.36 + 1.5 + drain.radius + 2)
        out.push('the drain is in a heap');
  }
  for (const o of others)
    if (segmentGap(me, line(o)) < half + o.width / 2 + 2) out.push(`it is too near the current ${o.id}`);
  return out;
}
