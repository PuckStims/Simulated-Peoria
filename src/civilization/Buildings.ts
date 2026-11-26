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
  /** Legacy coarse import class retained for backwards-compatible region bundles. */
  kind: 'residential' | 'commercial' | 'industrial' | 'civic' | 'landmark' | 'unknown';
  functionCategory?: BuildingFunctionCategory;
  subcategory?: string;
  address?: string;
  occupants?: string[];
  osmTags?: Record<string, string>;
  classificationConfidence?: 'high' | 'medium' | 'low' | 'unknown';
  footprint: [number, number][];
  baseElevationMeters: number;
  heightMeters: number;
  heightEstimated: boolean;
  levels: number;
  roofShape: 'flat' | 'gabled' | 'hipped';
}

export type BuildingFunctionCategory =
  | 'residential' | 'apartments' | 'medical' | 'emergency-medical' | 'retail'
  | 'restaurant' | 'education' | 'government' | 'industrial' | 'warehouse'
  | 'recreation' | 'hospitality' | 'religious' | 'transportation' | 'unknown';
export type BuildingVisualizationMode = 'natural' | 'functional' | 'selective';

export interface BuildingsPayload {
  provenance: Record<string, unknown>;
  buildings: BuildingRecord[];
}

const NATURAL_COLORS: Record<string, number> = {
  residential: 0xc8bfb2,
  commercial: 0xaab4bf,
  industrial: 0x8e9296,
  civic: 0xd4c9b8,
  landmark: 0xc2b29b,
  unknown: 0x9b9b9b,
};

export const BUILDING_FUNCTION_COLORS: Record<BuildingFunctionCategory, number> = {
  residential: 0xd7c49b, apartments: 0xbd9e68, medical: 0x4ba9a0, 'emergency-medical': 0x126f72,
  retail: 0xd6ae3f, restaurant: 0xd78d31, education: 0x8d99de, government: 0xaa94c8,
  industrial: 0x687583, warehouse: 0x43505d, recreation: 0x8aa779, hospitality: 0xc98778,
  religious: 0x9276a8, transportation: 0x638ca9, unknown: 0x8d9194,
};

function categoryFor(building: BuildingRecord): BuildingFunctionCategory {
  if (building.functionCategory) return building.functionCategory;
  switch (building.kind) {
    case 'residential': return 'residential';
    case 'commercial': return 'retail';
    case 'industrial': return 'industrial';
    case 'civic': return 'government';
    case 'landmark': return 'recreation';
    default: return 'unknown';
  }
}

export class BuildingSystem {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly categories = new Map<string, BuildingFunctionCategory>();
  private readonly datumMeters: number;
  private visualizationMode: BuildingVisualizationMode = 'natural';
  private selectedCategories: ReadonlySet<BuildingFunctionCategory> | null = null;

  constructor(config: RegionConfig, payload: BuildingsPayload) {
    this.group.name = 'BuildingSystem';
    this.datumMeters = config.coordinateSystem.origin.elevationDatumMeters;
    this.buildBatchedBuildings(payload.buildings);
  }

  private buildBatchedBuildings(buildings: BuildingRecord[]): void {
    const buckets = new Map<string, THREE.BufferGeometry[]>();
    for (const key of Object.keys(BUILDING_FUNCTION_COLORS)) {
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

      const bucketKey = categoryFor(b);
      buckets.get(bucketKey)!.push(nonIndexed);
    }

    for (const [kind, geoms] of buckets.entries()) {
      if (geoms.length === 0) continue;
      const merged = mergeGeometries(geoms, false);
      for (const g of geoms) g.dispose();
      if (!merged) continue;

      const mat = new THREE.MeshStandardMaterial({
        color: BUILDING_FUNCTION_COLORS[kind as BuildingFunctionCategory],
        roughness: kind === 'retail' ? 0.62 : 0.84,
        metalness: kind === 'retail' ? 0.14 : 0.04,
        emissive: new THREE.Color(kind === 'retail' || kind === 'government' ? 0xffb86b : 0xffa652),
        emissiveIntensity: 0.0,
      });
      this.materials.set(kind, mat);
      this.categories.set(kind, kind as BuildingFunctionCategory);

      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `Buildings_${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.applyPresentation();
  }

  setVisualizationMode(mode: BuildingVisualizationMode): void {
    this.visualizationMode = mode;
    this.applyPresentation();
  }

  setSelectedCategories(categories: Iterable<BuildingFunctionCategory> | null): void {
    this.selectedCategories = categories ? new Set(categories) : null;
    this.applyPresentation();
  }

  private applyPresentation(): void {
    for (const [key, mat] of this.materials) {
      const category = this.categories.get(key)!;
      const selected = !this.selectedCategories || this.selectedCategories.has(category);
      const natural = NATURAL_COLORS[category === 'retail' || category === 'restaurant' || category === 'hospitality' ? 'commercial' : category === 'government' || category === 'education' || category === 'medical' || category === 'emergency-medical' || category === 'religious' ? 'civic' : category] ?? NATURAL_COLORS.unknown;
      mat.color.setHex(this.visualizationMode === 'natural' ? natural : BUILDING_FUNCTION_COLORS[category]);
      // Selective mode deliberately recedes unrelated batches without removing their context.
      mat.transparent = this.visualizationMode === 'selective' && !selected;
      mat.opacity = this.visualizationMode === 'selective' && !selected ? 0.12 : 1;
      mat.depthWrite = mat.opacity >= 1;
      mat.needsUpdate = true;
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
