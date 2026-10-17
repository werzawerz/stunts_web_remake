import * as THREE from 'three';
import { KeyboardInput } from './core/input';
import { CARS, createCar, DT, INPUT, speedOf, stepCar, type CarSpec, type CarState } from './physics/car';
import { CollisionWorld } from './physics/collision';
import { quatRotate, type Quat, type Vec3 } from './physics/vec';
import { loadOriginalCarModels, type CarModel } from './original/carModels';
import { loadCockpit } from './original/cockpit';
import { createCarMesh, createCarMeshFromModel, setObjectPose } from './render/carMesh';
import { FlyCamera } from './render/flyCamera';
import { createHorizon, type HorizonView } from './render/horizon';
import { buildSampleTrack } from './track/sampleTrack';
import { fetchOriginal } from './original/files';
import type { Shape } from './original/formats';
import { loadTrackShapes } from './original/trackShapes';
import { parseTrk, type Track } from './track/trkFormat';
import { findStart } from './track/start';
import { buildTrack } from './track/trackBuilder';
import { Horizon } from './track/trkFormat';
import { Dashboard, SCREEN_H, SCREEN_W, type HudState } from './ui/dashboard';
import { formatRaceTime, loadName, saveName, typingInForm } from './ui/results';
import { crackLines } from './ui/crash';
import { buttonRects, type EvalRow, type EvaluationData } from './ui/evaluation';
import { bodyColour, Debris } from './render/debris';
import { MainMenu, type MenuAction } from './ui/menu';
import { loadPictures } from './original/screens';
import { Showroom, type ShowroomCar } from './ui/showroom';
import { loadCarDescription } from './original/carInfo';
import { TrackSelect, type BestTime } from './ui/trackSelect';
import { TILE } from './track/constants';
import { createLap, lapTotal, stepLap, type LapState } from './race/lap';
import { buildRoute, type Route } from './race/route';
import { getLeaderboard, submitLapTime } from './net/supabase';
import { CarSound } from './audio/sound';

// ---- screen: the 3D view renders at 320x200 like VGA mode 13h and is scaled up with crisp pixels.
const frame = document.createElement('div');
frame.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#000';
document.body.appendChild(frame);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
frame.appendChild(renderer.domElement);
const dash = new Dashboard();
dash.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
frame.appendChild(dash.canvas);

// P cycles the resolution: native and smooth (default), 640x400 or 320x200 like the original.
const RES_MODES = [0, 2, 1] as const; // 0 = native (smooth); otherwise multiples of 320x200 (retro)
let resMode = Number(new URLSearchParams(location.search).get('res') ?? 0);
function layout(): void {
  const scale = Math.min(window.innerWidth / SCREEN_W, window.innerHeight / SCREEN_H);
  const w = Math.floor(SCREEN_W * scale);
  const h = Math.floor(SCREEN_H * scale);
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(resMode === 0 ? dpr : 1);
  renderer.setSize(resMode === 0 ? w : SCREEN_W * resMode, resMode === 0 ? h : SCREEN_H * resMode, false);
  // Retro modes keep crisp big pixels; native mode draws everything smooth at full resolution.
  const pixelated = resMode === 0 ? 'auto' : 'pixelated';
  renderer.domElement.style.imageRendering = pixelated;
  dash.canvas.style.imageRendering = pixelated;
  dash.setScale(resMode === 0 ? scale * dpr : 1);
}
layout();
window.addEventListener('resize', layout);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56, SCREEN_W / SCREEN_H, 0.3, 6000);

const fly = new FlyCamera(camera, dash.canvas);
const input = new KeyboardInput();
// Car choice (V cycles). Each car gets its own paint, like the original's selection screen.
const PAINT = [0xd81c1c, 0xe8e8e8, 0xfcd820, 0xc81010, 0x205c30, 0x1c3cc8, 0xa89c74, 0xf0f0f0, 0x6c1c8c, 0x2c2c2c, 0xfc7c1c];
const vehicleParam = new URLSearchParams(location.search).get('vehicle');
// The Porsche/March Indy by default.
let carIndex = Math.max(0, CARS.findIndex((c) => c.id === (vehicleParam ?? 'indy')));
let spec: CarSpec = CARS[carIndex]!;
/** Paint job and gearbox chosen in the showroom. */
let carPaint = 0;
let manualGearbox = false;
// Original car models and names, when the player's own Stunts files are available (dev: original_game/).
let originalModels: Record<string, CarModel> = {};
const buildCarObject = (): THREE.Group => {
  const model = originalModels[spec.id];
  return model ? createCarMeshFromModel(model, spec, carPaint) : createCarMesh(spec, PAINT[carIndex % PAINT.length]);
};
const carName = (): string => originalModels[spec.id]?.name ?? spec.name;
let carObject = buildCarObject();
scene.add(carObject);
let flashText = '';
let flashUntil = 0;
function flash(text: string): void {
  flashText = text;
  flashUntil = performance.now() + 4000;
}

