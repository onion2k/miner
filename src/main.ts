/**
 * Pushminer: a bulldozer in a cave full of coins, and a hole to push them
 * into. Drawn on the game path of artshape-render — a forward renderer that
 * redraws everything every frame and instances the thousands of coins as
 * one draw each.
 *
 * This is the page: the renderer, the sound, the controls, the camera and
 * the counters, round the game in `game.ts`, which knows none of them. What
 * the game says has happened is turned here into sparkle, dust, sound and
 * words on the screen. See "How it is put together" in the README.
 */
import { createContext } from 'artshape-render/gpu/context';
import { Orbit } from 'artshape-render/gpu/camera';
import { bakeEnvironment } from 'artshape-render/render/env';
import { GameRenderer } from 'artshape-render/game/renderer';
import type { Emit } from 'artshape-render/game/particles';
import { AREAS, BODY_CAPACITY, HOLE, ORDER, WALLS, gateCentre, gateTiles, sealPoint } from './cave';
import { TRACK_GAUGE } from './dozer';
import { Input } from './input';
import { TouchControls, isTouchDevice } from './touch';
import { Economy, MAX_DRONES, WALL_NAME, renderShop } from './economy';
import { BOT_SCALE, BOT_SPEC } from './tools';
import { Sound } from './audio';
import { COIN_LADDER } from './meshes';
import { floorHeight } from './terrain';
import { TrackMarks } from './tracks';
import { SpiderGait } from './spider';
import { FUSE } from './barrels';
import { progressText, the } from './progress';
import { lampOn } from './lamps';
import { stashBehind, wallTiles } from './walls';
import { StaticScene } from './scene-static';
import { DynamicScene, TREAD_PITCH } from './scene-dynamic';
import { SceneLights } from './lighting';
import { CameraRig, CAMERA_HOME } from './camera';
import { calibrate, frameCost } from './calibrate';
import { Hud, placePointer, setupPad } from './hud';
import { WALL_COLOUR, kindColour, type Rgb } from './palette';
import * as fx from './effects';
import { airParticle, biomeAt, featureParticle, lampColour } from './biomes';
import { Game, KIND_CAPACITY, type GameEvents } from './game';
import { createApi, type PushminerApi } from './debug';

declare global {
  interface Window {
    pushminer?: PushminerApi;
  }
}

/** One world unit is ten centimetres: a coin two across is a big cartoon coin. */
const MM_PER_UNIT = 100;
const LIGHT_CAPACITY = 256;
const EFFECT_CAPACITY = 256;
/** The marks the tracks leave in the floor, the player's and the drones': pages of them, and how many a page. */
const TRACK_PAGES = 16,
  TRACK_PAGE = 1024;
/**
 * What drawing one frame may cost at load, CPU and GPU together, before the
 * coins step down a rung: half a 60 Hz frame, leaving the rest for the
 * physics and the browser. `?coins=0`…`3` skips the measuring and picks one.
 */
