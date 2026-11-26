/**
 * Deterministic ecological vegetation distribution and seasonal rendering (Section 12).
 *
 * Distributes distinct deciduous, evergreen, riparian/wetland, and urban/park trees
 * strictly within appropriate land-cover polygons and away from water, roads, and buildings.
 */

import * as THREE from 'three';
import type { EffectiveEnvironmentState, GraphicsQuality, PersistentSurfaceState, RegionConfig } from '../core/types';
import type { TerrainData } from '../geography/TerrainData';
import type { HydrologyPayload } from '../geography/Hydrology';
import type { RoadsPayload } from '../civilization/Roads';
import type { BuildingsPayload } from '../civilization/Buildings';
import { computeSeasonalPhenology } from './Seasons';

export interface LandcoverArea {
  id: string;
  kind:
    | 'deciduous'
    | 'evergreen'
    | 'grassland'
    | 'agriculture'
    | 'wetland'
    | 'park'
    | 'urban'
    | 'industrial'
    | 'residential'
    | 'commercial';
  ring: [number, number][];
}

export interface LandcoverPayload {
  provenance: Record<string, unknown>;
  areas: LandcoverArea[];
}

interface TreeInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  species: 'deciduous' | 'evergreen' | 'riparian';
  hueJitter: number;
}

function pointInRing(x: number, z: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringBBox(ring: [number, number][]): [number, number, number, number] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return [minX, minZ, maxX, maxZ];
}

