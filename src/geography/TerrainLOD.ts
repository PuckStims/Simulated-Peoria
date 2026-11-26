/**
 * Chunked LOD terrain geometry with seamless edge skirts and physical diorama cutaway substrate.
 */

import * as THREE from 'three';
import type { PersistentSurfaceState, RegionConfig } from '../core/types';
import type { TerrainData } from './TerrainData';

export interface TerrainChunk {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  lods: Map<number, THREE.Mesh>;
  activeSegs: number;
}

const LOD_SEGMENTS = [96, 48, 24] as const;

export function buildTerrainChunkGeometry(
  data: TerrainData,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  segs: number,
  skirtDepthMeters = 8.0
): THREE.BufferGeometry {
  const vertsPerSide = segs + 1;
  const surfaceCount = vertsPerSide * vertsPerSide;
  const skirtVertsCount = vertsPerSide * 4 * 2;
  const totalVerts = surfaceCount + skirtVertsCount;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const uvAttrs = new Float32Array(totalVerts * 2);
  // Store [elevationMeters, slopeFactor] in custom attribute for fast seasonal/snow/wetness updates
  const terrainMeta = new Float32Array(totalVerts * 2);

  const width = maxX - minX;
  const depth = maxZ - minZ;

  for (let r = 0; r <= segs; r++) {
    const v = r / segs;
    const z = minZ + v * depth;
    for (let c = 0; c <= segs; c++) {
      const u = c / segs;
      const x = minX + u * width;
      const idx = r * vertsPerSide + c;
      const elev = data.sampleElevationAt(x, z);
      const y = elev - data.datumMeters;
      const [nx, ny, nz] = data.sampleNormalAt(x, z, 1.0);

      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      normals[idx * 3] = nx;
      normals[idx * 3 + 1] = ny;
      normals[idx * 3 + 2] = nz;

      uvAttrs[idx * 2] = (x + data.widthMeters * 0.5) / data.widthMeters;
      uvAttrs[idx * 2 + 1] = (z + data.depthMeters * 0.5) / data.depthMeters;

      const slope = 1 - Math.max(0, Math.min(1, ny));
      terrainMeta[idx * 2] = elev;
      terrainMeta[idx * 2 + 1] = slope;

      // Initial neutral warm-earth miniature tone
      colors[idx * 3] = 0.42;
      colors[idx * 3 + 1] = 0.46;
      colors[idx * 3 + 2] = 0.34;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < segs; r++) {
    for (let c = 0; c < segs; c++) {
      const a = r * vertsPerSide + c;
      const b = a + 1;
      const d = (r + 1) * vertsPerSide + c;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  // Add vertical skirts along all 4 chunk borders so LOD transitions never show cracks
  let skirtCursor = surfaceCount;
  const addSkirtEdge = (edgeIndices: number[], reverseWinding: boolean) => {
    const startCursor = skirtCursor;
    for (let i = 0; i < edgeIndices.length; i++) {
      const src = edgeIndices[i];
      const topIdx = skirtCursor++;
      const botIdx = skirtCursor++;

      const x = positions[src * 3];
      const y = positions[src * 3 + 1];
      const z = positions[src * 3 + 2];

      for (const dst of [topIdx, botIdx]) {
        positions[dst * 3] = x;
        positions[dst * 3 + 1] = dst === topIdx ? y : y - skirtDepthMeters;
        positions[dst * 3 + 2] = z;
        normals[dst * 3] = normals[src * 3];
        normals[dst * 3 + 1] = normals[src * 3 + 1];
        normals[dst * 3 + 2] = normals[src * 3 + 2];
        colors[dst * 3] = colors[src * 3];
        colors[dst * 3 + 1] = colors[src * 3 + 1];
        colors[dst * 3 + 2] = colors[src * 3 + 2];
        terrainMeta[dst * 2] = terrainMeta[src * 2];
        terrainMeta[dst * 2 + 1] = terrainMeta[src * 2 + 1];
      }
    }
    for (let i = 0; i < edgeIndices.length - 1; i++) {
      const t0 = startCursor + i * 2;
      const b0 = t0 + 1;
      const t1 = t0 + 2;
      const b1 = t0 + 3;
      if (reverseWinding) {
        indices.push(t0, t1, b0, t1, b1, b0);
      } else {
        indices.push(t0, b0, t1, t1, b0, b1);
      }
    }
  };

  const northEdge: number[] = [];
  const southEdge: number[] = [];
  const westEdge: number[] = [];
  const eastEdge: number[] = [];
  for (let i = 0; i <= segs; i++) {
    northEdge.push(i);
    southEdge.push(segs * vertsPerSide + i);
    westEdge.push(i * vertsPerSide);
    eastEdge.push(i * vertsPerSide + segs);
  }
  addSkirtEdge(northEdge, false);
  addSkirtEdge(southEdge, true);
  addSkirtEdge(westEdge, true);
  addSkirtEdge(eastEdge, false);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvAttrs, 2));
  geom.setAttribute('terrainMeta', new THREE.BufferAttribute(terrainMeta, 2));
  geom.setIndex(indices);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Update vertex colors across a terrain chunk geometry based on elevation, slope,
 * seasonal vegetation state, surface wetness, and snow accumulation.
 */
export function updateTerrainChunkColors(
  geom: THREE.BufferGeometry,
  config: RegionConfig,
  surface: PersistentSurfaceState,
  grassGreenness: number
): void {
  const colorAttr = geom.getAttribute('color') as THREE.BufferAttribute;
  const metaAttr = geom.getAttribute('terrainMeta') as THREE.BufferAttribute;
  const colors = colorAttr.array as Float32Array;
  const meta = metaAttr.array as Float32Array;

  const waterRef = config.terrain.waterReferenceElevationMeters;
  const wetness = surface.wetness;
  const snowCover = surface.snowCover;
  const autumn = surface.foliageAutumnFactor;

  const count = colorAttr.count;
  for (let i = 0; i < count; i++) {
    const elev = meta[i * 2];
    const slope = meta[i * 2 + 1];

    // Natural Illinois River Valley palette (muted cartographic miniature tones):
    // Floodplain / river silt -> valley meadow -> wooded bluff limestone -> agricultural upland
    const heightAboveRiver = elev - waterRef;
    const floodplainT = Math.max(0, Math.min(1, heightAboveRiver / 10));
    const uplandT = Math.max(0, Math.min(1, (heightAboveRiver - 26) / 28));
    const bluffSlopeT = Math.max(0, Math.min(1, slope * 5.2));

    // Base dormant/earth tone vs living grass tone
    let r = 0.44 - 0.14 * grassGreenness + 0.06 * autumn;
    let g = 0.41 + 0.08 * grassGreenness - 0.03 * autumn;
    let b = 0.31 - 0.06 * grassGreenness;

    // Floodplain moist dark loam near river level
    r = r * (0.76 + 0.24 * floodplainT);
    g = g * (0.78 + 0.22 * floodplainT);
    b = b * (0.74 + 0.26 * floodplainT);

    // Upland prairie / farmland warmer olive-ochre
    r = r * (1 - 0.22 * uplandT) + 0.49 * (0.22 * uplandT);
    g = g * (1 - 0.22 * uplandT) + (0.46 + 0.05 * grassGreenness) * (0.22 * uplandT);
    b = b * (1 - 0.22 * uplandT) + 0.34 * (0.22 * uplandT);

    // Exposed bluff faces: muted limestone & shale
    r = r * (1 - bluffSlopeT) + 0.50 * bluffSlopeT;
    g = g * (1 - bluffSlopeT) + 0.47 * bluffSlopeT;
    b = b * (1 - bluffSlopeT) + 0.42 * bluffSlopeT;

    // Surface wetness darkens soils subtly
    const wetDarken = 1 - 0.26 * wetness * (1 - bluffSlopeT * 0.5);
    r *= wetDarken;
    g *= wetDarken;
    b *= wetDarken;

    // Snow retention: reduced on steep bluffs and slightly higher on uplands
    if (snowCover > 0.01) {
      const slopeRetention = Math.max(0.15, 1 - slope * 3.4);
      const elevBonus = Math.min(1.15, 0.9 + heightAboveRiver * 0.004);
      const localSnow = Math.max(0, Math.min(1, snowCover * slopeRetention * elevBonus));
      r = r * (1 - localSnow) + 0.89 * localSnow;
      g = g * (1 - localSnow) + 0.92 * localSnow;
      b = b * (1 - localSnow) + 0.95 * localSnow;
    }

    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  colorAttr.needsUpdate = true;
}

/**
 * Construct the physical cutaway diorama substrate beneath the terrain perimeter.
 * This is purely a presentation plinth and does not alter the terrain heightfield.
 */
export function buildDioramaSubstrate(data: TerrainData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'DioramaSubstrate';

  const halfW = data.widthMeters * 0.5;
  const halfD = data.depthMeters * 0.5;
  const bottomY = data.config.terrain.substrateBottomMeters - data.datumMeters;

  const sideMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
  });

  // Sample perimeter edges at ~100m resolution for crisp cutaway strata
  const segsX = Math.min(200, data.cols - 1);
  const segsZ = Math.min(250, data.rows - 1);

  const buildWall = (
    count: number,
    coordAt: (i: number) => [number, number],
    normalVec: [number, number, number],
    flip: boolean
  ) => {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= count; i++) {
      const [x, z] = coordAt(i);
      const topY = data.sampleYAt(x, z, 1.0);
      const midY = bottomY + (topY - bottomY) * 0.48;

      // 3 vertical strata vertices: top soil/loess, middle limestone, bottom dark shale
      const strata: [number, [number, number, number]][] = [
        [topY, [0.34, 0.30, 0.25]],
        [midY, [0.24, 0.23, 0.22]],
        [bottomY, [0.14, 0.15, 0.17]],
      ];
      for (const [y, col] of strata) {
        positions.push(x, y, z);
        normals.push(normalVec[0], normalVec[1], normalVec[2]);
        colors.push(col[0], col[1], col[2]);
      }
    }

    for (let i = 0; i < count; i++) {
      const a0 = i * 3;
      const a1 = a0 + 1;
      const a2 = a0 + 2;
      const b0 = (i + 1) * 3;
      const b1 = b0 + 1;
      const b2 = b0 + 2;
      if (flip) {
        indices.push(a0, a1, b0, b0, a1, b1);
        indices.push(a1, a2, b1, b1, a2, b2);
      } else {
        indices.push(a0, b0, a1, b0, b1, a1);
        indices.push(a1, b1, a2, b1, b2, a2);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(indices);
    const mesh = new THREE.Mesh(geom, sideMat);
    mesh.receiveShadow = true;
    return mesh;
  };

  group.add(
    buildWall(segsX, (i) => [-halfW + (i / segsX) * data.widthMeters, -halfD], [0, 0, -1], true),
    buildWall(segsX, (i) => [-halfW + (i / segsX) * data.widthMeters, halfD], [0, 0, 1], false),
    buildWall(segsZ, (i) => [-halfW, -halfD + (i / segsZ) * data.depthMeters], [-1, 0, 0], false),
    buildWall(segsZ, (i) => [halfW, -halfD + (i / segsZ) * data.depthMeters], [1, 0, 0], true)
  );

  // Architectural base plate below substrate
  const plinthHeight = 140;
  const plinthGeom = new THREE.BoxGeometry(data.widthMeters + 240, plinthHeight, data.depthMeters + 240);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x16191f,
    roughness: 0.85,
    metalness: 0.12,
  });
  const plinth = new THREE.Mesh(plinthGeom, plinthMat);
  plinth.position.set(0, bottomY - plinthHeight * 0.5, 0);
  plinth.receiveShadow = false;
  group.add(plinth);

  return group;
}

export { LOD_SEGMENTS };
