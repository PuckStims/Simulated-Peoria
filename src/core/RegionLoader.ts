/**
 * Loads a configured region's manifest, binary terrain elevation grid, and vector layers.
 * Never fabricates missing real data silently; surfaces explicit errors or labeled fixture mode.
 */

import type { RegionConfig } from './types';
import { TerrainData } from '../geography/TerrainData';
import type { RegionAssets } from '../rendering/Diorama';
import type { HydrologyPayload } from '../geography/Hydrology';
import type { RailwaysPayload, RoadsPayload } from '../civilization/Roads';
import type { BridgesPayload } from '../civilization/Bridges';
import type { BuildingsPayload } from '../civilization/Buildings';
import type { LandcoverPayload } from '../ecology/Vegetation';

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${resp.status})`);
  }
  return (await resp.json()) as T;
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${resp.status})`);
  }
  return await resp.arrayBuffer();
}

export async function loadRegionAssets(
  regionId: string,
  basePath = './regions'
): Promise<RegionAssets> {
  const root = `${basePath}/${regionId}`;
  const config = await fetchJson<RegionConfig>(`${root}/region.json`);

  const balancedLevel =
    config.terrain.levels.find((l) => l.id === 'balanced') ?? config.terrain.levels[0];
  if (!balancedLevel) {
    throw new Error(`Region "${regionId}" has no configured terrain levels.`);
  }

  const [terrainBuf, hydrology, roads, railways, bridges, buildings, landcover] =
    await Promise.all([
      fetchArrayBuffer(`${root}/${balancedLevel.file}`),
      fetchJson<HydrologyPayload>(`${root}/${config.vectors.hydrologyFile}`),
      fetchJson<RoadsPayload>(`${root}/${config.vectors.roadsFile}`),
      fetchJson<RailwaysPayload>(`${root}/${config.vectors.railwaysFile}`),
      fetchJson<BridgesPayload>(`${root}/${config.vectors.bridgesFile}`),
      fetchJson<BuildingsPayload>(`${root}/${config.vectors.buildingsFile}`),
      fetchJson<LandcoverPayload>(`${root}/${config.vectors.landcoverFile}`),
    ]);

  const terrainData = new TerrainData(config, balancedLevel, terrainBuf);

  return {
    config,
    terrainData,
    hydrology,
    roads,
    railways,
    bridges,
    buildings,
    landcover,
  };
}

/** Resolve a requested region without substituting synthetic geography. */
export function resolveRequestedRegion(search: string): string {
  const requested = new URLSearchParams(search).get('region')?.trim();
  if (!requested) return 'peoria-il';
  // Region IDs become static asset paths. Keep them to the manifest naming scheme
  // rather than allowing URL path traversal or ambiguous relative paths.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(requested)) {
    throw new Error(`Invalid region id "${requested}".`);
  }
  return requested;
}

/** `test-fixture` is available only when explicitly supplied in the URL. */
export function loadRequestedRegionAssets(search: string, basePath = './regions'): Promise<RegionAssets> {
  return loadRegionAssets(resolveRequestedRegion(search), basePath);
}
