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
import { AREAS, BODY_CAPACITY, HOLE, TILE, buildCave, floorTiles, gateTiles, hash, wallInstances, type Heap, type Vein } from './cave';
import { World, KIND_NAME, KIND_VALUE, type Pusher } from './physics';
import { Dozer, BLADE_AT, BLADE_HEIGHT, TRACK_GAUGE, bladePieces, separate } from './dozer';
import { Input } from './input';
import { TrackSliders, isTouchDevice } from './touch';
import { Economy, MAX_DRONES, renderShop } from './economy';
import { Bot, BOT_SCALE, BOT_SPEC, Fountain, beltOf } from './tools';
import { Sound } from './audio';
import { COIN_LADDER, ball, box, coin, collar, cylinder, gem, moved, pit, tile, turned } from './meshes';
import { identity, hide, place, placePart, placeQuat, project } from './matrix';

/** One world unit is ten centimetres: a coin two across is a big cartoon coin. */
const MM_PER_UNIT = 100;
const LIGHT_CAPACITY = 64;
const EFFECT_CAPACITY = 32;
const GEM_CAPACITY = [0, 320, 240, 260, 160];
const BOT_CAPACITY = MAX_DRONES;
const TREAD_BARS = 9;
const STRIPE_CAPACITY = 80;
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

/** The eye lamp's strength: enough to make coins flash, not to light the cave. */
const GLINT = 2.5;

const CAMERA = { azimuth: -Math.PI / 2, polar: 0.62, radius: 78 };

