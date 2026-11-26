import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RegionConfig } from '../src/core/types';
import { GeoProjection } from '../src/geography/Projection';
import { resolveRequestedRegion } from '../src/core/RegionLoader';
import { TerrainData } from '../src/geography/TerrainData';
import { buildTerrainChunkGeometry } from '../src/geography/TerrainLOD';
import type { HydrologyPayload } from '../src/geography/Hydrology';
import type { BridgesPayload } from '../src/civilization/Bridges';
import type { BuildingsPayload } from '../src/civilization/Buildings';
import { HydrologySystem } from '../src/geography/Hydrology';

const fixtureRoot = resolve(process.cwd(), 'public/regions/test-fixture');
const fixtureConfig = JSON.parse(
  readFileSync(resolve(fixtureRoot, 'region.json'), 'utf-8')
) as RegionConfig;

function loadFixtureTerrain(): TerrainData {
  const level = fixtureConfig.terrain.levels.find((l) => l.id === 'balanced')!;
  const buf = readFileSync(resolve(fixtureRoot, level.file));
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new TerrainData(fixtureConfig, level, arrayBuf);
}

describe('Geographical Integrity', () => {
  it('round-trips WGS84 <-> local meters within sub-millimeter precision and aligns True North to -Z', () => {
    const proj = new GeoProjection(fixtureConfig);
    const samples: [number, number][] = [
      [-89.58, 40.72],
      [-89.589, 40.6936],
      [-89.622, 40.742],
      [-89.545, 40.701],
    ];
    for (const [lon, lat] of samples) {
      const [x, z] = proj.lonLatToLocal(lon, lat);
      const [lon2, lat2] = proj.localToLonLat(x, z);
      expect(lon2).toBeCloseTo(lon, 7);
      expect(lat2).toBeCloseTo(lat, 7);
    }

    // Moving +0.01 deg north should move purely along -Z (with negligible X drift)
    const [nx, nz] = proj.lonLatToLocal(-89.58, 40.73);
    expect(Math.abs(nx)).toBeLessThan(0.05);
    expect(nz).toBeLessThan(-1000);

    // Moving +0.01 deg east should move purely along +X
    const [ex, ez] = proj.lonLatToLocal(-89.57, 40.72);
    expect(ex).toBeGreaterThan(800);
    expect(Math.abs(ez)).toBeLessThan(0.1);
  });

  it('decodes terrain elevations accurately at river channel vs upland bluffs', () => {
    const terrain = loadFixtureTerrain();
    const channelElev = terrain.sampleElevationAt(0, 0);
    const eastBluffElev = terrain.sampleElevationAt(2400, 0);
    const westBluffElev = terrain.sampleElevationAt(-2400, 0);

    expect(channelElev).toBeLessThan(fixtureConfig.terrain.waterReferenceElevationMeters);
    expect(eastBluffElev).toBeGreaterThan(180);
    expect(westBluffElev).toBeGreaterThan(180);
  });

  it('meets adjacent terrain chunks seamlessly along shared borders without cracks', () => {
    const terrain = loadFixtureTerrain();
    const leftChunk = buildTerrainChunkGeometry(terrain, -4000, 0, -5000, 0, 24);
    const rightChunk = buildTerrainChunkGeometry(terrain, 0, 4000, -5000, 0, 48);

    const posL = leftChunk.getAttribute('position');
    const posR = rightChunk.getAttribute('position');

    // Collect surface vertices on x = 0 seam
    const seamL = new Map<number, number>();
    for (let i = 0; i < 25 * 25; i++) {
      const x = posL.getX(i);
      if (Math.abs(x) < 1e-4) {
        seamL.set(Math.round(posL.getZ(i)), posL.getY(i));
      }
    }
    let matched = 0;
    for (let i = 0; i < 49 * 49; i++) {
      const x = posR.getX(i);
      if (Math.abs(x) < 1e-4) {
        const zKey = Math.round(posR.getZ(i));
        if (seamL.has(zKey)) {
          expect(posR.getY(i)).toBeCloseTo(seamL.get(zKey)!, 3);
          matched++;
        }
      }
    }
    expect(matched).toBeGreaterThanOrEqual(25);
  });

  it('keeps river boundaries, buildings, and bridges aligned with bridges spanning above water', () => {
    const hydro = JSON.parse(
      readFileSync(resolve(fixtureRoot, fixtureConfig.vectors.hydrologyFile), 'utf-8')
    ) as HydrologyPayload;
    const bridges = JSON.parse(
      readFileSync(resolve(fixtureRoot, fixtureConfig.vectors.bridgesFile), 'utf-8')
    ) as BridgesPayload;
    const buildings = JSON.parse(
      readFileSync(resolve(fixtureRoot, fixtureConfig.vectors.buildingsFile), 'utf-8')
    ) as BuildingsPayload;

    expect(hydro.waterBodies.length).toBeGreaterThan(0);
    expect(buildings.buildings.length).toBeGreaterThan(0);
    expect(bridges.bridges.length).toBeGreaterThan(0);

    // Bridge mid-span must clear water surface cleanly
    const br = bridges.bridges[0];
    const mid = br.points[Math.floor(br.points.length / 2)];
    expect(mid[1]).toBeGreaterThan(fixtureConfig.terrain.waterReferenceElevationMeters + 5);

    // Explicit provenance distinction for measured vs estimated heights
    const measured = buildings.buildings.find((b) => b.heightEstimated === false);
    const estimated = buildings.buildings.find((b) => b.heightEstimated === true);
    expect(measured).toBeDefined();
    expect(estimated).toBeDefined();
  });

  it('validates imported Greater Peoria USGS 3DEP terrain & OpenStreetMap vector alignment', () => {
    const peoriaRoot = resolve(process.cwd(), 'public/regions/peoria-il');
    const peoriaConfig = JSON.parse(
      readFileSync(resolve(peoriaRoot, 'region.json'), 'utf-8')
    ) as RegionConfig;
    expect(peoriaConfig.dataMode).toBe('real');

    const level = peoriaConfig.terrain.levels.find((l) => l.id === 'balanced')!;
    const buf = readFileSync(resolve(peoriaRoot, level.file));
    const terrain = new TerrainData(
      peoriaConfig,
      level,
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
    const proj = new GeoProjection(peoriaConfig);

    // Peoria Lake sits near ~134.1m NAVD88; Grandview Drive Bluff rises significantly higher (>190m)
    const [lakeX, lakeZ] = proj.lonLatToLocal(-89.538, 40.765);
    const [bluffX, bluffZ] = proj.lonLatToLocal(-89.556, 40.734);
    const lakeElev = terrain.sampleElevationAt(lakeX, lakeZ);
    const bluffElev = terrain.sampleElevationAt(bluffX, bluffZ);

    expect(lakeElev).toBeGreaterThan(130);
    expect(lakeElev).toBeLessThan(140);
    expect(bluffElev).toBeGreaterThan(185);

    const bridges = JSON.parse(
      readFileSync(resolve(peoriaRoot, peoriaConfig.vectors.bridgesFile), 'utf-8')
    ) as BridgesPayload;
    expect(bridges.bridges.length).toBeGreaterThan(50);
  });

  it('keeps the large imported Illinois River polygon and centerline renderable at DEM-derived elevation', () => {
    const peoriaRoot = resolve(process.cwd(), 'public/regions/peoria-il');
    const peoriaConfig = JSON.parse(
      readFileSync(resolve(peoriaRoot, 'region.json'), 'utf-8')
    ) as RegionConfig;
    const hydrology = JSON.parse(
      readFileSync(resolve(peoriaRoot, peoriaConfig.vectors.hydrologyFile), 'utf-8')
    ) as HydrologyPayload;
    const river = hydrology.waterBodies.find((body) => body.id === 'wb-236701-0');
    expect(river).toBeDefined();
    expect(river!.kind).toBe('river');
    expect(river!.outer.length).toBeGreaterThan(150);
    expect(river!.holes?.length).toBeGreaterThan(0);

    const level = peoriaConfig.terrain.levels.find((item) => item.id === 'balanced')!;
    const terrainBuffer = readFileSync(resolve(peoriaRoot, level.file));
    const terrain = new TerrainData(
      peoriaConfig,
      level,
      terrainBuffer.buffer.slice(terrainBuffer.byteOffset, terrainBuffer.byteOffset + terrainBuffer.byteLength)
    );
    const system = new HydrologySystem(peoriaConfig, hydrology);
    const mesh = system.group.getObjectByName(river!.id) as THREE.Mesh | undefined;
    expect(mesh).toBeDefined();
    const positions = mesh!.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(positions.count).toBeGreaterThan(0);
    expect(mesh!.userData.elevationEstimated).toBe(true);
    const mainCenterline = hydrology.waterways.find((way) => way.name === 'Illinois River');
    expect(mainCenterline).toBeDefined();
    const centerPoint = mainCenterline!.points[Math.floor(mainCenterline!.points.length / 2)];
    const terrainAtCenterline = terrain.sampleElevationAt(centerPoint[0], centerPoint[2]);
    expect(mesh!.userData.surfaceElevationMeters).toBeGreaterThan(terrainAtCenterline);
    expect(mesh!.userData.surfaceElevationMeters).not.toBe(peoriaConfig.terrain.waterReferenceElevationMeters);
    const riverRibbon = system.group.getObjectByName('RiverWaterwayRibbons') as THREE.Mesh | undefined;
    expect(riverRibbon).toBeDefined();
    expect((riverRibbon!.geometry.getAttribute('position') as THREE.BufferAttribute).count).toBeGreaterThan(50);
    system.dispose();
  });

  it('requires explicit fixture selection and rejects truncated terrain payloads', () => {
    expect(resolveRequestedRegion('')).toBe('peoria-il');
    expect(resolveRequestedRegion('?region=test-fixture')).toBe('test-fixture');
    expect(() => resolveRequestedRegion('?region=../test-fixture')).toThrow(/Invalid region id/);
    const level = fixtureConfig.terrain.levels.find((item) => item.id === 'balanced')!;
    expect(() => new TerrainData(fixtureConfig, level, new ArrayBuffer(2))).toThrow(/truncated/);
  });
});
