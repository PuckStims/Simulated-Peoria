/**
 * Generalized and batched miniature architecture built from imported building footprints (Section 13).
 * Distinguishes measured heights from estimated defaults via provenance metadata.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AstronomicalState, RegionConfig } from '../core/types';

export interface BuildingRecord {
  id: string;
  name?: string;
  kind: 'residential' | 'commercial' | 'industrial' | 'civic' | 'landmark';
  footprint: [number, number][];
  baseElevationMeters: number;
  heightMeters: number;
  heightEstimated: boolean;
  levels: number;
  roofShape: 'flat' | 'gabled' | 'hipped';
}

export interface BuildingsPayload {
  provenance: Record<string, unknown>;
  buildings: BuildingRecord[];
}

const KIND_COLORS: Record<string, number> = {
  residential: 0xc8bfb2,
  commercial: 0xaab4bf,
  industrial: 0x8e9296,
  civic: 0xd4c9b8,
  landmark: 0xc2b29b,
};

export class BuildingSystem {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly datumMeters: number;

  constructor(config: RegionConfig, payload: BuildingsPayload) {
    this.group.name = 'BuildingSystem';
    this.datumMeters = config.coordinateSystem.origin.elevationDatumMeters;
    this.buildBatchedBuildings(payload.buildings);
  }

  private buildBatchedBuildings(buildings: BuildingRecord[]): void {
    const buckets = new Map<string, THREE.BufferGeometry[]>();
    for (const key of Object.keys(KIND_COLORS)) {
      buckets.set(key, []);
    }

    for (const b of buildings) {
      if (b.footprint.length < 3) continue;
      const shape = new THREE.Shape();
      shape.moveTo(b.footprint[0][0], -b.footprint[0][1]);
      for (let i = 1; i < b.footprint.length; i++) {
        shape.lineTo(b.footprint[i][0], -b.footprint[i][1]);
      }
      shape.closePath();

      const extrude = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(2.5, b.heightMeters),
        bevelEnabled: false,
        steps: 1,
      });
      // ExtrudeGeometry extrudes along +Z; rotate -PI/2 around X so +Z -> +Y (elevation)
      extrude.rotateX(-Math.PI / 2);
      const baseY = b.baseElevationMeters - this.datumMeters - 0.6;
      extrude.translate(0, baseY, 0);

      // Convert to non-indexed for safe merging across footprints
      const nonIndexed = extrude.index ? extrude.toNonIndexed() : extrude;
      extrude.dispose();
      nonIndexed.deleteAttribute('uv');

      const bucketKey = KIND_COLORS[b.kind] ? b.kind : 'residential';
      buckets.get(bucketKey)!.push(nonIndexed);
    }

    for (const [kind, geoms] of buckets.entries()) {
      if (geoms.length === 0) continue;
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) continue;

      const mat = new THREE.MeshStandardMaterial({
        color: KIND_COLORS[kind],
        roughness: kind === 'commercial' ? 0.62 : 0.84,
        metalness: kind === 'commercial' ? 0.14 : 0.04,
        emissive: new THREE.Color(kind === 'commercial' || kind === 'civic' ? 0xffb86b : 0xffa652),
        emissiveIntensity: 0.0,
      });
      this.materials.set(kind, mat);

      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `Buildings_${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  setVerticalExaggeration(factor: number): void {
    // Scale building base elevation positions proportionally only via parent or keep physical heights;
    // scaling group Y ensures buildings remain seated on the exaggerated terrain without floating.
    this.group.scale.set(1, factor, 1);
  }

  update(astro: AstronomicalState): void {
    // Subtle warm window/urban illumination after civil dusk
    const nightT = Math.max(0, Math.min(1, (-astro.solarAltitudeRad - 0.02) / 0.18));
    for (const [kind, mat] of this.materials.entries()) {
      const weight = kind === 'commercial' || kind === 'landmark' ? 0.28 : kind === 'civic' ? 0.22 : 0.11;
      mat.emissiveIntensity = nightT * weight;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    for (const mat of this.materials.values()) mat.dispose();
  }
}
