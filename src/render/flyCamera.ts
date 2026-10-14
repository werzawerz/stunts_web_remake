import * as THREE from 'three';

/** Debug free-fly camera: WASD move, Q/E down/up, hold Shift for speed, drag mouse to look. */
export class FlyCamera {
  yaw = 0;
  pitch = -0.6;
  private readonly keys = new Set<string>();
  private dragging = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    camera.rotation.order = 'YXZ';
    window.addEventListener('keydown', (e) => {
      if (!(e.target instanceof HTMLInputElement)) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointerup', () => (this.dragging = false));
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.003;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.003));
    });
    this.apply();
  }

  update(dt: number): void {
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 700 : 200) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position;
    if (this.keys.has('KeyW')) p.addScaledVector(fwd, speed);
    if (this.keys.has('KeyS')) p.addScaledVector(fwd, -speed);
    if (this.keys.has('KeyD')) p.addScaledVector(right, speed);
    if (this.keys.has('KeyA')) p.addScaledVector(right, -speed);
    if (this.keys.has('KeyE')) p.y += speed;
    if (this.keys.has('KeyQ')) p.y -= speed;
    p.y = Math.max(p.y, 1);
    this.apply();
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
