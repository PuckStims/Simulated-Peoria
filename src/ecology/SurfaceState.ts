/**
 * Low-frequency environmental persistence model (Specification Section 14).
 * Tracks surface wetness, puddle accumulation, evaporation, snow accumulation, and snow melt.
 * Uses bounded timesteps so suspended browser tabs do not cause explosive jumps.
 */

import type { EffectiveEnvironmentState, PersistentSurfaceState } from '../core/types';
import { computeSeasonalPhenology } from './Seasons';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class SurfaceStateModel {
  private state: PersistentSurfaceState;

  constructor(initial?: Partial<PersistentSurfaceState>) {
    this.state = {
      wetness: initial?.wetness ?? 0.08,
      puddleLevel: initial?.puddleLevel ?? 0.0,
      snowCover: initial?.snowCover ?? 0.0,
      snowDepthMeters: initial?.snowDepthMeters ?? 0.0,
      recentPrecipMm: initial?.recentPrecipMm ?? 0.0,
      foliageGreenness: initial?.foliageGreenness ?? 0.5,
      foliageAutumnFactor: initial?.foliageAutumnFactor ?? 0.0,
      foliageLeafRetention: initial?.foliageLeafRetention ?? 0.6,
      lastUpdatedSimMs: initial?.lastUpdatedSimMs ?? Date.now(),
    };
  }

  getState(): PersistentSurfaceState {
    return { ...this.state };
  }

  setState(next: PersistentSurfaceState): void {
    this.state = { ...next };
  }

  /**
   * Step the surface state forward using bounded simulation hours.
   * @param dtSimSeconds Elapsed simulation seconds (clamped internally to <= 1800s per step)
   * @param env Effective environmental state
   * @param solarAltitudeRad Current solar altitude (radians) for radiant evaporation/melt
   * @param dayOfYear Simulated day of year
   */
  step(
    dtSimSeconds: number,
    env: EffectiveEnvironmentState,
    solarAltitudeRad: number,
    dayOfYear: number
  ): PersistentSurfaceState {
    const dtHours = Math.max(0, Math.min(dtSimSeconds, 1800)) / 3600;
    const solarFactor = Math.max(0, Math.sin(solarAltitudeRad)) * (1 - 0.7 * env.cloudCoverTotal);

    // Rain / Snow accumulation
    const isRain = env.precipitationType === 'rain' || (env.precipitationType === 'mix' && env.temperatureC > 1.0);
    const isSnow = env.precipitationType === 'snow' || (env.precipitationType === 'mix' && env.temperatureC <= 1.0);

    const rainRateMmHr = isRain ? env.precipitationMmHr : 0;
    const snowRateMmEqHr = isSnow ? env.precipitationMmHr : 0;

    // Wetness & puddle evolution
    const wetting = Math.min(1, rainRateMmHr * 0.14) * dtHours;
    const evapRate =
      (0.03 + 0.08 * solarFactor + 0.012 * Math.max(0, env.temperatureC) + 0.008 * env.windSpeedMs) *
      (1 - 0.65 * (env.relativeHumidityPct / 100));
    const drying = Math.max(0.005, evapRate) * dtHours;

    this.state.wetness = clamp01(this.state.wetness + wetting * 2.5 - drying);
    if (rainRateMmHr > 2.0) {
      this.state.puddleLevel = clamp01(this.state.puddleLevel + (rainRateMmHr - 1.5) * 0.04 * dtHours);
    } else {
      this.state.puddleLevel = clamp01(this.state.puddleLevel - drying * 0.85);
    }

    // Recent precipitation exponential memory (half-life ~12h)
    const decay = Math.exp(-dtHours / 12.0);
    this.state.recentPrecipMm = this.state.recentPrecipMm * decay + (rainRateMmHr + snowRateMmEqHr) * dtHours;

    // Snow accumulation & melt
    if (env.snowOverrideFactor !== null) {
      this.state.snowCover = clamp01(env.snowOverrideFactor);
      this.state.snowDepthMeters = this.state.snowCover * 0.28;
    } else {
      if (snowRateMmEqHr > 0.05) {
        // ~10:1 snow-to-liquid ratio
        const addedDepth = (snowRateMmEqHr / 1000) * 10 * dtHours;
        this.state.snowDepthMeters = Math.min(0.8, this.state.snowDepthMeters + addedDepth);
      }
      if (env.temperatureC > 0.5 || solarFactor > 0.35) {
        const meltEnergy = Math.max(0, env.temperatureC - 0.2) * 0.004 + solarFactor * 0.006;
        const melted = meltEnergy * dtHours;
        if (melted > 0 && this.state.snowDepthMeters > 0) {
          const actualMelt = Math.min(this.state.snowDepthMeters, melted);
          this.state.snowDepthMeters -= actualMelt;
          this.state.wetness = clamp01(this.state.wetness + actualMelt * 2.5);
        }
      }
      this.state.snowCover = clamp01(this.state.snowDepthMeters / 0.12);
    }

    // Seasonal foliage update
    const phenology = computeSeasonalPhenology(
      dayOfYear,
      env.vegetationSeasonOverride,
      env.temperatureC
    );
    this.state.foliageGreenness = phenology.greenness;
    this.state.foliageAutumnFactor = phenology.autumnFactor;
    this.state.foliageLeafRetention = phenology.leafRetention;
    this.state.lastUpdatedSimMs = env.timestampMs;

    return this.getState();
  }
}
