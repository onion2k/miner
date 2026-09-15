import { describe, expect, it } from 'vitest';
import { TrackMarks, type TrackOptions, type Tracked } from '../src/tracks';

const options = (over: Partial<TrackOptions> = {}): TrackOptions => ({
  pageSize: 8,
  pages: 3,
  gauge: 2,
  spacing: 1,
  length: 0.3,
  width: 1.5,
  ground: () => 0,
  ...over,
});

/** A machine facing along +x, driven straight on by `distance`. */
function driveStraight(marks: TrackMarks, m: Tracked, distance: number, step = 0.1) {
  for (let d = 0; d < distance; d += step) {
    m.x += step;
    m.trackLeft += step;
    m.trackRight += step;
    marks.update(m, m);
  }
}

const machine = (): Tracked => ({ x: 0, y: 0, yaw: 0, trackLeft: 0, trackRight: 0, scale: 1 });
/** Where a mark was put: its placement's translation. */
const at = (marks: TrackMarks, page: number, i: number) => [
  marks.matrices[page][i * 16 + 12],
  marks.matrices[page][i * 16 + 13],
];

describe('the track marks', () => {
  it('lays nothing on first sight of a machine, then a mark under each track every spacing', () => {
    const marks = new TrackMarks(options({ pageSize: 100 }));
    const m = machine();
    marks.update(m, m);
    expect(marks.size).toBe(0);
    driveStraight(marks, m, 5.05);
    expect(marks.size).toBe(10);
    // the left track on +y, the right on -y, at the gauge
    const ys = Array.from({ length: 10 }, (_, i) => at(marks, 0, i)[1]);
    expect(new Set(ys.map((y) => Math.round(y)))).toEqual(new Set([2, -2]));
  });

  it('lays marks for a machine turning on the spot, from both tracks', () => {
    const marks = new TrackMarks(options({ pageSize: 100 }));
    const m = machine();
    marks.update(m, m);
    // two and a half spacings each way: two marks under each track
    for (let k = 0; k < 25; k++) {
      m.trackLeft -= 0.1;
      m.trackRight += 0.1;
      m.yaw += 0.05;
      marks.update(m, m);
    }
    expect(marks.size).toBe(4);
  });

  it('scales a smaller machine’s marks and their spacing', () => {
    const marks = new TrackMarks(options({ pageSize: 100 }));
    const m = { ...machine(), scale: 0.5 };
    marks.update(m, m);
    driveStraight(marks, m, 5.05);
    expect(marks.size).toBe(20);
    expect(Math.abs(at(marks, 0, 0)[1])).toBeCloseTo(1, 5);
  });

  it('leaves no mark where there is no ground, and lies on the highest ground under it', () => {
    const marks = new TrackMarks(options({ pageSize: 100, ground: (x) => (x > 3 ? null : x * 0.01) }));
    const m = machine();
    marks.update(m, m);
    driveStraight(marks, m, 10);
    for (let i = 0; i < marks.size; i++) expect(at(marks, 0, i)[0]).toBeLessThanOrEqual(3);
    expect(marks.matrices[0][14]).toBeGreaterThan(at(marks, 0, 0)[0] * 0.01);
  });

  it('writes only the page being filled, and reuses the oldest once every page is full', () => {
    const marks = new TrackMarks(options());
    const m = machine();
    marks.update(m, m);
    driveStraight(marks, m, 4.05);
    expect(marks.counts).toEqual([8, 0, 0]);
    expect([...marks.dirty]).toEqual([0]);
    marks.clean();
    driveStraight(marks, m, 8);
    expect(marks.counts).toEqual([8, 8, 8]);
    marks.clean();
    driveStraight(marks, m, 1);
    // the first page emptied and filling again; no more marks kept than the pages hold
    expect(marks.counts[0]).toBe(2);
    expect(marks.size).toBe(18);
    expect(marks.dirty.has(0)).toBe(true);
  });

  it('shrinks the page next to go as the newest fills', () => {
    const marks = new TrackMarks(options());
    const m = machine();
    marks.update(m, m);
    driveStraight(marks, m, 12.05);
    const width = (page: number) => Math.hypot(marks.matrices[page][4], marks.matrices[page][5]);
    expect(width(1)).toBeCloseTo(1.5, 5);
    driveStraight(marks, m, 2);
    // page 0 is being reused, page 1 is next to go and has shrunk with it
    expect(marks.counts[0]).toBe(4);
    expect(width(1)).toBeLessThan(1.5 * 0.6);
    expect(width(2)).toBeCloseTo(1.5, 5);
  });

  it('forgets everything when cleared, and a machine starts afresh from where it is', () => {
    const marks = new TrackMarks(options());
    const m = machine();
    marks.update(m, m);
    driveStraight(marks, m, 3);
    marks.clear();
    expect(marks.size).toBe(0);
    // however far its tracks have run meanwhile, that is not marks to lay
    m.trackLeft += 50;
    m.trackRight += 50;
    marks.update(m, m);
    expect(marks.size).toBe(0);
  });

  it('lays every mark for a machine that went several spacings in one look', () => {
    const marks = new TrackMarks(options({ pageSize: 100 }));
    const m = machine();
    marks.update(m, m);
    m.x += 3.5;
    m.trackLeft += 3.5;
    m.trackRight += 3.5;
    marks.update(m, m);
    expect(marks.size).toBe(6);
    // a spacing apart along the way it came: the left track's marks, then the right's
    const xs = [0, 1, 2].map((i) => at(marks, 0, i)[0]);
    expect(xs).toEqual([1, 2, 3]);
  });
});
