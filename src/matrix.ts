/**
 * Column-major 4×4 placements, as WebGPU reads them: element (row r, column
 * c) lives at c * 4 + r, so the translation is the last four floats.
 */

/** A turn about Z, a uniform scale, and somewhere to put it. */
export function place(out: Float32Array, i: number, x: number, y: number, z: number, yaw = 0, scale = 1) {
  const o = i * 16;
  const c = Math.cos(yaw) * scale,
    s = Math.sin(yaw) * scale;
  out[o] = c;
  out[o + 1] = s;
  out[o + 2] = 0;
  out[o + 3] = 0;
  out[o + 4] = -s;
  out[o + 5] = c;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = 0;
  out[o + 9] = 0;
  out[o + 10] = scale;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** A placement from a unit quaternion [x, y, z, w], for a thing that tumbles. */
export function placeQuat(
  out: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  q: Float32Array,
  qo: number,
  scale = 1,
) {
  const qx = q[qo],
    qy = q[qo + 1],
    qz = q[qo + 2],
    qw = q[qo + 3];
  const xx = qx * qx,
    yy = qy * qy,
    zz = qz * qz;
  const xy = qx * qy,
    xz = qx * qz,
    yz = qy * qz,
    wx = qw * qx,
    wy = qw * qy,
    wz = qw * qz;
  const o = i * 16;
  out[o] = (1 - 2 * (yy + zz)) * scale;
  out[o + 1] = 2 * (xy + wz) * scale;
  out[o + 2] = 2 * (xz - wy) * scale;
  out[o + 3] = 0;
  out[o + 4] = 2 * (xy - wz) * scale;
  out[o + 5] = (1 - 2 * (xx + zz)) * scale;
  out[o + 6] = 2 * (yz + wx) * scale;
  out[o + 7] = 0;
  out[o + 8] = 2 * (xz + wy) * scale;
  out[o + 9] = 2 * (yz - wx) * scale;
  out[o + 10] = (1 - 2 * (xx + yy)) * scale;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/**
 * A part of a body: the body stands at (bx, by, bz) turned to `yaw`, and the
 * part sits at a local offset, turned a little more about its own Z and
 * tipped about its own X, with a scale of its own each way.
 */
export function placePart(
  out: Float32Array,
  i: number,
  bx: number,
  by: number,
  bz: number,
  yaw: number,
  lx: number,
  ly: number,
  lz: number,
  localYaw = 0,
  pitch = 0,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const cl = Math.cos(localYaw),
    sl = Math.sin(localYaw);
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  // R = Rz(yaw) · Rz(localYaw) · Rx(pitch), then columns scaled
  const ca = c * cl - s * sl,
    sa = s * cl + c * sl;
  const o = i * 16;
  out[o] = ca * sx;
  out[o + 1] = sa * sx;
  out[o + 2] = 0;
  out[o + 3] = 0;
  out[o + 4] = -sa * cp * sy;
  out[o + 5] = ca * cp * sy;
  out[o + 6] = sp * sy;
  out[o + 7] = 0;
  out[o + 8] = sa * sp * sz;
  out[o + 9] = -ca * sp * sz;
  out[o + 10] = cp * sz;
  out[o + 11] = 0;
  out[o + 12] = bx + c * lx - s * ly;
  out[o + 13] = by + s * lx + c * ly;
  out[o + 14] = bz + lz;
  out[o + 15] = 1;
}

/**
 * A placement lying from one point to another: what stood up Z from the
 * origin, a unit tall and a unit across, now runs from `from` to `to`, `r`
 * across. For a leg's bone, drawn from a unit cylinder.
 */
export function placeAlong(out: Float32Array, i: number, from: readonly number[], to: readonly number[], r: number) {
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  const zx = dx / len,
    zy = dy / len,
    zz = dz / len;
  // an X axis square to the line: off Z's cross with it, or off Y's when the line is straight up
  let xx = -zy,
    xy = zx,
    xz = 0;
  let l = Math.hypot(xx, xy);
  if (l < 1e-6) {
    xx = 1;
    xy = 0;
    xz = 0;
    l = 1;
  }
  xx /= l;
  xy /= l;
  xz /= l;
  const yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  const o = i * 16;
  out[o] = xx * r;
  out[o + 1] = xy * r;
  out[o + 2] = xz * r;
  out[o + 3] = 0;
  out[o + 4] = yx * r;
  out[o + 5] = yy * r;
  out[o + 6] = yz * r;
  out[o + 7] = 0;
  out[o + 8] = zx * len;
  out[o + 9] = zy * len;
  out[o + 10] = zz * len;
  out[o + 11] = 0;
  out[o + 12] = from[0];
  out[o + 13] = from[1];
  out[o + 14] = from[2];
  out[o + 15] = 1;
}

/** Park a placement where nothing can see it. */
export function hide(out: Float32Array, i: number) {
  place(out, i, 0, 0, -1e5, 0, 0);
}

/** The identity, for a static thing modelled where it stands. */
export function identity(): Float32Array {
  const m = new Float32Array(16);
  place(m, 0, 0, 0, 0);
  return m;
}

/** A world point in normalised device coordinates, or null behind the camera. */
export function project(vp: Float32Array, x: number, y: number, z: number): [number, number, number] | null {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (cw <= 1e-4) return null;
  return [cx / cw, cy / cw, cw];
}
