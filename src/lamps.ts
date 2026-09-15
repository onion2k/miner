/**
 * The lamps: which are lit, which a machine knocks over, which are worth
 * lighting this frame, and how one lies once it has gone over.
 *
 * The lamps themselves, where they stand and which room each lights, are the
 * cave's (`cave.ts`); what has become of them is the save's. This is only the
 * rules, handed both.
 */
import { HOLE, LAMP_HEIGHT, hash, type Lamp } from './cave';
import { project } from './matrix';

/** How many lamps are lit at once near the eye, and how near a machine has to come to knock one over. */
export const LAMP_LIGHTS = 240,
  LAMP_KNOCK = 4.2;
/** How far a lamp's light carries, and how bright it is. */
export const LAMP_REACH = 40,
  LAMP_BRIGHT = 16;
/**
 * The lamps over the hole: three, hanging from the dark on cords, high enough to drive under, round
 * above its rim. How high they hang, and how far the cord goes up before it is lost in the dark.
 */
export const HOLE_LAMP_HEIGHT = 15,
  HOLE_CORD = 12;
export const HOLE_LAMPS: [number, number][] = [90, 210, 330].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return [HOLE.x + Math.cos(a) * (HOLE.radius + 1.5), HOLE.y + Math.sin(a) * (HOLE.radius + 1.5)];
});

/** What has become of the lamps, and which rooms are open: the parts of the save a lamp's state hangs on. */
export interface LampState {
  lampsBroken: readonly number[];
  areas: readonly boolean[];
}

/** Whether a lamp is lit: standing, and in a room open and not sealed. */
export function lampOn(lamps: readonly Lamp[], k: number, state: LampState): boolean {
  return !state.lampsBroken.includes(k) && state.areas[lamps[k].area];
}

/** The way a lamp fell, which is always the same way for the same lamp. */
export function fallYaw(k: number): number {
  return hash(k, 3, 17) * Math.PI * 2;
}

/**
 * The lamps still standing that a machine is into, by its hull or its blade:
 * the machine at (x, y) facing `yaw`, its blade's face `bladeAt` ahead.
 */
export function lampsHit(
  lamps: readonly Lamp[],
  broken: readonly number[],
  x: number,
  y: number,
  yaw: number,
  bladeAt: number,
): number[] {
  const bx = x + Math.cos(yaw) * bladeAt,
    by = y + Math.sin(yaw) * bladeAt;
  const out: number[] = [];
  lamps.forEach((l, k) => {
    if (broken.includes(k)) return;
    if (Math.hypot(l.x - x, l.y - y) <= LAMP_KNOCK || Math.hypot(l.x - bx, l.y - by) <= LAMP_KNOCK - 0.8) out.push(k);
  });
  return out;
}

/** The camera as the lamp cull needs it. */
export interface View {
  viewProjection: Float32Array;
  /** Vertical field of view, in degrees. */
  fov: number;
  aspect: number;
  target: [number, number, number];
}

/**
 * The lamps lit whose light can reach the screen: the floor under one is in
 * view, or off the edge by less than its light carries (`reach`, a lamp's
 * unless said). The nearest the eye first. Into `out`, which is emptied
 * first. Anything else that lights the floor round it is culled the same way.
 */
export function lampsInView(
  lamps: readonly { x: number; y: number }[],
  lit: (k: number) => boolean,
  view: View & { reach?: number },
  out: number[],
): number[] {
  const reach = view.reach ?? LAMP_REACH;
  const [ex, ey] = view.target,
    lens = 1 / Math.tan((view.fov * Math.PI) / 360);
  out.length = 0;
  lamps.forEach((l, k) => {
    if (!lit(k)) return;
    const q = project(view.viewProjection, l.x, l.y, 0);
    // how much of the screen its light's reach is at that depth: up, by the lens, and across, by that over the frame's shape
    const up = q ? (reach * lens * 1.1) / q[2] : 0,
      across = up / view.aspect;
    if (q ? Math.abs(q[0]) < 1 + across && Math.abs(q[1]) < 1 + up : Math.hypot(l.x - ex, l.y - ey) < reach)
      out.push(k);
  });
  const dist = (k: number) => Math.hypot(lamps[k].x - ex, lamps[k].y - ey);
  out.sort((a, b) => dist(a) - dist(b));
  return out;
}

/** How a lamp stands, or lies where it fell: its post from its foot, and its head. */
export interface LampPose {
  yaw: number;
  pitch: number;
  post: [number, number, number];
  head: [number, number, number];
  /** The post's length against a standard post's. */
  postScale: number;
}

export function lampPose(l: Lamp, k: number, down: boolean): LampPose {
  const yaw = fallYaw(k),
    pitch = down ? 1.45 : 0;
  const reach = l.height - 0.3;
  return {
    yaw,
    pitch,
    post: [l.x, l.y, down ? 0.25 : 0],
    head: [
      l.x + Math.sin(yaw) * Math.sin(pitch) * reach,
      l.y - Math.cos(yaw) * Math.sin(pitch) * reach,
      (down ? 0.6 : 0) + Math.cos(pitch) * reach,
    ],
    postScale: l.height / LAMP_HEIGHT,
  };
}
