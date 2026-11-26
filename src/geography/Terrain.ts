/**
 * Terrain assembly manager: owns multi-chunk LOD terrain meshes and physical substrate.
 */

import * as THREE from 'three';
import type { PersistentSurfaceState, RegionConfig } from '../core/types';
import { TerrainData } from './TerrainData';
import {
  LOD_SEGMENTS,
  buildDioramaSubstrate,
  buildTerrainChunkGeometry,
  updateTerrainChunkColors,
  type TerrainChunk,
} from './TerrainLOD';

export class TerrainSystem {
  readonly group = new THREE.Group();
  readonly elevationScaledGroup = new THREE.Group();
  readonly data: TerrainData;
  private readonly chunks: TerrainChunk[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private verticalExaggeration = 1.0;

  constructor(data: TerrainData) {
    this.data = data;
    this.group.name = 'TerrainSystem';
    this.elevationScaledGroup.name = 'TerrainElevationScaled';
    this.group.add(this.elevationScaledGroup);

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
      flatShading: false,
    });

    this.buildChunks(data.config);
    this.elevationScaledGroup.add(buildDioramaSubstrate(data));
  }

  private buildChunks(config: RegionConfig): void {
    const cxCount = config.terrain.chunksX;
    const czCount = config.terrain.chunksZ;
    const totalW = config.coordinateSystem.extentMeters.width;
    const totalD = config.coordinateSystem.extentMeters.depth;
    const chunkW = totalW / cxCount;
    const chunkD = totalD / czCount;

    for (let cz = 0; cz < czCount; cz++) {
      for (let cx = 0; cx < cxCount; cx++) {
        const minX = -totalW * 0.5 + cx * chunkW;
        const maxX = minX + chunkW;
        const minZ = -totalD * 0.5 + cz * chunkD;
        const maxZ = minZ + chunkD;
        const lods = new Map<number, THREE.Mesh>();

        for (const segs of LOD_SEGMENTS) {
          const geom = buildTerrainChunkGeometry(this.data, minX, maxX, minZ, maxZ, segs);
          const mesh = new THREE.Mesh(geom, this.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.visible = segs === LOD_SEGMENTS[1];
          this.elevationScaledGroup.add(mesh);
          lods.set(segs, mesh);
        }

        this.chunks.push({
          cx,
          cz,
          centerX: 0.5 * (minX + maxX),
          centerZ: 0.5 * (minZ + maxZ),
          minX,
          maxX,
          minZ,
          maxZ,
          lods,
          activeSegs: LOD_SEGMENTS[1],
        });
      }
    }
  }

  setVerticalExaggeration(factor: number): void {
    const clamped = Math.max(1.0, Math.min(4.0, factor));
    if (Math.abs(clamped - this.verticalExaggeration) < 1e-4) return;
    this.verticalExaggeration = clamped;
    this.elevationScaledGroup.scale.set(1, clamped, 1);
  }

  getVerticalExaggeration(): number {
    return this.verticalExaggeration;
  }

  getActiveChunkCount(): number {
    return this.chunks.length;
  }

  updateLOD(cameraWorldPos: THREE.Vector3, maxAllowedSegs: number = 96): void {
    for (const chunk of this.chunks) {
      const dx = cameraWorldPos.x - chunk.centerX;
      const dz = cameraWorldPos.z - chunk.centerZ;
      const dist = Math.hypot(dx, cameraWorldPos.y, dz);

      let desired = 24;
      if (dist < 11000 && maxAllowedSegs >= 96) desired = 96;
      else if (dist < 22000 && maxAllowedSegs >= 48) desired = 48;

      if (desired !== chunk.activeSegs) {
        const prev = chunk.lods.get(chunk.activeSegs);
        const next = chunk.lods.get(desired);
        if (prev) prev.visible = false;
        if (next) next.visible = true;
        chunk.activeSegs = desired;
      }
    }
  }

  updateSurfaceAppearance(surface: PersistentSurfaceState, grassGreenness: number): void {
    // Adjust roughness slightly when surface is wet
    this.material.roughness = 0.9 - 0.25 * surface.wetness;
    for (const chunk of this.chunks) {
      for (const mesh of chunk.lods.values()) {
        updateTerrainChunkColors(mesh.geometry, this.data.config, surface, grassGreenness);
      }
    }
  }

  dispose(): void {
    for (const chunk of this.chunks) {
      for (const mesh of chunk.lods.values()) {
        mesh.geometry.dispose();
      }
    }
    this.material.dispose();
  }
}