/** Show the selected car's original cockpit once (and if) its files have loaded. */
function updateCockpit(): void {
  const id = spec.id;
  dash.original = null;
  void loadCockpit(id).then((k) => {
    if (spec.id === id) dash.original = k;
  });
}
updateCockpit();

function replaceCarObject(): void {
  scene.remove(carObject);
  carObject.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  carObject = buildCarObject();
  scene.add(carObject);
}

void loadOriginalCarModels().then((models) => {
  originalModels = models;
  if (Object.keys(models).length > 0) {
    console.info(`[stunts] using ${Object.keys(models).length} original car models`);
    replaceCarObject();
    flash(`${carName().toUpperCase()}  (V: NEXT CAR)`);
  }
});

function selectCar(i: number): void {
  carIndex = (i + CARS.length) % CARS.length;
  spec = CARS[carIndex]!;
  replaceCarObject();
  updateCockpit();
  flash(`${carName().toUpperCase()}  (V: NEXT CAR)`);
  resetCar();
}

// ---- scene state ---------------------------------------------------------------------------
let trackGroup: THREE.Group | null = null;
let horizonView: HorizonView | null = null;
let world: CollisionWorld;
let car: CarState;
const sound = new CarSound();
let prevPos: Vec3 = [0, 0, 0];
let prevQuat: Quat = [1, 0, 0, 0];
type View = HudState['view'];
let view: View = 'cockpit';
const camPos = new THREE.Vector3();
let camInit = false;
let startPose: { pos: Vec3; heading: 'N' | 'E' | 'S' | 'W' } = { pos: [0, 0, 1], heading: 'N' };
// ---- race: route, lap clock, penalties, results ---------------------------------------------
// Tracks: our demo circuit plus the six originals, read from the player's own Stunts files.
interface TrackEntry {
  id: string;
  name: string;
  load: () => Promise<Track | null>;
}
const TRACKS: TrackEntry[] = [
  { id: 'default', name: 'Demo circuit', load: async () => buildSampleTrack() },
  ...['DEFAULT', 'BERNIES', 'CHERRIS', 'HELENS', 'JOES', 'SKIDS'].map((n) => ({
    id: `orig-${n.toLowerCase()}`,
    name: n[0] + n.slice(1).toLowerCase(),
    load: async () => {
      const bytes = await fetchOriginal(`${n}.TRK`);
      return bytes ? parseTrk(bytes) : null;
    },
  })),
];
let trackIndex = 0;
let trackId = 'default';
let currentTrack: Track = buildSampleTrack();
// Original track piece shapes, when the player's Stunts files are available.
let trackShapes: Map<string, Shape> | null = null;
let route: Route | null = null;
let lap: LapState = createLap();
/** Input bitmask of every tick since the clock started: enough to replay or verify the lap. */
let inputLog: number[] = [];

// ---- crash sequence, as in the original: cracked windscreen / explosion, "Please Wait...", then
// the evaluation screen with the track's fastest times and the run's figures.
const MPH = 2.23694;
/** This run's figures for the evaluation screen. */
let runStats = { top: 0, distance: 0, seconds: 0 };
let crash: {
  at: number;
  seed: number;
  cracks: [number, number][][];
  debris: Debris;
  impact: number;
  rows: EvalRow[] | null;
} | null = null;
let evalSelected = 1;
const EVAL_BUTTONS = [
  { label: ['View', 'Replay'], enabled: false }, // no replays yet
  { label: ['Drive'], enabled: true },
  { label: ['Main', 'Menu'], enabled: true },
];
const PLEASE_WAIT_AT = 3.0;
const EVALUATION_AT = 3.8;
/** After the finish line the car rolls on a little before the evaluation screen. */
const FINISH_WAIT_AT = 1.8;
const FINISH_EVAL_AT = 2.6;
let finish: {
  at: number;
  timeSec: number;
  penaltySec: number;
  rows: EvalRow[] | null;
  /** Name entry for the online fastest times; null once saved or skipped. */
  prompt: { text: string; status: string; busy: boolean } | null;
  submit: (name: string) => Promise<void>;
} | null = null;

