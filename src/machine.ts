/**
 * The machine as it is drawn: the player's bulldozer, and the robo-dozers,
 * which are the same machine smaller with a beacon and an aerial on top.
 * Built once from the few flat-shaded shapes in `meshes.ts`, in the
 * machine's own frame — X ahead, Y to the left, Z up, the pivot on the floor
 * under the middle of the tracks — and drawn as four groups by what each
 * part is made of: what takes the paint, the dark rubber and steel, the
 * bright steel, and the glass. The physics knows none of this: it pushes
 * with the boxes in `dozer.ts`, and everything here has to fit inside them.
 *
 * Where things attach is written down once, in `ANCHORS`, and read by the
 * lighting for the headlamps, the cab light and a drone's beacon, and by the
 * scene for the pennant, so a part that moves takes its light with it.
 */
import { mergeMeshes, type Mesh } from 'artshape-render/mesh/types';
import { BLADE_HEIGHT, TRACK_GAUGE, bladePieces } from './dozer';
import { ball, box, cone, cylinder, moved, pointed, turned } from './meshes';

type V3 = [number, number, number];

/**
 * Where the lights and the pennant attach, in the machine's frame. A drone's
 * are the same points at its scale.
 */
export const ANCHORS = {
  /** The headlamp lenses, each side of the hood's nose. */
  headlamps: [
    [2.62, 0.95, 3.0],
    [2.62, -0.95, 3.0],
  ] as readonly V3[],
  /** A small light over the cab, so the machine can be seen in the dark. */
  cabLight: [-1.2, 0, 6.6] as V3,
  /** Where the pennant's pole stands on the cab roof, and how tall it is. */
  pole: [-2.15, -1.15, 5.15] as V3,
  poleHeight: 3.2,
  /** A drone's beacon, on its roof. */
  beacon: [-1.5, 0, 5.55] as V3,
  /** A drone's one lamp, in the middle of its nose. */
  droneLamp: [2.62, 0, 3.0] as V3,
};

/**
 * What the drawn machine may reach: ahead to the blade's face, back to the
 * step, out to the tracks' outer edge, and up to the tip of a drone's aerial. The
 * physics' hull box is inside this, and the capsule that keeps two machines
 * apart reaches the step and the blade.
 */
export const ENVELOPE = { front: 4.6, back: 3.8, y: TRACK_GAUGE + 0.9, z: 6.9 };

/** The most triangles the whole machine and its blade may have: a hero object, not a heap. */
export const TRIANGLE_BUDGET = 6000;

/** The machine's parts by what they are made of. A type and not an interface, so it can be gone over as a record. */
export type MachineMeshes = {
  /** What the coat of paint covers: the body, the hood, the cab and the fenders. */
  paint: Mesh;
  /** Rubber and dark steel: the tracks, the grille, the seat, the mirrors' faces. */
  dark: Mesh;
  /** Bright steel: the stack, the rams, the blade's frame, the rollers, the rails. */
  metal: Mesh;
  /** The cab's windows and the headlamps' lenses. */
  glass: Mesh;
  /** What a drone has that the player does not: a beacon and an aerial. */
  drone: Mesh;
};

/** A cylinder lying from one point to another, `r` across. */
const strut = (r: number, from: V3, to: V3, segments = 8) =>
  pointed(cylinder(r, Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]), segments), from, to);

/** A wheel of `r` on an axle across Y, centred at (x, y, z), `w` wide. */
const wheel = (r: number, w: number, x: number, y: number, z: number, segments = 12) =>
  strut(r, [x, y - w / 2, z], [x, y + w / 2, z], segments);

/** Both sides of the machine: a part at y, and its mirror at -y. */
const mirrored = (make: (side: 1 | -1) => Mesh) => mergeMeshes([make(1), make(-1)]);

