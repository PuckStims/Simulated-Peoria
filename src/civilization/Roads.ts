/**
 * Terrain-following road and railway ribbons batched by class (Section 13).
 */

import * as THREE from 'three';
import type { RegionConfig } from '../core/types';
import type { TerrainData } from '../geography/TerrainData';

export interface RoadRecord {
  id: string;
  name?: string;
  highway: string;
  widthMeters: number;
  points: [number, number][];
}

export interface RoadsPayload {
  provenance: Record<string, unknown>;
  roads: RoadRecord[];
}

export interface RailwayRecord {
  id: string;
  name?: string;
  points: [number, number][];
}

export interface RailwaysPayload {
  provenance: Record<string, unknown>;
  railways: RailwayRecord[];
}

function subdividePolyline(pts: [number, number][], maxStepMeters = 45): [number, number][] {
  if (pts.length < 2) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1];
    const [x1, z1] = pts[i];
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(dist / maxStepMeters));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
    }
  }
  return out;
}

function buildRibbonMesh(
  lines: Array<{ width: number; points: [number, number][] }>,
  terrainData: TerrainData,
  yOffsetMeters: number,
  material: THREE.Material,
  name: string
): THREE.Mesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertOffset = 0;

  for (const line of lines) {
    const dense = subdividePolyline(line.points, 45);
    if (dense.length < 2) continue;
    const halfW = line.width * 0.5;

    for (let i = 0; i < dense.length; i++) {
      const [x, z] = dense[i];
      const prev = dense[Math.max(0, i - 1)];
      const next = dense[Math.min(dense.length - 1, i + 1)];
      let tx = next[0] - prev[0];
      let tz = next[1] - prev[1];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const px = -tz * halfW;
      const pz = tx * halfW;
      const y = terrainData.sampleYAt(x, z, 1.0) + yOffsetMeters;

      positions.push(x - px, y, z - pz, x + px, y, z + pz);
      normals.push(0, 1, 0, 0, 1, 0);
    }

    for (let i = 0; i < dense.length - 1; i++) {
      const a = vertOffset + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    vertOffset += dense.length * 2;
  }

  if (indices.length === 0) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  const mesh = new THREE.Mesh(geom, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}

export class RoadNetworkSystem {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(
    _config: RegionConfig,
    terrainData: TerrainData,
    roadsPayload: RoadsPayload,
    railwaysPayload: RailwaysPayload
  ) {
    this.group.name = 'RoadNetworkSystem';

    const majorLines: Array<{ width: number; points: [number, number][] }> = [];
    const minorLines: Array<{ width: number; points: [number, number][] }> = [];

    const majorSet = new Set([
      'motorway',
      'motorway_link',
      'trunk',
      'trunk_link',
      'primary',
      'primary_link',
      'secondary',
    ]);

    for (const r of roadsPayload.roads) {
      const target = majorSet.has(r.highway) ? majorLines : minorLines;
      target.push({ width: r.widthMeters, points: r.points });
    }

    const majorMat = new THREE.MeshStandardMaterial({
      color: 0xc2b38e,
      roughness: 0.96,
      metalness: 0.0,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const minorMat = new THREE.MeshStandardMaterial({
      color: 0xe0d7bd,
      roughness: 1.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x9e7654,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.materials.push(majorMat, minorMat, railMat);

    const majorMesh = buildRibbonMesh(majorLines, terrainData, 0.55, majorMat, 'Roads_Major');
    const minorMesh = buildRibbonMesh(minorLines, terrainData, 0.4, minorMat, 'Roads_Minor');
    const railMesh = buildRibbonMesh(
      railwaysPayload.railways.map((r) => ({ width: 4.5, points: r.points })),
      terrainData,
      0.65,
      railMat,
      'Railways'
    );

    for (const m of [majorMesh, minorMesh, railMesh]) {
      if (m) {
        this.group.add(m);
        this.meshes.push(m);
      }
    }
  }

  setVerticalExaggeration(factor: number): void {
    this.group.scale.set(1, factor, 1);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