function fetchRows(set: (rows: EvalRow[]) => void): void {
  getLeaderboard(trackId)
    .then((rows) => set((rows ?? []).map((r) => ({ name: r.player_name, car: r.car, time: formatRaceTime(r.time_ms / 1000) }))))
    .catch(() => set([]));
}

function onCrash(impactSpeed: number, vel: Vec3): void {
  const seed = (car.ticks * 2654435761) >>> 0;
  const debris = new Debris(bodyColour(carObject), car.pos, vel, seed);
  scene.add(debris.group);
  crash = { at: performance.now(), seed, cracks: crackLines(seed, SCREEN_W, SCREEN_H), debris, impact: impactSpeed, rows: null };
  evalSelected = 1;
  const c = crash;
  fetchRows((rows) => (c.rows = rows));
}

function clearCrash(): void {
  if (!crash) return;
  scene.remove(crash.debris.group);
  crash.debris.dispose();
  crash = null;
}

const crashSeconds = (): number => (crash ? (performance.now() - crash.at) / 1000 : 0);
const finishSeconds = (): number => (finish ? (performance.now() - finish.at) / 1000 : 0);
const evaluationShown = (): boolean =>
  (crash !== null && crashSeconds() >= EVALUATION_AT) || (finish !== null && finishSeconds() >= FINISH_EVAL_AT);
const naming = (): boolean => evaluationShown() && finish?.prompt != null;

function evaluationData(): EvaluationData | null {
  if (!evaluationShown()) return null;
  const entry = TRACKS[trackIndex]!;
  const common = {
    trackName: entry.id.startsWith('orig-') ? entry.id.slice(5) : entry.name,
    averageMph: runStats.seconds > 0 ? (runStats.distance / runStats.seconds) * MPH : 0,
    topMph: runStats.top * MPH,
    buttons: EVAL_BUTTONS,
    selected: evalSelected,
  };
  if (finish) {
    const p = finish.prompt;
    return {
      ...common,
      rows: finish.rows,
      elapsed: formatRaceTime(finish.timeSec + finish.penaltySec),
      penaltySec: finish.penaltySec,
      impactMph: null,
      prompt: p ? { title: 'Enter your name:', text: p.text, status: p.status || 'Enter: save   Esc: skip' } : null,
    };
  }
  return { ...common, rows: crash!.rows, elapsed: 'DNF', impactMph: crash!.impact * MPH };
}

/** Typing the name for the fastest times: letters, Backspace, Enter saves, Escape skips. */
function nameKey(e: KeyboardEvent): void {
  const f = finish!;
  const p = f.prompt!;
  if (p.busy) return;
  if (e.key === 'Escape') f.prompt = null;
  else if (e.key === 'Backspace') p.text = p.text.slice(0, -1);
  else if (e.key === 'Enter') {
    const name = p.text.trim();
    if (!name) return;
    saveName(name);
    p.busy = true;
    p.status = 'Saving...';
    f.submit(name)
      .then(() => {
        f.prompt = null;
        fetchRows((rows) => (f.rows = rows));
      })
      .catch((err: unknown) => {
        p.busy = false;
        p.status = `Could not save: ${err instanceof Error ? err.message : String(err)}`.slice(0, 40);
      });
  } else if (e.key.length === 1 && p.text.length < 20) p.text += e.key;
}

function evalActivate(i: number): void {
  if (i === 1) resetCar(); // Drive
  if (i === 2) {
    resetCar();
    menu.open();
  }
}

// ---- main menu (the original's road with five signs) ------------------------------------------
const menu = new MainMenu({
  cars: () => CARS.map((c) => originalModels[c.id]?.name ?? c.name),
  carIndex: () => carIndex,
  tracks: () => TRACKS.map((t) => t.name),
  trackIndex: () => trackIndex,
  soundOn: () => !sound.muted,
});
void loadPictures('SDMSEL.PVS').then((p) => (menu.picture = p?.get('scrn') ?? null));

