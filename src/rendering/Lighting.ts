/**
 * Authoritative solar & atmospheric lighting system (Section 9.4).
 *
 * Uses a single parallel DirectionalLight strictly aligned to the shared solarDirection vector.
 * Shadow frustum tracks the camera target for crisp localized shadows.
 */

import * as THREE from 'three';
import type { AstronomicalState, EffectiveEnvironmentState, GraphicsQuality } from '../core/types';

export class LightingSystem {
  readonly group = new THREE.Group();
  readonly sunLight: THREE.DirectionalLight;
  readonly moonLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly sunColor = new THREE.Color(0xfff4df);
  private readonly lightDistance = 26000;
  private shadowsEnabled = true;

  constructor() {
    this.group.name = 'LightingSystem';

    this.sunLight = new THREE.DirectionalLight(0xfff4df, 2.4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2000;
    this.sunLight.shadow.camera.far = 52000;
    this.setShadowSpan(7500);
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 2.5;
    this.group.add(this.sunLight);
    this.group.add(this.sunLight.target);

    this.moonLight = new THREE.DirectionalLight(0x9ab4dc, 0.0);
    this.moonLight.castShadow = false;
    this.group.add(this.moonLight);
    this.group.add(this.moonLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x9dc2e6, 0x3b3831, 0.65);
    this.group.add(this.hemiLight);
  }

  setShadowSpan(halfSpanMeters: number): void {
    const cam = this.sunLight.shadow.camera;
    cam.left = -halfSpanMeters;
    cam.right = halfSpanMeters;
    cam.top = halfSpanMeters;
    cam.bottom = -halfSpanMeters;
    cam.updateProjectionMatrix();
  }

  setQuality(quality: GraphicsQuality): void {
    this.shadowsEnabled = quality !== 'low';
    const size = quality === 'high' ? 4096 : quality === 'balanced' ? 2048 : 1024;
    if (this.sunLight.shadow.mapSize.width !== size) {
      this.sunLight.shadow.mapSize.set(size, size);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
  }

  update(
    astro: AstronomicalState,
    env: EffectiveEnvironmentState,
    focusTarget: THREE.Vector3,
    skyColor: THREE.Color
  ): void {
    const [dx, dy, dz] = astro.solarDirection;

    // Anchor shadow frustum around focus target while maintaining exact parallel solar direction
    this.sunLight.target.position.copy(focusTarget);
    this.sunLight.position.set(
      focusTarget.x + dx * this.lightDistance,
      focusTarget.y + dy * this.lightDistance,
      focusTarget.z + dz * this.lightDistance
    );

    const elevDeg = (astro.solarAltitudeRad * 180) / Math.PI;
    // Smooth extinction near horizon; zero direct sunlight below -1.5° so substrate is never lit from beneath
    const horizonFactor = Math.max(0, Math.min(1, (elevDeg + 1.5) / 8.0));
    const cloudAtten = 1 - 0.68 * env.cloudCoverTotal;

    const warmGold = new THREE.Color(0xff9b54);
    const noonWhite = new THREE.Color(0xfff6e8);
    const warmT = Math.max(0, Math.min(1, elevDeg / 26));
    this.sunColor.copy(warmGold).lerp(noonWhite, warmT);

    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = horizonFactor * (2.65 * cloudAtten);
    this.sunLight.castShadow =
      this.shadowsEnabled && elevDeg > -0.5 && this.sunLight.intensity > 0.08;

    // Moonlight fill during night when Moon is above horizon
    const moonElevDeg = (astro.lunarAltitudeRad * 180) / Math.PI;
    const moonHorizon = Math.max(0, Math.min(1, (moonElevDeg - 1) / 10));
    const nightWeight = 1 - horizonFactor;
    this.moonLight.position.set(
      astro.lunarDirection[0] * this.lightDistance,
      astro.lunarDirection[1] * this.lightDistance,
      astro.lunarDirection[2] * this.lightDistance
    );
    this.moonLight.intensity =
      nightWeight * moonHorizon * (0.08 + 0.24 * astro.lunarIllumination) * (1 - 0.7 * env.cloudCoverTotal);

    // Ambient sky/ground hemisphere
    const dayHemi = 0.34 + 0.56 * horizonFactor;
    this.hemiLight.color.copy(skyColor).lerp(new THREE.Color(0xd0e2f2), 0.35 * horizonFactor);
    this.hemiLight.groundColor.setHex(0x2a2722).lerp(new THREE.Color(0x4c483d), horizonFactor);
    this.hemiLight.intensity = dayHemi;
  }

  dispose(): void {
    this.sunLight.shadow.map?.dispose();
  }
}
