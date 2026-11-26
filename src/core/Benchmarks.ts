/** Repeatable visual/performance scenarios using explicit manual override channels. */

import type { OverrideManager } from '../state/Overrides';
import type { BenchmarkScenarioId, ChannelOverrideState } from './types';

export interface BenchmarkScenario {
  id: BenchmarkScenarioId;
  label: string;
  description: string;
  timestampMs: number;
  temperatureC: number;
  cloudCover: number;
  precipitation: ChannelOverrideState['weather']['precipitationType'];
  precipitationIntensity: number;
  fog: number;
  windSpeedMs: number;
  windFromDeg: number;
  seasonProgress: number;
  snowCover: number;
  wetness: number;
}

export const BENCHMARK_SCENARIOS: readonly BenchmarkScenario[] = [
  {
    id: 'clear-noon',
    label: 'Clear Summer Noon',
    description: 'Baseline terrain, structures, vegetation, and direct shadows.',
    timestampMs: Date.UTC(2026, 5, 21, 18, 0),
    temperatureC: 24,
    cloudCover: 0.12,
    precipitation: 'none',
    precipitationIntensity: 0,
    fog: 0.02,
    windSpeedMs: 2.5,
    windFromDeg: 245,
    seasonProgress: 0.47,
    snowCover: 0,
    wetness: 0.05,
  },
  {
    id: 'rain-storm',
    label: 'Overcast Rain',
    description: 'Maximum practical cloud, fog, wind, and rain workload.',
    timestampMs: Date.UTC(2026, 8, 18, 21, 0),
    temperatureC: 13,
    cloudCover: 0.96,
    precipitation: 'rain',
    precipitationIntensity: 0.9,
    fog: 0.52,
    windSpeedMs: 12,
    windFromDeg: 210,
    seasonProgress: 0.72,
    snowCover: 0,
    wetness: 0.82,
  },
  {
    id: 'winter-snow',
    label: 'Winter Snow',
    description: 'Snow particles, snow surface state, and low-angle light.',
    timestampMs: Date.UTC(2026, 11, 21, 20, 0),
    temperatureC: -7,
    cloudCover: 0.78,
    precipitation: 'snow',
    precipitationIntensity: 0.72,
    fog: 0.26,
    windSpeedMs: 7,
    windFromDeg: 330,
    seasonProgress: 0.98,
    snowCover: 0.72,
    wetness: 0.24,
  },
] as const;

export function getBenchmarkScenario(id: BenchmarkScenarioId): BenchmarkScenario {
  const scenario = BENCHMARK_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown benchmark scenario: ${id}`);
  return scenario;
}

export function applyBenchmarkScenario(overrides: OverrideManager, id: BenchmarkScenarioId): void {
  const scenario = getBenchmarkScenario(id);
  overrides.setAstronomyManual(scenario.timestampMs, 1, true);
  overrides.setWeatherManual({
    cloudCoverTotal: scenario.cloudCover,
    precipitationType: scenario.precipitation,
    precipitationIntensity: scenario.precipitationIntensity,
    fogDensity: scenario.fog,
  });
  overrides.setWindManual(scenario.windSpeedMs, scenario.windFromDeg);
  overrides.setTemperatureManual(scenario.temperatureC);
  overrides.setEcologyManual(scenario.seasonProgress);
  overrides.setSurfaceManual(scenario.snowCover, scenario.wetness);
}
