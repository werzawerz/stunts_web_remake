import * as THREE from 'three';
import { createHorizon, type HorizonView } from './render/horizon';
import { FlyCamera } from './render/flyCamera';
import { buildSampleTrack } from './track/sampleTrack';
import { buildTrack } from './track/trackBuilder';
import { Horizon } from './track/trkFormat';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 6000);
// Start south of the track looking north across it (north = -Z in render space).
camera.position.set(300, 230, 80);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7458, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-200, 400, 150);
scene.add(sun);

const fly = new FlyCamera(camera, renderer.domElement);
fly.pitch = -0.55;

// Debug/screenshot aid: ?cam=x,y,z,yawDeg,pitchDeg (render space: x east, y up, z = -north).
const camParam = new URLSearchParams(location.search).get('cam');
if (camParam) {
  const [x, y, z, yaw, pitch] = camParam.split(',').map(Number) as [number, number, number, number, number];
  camera.position.set(x, y, z);
  fly.yaw = (yaw * Math.PI) / 180;
  fly.pitch = (pitch * Math.PI) / 180;
}

let trackGroup: THREE.Group | null = null;
let horizonView: HorizonView | null = null;

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
  trackGroup = buildTrack(buildSampleTrack(h));
  scene.add(trackGroup);
  horizonView = createHorizon(h);
  scene.add(horizonView.group);
  scene.fog = new THREE.Fog(horizonView.fogColor, 900, 2800);
  renderer.setClearColor(horizonView.fogColor);
}

const NAMES = ['Desert', 'Tropical', 'Alpine', 'City', 'Country'];
const hud = document.createElement('div');
hud.style.cssText =
  'position:fixed;left:12px;top:10px;color:#fff;font:13px/1.4 monospace;text-shadow:0 1px 2px #000;pointer-events:none';
document.body.appendChild(hud);

function setHorizon(h: Horizon): void {
  loadScene(h);
  hud.textContent = `Stunts Web — track viewer · horizon: ${NAMES[h]}\nWASD move · Q/E down/up · Shift fast · drag to look · 1-5 change horizon`;
  hud.style.whiteSpace = 'pre';
}

window.addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= 5) setHorizon((n - 1) as Horizon);
});

setHorizon(Horizon.Desert);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fly.update(dt);
  horizonView?.follow(camera);
  renderer.render(scene, camera);
});
