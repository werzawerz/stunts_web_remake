import * as THREE from 'three';
import { KeyboardInput } from './core/input';
import { CARS, createCar, DT, INPUT, speedOf, stepCar, type CarSpec, type CarState } from './physics/car';
import type { CollisionWorld } from './physics/collision';
import { quatRotate, type Quat, type Vec3 } from './physics/vec';
import { loadOriginalCarModels, type CarModel } from './original/carModels';
import { loadCockpit } from './original/cockpit';
import { createCarMesh, createCarMeshFromModel, setObjectPose } from './render/carMesh';
import { FlyCamera } from './render/flyCamera';
import { createHorizon, type HorizonView } from './render/horizon';
import { buildSampleTrack } from './track/sampleTrack';
import { findStart } from './track/start';
import { buildTrack } from './track/trackBuilder';
import { Horizon } from './track/trkFormat';
import { Dashboard, SCREEN_H, SCREEN_W, type HudState } from './ui/dashboard';
import { ResultsPanel, typingInForm } from './ui/results';
import { createLap, lapTotal, stepLap, type LapState } from './race/lap';
import { buildRoute, type Route } from './race/route';
import { getLeaderboard, submitLapTime } from './net/supabase';

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
let carIndex = Math.max(0, CARS.findIndex((c) => c.id === vehicleParam));
let spec: CarSpec = CARS[carIndex]!;
// Original car models and names, when the player's own Stunts files are available (dev: original_game/).
let originalModels: Record<string, CarModel> = {};
const buildCarObject = (): THREE.Group => {
  const model = originalModels[spec.id];
  return model ? createCarMeshFromModel(model, spec) : createCarMesh(spec, PAINT[carIndex % PAINT.length]);
};
const carName = (): string => originalModels[spec.id]?.name ?? spec.name;
let carObject = buildCarObject();
scene.add(carObject);
let carNameUntil = 0;

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
    carNameUntil = performance.now() + 4000;
  }
});

function selectCar(i: number): void {
  carIndex = (i + CARS.length) % CARS.length;
  spec = CARS[carIndex]!;
  replaceCarObject();
  updateCockpit();
  carNameUntil = performance.now() + 4000;
  resetCar();
}

// ---- scene state ---------------------------------------------------------------------------
let trackGroup: THREE.Group | null = null;
let horizonView: HorizonView | null = null;
let world: CollisionWorld;
let car: CarState;
let prevPos: Vec3 = [0, 0, 0];
let prevQuat: Quat = [1, 0, 0, 0];
type View = HudState['view'];
let view: View = 'cockpit';
const camPos = new THREE.Vector3();
let camInit = false;
let startPose: { pos: Vec3; heading: 'N' | 'E' | 'S' | 'W' } = { pos: [0, 0, 1], heading: 'N' };
// ---- race: route, lap clock, penalties, results ---------------------------------------------
const TRACK_ID = 'default';
let route: Route | null = null;
let lap: LapState = createLap();
/** Input bitmask of every tick since the clock started: enough to replay or verify the lap. */
let inputLog: number[] = [];
const results = new ResultsPanel(frame);

function resetCar(): void {
  car = createCar(spec, startPose.pos, startPose.heading);
  prevPos = [...car.pos];
  prevQuat = [...car.quat];
  camInit = false;
  lap = createLap();
  inputLog = [];
  results.hide();
}

function refreshLeaderboard(): void {
  getLeaderboard(TRACK_ID)
    .then((rows) => results.setLeaderboard(rows))
    .catch(() => results.setLeaderboard(null));
}

function onFinish(): void {
  const finished = lap;
  const log = Uint8Array.from(inputLog);
  const carLabel = carName().slice(0, 30);
  results.show({ timeSec: finished.ticks / 60, penaltySec: finished.penaltySec, carName: carLabel }, async (name) => {
    let bin = '';
    for (const b of log) bin += String.fromCharCode(b);
    await submitLapTime({
      trackId: TRACK_ID,
      playerName: name.slice(0, 20),
      car: carLabel,
      timeMs: Math.round(lapTotal(finished) * 1000),
      inputLogBase64: btoa(bin),
    });
    refreshLeaderboard();
  });
  refreshLeaderboard();
}