export class VegetationSystem {
  readonly group = new THREE.Group();
  private deciduousMesh: THREE.InstancedMesh | null = null;
  private evergreenMesh: THREE.InstancedMesh | null = null;
  private riparianMesh: THREE.InstancedMesh | null = null;
  private readonly deciduousTrees: TreeInstance[] = [];
  private readonly evergreenTrees: TreeInstance[] = [];
  private readonly riparianTrees: TreeInstance[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly dummy = new THREE.Object3D();
  private lastSeasonSignature = -1;
  private quality: GraphicsQuality = 'balanced';

  constructor(
    config: RegionConfig,
    terrainData: TerrainData,
    landcover: LandcoverPayload,
    hydrology: HydrologyPayload,
    roads: RoadsPayload,
    buildings: BuildingsPayload
  ) {
    this.group.name = 'VegetationSystem';
    this.populateTrees(config, terrainData, landcover, hydrology, roads, buildings);
    this.buildInstancedMeshes();
    this.setQuality(this.quality);
  }

  private populateTrees(
    config: RegionConfig,
    terrainData: TerrainData,
    landcover: LandcoverPayload,
    hydrology: HydrologyPayload,
    roads: RoadsPayload,
    buildings: BuildingsPayload
  ): void {
    // Spatial exclusion hash (100m grid cells) for roads & buildings
    const cellSize = 100;
    const roadCells = new Set<string>();
    const keyFor = (x: number, z: number) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;

    for (const r of roads.roads) {
      for (const [x, z] of r.points) {
        roadCells.add(keyFor(x, z));
      }
    }

    const buildingBoxes: [number, number, number, number][] = [];
    const buildingCells = new Map<string, number[]>();
    for (let i = 0; i < buildings.buildings.length; i++) {
      const b = buildings.buildings[i];
      if (b.footprint.length < 3) continue;
      const bb = ringBBox(b.footprint);
      buildingBoxes.push(bb);
      const cx = (bb[0] + bb[2]) * 0.5;
      const cz = (bb[1] + bb[3]) * 0.5;
      const k = keyFor(cx, cz);
      const list = buildingCells.get(k);
      if (list) list.push(i);
      else buildingCells.set(k, [i]);
    }

    const waterPolys = hydrology.waterBodies
      .filter((w) => w.kind !== 'wetland' && w.outer.length >= 3)
      .map((w) => ({ outer: w.outer, bbox: ringBBox(w.outer) }));

    const isExcluded = (x: number, z: number, elev: number): boolean => {
      if (elev <= config.terrain.waterReferenceElevationMeters + 0.35) return true;
      const k = keyFor(x, z);
      if (roadCells.has(k)) return true;

      const bList = buildingCells.get(k);
      if (bList) {
        for (const idx of bList) {
          const [minX, minZ, maxX, maxZ] = buildingBoxes[idx];
          if (x >= minX - 4 && x <= maxX + 4 && z >= minZ - 4 && z <= maxZ + 4) return true;
        }
      }

      for (const wp of waterPolys) {
        const [minX, minZ, maxX, maxZ] = wp.bbox;
        if (x >= minX && x <= maxX && z >= minZ && z <= maxZ && pointInRing(x, z, wp.outer)) {
          return true;
        }
      }
      return false;
    };

    let seed = 135792468;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const maxTotalTrees = 6500;
    let totalCount = 0;

    // 1. Place trees inside explicit landcover polygons
    for (const area of landcover.areas) {
      if (totalCount >= maxTotalTrees) break;
      if (area.ring.length < 3) continue;
      if (!['deciduous', 'evergreen', 'park', 'wetland', 'residential'].includes(area.kind)) {
        continue;
      }
      const [minX, minZ, maxX, maxZ] = ringBBox(area.ring);
      const step =
        area.kind === 'deciduous' || area.kind === 'evergreen'
          ? 95
          : area.kind === 'park'
            ? 125
            : 185;

      for (let gx = minX + step * 0.5; gx < maxX; gx += step) {
        for (let gz = minZ + step * 0.5; gz < maxZ; gz += step) {
          if (totalCount >= maxTotalTrees) break;
          const x = gx + (rand() - 0.5) * step * 0.72;
          const z = gz + (rand() - 0.5) * step * 0.72;
          if (!pointInRing(x, z, area.ring)) continue;
          const elev = terrainData.sampleElevationAt(x, z);
          if (isExcluded(x, z, elev)) continue;

          const y = elev - config.coordinateSystem.origin.elevationDatumMeters;
          const scale = 11 + rand() * 11;
          const hueJitter = (rand() - 0.5) * 0.14;

          if (area.kind === 'wetland') {
            this.riparianTrees.push({ x, y, z, scale: scale * 0.75, species: 'riparian', hueJitter });
          } else if (area.kind === 'evergreen' || rand() < 0.16) {
            this.evergreenTrees.push({ x, y, z, scale, species: 'evergreen', hueJitter });
          } else {
            this.deciduousTrees.push({ x, y, z, scale, species: 'deciduous', hueJitter });
          }
          totalCount++;
        }
      }
    }

    // 2. Bluff & ravine woodland inference where slope is steep (Illinois River bluffs are naturally wooded)
    const halfW = config.coordinateSystem.extentMeters.width * 0.48;
    const halfD = config.coordinateSystem.extentMeters.depth * 0.48;
    for (let gx = -halfW; gx < halfW && totalCount < maxTotalTrees; gx += 170) {
      for (let gz = -halfD; gz < halfD && totalCount < maxTotalTrees; gz += 170) {
        const x = gx + (rand() - 0.5) * 110;
        const z = gz + (rand() - 0.5) * 110;
        const [, ny] = terrainData.sampleNormalAt(x, z, 1.0);
        const slope = 1 - ny;
        if (slope < 0.035) continue; // Only on natural valley bluffs and ravines
        const elev = terrainData.sampleElevationAt(x, z);
        if (isExcluded(x, z, elev)) continue;

        const y = elev - config.coordinateSystem.origin.elevationDatumMeters;
        const scale = 12 + rand() * 12;
        if (rand() < 0.22) {
          this.evergreenTrees.push({ x, y, z, scale, species: 'evergreen', hueJitter: (rand() - 0.5) * 0.12 });
        } else {
          this.deciduousTrees.push({ x, y, z, scale, species: 'deciduous', hueJitter: (rand() - 0.5) * 0.12 });
        }
        totalCount++;
      }
    }

    // Instance draw ranges render a prefix. Shuffle deterministically by location so
    // low/balanced quality remains geographically representative rather than showing
    // only whichever land-cover polygons were processed first.
    const spatialRank = (tree: TreeInstance) => {
      const x = Math.floor((tree.x + 12000) * 0.1);
      const z = Math.floor((tree.z + 14000) * 0.1);
      return Math.imul(x ^ Math.imul(z, 0x45d9f3b), 0x27d4eb2d) >>> 0;
    };
    for (const trees of [this.deciduousTrees, this.evergreenTrees, this.riparianTrees]) {
      trees.sort((a, b) => spatialRank(a) - spatialRank(b));
    }
  }

  private buildInstancedMeshes(): void {
    const createSpeciesMesh = (
      trees: TreeInstance[],
      geom: THREE.BufferGeometry,
      name: string
    ): THREE.InstancedMesh | null => {
      if (trees.length === 0) return null;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0.02,
      });
      this.materials.push(mat);
      const mesh = new THREE.InstancedMesh(geom, mat, trees.length);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        this.dummy.position.set(t.x, t.y + t.scale * 0.55, t.z);
        this.dummy.scale.set(t.scale, t.scale * 1.15, t.scale);
        this.dummy.rotation.set(0, t.hueJitter * 12, 0);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        mesh.setColorAt(i, new THREE.Color(0x4b6844));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      return mesh;
    };

    const decGeom = new THREE.IcosahedronGeometry(0.65, 1);
    const evgGeom = new THREE.ConeGeometry(0.55, 1.45, 7);
    const ripGeom = new THREE.DodecahedronGeometry(0.55, 0);