// ---- car selection (the original's showroom) ---------------------------------------------------
const FLAT = new CollisionWorld([-3000, -3000, 0.01, 3000, -3000, 0.01, 3000, 3000, 0.01, -3000, -3000, 0.01, 3000, 3000, 0.01, -3000, 3000, 0.01], [0, 0]);
const curves = new Map<string, number[]>();
/** Speed every half second from a standing start, flat out on a flat road, for 40 s (mph). */
function accelerationCurve(s: CarSpec): number[] {
  let out = curves.get(s.id);
  if (!out) {
    out = [];
    const c = createCar(s, [0, 0, 0.61], 'N');
    for (let t = 0; t <= 60 * 40; t++) {
      if (t % 30 === 0) out.push(speedOf(c) * MPH);
      stepCar(c, s, INPUT.Throttle, FLAT);
    }
    curves.set(s.id, out);
  }
  return out;
}
const descriptions = new Map<string, string[] | null>();
function showroomCar(i: number): ShowroomCar {
  const s = CARS[i]!;
  const model = originalModels[s.id];
  if (!descriptions.has(s.id)) {
    descriptions.set(s.id, null);
    void loadCarDescription(s.id).then((d) => descriptions.set(s.id, d));
  }
  const curve = accelerationCurve(s);
  const name = model?.name ?? s.name;
  return {
    name,
    description: descriptions.get(s.id) ?? [name, '', `Top Speed ${Math.round(Math.max(...curve))} MPH`],
    paints: model?.paints ?? 1,
    curveMph: curve,
  };
}
const showroom = new Showroom({
  count: CARS.length,
  info: showroomCar,
  buildCar: (i, paint) => {
    const s = CARS[i]!;
    const model = originalModels[s.id];
    return model ? createCarMeshFromModel(model, s, paint) : createCarMesh(s, PAINT[i % PAINT.length]);
  },
});
void loadPictures('SDGAME2.PVS').then((p) => {
  dash.explosion = ['ex01', 'ex02', 'ex03'].map((n) => p?.get(n)).filter((s) => s !== undefined);
});
void loadPictures('SDCSEL.PVS').then((p) => showroom.setPictures(p?.get('stop') ?? null, p?.get('grap') ?? null));

// ---- track selection (the original's overview of the track) ------------------------------------
const bestTimes = new Map<string, BestTime | null>();
function bestTime(): BestTime | null | undefined {
  const id = trackId;
  if (!bestTimes.has(id)) {
    bestTimes.set(id, null);
    getLeaderboard(id, 1)
      .then((rows) => {
        const r = rows?.[0];
        bestTimes.set(id, r ? { name: r.player_name, car: r.car, time: formatRaceTime(r.time_ms / 1000) } : null);
      })
      .catch(() => bestTimes.set(id, null));
  }
  return bestTimes.get(id);
}
const trackSelect = new TrackSelect({
  trackName: () => {
    const e = TRACKS[trackIndex]!;
    return e.id.startsWith('orig-') ? e.id.slice(5) : e.name;
  },
  best: bestTime,
  tracks: () => TRACKS.map((t) => t.name),
  trackIndex: () => trackIndex,
});

/** Camera over the track, looking at it from the south at an angle, like the original's view. */
function overviewCamera(): void {
  let x0 = 30, x1 = -1, z0 = 30, z1 = -1;
  for (let x = 0; x < 30; x++)
    for (let z = 0; z < 30; z++)
      if (currentTrack.elements[x]?.[z]) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
  if (x1 < 0) [x0, x1, z0, z1] = [0, 29, 0, 29];
  const ce = ((x0 + x1 + 1) / 2) * TILE;
  const cn = ((z0 + z1 + 1) / 2) * TILE;
  const ext = Math.max(x1 - x0 + 1, (z1 - z0 + 1) * 1.3) * TILE;
  camera.up.set(0, 1, 0);
  camera.position.set(ce, ext * 0.36, -(cn - ext * 0.72));
  camera.lookAt(ce, 0, -(cn + ext * 0.1));
}

function trackSelectAction(a: ReturnType<TrackSelect['key']>): void {
  if (a.type === 'menu') {
    trackSelect.close();
    camInit = false;
  } else if (a.type === 'pick') void selectTrack(a.index, 1, true);
}

