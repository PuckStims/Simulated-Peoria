/**
 * Orbital camera controller around the stationary miniature diorama (Section 10).
 *
 * Supports:
 *   - 360-degree horizontal revolution
 *   - Elevation inspection (including slight side/cutaway angles)
 *   - Zoom & pan
 *   - Optional slow auto-revolution (pause/resume)
 *   - Reset view & snap to True Geographic North
 *   - Perspective <-> Orthographic switching
 *   - Mouse, touch, and keyboard navigation
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Mutates a point only when it lies beyond the supplied world-space envelope. */
export function clampPointToSphere(point: THREE.Vector3, maxRadius: number): boolean {
  const radiusSq = point.lengthSq();
  if (!Number.isFinite(maxRadius) || radiusSq <= maxRadius * maxRadius) return false;
  point.setLength(maxRadius);
  return true;
}

export class CameraController {
  readonly perspectiveCamera: THREE.PerspectiveCamera;
  readonly orthographicCamera: THREE.OrthographicCamera;
  activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private mode: 'perspective' | 'orthographic' = 'perspective';
  private autoOrbit = false;
  private autoOrbitSpeed = 0.28; // OrbitControls autoRotateSpeed
  private readonly domElement: HTMLElement;
  private readonly defaultTarget = new THREE.Vector3(0, 35, 600);
  private readonly defaultPos = new THREE.Vector3(6800, 5600, 12800);
  private readonly keysDown = new Set<string>();
  private readonly orthoHalfSize = 11000;
  private worldEnvelopeRadius = Number.POSITIVE_INFINITY;

  constructor(domElement: HTMLElement, aspect: number) {
    this.domElement = domElement;

    this.perspectiveCamera = new THREE.PerspectiveCamera(40, aspect, 40, 180000);
    this.perspectiveCamera.position.copy(this.defaultPos);

    this.orthographicCamera = new THREE.OrthographicCamera(
      -this.orthoHalfSize * aspect,
      this.orthoHalfSize * aspect,
      this.orthoHalfSize,
      -this.orthoHalfSize,
      -60000,
      180000
    );
    this.orthographicCamera.position.copy(this.defaultPos);

    this.activeCamera = this.perspectiveCamera;
    this.controls = this.createControls(this.activeCamera);
    this.bindKeyboard();
  }

