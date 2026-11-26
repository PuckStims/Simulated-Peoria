/**
 * Shared physical-surface authority for entities. Heights returned by the public
 * methods are real elevations above the configured datum; render conversion is
 * intentionally explicit so simulation does not inherit display exaggeration.
 */
import type { BridgesPayload } from '../civilization/Bridges';
import type { RailwaysPayload, RoadsPayload } from '../civilization/Roads';
import type { RegionConfig } from '../core/types';
import type { HydrologyPayload, WaterBodyRecord } from './Hydrology';
import type { TerrainData } from './TerrainData';

export interface SurfaceSample {
  elevationMeters: number;
  renderedY: number;
  source: 'terrain' | 'road' | 'rail' | 'bridge' | 'water';
  inferred: boolean;
}

function pointInRing(x: number, z: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]; const [xj, zj] = ring[j];
    const crosses = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInWater(x: number, z: number, body: WaterBodyRecord): boolean {
  return pointInRing(x, z, body.outer) && !(body.holes ?? []).some((hole) => pointInRing(x, z, hole));
}

function interpolatePolyline(points: readonly [number, number, number][], distance: number): number {
  if (points.length === 0) return Number.NaN;
  if (points.length === 1) return points[0][1];
  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (remaining <= length || i === points.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      return a[1] + (b[1] - a[1]) * t;
    }
    remaining -= length;
  }
  return points.at(-1)![1];
}

export class SurfaceResolver {
  constructor(
    private readonly config: RegionConfig,
    private readonly terrain: TerrainData,
    private readonly hydrology: HydrologyPayload,
    private readonly roads: RoadsPayload,
    private readonly railways: RailwaysPayload,
    private readonly bridges: BridgesPayload,
  ) {}

  getTerrainHeight(x: number, z: number): number {
    return this.terrain.sampleElevationAt(x, z);
  }

  getActiveTerrainHeight(x: number, z: number, verticalExaggeration: number): number {
    return this.terrain.sampleYAt(x, z, verticalExaggeration);
  }

  getRoadSurfaceHeight(edgeId: string, distance: number): number | null {
    const edge = this.roads.roads.find((road) => road.id === edgeId);
    if (!edge) return null;
    return interpolatePolyline(edge.points.map(([x, z]) => [x, this.getTerrainHeight(x, z), z] as [number, number, number]), distance);
  }

  getRailSurfaceHeight(edgeId: string, distance: number): number | null {
    const edge = this.railways.railways.find((rail) => rail.id === edgeId);
    if (!edge) return null;
    return interpolatePolyline(edge.points.map(([x, z]) => [x, this.getTerrainHeight(x, z), z] as [number, number, number]), distance);
  }

  getBridgeDeckHeight(bridgeId: string, distance: number): number | null {
    const bridge = this.bridges.bridges.find((item) => item.id === bridgeId);
    return bridge ? interpolatePolyline(bridge.points, distance) : null;
  }

  getWaterSurfaceHeight(x: number, z: number): number | null {
    const body = this.hydrology.waterBodies.find((candidate) => pointInWater(x, z, candidate));
    return body?.elevationMeters ?? null;
  }

  resolveTerrain(x: number, z: number, verticalExaggeration: number): SurfaceSample {
    const elevationMeters = this.getTerrainHeight(x, z);
    return { elevationMeters, renderedY: this.getActiveTerrainHeight(x, z, verticalExaggeration), source: 'terrain', inferred: false };
  }

  resolveWater(x: number, z: number, verticalExaggeration: number): SurfaceSample | null {
    const body = this.hydrology.waterBodies.find((candidate) => pointInWater(x, z, candidate));
    if (!body) return null;
    return {
      elevationMeters: body.elevationMeters,
      renderedY: (body.elevationMeters - this.config.coordinateSystem.origin.elevationDatumMeters) * verticalExaggeration,
      source: 'water', inferred: body.elevationEstimated === true,
    };
  }
}