const RENDER_BUDGET_MS = 8;
/** How many places near the eye are tried each frame for something drifting in a biome's air. */
const AIR_TRIES = 4;
/** How many things a sealed room's going puffs over, at most. */
const SEAL_PUFFS = 160;
/** How many of the game's events the test API keeps, before the oldest go. */
const EVENTS_KEPT = 500;

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
  // For finding which stage a fault seen on one machine is in, from that machine:
  // ?off=shadows,occlusion,post,effects,particles,points turns stages of the renderer
  // off, and ?day lights the cave from the sky, so it can be seen with the lamps off.
  const asked = new URLSearchParams(location.search);
  const off = new Set((asked.get('off') ?? '').split(',').filter(Boolean));
  if (off.size)
    renderer.economy = {
      ...renderer.economy,
      shadows: !off.has('shadows'),
      occlusion: !off.has('occlusion'),
      post: !off.has('post'),
      particles: !off.has('particles'),
      points: !off.has('points'),
      effects: off.has('effects') ? 0 : 1,
    };
  if (asked.has('day')) renderer.look = { ...renderer.look, ambient: 1, sunColour: [1, 0.97, 0.92] };
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

  // ---- the game, and what it says has happened ----

  const economy = new Economy();
  const save = economy.save;
  const input = new Input();
  const sound = new Sound();
  /** What has happened, a line each, for the test API. */
  const eventLog: string[] = [];
  const log = (line: string) => {
    eventLog.push(line);
    if (eventLog.length > EVENTS_KEPT) eventLog.splice(0, eventLog.length - EVENTS_KEPT);
  };
  /** Blasts still lighting the cave, fading. */
  const blasts: { x: number; y: number; z: number; left: number }[] = [];
  /** How hard the last blast shook the ground, fading. */
  let blastShake = 0;
  const events: GameEvents = {
    banked(kind, value, x, y, heat) {
      if (kind > 0) sound.thunk(value);
      else sound.clink(game.tally.count);
      const colour: Rgb = kind === 0 ? [1.6, 1.2, 0.4] : (kindColour(kind).map((c) => c * 2) as Rgb);
      emit(fx.sparkle(x, y, colour, kind > 0, heat));
    },
    roomOpened(a) {
      log(`roomOpened ${a}`);
      sound.chime();
      hud.note(`${the(a)} is open: ${AREAS[a].blurb} · go on in when you are done here`, 5);
      gateCloud(a);
    },
    roomSealed(old, lost, where) {
      log(`roomSealed ${old} ${lost}`);
      sound.chime();
      // a puff where each thing left in the room was
      for (const [x, y, z] of where.slice(0, SEAL_PUFFS)) emit(fx.puff(x, y, z));
      if (old !== ORDER[0]) gateCloud(old);
      const gone = lost > 0 ? ` · ${lost} left behind` : '';
      hud.note(
        old === ORDER[0] ? `on into ${the(economy.current())}${gone}` : `${the(old)} is sealed behind you${gone}`,
        4,
      );
    },
    chamberOpened(k, faces, [c, s]) {
      log(`chamberOpened ${k}`);
      sound.chime();
      for (const [x, y] of faces) emit(fx.rockBurst(x, y, c, s));
      sound.smash();
      hud.note('a hidden chamber', 3);
    },
    wallHit(w, x, y, gone, left, [c, s]) {
      log(`wallHit ${w} ${gone.toFixed(2)}`);
      const { grade } = WALLS[w];
      sound.clunk();
      if (gone > 0.5) sound.crack();
      emit(fx.wallHit(x, y, c, s, gone, WALL_COLOUR[grade].slice(0, 3) as Rgb));
      hud.note(
        `${WALL_NAME[grade]} wall · ${Math.round(gone * 100)}% · ${left === 1 ? 'one more like that' : `about ${left} more like that`}`,
        2.5,
      );
    },
    wallDown(w, [c, s]) {
      log(`wallDown ${w}`);
      const { grade, treasure } = WALLS[w];
      sound.chime();
      const brick = WALL_COLOUR[grade].slice(0, 3) as Rgb;
      emit(wallTiles(w).map(([x, y]) => fx.wallDust(x, y, c, s, brick)));
      sound.smash();
      const behind = stashBehind(w);
      hud.note(
        `${WALL_NAME[grade]} wall down${treasure.length ? ' · something glints in the rubble' : behind ? ` · ${behind.name}` : ''}`,
        3,
      );
    },
    knock() {
      log('knock');
      sound.knock();
    },
    lampBroken(k, lit, [c, s]) {
      log(`lampBroken ${k}`);
      const l = game.cave.lamps[k];
      sound.shatter();
      emit(fx.glass(l.x, l.y, l.height, c, s, lit));
    },
    fuseLit(i) {
      log(`fuseLit ${i}`);
      sound.fuse(0);
      hud.note('the fuse is lit · get clear', 2);
    },
    blast(b) {
      log(`blast ${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.thrown}`);
      emit(fx.explosion(b.x, b.y, b.z));
      sound.boom();
      blasts.push({ x: b.x, y: b.y, z: b.z, left: 1 });
      const near = Math.max(0, 1 - Math.hypot(b.x - game.dozer.x, b.y - game.dozer.y) / 80);
      blastShake = Math.max(blastShake, near);
    },
    crack: () => sound.crack(),
    done() {
      log('done');
      sound.chime();
      hud.note(`the cave is cleared · ${the(game.last)}'s vein runs on`, 6);
    },
    bought(id) {
      log(`bought ${id}`);
      sound.chime();
      if (id === 'blade') scene.setBlade(economy.spec().bladeWidth);
      else if (id.startsWith('paint:')) scene.setPaint(economy.paint());
      else if (id.startsWith('body:')) standOn();
      else if (id === 'horn') pad?.showHorn(true);
    },
    staticChanged: () => buildStatic(),
    machinesMoved() {
      // the Spiderdozer leaves footprints where its feet land, not the tracks' marks
      if (save.body !== 'spider') tracks.update(game.dozer, game.dozer);
      for (const b of game.bots) tracks.update(b, b.dozer);
    },
  };
  const game = new Game(economy, events);
  const { cave, world, dozer, bots, stock, barrels, tally } = game;
  addEventListener('pagehide', () => game.persist());
  addEventListener('visibilitychange', () => {
    if (document.hidden) game.persist();
  });

  /** The rock at a gate, coming down or going up. */
  const gateCloud = (area: number) => emit(gateTiles(cave, area).map(([x, y]) => fx.gateCloud(x, y)));

  // ---- the scene ----

  const staticScene = new StaticScene(cave);
  const buildStatic = () => renderer.setStatic(staticScene.groups({ ...save, belts: game.running() }));
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
      const tile = game.nav.tileOf(x, y);
      return tile < 0 || world.solid[tile] ? null : floorHeight(x, y);
    },
  });
  const scene = new DynamicScene(renderer, {
    bodyCapacity: BODY_CAPACITY,
    kindCapacity: KIND_CAPACITY,
    bots: MAX_DRONES,
    botScale: BOT_SCALE,
    botBladeWidth: BOT_SPEC.bladeWidth,
    bladeWidth: economy.spec().bladeWidth,
    paint: economy.paint(),
    trackPages: tracks.matrices,
  });
  // the Spiderdozer's legs, walked from where the dozer is; a foot landing prints the floor
  const gait = new SpiderGait();
  gait.onStep = (_, x, y) => tracks.mark(x, y, dozer.yaw + Math.PI / 4, 0.55);
  /** The body the save says the machine stands on, drawn: the feet set down afresh, the tracks' run forgotten. */
  function standOn() {
    scene.setBody(save.body);
    gait.reset();
    tracks.forget(dozer);
  }
  standOn();
  let coinDetail = 0;
  const setCoinDetail = (level: number) => {
    coinDetail = Math.max(0, Math.min(COIN_LADDER.length - 1, level));
    scene.setCoinDetail(coinDetail);
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
  const lampColours = cave.lamps.map((l) => lampColour(l.x, l.y));
  function lightUp() {
    lights.build({
      t: game.t,
      view: cam,
      dozer,
      bots,
      lamps: cave.lamps,
      lampOn: (k) => lampOn(cave.lamps, k, save),
      lampColour: (k) => lampColours[k],
      features: staticScene.features,
      featureOn: (k) => save.areas[staticScene.features[k].area],
      fountains: game.fountains.map((f) => ({ x: f.x, y: f.y, glow: f.glow, warning: f.state === 'warn' })),
      vein: save.done ? AREAS[game.last].vein : null,
      sealing: game.warning ? sealPoint(cave, economy.next()!) : null,
      magnet: world.magnet,
      fuses: barrels.lit.map((i) => ({ x: world.x[i], y: world.y[i], z: world.z[i], flash: barrels.flashing(i) })),
      blasts,
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
      belts: game.running(),
      flag: save.flag,
      legs: save.body === 'spider' ? gait.poses() : null,
      tracks,
      barrel: (i) => (barrels.flashing(i) ? 'flash' : barrels.fuseLeft(i) !== null ? 'lit' : 'idle'),
      t: game.t,
    });
    tracks.clean();
  }

  // ---- how much coin this machine can draw ----

  /** What a frame of the scene as it stands costs, drawn to a texture of our own rather than the canvas, so no wait to be shown is counted. */
  async function measureFrame(): Promise<number> {
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
  }
  const forced = new URLSearchParams(location.search).get('coins');
  let calibration: number[] = [];
  if (forced !== null && Number.isFinite(+forced)) setCoinDetail(+forced);
  else {
    hud.booting('measuring this machine…');
    await renderer.ready;
    calibration = await calibrate(COIN_LADDER.length, RENDER_BUDGET_MS, setCoinDetail, measureFrame);
  }
  console.info(
    `coins: ${COIN_LADDER[coinDetail].name}`,
    calibration.length
      ? `(frame cost per rung, ms: ${calibration.map((ms) => ms.toFixed(1)).join(', ')}; budget ${RENDER_BUDGET_MS})`
      : '(chosen by ?coins=)',
  );

  // ---- the page round the cave ----

  hud.booted();
  hud.onReset(() => economy.reset());
  /** A phone's buttons, when there are any. */
  let pad: ReturnType<typeof setupPad> | null = null;
  if (touch) {
    const controls = new TouchControls(
      document.getElementById('trackLeft')!,
      document.getElementById('trackRight')!,
      document.getElementById('steer')!,
    );
    input.touch = controls;
    pad = setupPad(
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
  }

  /**
   * What drifts in the air of the biomes near the eye, in rooms open: snow, fireflies, embers, motes; and
   * now and then something off a feature in view.
   */
  function biomeAir() {
    const [cx, cy] = rig.follow;
    for (let n = 0; n < AIR_TRIES; n++) {
      const a = Math.random() * Math.PI * 2,
        out = Math.sqrt(Math.random()) * 50;
      const x = cx + Math.cos(a) * out,
        y = cy + Math.sin(a) * out;
      const { area, weight } = biomeAt(x, y);
      if (!weight || !save.areas[area] || Math.random() > weight) continue;
      const e = airParticle(area, x, y, Math.random);
      if (e) renderer.emit(e);
    }
    const lit = lights.featuresLit;
    if (lit.length && Math.random() < 0.3) {
      const e = featureParticle(staticScene.features[lit[Math.floor(Math.random() * lit.length)]]);
      if (e) renderer.emit(e);
    }
  }

  /** The lit barrels in the bright half of a flash last frame, for a beep and a spit of sparks as each flash starts. */
  const flashed = new Set<number>();
  function fuses(dt: number) {
    for (const i of barrels.lit) {
      const flash = barrels.flashing(i);
      if (flash && !flashed.has(i)) {
        sound.fuse(1 - Math.max(0, Math.min(1, (barrels.fuseLeft(i) ?? 0) / FUSE)));
        renderer.emit(fx.fuseSparks(world.x[i], world.y[i], world.z[i]));
      }
      if (flash) flashed.add(i);
      else flashed.delete(i);
    }
    for (const i of [...flashed]) if (barrels.fuseLeft(i) === null) flashed.delete(i);
    for (let k = blasts.length - 1; k >= 0; k--) if ((blasts[k].left -= dt * 1.2) <= 0) blasts.splice(k, 1);
    blastShake = Math.max(0, blastShake - dt * 1.5);
  }

  let shopOpen = false;
  const renderShops = () => {
    renderShop(hud.shopRows, economy);
    renderShop(hud.shopCosmetics, economy, economy.cosmetics());
  };
  let smoothed = 16.7;
  let statsIn = 0,
    shopIn = 0,
    aimAt = 0;
  let lastBank = -1,
    lastRoom = -1;
  let gate: { x: number; y: number; label: string } | null = null;
  let frames = 0;

  /** A frame of the game, and of everything round it but the picture. */
  function simulate(dt: number) {
    frames++;
    // the keys
    if (input.takeShop()) {
      shopOpen = !shopOpen;
      hud.shop(shopOpen);
      if (shopOpen) renderShops();
    }
    const horn = input.takeHorn() && save.horn;
    if (horn) sound.horn();
    if (input.takeRecentre()) rig.recentre();
    if (input.takeCamera()) hud.note(`camera: ${rig.cycle()}`);
    if (input.takeMute()) {
      // the toggle first, on its own: written as pad?.showMute(sound.toggleMute()) it never ran
      // without a pad, since an optional call skips its arguments too
      const muted = sound.toggleMute();
      pad?.showMute(muted);
    }

    const drive = input.read();
    game.step(dt, drive, { horn });
    if (save.body === 'spider') gait.update(dt, dozer);

    // what goes with it: the fuses beeping, the cracking floors' dust, the air, the rumble and the engine
    fuses(dt);
    let shaking = 0;
    for (const f of game.fountains) {
      if (f.state === 'idle') continue;
      const near = Math.max(0, 1 - Math.hypot(f.x - rig.follow[0], f.y - rig.follow[1]) / 90);
      shaking = Math.max(shaking, f.glow * near * (f.state === 'spray' ? 1 : 0.5));
      if (Math.random() < (f.state === 'spray' ? 0.9 : 0.35)) emit(fx.fountainDust(f.x, f.y, f.state === 'spray'));
    }
    sound.shake(Math.max(shaking, blastShake));
    biomeAir();
    sound.drive(drive.throttle, dozer.speed, world.load);

    // the counters
    if (tally.tick(dt)) {
      // the run is over: the tally fades, and the next coin starts a new one
      hud.run(tally.summary());
      tally.reset();
    }
    if (economy.bank !== lastBank || economy.current() !== lastRoom) {
      if (economy.bank !== lastBank) hud.run(tally.summary());
      lastBank = economy.bank;
      lastRoom = economy.current();
      hud.bank(economy.bank);
      hud.progress(progressText(economy, stock.banked(economy.current())));
    }
    if (game.warning) {
      const room = economy.current(),
        still = stock.lying(room);
      hud.note(`further in seals ${the(room)}${still > 0 ? ` · ${still} still in it` : ''}`, 0.4);
    }
    // the arrow to the next room's gate, while it is open
    if (game.t >= aimAt) {
      aimAt = game.t + 0.4;
      const next = economy.next();
      const at = next !== null && !save.done && economy.nextOpen() ? gateCentre(cave, next) : null;
      gate = at && next !== null ? { x: at[0], y: at[1], label: AREAS[next].name } : null;
    }
    hud.tick(dt);
    smoothed += (dt * 1000 - smoothed) * 0.08;
    if ((statsIn -= dt) <= 0) {
      statsIn = 0.25;
      hud.stats({ ms: smoothed, live: world.live, awake, load: world.load, coins: COIN_LADDER[coinDetail].name });
    }
    if (shopOpen && (shopIn -= dt) <= 0) {
      shopIn = 0.3;
      renderShops();
    }
  }

  /** The picture of the frame: the camera after the dozer, the lights, everything where it is, drawn. */
  function draw(dt: number) {
    rig.update(dt, performance.now() / 1000, dozer);
    const reach = orbit.distance * 1.1 + 20;
    renderer.setSunShadow({
      min: [rig.follow[0] - reach, rig.follow[1] - reach, -16],
      max: [rig.follow[0] + reach, rig.follow[1] + reach, 14],
    });
    lightUp();
    upload();
    renderer.frame(ctx.context.getCurrentTexture().createView(), 'redraw', dt);
    hud.showPointer(
      gate && placePointer(cam.viewProjection, gate, dozer, innerWidth, innerHeight, touch, game.t),
      gate?.label ?? '',
    );
  }

  // ---- the test API, and the frame loop ----

  // ?paused=1 starts the game stopped where it was built, so a test sees the
  // same cave every run: no frame of its own has run, and every one after is
  // the test's, of a length it chose
  let paused = new URLSearchParams(location.search).has('paused');
  let ready = false;
  window.pushminer = createApi({
    game,
    cave,
    ready: () => ready,
    paused: () => paused,
    setPaused: (p) => {
      paused = p;
    },
    simulate,
    draw,
    frame: () => frames,
    setDrive: (d) => {
      input.override = d;
    },
    look(x, y, view) {
      orbit.setSpherical(view);
      cam.target = [x, y, 1.5];
      rig.follow[0] = x;
      rig.follow[1] = y;
      for (let i = 0; i < 400; i++) orbit.update();
    },
    measureFrame,
    calibration: () => calibration,
    setCoinDetail,
    lampsLit: () => lights.lampsLit,
    trackMarks: () => tracks.size,
    muted: () => sound.muted,
    events: eventLog,
  });

  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    if (paused) {
      draw(0);
      return;
    }
    simulate(dt);
    draw(dt);
  };
  ready = true;
  requestAnimationFrame(frame);
}