  private createControls(cam: THREE.Camera): OrbitControls {
    const ctrl = new OrbitControls(cam, this.domElement);
    ctrl.target.copy(this.defaultTarget);
    ctrl.enableDamping = true;
    ctrl.dampingFactor = 0.065;
    ctrl.enablePan = true;
    ctrl.screenSpacePanning = false;
    ctrl.minDistance = 1200;
    ctrl.maxDistance = 42000;
    ctrl.minPolarAngle = 0.08;
    ctrl.maxPolarAngle = Math.PI * 0.56; // Allows inspecting diorama cutaway edge cleanly
    ctrl.autoRotate = this.autoOrbit;
    ctrl.autoRotateSpeed = this.autoOrbitSpeed;
    ctrl.update();
    return ctrl;
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    this.keysDown.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  getMode(): 'perspective' | 'orthographic' {
    return this.mode;
  }

  isAutoOrbit(): boolean {
    return this.autoOrbit;
  }

  setAutoOrbit(enabled: boolean): void {
    this.autoOrbit = enabled;
    this.controls.autoRotate = enabled;
  }

  toggleAutoOrbit(): boolean {
    this.setAutoOrbit(!this.autoOrbit);
    return this.autoOrbit;
  }

  setMode(mode: 'perspective' | 'orthographic', aspect: number): void {
    if (mode === this.mode) return;
    const prevPos = this.activeCamera.position.clone();
    const prevTarget = this.controls.target.clone();
    this.controls.dispose();

    this.mode = mode;
    if (mode === 'orthographic') {
      const dist = prevPos.distanceTo(prevTarget);
      const zoom = Math.max(0.35, Math.min(6, 15000 / Math.max(1000, dist)));
      this.orthographicCamera.zoom = zoom;
      this.orthographicCamera.position.copy(prevPos);
      this.resize(aspect);
      this.activeCamera = this.orthographicCamera;
    } else {
      this.perspectiveCamera.position.copy(prevPos);
      this.perspectiveCamera.aspect = aspect;
      this.perspectiveCamera.updateProjectionMatrix();
      this.activeCamera = this.perspectiveCamera;
    }

    this.controls = this.createControls(this.activeCamera);
    this.controls.target.copy(prevTarget);
    this.controls.update();
  }

  resetView(): void {
    this.controls.target.copy(this.defaultTarget);
    this.activeCamera.position.copy(this.defaultPos);
    if (this.activeCamera instanceof THREE.OrthographicCamera) {
      this.activeCamera.zoom = 1;
      this.activeCamera.updateProjectionMatrix();
    }
    this.controls.update();
  }

  /**
   * Align camera azimuth so it looks straight toward True Geographic North (-Z).
   */
  snapToNorth(): void {
    const offset = this.activeCamera.position.clone().sub(this.controls.target);
    const radiusXZ = Math.hypot(offset.x, offset.z) || 12000;
    this.activeCamera.position.set(
      this.controls.target.x,
      this.controls.target.y + Math.max(1500, offset.y),
      this.controls.target.z + radiusXZ
    );
    this.controls.update();
  }

  /**
   * Compass heading in degrees clockwise from True North (0° = looking toward -Z North).
   */
  getCompassHeadingDeg(): number {
    const dir = this.controls.target.clone().sub(this.activeCamera.position);
    const deg = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }

  getTarget(): THREE.Vector3 {
    return this.controls.target;
  }

  /**
   * Keep the observer within the finite celestial enclosure without rotating or
   * translating the world. The envelope is centered on the stationary diorama.
   */
  setWorldEnvelope(radiusMeters: number): void {
    this.worldEnvelopeRadius = Math.max(2000, radiusMeters * 0.96);
    this.controls.maxDistance = Math.min(42000, radiusMeters * 0.82);
    this.constrainToWorldEnvelope();
  }

  getWorldEnvelopeRadius(): number {
    return this.worldEnvelopeRadius;
  }

  private constrainToWorldEnvelope(): void {
    if (!Number.isFinite(this.worldEnvelopeRadius)) return;

    // Allow useful panning across the 20×25km landscape while leaving room for
    // the camera orbit inside the atmospheric sphere.
    const targetMaxRadius = this.worldEnvelopeRadius * 0.34;
    const targetHorizontal = new THREE.Vector3(this.controls.target.x, 0, this.controls.target.z);
    let constrained = false;
    if (clampPointToSphere(targetHorizontal, targetMaxRadius)) {
      this.controls.target.x = targetHorizontal.x;
      this.controls.target.z = targetHorizontal.z;
      constrained = true;
    }
    constrained = clampPointToSphere(this.activeCamera.position, this.worldEnvelopeRadius) || constrained;
    if (constrained) this.activeCamera.lookAt(this.controls.target);
  }

  resize(aspect: number): void {
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    this.orthographicCamera.left = -this.orthoHalfSize * aspect;
    this.orthographicCamera.right = this.orthoHalfSize * aspect;
    this.orthographicCamera.top = this.orthoHalfSize;
    this.orthographicCamera.bottom = -this.orthoHalfSize;
    this.orthographicCamera.updateProjectionMatrix();
  }

  update(dtSeconds: number): void {
    // Smooth keyboard pan/orbit support
    const panSpeed = 4800 * Math.min(dtSeconds, 0.1);
    if (this.keysDown.size > 0) {
      const forward = new THREE.Vector3();
      this.activeCamera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 1e-6) forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      const delta = new THREE.Vector3();
      if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) delta.addScaledVector(forward, panSpeed);
      if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) delta.addScaledVector(forward, -panSpeed);
      if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) delta.addScaledVector(right, panSpeed);
      if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) delta.addScaledVector(right, -panSpeed);

      if (delta.lengthSq() > 0) {
        this.controls.target.add(delta);
        this.activeCamera.position.add(delta);
      }
    }

    this.controls.update();
    this.constrainToWorldEnvelope();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controls.dispose();
  }
}