function showroomDone(): void {
  manualGearbox = showroom.manual;
  carPaint = showroom.paint;
  showroom.close();
  selectCar(showroom.index);
}

function menuAction(a: MenuAction): void {
  if (a.type === 'showroom') showroom.open(carIndex, carPaint, manualGearbox);
  else if (a.type === 'trackselect') trackSelect.open();
  else if (a.type === 'drive') {
    menu.close();
    resetCar();
  } else if (a.type === 'car') selectCar(a.index);
  else if (a.type === 'track') void selectTrack(a.index, 1, true);
  else if (a.type === 'sound') sound.setMuted(!a.on);
  else if (a.type === 'pixels') {
    resMode = RES_MODES[(RES_MODES.indexOf(resMode as 2 | 1 | 0) + 1) % RES_MODES.length]!;
    layout();
  }
}

// Mouse: click a button on the evaluation screen.
dash.canvas.addEventListener('click', (e) => {
  const r = dash.canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * SCREEN_W;
  const y = ((e.clientY - r.top) / r.height) * SCREEN_H;
  if (showroom.visible) {
    sound.start();
    if (showroom.click(x, y).type === 'done') showroomDone();
    return;
  }
  if (trackSelect.visible) {
    sound.start();
    trackSelectAction(trackSelect.click(x, y));
    return;
  }
  if (menu.visible) {
    sound.start();
    menuAction(menu.click(x, y));
    return;
  }
  if (!evaluationShown()) return;
  buttonRects(EVAL_BUTTONS.length).forEach(([bx, by, bw, bh], i) => {
    if (EVAL_BUTTONS[i]!.enabled && x >= bx && x < bx + bw && y >= by && y < by + bh) {
      evalSelected = i;
      evalActivate(i);
    }
  });
});

function resetCar(): void {
  car = createCar(spec, startPose.pos, startPose.heading, 0, manualGearbox);
  prevPos = [...car.pos];
  prevQuat = [...car.quat];
  camInit = false;
  lap = createLap();
  inputLog = [];
  runStats = { top: 0, distance: 0, seconds: 0 };
  clearCrash();
  finish = null;
}

/** Over the line: roll out, "Please Wait...", then the evaluation screen with the name entry. */
function onFinish(): void {
  const finished = lap;
  const log = Uint8Array.from(inputLog);
  const carLabel = carName().slice(0, 30);
  const f: NonNullable<typeof finish> = {
    at: performance.now(),
    timeSec: finished.ticks / 60,
    penaltySec: finished.penaltySec,
    rows: null,
    prompt: { text: loadName(), status: '', busy: false },
    submit: async (name) => {
      let bin = '';
      for (const b of log) bin += String.fromCharCode(b);
      await submitLapTime({
        trackId: trackId,
        playerName: name.slice(0, 20),
        car: carLabel,
        timeMs: Math.round(lapTotal(finished) * 1000),
        inputLogBase64: btoa(bin),
      });
    },
  };
  finish = f;
  evalSelected = 1;
  fetchRows((rows) => (f.rows = rows));
}

function loadScene(track: Track): void {
  if (trackGroup) {
    scene.remove(trackGroup);
    trackGroup.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  if (horizonView) {
    scene.remove(horizonView.group);
    horizonView.dispose();
  }
  const built = buildTrack(track, trackShapes);
  trackGroup = built.group;
  world = built.world;
  scene.add(trackGroup);

  const start = findStart(track);
  route = start ? buildRoute(built.pieces, start.dir) : null;
  if (start) {
    const f = ({ N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] } as const)[start.dir];
    // Start a little behind the line so the player drives through it.
    const e = start.centre[0] - f[0] * 12;
    const n = start.centre[1] - f[1] * 12;
    // Drop the car onto whatever the start line stands on (it can be on a hill).
    const hit = world.raycast([e, n, 300], [0, 0, -1], 400);
    startPose = { pos: [e, n, (hit ? 300 - hit.t : 0) + 1], heading: start.dir };
  }
  horizonView = createHorizon(track.horizon);
  scene.add(horizonView.group);
  renderer.setClearColor(horizonView.fogColor);
  resetCar();
  spawnFromParam();
}

