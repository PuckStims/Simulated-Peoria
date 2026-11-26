import type { TransportDomain, TransportEntity, TransportProviderStatus } from '../core/TransportEntity';

export interface ObservationBounds { west: number; south: number; east: number; north: number; }
export interface TransportProvider {
  readonly id: string;
  readonly domain: TransportDomain;
  refresh(bounds: ObservationBounds, nowMs: number): Promise<readonly TransportEntity[]>;
  getStatus(): TransportProviderStatus;
}
