/**
 * Authoritative Reality state: separates live real-world measurements/models
 * from manual experimental overrides (Section 15 & Section 21).
 */

import type {
  AstronomicalState,
  ChannelOverrideState,
  EffectiveEnvironmentState,
  PrecipitationType,
  WeatherProviderStatus,
  WeatherSample,
} from '../core/types';
import { SimulationClock } from '../core/Clock';
import { EphemerisEngine } from '../celestial/Ephemeris';
import { WeatherProvider } from '../atmosphere/WeatherProvider';
import { windFromDegToTravelUnit } from '../atmosphere/Wind';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class RealityStore {
  readonly clock: SimulationClock;
  readonly ephemeris: EphemerisEngine;
  readonly weatherProvider: WeatherProvider;
  private smoothedEnv: EffectiveEnvironmentState | null = null;

  constructor(
    latitude: number,
    longitude: number,
    elevationMeters: number,
    initialNowMs: number = Date.now()
  ) {
    this.clock = new SimulationClock(initialNowMs);
    this.ephemeris = new EphemerisEngine(latitude, longitude, elevationMeters);
    this.weatherProvider = new WeatherProvider(latitude, longitude);
  }

  getWeatherSample(): WeatherSample {
    return this.weatherProvider.getLatestSample();
  }

  getWeatherStatus(nowMs?: number): WeatherProviderStatus {
    return this.weatherProvider.getStatus(nowMs);
  }

  computeAstronomicalState(
    overrides: ChannelOverrideState,
    dtRealSeconds: number,
    realNowMs: number = Date.now()
  ): AstronomicalState {
    if (overrides.astronomy.mode === 'live') {
      if (this.clock.getMode() !== 'live') {
        this.clock.setLiveMode(realNowMs);
      }
      this.clock.tick(dtRealSeconds, realNowMs);
    } else {
      if (this.clock.getMode() === 'live') {
        this.clock.setManualTimestampMs(overrides.astronomy.manualTimeMs);
      }
      this.clock.setTimeScale(overrides.astronomy.timeScale);
      this.clock.setPaused(overrides.astronomy.paused);
      this.clock.tick(dtRealSeconds, realNowMs);
      overrides.astronomy.manualTimeMs = this.clock.getTimestampMs();
    }
    return this.ephemeris.compute(this.clock.getTimestampMs());
  }

  /**
   * Combine live weather sample + independent overrides into smoothly transitioned EffectiveEnvironmentState.
   */
  computeEffectiveEnvironment(
    astro: AstronomicalState,
    overrides: ChannelOverrideState,
    verticalExaggeration: number,
    dtRealSeconds: number
  ): EffectiveEnvironmentState {
    const sample = this.weatherProvider.getLatestSample();

    // Temperature channel
    const targetTempC =
      overrides.temperature.mode === 'manual'
        ? overrides.temperature.temperatureC
        : sample.temperatureC;

    // Wind channel
    const targetWindSpeed =
      overrides.wind.mode === 'manual' ? overrides.wind.speedMs : sample.windSpeedMs;
    const targetWindFromDeg =
      overrides.wind.mode === 'manual' ? overrides.wind.fromDeg : sample.windFromDeg;

    // Weather channel (clouds, precipitation, fog)
    let targetCloudTotal: number;
    let targetCloudLow: number;
    let targetCloudMid: number;
    let targetCloudHigh: number;
    let targetPrecipType: PrecipitationType;
    let targetPrecipIntensity: number;
    let targetPrecipMmHr: number;
    let targetFogDensity: number;
    let targetVisibility = sample.visibilityMeters;

    if (overrides.weather.mode === 'manual') {
      targetCloudTotal = clamp01(overrides.weather.cloudCoverTotal);
      targetCloudLow = clamp01(targetCloudTotal * 0.85);
      targetCloudMid = clamp01(targetCloudTotal * 0.7);
      targetCloudHigh = clamp01(targetCloudTotal * 0.65);
      targetPrecipType = overrides.weather.precipitationType;
      targetPrecipIntensity =
        targetPrecipType === 'none' ? 0 : clamp01(overrides.weather.precipitationIntensity);
      targetPrecipMmHr = targetPrecipIntensity * 18.0;
      targetFogDensity = clamp01(overrides.weather.fogDensity);
      targetVisibility = Math.max(400, 20000 * (1 - 0.92 * targetFogDensity));
    } else {
      targetCloudTotal = clamp01(sample.cloudCoverTotalPct / 100);
      targetCloudLow = clamp01(sample.cloudCoverLowPct / 100);
      targetCloudMid = clamp01(sample.cloudCoverMidPct / 100);
      targetCloudHigh = clamp01(sample.cloudCoverHighPct / 100);
      const hasSnow = sample.snowfallCmHr > 0.02 || (sample.precipitationMmHr > 0.05 && targetTempC <= 0.5);
      const hasRain = sample.rainMmHr > 0.02 || (sample.precipitationMmHr > 0.05 && targetTempC > 0.5);
      if (hasSnow && hasRain) targetPrecipType = 'mix';
      else if (hasSnow) targetPrecipType = 'snow';
      else if (hasRain) targetPrecipType = 'rain';
      else targetPrecipType = 'none';

      targetPrecipMmHr = Math.max(sample.precipitationMmHr, sample.snowfallCmHr * 1.2);
      targetPrecipIntensity = targetPrecipType === 'none' ? 0 : clamp01(targetPrecipMmHr / 12.0);
      targetVisibility = Math.max(300, sample.visibilityMeters);
      targetFogDensity = clamp01(1 - Math.min(1, targetVisibility / 16000));
    }

    // River valley mist rises when humidity is high, wind is calm, or near dawn/dusk
    const calmFactor = clamp01(1 - targetWindSpeed / 8.0);
    const humidityFactor = clamp01((sample.relativeHumidityPct - 62) / 36);
    const dawnDuskFactor = astro.isTwilight ? 0.45 : astro.solarAltitudeRad < 0.18 ? 0.3 : 0.1;
    const valleyMistFactor = clamp01(
      Math.max(targetFogDensity * 0.9, humidityFactor * calmFactor * (0.55 + dawnDuskFactor))
    );

    const targetSeasonProgress =
      overrides.ecology.mode === 'manual'
        ? overrides.ecology.seasonProgress
        : (astro.dayOfYear - 1) / 365.25;

    const snowOverride =
      overrides.surface.mode === 'manual' ? overrides.surface.snowCover : null;
    const seasonOverride =
      overrides.ecology.mode === 'manual' ? overrides.ecology.seasonProgress : null;

    const targetEnv: EffectiveEnvironmentState = {
      timestampMs: astro.timestampMs,
      temperatureC: targetTempC,
      relativeHumidityPct: sample.relativeHumidityPct,
      precipitationType: targetPrecipType,
      precipitationIntensity: targetPrecipIntensity,
      precipitationMmHr: targetPrecipMmHr,
      cloudCoverTotal: targetCloudTotal,
      cloudCoverLow: targetCloudLow,
      cloudCoverMid: targetCloudMid,
      cloudCoverHigh: targetCloudHigh,
      windFromDeg: targetWindFromDeg,
      windSpeedMs: targetWindSpeed,
      windVector: windFromDegToTravelUnit(targetWindFromDeg),
      visibilityMeters: targetVisibility,
      fogDensity: targetFogDensity,
      valleyMistFactor,
      seasonProgress: targetSeasonProgress,
      snowOverrideFactor: snowOverride,
      vegetationSeasonOverride: seasonOverride,
      verticalExaggeration,
    };

    // Smooth atmospheric transitions so API updates or mode switches glide gently
    if (!this.smoothedEnv || dtRealSeconds <= 0) {
      this.smoothedEnv = targetEnv;
      return targetEnv;
    }

    const alpha = 1 - Math.exp(-Math.min(dtRealSeconds, 0.5) * 2.5);
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const lerpAngleDeg = (a: number, b: number) => {
      const diff = ((((b - a) % 360) + 540) % 360) - 180;
      return ((a + diff * alpha) % 360 + 360) % 360;
    };

    const blendedFromDeg = lerpAngleDeg(this.smoothedEnv.windFromDeg, targetEnv.windFromDeg);
    this.smoothedEnv = {
      ...targetEnv,
      temperatureC: lerp(this.smoothedEnv.temperatureC, targetEnv.temperatureC),
      cloudCoverTotal: lerp(this.smoothedEnv.cloudCoverTotal, targetEnv.cloudCoverTotal),
      cloudCoverLow: lerp(this.smoothedEnv.cloudCoverLow, targetEnv.cloudCoverLow),
      cloudCoverMid: lerp(this.smoothedEnv.cloudCoverMid, targetEnv.cloudCoverMid),
      cloudCoverHigh: lerp(this.smoothedEnv.cloudCoverHigh, targetEnv.cloudCoverHigh),
      precipitationIntensity: lerp(
        this.smoothedEnv.precipitationIntensity,
        targetEnv.precipitationIntensity
      ),
      precipitationMmHr: lerp(this.smoothedEnv.precipitationMmHr, targetEnv.precipitationMmHr),
      windFromDeg: blendedFromDeg,
      windSpeedMs: lerp(this.smoothedEnv.windSpeedMs, targetEnv.windSpeedMs),
      windVector: windFromDegToTravelUnit(blendedFromDeg),
      fogDensity: lerp(this.smoothedEnv.fogDensity, targetEnv.fogDensity),
      valleyMistFactor: lerp(this.smoothedEnv.valleyMistFactor, targetEnv.valleyMistFactor),
      visibilityMeters: lerp(this.smoothedEnv.visibilityMeters, targetEnv.visibilityMeters),
    };
    return this.smoothedEnv;
  }
}
