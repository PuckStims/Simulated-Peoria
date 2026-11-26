/**
 * Atmospheric interpolation helper for multi-sample or temporally evolving atmospheric states.
 */

import type { WeatherSample } from '../core/types';

export function interpolateWeatherSamples(
  a: WeatherSample,
  b: WeatherSample,
  t: number
): WeatherSample {
  const f = Math.max(0, Math.min(1, t));
  const lerp = (x: number, y: number) => x + (y - x) * f;
  const angleDiff = ((((b.windFromDeg - a.windFromDeg) % 360) + 540) % 360) - 180;
  const windFromDeg = ((a.windFromDeg + angleDiff * f) % 360 + 360) % 360;

  return {
    sourceName: b.sourceName,
    isModeled: true,
    fetchedAtMs: Math.round(lerp(a.fetchedAtMs, b.fetchedAtMs)),
    validTimeMs: Math.round(lerp(a.validTimeMs, b.validTimeMs)),
    temperatureC: lerp(a.temperatureC, b.temperatureC),
    relativeHumidityPct: lerp(a.relativeHumidityPct, b.relativeHumidityPct),
    precipitationMmHr: lerp(a.precipitationMmHr, b.precipitationMmHr),
    rainMmHr: lerp(a.rainMmHr, b.rainMmHr),
    snowfallCmHr: lerp(a.snowfallCmHr, b.snowfallCmHr),
    snowDepthCm: lerp(a.snowDepthCm, b.snowDepthCm),
    cloudCoverTotalPct: lerp(a.cloudCoverTotalPct, b.cloudCoverTotalPct),
    cloudCoverLowPct: lerp(a.cloudCoverLowPct, b.cloudCoverLowPct),
    cloudCoverMidPct: lerp(a.cloudCoverMidPct, b.cloudCoverMidPct),
    cloudCoverHighPct: lerp(a.cloudCoverHighPct, b.cloudCoverHighPct),
    windSpeedMs: lerp(a.windSpeedMs, b.windSpeedMs),
    windFromDeg,
    windGustMs: lerp(a.windGustMs, b.windGustMs),
    visibilityMeters: lerp(a.visibilityMeters, b.visibilityMeters),
    weatherCode: f < 0.5 ? a.weatherCode : b.weatherCode,
    shortwaveRadiationWm2:
      a.shortwaveRadiationWm2 !== null && b.shortwaveRadiationWm2 !== null
        ? lerp(a.shortwaveRadiationWm2, b.shortwaveRadiationWm2)
        : b.shortwaveRadiationWm2,
  };
}