export function machineMeshes(): MachineMeshes {
  const paint = mergeMeshes([
    moved(box(5.4, 3.4, 1.7), 0, 0, 0.8), // the body
    moved(box(2.9, 2.8, 1.1), 1.1, 0, 2.5), // the hood
    moved(box(0.4, 2.4, 0.25), 2.35, 0, 3.6), // the hood's nose, a lip over the grille
    moved(box(2.3, 3.0, 0.9), -1.5, 0, 2.5), // the cab's lower body
    // the cab's four pillars and its roof
    ...[-2.56, -0.44].flatMap((x) => [1.41, -1.41].map((y) => moved(box(0.18, 0.18, 1.55), x, y, 3.4))),
    moved(box(2.6, 3.3, 0.2), -1.5, 0, 4.95), // the roof
    moved(box(0.4, 0.4, 0.12), ANCHORS.pole[0], ANCHORS.pole[1], 5.03), // the pennant's mount
    // a fender over each track
    mirrored((s) => moved(box(4.4, 1.8, 0.16), -0.4, s * TRACK_GAUGE, 2.32)),
    // the headlamps' housings
    mirrored((s) => moved(box(0.5, 0.7, 0.62), 2.45, s * 0.95, 2.69)),
  ]);

  const dark = mergeMeshes([
    // each track: the belt's top and bottom runs, and the frame between them the wheels hang from
    mirrored((s) =>
      mergeMeshes([
        moved(box(6.4, 1.7, 0.26), 0, s * TRACK_GAUGE, 1.64),
        moved(box(6.4, 1.7, 0.26), 0, s * TRACK_GAUGE, 0),
        moved(box(5.6, 1.1, 1.4), 0, s * TRACK_GAUGE, 0.25),
        // the sprocket's and the idler's rims, black
        wheel(0.86, 1.72, -2.55, s * TRACK_GAUGE, 0.95, 10),
        wheel(0.86, 1.72, 2.55, s * TRACK_GAUGE, 0.95, 12),
      ]),
    ),
    moved(box(0.16, 2.3, 0.85), 2.52, 0, 2.62), // the grille
    // the louvres down each side of the hood
    mirrored((s) => mergeMeshes([0.2, 0.8, 1.4, 2.0].map((x) => moved(box(0.42, 0.1, 0.5), x, s * 1.44, 2.8)))),
    moved(box(0.3, 3.0, 1.3), -2.72, 0, 1.0), // the engine bay's back
    moved(box(0.9, 3.6, 0.4), -3.2, 0, 1.9), // the rear step
    moved(box(0.8, 0.9, 0.5), -1.6, 0, 3.4), // the seat
    moved(box(0.2, 0.9, 0.85), -2.05, 0, 3.9), // and its back
    moved(box(0.35, 0.35, 0.16), -0.9, 0, 3.9), // the wheel on its column
    // the mirrors' faces, out on their arms
    mirrored((s) => moved(box(0.08, 0.34, 0.5), -0.6, s * 2.5, 4.3)),
    moved(cylinder(0.36, 0.14, 12), 1.2, -0.95, 4.5), // the air filter's cap
  ]);

  const metal = mergeMeshes([
    moved(cylinder(0.26, 1.85, 10), 1.7, 0.95, 3.6), // the exhaust stack
    moved(cylinder(0.36, 0.1, 10), 1.7, 0.95, 5.45), // and its rain cap
    moved(cone(0.2, 0.14, 10), 1.7, 0.95, 5.55),
    moved(cylinder(0.32, 0.9, 10), 1.2, -0.95, 3.6), // the air filter
    // the hydraulic rams, a barrel and a rod each, from the hull down to the blade's frame
    mirrored((s) =>
      mergeMeshes([
        strut(0.2, [0.7, s * 1.95, 3.15], [2.3, s * 2.25, 2.4]),
        strut(0.11, [2.2, s * 2.23, 2.45], [3.7, s * 2.45, 1.95]),
        moved(box(0.5, 0.5, 0.5, true), 0.6, s * 1.95, 3.15), // the ram's mount on the hull
      ]),
    ),
    // the blade's frame: an arm each side from the track to the blade, and a cross-brace
    mirrored((s) => moved(box(3.4, 0.45, 0.45), 2.6, s * 2.4, 1.7)),
    moved(box(0.4, 4.4, 0.3), 3.9, 0, 1.75),
    // the wheels: sprocket and idler hubs, and the rollers under each track
    mirrored((s) =>
      mergeMeshes([
        wheel(0.42, 1.8, -2.55, s * TRACK_GAUGE, 0.95, 8),
        wheel(0.42, 1.8, 2.55, s * TRACK_GAUGE, 0.95, 8),
        ...[-1.4, -0.45, 0.5, 1.45].map((x) => wheel(0.36, 1.78, x, s * TRACK_GAUGE, 0.38, 8)),
        wheel(0.3, 1.78, 0, s * TRACK_GAUGE, 1.4, 8), // the carrier roller, up under the top run
      ]),
    ),
    // the handrails along the hood, and the mirrors' arms out from the cab's front pillars
    mirrored((s) =>
      mergeMeshes([
        strut(0.05, [0.1, s * 1.3, 3.65], [2.1, s * 1.3, 3.65], 6),
        strut(0.05, [0.3, s * 1.3, 3.6], [0.3, s * 1.3, 3.66], 6),
        strut(0.05, [1.9, s * 1.3, 3.6], [1.9, s * 1.3, 3.66], 6),
        strut(0.05, [-0.5, s * 1.45, 4.3], [-0.6, s * 2.5, 4.3], 6),
      ]),
    ),
    moved(box(0.5, 0.5, 0.45), -3.35, 0, 1.3), // the hitch
    // a light bar along the roof's front edge
    moved(box(0.24, 2.6, 0.22), -0.4, 0, 5.15),
  ]);

  const glass = mergeMeshes([
    moved(box(0.06, 2.62, 1.42), -0.44, 0, 3.47), // the windscreen
    moved(box(0.06, 2.62, 1.42), -2.56, 0, 3.47), // the rear window
    mirrored((s) => moved(box(1.9, 0.06, 1.42), -1.5, s * 1.41, 3.47)), // the side windows
    // the headlamps' lenses, just proud of their housings
    ...ANCHORS.headlamps.map((a) => moved(box(0.1, 0.56, 0.46), a[0] + 0.06, a[1], a[2] - 0.23)),
  ]);

  const drone = mergeMeshes([
    moved(cylinder(0.16, 0.3, 8), ANCHORS.beacon[0], ANCHORS.beacon[1], ANCHORS.beacon[2] - 0.5), // the beacon's stem
    moved(ball(0.42, 5, 8), ANCHORS.beacon[0], ANCHORS.beacon[1], ANCHORS.beacon[2]), // and its dome
    moved(cylinder(0.05, 1.6, 5), -2.4, 1.3, 5.15), // the aerial
    moved(ball(0.12, 3, 6), -2.4, 1.3, 6.75),
    moved(box(0.16, 1.6, 0.22), 2.66, 0, 3.32), // a sensor bar across the nose, above the lamp
  ]);

  return { paint, dark, metal, glass, drone };
}

