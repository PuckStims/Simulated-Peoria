/**
 * Independent 6-channel reality/override state manager (Sections 15 & 16).
 */

import type { ChannelOverrideState, PrecipitationType, SyncChannelName } from '../core/types';

export function createDefaultOverrides(nowMs: number = Date.now()): ChannelOverrideState {
  return {
    astronomy: {
      mode: 'live',
      manualTimeMs: nowMs,
      timeScale: 1,
      paused: false,
    },
    weather: {
      mode: 'live',
      cloudCoverTotal: 0.35,
      precipitationType: 'none',
      precipitationIntensity: 0,
      fogDensity: 0.12,
    },
    wind: {
      mode: 'live',
      speedMs: 4.5,
      fromDeg: 245,
    },
    temperature: {
      mode: 'live',
      temperatureC: 14,
    },
    ecology: {
      mode: 'live',
      seasonProgress: 0.45,
    },
    surface: {
      mode: 'live',
      snowCover: 0,
      wetness: 0.1,
    },
  };
}

export class OverrideManager {
  private state: ChannelOverrideState;

  constructor(initial?: ChannelOverrideState) {
    this.state = initial ? structuredClone(initial) : createDefaultOverrides();
  }

  getState(): ChannelOverrideState {
    return structuredClone(this.state);
  }

  setState(next: ChannelOverrideState): void {
    this.state = structuredClone(next);
  }

  setAstronomyManual(manualTimeMs: number, timeScale?: number, paused?: boolean): void {
    this.state.astronomy.mode = 'manual';
    this.state.astronomy.manualTimeMs = manualTimeMs;
    if (timeScale !== undefined) this.state.astronomy.timeScale = timeScale;
    if (paused !== undefined) this.state.astronomy.paused = paused;
  }

  setWeatherManual(partial: {
    cloudCoverTotal?: number;
    precipitationType?: PrecipitationType;
    precipitationIntensity?: number;
    fogDensity?: number;
  }): void {
    this.state.weather.mode = 'manual';
    Object.assign(this.state.weather, partial);
  }

  setWindManual(speedMs: number, fromDeg: number): void {
    this.state.wind.mode = 'manual';
    this.state.wind.speedMs = Math.max(0, speedMs);
    this.state.wind.fromDeg = ((fromDeg % 360) + 360) % 360;
  }

  setTemperatureManual(temperatureC: number): void {
    this.state.temperature.mode = 'manual';
    this.state.temperature.temperatureC = temperatureC;
  }

  setEcologyManual(seasonProgress: number): void {
    this.state.ecology.mode = 'manual';
    this.state.ecology.seasonProgress = ((seasonProgress % 1) + 1) % 1;
  }

  setSurfaceManual(snowCover: number, wetness: number): void {
    this.state.surface.mode = 'manual';
    this.state.surface.snowCover = Math.max(0, Math.min(1, snowCover));
    this.state.surface.wetness = Math.max(0, Math.min(1, wetness));
  }

  restoreChannelToLive(channel: SyncChannelName, liveTimeMs: number = Date.now()): void {
    this.state[channel].mode = 'live';
    if (channel === 'astronomy') {
      this.state.astronomy.manualTimeMs = liveTimeMs;
      this.state.astronomy.timeScale = 1;
      this.state.astronomy.paused = false;
    }
  }

  restoreAllToLive(liveTimeMs: number = Date.now()): void {
    const channels: SyncChannelName[] = [
      'astronomy',
      'weather',
      'wind',
      'temperature',
      'ecology',
      'surface',
    ];
    for (const ch of channels) {
      this.restoreChannelToLive(ch, liveTimeMs);
    }
  }

  isAnyManual(): boolean {
    return (
      this.state.astronomy.mode === 'manual' ||
      this.state.weather.mode === 'manual' ||
      this.state.wind.mode === 'manual' ||
      this.state.temperature.mode === 'manual' ||
      this.state.ecology.mode === 'manual' ||
      this.state.surface.mode === 'manual'
    );
  }
}