    this.deciduousMesh = createSpeciesMesh(this.deciduousTrees, decGeom, 'Vegetation_Deciduous');
    this.evergreenMesh = createSpeciesMesh(this.evergreenTrees, evgGeom, 'Vegetation_Evergreen');
    this.riparianMesh = createSpeciesMesh(this.riparianTrees, ripGeom, 'Vegetation_Riparian');
  }

  setVerticalExaggeration(factor: number): void {
    this.group.scale.set(1, factor, 1);
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    const ratio = quality === 'high' ? 1 : quality === 'balanced' ? 0.75 : 0.45;
    const setCount = (mesh: THREE.InstancedMesh | null, trees: TreeInstance[]) => {
      if (mesh) mesh.count = Math.max(1, Math.floor(trees.length * ratio));
    };
    setCount(this.deciduousMesh, this.deciduousTrees);
    setCount(this.evergreenMesh, this.evergreenTrees);
    setCount(this.riparianMesh, this.riparianTrees);
  }

  getVisibleInstanceCount(): number {
    return (this.deciduousMesh?.count ?? 0) + (this.evergreenMesh?.count ?? 0) + (this.riparianMesh?.count ?? 0);
  }

  update(
    elapsedSeconds: number,
    dayOfYear: number,
    env: EffectiveEnvironmentState,
    surface: PersistentSurfaceState
  ): void {
    const phenology = computeSeasonalPhenology(
      dayOfYear,
      env.vegetationSeasonOverride,
      env.temperatureC
    );
    const seasonSig =
      Math.round(phenology.greenness * 100) +
      Math.round(phenology.autumnFactor * 100) * 1000 +
      Math.round(surface.snowCover * 100) * 1000000;

    const swayAmp = Math.min(0.14, env.windSpeedMs * 0.008);
    const swayX = env.windVector[0] * swayAmp * Math.sin(elapsedSeconds * 1.7);
    const swayZ = env.windVector[1] * swayAmp * Math.sin(elapsedSeconds * 1.7);

    // Update seasonal colors when phenology or snow changes noticeably
    if (seasonSig !== this.lastSeasonSignature) {
      this.lastSeasonSignature = seasonSig;
      const color = new THREE.Color();
      const snow = surface.snowCover;

      if (this.deciduousMesh) {
        const summerCol = new THREE.Color(0x46633c);
        const springCol = new THREE.Color(0x5f7d45);
        const autumnCol = new THREE.Color(0xa66b2d);
        const winterCol = new THREE.Color(0x5a5149);
        const base = winterCol
          .clone()
          .lerp(springCol, phenology.leafRetention)
          .lerp(summerCol, phenology.greenness)
          .lerp(autumnCol, phenology.autumnFactor);

        for (let i = 0; i < this.deciduousMesh.count; i++) {
          const t = this.deciduousTrees[i];
          color.copy(base).offsetHSL(t.hueJitter * 0.15, 0, t.hueJitter * 0.08);
          if (snow > 0.05) {
            color.lerp(new THREE.Color(0xdbe4ec), snow * 0.55);
          }
          this.deciduousMesh.setColorAt(i, color);
        }
        if (this.deciduousMesh.instanceColor) this.deciduousMesh.instanceColor.needsUpdate = true;
      }

      if (this.evergreenMesh) {
        const evgBase = new THREE.Color(0x2f4d36);
        for (let i = 0; i < this.evergreenMesh.count; i++) {
          const t = this.evergreenTrees[i];
          color.copy(evgBase).offsetHSL(0, 0, t.hueJitter * 0.06);
          if (snow > 0.05) {
            color.lerp(new THREE.Color(0xd7e1ea), snow * 0.45);
          }
          this.evergreenMesh.setColorAt(i, color);
        }
        if (this.evergreenMesh.instanceColor) this.evergreenMesh.instanceColor.needsUpdate = true;
      }

      if (this.riparianMesh) {
        const ripBase = new THREE.Color(0x5f6b47).lerp(new THREE.Color(0x7c6e4b), phenology.autumnFactor);
        for (let i = 0; i < this.riparianMesh.count; i++) {
          color.copy(ripBase);
          if (snow > 0.05) color.lerp(new THREE.Color(0xdce5ed), snow * 0.4);
          this.riparianMesh.setColorAt(i, color);
        }
        if (this.riparianMesh.instanceColor) this.riparianMesh.instanceColor.needsUpdate = true;
      }
    }

    // Gentle wind-driven sway on canopies (skip heavy matrix updates if nearly calm)
    if (this.deciduousMesh && swayAmp > 0.005) {
      const canopyScale = 0.52 + 0.48 * phenology.leafRetention;
      for (let i = 0; i < this.deciduousMesh.count; i++) {
        const t = this.deciduousTrees[i];
        this.dummy.position.set(t.x + swayX * t.scale, t.y + t.scale * 0.55, t.z + swayZ * t.scale);
        this.dummy.scale.set(t.scale * canopyScale, t.scale * 1.15 * canopyScale, t.scale * canopyScale);
        this.dummy.rotation.set(swayZ * 0.4, t.hueJitter * 12, -swayX * 0.4);
        this.dummy.updateMatrix();
        this.deciduousMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.deciduousMesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.deciduousMesh?.geometry.dispose();
    this.evergreenMesh?.geometry.dispose();
    this.riparianMesh?.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
