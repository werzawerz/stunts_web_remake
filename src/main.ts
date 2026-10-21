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
import { loadHorizonPanorama, loadPictures } from './original/screens';
import { Showroom, type ShowroomCar } from './ui/showroom';
import { loadCarDescription } from './original/carInfo';
import { TrackSelect, type BestTime } from './ui/trackSelect';
import { TILE } from './track/constants';
import { patternUniforms } from './track/patterns';
import { MAX_REPLAY_TICKS, Replay, type Frame } from './race/replay';
import { ReplayView, type ReplayAction, type ReplayMenuItem } from './ui/replayView';
import { createLap, lapTotal, stepLap, type LapState } from './race/lap';
import { buildRoute, type Route } from './race/route';
import { getGhost, getLeaderboard, isOnlineTrack, listSharedTracks, shareTrack, submitLapTime } from './net/supabase';
import { Ghost, startOnLine } from './race/ghost';
import { listReplays, saveReplay, type SavedReplay } from './race/replayStore';
import { CarSound } from './audio/sound';
import { listTracks, saveTrack, setOnlineId, trackFromBase64, trackToBase64 } from './track/trackStore';
import { checkTrackPath } from './track/check';
import { TrackEditor, type EditorAction } from './ui/trackEditor';
import { OpponentSelect, type OpponentAction } from './ui/opponentSelect';
import { OpponentResult, type RaceOutcome } from './ui/opponentResult';
import { loadOpponent, OPPONENT_COUNT, type OpponentProfile } from './original/opponents';
import type { Sprite } from './original/cockpit';
import { collideCars, cloneRival, Rival, type RivalState } from './race/opponent';
import { isTouchDevice, TouchControls } from './ui/touchControls';

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
  // See-through patterns are drawn on the 320x200 picture's pixel grid.
  patternUniforms.uPixel.value = Math.max(1, renderer.domElement.width / SCREEN_W);
}
layout();
window.addEventListener('resize', layout);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(56, SCREEN_W / SCREEN_H, 0.3, 6000);

const fly = new FlyCamera(camera, dash.canvas);
const input = new KeyboardInput();

/** Press a key as if typed: the touch buttons, and text typed on a phone, go through the keyboard path. */
function pressKey(key: string, code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }));
}
/** On phones and tablets: on-screen driving controls. */
const touch = isTouchDevice() ? new TouchControls((code) => pressKey(code === 'KeyC' ? 'c' : code, code)) : null;
// Sound may only start in a user gesture; iOS is pickiest about which (touchend counts), and pauses
// it when the app goes to the background. Any touch, click or key (re)starts it.
for (const type of ['touchend', 'pointerdown', 'click', 'keydown'] as const) {
  window.addEventListener(type, () => sound.start(), { capture: true, passive: true });
}
// No pinch or double-tap zoom while playing (iOS ignores the viewport's user-scalable=no).
document.addEventListener('gesturestart', (e) => e.preventDefault());
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
    // Laps are stored under the cars' original names: find the ghost's car again.
    loadGhost();
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
  /** False for a saved editor track that fails the original's track check. */
  drivable?: boolean;
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
/** Names for the track lists; saved tracks that can't be driven yet are marked. */
const trackNames = (): string[] => TRACKS.map((t) => (t.drivable === false ? `${t.name} (unfinished)` : t.name));
/** Tracks shared online by everyone, newest first. */
let sharedTracks: { id: string; name: string; author: string; track: Track }[] = [];
/** Fetch the shared tracks (at start, when choosing a track, after sharing one). */
function refreshShared(): void {
  listSharedTracks()
    .then((rows) => {
      sharedTracks = rows.flatMap((r) => {
        try {
          return [{ id: r.id, name: r.name, author: r.author, track: trackFromBase64(r.trkBase64) }];
        } catch {
          return []; // not a readable track
        }
      });
      refreshCustomTracks();
    })
    .catch(() => undefined);
}
/** After the originals: the shared tracks, then this device's own that aren't shared (yet). */
function refreshCustomTracks(): void {
  for (let i = TRACKS.length - 1; i >= 0; i--) if (TRACKS[i]!.id.startsWith('custom-') || TRACKS[i]!.id.startsWith('user-')) TRACKS.splice(i, 1);
  for (const s of sharedTracks) {
    const t = s.track;
    TRACKS.push({ id: s.id, name: `${s.name} (${s.author})`, drivable: checkTrackPath(t).error === null, load: async () => t });
  }
  const shared = new Set(sharedTracks.map((s) => s.id));
  for (const t of listTracks()) {
    if (t.onlineId && shared.has(t.onlineId)) continue;
    const name = t.name;
    TRACKS.push({
      id: `custom-${name}`,
      name,
      drivable: checkTrackPath(t.track).error === null,
      load: async () => listTracks().find((x) => x.name === name)?.track ?? null,
    });
  }
  trackIndex = Math.max(0, TRACKS.findIndex((t) => t.id === trackId));
}
let trackIndex = 0;
let trackId = 'default';
refreshCustomTracks();
refreshShared();

