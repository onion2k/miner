/**
 * Where the camera looks, and from where. Three ways to hold it, cycled with V:
 *
 * - `fixed`: the world keeps its orientation and the camera slides. This
 *   is what top-down games settle on, because the ground fills the frame
 *   and turning the view turns everything: a dozer that spins on the spot
 *   would spin the cave. The camera leads the dozer along its velocity
 *   (Keren's projected focus) so the player sees where they are going,
 *   and only moves once the dozer pushes past a window round the aim
 *   (the camera-window), then eases after it (lerp-smoothing).
 * - `chase`: swings round to sit behind the dozer, in two smoothed stages
 *   so it settles without overshooting.
 * - `free`: only the mouse moves it.
 *
 * A drag takes the camera in any mode for a few seconds; C gives it back.
 */

export type CameraMode = 'fixed' | 'chase' | 'free';
export const CAMERA_MODES: readonly CameraMode[] = ['fixed', 'chase', 'free'];

/** Where the camera starts, and goes back to. */
export const CAMERA_HOME = { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 };
/** How far the led point can wander from the aim before the aim is dragged after it. */
const WINDOW = 4.5;
/** How long a drag keeps the camera the player's, in seconds. */
const MANUAL_FOR = 5;

/** The orbit controls, as the rig drives them. */
export interface OrbitLike {
  readonly currentAzimuth: number;
  readonly distance: number;
  setSpherical(s: { azimuth?: number; polar?: number; radius?: number }): void;
  update(): void;
}

/** The machine it follows. */
export interface Followed {
  x: number;
  y: number;
  yaw: number;
  speed: number;
}

/** Where the mode is kept between visits: localStorage, or nothing. */
export interface ModeStore {
  get(): string | null;
  set(mode: CameraMode): void;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class CameraRig {
  mode: CameraMode = 'fixed';
  /** Where the camera is aimed, eased after the aim. */
  readonly follow: [number, number];
  private readonly aim: [number, number];
  private readonly lead: [number, number] = [0, 0];
  private chase = CAMERA_HOME.azimuth;
  private manualUntil = 0;

  /**
   * `free` is left out of the cycle where there is no drag to move it — a
   * phone, whose canvas takes no pointers — or a free camera would be a
   * stuck one.
   */
  constructor(
    private readonly orbit: OrbitLike,
    private readonly camera: { target: [number, number, number] },
    start: { x: number; y: number },
    private readonly store: ModeStore,
    private readonly canFree: boolean,
  ) {
    this.aim = [start.x, start.y];
    this.follow = [start.x, start.y];
    const saved = store.get();
    if (CAMERA_MODES.includes(saved as CameraMode) && (canFree || saved !== 'free')) this.mode = saved as CameraMode;
    orbit.setSpherical(CAMERA_HOME);
  }

  /** The player has taken the camera, at `now` seconds. */
  grab(now: number) {
    this.manualUntil = now + MANUAL_FOR;
  }

  /** On to the next mode. The mode it is now. */
  cycle(): CameraMode {
    const modes = this.canFree ? CAMERA_MODES : CAMERA_MODES.filter((m) => m !== 'free');
    this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.store.set(this.mode);
    this.manualUntil = 0;
    if (this.mode === 'fixed') this.home();
    return this.mode;
  }

  /** Back to where it started: the height and distance, and the heading too unless it is chasing. */
  recentre() {
    this.manualUntil = 0;
    this.orbit.setSpherical({ polar: CAMERA_HOME.polar, radius: CAMERA_HOME.radius });
    if (this.mode !== 'chase') this.home();
  }

  /** Round to the heading it started on, by the shorter way. */
  private home() {
    this.orbit.setSpherical({
      azimuth: this.orbit.currentAzimuth + wrap(CAMERA_HOME.azimuth - this.orbit.currentAzimuth),
    });
  }

  /** A frame of `dt` seconds, at `now` seconds: the aim after the machine, and the camera after the aim. */
  update(dt: number, now: number, m: Followed) {
    const c = Math.cos(m.yaw),
      s = Math.sin(m.yaw);
    // The lead: ahead along the velocity, further the faster, and eased so
    // a change of direction swings the view rather than snapping it.
    const leadLen = Math.min(11, Math.abs(m.speed) * 0.7);
    const kl = Math.min(1, 2 * dt);
    this.lead[0] += (c * Math.sign(m.speed) * leadLen - this.lead[0]) * kl;
    this.lead[1] += (s * Math.sign(m.speed) * leadLen - this.lead[1]) * kl;
    // The window: the aim stays put until the led point leaves a box round
    // it, so shuffling about does not move the view; then it is dragged.
    const fx = m.x + this.lead[0],
      fy = m.y + this.lead[1];
    this.aim[0] = Math.max(fx - WINDOW, Math.min(fx + WINDOW, this.aim[0]));
    this.aim[1] = Math.max(fy - WINDOW, Math.min(fy + WINDOW, this.aim[1]));
    const k = Math.min(1, 3 * dt);
    this.follow[0] += (this.aim[0] - this.follow[0]) * k;
    this.follow[1] += (this.aim[1] - this.follow[1]) * k;
    this.camera.target = [this.follow[0], this.follow[1], 1.5];
    if (now < this.manualUntil || this.mode !== 'chase') {
      // the player has the camera, or the world holds still: the chase heading rests wherever the view is
      this.chase = this.orbit.currentAzimuth;
    } else {
      // behind the nose, whichever way it is driving, by the shorter way round
      this.chase += wrap(m.yaw + Math.PI - this.chase) * Math.min(1, 3.5 * dt);
      const was = this.orbit.currentAzimuth;
      this.orbit.setSpherical({ azimuth: was + wrap(this.chase - was) });
    }
    this.orbit.update();
  }
}