/** Debug: ?car=e,n,u,H,speed places the car (again after every track load). */
function spawnFromParam(): void {
  const p = new URLSearchParams(location.search).get('car');
  if (!p) return;
  const [e, n, u, hd, v] = p.split(',');
  car = createCar(spec, [Number(e), Number(n), Number(u)], hd as 'N' | 'E' | 'S' | 'W', Number(v ?? 0), manualGearbox);
  prevPos = [...car.pos];
  prevQuat = [...car.quat];
}

// ---- keys -----------------------------------------------------------------------------------
const VIEWS: View[] = ['cockpit', 'chase', 'free'];

/** Switch to track i (skipping tracks whose files aren't available, stepping by `step`). */
async function selectTrack(i: number, step = 1, quiet = false): Promise<void> {
  for (let k = 0; k < TRACKS.length; k++) {
    const idx = (((i + k * step) % TRACKS.length) + TRACKS.length) % TRACKS.length;
    const entry = TRACKS[idx]!;
    const track = await entry.load();
    if (!track) continue;
    trackIndex = idx;
    trackId = entry.id;
    currentTrack = track;
    loadScene(track);
    if (!quiet) flash(`${entry.name.toUpperCase()}  (T: NEXT TRACK)`);
    return;
  }
}
window.addEventListener('keydown', (e) => {
  // Browsers only allow sound after a user gesture: the first key press turns it on.
  sound.start();
  if (naming()) {
    nameKey(e);
    e.preventDefault();
    return;
  }
  if (typingInForm(e)) {
    if (e.code === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  if (showroom.visible) {
    if (showroom.key(e.code).type === 'done') showroomDone();
    e.preventDefault();
    return;
  }
  if (trackSelect.visible) {
    trackSelectAction(trackSelect.key(e.code));
    e.preventDefault();
    return;
  }
  if (menu.visible) {
    menuAction(menu.key(e.code));
    e.preventDefault();
    return;
  }
  if (e.code === 'Escape') {
    menu.open();
    return;
  }
  if (evaluationShown() && ['ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'NumpadEnter'].includes(e.code)) {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const step = e.code === 'ArrowLeft' ? -1 : 1;
      for (let k = 1; k < EVAL_BUTTONS.length; k++) {
        const i = (evalSelected + step * k + EVAL_BUTTONS.length) % EVAL_BUTTONS.length;
        if (EVAL_BUTTONS[i]!.enabled) {
          evalSelected = i;
          break;
        }
      }
    } else evalActivate(evalSelected);
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyM') {
    sound.setMuted(!sound.muted);
    flash(sound.muted ? 'SOUND OFF  (M)' : 'SOUND ON  (M)');
  } else if (e.code === 'KeyC') {
    view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]!;
    if (view === 'free') {
      const d = camera.getWorldDirection(new THREE.Vector3());
      fly.yaw = Math.atan2(-d.x, -d.z);
      fly.pitch = -0.3;
    }
    camInit = false;
  } else if (e.code === 'KeyV') {
    selectCar(carIndex + (e.shiftKey ? -1 : 1));
  } else if (e.code === 'KeyT') {
    void selectTrack(trackIndex + (e.shiftKey ? -1 : 1), e.shiftKey ? -1 : 1);
  } else if (e.code === 'KeyH') {
    currentTrack.horizon = ((currentTrack.horizon + 1) % 5) as Horizon;
    loadScene(currentTrack);
  } else if (e.code === 'KeyP') {
    resMode = RES_MODES[(RES_MODES.indexOf(resMode as 2 | 1 | 0) + 1) % RES_MODES.length]!;
    layout();
  }
});

// ---- debug params ---------------------------------------------------------------------------
// ?cam=x,y,z,yawDeg,pitchDeg  free camera pose (render space) · ?car=e,n,u,H,speed  spawn the car
// ?view=chase|cockpit|free    initial view · ?res=0|2|1  native, 640x400 or 320x200
const params = new URLSearchParams(location.search);
loadScene(currentTrack);
void loadTrackShapes().then((shapes) => {
  if (!shapes) return;
  console.info(`[stunts] using ${shapes.size} original track shapes`);
  trackShapes = shapes;
  loadScene(currentTrack);
});
// The original Default track by default (falls back to the demo circuit without the game files).
const trackParam = params.get('track') ?? 'orig-default';
{
  const i = TRACKS.findIndex((t) => t.id === trackParam);
  if (i > 0) void selectTrack(i, 1, true);
}
// The game opens on the main menu, like the original (debug views and ?menu=0 go straight in).
if (!['cam', 'car', 'view'].some((k) => params.has(k)) && params.get('menu') !== '0') menu.open();
const viewParam = params.get('view');
if (viewParam === 'chase' || viewParam === 'cockpit' || viewParam === 'free') view = viewParam;
const camParam = params.get('cam');
if (camParam) {
  const [x, y, z, yaw, pitch] = camParam.split(',').map(Number) as [number, number, number, number, number];
  camera.position.set(x, y, z);
  fly.yaw = (yaw * Math.PI) / 180;
  fly.pitch = (pitch * Math.PI) / 180;
  view = 'free';
}

// ---- main loop: fixed 60 Hz simulation, interpolated rendering -----------------------------
let last = performance.now();
let acc = 0;
const toThree = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v[0], v[2], -v[1]);

