/**
 * Shared foundational types and authoritative state contracts for Project Microcosm.
 *
 * Coordinate convention (Section 6):
 *   +X = True East (meters)
 *   -X = True West (meters)
 *   +Y = Elevation above vertical datum (meters)
 *   +Z = True South (meters)
 *   -Z = True North (meters)
 */

export type DataProvenanceKind = 'measured' | 'inferred' | 'procedural' | 'fixture';

export type GraphicsQuality = 'low' | 'balanced' | 'high';

export type BenchmarkScenarioId = 'clear-noon' | 'rain-storm' | 'winter-snow';

export interface PerformanceDiagnostics {
  frameMs: number;
  updateMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  activeTerrainChunks: number;
  waterMeshes: number;
  vegetationInstances: number;
  cloudInstances: number;
  precipitationPoints: number;
  sourceAssetBytes: number;
  assetLoadMs: number | null;
  sceneConstructionMs: number | null;
}

export type PrecipitationType = 'none' | 'rain' | 'snow' | 'mix';

export type SyncChannelName =
  | 'astronomy'
  | 'weather'
  | 'wind'
  | 'temperature'
  | 'ecology'
  | 'surface';

export interface GeoBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface RegionOrigin {
  lon: number;
  lat: number;
  easting: number;
  northing: number;
  elevationDatumMeters: number;
}

export interface TerrainLevelConfig {
  id: string;
  label: string;
  spacingMeters: number;
  cols: number;
  rows: number;
  file: string;
  encoding: 'uint16-linear' | 'float32';
  minElevationMeters: number;
  maxElevationMeters: number;
}

export interface DataSourceRecord {
  name: string;
  kind: DataProvenanceKind;
  url: string;
  acquisitionDate: string;
  extent: string;
  resolution: string;
  crs: string;
  datum?: string;
  license: string;
  attribution: string;
  notes?: string;
}

export interface AssetIntegrityRecord {
  algorithm: 'sha256';
  assets: Record<string, { bytes: number; sha256: string }>;
}

export interface LandmarkLabel {
  id: string;
  name: string;
  lon: number;
  lat: number;
  category: 'city' | 'water' | 'landmark' | 'bluff';
}

export interface RegionConfig {
  id: string;
  name: string;
  subtitle: string;
  dataMode: 'real' | 'fixture' | 'demonstration';
  bounds: GeoBounds;
  reference: {
    latitude: number;
    longitude: number;
    elevationMeters: number;
  };
  coordinateSystem: {
    projectedCrs: string;
    proj4: string;
    origin: RegionOrigin;
    meridianConvergenceDeg: number;
    alignTrueNorthToNegativeZ: boolean;
    extentMeters: {
      width: number;
      depth: number;
    };
    horizontalScale: number;
    verticalScale: number;
  };
  timezone: string;
  elevationDatum: string;
  terrain: {
    levels: TerrainLevelConfig[];
    chunksX: number;
    chunksZ: number;
    substrateBottomMeters: number;
    waterReferenceElevationMeters: number;
  };
  vectors: {
    hydrologyFile: string;
    roadsFile: string;
    railwaysFile: string;
    bridgesFile: string;
    buildingsFile: string;
    landcoverFile: string;
  };
  landmarks: LandmarkLabel[];
  dataSources: DataSourceRecord[];
  /** Build-time verification metadata for terrain and vector payload files. */
  assetIntegrity?: AssetIntegrityRecord;
}

export interface AstronomicalState {
  timestampMs: number;
  solarAltitudeRad: number;
  solarAzimuthRad: number;
  solarDirection: [number, number, number];
  lunarAltitudeRad: number;
  lunarAzimuthRad: number;
  lunarDirection: [number, number, number];
  lunarPhaseFraction: number;
  lunarIllumination: number;
  sunriseMs: number | null;
  sunsetMs: number | null;
  civilDawnMs: number | null;
  civilDuskMs: number | null;
  isDaylight: boolean;
  isTwilight: boolean;
  dayOfYear: number;
}

export interface WeatherSample {
  sourceName: string;
  isModeled: true;
  fetchedAtMs: number;
  validTimeMs: number;
  temperatureC: number;
  relativeHumidityPct: number;
  precipitationMmHr: number;
  rainMmHr: number;
  snowfallCmHr: number;
  snowDepthCm: number;
  cloudCoverTotalPct: number;
  cloudCoverLowPct: number;
  cloudCoverMidPct: number;
  cloudCoverHighPct: number;
  windSpeedMs: number;
  /** Meteorological convention: direction FROM which wind originates (degrees clockwise from true north). */
  windFromDeg: number;
  windGustMs: number;
  visibilityMeters: number;
  weatherCode: number;
  shortwaveRadiationWm2: number | null;
}

export interface WeatherProviderStatus {
  state: 'live' | 'stale' | 'offline' | 'fallback';
  lastUpdatedMs: number | null;
  message: string;
}

export interface EffectiveEnvironmentState {
  timestampMs: number;
  temperatureC: number;
  relativeHumidityPct: number;
  precipitationType: PrecipitationType;
  /** Normalized 0..1 intensity derived from mm/hr or manual override. */
  precipitationIntensity: number;
  precipitationMmHr: number;
  cloudCoverTotal: number;
  cloudCoverLow: number;
  cloudCoverMid: number;
  cloudCoverHigh: number;
  /** Meteorological wind origin in degrees clockwise from true north. */
  windFromDeg: number;
  windSpeedMs: number;
  /** Normalized/scaled horizontal movement vector in local world coords (+X east, +Z south). */
  windVector: [number, number];
  visibilityMeters: number;
  fogDensity: number;
  valleyMistFactor: number;
  seasonProgress: number;
  snowOverrideFactor: number | null;
  vegetationSeasonOverride: number | null;
  verticalExaggeration: number;
}

export interface PersistentSurfaceState {
  wetness: number;
  puddleLevel: number;
  snowCover: number;
  snowDepthMeters: number;
  recentPrecipMm: number;
  foliageGreenness: number;
  foliageAutumnFactor: number;
  foliageLeafRetention: number;
  lastUpdatedSimMs: number;
}

export interface ChannelOverrideState {
  astronomy: {
    mode: 'live' | 'manual';
    manualTimeMs: number;
    timeScale: number;
    paused: boolean;
  };
  weather: {
    mode: 'live' | 'manual';
    cloudCoverTotal: number;
    precipitationType: PrecipitationType;
    precipitationIntensity: number;
    fogDensity: number;
  };
  wind: {
    mode: 'live' | 'manual';
    speedMs: number;
    fromDeg: number;
  };
  temperature: {
    mode: 'live' | 'manual';
    temperatureC: number;
  };
  ecology: {
    mode: 'live' | 'manual';
    seasonProgress: number;
  };
  surface: {
    mode: 'live' | 'manual';
    snowCover: number;
    wetness: number;
  };
}

export interface SavedScenario {
  version: 1;
  name: string;
  regionId: string;
  savedAtIso: string;
  overrides: ChannelOverrideState;
  surface: PersistentSurfaceState;
  verticalExaggeration: number;
}
