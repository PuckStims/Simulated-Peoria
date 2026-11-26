import type { TransportDomain, TransportEntity, TransportMode } from '../core/TransportEntity';

const distanceSquared = (a: TransportEntity, b: TransportEntity) => {
  const dx = (a.localPosition?.x ?? 1e9) - (b.localPosition?.x ?? -1e9);
  const dz = (a.localPosition?.z ?? 1e9) - (b.localPosition?.z ?? -1e9);
  return dx * dx + dz * dz;
};

/** Bounded state store that prevents generated stand-ins from duplicating observations. */
export class TransportRegistry {
  private readonly modes = new Map<TransportDomain, TransportMode>();
  private entities: TransportEntity[] = [];

  constructor() {
    for (const domain of ['air', 'road', 'transit', 'rail', 'river'] as const) this.modes.set(domain, 'off');
  }

  setMode(domain: TransportDomain, mode: TransportMode): void { this.modes.set(domain, mode); }
  getMode(domain: TransportDomain): TransportMode { return this.modes.get(domain) ?? 'off'; }

  replaceObserved(observed: readonly TransportEntity[], nowMs: number, staleAfterMs = 120_000): void {
    const nonObserved = this.entities.filter((entity) => entity.provenance !== 'observed');
    this.entities = [...nonObserved, ...observed.map((entity) => ({ ...entity, stale: nowMs - entity.observedAtMs > staleAfterMs }))];
  }

  addProcedural(candidates: readonly TransportEntity[], suppressionRadiusMeters = 80): void {
    const observed = this.entities.filter((entity) => entity.provenance === 'observed' && !entity.stale);
    const accepted = candidates.filter((candidate) => !observed.some((actual) => actual.domain === candidate.domain && distanceSquared(actual, candidate) < suppressionRadiusMeters ** 2));
    this.entities = [...this.entities.filter((entity) => entity.provenance !== 'procedural'), ...accepted];
  }

  getActive(): readonly TransportEntity[] {
    return this.entities.filter((entity) => this.getMode(entity.domain) !== 'off');
  }
}
