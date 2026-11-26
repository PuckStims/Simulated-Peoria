/** Provider-neutral transport observation contract. Never infer provenance implicitly. */
export type TransportDomain = 'air' | 'road' | 'transit' | 'rail' | 'river';
export type TransportMode = 'off' | 'live-only' | 'data-informed-simulation' | 'procedural-only' | 'hybrid';
export type TransportProvenance = 'observed' | 'inferred' | 'scheduled' | 'procedural';

export interface TransportEntity {
  id: string;
  domain: TransportDomain;
  vehicleClass: string;
  longitude: number;
  latitude: number;
  localPosition?: { x: number; z: number };
  headingDeg?: number;
  speedMps?: number;
  altitudeMeters?: number;
  surfaceRef?: { kind: 'road' | 'rail' | 'bridge' | 'water'; edgeId: string; distanceMeters: number };
  routeId?: string;
  destination?: string;
  observedAtMs: number;
  provider: string;
  provenance: TransportProvenance;
  observationConfidence: number;
  stale: boolean;
  interpolated: boolean;
}

export interface TransportProviderStatus {
  provider: string;
  domain: TransportDomain;
  connected: boolean;
  lastSuccessMs: number | null;
  message?: string;
}
