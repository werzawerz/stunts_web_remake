import * as THREE from 'three';

// Milestone 1 placeholder: proves the build + deploy pipeline before the real game lands.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5fa8e8);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x806040, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 5, 2);
scene.add(sun);

const car = new THREE.Mesh(
  new THREE.BoxGeometry(1.8, 0.6, 3.8),
  new THREE.MeshLambertMaterial({ color: 0xd02020, flatShading: true }),
);
scene.add(car);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshLambertMaterial({ color: 0xc8a060 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.3;
scene.add(ground);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

renderer.setAnimationLoop((t) => {
  car.rotation.y = t / 1000;
  renderer.render(scene, camera);
});
