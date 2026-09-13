/**
 * The few shapes the cave is made of, built flat-shaded on purpose: a coin,
 * a gem, a block of rock, a cone, a low-poly ball. Cartoon geometry wants
 * hard edges, so faces do not share vertices and every normal is a face's.
 *
 * Everything is in world units and Z is up, as the renderer has it.
 */
import { MeshBuilder, type Mesh } from 'artshape-render/mesh/types';

type V3 = [number, number, number];

/** One flat-shaded quad, wound counter-clockwise seen from the normal. */
function face(b: MeshBuilder, p0: V3, p1: V3, p2: V3, p3: V3) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const a = b.vertex(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0);
  b.vertex(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0);
  b.vertex(p2[0], p2[1], p2[2], nx, ny, nz, 1, 1);
  b.vertex(p3[0], p3[1], p3[2], nx, ny, nz, 0, 1);
  b.quad(a, a + 1, a + 2, a + 3);
}

function tri(b: MeshBuilder, p0: V3, p1: V3, p2: V3) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const a = b.vertex(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0);
  b.vertex(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0);
  b.vertex(p2[0], p2[1], p2[2], nx, ny, nz, 0.5, 1);
  b.triangle(a, a + 1, a + 2);
}

/**
 * A box `w` across X, `d` along Y and `h` up Z, centred in X and Y and
 * standing on z = 0 unless `centred`, in which case it is centred in Z too.
 */
export function box(w: number, d: number, h: number, centred = false): Mesh {
  const b = new MeshBuilder();
  const x = w / 2, y = d / 2, z0 = centred ? -h / 2 : 0, z1 = z0 + h;
  face(b, [-x, -y, z1], [x, -y, z1], [x, y, z1], [-x, y, z1]);       // top
  face(b, [-x, y, z0], [x, y, z0], [x, -y, z0], [-x, -y, z0]);       // bottom
  face(b, [-x, -y, z0], [x, -y, z0], [x, -y, z1], [-x, -y, z1]);     // -y
  face(b, [x, y, z0], [-x, y, z0], [-x, y, z1], [x, y, z1]);         // +y
  face(b, [x, -y, z0], [x, y, z0], [x, y, z1], [x, -y, z1]);         // +x
  face(b, [-x, y, z0], [-x, -y, z0], [-x, -y, z1], [-x, y, z1]);     // -x
  return b.build();
}

/**
 * A chunky coin: a short cylinder centred on the origin with its axis up Z,
 * its rim chamfered so the edge catches a highlight, and a raised disc on
 * each face so it reads as a coin and not a washer.
 */
export function coin(radius: number, thickness: number, segments = 14): Mesh {
  const b = new MeshBuilder();
  const h = thickness / 2, ch = thickness * 0.22, cr = radius * 0.86;
  const er = radius * 0.62, eh = h + thickness * 0.12; // the raised emblem
  const ring = (r: number, z: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      out.push([Math.cos(a) * r, Math.sin(a) * r, z]);
    }
    return out;
  };
  const bands: [V3[], V3[]][] = [
    [ring(cr, -h), ring(radius, -h + ch)],
    [ring(radius, -h + ch), ring(radius, h - ch)],
    [ring(radius, h - ch), ring(cr, h)],
    [ring(cr, h), ring(er, eh)],
    [ring(cr, -h), ring(er, -eh)],
  ];
  for (const [lo, hi] of bands) {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      // the underside band winds the other way so its normal points down
      if (lo === bands[4][0]) face(b, lo[j], lo[i], hi[i], hi[j]);
      else face(b, lo[i], lo[j], hi[j], hi[i]);
    }
  }
  const top = ring(er, eh), bottom = ring(er, -eh);
  for (let i = 1; i < segments - 1; i++) {
    tri(b, top[0], top[i], top[i + 1]);
    tri(b, bottom[0], bottom[i + 1], bottom[i]);
  }
  return b.build();
}

/** A gem: a six-sided bipyramid with a girdle, its long axis up Z. */
export function gem(radius: number, height: number, sides = 6): Mesh {
  const b = new MeshBuilder();
  const g = height * 0.12;
  const ring = (r: number, z: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      out.push([Math.cos(a) * r, Math.sin(a) * r, z]);
    }
    return out;
  };
  const lo = ring(radius, -g), hi = ring(radius, g);
  const apex: V3 = [0, 0, height / 2], nadir: V3 = [0, 0, -height / 2];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    face(b, lo[i], lo[j], hi[j], hi[i]);
    tri(b, hi[i], hi[j], apex);
    tri(b, lo[j], lo[i], nadir);
  }
  return b.build();
}

