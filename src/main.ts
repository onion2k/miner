/**
 * Pushminer: a bulldozer in a cave full of coins, and a hole to push them
 * into. Drawn on the game path of artshape-render — a forward renderer that
 * redraws everything every frame and instances the thousands of coins as
 * one draw each.
 *
 * This is where everything is made and wired together, and where the frame
 * loop runs; what each piece does is in its own module. See "How it is put
 * together" in the README.
 */
import { createContext } from 'artshape-render/gpu/context';
import { Orbit } from 'artshape-render/gpu/camera';
import { bakeEnvironment } from 'artshape-render/render/env';
import { GameRenderer } from 'artshape-render/game/renderer';
import type { Emit } from 'artshape-render/game/particles';
import {
  AREAS,
  BODY_CAPACITY,
  HOLE,
  ORDER,
  SECRET,
  SECRETS,
  WALLS,
  behindGate,
  buildCave,
  gateCentre,
  gateTiles,
  sealPoint,
  tileCentre,
  COLS,
} from './cave';
import { World, BRICK_KIND, KIND_RADIUS, type Pusher } from './physics';
import { Dozer, BLADE_AT, TRACK_GAUGE, separate } from './dozer';
import { Input } from './input';
import { TouchControls, isTouchDevice } from './touch';
import {
  Economy,
  MAX_DRONES,
  WALL_NAME,
  WALL_STRENGTH,
  areaOfSource,
  chamberSource,
  renderShop,
  wallSource,
} from './economy';
import { Bot, BOT_SCALE, BOT_SPEC, Foreman, Fountain, beltOf } from './tools';
import { Nav } from './nav';
import { Sound } from './audio';
import { COIN_LADDER } from './meshes';
import { floorHeight } from './terrain';
import { TrackMarks } from './tracks';
import { NO_SOURCE, Stock, lootHeap } from './stock';
import { Tally } from './tally';
import { VeinTrickle } from './vein';
import { Impacts } from './impacts';
import { atNextGate, progressText, readyToOpen, the } from './progress';
import { lampOn, lampsHit } from './lamps';
import { looseBricks, stashBehind, wallTiles } from './walls';
import { StaticScene } from './scene-static';
import { DynamicScene, TREAD_PITCH } from './scene-dynamic';
import { SceneLights } from './lighting';
import { CameraRig, CAMERA_HOME } from './camera';
import { calibrate, frameCost } from './calibrate';
import { Hud, placePointer, setupPad } from './hud';
import { WALL_COLOUR, kindColour, type Rgb } from './palette';
import * as fx from './effects';

/** One world unit is ten centimetres: a coin two across is a big cartoon coin. */
const MM_PER_UNIT = 100;
const LIGHT_CAPACITY = 256;
const EFFECT_CAPACITY = 256;
/** How many of each kind the cave can hold at once, past the coins; the last two are gold bars and bricks. */
const GEM_CAPACITY = [0, 320, 240, 260, 160, 60, 900];
/** The marks the tracks leave in the floor, the player's and the drones': pages of them, and how many a page. */
const TRACK_PAGES = 16,
  TRACK_PAGE = 1024;
/**
 * What drawing one frame may cost at load, CPU and GPU together, before the
 * coins step down a rung: half a 60 Hz frame, leaving the rest for the
 * physics and the browser. `?coins=0`…`3` skips the measuring and picks one.
 */
const RENDER_BUDGET_MS = 8;
/** How many things a sealed room's going puffs over, at most. */
const SEAL_PUFFS = 160;
/** Where a drone is put back to, out of the way by the hole. */
const botHome = (j: number): [number, number] => [HOLE.x + 14 + j * 6, HOLE.y + 10];

const hud = new Hud();
const canvas = document.getElementById('view') as HTMLCanvasElement;

main().catch((err: unknown) => {
  hud.booting(err instanceof Error ? err.message : String(err));
  console.error(err);
});