/**
 * The blade, in the machine's own frame: its pieces along the arc, each a
 * plate with a lip along the top, a cutting edge along the bottom, and ribs
 * up its back; and an end bit at each tip.
 */
export function bladeMesh(width: number): Mesh {
  const pieces = bladePieces(width);
  const parts = pieces.map((p) =>
    moved(
      turned(
        mergeMeshes([
          box(0.35, p.length, BLADE_HEIGHT, true),
          moved(box(0.7, p.length, 0.22, true), 0.17, 0, BLADE_HEIGHT / 2 - 0.11),
          moved(box(0.6, p.length, 0.18, true), 0.12, 0, -BLADE_HEIGHT / 2 + 0.09),
          // two ribs up the back of each piece
          moved(box(0.3, 0.16, BLADE_HEIGHT * 0.8, true), -0.3, -p.length * 0.25, 0),
          moved(box(0.3, 0.16, BLADE_HEIGHT * 0.8, true), -0.3, p.length * 0.25, 0),
        ]),
        p.turn,
      ),
      p.x,
      p.y,
      BLADE_HEIGHT / 2,
    ),
  );
  // an end bit at each tip, square to the last piece
  for (const side of [1, -1]) {
    const tip = pieces.reduce((t, p) => (side * p.y > side * t.y ? p : t));
    const c = Math.cos(tip.turn),
      s = Math.sin(tip.turn);
    const ex = tip.x - s * side * (tip.length / 2),
      ey = tip.y + c * side * (tip.length / 2);
    parts.push(moved(turned(box(0.5, 0.24, BLADE_HEIGHT * 0.9, true), tip.turn), ex, ey, BLADE_HEIGHT / 2));
  }
  return mergeMeshes(parts);
}