const canvas = document.getElementById('view') as HTMLCanvasElement;
const boot = document.getElementById('boot')!;
const bootMsg = document.getElementById('bootMsg')!;
const bankPanel = document.getElementById('bank')!;
const bankValue = bankPanel.querySelector('b')!;
const coinCount = document.getElementById('coinCount')!;
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
    // No daylight underground, but a cool light from high above, as if through a
    // shaft: it gives the walls lit tops and shadowed sides, and the sun map throws
    // their shadows across the floor. The tonemap lifts the darks hard, so these
    // read far brighter than the numbers look.
    sunDir: [0.3, -0.22, 0.93],
    sunColour: [0.06, 0.065, 0.085],
    exposure: 1.15,
    falloffHalf: 9,
    // the fill the cave had before it went dark, with the occlusion darkening
    // what it cannot reach: wall bases, the gaps in a heap, under the dozer
    ambient: 0.42,
    occlusion: 2,
    occlusionRadius: 2.5,
    occlusionDirect: 0.3,
    spotSoftness: 0.004,
    background: [0.012, 0.01, 0.018],
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
  const world = new World(BODY_CAPACITY, cave.solid(economy.save.areas));
  const dozer = new Dozer(world.solid);
  const input = new Input();
  const sound = new Sound();
  const fountains: Fountain[] = [];
  for (let a = 0; a < AREAS.length; a++) if (economy.save.areas[a]) fountains.push(new Fountain(AREAS[a]));
  const bots: Bot[] = [];
  for (let i = 0; i < economy.save.drones; i++) bots.push(new Bot(world.solid, i + 1, HOLE.x + 14 + i * 6, HOLE.y + 10));
  for (let a = 1; a < AREAS.length; a++) if (economy.save.belts[a]) world.belts.push(beltOf(AREAS[a].belt!.spec));

  // ---- the static half: floor, walls, hole, gates, chutes, belts ----

  const meshes = {
    tile: tile(TILE * 1.01), wall: box(TILE * 1.02, TILE * 1.02, 1), gate: box(3.4, 3.4, 1, false),
    // the three tiles each way the floor leaves out, and a little more so no seam shows
    // between them; see where it is placed for why that overlap does not flicker
    collar: collar(TILE * 3 + 0.2, HOLE.radius), pit: pit(HOLE.radius, HOLE.depth), chute: box(4, 4, 1),
    beltBase: box(1, 1, 1), rail: box(1, 1, 1),
  };

  function buildStatic() {
    const floor = floorTiles(cave);
    const floorM = new Float32Array(floor.length * 16);
    const floorMat = new Float32Array(floor.length * MATERIAL_STRIDE);
    floor.forEach(([x, y], i) => {
      place(floorM, i, x, y, 0);
      const h = hash(x, y, 3), warm = hash(x, y, 5);
      floorMat.set([0.3 + h * 0.06 + warm * 0.04, 0.21 + h * 0.04, 0.13 + h * 0.03, 0.95], i * MATERIAL_STRIDE);
    });
    const walls = wallInstances(cave);
    const wallM = new Float32Array(walls.length * 16);
    const wallMat = new Float32Array(walls.length * MATERIAL_STRIDE);
    walls.forEach((w, i) => {
      placePart(wallM, i, w.x, w.y, -0.5, 0, 0, 0, 0, 0, 0, 1, 1, w.height + 0.5);
      const s = 0.8 + w.shade * 0.35, dim = w.ring ? 0.8 : 1;
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
    const chuteM = new Float32Array(AREAS.length * 16);
    AREAS.forEach((a, i) => placePart(chuteM, i, a.vein.x, a.vein.y, 7, 0, 0, 0, 0, 0, 0.35, 1, 1, 2));
    const belts: GameGroup[] = [];
    for (let a = 1; a < AREAS.length; a++) {
      if (!economy.save.belts[a]) continue;
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
      { mesh: meshes.chute, matrices: chuteM, albedo: [0.2, 0.2, 0.22], roughness: 0.6 },
      ...belts,
    ]);
  }
  buildStatic();

  // ---- the dynamic half: coins, gems, the dozer, drones, belt stripes ----

  const COINS = 0, GEMS = 1, HULL = 5, DARK = 6, BLADE = 7, TREADS = 8, BOT_HULL = 9, BOT_DARK = 10, BOT_BLADE = 11, STRIPES = 12, POLE = 13, FLAG = 14;
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
    { mesh: gemMesh, matrices: gemM[1], count: 0, albedo: [1.0, 0.06, 0.12], roughness: 0.28 },
    { mesh: gemMesh, matrices: gemM[2], count: 0, albedo: [0.08, 0.95, 0.35], roughness: 0.28 },
    { mesh: gemMesh, matrices: gemM[3], count: 0, albedo: [0.12, 0.35, 1.0], roughness: 0.28 },
    { mesh: gemMesh, matrices: gemM[4], count: 0, albedo: [0.9, 0.97, 1.0], roughness: 0.15 },
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
  ];
  /** The pennant is red, unless the hull is: then it is white, so it shows. */
  function flagColour(): [number, number, number] {
    const [r, g, b] = economy.paint().colour;
    return r > 0.6 && g < 0.5 && b < 0.75 ? [0.95, 0.95, 0.95] : [0.9, 0.15, 0.15];
  }
  renderer.setDynamic(dynamic);

  // ---- coins into the cave ----

  const gemCount = [0, 0, 0, 0, 0];
  function spawn(kind: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): boolean {
    if (kind > 0 && gemCount[kind] >= GEM_CAPACITY[kind]) return false;
    const i = world.spawn(kind, x, y, z, vx, vy, vz);
    if (i < 0) return false;
    if (kind > 0) gemCount[kind]++;
    return true;
  }
  function spawnHeap(h: Heap) {
    const R = Math.sqrt(h.coins) * 0.36 + 1.5, H = Math.sqrt(h.coins) * 0.3 + 1.5;
    const drop = (kind: number) => {
      const z = 1 + Math.random() * H;
      const rr = R * (1 - z / (H + 2)) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      spawn(kind, h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr, z);
    };
    for (let k = 0; k < h.coins; k++) drop(0);
    for (const [kind, n] of h.gems) for (let k = 0; k < n; k++) drop(kind);
  }
  for (let a = 0; a < AREAS.length; a++) if (economy.save.areas[a]) AREAS[a].heaps.forEach(spawnHeap);
  // a moment of settling before anyone sees it, so the heaps are heaps
  for (let i = 0; i < 90; i++) world.step(1 / 60, () => {});

  const veinTimers = AREAS.map(() => Math.random());
  function trickle(dt: number) {
    if (world.live > BODY_CAPACITY - 60) return;
    for (let a = 0; a < AREAS.length; a++) {
      if (!economy.save.areas[a]) continue;
      const v: Vein = AREAS[a].vein;
      veinTimers[a] -= dt;
      if (veinTimers[a] > 0) continue;
      veinTimers[a] = v.every * (0.7 + Math.random() * 0.6);
      let kind = 0;
      const roll = Math.random();
      let acc = 0;
      for (const [k, p] of v.gems) { acc += p; if (roll < acc) { kind = k; break; } }
      const a2 = Math.random() * Math.PI * 2;
      spawn(kind, v.x + Math.cos(a2) * 0.6, v.y + Math.sin(a2) * 0.6, 6.5, Math.cos(a2) * 3, Math.sin(a2) * 3, 1);
    }
  }

  // ---- the bank, and the run ----

  /** A run: everything that has gone in without a pause longer than a moment. */
  let holePulse = 0;
  let runValue = 0, runCount = 0, runTimer = 0;
  const gained: number[] = [0, 0, 0, 0, 0];
  /** How fast value is arriving, in coins a second, smoothed: what the cascade scales by. */
  let flow = 0;
  function collect(kind: number, x: number, y: number) {
    if (kind > 0) gemCount[kind]--;
    const value = KIND_VALUE[kind];
    economy.deposit(value);
    gained[kind]++;
    runValue += value; runCount++; runTimer = 1.3;
    flow += 1;
    const heat = Math.min(1, flow / 25);
    holePulse = Math.min(3, holePulse + 0.2 + heat * 0.5 + (kind > 0 ? 0.7 : 0));
    if (kind > 0) sound.thunk(value); else sound.clink(runCount);
    const gold: [number, number, number] = kind === 0 ? [1.6, 1.2, 0.4] : (dynamic[kind].albedo as [number, number, number]).map((c) => c * 2) as [number, number, number];
    renderer.emit({
      position: [x, y, 0.5], velocity: [0, 0, 12 + heat * 10], spread: 6 + heat * 6, count: (kind > 0 ? 40 : 8) + Math.round(heat * 30),
      life: 0.9 + heat * 0.5, lifeSpread: 0.4, size: (kind > 0 ? 0.45 : 0.3) + heat * 0.15, growth: -0.2, colour: gold, alpha: 0, gravity: 0.8, floor: -30,
    });
  }
  function showRun() {
    const parts: string[] = [];
    for (let k = 0; k < 5; k++) {
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
  economy.onBuy((id) => {
    sound.chime();
    if (id.startsWith('area')) {
      const a = +id.slice(4);
      world.solid = cave.solid(economy.save.areas);
      dozer.solid = world.solid;
      for (const b of bots) b.dozer.solid = world.solid;
      AREAS[a].heaps.forEach(spawnHeap);
      fountains.push(new Fountain(AREAS[a]));
      buildStatic();
      // the rock came down: a cloud of it, at each gate tile
      for (const [x, y] of gateTiles(cave, a)) {
        renderer.emit({ position: [x, y, 1.5], velocity: [0, 0, 5], spread: 6, count: 60, life: 1.6, lifeSpread: 0.5, size: 1.2, growth: 1.5, colour: [0.45, 0.4, 0.5], alpha: 0.8, gravity: 0.15, floor: 0 });
      }
    } else if (id.startsWith('belt')) {
      world.belts.push(beltOf(AREAS[+id.slice(4)].belt!.spec));
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
    cameraMode = MODES[(MODES.indexOf(cameraMode) + 1) % MODES.length];
    try { localStorage.setItem('pushminer-camera', cameraMode); } catch { /* fine */ }
    manualUntil = 0;
    if (cameraMode === 'fixed') orbit.setSpherical({ azimuth: orbit.currentAzimuth + wrap(CAMERA.azimuth - orbit.currentAzimuth) });
    cameraNote.textContent = `camera: ${cameraMode}`;
    cameraNote.hidden = false;
    cameraNoteIn = 2;
  }
  const cameraNote = document.getElementById('cameraNote')!;
  let cameraNoteIn = 0;

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
    // a dim work lamp on the cab, so the ground just round the machine is not black
    lights.add({ position: [dozer.x - c * 0.5, dozer.y - s * 0.5, 6], radius: 12, colour: [1.0, 0.85, 0.65], intensity: 0.35 });
    // A glint lamp, high and to the left of the eye. With no environment to reflect, a
    // metal only shines where a light's highlight lands, and the dozers' low beams bounce
    // off flat coins away from a camera looking down. Near the eye, the highlight lands on
    // whatever faces the viewer, so tilted coins flash; not at it, because a light from
    // the eye lights every face the eye sees alike, and the rock goes flat and grey.
    {
      const [px, py, pz] = cam.position, [tx, ty] = cam.target;
      const fx = tx - px, fy = ty - py, fl = Math.hypot(fx, fy) || 1;
      const reach = Math.hypot(px - tx, py - ty, pz);
      // the view's right, flat on the floor, and the lamp that far to its left and above
      const rx = fy / fl, ry = -fx / fl;
      lights.add({ position: [px - rx * reach * 0.55, py - ry * reach * 0.55, pz + reach * 0.35], radius: 500, colour: [1.0, 0.72, 0.42], intensity: GLINT });
    }
    const pulse = 1 + holePulse * 1.6;
    lights.add({ position: [HOLE.x, HOLE.y, 1.5], radius: 14 + holePulse * 6, colour: [0.45, 1.0, 0.3], intensity: 2.0 * pulse });
    for (let a = 0; a < AREAS.length; a++) {
      if (!economy.save.areas[a]) continue;
      const v = AREAS[a].vein;
      lights.add({ position: [v.x, v.y, 5.5], radius: 12, colour: [1.0, 0.7, 0.3], intensity: 1.6 + 0.4 * Math.sin(t * 7 + a) });
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
    const m = world.magnet;
    if (m) lights.add({ position: [m.x, m.y, 1.2], radius: m.radius * 0.8, colour: [0.45, 0.7, 1.0], intensity: 0.6 + m.strength * 0.03 });
    renderer.setLights(lights, shadowed);

    // the glows, as screen-space layers: the hole, each cracking floor, the magnet's reach
    let n = 0;
    const p = project(cam.viewProjection, HOLE.x, HOLE.y, 0);
    if (p) {
      const size = (HOLE.radius * 2.2 / p[2]) * (1 + holePulse * 0.5);
      quads.set([p[0], p[1], size * 0.9, 0.4 + holePulse * 0.9, 0.5, 1.0, 0.35, 1.8], n * EFFECT_STRIDE); n++;
    }
    for (const f of fountains) {
      if (f.glow <= 0) continue;
      const q = project(cam.viewProjection, f.x, f.y, 0.2);
      if (!q || n >= EFFECT_CAPACITY) continue;
      quads.set([q[0], q[1], (6 / q[2]) * (0.6 + f.glow * 0.6), f.glow * (f.state === 'warn' ? 0.5 + 0.3 * Math.sin(t * 30) : 1.2), 1.0, 0.5, 0.15, 2.2], n * EFFECT_STRIDE); n++;
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
    const counts = [0, 0, 0, 0, 0];
    awake = 0;
    const { x, y, z, q, kind, alive, asleep } = world;
    for (let i = 0; i < world.count; i++) {
      if (!alive[i]) continue;
      if (!asleep[i]) awake++;
      const k = kind[i];
      const m = k === 0 ? coinM : gemM[k];
      if (counts[k] * 16 >= m.length) continue;
      placeQuat(m, counts[k]++, x[i], y[i], z[i], q, i * 4);
    }
    renderer.move(COINS, coinM, counts[0]);
    for (let k = 1; k <= 4; k++) renderer.move(GEMS + k - 1, gemM[k], counts[k]);

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
    for (let a = 1; a < AREAS.length; a++) {
      if (!economy.save.belts[a]) continue;
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
  economy.onBuy((id) => { if (id === 'horn') showHorn(); });
  if (touch) {
    input.tracks = new TrackSliders(document.getElementById('trackLeft')!, document.getElementById('trackRight')!);
    document.getElementById('tracks')!.hidden = false;
    shopButton.hidden = false;
    shopButton.addEventListener('click', () => input.toggleShop());
    // pointerdown, not click: a horn sounds when it is pressed, and a click waits for the lift
    hornButton.addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressHorn(); });
    // straight to the sound, not through the input's once-a-frame flag: two taps inside
    // one frame would be one toggle there, and the button would say the wrong thing
    muteButton.addEventListener('click', () => { sound.toggleMute(); showMute(); });
    muteButton.hidden = false;
    showMute();
    showHorn();
  }
  Object.assign(globalThis as Record<string, unknown>, { world, dozer, economy, renderer, orbit, bots, fountains, sound, setCoinDetail, calibration });

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
    for (const b of bots) b.update(dt, world, world.loads[b.dozer.owner] ?? 0);
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
    if (economy.bank !== lastBank) { lastBank = economy.bank; bankValue.textContent = `${economy.bank}`; showRun(); }
    smoothed += (dt * 1000 - smoothed) * 0.08;
    if ((statsIn -= dt) <= 0) {
      statsIn = 0.25;
      coinCount.textContent = `${world.live}`;
      statsPanel.innerHTML = `<span>${smoothed.toFixed(1)}</span> ms · <span>${Math.round(1000 / smoothed)}</span> fps<br>`
        + `<span>${world.live}</span> bodies · <span>${awake}</span> awake · load <span>${world.load}</span><br>`
        + `coins <span>${COIN_LADDER[coinDetail].name}</span>`;
    }
    if (shopOpen && (shopIn -= dt) <= 0) { shopIn = 0.3; renderShop(shopRows, economy); renderShop(shopCosmetics, economy, economy.cosmetics()); }
  };
  requestAnimationFrame(frame);
}