/** The list entry for the track saved here as `name`: its shared copy once it has one. */
function savedTrackIndex(name: string): number {
  const onlineId = listTracks().find((t) => t.name === name)?.onlineId;
  const i = onlineId ? TRACKS.findIndex((t) => t.id === onlineId) : -1;
  return i >= 0 ? i : TRACKS.findIndex((t) => t.id === `custom-${name}`);
}
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
  { label: ['View', 'Replay'], enabled: true },
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
        loadGhost(); // the new time may be the track's best
      })
      .catch((err: unknown) => {
        p.busy = false;
        p.status = `Could not save: ${err instanceof Error ? err.message : String(err)}`.slice(0, 40);
      });
  } else if (e.key.length === 1 && p.text.length < 20) p.text += e.key;
}

function evalActivate(i: number): void {
  if (i === 0) startReplay('evaluation');
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
  tracks: trackNames,
  trackIndex: () => trackIndex,
  soundOn: () => !sound.muted,
  ghostOn: () => ghostEnabled,
  replayNames: () => listReplays().map((r) => r.name),
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
  tracks: trackNames,
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
  else if (a.type === 'edit') {
    const e = TRACKS[trackIndex]!;
    trackEditor.open(currentTrack, e.id.startsWith('custom-') ? e.name : '');
  }
}

// ---- track editor (the original's, from Track select → New/Edit Tracks) ------------------------
const trackEditor = new TrackEditor({
  trackNames,
  loadTrack: async (i) => {
    const e = TRACKS[i];
    const track = e ? await e.load() : null;
    if (!e || !track) return null;
    // Only the player's own tracks keep their name: saving an original asks for a new one.
    return { track, name: e.id.startsWith('custom-') ? e.name : '' };
  },
  save: (name, track) => {
    if (!saveTrack(name, track)) return false;
    refreshCustomTracks();
    // Drivable tracks are shared online for every device; unfinished ones stay on this one.
    if (checkTrackPath(track).error !== null) {
      trackEditor.notice(['Saved on this device.', 'It is shared online once', 'it passes the track check.']);
      return true;
    }
    shareTrack({ name, author: loadName() || 'anonymous', trkBase64: trackToBase64(track) })
      .then((id) => {
        if (!id) return;
        setOnlineId(name, id);
        refreshShared();
        trackEditor.notice(['Shared online:', 'every device can race it now.']);
      })
      .catch(() => trackEditor.notice(['Saved on this device.', 'Sharing it online failed.']));
    return true;
  },
});

function editorAction(a: EditorAction): void {
  if (a.type === 'cancel') trackEditor.close();
  else if (a.type === 'done') {
    // As in the original, a track is driven as it was saved.
    trackEditor.close();
    refreshCustomTracks();
    const i = savedTrackIndex(a.name);
    if (i >= 0) void selectTrack(i, 1, true);
  }
}

function showroomDone(): void {
  if (showroomForOpponent) {
    showroomForOpponent = false;
    opponentCar = showroom.index;
    opponentPaint = showroom.paint;
    showroom.portrait = null;
    showroom.close();
    saveOpponent();
    return;
  }
  manualGearbox = showroom.manual;
  carPaint = showroom.paint;
  showroom.close();
  selectCar(showroom.index);
}

function menuAction(a: MenuAction): void {
  if (a.type === 'showroom') showroom.open(carIndex, carPaint, manualGearbox);
  else if (a.type === 'trackselect') {
    refreshShared();
    trackSelect.open();
  }
  else if (a.type === 'opponent') opponentSelect.open(opponentId);
  else if (a.type === 'drive') {
    menu.close();
    resetCar();
  } else if (a.type === 'car') selectCar(a.index);
  else if (a.type === 'track') void selectTrack(a.index, 1, true);
  else if (a.type === 'sound') sound.setMuted(!a.on);
  else if (a.type === 'ghost') setGhostEnabled(a.on);
  else if (a.type === 'loadreplay') {
    const r = listReplays()[a.index];
    if (r) void loadSavedReplay(r);
  }
  else if (a.type === 'pixels') {
    resMode = RES_MODES[(RES_MODES.indexOf(resMode as 2 | 1 | 0) + 1) % RES_MODES.length]!;
    layout();
  }
}

/** Type a name with the phone's own keyboard, then hand it over as key presses. */
function typeOnPhone(): void {
  const current = naming() ? (finish?.prompt?.text ?? '') : '';
  const text = window.prompt(naming() ? 'Your name for the fastest times:' : 'Name:', current);
  if (text === null) {
    pressKey('Escape', 'Escape');
    return;
  }
  for (let i = 0; i < 24; i++) pressKey('Backspace', 'Backspace');
  for (const ch of text) pressKey(ch, /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /\d/.test(ch) ? `Digit${ch}` : ch === ' ' ? 'Space' : '');
  pressKey('Enter', 'Enter');
}

