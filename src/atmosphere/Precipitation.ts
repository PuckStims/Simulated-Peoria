/**
 * Region-bounded 3D precipitation particles (rain & snow) in world space (Section 11.5).
 * Strictly contained within the regional extent and above the terrain surface.
 */

import * as THREE from 'three';
import type { EffectiveEnvironmentState, RegionConfig } from '../core/types';
import type { TerrainData } from '../geography/TerrainData';

export class PrecipitationSystem {
  readonly group = new THREE.Group();
  private readonly maxParticles = 3200;
  private readonly points: THREE.Points;
  private readonly material: THREE.PointsMaterial;
  private readonly positions: Float32Array;
  private readonly halfW: number;
  private readonly halfD: number;
  private readonly ceilingY = 1400;
  private readonly terrainData: TerrainData;
  private verticalExaggeration = 1.0;

  constructor(config: RegionConfig, terrainData: TerrainData) {
    this.group.name = 'PrecipitationSystem';
    this.terrainData = terrainData;
    this.halfW = config.coordinateSystem.extentMeters.width * 0.49;
    this.halfD = config.coordinateSystem.extentMeters.depth * 0.49;

    this.positions = new Float32Array(this.maxParticles * 3);

    let seed = 773311;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < this.maxParticles; i++) {
      const x = (rand() * 2 - 1) * this.halfW;
      const z = (rand() * 2 - 1) * this.halfD;
      const gy = terrainData.sampleYAt(x, z, 1.0);
      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = gy + 2 + rand() * (this.ceilingY - gy);
      this.positions[i * 3 + 2] = z;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geom.setDrawRange(0, 0);

    this.material = new THREE.PointsMaterial({
      color: 0xc9d9e8,
      size: 28,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });

    this.points = new THREE.Points(geom, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  setVerticalExaggeration(factor: number): void {
    this.verticalExaggeration = factor;
  }

  /**
   * Expose active particle bounds for automated verification tests.
   */
  getParticlePositions(): Float32Array {
    return this.positions;
  }

  getActiveCount(): number {
    return this.points.geometry.drawRange.count;
  }

  update(dtRealSeconds: number, env: EffectiveEnvironmentState, qualityScale = 1.0): void {
    const intensity = env.precipitationType === 'none' ? 0 : env.precipitationIntensity;
    const activeCount = Math.floor(this.maxParticles * intensity * qualityScale);
    this.points.geometry.setDrawRange(0, activeCount);
    this.points.visible = activeCount > 0;
    if (activeCount <= 0) return;

    const dt = Math.min(dtRealSeconds, 0.15);
    const isSnow = env.precipitationType === 'snow';
    this.material.color.setHex(isSnow ? 0xf2f6fa : 0xa6c4de);
    this.material.size = isSnow ? 42 : 26;
    this.material.opacity = isSnow ? 0.85 : 0.65;

    const fallSpeed = isSnow ? 65 : 360;
    const windDriftScale = isSnow ? 38 : 22;
    const vx = env.windVector[0] * env.windSpeedMs * windDriftScale;
    const vz = env.windVector[1] * env.windSpeedMs * windDriftScale;

    for (let i = 0; i < activeCount; i++) {
      let x = this.positions[i * 3] + vx * dt;
      let y = this.positions[i * 3 + 1] - fallSpeed * dt;
      let z = this.positions[i * 3 + 2] + vz * dt;

      if (x > this.halfW) x -= this.halfW * 2;
      else if (x < -this.halfW) x += this.halfW * 2;
      if (z > this.halfD) z -= this.halfD * 2;
      else if (z < -this.halfD) z += this.halfD * 2;

      const minGround = this.terrainData.sampleYAt(x, z, this.verticalExaggeration) + 2.0;
      if (y < minGround) {
        y = this.ceilingY;
      }

      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
    }

    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