function loadScene(h: Horizon): void {
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
  const track = buildSampleTrack(h);
  const built = buildTrack(track);
  trackGroup = built.group;
  world = built.world;
  scene.add(trackGroup);

  const start = findStart(track);
  route = start ? buildRoute(built.pieces, start.dir) : null;
  if (start) {
    const f = ({ N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] } as const)[start.dir];
    // Start a little behind the line so the player drives through it.
    startPose = { pos: [start.centre[0] - f[0] * 12, start.centre[1] - f[1] * 12, 1], heading: start.dir };
  }
  horizonView = createHorizon(h);
  scene.add(horizonView.group);
  renderer.setClearColor(horizonView.fogColor);
  resetCar();
}

// ---- keys -----------------------------------------------------------------------------------
const VIEWS: View[] = ['cockpit', 'chase', 'free'];
let horizon = Horizon.Country;
window.addEventListener('keydown', (e) => {
  if (typingInForm(e)) {
    if (e.code === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  if (e.code === 'KeyC') {
    view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]!;
    if (view === 'free') {
      const d = camera.getWorldDirection(new THREE.Vector3());
      fly.yaw = Math.atan2(-d.x, -d.z);
      fly.pitch = -0.3;
    }
    camInit = false;
  } else if (e.code === 'KeyV') {
    selectCar(carIndex + (e.shiftKey ? -1 : 1));
  } else if (e.code === 'KeyH') {
    horizon = ((horizon + 1) % 5) as Horizon;
    loadScene(horizon);
  } else if (e.code === 'KeyP') {
    resMode = RES_MODES[(RES_MODES.indexOf(resMode as 2 | 1 | 0) + 1) % RES_MODES.length]!;
    layout();
  }
});

// ---- debug params ---------------------------------------------------------------------------
// ?cam=x,y,z,yawDeg,pitchDeg  free camera pose (render space) · ?car=e,n,u,H,speed  spawn the car
// ?view=chase|cockpit|free    initial view · ?res=0|2|1  native, 640x400 or 320x200
const params = new URLSearchParams(location.search);
loadScene(horizon);
const carParam = params.get('car');
if (carParam) {
  const [e, n, u, hd, v] = carParam.split(',');
  car = createCar(spec, [Number(e), Number(n), Number(u)], hd as 'N' | 'E' | 'S' | 'W', Number(v ?? 0));
  prevPos = [...car.pos];
  prevQuat = [...car.quat];
}
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
  acc += frameDt;
  while (acc >= DT) {
    const raw = input.mask();
    if (raw & INPUT.Reset) resetCar();
    // After the finish the car just rolls out.
    const mask = lap.phase === 'finished' ? 0 : raw;
    prevPos = [...car.pos];
    prevQuat = [...car.quat];
    stepCar(car, spec, mask, world);
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
  carObject.visible = view !== 'cockpit';

  const fwd = quatRotate(qi, [0, 1, 0]);
  const up = quatRotate(qi, [0, 0, 1]);
  if (view === 'cockpit') {
    // Driver's eye, looking slightly down so the horizon sits above the dashboard like the original.
    const eye = toThree([pos[0] + up[0] * 0.8 - fwd[0] * 0.3, pos[1] + up[1] * 0.8 - fwd[1] * 0.3, pos[2] + up[2] * 0.8 - fwd[2] * 0.3]);
    camera.position.copy(eye);
    camera.up.copy(toThree(up));
    camera.lookAt(toThree([pos[0] + fwd[0] * 25 - up[0] * 2.8, pos[1] + fwd[1] * 25 - up[1] * 2.8, pos[2] + fwd[2] * 25 - up[2] * 2.8]));
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

  horizonView?.follow(camera);
  renderer.render(scene, camera);
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
    help:
      view === 'free'
        ? 'FREE CAM: WASD Q/E SHIFT, DRAG. C: BACK TO CAR'
        : now < carNameUntil
          ? `${carName().toUpperCase()}  (V: NEXT CAR)`
          : car.ticks < 240
            ? 'ARROWS DRIVE  R RESTART  V CAR  C CAMERA  H SCENERY  P PIXELS'
            : '',
  });
});
