/**
 * Open-Meteo meteorological data provider (Specification Section 11.1).
 *
 * All retrieved data is explicitly tagged isModeled: true to distinguish
 * modeled weather output from direct local station instrumentation.
 */

import type { WeatherProviderStatus, WeatherSample } from '../core/types';

export const DEFAULT_FALLBACK_WEATHER: WeatherSample = {
  sourceName: 'Regional Climatology Fallback (offline)',
  isModeled: true,
  fetchedAtMs: 0,
  validTimeMs: 0,
  temperatureC: 11.5,
  relativeHumidityPct: 68,
  precipitationMmHr: 0,
  rainMmHr: 0,
  snowfallCmHr: 0,
  snowDepthCm: 0,
  cloudCoverTotalPct: 36,
  cloudCoverLowPct: 22,
  cloudCoverMidPct: 18,
  cloudCoverHighPct: 28,
  windSpeedMs: 4.2,
  windFromDeg: 245,
  windGustMs: 6.5,
  visibilityMeters: 16000,
  weatherCode: 2,
  shortwaveRadiationWm2: null,
};

interface OpenMeteoResponse {
  current?: Record<string, number | string>;
  hourly?: {
    time?: string[];
    visibility?: number[];
    cloud_cover_low?: number[];
    cloud_cover_mid?: number[];
    cloud_cover_high?: number[];
    snow_depth?: number[];
    shortwave_radiation?: number[];
  };
}

export function buildOpenMeteoUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation',
      'rain',
      'snowfall',
      'weather_code',
      'cloud_cover',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
    ].join(','),
    hourly: [
      'visibility',
      'cloud_cover_low',
      'cloud_cover_mid',
      'cloud_cover_high',
      'snow_depth',
      'shortwave_radiation',
    ].join(','),
    wind_speed_unit: 'ms',
    forecast_days: '1',
    timezone: 'GMT',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function parseOpenMeteoResponse(raw: OpenMeteoResponse, fetchedAtMs: number): WeatherSample {
  const c = raw.current ?? {};
  const h = raw.hourly;

  // Find closest hourly index to current time
  let hIdx = 0;
  if (h?.time && h.time.length > 0) {
    let bestDiff = Infinity;
    for (let i = 0; i < h.time.length; i++) {
      const tMs = Date.parse(h.time[i] + 'Z');
      if (Number.isFinite(tMs)) {
        const diff = Math.abs(tMs - fetchedAtMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          hIdx = i;
        }
      }
    }
  }

  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;

  const totalCloud = num(c.cloud_cover, 25);
  const lowCloud = num(h?.cloud_cover_low?.[hIdx], totalCloud * 0.55);
  const midCloud = num(h?.cloud_cover_mid?.[hIdx], totalCloud * 0.45);
  const highCloud = num(h?.cloud_cover_high?.[hIdx], totalCloud * 0.5);
  const snowDepthMeters = num(h?.snow_depth?.[hIdx], 0);
  const validTimeMs =
    typeof c.time === 'string' && Number.isFinite(Date.parse(c.time + 'Z'))
      ? Date.parse(c.time + 'Z')
      : fetchedAtMs;

  return {
    sourceName: 'Open-Meteo Forecast Model',
    isModeled: true,
    fetchedAtMs,
    validTimeMs,
    temperatureC: num(c.temperature_2m, 12),
    relativeHumidityPct: num(c.relative_humidity_2m, 65),
    precipitationMmHr: num(c.precipitation, 0),
    rainMmHr: num(c.rain, 0),
    snowfallCmHr: num(c.snowfall, 0),
    snowDepthCm: snowDepthMeters * 100,
    cloudCoverTotalPct: totalCloud,
    cloudCoverLowPct: lowCloud,
    cloudCoverMidPct: midCloud,
    cloudCoverHighPct: highCloud,
    windSpeedMs: num(c.wind_speed_10m, 3.5),
    windFromDeg: num(c.wind_direction_10m, 240),
    windGustMs: num(c.wind_gusts_10m, 5.0),
    visibilityMeters: num(h?.visibility?.[hIdx], 16000),
    weatherCode: num(c.weather_code, 0),
    shortwaveRadiationWm2:
      typeof h?.shortwave_radiation?.[hIdx] === 'number'
        ? h.shortwave_radiation[hIdx]
        : null,
  };
}

export class WeatherProvider {
  private readonly latitude: number;
  private readonly longitude: number;
  private readonly staleThresholdMs: number;
  private readonly minRefreshIntervalMs: number;
  private latestSample: WeatherSample;
  private inFlightRefresh: Promise<WeatherSample> | null = null;
  private lastRequestMs = Number.NEGATIVE_INFINITY;
  private status: WeatherProviderStatus = {
    state: 'fallback',
    lastUpdatedMs: null,
    message: 'Initializing weather feed...',
  };

  constructor(
    latitude: number,
    longitude: number,
    staleThresholdMs = 45 * 60 * 1000,
    minRefreshIntervalMs = 60 * 1000
  ) {
    this.latitude = latitude;
    this.longitude = longitude;
    this.staleThresholdMs = staleThresholdMs;
    this.minRefreshIntervalMs = minRefreshIntervalMs;
    const now = Date.now();
    this.latestSample = { ...DEFAULT_FALLBACK_WEATHER, fetchedAtMs: now, validTimeMs: now };
  }

  getLatestSample(): WeatherSample {
    return this.latestSample;
  }

  getStatus(nowMs: number = Date.now()): WeatherProviderStatus {
    if (this.status.state === 'live' && this.status.lastUpdatedMs !== null) {
      if (nowMs - this.status.lastUpdatedMs > this.staleThresholdMs) {
        return {
          state: 'stale',
          lastUpdatedMs: this.status.lastUpdatedMs,
          message: 'Weather sample is stale (>45 min old); awaiting refresh.',
        };
      }
    }
    return { ...this.status };
  }

  async refresh(fetchFn: typeof fetch = fetch): Promise<WeatherSample> {
    if (this.inFlightRefresh) return this.inFlightRefresh;

    const now = Date.now();
    if (now - this.lastRequestMs < this.minRefreshIntervalMs) {
      return this.latestSample;
    }
    this.lastRequestMs = now;
    this.inFlightRefresh = this.fetchAndStore(fetchFn, now);
    try {
      return await this.inFlightRefresh;
    } finally {
      this.inFlightRefresh = null;
    }
  }

  private async fetchAndStore(fetchFn: typeof fetch, now: number): Promise<WeatherSample> {
    const url = buildOpenMeteoUrl(this.latitude, this.longitude);
    try {
      const resp = await fetchFn(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as OpenMeteoResponse;
      this.latestSample = parseOpenMeteoResponse(json, now);
      this.status = {
        state: 'live',
        lastUpdatedMs: now,
        message: 'Live Open-Meteo modeled conditions',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status = {
        state: this.status.lastUpdatedMs !== null ? 'stale' : 'offline',
        lastUpdatedMs: this.status.lastUpdatedMs,
        message: `Weather fetch unavailable (${msg}); retaining ${
          this.status.lastUpdatedMs ? 'last sample' : 'climatology fallback'
        }.`,
      };
    }
    return this.latestSample;
  }
}