async function main() {
  // ---- the renderer ----

  const ctx = await createContext(canvas);
  hud.booting('compiling shaders…');
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
  const emit = (bursts: Emit | Emit[]) => {
    for (const e of Array.isArray(bursts) ? bursts : [bursts]) renderer.emit(e);
  };

  hud.booting('digging the cave…');
  await new Promise((r) => {
    requestAnimationFrame(r);
    setTimeout(r, 50);
  });

  // ---- the game ----

  const economy = new Economy();
  const save = economy.save;
  const cave = buildCave();
  const world = new World(BODY_CAPACITY, cave.solid(save.areas, save.secrets, save.walls));
  const dozer = new Dozer(world.solid);
  const input = new Input();
  const sound = new Sound();
  /** The last room: once the cave is cleared its vein runs and its floor cracks, so there is still something to push. */
  const LAST = ORDER[ORDER.length - 1];
  const fountains: Fountain[] = [];
  if (save.done) fountains.push(new Fountain(AREAS[LAST]));
  const vein = new VeinTrickle(AREAS[LAST].vein);
  const nav = new Nav(world.solid);
  const bots: Bot[] = [];
  const traffic = { bots, player: dozer };
  for (let i = 0; i < save.drones; i++) bots.push(new Bot(world.solid, i + 1, ...botHome(i)));
  /** The belts that run: those bought, for rooms not sealed. */
  const running = () => AREAS.map((_, a) => a).filter((a) => AREAS[a].belt && save.belts[a] && !economy.sealed(a));
  const runBelts = () => {
    world.belts = running().map((a) => beltOf(AREAS[a].belt!.spec));
    nav.setBelts(world.belts);
  };
  runBelts();
  /** Game time, in seconds. */
  let t = 0;

  // ---- the scene ----

  const staticScene = new StaticScene(cave);
  const buildStatic = () => renderer.setStatic(staticScene.groups({ ...save, belts: running() }));
  buildStatic();

  // A mark a grouser apart, the width of a track, on the floor wherever there is floor: not over the
  // hole, and not on rock, where a machine pushed into it for a moment is not really standing.
  const tracks = new TrackMarks({
    pageSize: TRACK_PAGE,
    pages: TRACK_PAGES,
    gauge: TRACK_GAUGE,
    spacing: TREAD_PITCH,
    length: 0.32,
    width: 1.6,
    ground: (x, y) => {
      if (Math.hypot(x - HOLE.x, y - HOLE.y) < HOLE.radius + 0.6) return null;
      const tile = nav.tileOf(x, y);
      return tile < 0 || world.solid[tile] ? null : floorHeight(x, y);
    },
  });
  const scene = new DynamicScene(renderer, {
    bodyCapacity: BODY_CAPACITY,
    kindCapacity: GEM_CAPACITY,
    bots: MAX_DRONES,
    botScale: BOT_SCALE,
    botBladeWidth: BOT_SPEC.bladeWidth,
    bladeWidth: economy.spec().bladeWidth,
    paint: economy.paint(),
    trackPages: tracks.matrices,
  });
  let coinDetail = 0;
  const setCoinDetail = (level: number) => {
    coinDetail = Math.max(0, Math.min(COIN_LADDER.length - 1, level));
    scene.setCoinDetail(coinDetail);
  };

  // ---- what is in the cave ----

  const stock = new Stock(world, GEM_CAPACITY, () => economy.current());
  const saved = { ...save, left: save.left };
  // the save keeps the live counts from here on, so it is never behind
  save.left = stock.left;
  stock.restore(saved, economy);
  // a moment of settling before anyone sees it, so the heaps are heaps
  for (let i = 0; i < 90; i++) world.step(1 / 60, () => {});
  economy.persist();

  const recordRubble = () => {
    save.rubble = stock.rubble();
  };
  let rubbleAt = 0;
  addEventListener('pagehide', () => {
    recordRubble();
    economy.persist();
  });
  addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    recordRubble();
    economy.persist();
  });

  // ---- the bank, and the run ----

  const tally = new Tally();
  function collect(kind: number, x: number, y: number, i: number) {
    const value = stock.collect(kind, i);
    // a brick down the hole is only gone
    if (kind === BRICK_KIND) return;
    economy.deposit(value);
    const heat = tally.add(kind);
    if (kind > 0) sound.thunk(value);
    else sound.clink(tally.count);
    const colour: Rgb = kind === 0 ? [1.6, 1.2, 0.4] : (kindColour(kind).map((c) => c * 2) as Rgb);
    emit(fx.sparkle(x, y, colour, kind > 0, heat));
  }

  // ---- the cave changing ----

  /** The rock where it stands now: gates, chambers and walls as they are. Everything that goes by the rock is told. */
  function reshape() {
    world.solid = cave.solid(save.areas, save.secrets, save.walls);
    dozer.solid = world.solid;
    for (const b of bots) {
      b.dozer.solid = world.solid;
      b.reset();
    }
    nav.rebuild(world.solid);
    runBelts();
    buildStatic();
  }

  /** The rock at a gate, coming down or going up. */
  const gateCloud = (area: number) => emit(gateTiles(cave, area).map(([x, y]) => fx.gateCloud(x, y)));

  /** A hidden chamber broken into: the stone in front of it bursts, and the chamber is floor, with its loot in it. */
  function smashOpen(k: number) {
    const [w0x, w0y, w1x, w1y] = SECRETS[k].wall;
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    for (let i = 0; i < cave.cells.length; i++) {
      if (cave.cells[i] !== SECRET + k) continue;
      const tx = i % COLS,
        ty = (i / COLS) | 0;
      if (tx >= w0x && tx <= w1x && ty >= w0y && ty <= w1y) emit(fx.rockBurst(...tileCentre(tx, ty), c, s));
    }
    sound.smash();
    stock.spawnHeap(chamberSource(k), lootHeap(k));
    economy.persist();
    reshape();
    hud.note('a hidden chamber', 3);
  }

  /**
   * A brick wall knocked down: every brick in it comes loose and tumbles, and dust hangs where the
   * wall stood. The bricks stay where they land, and in the save, until they are pushed down the hole.
   */
  function knockOver(w: number) {
    const { grade, treasure } = WALLS[w];
    for (const piece of looseBricks(w, dozer, KIND_RADIUS[BRICK_KIND])) {
      const { x, y, z, vx, vy, vz } = piece;
      if (piece.treasure !== undefined) {
        stock.spawn(piece.treasure, x, y, z, vx, vy, vz, wallSource(w));
        continue;
      }
      const i = stock.spawnBrick(grade, x, y, z, vx, vy, vz);
      if (i >= 0) [world.wx[i], world.wy[i], world.wz[i]] = piece.spin;
    }
    const brick = WALL_COLOUR[grade].slice(0, 3) as Rgb;
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    emit(wallTiles(w).map(([x, y]) => fx.wallDust(x, y, c, s, brick)));
    sound.smash();
    recordRubble();
    economy.persist();
    reshape();
    const behind = stashBehind(w);
    hud.note(
      `${WALL_NAME[grade]} wall down${treasure.length ? ' · something glints in the rubble' : behind ? ` · ${behind.name}` : ''}`,
      3,
    );
  }

  /** Knock over any lamp the player's machine is into: its hull, or its blade. */
  function knockLamps() {
    const hits = lampsHit(cave.lamps, save.lampsBroken, dozer.x, dozer.y, dozer.yaw, BLADE_AT);
    for (const k of hits) {
      const l = cave.lamps[k];
      const lit = lampOn(cave.lamps, k, save);
      economy.breakLamp(k);
      sound.shatter();
      emit(fx.glass(l.x, l.y, l.height, Math.cos(dozer.yaw), Math.sin(dozer.yaw), lit));
    }
    if (hits.length) buildStatic();
  }

  economy.onChange((id) => {
    sound.chime();
    if (id.startsWith('area')) {
      const a = +id.slice(4);
      hud.note(`${the(a)} is open: ${AREAS[a].blurb} · go on in when you are done here`, 5);
      stock.openRoom(a);
      // the heaps are in the save now, or a reload before the next coin would find the room empty
      economy.persist();
      reshape();
      gateCloud(a);
    } else if (id.startsWith('sealed')) {
      const old = +id.slice(6);
      // what is left of the room behind goes, and what is left in any chamber, side room or wall off
      // it: bars not got out before going on are lost with the room. A puff where each was.
      const lost = stock.lying(old);
      let puffs = 0;
      stock.seal(old, (x, y, z) => {
        if (puffs++ < SEAL_PUFFS) emit(fx.puff(x, y, z));
      });
      // no machine is shut in with the rock, or in it
      bots.forEach((b, j) => {
        if (!behindGate(old, b.x, b.y)) return;
        [b.dozer.x, b.dozer.y] = botHome(j);
        b.dozer.speed = 0;
      });
      economy.persist();
      reshape();
      if (old !== ORDER[0]) gateCloud(old);
      const gone = lost > 0 ? ` · ${lost} left behind` : '';
      hud.note(
        old === ORDER[0] ? `on into ${the(economy.current())}${gone}` : `${the(old)} is sealed behind you${gone}`,
        4,
      );
    } else if (id.startsWith('secret')) {
      smashOpen(+id.slice(6));
    } else if (id.startsWith('wall')) {
      knockOver(+id.slice(4));
    } else if (id === 'done') {
      hud.note(`the cave is cleared · ${the(LAST)}'s vein runs on`, 6);
      fountains.push(new Fountain(AREAS[LAST]));
    } else if (id.startsWith('belt')) {
      runBelts();
      buildStatic();
    } else if (id === 'drone') {
      bots.push(new Bot(world.solid, bots.length + 1, ...botHome(0)));
    } else if (id === 'blade') {
      scene.setBlade(economy.spec().bladeWidth);
    } else if (id.startsWith('paint:')) {
      scene.setPaint(economy.paint());
    }
    world.wakeAll();
  });

  // ---- the rock that breaks, and the walls ----

  const impacts = new Impacts(cave.cells);
  const impactState = {
    get wallsDown() {
      return save.walls;
    },
    get secretsOpen() {
      return save.secrets;
    },
    ram: (speed: number) => economy.ram(speed),
  };
  dozer.onRock = (tx, ty, square) => {
    const hit = impacts.hit(tx, ty, square, dozer.speed, t, impactState);
    if (!hit) return;
    if (hit.type === 'reveal') economy.reveal(hit.chamber);
    else if (hit.type === 'knock') sound.knock();
    else {
      const wall = WALLS[hit.wall];
      const gone = economy.hitWall(hit.wall, hit.damage);
      // one that comes down says so itself, through the economy's change
      if (gone >= 1) return;
      sound.clunk();
      if (gone > 0.5) sound.crack();
      emit(
        fx.wallHit(
          hit.x,
          hit.y,
          Math.cos(dozer.yaw),
          Math.sin(dozer.yaw),
          gone,
          WALL_COLOUR[wall.grade].slice(0, 3) as Rgb,
        ),
      );
      const more = Math.ceil((WALL_STRENGTH[wall.grade] - save.wallDamage[hit.wall]) / hit.damage);
      hud.note(
        `${WALL_NAME[wall.grade]} wall · ${Math.round(gone * 100)}% · ${more === 1 ? 'one more like that' : `about ${more} more like that`}`,
        2.5,
      );
      buildStatic();
    }
  };

  // ---- the camera ----

  const cam = renderer.camera;
  cam.target = [dozer.x, dozer.y, 0];
  cam.position = [
    dozer.x,
    dozer.y - CAMERA_HOME.radius * Math.sin(CAMERA_HOME.polar),
    CAMERA_HOME.radius * Math.cos(CAMERA_HOME.polar),
  ];
  // On a phone a finger on the screen is a finger on a slider or the shop, and a stray
  // touch on the cave must not swing the camera: the canvas takes no pointers at all.
  // The orbit stays enabled, because enabled is also what moves the camera after the dozer.
  const touch = isTouchDevice();
  if (touch) {
    document.body.classList.add('touch');
    canvas.style.pointerEvents = 'none';
  }
  const orbit = new Orbit(cam, {
    element: canvas,
    minPolar: 0.1,
    maxPolar: 1.25,
    minDistance: 28,
    maxDistance: 170,
    rotateSpeed: 0.4,
    zoomSpeed: 0.8,
    panSpeed: 0,
    inertia: 0.5,
  });
  const rig = new CameraRig(
    orbit,
    cam,
    dozer,
    {
      get: () => {
        try {
          return localStorage.getItem('pushminer-camera');
        } catch {
          return null;
        }
      },
      set: (mode) => {
        try {
          localStorage.setItem('pushminer-camera', mode);
        } catch {
          /* fine */
        }
      },
    },
    !touch,
  );
  canvas.addEventListener('pointerdown', () => rig.grab(performance.now() / 1000));

  let width = 1,
    height = 1;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    canvas.width = width;
    canvas.height = height;
    renderer.resize(width, height);
  };
  addEventListener('resize', resize);
  resize();

  // ---- each frame's lights and placements ----

  const lights = new SceneLights(LIGHT_CAPACITY, EFFECT_CAPACITY);
  /** The player is at the next room's gate, and going further seals the one being cleared. */
  let warning = false;
  function lightUp() {
    lights.build({
      t,
      view: cam,
      dozer,
      bots,
      lamps: cave.lamps,
      lampOn: (k) => lampOn(cave.lamps, k, save),
      fountains: fountains.map((f) => ({ x: f.x, y: f.y, glow: f.glow, warning: f.state === 'warn' })),
      vein: save.done ? AREAS[LAST].vein : null,
      sealing: warning ? sealPoint(cave, economy.next()!) : null,
      magnet: world.magnet,
      holePulse: tally.holePulse,
    });
    renderer.setLights(lights.lights, lights.shadowed);
    renderer.setEffects(lights.quads, lights.count);
  }
  let awake = 0;
  function upload() {
    awake = scene.write({
      world,
      brickGrade: stock.brickGrade,
      dozer,
      bots,
      belts: running(),
      flag: save.flag,
      tracks,
      t,
    });
    tracks.clean();
  }

  // ---- how much coin this machine can draw ----

  const forced = new URLSearchParams(location.search).get('coins');
  let calibration: number[] = [];
  if (forced !== null && Number.isFinite(+forced)) setCoinDetail(+forced);
  else {
    hud.booting('measuring this machine…');
    await renderer.ready;
    calibration = await calibrate(COIN_LADDER.length, RENDER_BUDGET_MS, setCoinDetail, async () => {
      // a frame of the real scene, drawn to a texture of our own rather than the canvas, so no wait to be shown is counted
      const target = ctx.device.createTexture({
        label: 'calibration target',
        size: [width, height],
        format: ctx.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const view = target.createView();
      const cost = await frameCost(
        () => {
          lightUp();
          upload();
          return renderer.frame(view, 'redraw', 1 / 60);
        },
        () => ctx.device.queue.onSubmittedWorkDone(),
      );
      target.destroy();
      return cost;
    });
  }
  console.info(
    `coins: ${COIN_LADDER[coinDetail].name}`,
    calibration.length
      ? `(frame cost per rung, ms: ${calibration.map((ms) => ms.toFixed(1)).join(', ')}; budget ${RENDER_BUDGET_MS})`
      : '(chosen by ?coins=)',
  );

  // ---- go ----

  hud.booted();
  hud.onReset(() => economy.reset());
  const cycleCamera = () => hud.note(`camera: ${rig.cycle()}`);
  /** A phone's mute button saying which way the sound is, when there is one. */
  let showMute: ((muted: boolean) => void) | null = null;
  if (touch) {
    const controls = new TouchControls(
      document.getElementById('trackLeft')!,
      document.getElementById('trackRight')!,
      document.getElementById('steer')!,
    );
    input.touch = controls;
    const pad = setupPad(
      {
        shop: () => input.toggleShop(),
        camera: () => input.pressCamera(),
        horn: () => input.pressHorn(),
        mute: () => sound.toggleMute(),
        controls: () => {
          const scheme = controls.cycle();
          hud.note(scheme === 'tracks' ? 'controls: a lever each track' : 'controls: throttle and steering');
          return scheme;
        },
      },
      sound.muted,
      controls.scheme,
    );
    pad.showHorn(save.horn);
    economy.onChange((id) => {
      if (id === 'horn') pad.showHorn(true);
    });
    showMute = pad.showMute;
  }
  Object.assign(globalThis as Record<string, unknown>, {
    world,
    dozer,
    economy,
    cave,
    lampsLit: lights.lampsLit,
    renderer,
    orbit,
    bots,
    fountains,
    sound,
    setCoinDetail,
    calibration,
    trackMarks: tracks,
  });

  // what the robo-dozers go for: the room being cleared, and any chamber broken into off it
  const foreman = new Foreman(
    world,
    nav,
    bots,
    stock.origin,
    (from) => from !== NO_SOURCE && areaOfSource(from) === economy.current(),
  );
  const choose = (bot: Bot) => foreman.choose(bot, t);

  /** The horn: everything near enough hops, which is what a horn is for. */
  function hop() {
    const { x, y, z, vz, alive, asleep } = world;
    for (let i = 0; i < world.count; i++) {
      if (!alive[i]) continue;
      const d = Math.hypot(x[i] - dozer.x, y[i] - dozer.y);
      if (d > 14 || z[i] > 3) continue;
      if (asleep[i]) world.wake(i);
      vz[i] += 5 * (1 - d / 14) + Math.random() * 2;
      world.wx[i] += (Math.random() - 0.5) * 6;
      world.wy[i] += (Math.random() - 0.5) * 6;
    }
  }

  let shopOpen = false;
  const renderShops = () => {
    renderShop(hud.shopRows, economy);
    renderShop(hud.shopCosmetics, economy, economy.cosmetics());
  };
  const pushers: Pusher[] = [];
  const botPushers: Pusher[] = [];
  let last = performance.now();
  let smoothed = 16.7;
  let statsIn = 0,
    shopIn = 0,
    aimAt = 0;
  let lastBank = -1;
  let gate: { x: number; y: number; label: string } | null = null;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    t += dt;

    // the keys
    if (input.takeShop()) {
      shopOpen = !shopOpen;
      hud.shop(shopOpen);
      if (shopOpen) renderShops();
    }
    if (input.takeHorn() && save.horn) {
      sound.horn();
      hop();
    }
    if (input.takeRecentre()) rig.recentre();
    if (input.takeCamera()) cycleCamera();
    if (input.takeMute()) showMute?.(sound.toggleMute());

    // the machines
    const spec = economy.spec();
    const drive = input.read();
    dozer.update(dt, drive, spec, world.load);
    tracks.update(dozer, dozer);
    knockLamps();
    for (const b of bots) {
      b.update(dt, world, world.loads[b.dozer.owner] ?? 0, nav, choose, traffic);
      tracks.update(b, b.dozer);
    }
    // no machine drives through another: every pair, twice, so a push out of one
    // that shoves into a third is settled in the same frame
    const machines = [dozer, ...bots.map((b) => b.dozer)];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < machines.length; i++)
        for (let j = i + 1; j < machines.length; j++) separate(machines[i], machines[j]);
    }
    dozer.pushers(spec, pushers);
    for (const b of bots) {
      b.dozer.pushers(BOT_SPEC, botPushers);
      pushers.push(...botPushers);
      if (Math.abs(b.dozer.speed) > 0.5)
        world.wakeNear(
          b.x + Math.cos(b.yaw) * BLADE_AT * BOT_SCALE,
          b.y + Math.sin(b.yaw) * BLADE_AT * BOT_SCALE,
          BOT_SPEC.bladeWidth * BOT_SCALE * 0.75 + 1.5,
        );
    }
    world.pushers = pushers;
    // the heap ahead of the blade wakes before the blade arrives
    const c = Math.cos(dozer.yaw),
      s = Math.sin(dozer.yaw);
    if (Math.abs(dozer.speed) > 0.5 || Math.abs(dozer.yawRate) > 0.2)
      world.wakeNear(dozer.x + c * BLADE_AT, dozer.y + s * BLADE_AT, spec.bladeWidth * 0.75 + 1.5);
    // the magnet sits a little ahead of the blade's face, and reaches out from there
    const mx = dozer.x + c * (BLADE_AT + 1.2),
      my = dozer.y + s * (BLADE_AT + 1.2);
    world.magnet = { x: mx, y: my, radius: spec.magnetRadius, strength: spec.magnetStrength };
    world.wakeNear(mx, my, spec.magnetRadius);

    // the vein and the cracking floors, once the cave is done
    if (save.done && world.live <= BODY_CAPACITY - 60)
      vein.update(dt, (kind, x, y, z, vx, vy, vz) => stock.spawn(kind, x, y, z, vx, vy, vz, LAST));
    let shaking = 0;
    for (const f of fountains) {
      f.update(
        dt,
        (kind, x, y, z, vx, vy, vz) => stock.spawn(kind, x, y, z, vx, vy, vz),
        () => sound.crack(),
      );
      if (f.state === 'idle') continue;
      const near = Math.max(0, 1 - Math.hypot(f.x - rig.follow[0], f.y - rig.follow[1]) / 90);
      shaking = Math.max(shaking, f.glow * near * (f.state === 'spray' ? 1 : 0.5));
      if (Math.random() < (f.state === 'spray' ? 0.9 : 0.35)) emit(fx.fountainDust(f.x, f.y, f.state === 'spray'));
    }
    sound.shake(shaking);
    sound.drive(drive.throttle, dozer.speed, world.load);

    // the coins
    world.step(dt, collect);
    tally.fade(dt);

    // the camera, and the picture
    rig.update(dt, performance.now() / 1000, dozer);
    hud.tick(dt);
    const reach = orbit.distance * 1.1 + 20;
    renderer.setSunShadow({
      min: [rig.follow[0] - reach, rig.follow[1] - reach, -16],
      max: [rig.follow[0] + reach, rig.follow[1] + reach, 14],
    });
    lightUp();
    upload();
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw', dt);

    // the counters, and getting on through the cave
    if (tally.tick(dt)) {
      // the run is over: the tally fades, and the next coin starts a new one
      hud.run(tally.summary());
      tally.reset();
    }
    const room = economy.current();
    if (economy.bank !== lastBank) {
      lastBank = economy.bank;
      hud.bank(economy.bank);
      hud.run(tally.summary());
      if (readyToOpen(economy, stock.banked(room))) economy.open();
      hud.progress(progressText(economy, stock.banked(economy.current())));
    }
    // through the next room's gate and on among its heaps: the room behind is sealed. Up to the
    // gate and in the corridor, a word first, and the line that seals it glows red, so it is not a surprise.
    warning = false;
    const where = atNextGate(economy, dozer.x, dozer.y);
    if (where === 'through') {
      economy.moveOn();
      hud.progress(progressText(economy, stock.banked(economy.current())));
    } else if (where === 'at') {
      warning = true;
      const still = stock.lying(room);
      hud.note(`further in seals ${the(room)}${still > 0 ? ` · ${still} still in it` : ''}`, 0.4);
    }
    // the arrow to the next room's gate, while it is open
    if (t >= aimAt) {
      aimAt = t + 0.4;
      const next = economy.next();
      gate =
        !save.done && next !== null && economy.nextOpen()
          ? { ...xy(gateCentre(cave, next)), label: AREAS[next].name }
          : null;
    }
    hud.showPointer(
      gate && placePointer(cam.viewProjection, gate, dozer, innerWidth, innerHeight, touch, t),
      gate?.label ?? '',
    );
    if (t >= rubbleAt) {
      rubbleAt = t + 1;
      recordRubble();
    }
    smoothed += (dt * 1000 - smoothed) * 0.08;
    if ((statsIn -= dt) <= 0) {
      statsIn = 0.25;
      hud.stats({ ms: smoothed, live: world.live, awake, load: world.load, coins: COIN_LADDER[coinDetail].name });
    }
    if (shopOpen && (shopIn -= dt) <= 0) {
      shopIn = 0.3;
      renderShops();
    }
  };
  requestAnimationFrame(frame);
}

function xy([x, y]: [number, number]) {
  return { x, y };
}
