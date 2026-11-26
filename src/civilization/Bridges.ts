/**
 * Elevated bridge decks and piers spanning waterways and valleys (Section 13).
 */

import * as THREE from 'three';
import type { RegionConfig } from '../core/types';
import type { TerrainData } from '../geography/TerrainData';

export interface BridgeRecord {
  id: string;
  name?: string;
  kind: 'road' | 'rail';
  widthMeters: number;
  points: [number, number, number][];
}

export interface BridgesPayload {
  provenance: Record<string, unknown>;
  bridges: BridgeRecord[];
}

export class BridgeSystem {
  readonly group = new THREE.Group();
  private readonly deckMesh: THREE.Mesh | null = null;
  private readonly piersMesh: THREE.InstancedMesh | null = null;
  private readonly deckMat: THREE.MeshStandardMaterial;
  private readonly pierMat: THREE.MeshStandardMaterial;

  constructor(config: RegionConfig, terrainData: TerrainData, payload: BridgesPayload) {
    this.group.name = 'BridgeSystem';
    const datum = config.coordinateSystem.origin.elevationDatumMeters;

    this.deckMat = new THREE.MeshStandardMaterial({
      color: 0x868c94,
      roughness: 0.78,
      metalness: 0.14,
      side: THREE.DoubleSide,
    });
    this.pierMat = new THREE.MeshStandardMaterial({
      color: 0x6c727a,
      roughness: 0.88,
      metalness: 0.08,
    });

    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const pierTransforms: THREE.Matrix4[] = [];
    let vertOffset = 0;

    const dummy = new THREE.Object3D();

    for (const br of payload.bridges) {
      if (br.points.length < 2) continue;
      const halfW = br.widthMeters * 0.55;
      const thickness = 1.8;

      for (let i = 0; i < br.points.length; i++) {
        const [x, elev, z] = br.points[i];
        const prev = br.points[Math.max(0, i - 1)];
        const next = br.points[Math.min(br.points.length - 1, i + 1)];
        let tx = next[0] - prev[0];
        let tz = next[2] - prev[2];
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        const px = -tz * halfW;
        const pz = tx * halfW;
        const y = elev - datum;

        // Top deck strip + underside thickness lip
        positions.push(x - px, y, z - pz, x + px, y, z + pz);
        normals.push(0, 1, 0, 0, 1, 0);

        // Place support piers at interior span vertices where deck is meaningfully above ground
        const groundY = terrainData.sampleYAt(x, z, 1.0);
        if (i > 0 && i < br.points.length - 1 && y - groundY > 2.2) {
          const pierH = y - groundY + 1.0;
          dummy.position.set(x, groundY + pierH * 0.5 - 0.5, z);
          dummy.scale.set(Math.max(2.2, br.widthMeters * 0.35), pierH - thickness * 0.3, Math.max(2.2, br.widthMeters * 0.35));
          dummy.updateMatrix();
          pierTransforms.push(dummy.matrix.clone());
        }
      }

      for (let i = 0; i < br.points.length - 1; i++) {
        const a = vertOffset + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
      vertOffset += br.points.length * 2;
    }

    if (indices.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geom.setIndex(indices);
      this.deckMesh = new THREE.Mesh(geom, this.deckMat);
      this.deckMesh.castShadow = true;
      this.deckMesh.receiveShadow = true;
      this.group.add(this.deckMesh);
    }

    if (pierTransforms.length > 0) {
      const pierGeom = new THREE.BoxGeometry(1, 1, 1);
      this.piersMesh = new THREE.InstancedMesh(pierGeom, this.pierMat, pierTransforms.length);
      this.piersMesh.castShadow = true;
      this.piersMesh.receiveShadow = true;
      for (let i = 0; i < pierTransforms.length; i++) {
        this.piersMesh.setMatrixAt(i, pierTransforms[i]);
      }
      this.piersMesh.instanceMatrix.needsUpdate = true;
      this.group.add(this.piersMesh);
    }
  }

  setVerticalExaggeration(factor: number): void {
    this.group.scale.set(1, factor, 1);
  }

  dispose(): void {
    this.deckMesh?.geometry.dispose();
    this.piersMesh?.geometry.dispose();
    this.deckMat.dispose();
    this.pierMat.dispose();
  }
}