/** A cone standing on z = 0, for stalagmites and the odd spike. */
export function cone(radius: number, height: number, segments = 8): Mesh {
  const b = new MeshBuilder();
  const apex: V3 = [0, 0, height];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0: V3 = [Math.cos(a0) * radius, Math.sin(a0) * radius, 0];
    const p1: V3 = [Math.cos(a1) * radius, Math.sin(a1) * radius, 0];
    tri(b, p0, p1, apex);
    tri(b, p1, p0, [0, 0, 0]);
  }
  return b.build();
}

/** A cylinder standing on z = 0 with its axis up Z, flat-shaded. */
export function cylinder(radius: number, height: number, segments = 12): Mesh {
  const b = new MeshBuilder();
  const at = (i: number, z: number): V3 => {
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a) * radius, Math.sin(a) * radius, z];
  };
  for (let i = 0; i < segments; i++) {
    face(b, at(i, 0), at(i + 1, 0), at(i + 1, height), at(i, height));
    tri(b, [0, 0, height], at(i, height), at(i + 1, height));
    tri(b, [0, 0, 0], at(i + 1, 0), at(i, 0));
  }
  return b.build();
}

/** A low-poly ball centred on the origin. */
export function ball(radius: number, rings = 6, segments = 10): Mesh {
  const b = new MeshBuilder();
  const at = (i: number, j: number): V3 => {
    const phi = (i / rings) * Math.PI, th = (j / segments) * Math.PI * 2;
    return [Math.sin(phi) * Math.cos(th) * radius, Math.sin(phi) * Math.sin(th) * radius, Math.cos(phi) * radius];
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      if (i === 0) tri(b, at(0, 0), at(1, j), at(1, j + 1));
      else if (i === rings - 1) tri(b, at(rings, 0), at(i, j + 1), at(i, j));
      else face(b, at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  return b.build();
}

/** A flat square tile of the floor, `size` on a side, centred, at z = 0. */
export function tile(size: number): Mesh {
  const b = new MeshBuilder();
  const s = size / 2;
  face(b, [-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]);
  return b.build();
}

/** A thin flat disc at z = 0, facing up, for a rotor. */
export function disc(radius: number, segments = 10): Mesh {
  const b = new MeshBuilder();
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    tri(b, [0, 0, 0], [Math.cos(a0) * radius, Math.sin(a0) * radius, 0], [Math.cos(a1) * radius, Math.sin(a1) * radius, 0]);
  }
  return b.build();
}

/**
 * The floor round the hole: a square `side` across with a circle of
 * `radius` cut from its middle, so the tiles that would have covered it can
 * be left out and the hole is a real hole.
 */
export function collar(side: number, radius: number, segments = 40): Mesh {
  const b = new MeshBuilder();
  const half = side / 2;
  const at = (i: number): [V3, V3] => {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const reach = half / Math.max(Math.abs(c), Math.abs(s));
    return [[c * radius, s * radius, 0], [c * reach, s * reach, 0]];
  };
  for (let i = 0; i < segments; i++) {
    const [in0, out0] = at(i), [in1, out1] = at(i + 1);
    face(b, in0, out0, out1, in1);
  }
  return b.build();
}

/** The pit under the hole: a wall going down, facing inward, and a floor far below. */
export function pit(radius: number, depth: number, segments = 40): Mesh {
  const b = new MeshBuilder();
  const at = (i: number, z: number): V3 => {
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a) * radius, Math.sin(a) * radius, z];
  };
  for (let i = 0; i < segments; i++) {
    face(b, at(i + 1, 0), at(i, 0), at(i, -depth), at(i + 1, -depth));
    tri(b, [0, 0, -depth], at(i, -depth), at(i + 1, -depth));
  }
  return b.build();
}

/** A copy of a mesh moved by an offset, for assembling a body from parts. */
export function moved(mesh: Mesh, dx: number, dy: number, dz: number): Mesh {
  const positions = new Float32Array(mesh.positions);
  for (let i = 0; i < positions.length; i += 3) { positions[i] += dx; positions[i + 1] += dy; positions[i + 2] += dz; }
  return { positions, normals: mesh.normals, uvs: mesh.uvs, indices: mesh.indices };
}

/** A copy of a mesh turned about Z, positions and normals both. */
export function turned(mesh: Mesh, yaw: number): Mesh {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const positions = new Float32Array(mesh.positions), normals = new Float32Array(mesh.normals);
  for (const a of [positions, normals]) {
    for (let i = 0; i < a.length; i += 3) {
      const x = a[i], y = a[i + 1];
      a[i] = c * x - s * y; a[i + 1] = s * x + c * y;
    }
  }
  return { positions, normals, uvs: mesh.uvs, indices: mesh.indices };
}
