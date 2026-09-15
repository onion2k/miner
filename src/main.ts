/**
 * Pushminer: a bulldozer in a cave full of coins, and a hole to push them
 * into. Drawn on the game path of artshape-render — a forward renderer that
 * redraws everything every frame and instances the thousands of coins as
 * one draw each.
 */
import { createContext } from 'artshape-render/gpu/context';
import { Orbit } from 'artshape-render/gpu/camera';
import { bakeEnvironment } from 'artshape-render/render/env';
import { GameRenderer, EFFECT_STRIDE, MATERIAL_STRIDE, type GameGroup } from 'artshape-render/game/renderer';
import { LightPool } from 'artshape-render/game/lights';
import { mergeMeshes } from 'artshape-render/mesh/types';
import { AREAS, BODY_CAPACITY, BRICK, COLS, HOLE, LAMP_HEIGHT, areaAt, ORDER, ORIGIN_X, ORIGIN_Y, SECRET, SECRETS, STASHES, TILE, WALLS, atGate, stashCentre, chamberCentre, tileCentre, wallAlongX, behindGate, buildCave, floorTiles, gateCentre, gateTiles, hash, pastGate, sealPoint, wallInstances, type Heap, type Vein } from './cave';
import { World, BAR, BRICK_KIND, KINDS, KIND_NAME, KIND_RADIUS, KIND_VALUE, type Pusher } from './physics';
import { Dozer, BLADE_AT, BLADE_HEIGHT, TRACK_GAUGE, bladePieces, separate } from './dozer';
import { Input } from './input';
import { TouchControls, isTouchDevice } from './touch';
import { CLEAR_SHARE, Economy, MAX_DRONES, SOURCES, WALL_NAME, WALL_STRENGTH, areaOfSource, chamberSource, renderShop, roomStock, stashSource, wallSource } from './economy';
import { Bot, BOT_SCALE, BOT_SPEC, Foreman, Fountain, beltOf } from './tools';
import { Nav } from './nav';
import { Sound } from './audio';
import { COIN_LADDER, ball, bar, box, coin, collar, cylinder, gem, moved, pit, tile, turned } from './meshes';
import { identity, hide, place, placePart, placeQuat, project } from './matrix';

/** One world unit is ten centimetres: a coin two across is a big cartoon coin. */
const MM_PER_UNIT = 100;
const LIGHT_CAPACITY = 256;
const EFFECT_CAPACITY = 256;
/** How many of each kind the cave can hold at once, past the coins; the last two are gold bars and bricks. */
const GEM_CAPACITY = [0, 320, 240, 260, 160, 60, 900];
/** Driving into the rock that breaks, or a brick wall: square enough on, as the cosine off straight at it, and fast enough, to smash it. */
const SMASH_SQUARE = 0.7, SMASH_SPEED = 6;
/** A brick in a wall: how long along the wall, how deep, how tall; and how many courses a wall stands. */
const BRICK_SIZE = [1.9, 1.75, 1.05] as const, COURSES = 4;
/** The colour of each grade of wall, clay, stone and iron-bound, and how rough. */
const WALL_COLOUR: [number, number, number, number][] = [[0, 0, 0, 0], [0.58, 0.24, 0.16, 0.85], [0.46, 0.45, 0.47, 0.8], [0.2, 0.22, 0.27, 0.45]];
/** The colour of each kind of gem, for one set in a wall as for one loose. */
const GEM_ALBEDO: [number, number, number][] = [[0, 0, 0], [1.0, 0.06, 0.12], [0.08, 0.95, 0.35], [0.12, 0.35, 1.0], [0.9, 0.97, 1.0]];
/** Where a body came from when it came from nowhere that counts: a brick. */
const NO_SOURCE = 255;
const BOT_CAPACITY = MAX_DRONES;
const TREAD_BARS = 9;
const STRIPE_CAPACITY = 160;
/** The pennant: a pole and this many slats waving behind it. */
const FLAG_SLATS = 5;

/**
 * What drawing one frame may cost at load, CPU and GPU together, before the
 * coins step down a rung: half a 60 Hz frame, leaving the rest for the
 * physics and the browser. `?coins=0`…`3` skips the measuring and picks one.
 */
const RENDER_BUDGET_MS = 8;
const CALIBRATE_WARMUP = 4;
const CALIBRATE_SAMPLES = 24;

/** How high a lamp's head stands, how many lamps are lit at once near the eye, and how near a machine has to come to knock one over. */
const LAMP_LIGHTS = 240, LAMP_KNOCK = 4.2;
/**
 * The lamps over the hole: three, hanging from the dark on cords, high enough to drive under, round
 * above its rim. How high they hang, and how far the cord goes up before it is lost in the dark.
 */
const HOLE_LAMP_HEIGHT = 15, HOLE_CORD = 12;
const HOLE_LAMPS: [number, number][] = [90, 210, 330].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return [HOLE.x + Math.cos(a) * (HOLE.radius + 1.5), HOLE.y + Math.sin(a) * (HOLE.radius + 1.5)];
});
/** How far a lamp's light carries, and how bright it is. */
const LAMP_REACH = 40, LAMP_BRIGHT = 16;

const CAMERA = { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 };

const canvas = document.getElementById('view') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const bootMsg = document.getElementById('bootMsg')!;
const bankPanel = document.getElementById('bank')!;
const bankValue = bankPanel.querySelector('b')!;
const shopBalance = document.getElementById('shopBalance')!;
const progressText = document.getElementById('progress')!;
const shopProgress = document.getElementById('shopProgress')!;
const pointer = document.getElementById('pointer')!;
const pointerArrow = pointer.querySelector('.arrow') as HTMLElement;
const pointerLabel = pointer.querySelector('span')!;
const statsPanel = document.getElementById('stats')!;
const helpPanel = document.getElementById('help')!;
const toast = document.getElementById('toast')!;
const shopPanel = document.getElementById('shop')!;
const shopRows = shopPanel.querySelector('.rows') as HTMLElement;
const shopCosmetics = shopPanel.querySelector('.rows.cosmetics') as HTMLElement;

main().catch((err) => { bootMsg.textContent = String(err?.message ?? err); console.error(err); });

