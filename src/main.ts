import * as THREE from 'three';
import { KeyboardInput } from './core/input';
import { createCar, DEFAULT_CAR, DT, INPUT, speedOf, stepCar, type CarState } from './physics/car';
import { quatRotate, type Quat, type Vec3 } from './physics/vec';
import { createCarMesh, setObjectPose } from './render/carMesh';
import { FlyCamera } from './render/flyCamera';
import { createHorizon, type HorizonView } from './render/horizon';
import { buildSampleTrack } from './track/sampleTrack';
import { findStart } from './track/start';
import { buildTrack } from './track/trackBuilder';
import { Horizon } from './track/trkFormat';
import type { CollisionWorld } from './physics/collision';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 6000);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7458, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-200, 400, 150);
scene.add(sun);

const fly = new FlyCamera(camera, renderer.domElement);
const input = new KeyboardInput();
const carObject = createCarMesh();
scene.add(carObject);

// ---- scene state ---------------------------------------------------------------------------
let trackGroup: THREE.Group | null = null;
let horizonView: HorizonView | null = null;
let world: CollisionWorld;
let car: CarState;
let prevPos: Vec3 = [0, 0, 0];
let prevQuat: Quat = [1, 0, 0, 0];
let mode: 'drive' | 'fly' = 'drive';
const camPos = new THREE.Vector3();
let camInit = false;
let startPose: { pos: Vec3; heading: 'N' | 'E' | 'S' | 'W' } = { pos: [0, 0, 1], heading: 'N' };

function resetCar(): void {
  car = createCar(DEFAULT_CAR, startPose.pos, startPose.heading);
  prevPos = [...car.pos];
  prevQuat = [...car.quat];
  camInit = false;
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
  if (start) {
    const f: [number, number] = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] }[start.dir] as [number, number];
    // Start a little behind the line so the player drives through it.
    startPose = { pos: [start.centre[0] - f[0] * 8, start.centre[1] - f[1] * 8, 0.75], heading: start.dir };
  }
  horizonView = createHorizon(h);
  scene.add(horizonView.group);
  scene.fog = new THREE.Fog(horizonView.fogColor, 900, 2800);
  renderer.setClearColor(horizonView.fogColor);
  resetCar();
}

// ---- HUD ------------------------------------------------------------------------------------
const NAMES = ['Desert', 'Tropical', 'Alpine', 'City', 'Country'];
const hud = document.createElement('div');
hud.style.cssText =
  'position:fixed;left:12px;top:10px;color:#fff;font:13px/1.4 monospace;text-shadow:0 1px 2px #000;pointer-events:none;white-space:pre';
document.body.appendChild(hud);
const speedo = document.createElement('div');
speedo.style.cssText =
  'position:fixed;right:18px;bottom:14px;color:#fff;font:bold 42px/1 monospace;text-shadow:0 2px 4px #000;pointer-events:none;text-align:right';
document.body.appendChild(speedo);

let horizon = Horizon.Desert;
function updateHud(): void {
  const help =
    mode === 'drive'
      ? 'Arrows/WASD drive · R restart · C free camera · 1-5 horizon'
      : 'WASD move · Q/E down/up · Shift fast · drag to look · C back to car';
  hud.textContent = `Stunts Web · ${DEFAULT_CAR.name} · horizon: ${NAMES[horizon]}\n${help}`;
}

// ---- debug camera pose from URL -------------------------------------------------------------
// ?cam=x,y,z,yawDeg,pitchDeg puts the free camera somewhere (render space) and switches to fly mode.
// ?car=e,n,u,heading,speed spawns the car there (sim space), e.g. 250,110,0.7,E,24.
const params = new URLSearchParams(location.search);
const camParam = params.get('cam');

window.addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= 5) {
    horizon = (n - 1) as Horizon;
    loadScene(horizon);
    updateHud();
  } else if (e.code === 'KeyC') {
    mode = mode === 'drive' ? 'fly' : 'drive';
    if (mode === 'fly') {
      fly.yaw = Math.atan2(-(camera.getWorldDirection(new THREE.Vector3()).x), -camera.getWorldDirection(new THREE.Vector3()).z);
      fly.pitch = -0.4;
    } else camInit = false;
    updateHud();
  }
});

loadScene(horizon);
const carParam = params.get('car');
if (carParam) {
  const [e, n, u, hd, v] = carParam.split(',');
  car = createCar(DEFAULT_CAR, [Number(e), Number(n), Number(u)], hd as 'N' | 'E' | 'S' | 'W', Number(v ?? 0));
  prevPos = [...car.pos];
  prevQuat = [...car.quat];
}
if (camParam) {
  const [x, y, z, yaw, pitch] = camParam.split(',').map(Number) as [number, number, number, number, number];
  camera.position.set(x, y, z);
  fly.yaw = (yaw * Math.PI) / 180;
  fly.pitch = (pitch * Math.PI) / 180;
  mode = 'fly';
}
updateHud();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---- main loop: fixed 60 Hz simulation, interpolated rendering -----------------------------
let last = performance.now();
let acc = 0;
const up = new THREE.Vector3(0, 1, 0);

renderer.setAnimationLoop((now) => {
  const frame = Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += frame;
  while (acc >= DT) {
    const mask = input.mask();
    if (mask & INPUT.Reset) resetCar();
    prevPos = [...car.pos];
    prevQuat = [...car.quat];
    stepCar(car, DEFAULT_CAR, mask, world);
    acc -= DT;
  }

  // Interpolate between the last two ticks.
  const a = acc / DT;
  const pos: Vec3 = [
    prevPos[0] + (car.pos[0] - prevPos[0]) * a,
    prevPos[1] + (car.pos[1] - prevPos[1]) * a,
    prevPos[2] + (car.pos[2] - prevPos[2]) * a,
  ];
  const dotq = prevQuat[0] * car.quat[0] + prevQuat[1] * car.quat[1] + prevQuat[2] * car.quat[2] + prevQuat[3] * car.quat[3];
  const sgn = dotq < 0 ? -1 : 1;
  const qi: Quat = [0, 0, 0, 0];
  let len = 0;
  for (let i = 0; i < 4; i++) {
    qi[i] = prevQuat[i]! + (sgn * car.quat[i]! - prevQuat[i]!) * a;
    len += qi[i]! * qi[i]!;
  }
  len = Math.sqrt(len);
  for (let i = 0; i < 4; i++) qi[i] = qi[i]! / len;
  setObjectPose(carObject, pos, qi);

  if (mode === 'drive') {
    // Chase camera: behind the car along its horizontal heading, smoothed.
    const f = quatRotate(qi, [0, 1, 0]);
    const hl = Math.hypot(f[0], f[1]) || 1;
    const behind = new THREE.Vector3(-(f[0] / hl) * 9, 0, (f[1] / hl) * 9); // sim north = -Z
    const target = new THREE.Vector3(pos[0], pos[2], -pos[1]).add(behind).addScaledVector(up, 3.6);
    if (!camInit) {
      camPos.copy(target);
      camInit = true;
    } else camPos.lerp(target, 1 - Math.exp(-6 * frame));
    camera.position.copy(camPos);
    camera.lookAt(pos[0], pos[2] + 1.2, -pos[1]);
  } else {
    fly.update(frame);
  }

  horizonView?.follow(camera);
  speedo.textContent = car.crashed
    ? `CRASHED (${car.crashReason})\nR to restart`
    : `${Math.round(speedOf(car) * 3.6)} km/h`;
  renderer.render(scene, camera);
});