/** A mouse event's position on the 320x200 screen. */
function screenXY(e: MouseEvent): [number, number] {
  const r = dash.canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * SCREEN_W, ((e.clientY - r.top) / r.height) * SCREEN_H];
}
// The track editor also follows the mouse (it makes what it is over active) and the wheel.
dash.canvas.addEventListener('mousemove', (e) => {
  if (trackEditor.visible) trackEditor.move(...screenXY(e));
});
dash.canvas.addEventListener(
  'wheel',
  (e) => {
    if (!trackEditor.visible) return;
    e.preventDefault();
    trackEditor.wheel(e.deltaY || e.deltaX, e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY));
  },
  { passive: false },
);
// Mouse: click a button on the evaluation screen.
dash.canvas.addEventListener('click', (e) => {
  const [x, y] = screenXY(e);
  // Phones have no keys to type with: a tap where a name is wanted opens the system text box.
  if (touch && (naming() || (replayView.visible && replayView.typing) || trackEditor.typing)) {
    typeOnPhone();
    return;
  }
  if (trackEditor.visible) {
    editorAction(trackEditor.click(x, y));
    return;
  }
  if (replayView.visible) {
    replayAction(replayView.click(x, y, replayItems));
    return;
  }
  if (opponentResult.visible) {
    opponentResult.close();
    return;
  }
  if (showroom.visible) {
    sound.start();
    if (showroom.click(x, y).type === 'done') showroomDone();
    return;
  }
  if (opponentSelect.visible) {
    sound.start();
    opponentAction(opponentSelect.click(x, y));
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

// ---- replays: the run's inputs re-simulated (the simulation is deterministic) --------------------
interface RunState {
  car: CarState;
  lap: LapState;
  /** The computer opponent, when racing one. */
  rival?: RivalState;
}
/** Input bitmask of every tick since the car was (re)started, for the replay. */
let replayLog: number[] = [];
let replay: Replay<RunState> | null = null;
let rframe: Frame<RunState> | null = null;
let replayFrom: 'evaluation' | 'race' | 'loaded' = 'race';
/** What the replay is of (for Save REPLAY). */
let replayMeta: { trackId: string; carId: string; paint: number; manual: boolean; opponent?: { id: number; car: string; paint: number } } = {
  trackId: '',
  carId: '',
  paint: 0,
  manual: false,
};
let replayAcc = 0;
const replayView = new ReplayView();
void loadPictures('SDGAME.PVS').then((p) => (replayView.pictures = p));
replayView.savedNames = () => listReplays().map((r) => r.name);

function startReplay(from: 'evaluation' | 'race' | 'loaded'): void {
  finishLearning();
  const rv = rival;
  replayMeta = {
    trackId,
    carId: spec.id,
    paint: carPaint,
    manual: manualGearbox,
    opponent: rv ? { id: rv.profile.id, car: rv.spec.id, paint: opponentPaint } : undefined,
  };
  const s0 = spec;
  const pose = startPose;
  const man = manualGearbox;
  const w = world;
  const r = route;
  replay = new Replay<RunState>(
    replayLog.slice(),
    () => ({
      car: startOnLine(s0, pose.pos, pose.heading, man, w),
      lap: createLap(),
      rival: rv ? rv.create(pose.pos, pose.heading, (p, h) => startOnLine(rv.spec, p, h, false, w)) : undefined,
    }),
    (st, input) => {
      stepCar(st.car, s0, input, w);
      if (r) stepLap(st.lap, r, st.car.pos, st.car.vel, (input & INPUT.Throttle) !== 0 || speedOf(st.car) > 0.5, st.car.crashed);
      if (rv && st.rival) stepRival(rv, st.rival, st.car, st.lap.phase !== 'ready', w);
    },
  );
  replayFrom = from;
  // From the evaluation (or loaded) the replay plays from the start; mid-race it stops where you are.
  rframe = replay.frameAt(from === 'race' ? replay.length : 0);
  replayAcc = 0;
  replayView.open(from === 'race' ? 'stop' : 'play');
}

/** Load a saved replay: its track and car first, then play it. */
async function loadSavedReplay(r: SavedReplay): Promise<void> {
  const ti = TRACKS.findIndex((t) => t.id === r.trackId);
  const ci = CARS.findIndex((c) => c.id === r.carId);
  if (ti < 0 || ci < 0) {
    flash("THIS REPLAY'S TRACK OR CAR ISN'T AVAILABLE");
    return;
  }
  leaveReplay();
  menu.close();
  carPaint = r.paint;
  manualGearbox = r.manual;
  if (r.opponent) {
    opponentId = r.opponent.id;
    opponentCar = Math.max(0, CARS.findIndex((c) => c.id === r.opponent!.car));
    opponentPaint = r.opponent.paint;
  } else opponentId = 0;
  selectCar(ci);
  if (ti !== trackIndex) await selectTrack(ti, 1, true);
  replayLog = r.inputs.slice(0, MAX_REPLAY_TICKS);
  startReplay('loaded');
}

function replayItems(): ReplayMenuItem[] {
  const items: ReplayMenuItem[] = ['restart', 'main'];
  if (replayFrom === 'evaluation') items.push('evaluation');
  if (rframe && !rframe.state.car.crashed && rframe.state.lap.phase !== 'finished') items.push('continue');
  return items;
}

function leaveReplay(): void {
  replayView.close();
  replay = null;
  rframe = null;
  camInit = false;
}

function replayAction(a: ReplayAction): void {
  if (!replay || !rframe) return;
  if (a.type === 'start') rframe = replay.frameAt(0);
  else if (a.type === 'save') {
    const ok = saveReplay({ name: a.name, ...replayMeta, inputs: [...replay.inputs] });
    flash(ok ? `REPLAY "${a.name.toUpperCase()}" SAVED` : 'COULD NOT SAVE: BROWSER STORAGE FULL?');
  } else if (a.type === 'load') {
    const r = listReplays()[a.index];
    if (r) void loadSavedReplay(r);
  }
  else if (a.type === 'item') {
    if (a.item === 'evaluation') leaveReplay();
    else if (a.item === 'restart') {
      leaveReplay();
      resetCar();
    } else if (a.item === 'main') {
      leaveReplay();
      resetCar();
      menu.open();
    } else if (a.item === 'continue') {
      // Take over the car from this point of the replay.
      const st = structuredClone(rframe.state);
      const tick = rframe.tick;
      leaveReplay();
      clearCrash();
      finish = null;
      car = st.car;
      lap = st.lap;
      if (st.rival) rivalState = st.rival;
      outcomeShown = false;
      prevPos = [...car.pos];
      prevQuat = [...car.quat];
      replayLog = replayLog.slice(0, tick);
      inputLog = inputLog.slice(0, lap.ticks);
      if (ghost) {
        ghost.reset();
        ghost.follow(inputLog.length);
      }
    }
  }
}

/** TV cameras beside the road every ~180 m of the route, like the original's track cams. */
function trackCams(): Vec3[] {
  const line = route?.line3d ?? [];
  const cams: Vec3[] = [];
  let run = 180;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    run += d;
    if (run < 180 || d < 0.01) continue;
    run = 0;
    const side = cams.length % 2 === 0 ? 1 : -1;
    cams.push([b[0] + ((b[1] - a[1]) / d) * 24 * side, b[1] - ((b[0] - a[0]) / d) * 24 * side, b[2] + 7]);
  }
  return cams;
}

function replayCamera(rc: CarState): void {
  const p = rc.pos;
  const fwd = quatRotate(rc.quat, [0, 1, 0]);
  const up = quatRotate(rc.quat, [0, 0, 1]);
  const hl = Math.hypot(fwd[0], fwd[1]) || 1;
  let fov = 56;
  camera.up.set(0, 1, 0);
  switch (replayView.camera) {
    case 'inside':
      camera.position.copy(toThree([p[0] + up[0] * 0.8 - fwd[0] * 0.3, p[1] + up[1] * 0.8 - fwd[1] * 0.3, p[2] + up[2] * 0.8 - fwd[2] * 0.3]));
      camera.up.copy(toThree(up));
      camera.lookAt(toThree([p[0] + fwd[0] * 25 + up[0] * 0.8, p[1] + fwd[1] * 25 + up[1] * 0.8, p[2] + fwd[2] * 25 + up[2] * 0.8]));
      break;
    case 'overhead':
      // From above and a little behind, like the original's helicopter.
      camera.position.copy(toThree([p[0] - (fwd[0] / hl) * 16, p[1] - (fwd[1] / hl) * 16, p[2] + 22]));
      camera.lookAt(toThree([p[0] + (fwd[0] / hl) * 6, p[1] + (fwd[1] / hl) * 6, p[2]]));
      break;
    case 'track': {
      let best: Vec3 = [p[0] - 30, p[1] - 30, p[2] + 8];
      let bd = Infinity;
      for (const c of trackCams()) {
        const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      camera.position.copy(toThree(best));
      camera.lookAt(toThree([p[0], p[1], p[2] + 0.8]));
      // Zoom in on far cars, like a TV camera.
      fov = Math.min(56, Math.max(8, (2 * Math.atan(9 / Math.max(1, bd)) * 180) / Math.PI));
      break;
    }
    case 'manual': {
      const yaw = Math.atan2(fwd[1], fwd[0]) + replayView.manualYaw;
      const d = replayView.manualDist;
      camera.position.copy(toThree([p[0] + Math.cos(yaw) * d, p[1] + Math.sin(yaw) * d, p[2] + d * 0.35]));
      camera.lookAt(toThree([p[0], p[1], p[2] + 0.8]));
      break;
    }
  }
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

// ---- ghost: the track's fastest stored lap, driven again alongside you --------------------------
let ghostEnabled = (() => {
  try {
    return localStorage.getItem('stunts.ghost') !== '0';
  } catch {
    return true;
  }
})();
let ghost: Ghost | null = null;
let ghostObj: THREE.Group | null = null;

function setGhostEnabled(on: boolean): void {
  ghostEnabled = on;
  try {
    localStorage.setItem('stunts.ghost', on ? '1' : '0');
  } catch {
    // Not remembered; fine.
  }
}

function dropGhost(): void {
  if (ghostObj) {
    scene.remove(ghostObj);
    ghostObj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  ghost = null;
  ghostObj = null;
}

/** Fetch the fastest stored lap of the current track and set it up as the ghost. */
function loadGhost(): void {
  const id = trackId;
  const w = world;
  const pose = startPose;
  dropGhost();
  getGhost(id)
    .then((row) => {
      if (!row || id !== trackId || w !== world) return;
      const s = CARS.find((c) => c.name === row.car || originalModels[c.id]?.name === row.car);
      if (!s) return;
      dropGhost();
      ghost = new Ghost(s, row.inputs, pose.pos, pose.heading, w);
      ghost.follow(inputLog.length);
      const model = originalModels[s.id];
      ghostObj = model ? createCarMeshFromModel(model, s, 0) : createCarMesh(s, 0xe8e8e8);
      ghostObj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.Material;
          m.transparent = true;
          m.opacity = 0.4;
          m.depthWrite = false;
        }
      });
      ghostObj.visible = false;
      scene.add(ghostObj);
    })
    .catch(() => undefined);
}

// ---- computer opponents (main menu → Opponent) -------------------------------------------------
const opponentSaved = ((): { id: number; car: string; paint: number } | null => {
  try {
    return JSON.parse(localStorage.getItem('stunts.opponent') ?? 'null') as { id: number; car: string; paint: number } | null;
  } catch {
    return null;
  }
})();
/** 0 = race against the clock, 1..6 the original's opponents. */
let opponentId = opponentSaved?.id ?? 0;
let opponentCar = Math.max(0, CARS.findIndex((c) => c.id === opponentSaved?.car));
let opponentPaint = opponentSaved?.paint ?? 0;
const opponentProfiles = new Map<number, OpponentProfile | null>();
for (let i = 1; i <= OPPONENT_COUNT; i++) {
  void loadOpponent(i).then((p) => {
    opponentProfiles.set(i, p);
    if (i === opponentId && !rival && lap.phase === 'ready') setupRival();
  });
}
function saveOpponent(): void {
  try {
    localStorage.setItem('stunts.opponent', JSON.stringify({ id: opponentId, car: CARS[opponentCar]!.id, paint: opponentPaint }));
  } catch {
    // Not remembered; fine.
  }
}
const opponentSelect = new OpponentSelect((id) => opponentProfiles.get(id) ?? null);
let opponentPictures: Map<string, Sprite> | null = null;
void loadPictures('SDOSEL.PVS').then((p) => {
  opponentPictures = p;
  opponentSelect.setPictures(p);
});
const opponentResult = new OpponentResult(loadPictures);
/** The showroom is choosing the opponent's car. */
let showroomForOpponent = false;
/** This race's opponent, its state, its car on screen, and what's left of its pre-race learning. */
let rival: Rival | null = null;
let rivalState: RivalState | null = null;
let rivalObj: THREE.Group | null = null;
let rivalLearning: Generator<void, number> | null = null;
/** Opponents with the speeds they learnt, per route and setup (learning takes a while). */
const rivals = new Map<string, Rival>();
let routeSerial = 0;
/** The two cars wrecked each other this run. */
let wrecked = false;
let outcomeShown = false;

function dropRivalObj(): void {
  if (!rivalObj) return;
  scene.remove(rivalObj);
  rivalObj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  rivalObj = null;
}

/** Put the chosen opponent on the start line beside the player (or none). */
function setupRival(): void {
  rivalState = null;
  rivalLearning = null;
  wrecked = false;
  outcomeShown = false;
  opponentResult.close();
  const profile = opponentId > 0 ? (opponentProfiles.get(opponentId) ?? null) : null;
  if (!profile || !route) {
    rival = null;
    dropRivalObj();
    return;
  }
  const s = CARS[opponentCar] ?? CARS[0]!;
  const key = `${routeSerial}|${opponentId}|${s.id}`;
  let r = rivals.get(key);
  const fresh = !r;
  if (!r) {
    r = new Rival(profile, s, route, currentTrack);
    rivals.set(key, r);
  }
  rival = r;
  const w = world;
  rivalState = r.create(startPose.pos, startPose.heading, (p, h) => startOnLine(s, p, h, false, w));
  if (fresh) rivalLearning = r.learning(cloneRival(rivalState), w);
  const look = `${s.id}|${opponentPaint}|${originalModels[s.id] ? 1 : 0}`;
  if (!rivalObj || rivalObj.userData.look !== look) {
    dropRivalObj();
    const model = originalModels[s.id];
    rivalObj = model ? createCarMeshFromModel(model, s, opponentPaint) : createCarMesh(s, PAINT[(opponentCar + 3) % PAINT.length]);
    rivalObj.userData.look = look;
    scene.add(rivalObj);
  }
}

/** The race is on: the opponent's learning has to be complete. */
function finishLearning(): void {
  if (!rivalLearning) return;
  let r = rivalLearning.next();
  while (!r.done) r = rivalLearning.next();
  rivalLearning = null;
}

/** Learn a slice at a time while the player waits on the start line or in the menus. */
function learnABit(budgetMs: number): void {
  if (!rivalLearning) return;
  const t0 = performance.now();
  while (performance.now() - t0 < budgetMs) {
    if (rivalLearning.next().done) {
      rivalLearning = null;
      return;
    }
  }
}

/** The opponent's tick, right after the player's (the same in replays); true when they collide. */
function stepRival(r: Rival, st: RivalState, player: CarState, racing: boolean, w: CollisionWorld): boolean {
  r.step(st, w, racing);
  return collideCars(player, st.car);
}

/** After the race: let the opponent finish (the original's "calculating opponent time"), then their verdict. */
function showOutcome(now: number): void {
  outcomeShown = true;
  if (!rival || !rivalState) return;
  finishLearning();
  for (let k = 0; k < 60 * 900 && rivalState.lap.phase !== 'finished' && !rivalState.car.crashed; k++) rival.step(rivalState, world, true);
  const o: RaceOutcome = {
    playerSec: finish ? finish.timeSec + finish.penaltySec : null,
    opponentSec: rivalState.lap.phase === 'finished' ? lapTotal(rivalState.lap) : null,
    collision: wrecked,
    seed: lap.ticks,
  };
  opponentResult.open(rival.profile, o, now);
}

function opponentAction(a: OpponentAction): void {
  if (a.type === 'done') {
    opponentId = opponentSelect.index;
    opponentSelect.close();
    saveOpponent();
    resetCar();
  } else if (a.type === 'car') {
    showroomForOpponent = true;
    showroom.portrait = opponentPictures?.get(`opp${opponentSelect.index}`) ?? null;
    showroom.open(opponentCar, opponentPaint, false);
  }
}

function resetCar(): void {
  replayLog = [];
  ghost?.reset();
  car = startOnLine(spec, startPose.pos, startPose.heading, manualGearbox, world);
  prevPos = [...car.pos];
  prevQuat = [...car.quat];
  camInit = false;
  lap = createLap();
  inputLog = [];
  runStats = { top: 0, distance: 0, seconds: 0 };
  clearCrash();
  finish = null;
  setupRival();
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
    // Tracks made in the editor have no online fastest times.
    prompt: isOnlineTrack(trackId) ? { text: loadName(), status: '', busy: false } : null,
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

// The original's horizon pictures (DESERT.PVS...), when the player's files have them.
const HORIZON_FILES: Partial<Record<Horizon, string>> = {
  [Horizon.Desert]: 'DESERT.PVS',
  [Horizon.Tropical]: 'TROPICAL.PVS',
  [Horizon.Alpine]: 'ALPINE.PVS',
  [Horizon.City]: 'CITY.PVS',
  [Horizon.Country]: 'COUNTRY.PVS',
};
const panoramas = new Map<Horizon, HTMLCanvasElement | null>();

function setHorizon(h: Horizon): void {
  if (horizonView) {
    scene.remove(horizonView.group);
    horizonView.dispose();
  }
  horizonView = createHorizon(h, panoramas.get(h) ?? null);
  scene.add(horizonView.group);
  renderer.setClearColor(horizonView.fogColor);
  const file = HORIZON_FILES[h];
  if (file && !panoramas.has(h)) {
    panoramas.set(h, null);
    void loadHorizonPanorama(file).then((p) => {
      panoramas.set(h, p);
      if (p && currentTrack.horizon === h) setHorizon(h);
    });
  }
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
  const built = buildTrack(track, trackShapes);
  trackGroup = built.group;
  world = built.world;
  scene.add(trackGroup);

  const start = findStart(track);
  route = start ? buildRoute(built.pieces, start.dir) : null;
  // Penalties follow the original's path, every way through the track (see race/lap.ts).
  if (route) route.graph = checkTrackPath(track).graph ?? null;
  routeSerial++;
  if (start) {
    const f = ({ N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] } as const)[start.dir];
    // Start a little behind the line so the player drives through it.
    const e = start.centre[0] - f[0] * 12;
    const n = start.centre[1] - f[1] * 12;
    // Drop the car onto whatever the start line stands on (it can be on a hill).
    const hit = world.raycast([e, n, 300], [0, 0, -1], 400);
    startPose = { pos: [e, n, (hit ? 300 - hit.t : 0) + 1], heading: start.dir };
  }
  setHorizon(track.horizon);
  resetCar();
  spawnFromParam();
  loadGhost();
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
    // Unfinished editor tracks (failing the track check) can't be raced.
    if (entry.drivable === false) {
      if (quiet && k === 0) return;
      continue;
    }
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
  if (opponentResult.visible) {
    opponentResult.close();
    e.preventDefault();
    return;
  }
  if (naming()) {
    nameKey(e);
    e.preventDefault();
    return;
  }
  if (typingInForm(e)) {
    if (e.code === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  if (trackEditor.visible) {
    editorAction(trackEditor.key(e));
    e.preventDefault();
    return;
  }
  if (replayView.visible && replayView.typing) {
    replayAction(replayView.typeKey(e));
    e.preventDefault();
    return;
  }
  if (replayView.visible) {
    replayAction(replayView.key(e.code, replayItems));
    e.preventDefault();
    return;
  }
  if (showroom.visible) {
    if (showroom.key(e.code).type === 'done') showroomDone();
    e.preventDefault();
    return;
  }
  if (opponentSelect.visible) {
    opponentAction(opponentSelect.key(e.code));
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
  // Escape during a race opens the replay panel, stopped where you are, like the original.
  if (e.code === 'Escape') {
    if (!evaluationShown()) startReplay('race');
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
  if (e.code === 'KeyG') {
    setGhostEnabled(!ghostEnabled);
    flash(ghostEnabled ? (ghost ? 'GHOST ON  (G)' : 'GHOST ON: NO STORED LAP HERE YET') : 'GHOST OFF  (G)');
  } else if (e.code === 'KeyM') {
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

/**
 * The chase camera's position, brought in front of anything between it and the car (the deck of
 * a ramp behind you, a pipe wall), so the car never disappears behind the track.
 */
function unblocked(focus: Vec3, cam: THREE.Vector3): THREE.Vector3 {
  const to: Vec3 = [cam.x, -cam.z, cam.y];
  const d: Vec3 = [to[0] - focus[0], to[1] - focus[1], to[2] - focus[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1) return cam;
  const dir: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  let t = len;
  const surface = world.raycast(focus, dir, len);
  if (surface) t = Math.min(t, surface.t);
  const wall = world.sweep(focus, to);
  if (wall) t = Math.min(t, wall.t * len);
  if (t >= len) return cam;
  const k = Math.max(1.5, t - 0.8);
  return toThree([focus[0] + dir[0] * k, focus[1] + dir[1] * k, focus[2] + dir[2] * k]);
}

// ---- main loop: fixed 60 Hz simulation, interpolated rendering -----------------------------
let last = performance.now();
let acc = 0;
const toThree = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v[0], v[2], -v[1]);

renderer.setAnimationLoop((now) => {
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;
  // The opponent learns its lap while the player is in the menus or waiting on the start line.
  touch?.set(
    !menu.visible &&
      !showroom.visible &&
      !trackSelect.visible &&
      !opponentSelect.visible &&
      !trackEditor.visible &&
      !replayView.visible &&
      !opponentResult.visible &&
      !evaluationShown() &&
      view !== 'free',
    manualGearbox,
  );
  if (rivalLearning && lap.phase === 'ready') learnABit(menu.visible || trackSelect.visible || opponentSelect.visible || showroom.visible ? 12 : 6);
  if (replayView.visible && replay && rframe) {
    acc = 0;
    // Advance the replay: play at normal speed, fast play and fast forward faster, rewind back.
    replayAcc += frameDt;
    const n = Math.floor(replayAcc / DT);
    replayAcc -= n * DT;
    const mode = replayView.mode;
    if (mode === 'play' || mode === 'fast' || mode === 'forward') {
      const k = mode === 'play' ? n : mode === 'fast' ? n * 3 : n * 8;
      for (let i = 0; i < k && rframe.tick < replay.length; i++) replay.advance(rframe);
      if (rframe.tick >= replay.length) replayView.mode = 'stop';
    } else if (mode === 'rewind' && n > 0) {
      rframe = replay.frameAt(rframe.tick - n * 8);
      if (rframe.tick === 0) replayView.mode = 'stop';
    }
    const rc = rframe.state.car;
    if (ghostObj) ghostObj.visible = false;
    if (rivalObj) {
      const rs = rframe.state.rival;
      if (rs) setObjectPose(rivalObj, rs.car.pos, rs.car.quat);
      rivalObj.visible = rs !== undefined;
    }
    setObjectPose(carObject, rc.pos, rc.quat);
    carObject.visible = replayView.camera !== 'inside' && !rc.crashed;
    if (crash) crash.debris.group.visible = false;
    replayCamera(rc);
    sound.update({ rpm: rc.rpm, skidding: false, crashed: rc.crashed, silent: mode !== 'play' });
    horizonView?.follow(camera);
    renderer.render(scene, camera);
    let fire: { x: number; y: number; r: number } | null = null;
    if (rc.crashed && replayView.camera !== 'inside') {
      const q = toThree([rc.pos[0], rc.pos[1], rc.pos[2] + 0.6]);
      const dist = q.distanceTo(camera.position);
      q.project(camera);
      if (q.z < 1) fire = { x: ((q.x + 1) / 2) * SCREEN_W, y: ((1 - q.y) / 2) * SCREEN_H, r: Math.min(30, Math.max(3, 180 / dist)) };
    }
    const inside = replayView.camera === 'inside';
    const rpl = replay;
    const rf = rframe;
    dash.draw({
      view: inside && !replayView.dashHidden ? 'cockpit' : 'chase',
      speedKmh: speedOf(rc) * 3.6,
      rpm: rc.rpm,
      maxRpm: spec.maxRpm,
      gear: rc.gear,
      steer: rc.steer,
      timeSec: rf.state.lap.ticks / 60,
      penaltySec: rf.state.lap.penaltySec,
      wrongWay: false,
      finished: false,
      crashed: false,
      crashReason: '',
      help: '',
      crashFx: rc.crashed
        ? { cracks: inside ? crackLines(rpl.length, SCREEN_W, SCREEN_H) : null, fire, frame: Math.floor(now / 50), pleaseWait: false }
        : undefined,
      after: (c) => {
        replayView.draw(c, rf.tick, rpl.length, now);
        // Messages (e.g. "replay saved") at the top, clear of the panel.
        if (now < flashUntil) {
          c.font = 'bold 7px monospace';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillStyle = '#000000';
          c.fillText(flashText, 161, 41);
          c.fillStyle = '#fcfcfc';
          c.fillText(flashText, 160, 40);
        }
      },
    });
    return;
  }
  if (camera.fov !== 56) {
    camera.fov = 56;
    camera.updateProjectionMatrix();
  }
  if (trackEditor.visible) {
    acc = 0;
    sound.update({ rpm: car.rpm, skidding: false, crashed: false, silent: true });
    dash.drawScreen((c) => trackEditor.draw(c, now));
    return;
  }
  if (showroom.visible) {
    acc = 0;
    sound.update({ rpm: car.rpm, skidding: false, crashed: false, silent: true });
    showroom.update(frameDt);
    showroom.render(renderer);
    dash.drawScreen((c) => showroom.drawPanel(c, now));
    return;
  }
  if (opponentSelect.visible) {
    acc = 0;
    sound.update({ rpm: car.rpm, skidding: false, crashed: false, silent: true });
    dash.drawScreen((c) => opponentSelect.draw(c, now));
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
    const raw = input.mask() | (touch?.mask() ?? 0);
    if (raw & INPUT.Reset && !naming()) resetCar(); // R types a letter in the name box
    // After the finish the car just rolls out.
    const mask = lap.phase === 'finished' ? 0 : raw;
    prevPos = [...car.pos];
    prevQuat = [...car.quat];
    if (replayLog.length < MAX_REPLAY_TICKS) replayLog.push(mask);
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
      ghost?.follow(inputLog.length);
      if (wasRunning && lap.phase === 'finished') onFinish();
    }
    if (rival && rivalState) {
      const racing = lap.phase !== 'ready';
      if (racing) finishLearning();
      const wasCrashed2 = car.crashed;
      const speedBefore2 = speedOf(car);
      const velBefore2: Vec3 = [...car.vel];
      if (stepRival(rival, rivalState, car, racing, world)) {
        wrecked = true;
        if (!wasCrashed2 && car.crashed && !finish) onCrash(speedBefore2, velBefore2);
      }
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
  if (ghost && ghostObj) {
    setObjectPose(ghostObj, ghost.car.pos, ghost.car.quat);
    ghostObj.visible = ghostEnabled && !evaluationShown();
  }
  if (rivalObj) {
    if (rivalState) setObjectPose(rivalObj, rivalState.car.pos, rivalState.car.quat);
    rivalObj.visible = rivalState !== null && !evaluationShown();
  }
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
    camera.position.copy(unblocked([pos[0], pos[1], pos[2] + 1.3], camPos));
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
  // Racing an opponent: their verdict comes before the evaluation.
  if (evaluationShown() && rival && !outcomeShown) showOutcome(now);
  if (opponentResult.visible) {
    dash.drawScreen((c) => opponentResult.draw(c, now));
    return;
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
          : car.ticks < 240 && !touch
            ? 'ARROWS DRIVE  R RESTART  ESC REPLAY/MENU  C CAMERA  M SOUND'
            : '',
  });
});