async function main() {
  const ctx = await createContext(canvas);
  bootMsg.textContent = 'compiling shaders…';
  const renderer = new GameRenderer(ctx, LIGHT_CAPACITY, EFFECT_CAPACITY, 8192, MM_PER_UNIT);
  // the particles' fall, in world units: slower than the earth's, for sparkles that hang
  renderer.gravity = 30;
  renderer.look = {
    ...renderer.look,
    albedo: [0.8, 0.8, 0.8],
    roughness: 0.6,
    // Pitch black: no daylight, no fill. What is seen is what a lamp or a machine's
    // lights fall on, and nothing else.
    sunDir: [0.3, -0.22, 0.93],
    sunColour: [0, 0, 0],
    exposure: 1.3,
    falloffHalf: 9,
    ambient: 0,
    occlusion: 2,
    occlusionRadius: 2.5,
    occlusionDirect: 0.3,
    spotSoftness: 0.004,
    background: [0, 0, 0],
  };
  // bloom on what is past white, so lamps, the hole and coin glints spill light; any
  // lower and a run of coins into the hole, each throwing gold sparkles, is a white blob
  renderer.post = { bloom: 0.45, threshold: 1.25, knee: 0.5, vignette: 0.32, grain: 0.02 };
  const env = bakeEnvironment(ctx, 'studio', { size: 128, mips: 6 });
  renderer.setEnvironment(env.specular, env.brdf, env.mips);
  renderer.camera.fov = 42;
  renderer.camera.near = 2;
  renderer.camera.far = 700;

  bootMsg.textContent = 'digging the cave…';
  await new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 50); });

  const economy = new Economy();
  const cave = buildCave();
  const world = new World(BODY_CAPACITY, cave.solid(economy.save.areas, economy.save.secrets, economy.save.walls));
  const dozer = new Dozer(world.solid);
  const input = new Input();
  const sound = new Sound();
  /** The last room: once the cave is cleared its vein runs and its floor cracks, so there is still something to push. */
  const LAST = ORDER[ORDER.length - 1];
  const fountains: Fountain[] = [];
  if (economy.save.done) fountains.push(new Fountain(AREAS[LAST]));
  const nav = new Nav(world.solid);
  const bots: Bot[] = [];
  const traffic = { bots, player: dozer };
  for (let i = 0; i < economy.save.drones; i++) bots.push(new Bot(world.solid, i + 1, HOLE.x + 14 + i * 6, HOLE.y + 10));
  /** The belts that run: those bought, for rooms not sealed. */
  const running = () => AREAS.map((_, a) => a).filter((a) => AREAS[a].belt && economy.save.belts[a] && !economy.sealed(a));
  world.belts = running().map((a) => beltOf(AREAS[a].belt!.spec));
  nav.setBelts(world.belts);

  // ---- the static half: floor, walls, hole, gates, belts ----

  const meshes = {
    tile: tile(TILE * 1.01), wall: box(TILE * 1.02, TILE * 1.02, 1), gate: box(3.4, 3.4, 1, false),
    // the three tiles each way the floor leaves out, and a little more so no seam shows
    // between them; see where it is placed for why that overlap does not flicker
    collar: collar(TILE * 3 + 0.2, HOLE.radius), pit: pit(HOLE.radius, HOLE.depth), brick: box(1, 1, 1, true), stud: gem(1.05, 2.3),
    lampPost: cylinder(0.14, LAMP_HEIGHT, 6), lampHead: moved(box(0.8, 0.8, 0.9, true), 0, 0, 0.1),
    // a shade hung from its top: a short drum
    hanging: moved(cylinder(0.6, 0.7, 10), 0, 0, -0.7),
    beltBase: box(1, 1, 1), rail: box(1, 1, 1),
  };

  /**
   * The bricks of a wall as it stands: courses of them, two deep across the
   * corridor, each course set half a brick along from the one below, with a
   * part brick at each end where the bond leaves one. Along the wall's own
   * length, which is X or Y as the wall runs.
   */
  function layBricks(w: number): { x: number; y: number; z: number; yaw: number; length: number }[] {
    const [x0, y0, x1, y1] = WALLS[w].tiles;
    const alongX = wallAlongX(w);
    const start = alongX ? ORIGIN_X + x0 * TILE : ORIGIN_Y + y0 * TILE;
    const span = ((alongX ? x1 - x0 : y1 - y0) + 1) * TILE;
    const across = alongX ? ORIGIN_Y + (y0 + 0.5) * TILE : ORIGIN_X + (x0 + 0.5) * TILE;
    const out: { x: number; y: number; z: number; yaw: number; length: number }[] = [];
    const L = BRICK_SIZE[0], D = BRICK_SIZE[1], H = BRICK_SIZE[2];
    for (let c = 0; c < COURSES; c++) {
      for (const side of [-1, 1]) {
        const offset = ((c + (side > 0 ? 1 : 0)) % 2) * (L / 2);
        for (let edge = -offset; edge < span; edge += L) {
          const a = Math.max(0, edge), b = Math.min(span, edge + L);
          if (b - a < 0.5) continue;
          const along = start + (a + b) / 2, off = across + side * (D / 2 + 0.05);
          out.push({ x: alongX ? along : off, y: alongX ? off : along, z: H * (c + 0.5), yaw: alongX ? 0 : Math.PI / 2, length: b - a - 0.08 });
        }
      }
    }
    return out;
  }

  /**
   * Which of a wall's bricks hold its treasure, and what: a gold bar is a gold
   * brick, a gem is set in the top of one. Always the same bricks for the same
   * wall, and from the top course, where they show from above.
   */
  function treasureBricks(w: number): { brick: number; kind: number }[] {
    const bricks = layBricks(w), items = WALLS[w].treasure.flatMap(([kind, n]) => new Array<number>(n).fill(kind));
    const high = bricks.map((b, i) => [b, i] as const).filter(([b]) => b.z > BRICK_SIZE[2] * (COURSES - 1)).map(([, i]) => i);
    const taken = new Set<number>(), out: { brick: number; kind: number }[] = [];
    items.forEach((kind, n) => {
      let pick = high[Math.floor(hash(w, n, 11) * high.length)];
      for (let tries = 0; taken.has(pick) && tries < high.length; tries++) pick = high[(high.indexOf(pick) + 1) % high.length];
      taken.add(pick);
      out.push({ brick: pick, kind });
    });
    return out;
  }

  // ---- the lamps ----

  /** Whether a lamp is lit: standing, and in a room open and not sealed. */
  const lampOn = (k: number) => !economy.save.lampsBroken.includes(k) && economy.save.areas[cave.lamps[k].area];
  /** How much of its own colour a floor, a rock or a brick at a point shows: none at all in a room not open, so no lamp's light spilling through the rock shows there. */
  const shown = (x: number, y: number) => (economy.save.areas[areaAt(x, y)] ? 1 : 0.02);
  /** The lamps lit near the eye this frame, nearest first. */
  const lampsLit: number[] = [];
  /** The way a lamp fell, which is always the same way for the same lamp. */
  const fallYaw = (k: number) => hash(k, 3, 17) * Math.PI * 2;

  /** Knock over any lamp the player's machine is into: its hull, or its blade. */
  function knockLamps() {
    const c = Math.cos(dozer.yaw), sn = Math.sin(dozer.yaw);
    const bx = dozer.x + c * BLADE_AT, by = dozer.y + sn * BLADE_AT;
    cave.lamps.forEach((l, k) => {
      if (economy.save.lampsBroken.includes(k)) return;
      if (Math.hypot(l.x - dozer.x, l.y - dozer.y) > LAMP_KNOCK && Math.hypot(l.x - bx, l.y - by) > LAMP_KNOCK - 0.8) return;
      const lit = lampOn(k);
      economy.breakLamp(k);
      sound.shatter();
      // glass, and the last of the light going out of it as sparks
      renderer.emit({ position: [l.x, l.y, l.height], velocity: [c * 3, sn * 3, 4], spread: 6, count: 40, life: 0.9, lifeSpread: 0.4, size: 0.18, growth: -0.1, colour: lit ? [2.4, 2.0, 1.4] : [0.6, 0.65, 0.7], alpha: 1, gravity: 1.6, floor: 0 });
      if (lit) renderer.emit({ position: [l.x, l.y, l.height], velocity: [0, 0, 2], spread: 3, count: 25, life: 0.5, lifeSpread: 0.3, size: 0.12, growth: -0.2, colour: [3, 2.2, 0.9], alpha: 0, gravity: 0.6, floor: 0 });
      buildStatic();
    });
  }

  function buildStatic() {
    const floor = floorTiles(cave, economy.save.secrets);
    const floorM = new Float32Array(floor.length * 16);
    const floorMat = new Float32Array(floor.length * MATERIAL_STRIDE);
    floor.forEach(([x, y], i) => {
      place(floorM, i, x, y, 0);
      const h = hash(x, y, 3), warm = hash(x, y, 5);
      const k = shown(x, y);
      floorMat.set([(0.3 + h * 0.06 + warm * 0.04) * k, (0.21 + h * 0.04) * k, (0.13 + h * 0.03) * k, 0.95], i * MATERIAL_STRIDE);
    });
    const walls = wallInstances(cave, economy.save.secrets);
    const wallM = new Float32Array(walls.length * 16);
    const wallMat = new Float32Array(walls.length * MATERIAL_STRIDE);
    walls.forEach((w, i) => {
      placePart(wallM, i, w.x, w.y, -0.5, 0, 0, 0, 0, 0, 0, 1, 1, w.height + 0.5);
      const s = 0.8 + w.shade * 0.35, dim = (w.ring ? 0.8 : 1) * shown(w.x, w.y);
      wallMat.set([0.15 * s * dim, 0.16 * s * dim, 0.21 * s * dim, 0.88], i * MATERIAL_STRIDE);
    });
    const gates: [number, number, number][] = [];
    for (let a = 1; a < AREAS.length; a++) {
      if (economy.save.areas[a]) continue;
      for (const [x, y] of gateTiles(cave, a)) gates.push([x, y, a]);
    }
    const gateM = new Float32Array(Math.max(1, gates.length) * 16);
    gates.forEach(([x, y, a], i) => placePart(gateM, i, x, y, 0, hash(x, y, a) * 0.5 - 0.25, 0, 0, 0, 0, 0, 1, 1, 2.6 + hash(x, y) * 1.2));
    if (!gates.length) hide(gateM, 0);
    // The brick walls still standing, each brick a shade off the next. A wall that has taken a
    // beating shows it: its bricks knocked askew and darker, the more the worse. A gold brick is
    // gold, and a gem set in a wall sits in the top of its brick.
    const standing: { x: number; y: number; z: number; yaw: number; length: number; colour: number[]; tilt: number }[] = [];
    const studs: { x: number; y: number; z: number; kind: number }[] = [];
    WALLS.forEach((wall, w) => {
      if (economy.save.walls[w]) return;
      const hurt = economy.save.wallDamage[w] / WALL_STRENGTH[wall.grade];
      const bricks = layBricks(w), gold = new Map(treasureBricks(w).map((t) => [t.brick, t.kind]));
      bricks.forEach((b, i) => {
        const j = (salt: number) => hash(w * 131 + i, salt, 5) - 0.5;
        const kind = gold.get(i);
        const shade = (0.82 + hash(b.x * 3, b.y * 3, b.z * 7) * 0.3) * (1 - hurt * 0.35) * shown(b.x, b.y);
        const colour = kind === BAR ? [1.0, 0.72, 0.18, 0.2] : [...WALL_COLOUR[wall.grade].slice(0, 3).map((c) => c * shade), WALL_COLOUR[wall.grade][3]];
        const x = b.x + j(1) * hurt * 0.9, y = b.y + j(2) * hurt * 0.9;
        standing.push({ x, y, z: b.z, yaw: b.yaw + j(3) * hurt * 0.5, length: b.length, colour, tilt: j(4) * hurt * 0.3 });
        if (kind !== undefined && kind !== BAR) studs.push({ x, y, z: b.z + BRICK_SIZE[2] / 2, kind });
      });
    });
    const brickM = new Float32Array(Math.max(1, standing.length) * 16), brickMat = new Float32Array(Math.max(1, standing.length) * MATERIAL_STRIDE);
    standing.forEach((b, i) => {
      placePart(brickM, i, b.x, b.y, b.z, b.yaw, 0, 0, 0, 0, b.tilt, b.length, BRICK_SIZE[1], BRICK_SIZE[2]);
      brickMat.set(b.colour, i * MATERIAL_STRIDE);
    });
    if (!standing.length) hide(brickM, 0);
    const studM = new Float32Array(Math.max(1, studs.length) * 16), studMat = new Float32Array(Math.max(1, studs.length) * MATERIAL_STRIDE);
    studs.forEach((g, i) => {
      placePart(studM, i, g.x, g.y, g.z, 0, 0, 0, 0, 0, 0, 0.45, 0.45, 0.45);
      studMat.set([...(GEM_ALBEDO[g.kind] as number[]), 0.2], i * MATERIAL_STRIDE);
    });
    if (!studs.length) hide(studM, 0);
    // the lamps: a post each, standing or lying where it fell, and a head on it, dark on one knocked over
    const postM = new Float32Array(Math.max(1, cave.lamps.length) * 16), headM = new Float32Array(Math.max(1, cave.lamps.length) * 16);
    const headMat = new Float32Array(Math.max(1, cave.lamps.length) * MATERIAL_STRIDE);
    cave.lamps.forEach((l, k) => {
      const down = economy.save.lampsBroken.includes(k);
      const yaw = fallYaw(k), pitch = down ? 1.45 : 0;
      placePart(postM, k, l.x, l.y, down ? 0.25 : 0, yaw, 0, 0, 0, 0, pitch, 1, 1, l.height / LAMP_HEIGHT);
      const reach = l.height - 0.3;
      const hx = l.x + Math.sin(yaw) * Math.sin(pitch) * reach, hy = l.y - Math.cos(yaw) * Math.sin(pitch) * reach, hz = (down ? 0.6 : 0) + Math.cos(pitch) * reach;
      placePart(headM, k, hx, hy, hz, yaw, 0, 0, 0, 0, pitch, 1, 1, 1);
      headMat.set(down ? [0.18, 0.17, 0.16, 0.6] : [1.0, 0.86, 0.6, 0.3], k * MATERIAL_STRIDE);
    });
    // the lamps over the hole: a cord up into the dark, and a shade on the end of it
    const cordM = new Float32Array(HOLE_LAMPS.length * 16), shadeM = new Float32Array(HOLE_LAMPS.length * 16);
    HOLE_LAMPS.forEach(([x, y], i) => {
      placePart(cordM, i, x, y, HOLE_LAMP_HEIGHT, 0, 0, 0, 0, 0, 0, 0.4, 0.4, HOLE_CORD / LAMP_HEIGHT);
      placePart(shadeM, i, x, y, HOLE_LAMP_HEIGHT, 0, 0, 0, 0, 0, 0, 1.3, 1.3, 1.1);
    });
    const brickGroups: GameGroup[] = [
      { mesh: meshes.lampPost, matrices: cordM, count: HOLE_LAMPS.length, albedo: [0.15, 0.15, 0.17], roughness: 0.6 },
      { mesh: meshes.hanging, matrices: shadeM, count: HOLE_LAMPS.length, albedo: [0.75, 1.0, 0.7], roughness: 0.3 },
      { mesh: meshes.lampPost, matrices: postM, count: cave.lamps.length, albedo: [0.22, 0.22, 0.25], roughness: 0.5 },
      { mesh: meshes.lampHead, matrices: headM, materials: headMat, count: cave.lamps.length },
      { mesh: meshes.brick, matrices: brickM, materials: brickMat, count: standing.length },
      { mesh: meshes.stud, matrices: studM, materials: studMat, count: studs.length },
    ];
    const belts: GameGroup[] = [];
    for (const a of running()) {
      const s = AREAS[a].belt!.spec;
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0), yaw = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;
      const base = new Float32Array(16);
      placePart(base, 0, cx, cy, 0, yaw, 0, 0, 0, 0, 0, len, s.width, 0.35);
      const rails = new Float32Array(32);
      placePart(rails, 0, cx, cy, 0, yaw, 0, s.width / 2 + 0.3, 0, 0, 0, len, 0.6, 0.9);
      placePart(rails, 1, cx, cy, 0, yaw, 0, -s.width / 2 - 0.3, 0, 0, 0, len, 0.6, 0.9);
      belts.push({ mesh: meshes.beltBase, matrices: base, albedo: [0.12, 0.12, 0.14], roughness: 0.7 });
      belts.push({ mesh: meshes.rail, matrices: rails, albedo: [0.75, 0.55, 0.2], roughness: 0.4 });
    }
    const collarM = new Float32Array(16);
    place(collarM, 0, HOLE.x, HOLE.y, -0.01);
    renderer.setStatic([
      { mesh: meshes.tile, matrices: floorM, materials: floorMat },
      // A hundredth under the floor: where it overlaps the tiles they win the depth test
      // outright. It was four tiles across at the tiles' own height, under the next ring
      // of them, and the two fought over which was drawn.
      { mesh: meshes.collar, matrices: collarM, albedo: [0.33, 0.23, 0.145], roughness: 0.95 },
      { mesh: meshes.pit, matrices: identity(), albedo: [0.04, 0.035, 0.05], roughness: 0.95 },
      { mesh: meshes.wall, matrices: wallM, materials: wallMat },
      { mesh: meshes.gate, matrices: gateM, count: gates.length, albedo: [0.62, 0.32, 0.72], roughness: 0.35 },
      ...brickGroups,
      ...belts,
    ]);
  }
  buildStatic();

  // ---- the dynamic half: coins, gems, the dozer, drones, belt stripes ----

  const COINS = 0, GEMS = 1, HULL = 5, DARK = 6, BLADE = 7, TREADS = 8, BOT_HULL = 9, BOT_DARK = 10, BOT_BLADE = 11, STRIPES = 12, POLE = 13, FLAG = 14, BARS = 15, RUBBLE = 16;
  /** The dynamic group a kind of thing is drawn in; bricks by the grade of the wall they came from. */
  const groupOf = (kind: number, grade = 1) => (kind === BAR ? BARS : kind === BRICK_KIND ? RUBBLE + grade - 1 : kind);
  /** The grade of wall each brick in the world came from, by slot. */
  const brickGrade = new Uint8Array(BODY_CAPACITY);
  const rubbleM = [1, 2, 3].map(() => new Float32Array(GEM_CAPACITY[BRICK_KIND] * 16));
  const coinM = new Float32Array(BODY_CAPACITY * 16);
  const gemM = GEM_CAPACITY.map((n) => new Float32Array(Math.max(1, n) * 16));
  const hullM = new Float32Array(16), darkM = new Float32Array(16), bladeM = new Float32Array(16);
  const treadM = new Float32Array((1 + BOT_CAPACITY) * TREAD_BARS * 2 * 16);
  const botHullM = new Float32Array(BOT_CAPACITY * 16), botDarkM = new Float32Array(BOT_CAPACITY * 16), botBladeM = new Float32Array(BOT_CAPACITY * 16);
  const stripeM = new Float32Array(STRIPE_CAPACITY * 16);
  const poleM = new Float32Array(16), flagM = new Float32Array(FLAG_SLATS * 16);

  const hull = mergeMeshes([
    moved(box(5.4, 3.4, 1.7), 0, 0, 0.8),          // the body
    moved(box(2.8, 2.8, 1.1), 1.1, 0, 2.5),          // the hood
    moved(box(2.3, 3.0, 2.3), -1.5, 0, 2.5),         // the cab
    moved(box(0.7, 0.5, 0.4), 2.5, 0.9, 2.9),        // a headlamp each side
    moved(box(0.7, 0.5, 0.4), 2.5, -0.9, 2.9),
  ]);
  const dark = mergeMeshes([
    moved(box(6.6, 1.7, 1.9), 0, 2.15, 0),           // the tracks
    moved(box(6.6, 1.7, 1.9), 0, -2.15, 0),
    moved(box(2.4, 3.1, 1.1), -1.5, 0, 3.2),         // the glass, a band round the cab
    moved(cylinder(0.26, 1.7, 8), 1.7, 0.9, 3.5),    // the exhaust
    moved(box(3.4, 0.45, 0.45), 2.6, 2.4, 1.7),      // the blade's arms
    moved(box(3.4, 0.45, 0.45), 2.6, -2.4, 1.7),
    moved(box(0.9, 3.6, 0.4), -3.2, 0, 1.9),         // a rear step
  ]);
  // The blade, in the dozer's own frame: its pieces along the arc, each a
  // plate with a lip along the top and a cutting edge along the bottom.
  // Rebuilt when a wider one is bought.
  function bladeMesh(width: number) {
    return mergeMeshes(bladePieces(width).map((p) => moved(turned(mergeMeshes([
      box(0.35, p.length, BLADE_HEIGHT, true),
      moved(box(0.7, p.length, 0.22, true), 0.17, 0, BLADE_HEIGHT / 2 - 0.11),
      moved(box(0.6, p.length, 0.18, true), 0.12, 0, -BLADE_HEIGHT / 2 + 0.09),
    ]), p.turn), p.x, p.y, BLADE_HEIGHT / 2)));
  }
  // the robo-dozer's beacon, on the cab roof, so it reads as a machine and not a second player
  const botExtras = mergeMeshes([moved(ball(0.45, 5, 8), -1.5, 0, 4.2), moved(cylinder(0.12, 0.6, 6), -1.5, 0, 3.6)]);
  const gemMesh = gem(1.05, 2.3);
  let coinDetail = 0;
  const dynamic: GameGroup[] = [
    { mesh: coin(0.52, 0.26, coinDetail), matrices: coinM, count: 0, albedo: [1.0, 0.56, 0.08], roughness: 0.26 },
    { mesh: gemMesh, matrices: gemM[1], count: 0, albedo: GEM_ALBEDO[1], roughness: 0.28 },
    { mesh: gemMesh, matrices: gemM[2], count: 0, albedo: GEM_ALBEDO[2], roughness: 0.28 },
    { mesh: gemMesh, matrices: gemM[3], count: 0, albedo: GEM_ALBEDO[3], roughness: 0.28 },
    { mesh: gemMesh, matrices: gemM[4], count: 0, albedo: GEM_ALBEDO[4], roughness: 0.15 },
    { mesh: hull, matrices: hullM, albedo: economy.paint().colour, roughness: economy.paint().roughness },
    { mesh: dark, matrices: darkM, albedo: [0.15, 0.15, 0.17], roughness: 0.75 },
    { mesh: bladeMesh(economy.spec().bladeWidth), matrices: bladeM, albedo: [0.4, 0.42, 0.48], roughness: 0.35 },
    { mesh: box(0.55, 1.9, 0.35), matrices: treadM, count: TREAD_BARS * 2, albedo: [0.3, 0.3, 0.32], roughness: 0.8 },
    { mesh: mergeMeshes([hull, botExtras]), matrices: botHullM, count: 0, albedo: [0.88, 0.9, 0.92], roughness: 0.45 },
    { mesh: dark, matrices: botDarkM, count: 0, albedo: [0.95, 0.45, 0.1], roughness: 0.6 },
    { mesh: bladeMesh(BOT_SPEC.bladeWidth), matrices: botBladeM, count: 0, albedo: [0.4, 0.42, 0.48], roughness: 0.35 },
    { mesh: box(0.5, 1, 0.15), matrices: stripeM, count: 0, albedo: [0.9, 0.78, 0.3], roughness: 0.5 },
    { mesh: cylinder(0.09, 4.2, 6), matrices: poleM, count: 0, albedo: [0.3, 0.3, 0.32], roughness: 0.5 },
    { mesh: box(0.4, 0.06, 0.9, true), matrices: flagM, count: 0, albedo: flagColour(), roughness: 0.6 },
    // a gold bar, lying on the floor where the physics holds its ball
    { mesh: bar(2.6, 1.3, 0.9, KIND_RADIUS[BAR]), matrices: gemM[BAR], count: 0, albedo: [1.0, 0.72, 0.18], roughness: 0.18 },
    // bricks off the walls, lying where the physics holds their balls
    ...[1, 2, 3].map((grade) => ({ mesh: moved(box(BRICK_SIZE[0], BRICK_SIZE[1] * 0.55, BRICK_SIZE[2], true), 0, 0, BRICK_SIZE[2] / 2 - KIND_RADIUS[BRICK_KIND]), matrices: rubbleM[grade - 1], count: 0, albedo: WALL_COLOUR[grade].slice(0, 3) as [number, number, number], roughness: WALL_COLOUR[grade][3] })),
  ];
  /** The pennant is red, unless the hull is: then it is white, so it shows. */
  function flagColour(): [number, number, number] {
    const [r, g, b] = economy.paint().colour;
    return r > 0.6 && g < 0.5 && b < 0.75 ? [0.95, 0.95, 0.95] : [0.9, 0.15, 0.15];
  }
  renderer.setDynamic(dynamic);

  // ---- coins into the cave ----

  // How many of each kind are in the cave, and how many of each from each room and hidden
  // chamber: kept in the save, so a reload puts back what is left. Each body remembers where it
  // came from.
  const saved = economy.save.left;
  const left = economy.save.left = Array.from({ length: SOURCES }, () => new Array<number>(KINDS).fill(0));
  const kinds = new Array<number>(KINDS).fill(0);
  const origin = new Uint8Array(BODY_CAPACITY);
  function spawn(kind: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, from = economy.current()): boolean {
    if (kind > 0 && kinds[kind] >= GEM_CAPACITY[kind]) return false;
    const i = world.spawn(kind, x, y, z, vx, vy, vz);
    if (i < 0) return false;
    origin[i] = from;
    kinds[kind]++; left[from][kind]++;
    return true;
  }
  /** A heap from a room or a chamber, with `share[kind]` of each kind in it: all of them for one just opened. */
  function spawnHeap(area: number, h: Heap, share = new Array<number>(KINDS).fill(1)) {
    const coins = Math.round(h.coins * share[0]);
    const R = Math.sqrt(coins) * 0.36 + 1.5, H = Math.sqrt(coins) * 0.3 + 1.5;
    const drop = (kind: number) => {
      const z = 1 + Math.random() * H;
      const rr = R * (1 - z / (H + 2)) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      spawn(kind, h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, z, 0, 0, 0, area);
    };
    for (let k = 0; k < coins; k++) drop(0);
    for (const [kind, n] of h.gems) for (let k = 0, m = Math.round(n * share[kind]); k < m; k++) drop(kind);
  }

  // ---- the room being cleared, and the one after ----

  const stocks = AREAS.map((_, a) => roomStock(a));
  /** What is still in the cave from a room, in coins. */
  const lying = (a: number) => left[a].reduce((sum, n, k) => sum + n * KIND_VALUE[k], 0);
  /** How much of a room is banked, 0 to 1. */
  const banked = (a: number) => Math.max(0, Math.min(1, 1 - lying(a) / stocks[a].value));
  /** "the South Gallery", "the Hollow". */
  const the = (a: number) => `the ${AREAS[a].name.replace(/^The /, '')}`;
  /** A hidden chamber's loot, as a heap in the middle of it. */
  const lootHeap = (k: number): Heap => { const [x, y] = chamberCentre(k); return { x, y, ...SECRETS[k].loot }; };
  /** A side room's or a pen's loot, likewise. */
  const stashHeap = (k: number): Heap => { const [x, y] = stashCentre(k); return { x, y, ...STASHES[k].loot }; };
  /** What was set in a wall now down, put back by where the wall stood. */
  const treasureHeap = (w: number): Heap => {
    const [x0, y0, x1, y1] = WALLS[w].tiles, [x, y] = tileCentre((x0 + x1) / 2, (y0 + y1) / 2);
    return { x, y, coins: 0, gems: WALLS[w].treasure };
  };
  /** A bonus heap put back from what was saved as left of it: all of it if nothing was. */
  function spawnSaved(from: number, heap: Heap) {
    const had = hadOf(from);
    const stock = new Array<number>(KINDS).fill(0);
    stock[0] = heap.coins;
    for (const [kind, n] of heap.gems) stock[kind] += n;
    spawnHeap(from, heap, stock.map((n, kind) => (had && n ? Math.min(1, had[kind] / n) : 1)));
  }
  /** What was saved as left of a source, or null if nothing was; a save from before the gold bars has one kind fewer. */
  const hadOf = (a: number) => (saved[a]?.length >= 5 ? Array.from({ length: KINDS }, (_, k) => saved[a][k] ?? 0) : null);
  // The rooms not sealed are put back, as much of each as was left, the heaps smaller where they started.
  // A room with nothing saved is put back whole, unless the cave is done and the last room was emptied long ago.
  // So are the hidden chambers broken into off them, and their side rooms, from what was left of each.
  {
    const next = economy.next();
    const inPlay = [economy.current(), ...(next !== null && economy.nextOpen() ? [next] : [])];
    for (const a of inPlay) {
      const had = hadOf(a);
      if (!had && economy.save.done) continue;
      const share = stocks[a].kinds.map((n, k) => (had && n ? Math.min(1, had[k] / n) : 1));
      AREAS[a].heaps.forEach((h) => spawnHeap(a, h, share));
    }
    SECRETS.forEach((secret, k) => {
      if (economy.save.secrets[k] && !economy.sealed(secret.area)) spawnSaved(chamberSource(k), lootHeap(k));
    });
    STASHES.forEach((stash, k) => {
      if (inPlay.includes(stash.area)) spawnSaved(stashSource(k), stashHeap(k));
    });
    WALLS.forEach((wall, w) => {
      if (economy.save.walls[w] && wall.treasure.length && inPlay.includes(wall.area) && hadOf(wallSource(w))) spawnSaved(wallSource(w), treasureHeap(w));
    });
  }
  // the bricks off walls knocked down, where they lay
  for (let k = 0; k + 3 < economy.save.rubble.length; k += 4) {
    const [x, y, z, grade] = economy.save.rubble.slice(k, k + 4);
    if (kinds[BRICK_KIND] >= GEM_CAPACITY[BRICK_KIND]) break;
    const i = world.spawn(BRICK_KIND, x, y, z);
    if (i < 0) break;
    origin[i] = NO_SOURCE; brickGrade[i] = grade; kinds[BRICK_KIND]++;
  }
  // a moment of settling before anyone sees it, so the heaps are heaps
  for (let i = 0; i < 90; i++) world.step(1 / 60, () => {});
  economy.persist();

  function showProgress() {
    const room = economy.current();
    const text = economy.save.done ? 'the cave is cleared'
      : `${AREAS[room].name}: ${Math.floor(banked(room) * 100)}% banked`
        + (economy.nextOpen() ? ` · on to ${the(economy.next()!)}`
          : ` · ${Math.round(CLEAR_SHARE * 100)}% ${economy.next() === null ? 'clears the cave' : 'opens the next'}`);
    progressText.textContent = shopProgress.textContent = text;
  }

  let veinTimer = Math.random();
  /** The last room's vein, once there is nothing else left: a coin now and then, and a gem now and then. */
  function trickle(dt: number) {
    if (!economy.save.done || world.live > BODY_CAPACITY - 60) return;
    const v: Vein = AREAS[LAST].vein;
    veinTimer -= dt;
    if (veinTimer > 0) return;
    veinTimer = v.every * (0.7 + Math.random() * 0.6);
    let kind = 0;
    const roll = Math.random();
    let acc = 0;
    for (const [k, p] of v.gems) { acc += p; if (roll < acc) { kind = k; break; } }
    const a2 = Math.random() * Math.PI * 2;
    spawn(kind, v.x + Math.cos(a2) * 0.6, v.y + Math.sin(a2) * 0.6, 6.5, Math.cos(a2) * 3, Math.sin(a2) * 3, 1, LAST);
  }

  // ---- the bank, and the run ----

  /** A run: everything that has gone in without a pause longer than a moment. */
  let holePulse = 0;
  let runValue = 0, runCount = 0, runTimer = 0;
  const gained = new Array<number>(KINDS).fill(0);
  /** How fast value is arriving, in coins a second, smoothed: what the cascade scales by. */
  let flow = 0;
  function collect(kind: number, x: number, y: number, i: number) {
    kinds[kind]--;
    // a brick down the hole is only gone
    if (kind === BRICK_KIND) return;
    left[origin[i]][kind]--;
    const value = KIND_VALUE[kind];
    economy.deposit(value);
    gained[kind]++;
    runValue += value; runCount++; runTimer = 1.3;
    flow += 1;
    const heat = Math.min(1, flow / 25);
    holePulse = Math.min(3, holePulse + 0.2 + heat * 0.5 + (kind > 0 ? 0.7 : 0));
    if (kind > 0) sound.thunk(value); else sound.clink(runCount);
    const gold: [number, number, number] = kind === 0 ? [1.6, 1.2, 0.4] : (dynamic[groupOf(kind)].albedo as [number, number, number]).map((c) => c * 2) as [number, number, number];
    renderer.emit({
      position: [x, y, 0.5], velocity: [0, 0, 12 + heat * 10], spread: 6 + heat * 6, count: (kind > 0 ? 40 : 8) + Math.round(heat * 30),
      life: 0.9 + heat * 0.5, lifeSpread: 0.4, size: (kind > 0 ? 0.45 : 0.3) + heat * 0.15, growth: -0.2, colour: gold, alpha: 0, gravity: 0.8, floor: -30,
    });
  }
  function showRun() {
    const parts: string[] = [];
    for (let k = 0; k < KINDS; k++) {
      if (!gained[k]) continue;
      parts.push(`${gained[k]} ${KIND_NAME[k]}${gained[k] > 1 ? 's' : ''}`);
    }
    toast.innerHTML = `+${runValue}<small>${parts.join(' · ')}</small>`;
    toast.hidden = !runCount;
    // the tally grows with the run, up to a shout
    toast.style.fontSize = `${Math.min(64, 18 + Math.sqrt(runValue) * 2.4)}px`;
    toast.classList.toggle('gone', runTimer <= 0);
  }

  // ---- the shop ----

  let shopOpen = false;
  // Two clicks, not a dialog: an embedded page may have its dialogs
  // suppressed, and a confirm that returns false without ever being seen
  // is a button that does nothing.
  const resetButton = document.getElementById('reset') as HTMLButtonElement;
  let resetArmed: number | null = null;
  resetButton.addEventListener('click', () => {
    if (resetArmed !== null) { economy.reset(); return; }
    resetButton.textContent = 'really? click again to lose everything';
    resetButton.classList.add('armed');
    resetArmed = window.setTimeout(() => {
      resetArmed = null;
      resetButton.textContent = 'start over';
      resetButton.classList.remove('armed');
    }, 4000);
  });
  /**
   * A hidden chamber broken into: the stone in front of it bursts into chips
   * that fly on the way the dozer was going, a cloud of dust hangs where it
   * was, and the chamber is floor, with its loot in it.
   */
  function smashOpen(k: number) {
    const faces: [number, number][] = [];
    for (let i = 0; i < cave.cells.length; i++) {
      if (cave.cells[i] !== SECRET + k) continue;
      const tx = i % COLS, ty = (i / COLS) | 0, [w0x, w0y, w1x, w1y] = SECRETS[k].wall;
      if (tx >= w0x && tx <= w1x && ty >= w0y && ty <= w1y) faces.push(tileCentre(tx, ty));
    }
    const c = Math.cos(dozer.yaw), sn = Math.sin(dozer.yaw);
    for (const [x, y] of faces) {
      renderer.emit({ position: [x, y, 2], velocity: [c * 14, sn * 14, 9], spread: 12, count: 70, life: 1.3, lifeSpread: 0.5, size: 0.45, growth: -0.2, colour: [0.32, 0.33, 0.4], alpha: 1, gravity: 1.6, floor: 0 });
      renderer.emit({ position: [x, y, 1.5], velocity: [c * 3, sn * 3, 4], spread: 7, count: 50, life: 2.2, lifeSpread: 0.6, size: 1.4, growth: 1.8, colour: [0.42, 0.4, 0.46], alpha: 0.7, gravity: 0.1, floor: 0 });
    }
    sound.smash();
    spawnHeap(chamberSource(k), lootHeap(k));
    economy.persist();
    reshape();
    note('a hidden chamber', 3);
  }

  /**
   * A brick wall knocked down: every brick in it comes loose, those in the
   * middle of the hit hardest and the top courses furthest, on the way the
   * dozer was driving, and tumbles; dust where the wall stood. The bricks stay
   * where they land, and in the save, until they are pushed down the hole.
   */
  function knockOver(w: number) {
    const grade = WALLS[w].grade;
    const c = Math.cos(dozer.yaw), sn = Math.sin(dozer.yaw);
    const gold = new Map(treasureBricks(w).map((t) => [t.brick, t.kind]));
    layBricks(w).forEach((b, n) => {
      const near = Math.max(0, 1 - Math.hypot(b.x - dozer.x, b.y - dozer.y) / 16);
      const push = 3 + near * 9 + (b.z / (COURSES * BRICK_SIZE[2])) * 4;
      // loose, each course a ball's height above the one below, or the balls would start in each other and burst
      const course = Math.round(b.z / BRICK_SIZE[2] - 0.5);
      const z = KIND_RADIUS[BRICK_KIND] + 0.05 + course * (KIND_RADIUS[BRICK_KIND] * 2 + 0.05);
      const vx = c * push + (Math.random() - 0.5) * 3, vy = sn * push + (Math.random() - 0.5) * 3, vz = 2 + Math.random() * 5;
      // what was set in the brick comes loose with it: a gold brick is a gold bar, a gem sat in the top of it
      const kind = gold.get(n);
      if (kind !== undefined) spawn(kind, b.x, b.y, z + (kind === BAR ? 0 : 1.2), vx, vy, vz + 1, wallSource(w));
      if (kind === BAR) return;
      const i = world.spawn(BRICK_KIND, b.x, b.y, z, vx, vy, vz);
      if (i < 0) return;
      origin[i] = NO_SOURCE; brickGrade[i] = grade; kinds[BRICK_KIND]++;
      world.wx[i] = (Math.random() - 0.5) * 10; world.wy[i] = (Math.random() - 0.5) * 10; world.wz[i] = (Math.random() - 0.5) * 6;
    });
    for (const [x, y] of wallTiles(w)) {
      renderer.emit({ position: [x, y, 2], velocity: [c * 4, sn * 4, 3], spread: 8, count: 60, life: 2.4, lifeSpread: 0.7, size: 1.5, growth: 1.8, colour: WALL_COLOUR[grade].slice(0, 3).map((v) => v * 0.6 + 0.2) as [number, number, number], alpha: 0.6, gravity: 0.1, floor: 0 });
    }
    sound.smash();
    recordRubble();
    economy.persist();
    reshape();
    const behind = STASHES.find((st) => st.area === WALLS[w].area && Math.hypot(...(() => { const [x0, y0, x1, y1] = WALLS[w].tiles; return [(x0 + x1) / 2 - st.at[0], (y0 + y1) / 2 - st.at[1]]; })()) < 12);
    note(`${WALL_NAME[grade]} wall down${WALLS[w].treasure.length ? ' · something glints in the rubble' : behind ? ` · ${behind.name}` : ''}`, 3);
  }

  /** A brick wall's tiles, as world centres. */
  function wallTiles(w: number): [number, number][] {
    const [x0, y0, x1, y1] = WALLS[w].tiles, out: [number, number][] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(tileCentre(x, y));
    return out;
  }

  /** Where every brick lies, into the save, which goes out with the next coin banked or when the page is put away. */
  function recordRubble() {
    const out: number[] = [];
    for (let i = 0; i < world.count; i++) {
      if (!world.alive[i] || world.kind[i] !== BRICK_KIND) continue;
      out.push(+world.x[i].toFixed(2), +world.y[i].toFixed(2), +world.z[i].toFixed(2), brickGrade[i]);
    }
    economy.save.rubble = out;
  }
  let rubbleAt = 0;
  addEventListener('pagehide', () => { recordRubble(); economy.persist(); });
  addEventListener('visibilitychange', () => { if (document.hidden) { recordRubble(); economy.persist(); } });

  /** The rock, at a gate: coming down when a room opens, going up when one is sealed. */
  function rockCloud(area: number) {
    for (const [x, y] of gateTiles(cave, area)) {
      renderer.emit({ position: [x, y, 1.5], velocity: [0, 0, 5], spread: 6, count: 60, life: 1.6, lifeSpread: 0.5, size: 1.2, growth: 1.5, colour: [0.45, 0.4, 0.5], alpha: 0.8, gravity: 0.15, floor: 0 });
    }
  }
  function reshape() {
    world.solid = cave.solid(economy.save.areas, economy.save.secrets, economy.save.walls);
    dozer.solid = world.solid;
    for (const b of bots) { b.dozer.solid = world.solid; b.reset(); }
    nav.rebuild(world.solid);
    world.belts = running().map((a) => beltOf(AREAS[a].belt!.spec));
    nav.setBelts(world.belts);
    buildStatic();
  }
  economy.onChange((id) => {
    sound.chime();
    if (id.startsWith('area')) {
      const a = +id.slice(4);
      note(`${the(a)} is open: ${AREAS[a].blurb} · go on in when you are done here`, 5);
      AREAS[a].heaps.forEach((h) => spawnHeap(a, h));
      // and what is in its side rooms, to be seen over their walls
      STASHES.forEach((stash, k) => { if (stash.area === a) spawnHeap(stashSource(k), stashHeap(k)); });
      // the heaps are in the save now, or a reload before the next coin would find the room empty
      economy.persist();
      reshape();
      rockCloud(a);
    } else if (id.startsWith('sealed')) {
      const old = +id.slice(6);
      // what is left of the room behind goes, wherever it has got to, with a puff where each was
      const lost = lying(old);
      let puffs = 0;
      // and what is left in any hidden chamber or side room off it: bars not got out before going on are lost with the room
      const goes = (from: number) => from !== NO_SOURCE && areaOfSource(from) === old;
      for (let i = 0; i < world.count; i++) {
        if (!world.alive[i] || !goes(origin[i])) continue;
        if (puffs++ < 160) renderer.emit({ position: [world.x[i], world.y[i], world.z[i] + 0.3], velocity: [0, 0, 2], spread: 1.5, count: 3, life: 0.8, lifeSpread: 0.3, size: 0.5, growth: 0.8, colour: [0.5, 0.45, 0.4], alpha: 0.6, gravity: 0.1, floor: 0 });
        kinds[world.kind[i]]--; left[origin[i]][world.kind[i]]--;
        world.remove(i);
      }
      // no machine is shut in with the rock, or in it
      bots.forEach((b, j) => {
        if (!behindGate(old, b.x, b.y)) return;
        b.dozer.x = HOLE.x + 14 + j * 6; b.dozer.y = HOLE.y + 10; b.dozer.speed = 0;
      });
      economy.persist();
      reshape();
      if (old !== ORDER[0]) rockCloud(old);
      const gone = lost > 0 ? ` · ${lost} left behind` : '';
      note(old === ORDER[0] ? `on into ${the(economy.current())}${gone}` : `${the(old)} is sealed behind you${gone}`, 4);
    } else if (id.startsWith('secret')) {
      const k = +id.slice(6);
      smashOpen(k);
    } else if (id.startsWith('wall')) {
      knockOver(+id.slice(4));
    } else if (id === 'done') {
      note(`the cave is cleared · ${the(LAST)}'s vein runs on`, 6);
      fountains.push(new Fountain(AREAS[LAST]));
    } else if (id.startsWith('belt')) {
      world.belts = running().map((a) => beltOf(AREAS[a].belt!.spec));
      nav.setBelts(world.belts);
      buildStatic();
    } else if (id === 'drone') {
      bots.push(new Bot(world.solid, bots.length + 1, HOLE.x + 14, HOLE.y + 10));
    } else if (id === 'blade') {
      dynamic[BLADE].mesh = bladeMesh(economy.spec().bladeWidth);
      renderer.setDynamic(dynamic);
    } else if (id.startsWith('paint:')) {
      const p = economy.paint();
      renderer.tint(HULL, new Float32Array([...p.colour, p.roughness]));
      renderer.tint(FLAG, new Float32Array([...flagColour(), 0.6]));
    }
    world.wakeAll();
  });

  // ---- the rock that breaks ----

  // Square on and fast, it smashes; any other knock on it sounds hollow, which is all that gives it away.
  // A brick wall driven square into takes a beating by the engine and the speed, and says how much
  // it has taken; one hit to each run at it, however long the blade is up against it after.
  const knockedAt = SECRETS.map(() => -Infinity);
  const hitAt = WALLS.map(() => -Infinity);
  dozer.onRock = (tx, ty, square) => {
    const cell = cave.cells[ty * COLS + tx];
    const speed = Math.abs(dozer.speed), hard = square >= SMASH_SQUARE && speed >= SMASH_SPEED;
    if (cell >= BRICK) {
      const w = cell - BRICK, wall = WALLS[w];
      if (economy.save.walls[w] || square < SMASH_SQUARE || t - hitAt[w] < 0.5) return;
      const damage = economy.ram(speed);
      if (!damage) return;
      hitAt[w] = t;
      const [x, y] = tileCentre(tx, ty);
      const gone = economy.hitWall(w, damage);
      if (gone >= 1) return;
      sound.clunk();
      if (gone > 0.5) sound.crack();
      renderer.emit({ position: [x, y, 2], velocity: [-Math.cos(dozer.yaw) * 4, -Math.sin(dozer.yaw) * 4, 4], spread: 5, count: Math.round(12 + gone * 30), life: 1, lifeSpread: 0.3, size: 0.35, growth: -0.2, colour: WALL_COLOUR[wall.grade].slice(0, 3) as [number, number, number], alpha: 1, gravity: 1.4, floor: 0 });
      renderer.emit({ position: [x, y, 1.5], velocity: [0, 0, 2], spread: 4, count: 20, life: 1.2, lifeSpread: 0.3, size: 0.8, growth: 1, colour: [0.5, 0.45, 0.42], alpha: 0.5, gravity: 0.2, floor: 0 });
      const more = Math.ceil((WALL_STRENGTH[wall.grade] - economy.save.wallDamage[w]) / damage);
      note(`${WALL_NAME[wall.grade]} wall · ${Math.round(gone * 100)}% · ${more === 1 ? 'one more like that' : `about ${more} more like that`}`, 2.5);
      buildStatic();
      return;
    }
    if (cell < SECRET || economy.save.secrets[cell - SECRET]) return;
    const k = cell - SECRET;
    if (hard) economy.reveal(k);
    else if (square > 0.2 && speed > 1.5 && t - knockedAt[k] > 0.6) { knockedAt[k] = t; sound.knock(); }
  };

  // ---- the camera ----

  const cam = renderer.camera;
  cam.target = [dozer.x, dozer.y, 0];
  cam.position = [dozer.x, dozer.y - CAMERA.radius * Math.sin(CAMERA.polar), CAMERA.radius * Math.cos(CAMERA.polar)];
  // On a phone a finger on the screen is a finger on a slider or the shop, and a stray
  // touch on the cave must not swing the camera: the canvas takes no pointers at all.
  // The orbit stays enabled, because enabled is also what moves the camera after the dozer.
  const touch = isTouchDevice();
  if (touch) {
    document.body.classList.add('touch');
    canvas.style.pointerEvents = 'none';
  }
  const orbit = new Orbit(cam, {
    element: canvas, minPolar: 0.1, maxPolar: 1.25, minDistance: 28, maxDistance: 170,
    rotateSpeed: 0.4, zoomSpeed: 0.8, panSpeed: 0, inertia: 0.5,
  });
  orbit.setSpherical(CAMERA);
  /**
   * Three ways to hold the camera, cycled with V:
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
  type CameraMode = 'fixed' | 'chase' | 'free';
  const MODES: CameraMode[] = ['fixed', 'chase', 'free'];
  let cameraMode: CameraMode = 'fixed';
  try { const m = localStorage.getItem('pushminer-camera'); if (MODES.includes(m as CameraMode)) cameraMode = m as CameraMode; } catch { /* fine */ }
  /** Where the camera is aimed: the dozer plus a lead along its velocity, held within a window. */
  const aim: [number, number] = [dozer.x, dozer.y];
  const follow: [number, number] = [dozer.x, dozer.y];
  const lead: [number, number] = [0, 0];
  const WINDOW = 4.5;
  let chase = CAMERA.azimuth;
  let manualUntil = 0;
  canvas.addEventListener('pointerdown', () => { manualUntil = performance.now() / 1000 + 5; });
  const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  function cycleCamera() {
    // a phone's canvas takes no drag, so a free camera there would be a stuck one
    const modes = touch ? MODES.filter((m) => m !== 'free') : MODES;
    cameraMode = modes[(modes.indexOf(cameraMode) + 1) % modes.length];
    try { localStorage.setItem('pushminer-camera', cameraMode); } catch { /* fine */ }
    manualUntil = 0;
    if (cameraMode === 'fixed') orbit.setSpherical({ azimuth: orbit.currentAzimuth + wrap(CAMERA.azimuth - orbit.currentAzimuth) });
    note(`camera: ${cameraMode}`);
  }
  /** A word at the top of the screen for a couple of seconds: what a button just changed. */
  function note(text: string, seconds = 2) {
    cameraNote.textContent = text;
    cameraNote.hidden = false;
    cameraNoteIn = seconds;
  }
  const cameraNote = document.getElementById('cameraNote')!;
  let cameraNoteIn = 0;
  /** The player is at the next room's gate, and going further seals the one being cleared. */
  let warning = false;

  let width = 1, height = 1;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    canvas.width = width; canvas.height = height;
    renderer.resize(width, height);
  };
  addEventListener('resize', resize);
  resize();

  // ---- lights and glows ----

  const lights = new LightPool(LIGHT_CAPACITY);
  const quads = new Float32Array(EFFECT_CAPACITY * EFFECT_STRIDE);
  const pushers: Pusher[] = [];

  function lightUp(t: number): number[] {
    lights.clear();
    const c = Math.cos(dozer.yaw), s = Math.sin(dozer.yaw);
    const shadowed: number[] = [];
    for (const side of [1, -1]) {
      const i = lights.add({
        position: [dozer.x + c * 2.6 - s * side * 0.9, dozer.y + s * 2.6 + c * side * 0.9, 3.0],
        radius: 64, colour: [1.0, 0.92, 0.7], intensity: 16,
        direction: [c, s, -0.2], cone: [20, 36],
      });
      if (side === 1) shadowed.push(i);
    }
    // a small light over the cab, so the machine can be seen in the dark: it lights the dozer, not the floor
    lights.add({ position: [dozer.x - c * 0.8, dozer.y - s * 0.8, 6.5], radius: 7, colour: [1.0, 0.9, 0.75], intensity: 1.2 });
    // The lamps still standing in the rooms in play whose light can reach the screen: the floor under
    // one is in view, or off the edge by less than its light carries. The nearest the eye first, as
    // many as fit.
    const [ex, ey] = cam.target, lens = 1 / Math.tan((cam.fov * Math.PI) / 360);
    lampsLit.length = 0;
    cave.lamps.forEach((l, k) => {
      if (!lampOn(k)) return;
      const q = project(cam.viewProjection, l.x, l.y, 0);
      // how much of the screen its light's reach is at that depth: up, by the lens, and across, by that over the frame's shape
      const up = q ? (LAMP_REACH * lens * 1.1) / q[2] : 0, across = up / cam.aspect;
      if (q ? Math.abs(q[0]) < 1 + across && Math.abs(q[1]) < 1 + up : Math.hypot(l.x - ex, l.y - ey) < LAMP_REACH) lampsLit.push(k);
    });
    lampsLit.sort((a, b) => Math.hypot(cave.lamps[a].x - ex, cave.lamps[a].y - ey) - Math.hypot(cave.lamps[b].x - ex, cave.lamps[b].y - ey));
    for (const k of lampsLit.slice(0, LAMP_LIGHTS)) {
      const l = cave.lamps[k];
      const flicker = 0.92 + 0.08 * Math.sin(t * 13 + k * 7) * Math.sin(t * 3.1 + k);
      // bright, and far-reaching enough that between them nowhere on the floor is dark
      lights.add({ position: [l.x, l.y, l.height], radius: LAMP_REACH, colour: [1.0, 0.8, 0.55], intensity: LAMP_BRIGHT * flicker });
    }
    // The lamps hanging over the hole, green-white: they light the hole, its rim and what goes down
    // it from above, so it can be found in the dark, and there is nothing on the floor to drive
    // through. Only while the hole is near enough the screen for their light to show.
    const hole = project(cam.viewProjection, HOLE.x, HOLE.y, 0);
    if (hole && Math.abs(hole[0]) < 1.5 && Math.abs(hole[1]) < 1.5) {
      for (const [x, y] of HOLE_LAMPS) lights.add({ position: [x, y, HOLE_LAMP_HEIGHT - 0.6], radius: 36, colour: [0.7, 1.0, 0.6], intensity: 14 });
    }
    if (economy.save.done) {
      const v = AREAS[LAST].vein;
      lights.add({ position: [v.x, v.y, 5.5], radius: 12, colour: [1.0, 0.7, 0.3], intensity: 1.6 + 0.4 * Math.sin(t * 7) });
    }
    for (const b of bots) {
      const bc = Math.cos(b.yaw), bs = Math.sin(b.yaw);
      lights.add({ position: [b.x + bc * 1.8, b.y + bs * 1.8, 2.2], radius: 44, colour: [1.0, 0.92, 0.7], intensity: 10, direction: [bc, bs, -0.24], cone: [20, 36] });
      // the beacon, turning
      const beat = 0.5 + 0.5 * Math.sin(t * 6 + b.x);
      lights.add({ position: [b.x - bc * 1.0, b.y - bs * 1.0, 3.2], radius: 9, colour: [1.0, 0.45, 0.1], intensity: 1 + 2 * beat });
    }
    for (const f of fountains) {
      if (f.glow <= 0) continue;
      const flicker = f.state === 'warn' ? 0.7 + 0.3 * Math.sin(t * 30) : 1;
      lights.add({ position: [f.x, f.y, 2], radius: 10 + f.glow * 14, colour: [1.0, 0.55, 0.2], intensity: f.glow * 5 * flicker });
    }
    if (warning) {
      // the line that seals the room behind, down the corridor ahead: a red light on it, pulsing
      const [sx, sy] = sealPoint(cave, economy.next()!);
      lights.add({ position: [sx, sy, 3], radius: 20, colour: [1.0, 0.25, 0.1], intensity: 3 + 2.5 * Math.sin(t * 8) });
    }
    const m = world.magnet;
    if (m) lights.add({ position: [m.x, m.y, 1.2], radius: m.radius * 0.8, colour: [0.45, 0.7, 1.0], intensity: 0.6 + m.strength * 0.03 });
    renderer.setLights(lights, shadowed);

    // the glows, as screen-space layers: the hole, each cracking floor, the magnet's reach
    let n = 0;
    const p = holePulse > 0.02 ? project(cam.viewProjection, HOLE.x, HOLE.y, 0) : null;
    if (p) {
      // the hole is dark like the rest, and flares only as something goes down it
      const size = (HOLE.radius * 2.2 / p[2]) * (1 + holePulse * 0.5);
      quads.set([p[0], p[1], size * 0.9, holePulse * 0.9, 0.5, 1.0, 0.35, 1.8], n * EFFECT_STRIDE); n++;
    }
    for (const f of fountains) {
      if (f.glow <= 0) continue;
      const q = project(cam.viewProjection, f.x, f.y, 0.2);
      if (!q || n >= EFFECT_CAPACITY) continue;
      quads.set([q[0], q[1], (6 / q[2]) * (0.6 + f.glow * 0.6), f.glow * (f.state === 'warn' ? 0.5 + 0.3 * Math.sin(t * 30) : 1.2), 1.0, 0.5, 0.15, 2.2], n * EFFECT_STRIDE); n++;
    }
    if (warning && n < EFFECT_CAPACITY) {
      const [sx, sy] = sealPoint(cave, economy.next()!);
      const q = project(cam.viewProjection, sx, sy, 0.2);
      if (q) { quads.set([q[0], q[1], 14 / q[2], 0.5 + 0.3 * Math.sin(t * 8), 1.0, 0.25, 0.1, 1.6], n * EFFECT_STRIDE); n++; }
    }
    // each lamp lit near the eye, a glow round its head: the light is in the glass, not on it
    for (const k of lampsLit) {
      if (n >= EFFECT_CAPACITY - 1) break;
      const l = cave.lamps[k];
      const q = project(cam.viewProjection, l.x, l.y, l.height);
      if (!q || Math.abs(q[0]) > 1.2 || Math.abs(q[1]) > 1.2) continue;
      quads.set([q[0], q[1], 5 / q[2], 0.85 + 0.1 * Math.sin(t * 13 + k * 7), 1.0, 0.75, 0.4, 2.0], n * EFFECT_STRIDE); n++;
    }
    for (const [x, y] of HOLE_LAMPS) {
      if (n >= EFFECT_CAPACITY - 1) break;
      const q = project(cam.viewProjection, x, y, HOLE_LAMP_HEIGHT - 0.6);
      if (!q || Math.abs(q[0]) > 1.2 || Math.abs(q[1]) > 1.2) continue;
      quads.set([q[0], q[1], 5 / q[2], 0.9, 0.7, 1.0, 0.6, 2.0], n * EFFECT_STRIDE); n++;
    }
    if (m && n < EFFECT_CAPACITY) {
      const q = project(cam.viewProjection, m.x, m.y, 0.2);
      if (q) { quads.set([q[0], q[1], (m.radius * 1.1) / q[2], 0.08 + m.strength * 0.004 + 0.03 * Math.sin(t * 5), 0.45, 0.7, 1.0, 1.0], n * EFFECT_STRIDE); n++; }
    }
    renderer.setEffects(quads, n);
    return shadowed;
  }

  // ---- per-frame uploads ----

  let awake = 0;
  function upload(t: number) {
    const counts = new Array<number>(KINDS).fill(0);
    const rubble = [0, 0, 0];
    awake = 0;
    const { x, y, z, q, kind, alive, asleep } = world;
    for (let i = 0; i < world.count; i++) {
      if (!alive[i]) continue;
      if (!asleep[i]) awake++;
      const k = kind[i];
      if (k === BRICK_KIND) {
        const g = brickGrade[i] - 1;
        if (rubble[g] * 16 < rubbleM[g].length) placeQuat(rubbleM[g], rubble[g]++, x[i], y[i], z[i], q, i * 4);
        continue;
      }
      const m = k === 0 ? coinM : gemM[k];
      if (counts[k] * 16 >= m.length) continue;
      placeQuat(m, counts[k]++, x[i], y[i], z[i], q, i * 4);
    }
    renderer.move(COINS, coinM, counts[0]);
    for (let k = 1; k <= 4; k++) renderer.move(GEMS + k - 1, gemM[k], counts[k]);
    renderer.move(BARS, gemM[BAR], counts[BAR]);
    for (let g = 0; g < 3; g++) renderer.move(RUBBLE + g, rubbleM[g], rubble[g]);

    place(hullM, 0, dozer.x, dozer.y, 0, dozer.yaw);
    place(darkM, 0, dozer.x, dozer.y, 0, dozer.yaw);
    place(bladeM, 0, dozer.x, dozer.y, 0, dozer.yaw);
    renderer.move(HULL, hullM); renderer.move(DARK, darkM); renderer.move(BLADE, bladeM);
    const pitch = 6.4 / TREAD_BARS;
    for (let i = 0; i < TREAD_BARS; i++) {
      const along = (run: number) => ((((i * pitch + run) % 6.4) + 6.4) % 6.4) - 3.2;
      placePart(treadM, i * 2, dozer.x, dozer.y, 0, dozer.yaw, along(dozer.trackLeft), TRACK_GAUGE, 1.9);
      placePart(treadM, i * 2 + 1, dozer.x, dozer.y, 0, dozer.yaw, along(dozer.trackRight), -TRACK_GAUGE, 1.9);
    }
    // the robo-dozers' bars, after the player's: the same bars at their scale, each
    // track's run measured in the player's lengths so a bar laps a smaller track as often
    bots.forEach((b, j) => {
      const k = BOT_SCALE, d = b.dozer;
      for (let i = 0; i < TREAD_BARS; i++) {
        const along = (run: number) => (((((i * pitch + run / k) % 6.4) + 6.4) % 6.4) - 3.2) * k;
        const o = (1 + j) * TREAD_BARS * 2 + i * 2;
        placePart(treadM, o, d.x, d.y, 0, d.yaw, along(d.trackLeft), TRACK_GAUGE * k, 1.9 * k, 0, 0, k, k, k);
        placePart(treadM, o + 1, d.x, d.y, 0, d.yaw, along(d.trackRight), -TRACK_GAUGE * k, 1.9 * k, 0, 0, k, k, k);
      }
    });
    renderer.move(TREADS, treadM, (1 + bots.length) * TREAD_BARS * 2);

    bots.forEach((b, i) => {
      placePart(botHullM, i, b.x, b.y, 0, b.yaw, 0, 0, 0, 0, 0, BOT_SCALE, BOT_SCALE, BOT_SCALE);
      placePart(botDarkM, i, b.x, b.y, 0, b.yaw, 0, 0, 0, 0, 0, BOT_SCALE, BOT_SCALE, BOT_SCALE);
      placePart(botBladeM, i, b.x, b.y, 0, b.yaw, 0, 0, 0, 0, 0, BOT_SCALE, BOT_SCALE, BOT_SCALE);
    });
    renderer.move(BOT_HULL, botHullM, bots.length);
    renderer.move(BOT_DARK, botDarkM, bots.length);
    renderer.move(BOT_BLADE, botBladeM, bots.length);

    let n = 0;
    for (const a of running()) {
      const s = AREAS[a].belt!.spec;
      const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0), yaw = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;
      const gap = 2.6, bars = Math.floor(len / gap);
      for (let i = 0; i < bars && n < STRIPE_CAPACITY; i++) {
        const along = (((i * gap + t * s.speed) % len) + len) % len - len / 2;
        placePart(stripeM, n++, cx, cy, 0.35, yaw, along, 0, 0, 0, 0, 1, s.width * 0.9, 1);
      }
    }
    renderer.move(STRIPES, stripeM, n);

    // the pennant: a pole on the cab's roof, and slats that wave behind it
    if (economy.save.flag) {
      placePart(poleM, 0, dozer.x, dozer.y, 0, dozer.yaw, -2.2, -1.1, 3.6);
      const wind = 0.5 + Math.min(1, Math.abs(dozer.speed) / 10);
      for (let k = 0; k < FLAG_SLATS; k++) {
        const wave = Math.sin(t * 9 * wind - k * 1.1) * 0.12 * (k + 1);
        placePart(flagM, k, dozer.x, dozer.y, 0, dozer.yaw, -2.2 - 0.2 - k * 0.38, -1.1 + wave, 7.3 - k * 0.03, Math.cos(t * 9 * wind - k * 1.1) * 0.3, 0, 1, 1, 1 - k * 0.12);
      }
    }
    renderer.move(POLE, poleM, economy.save.flag ? 1 : 0);
    renderer.move(FLAG, flagM, economy.save.flag ? FLAG_SLATS : 0);
  }

  // ---- how much coin this machine can draw ----

  function setCoinDetail(level: number) {
    coinDetail = Math.max(0, Math.min(COIN_LADDER.length - 1, level));
    dynamic[COINS].mesh = coin(0.52, 0.26, coinDetail);
    renderer.setDynamic(dynamic);
  }

  /**
   * What a frame of the real scene costs, from placing the lights to the GPU
   * finishing. Not the time between frames, which the display holds to its
   * refresh, so a fast machine would look no faster than 60 Hz; and drawn to
   * a texture of our own rather than the canvas, so no wait to be shown is
   * counted. Scheduling only ever adds time, so the lower quartile is the
   * frame's own cost. Timed through the canvas with pauses between frames,
   * one rung's median wandered from 4 to 13 ms between runs; this way it
   * repeats to a tenth or two.
   */
  async function measureFrame(): Promise<number> {
    const target = ctx.device.createTexture({
      label: 'calibration target', size: [width, height], format: ctx.format, usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const view = target.createView();
    const times: number[] = [];
    for (let i = 0; i < CALIBRATE_WARMUP + CALIBRATE_SAMPLES; i++) {
      // yield, but not to an animation frame: a hidden tab gets none, and a GPU left
      // idle between samples drops to a slower power state than a game keeps it in
      await new Promise((r) => setTimeout(r, 0));
      const start = performance.now();
      lightUp(0);
      upload(0);
      const drew = renderer.frame(view, 'redraw', 1 / 60);
      await ctx.device.queue.onSubmittedWorkDone();
      if (drew && i >= CALIBRATE_WARMUP) times.push(performance.now() - start);
    }
    target.destroy();
    if (!times.length) return 0;
    times.sort((a, b) => a - b);
    return times[times.length >> 2];
  }

  /** Down the ladder until a frame fits the budget, or there is no rung left. */
  async function calibrate(): Promise<number[]> {
    const forced = new URLSearchParams(location.search).get('coins');
    if (forced !== null && Number.isFinite(+forced)) { setCoinDetail(+forced); return []; }
    bootMsg.textContent = 'measuring this machine…';
    await renderer.ready;
    const costs: number[] = [];
    for (let level = 0; level < COIN_LADDER.length; level++) {
      setCoinDetail(level);
      costs.push(await measureFrame());
      if (costs[level] <= RENDER_BUDGET_MS) break;
    }
    return costs;
  }
  const calibration = await calibrate();
  console.info(`coins: ${COIN_LADDER[coinDetail].name}`, calibration.length
    ? `(frame cost per rung, ms: ${calibration.map((ms) => ms.toFixed(1)).join(', ')}; budget ${RENDER_BUDGET_MS})`
    : '(chosen by ?coins=)');

  // ---- go ----

  boot.classList.add('gone');
  bankPanel.hidden = false; statsPanel.hidden = false; helpPanel.hidden = false;
  const shopButton = document.getElementById('shopButton') as HTMLButtonElement;
  const hornButton = document.getElementById('hornButton') as HTMLButtonElement;
  const muteButton = document.getElementById('muteButton') as HTMLButtonElement;
  /** The horn's button is there once the horn is bought, and the mute's says which way it is. */
  const showHorn = () => { hornButton.hidden = !(touch && economy.save.horn); };
  const showMute = () => { muteButton.textContent = sound.muted ? '🔇' : '🔊'; muteButton.setAttribute('aria-label', sound.muted ? 'unmute' : 'mute'); };
  economy.onChange((id) => { if (id === 'horn') showHorn(); });
  if (touch) {
    const controls = new TouchControls(document.getElementById('trackLeft')!, document.getElementById('trackRight')!, document.getElementById('steer')!);
    input.touch = controls;
    document.getElementById('tracks')!.hidden = false;
    const controlsButton = document.getElementById('controlsButton') as HTMLButtonElement;
    const showControls = () => { controlsButton.textContent = controls.scheme === 'tracks' ? '⇅⇅' : '⇅⇆'; };
    controlsButton.addEventListener('click', () => {
      const scheme = controls.cycle();
      showControls();
      note(scheme === 'tracks' ? 'controls: a lever each track' : 'controls: throttle and steering');
    });
    showControls();
    document.getElementById('cameraButton')!.addEventListener('click', () => input.pressCamera());
    document.getElementById('pad')!.hidden = false;
    shopButton.addEventListener('click', () => input.toggleShop());
    // pointerdown, not click: a horn sounds when it is pressed, and a click waits for the lift
    hornButton.addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressHorn(); });
    // straight to the sound, not through the input's once-a-frame flag: two taps inside
    // one frame would be one toggle there, and the button would say the wrong thing
    muteButton.addEventListener('click', () => { sound.toggleMute(); showMute(); });
    showMute();
    showHorn();
  }
  Object.assign(globalThis as Record<string, unknown>, { world, dozer, economy, cave, lampsLit, renderer, orbit, bots, fountains, sound, setCoinDetail, calibration });

  // ---- what the robo-dozers go for: the room being cleared ----

  // the room being cleared, and any chamber broken into off it
  const foreman = new Foreman(world, nav, bots, origin, (from) => from !== NO_SOURCE && areaOfSource(from) === economy.current());
  const choose = (bot: Bot) => foreman.choose(bot, t);

  // ---- the pointer ----

  /**
   * With the next room open, an arrow at the edge of the screen toward its
   * gate, or a marker over the gate once it is in view.
   */
  let target: { x: number; y: number; label: string } | null = null;
  let aimAt = 0;
  function aimPointer() {
    target = null;
    if (economy.save.done || !economy.nextOpen()) return;
    const next = economy.next()!;
    const [x, y] = gateCentre(cave, next);
    target = { x, y, label: AREAS[next].name };
  }
  /** The arrow along a direction on the screen, and its words behind it, on the side away from where it points. */
  function pointAlong(ux: number, uy: number) {
    pointerArrow.style.transform = `rotate(${Math.atan2(uy, ux)}rad)`;
    // far enough back that a long name clears the arrow whichever way it points
    const w = pointerLabel.offsetWidth / 2 + 24, h = pointerLabel.offsetHeight / 2 + 22;
    pointerLabel.style.transform = `translate(calc(-50% + ${-ux * w}px), calc(-50% + ${-uy * h}px))`;
  }
  function showPointer(t: number) {
    if (t >= aimAt) { aimAt = t + 0.4; aimPointer(); }
    if (!target) { pointer.hidden = true; return; }
    pointer.hidden = false;
    const W = innerWidth, H = innerHeight, vp = cam.viewProjection;
    const p = project(vp, target.x, target.y, 0.5);
    if (p && Math.abs(p[0]) < 0.9 && Math.abs(p[1]) < 0.9) {
      // in view: a marker over it, bobbing, pointing down
      const bob = Math.sin(t * 5) * 5;
      pointer.style.transform = `translate(${(p[0] + 1) * W / 2}px, ${(1 - p[1]) * H / 2 - 60 + bob}px)`;
      pointAlong(0, 1);
      pointerLabel.textContent = target.label;
      return;
    }
    // out of view: the way to it on the screen, from the middle out to the edge
    let dx: number, dy: number;
    if (p && p[2] > 0) { dx = p[0] * W / 2; dy = -p[1] * H / 2; }
    else {
      // behind the camera, where a projection says nothing: turn the way on the floor into the screen's
      const o = project(vp, dozer.x, dozer.y, 0), ex = project(vp, dozer.x + 1, dozer.y, 0), ey = project(vp, dozer.x, dozer.y + 1, 0);
      if (!o || !ex || !ey) { pointer.hidden = true; return; }
      const wx = target.x - dozer.x, wy = target.y - dozer.y;
      dx = (wx * (ex[0] - o[0]) + wy * (ey[0] - o[0])) * W / 2;
      dy = -(wx * (ex[1] - o[1]) + wy * (ey[1] - o[1])) * H / 2;
    }
    const len = Math.hypot(dx, dy) || 1;
    // kept clear of the counters along the top, the help or the buttons along the bottom, and a phone's sliders
    const left = touch ? 72 : 56, right = W - left, top = 84, bottom = H - (touch ? 150 : 110);
    const cx = W / 2, cy = H / 2;
    const kx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
    const ky = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
    const k = Math.max(0, Math.min(kx, ky));
    pointer.style.transform = `translate(${cx + dx * k}px, ${cy + dy * k}px)`;
    pointAlong(dx / len, dy / len);
    pointerLabel.textContent = target.label;
  }

  let last = performance.now();
  let t = 0;
  let smoothed = 16.7;
  let statsIn = 0, shopIn = 0;
  let lastBank = -1;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now; t += dt;

    if (input.takeShop()) { shopOpen = !shopOpen; shopPanel.hidden = !shopOpen; shopButton.textContent = shopOpen ? 'close' : 'shop'; if (shopOpen) { renderShop(shopRows, economy); renderShop(shopCosmetics, economy, economy.cosmetics()); } }
    if (input.takeHorn() && economy.save.horn) {
      sound.horn();
      // the coins jump: everything near enough hops, which is what a horn is for
      const { x, y, z, vz, alive, asleep } = world;
      for (let i = 0; i < world.count; i++) {
        if (!alive[i]) continue;
        const d = Math.hypot(x[i] - dozer.x, y[i] - dozer.y);
        if (d > 14 || z[i] > 3) continue;
        if (asleep[i]) world.wake(i);
        vz[i] += 5 * (1 - d / 14) + Math.random() * 2;
        world.wx[i] += (Math.random() - 0.5) * 6; world.wy[i] += (Math.random() - 0.5) * 6;
      }
    }
    if (input.takeRecentre()) {
      manualUntil = 0;
      orbit.setSpherical({ polar: CAMERA.polar, radius: CAMERA.radius });
      if (cameraMode !== 'chase') orbit.setSpherical({ azimuth: orbit.currentAzimuth + wrap(CAMERA.azimuth - orbit.currentAzimuth) });
    }
    if (input.takeCamera()) cycleCamera();
    if (input.takeMute()) { sound.toggleMute(); showMute(); }

    const spec = economy.spec();
    const drive = input.read();
    dozer.update(dt, drive, spec, world.load);
    knockLamps();
    for (const b of bots) b.update(dt, world, world.loads[b.dozer.owner] ?? 0, nav, choose, traffic);
    // no machine drives through another: every pair, twice, so a push out of one
    // that shoves into a third is settled in the same frame
    const machines = [dozer, ...bots.map((b) => b.dozer)];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < machines.length; i++) for (let j = i + 1; j < machines.length; j++) separate(machines[i], machines[j]);
    }
    dozer.pushers(spec, pushers);
    const botPushers: Pusher[] = [];
    for (const b of bots) {
      b.dozer.pushers(BOT_SPEC, botPushers);
      pushers.push(...botPushers);
      const bc = Math.cos(b.yaw), bs = Math.sin(b.yaw);
      if (Math.abs(b.dozer.speed) > 0.5) world.wakeNear(b.x + bc * BLADE_AT * BOT_SCALE, b.y + bs * BLADE_AT * BOT_SCALE, BOT_SPEC.bladeWidth * BOT_SCALE * 0.75 + 1.5);
    }
    world.pushers = pushers;
    // the heap ahead of the blade wakes before the blade arrives
    const c = Math.cos(dozer.yaw), s = Math.sin(dozer.yaw);
    if (Math.abs(dozer.speed) > 0.5 || Math.abs(dozer.yawRate) > 0.2) world.wakeNear(dozer.x + c * BLADE_AT, dozer.y + s * BLADE_AT, spec.bladeWidth * 0.75 + 1.5);
    // the magnet sits a little ahead of the blade's face, and reaches out from there
    const mx = dozer.x + c * (BLADE_AT + 1.2), my = dozer.y + s * (BLADE_AT + 1.2);
    world.magnet = { x: mx, y: my, radius: spec.magnetRadius, strength: spec.magnetStrength };
    world.wakeNear(mx, my, spec.magnetRadius);
    trickle(dt);
    let shaking = 0;
    for (const f of fountains) {
      f.update(dt, spawn, () => sound.crack());
      if (f.state === 'idle') continue;
      const near = Math.max(0, 1 - Math.hypot(f.x - follow[0], f.y - follow[1]) / 90);
      shaking = Math.max(shaking, f.glow * near * (f.state === 'spray' ? 1 : 0.5));
      // dust off the crack while it glows, and a plume while it sprays
      if (Math.random() < (f.state === 'spray' ? 0.9 : 0.35)) {
        renderer.emit({
          position: [f.x, f.y, 0.3], velocity: [0, 0, f.state === 'spray' ? 9 : 2], spread: 3, count: 4,
          life: 1.2, lifeSpread: 0.5, size: 0.8, growth: 1.2, colour: [0.6, 0.45, 0.3], alpha: 0.5, gravity: 0.05, floor: 0,
        });
      }
    }
    sound.shake(shaking);
    sound.drive(drive.throttle, dozer.speed, world.load);
    world.step(dt, collect);
    holePulse = Math.max(0, holePulse - dt * 1.8);
    flow = Math.max(0, flow - flow * Math.min(1, 2.5 * dt));

    // The lead: ahead along the velocity, further the faster, and eased so
    // a change of direction swings the view rather than snapping it.
    const leadLen = Math.min(11, Math.abs(dozer.speed) * 0.7);
    const wantLead: [number, number] = [c * Math.sign(dozer.speed) * leadLen, s * Math.sign(dozer.speed) * leadLen];
    const kl = Math.min(1, 2 * dt);
    lead[0] += (wantLead[0] - lead[0]) * kl; lead[1] += (wantLead[1] - lead[1]) * kl;
    // The window: the aim stays put until the led point leaves a box round
    // it, so shuffling about does not move the view; then it is dragged.
    const fx = dozer.x + lead[0], fy = dozer.y + lead[1];
    aim[0] = Math.max(fx - WINDOW, Math.min(fx + WINDOW, aim[0]));
    aim[1] = Math.max(fy - WINDOW, Math.min(fy + WINDOW, aim[1]));
    const k = Math.min(1, 3 * dt);
    follow[0] += (aim[0] - follow[0]) * k; follow[1] += (aim[1] - follow[1]) * k;
    cam.target = [follow[0], follow[1], 1.5];
    if (performance.now() / 1000 < manualUntil || cameraMode !== 'chase') {
      // the player has the camera, or the world holds still: the chase heading rests wherever the view is
      chase = orbit.currentAzimuth;
    } else {
      // behind the nose, whichever way it is driving, by the shorter way round
      const behind = dozer.yaw + Math.PI;
      chase += wrap(behind - chase) * Math.min(1, 3.5 * dt);
      const now = orbit.currentAzimuth;
      orbit.setSpherical({ azimuth: now + wrap(chase - now) });
    }
    orbit.update();
    if (cameraNoteIn > 0 && (cameraNoteIn -= dt) <= 0) cameraNote.hidden = true;
    const reach = orbit.distance * 1.1 + 20;
    renderer.setSunShadow({ min: [follow[0] - reach, follow[1] - reach, -16], max: [follow[0] + reach, follow[1] + reach, 14] });

    lightUp(t);
    upload(t);
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw', dt);

    if (runTimer > 0) {
      runTimer -= dt;
      // the run is over: the tally fades, and the next coin starts a new one
      if (runTimer <= 0) { showRun(); runValue = 0; runCount = 0; gained.fill(0); }
    }
    if (economy.bank !== lastBank) {
      lastBank = economy.bank; bankValue.textContent = shopBalance.textContent = `${economy.bank}`; showRun();
      if (!economy.save.done && !economy.nextOpen() && banked(economy.current()) >= CLEAR_SHARE) economy.open();
      showProgress();
    }
    // through the next room's gate and on among its heaps: the room behind is sealed. Up to the
    // gate and in the corridor, a word first, and the line that seals it glows red, so it is not a surprise.
    warning = false;
    if (economy.nextOpen()) {
      const next = economy.next()!, room = economy.current();
      if (pastGate(next, dozer.x, dozer.y)) { economy.moveOn(); showProgress(); }
      else if (atGate(next, dozer.x, dozer.y)) {
        warning = true;
        const still = lying(room);
        note(`further in seals ${the(room)}${still > 0 ? ` · ${still} still in it` : ''}`, 0.4);
      }
    }
    showPointer(t);
    if (t >= rubbleAt) { rubbleAt = t + 1; recordRubble(); }
    smoothed += (dt * 1000 - smoothed) * 0.08;
    if ((statsIn -= dt) <= 0) {
      statsIn = 0.25;
      statsPanel.innerHTML = `<span>${smoothed.toFixed(1)}</span> ms · <span>${Math.round(1000 / smoothed)}</span> fps<br>`
        + `<span>${world.live}</span> bodies · <span>${awake}</span> awake · load <span>${world.load}</span><br>`
        + `coins <span>${COIN_LADDER[coinDetail].name}</span>`;
    }
    if (shopOpen && (shopIn -= dt) <= 0) { shopIn = 0.3; renderShop(shopRows, economy); renderShop(shopCosmetics, economy, economy.cosmetics()); }
  };
  requestAnimationFrame(frame);
}
