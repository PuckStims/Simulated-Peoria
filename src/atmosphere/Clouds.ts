/**
 * Multi-layer procedural 3D clouds within the diorama's atmospheric volume (Section 11.3).
 *
 * Three distinct layers:
 *   - Low cumulus (~950m above datum)
 *   - Mid altostratus (~1750m above datum)
 *   - High cirrus (~2850m above datum)
 *
 * Smoothly modulates density/opacity without regenerating the sky on weather updates.
 */

import * as THREE from 'three';
import type { AstronomicalState, EffectiveEnvironmentState, GraphicsQuality, RegionConfig } from '../core/types';

interface CloudPuff {
  x: number;
  y: number;
  z: number;
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  threshold: number;
  layerIndex: 0 | 1 | 2;
  speedFactor: number;
}

export class CloudSystem {
  readonly group = new THREE.Group();
  private readonly instanced: THREE.InstancedMesh;
  private readonly puffs: CloudPuff[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly widthMeters: number;
  private readonly depthMeters: number;
  private readonly dummy = new THREE.Object3D();
  private quality: GraphicsQuality = 'balanced';

  constructor(config: RegionConfig) {
    this.group.name = 'CloudSystem';
    this.widthMeters = config.coordinateSystem.extentMeters.width;
    this.depthMeters = config.coordinateSystem.extentMeters.depth;

    const geom = new THREE.IcosahedronGeometry(1, 1);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xf4f6f8,
      roughness: 0.96,
      metalness: 0.0,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });

    const totalPuffs = 240;
    this.instanced = new THREE.InstancedMesh(geom, this.material, totalPuffs);
    this.instanced.castShadow = false;
    this.instanced.receiveShadow = false;
    this.instanced.frustumCulled = false;

    let seed = 918273;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const layerAltitudes = [920, 1720, 2750];
    const layerSpeeds = [1.0, 1.25, 1.55];

    for (let i = 0; i < totalPuffs; i++) {
      const layerIndex = (i % 3) as 0 | 1 | 2;
      const clusterAngle = rand() * Math.PI * 2;
      const sx =
        layerIndex === 0
          ? 380 + rand() * 520
          : layerIndex === 1
            ? 620 + rand() * 760
            : 880 + rand() * 1100;
      const sy = layerIndex === 0 ? 110 + rand() * 110 : layerIndex === 1 ? 85 + rand() * 70 : 45 + rand() * 40;
      const sz = sx * (0.65 + 0.5 * rand());

      this.puffs.push({
        x: (rand() - 0.5) * this.widthMeters * 0.94,
        y: layerAltitudes[layerIndex] + (rand() - 0.5) * 140,
        z: (rand() - 0.5) * this.depthMeters * 0.94 + Math.sin(clusterAngle) * 120,
        baseScaleX: sx,
        baseScaleY: sy,
        baseScaleZ: sz,
        threshold: rand() * 0.92,
        layerIndex,
        speedFactor: layerSpeeds[layerIndex],
      });
    }

    this.group.add(this.instanced);
    this.setQuality(this.quality);
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    const ratio = quality === 'high' ? 1 : quality === 'balanced' ? 0.75 : 0.45;
    this.instanced.count = Math.max(1, Math.floor(this.puffs.length * ratio));
  }

  getVisibleInstanceCount(): number {
    return this.instanced.count;
  }

  update(
    dtRealSeconds: number,
    astro: AstronomicalState,
    env: EffectiveEnvironmentState,
    sunColor: THREE.Color
  ): void {
    const dt = Math.min(dtRealSeconds, 0.2);
    const halfW = this.widthMeters * 0.48;
    const halfD = this.depthMeters * 0.48;

    const layerCovers = [
      Math.max(env.cloudCoverLow, env.cloudCoverTotal * 0.75),
      Math.max(env.cloudCoverMid, env.cloudCoverTotal * 0.7),
      Math.max(env.cloudCoverHigh, env.cloudCoverTotal * 0.65),
    ];

    const vx = env.windVector[0] * Math.max(1.2, env.windSpeedMs) * 14;
    const vz = env.windVector[1] * Math.max(1.2, env.windSpeedMs) * 14;

    // Tint clouds gently by solar altitude
    const dayT = Math.max(0, Math.min(1, (astro.solarAltitudeRad + 0.06) / 0.3));
    const baseCloud = new THREE.Color(0x1f2838).lerp(new THREE.Color(0xf6f7fa), dayT);
    baseCloud.lerp(sunColor, 0.25 * dayT);
    this.material.color.copy(baseCloud);
    this.material.opacity = 0.26 + 0.52 * env.cloudCoverTotal;

    for (let i = 0; i < this.instanced.count; i++) {
      const p = this.puffs[i];
      p.x += vx * p.speedFactor * dt;
      p.z += vz * p.speedFactor * dt;

      if (p.x > halfW) p.x -= halfW * 2;
      if (p.x < -halfW) p.x += halfW * 2;
      if (p.z > halfD) p.z -= halfD * 2;
      if (p.z < -halfD) p.z += halfD * 2;

      const cover = layerCovers[p.layerIndex];
      const active = Math.max(0, Math.min(1, (cover - p.threshold * 0.85) / 0.25));

      this.dummy.position.set(p.x, p.y, p.z);
      if (active <= 0.01) {
        this.dummy.scale.set(0.001, 0.001, 0.001);
      } else {
        const s = 0.35 + 0.65 * active;
        this.dummy.scale.set(p.baseScaleX * s, p.baseScaleY * s, p.baseScaleZ * s);
      }
      this.dummy.updateMatrix();
      this.instanced.setMatrixAt(i, this.dummy.matrix);
    }

    this.instanced.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.instanced.geometry.dispose();
    this.material.dispose();
  }
}