renderer.setAnimationLoop((now) => {
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (showroom.visible) {
    acc = 0;
    sound.update({ rpm: car.rpm, skidding: false, crashed: false, silent: true });
    showroom.update(frameDt);
    showroom.render(renderer);
    dash.drawScreen((c) => showroom.drawPanel(c, now));
    return;
  }
  if (trackSelect.visible) {
    acc = 0;
    sound.update({ rpm: car.rpm, skidding: false, crashed: false, silent: true });
    carObject.visible = false;
    overviewCamera();
    horizonView?.follow(camera);
    renderer.render(scene, camera);
    dash.drawScreen((c) => trackSelect.draw(c, now));
    return;
  }
  if (menu.visible) {
    // The race waits behind the menu.
    acc = 0;
    sound.update({ rpm: car.rpm, skidding: false, crashed: false, silent: true });
    dash.drawScreen((c) => menu.draw(c));
    return;
  }
  acc += frameDt;
  while (acc >= DT) {
    const raw = input.mask();
    if (raw & INPUT.Reset && !naming()) resetCar(); // R types a letter in the name box
    // After the finish the car just rolls out.
    const mask = lap.phase === 'finished' ? 0 : raw;
    prevPos = [...car.pos];
    prevQuat = [...car.quat];
    const wasGrounded = car.grounded;
    const fallSpeed = -car.vel[2];
    const wasCrashed = car.crashed;
    const speedBefore = speedOf(car);
    const velBefore: Vec3 = [...car.vel];
    stepCar(car, spec, mask, world);
    if (!wasCrashed && car.crashed && !finish) onCrash(speedBefore, velBefore);
    if (lap.phase === 'running' && !car.crashed) {
      const v = speedOf(car);
      runStats.top = Math.max(runStats.top, v);
      runStats.distance += v * DT;
      runStats.seconds += DT;
    }
    // Thud on landing hard (but not for the little hops over bumps).
    if (!wasGrounded && car.grounded && !car.crashed && fallSpeed > 6) sound.bump((fallSpeed - 6) / 14);
    if (route) {
      const wasRunning = lap.phase === 'running';
      const moving = (mask & INPUT.Throttle) !== 0 || speedOf(car) > 0.5;
      stepLap(lap, route, car.pos, car.vel, moving, car.crashed);
      if (lap.phase === 'running') inputLog.push(mask);
      if (wasRunning && lap.phase === 'finished') onFinish();
    }
    acc -= DT;
  }

  // Interpolate between the last two ticks.
  const a = acc / DT;
  const pos: Vec3 = [
    prevPos[0] + (car.pos[0] - prevPos[0]) * a,
    prevPos[1] + (car.pos[1] - prevPos[1]) * a,
    prevPos[2] + (car.pos[2] - prevPos[2]) * a,
  ];
  const dq = prevQuat[0] * car.quat[0] + prevQuat[1] * car.quat[1] + prevQuat[2] * car.quat[2] + prevQuat[3] * car.quat[3];
  const sgn = dq < 0 ? -1 : 1;
  const qi: Quat = [0, 0, 0, 0];
  let len = 0;
  for (let i = 0; i < 4; i++) {
    qi[i] = prevQuat[i]! + (sgn * car.quat[i]! - prevQuat[i]!) * a;
    len += qi[i]! * qi[i]!;
  }
  len = Math.sqrt(len);
  for (let i = 0; i < 4; i++) qi[i] = qi[i]! / len;
  setObjectPose(carObject, pos, qi);
  // An exploded car is gone: only its debris and the fireball remain.
  carObject.visible = view !== 'cockpit' && !crash;
  if (crash) {
    crash.debris.update(frameDt);
    crash.debris.group.visible = view !== 'cockpit'; // in the car you only see the cracked windscreen
  }

  const fwd = quatRotate(qi, [0, 1, 0]);
  const up = quatRotate(qi, [0, 0, 1]);
  if (view === 'cockpit') {
    // Driver's eye, looking slightly down so the horizon sits above the dashboard like the original.
    const eye = toThree([pos[0] + up[0] * 0.8 - fwd[0] * 0.3, pos[1] + up[1] * 0.8 - fwd[1] * 0.3, pos[2] + up[2] * 0.8 - fwd[2] * 0.3]);
    camera.position.copy(eye);
    camera.up.copy(toThree(up));
    // Straight ahead along the car: looking slightly down hid the road over crests and up hills.
    camera.lookAt(toThree([pos[0] + fwd[0] * 25 + up[0] * 0.8, pos[1] + fwd[1] * 25 + up[1] * 0.8, pos[2] + fwd[2] * 25 + up[2] * 0.8]));
  } else if (view === 'chase') {
    camera.up.set(0, 1, 0);
    const hl = Math.hypot(fwd[0], fwd[1]) || 1;
    const target = toThree([pos[0] - (fwd[0] / hl) * 13, pos[1] - (fwd[1] / hl) * 13, pos[2] + 4.3]);
    if (!camInit) {
      camPos.copy(target);
      camInit = true;
    } else camPos.lerp(target, 1 - Math.exp(-5 * frameDt));
    camera.position.copy(camPos);
    camera.lookAt(toThree([pos[0], pos[1], pos[2] + 1.3]));
  } else {
    camera.up.set(0, 1, 0);
    fly.update(frameDt);
  }

  // Tyre squeal where the original's would: at the grip limit, which its steering only reaches from
  // ~70 mph (31 m/s) on asphalt at grip 1 (sooner on dirt and ice).
  const mu = spec.grip * (spec.surfaceGrip[car.surface] ?? 1);
  const skidding = car.grounded && car.sliding && speedOf(car) > 31 * Math.sqrt(mu);
  sound.update({ rpm: car.rpm, skidding, crashed: car.crashed, silent: evaluationShown() });

  horizonView?.follow(camera);
  renderer.render(scene, camera);

  let crashFx: HudState['crashFx'];
  if (crash) {
    const t = crashSeconds();
    let fire: { x: number; y: number; r: number } | null = null;
    if (t < PLEASE_WAIT_AT && view !== 'cockpit') {
      const p = toThree([car.pos[0], car.pos[1], car.pos[2] + 0.6]);
      const dist = p.distanceTo(camera.position);
      p.project(camera);
      if (p.z < 1) fire = { x: ((p.x + 1) / 2) * SCREEN_W, y: ((1 - p.y) / 2) * SCREEN_H, r: Math.min(30, Math.max(3, 180 / dist)) };
    }
    crashFx = { cracks: crash.cracks, fire, frame: Math.floor(now / 50), pleaseWait: t >= PLEASE_WAIT_AT && t < EVALUATION_AT };
  } else if (finish) {
    const t = finishSeconds();
    crashFx = { cracks: null, fire: null, frame: 0, pleaseWait: t >= FINISH_WAIT_AT && t < FINISH_EVAL_AT };
  }
  dash.draw({
    view,
    speedKmh: speedOf(car) * 3.6,
    rpm: car.rpm,
    maxRpm: spec.maxRpm,
    gear: car.gear,
    steer: car.steer,
    timeSec: lap.ticks / 60,
    penaltySec: lap.penaltySec,
    wrongWay: lap.wrongWay && lap.phase === 'running',
    finished: lap.phase === 'finished',
    crashed: car.crashed,
    crashReason: car.crashReason,
    crashFx,
    evaluation: evaluationData(),
    help:
      view === 'free'
        ? 'FREE CAM: WASD Q/E SHIFT, DRAG. C: BACK TO CAR'
        : now < flashUntil
          ? flashText
          : car.ticks < 240
            ? 'ARROWS DRIVE  R RESTART  ESC MENU  C CAMERA  M SOUND'
            : '',
  });
});
