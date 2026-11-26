import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { windFromDegToTravelUnit } from '../src/atmosphere/Wind';
import { WeatherProvider } from '../src/atmosphere/WeatherProvider';
import { CloudSystem } from '../src/atmosphere/Clouds';
import { PrecipitationSystem } from '../src/atmosphere/Precipitation';
import { OverrideManager } from '../src/state/Overrides';
import { BENCHMARK_SCENARIOS, applyBenchmarkScenario } from '../src/core/Benchmarks';
import { clampPointToSphere } from '../src/rendering/Camera';
import { RealityStore } from '../src/state/Reality';
import { saveScenario, listScenarios } from '../src/state/Persistence';
import { SurfaceStateModel } from '../src/ecology/SurfaceState';
import { TerrainData } from '../src/geography/TerrainData';
import type { RegionConfig, SavedScenario } from '../src/core/types';

const fixtureRoot = resolve(process.cwd(), 'public/regions/test-fixture');
const fixtureConfig = JSON.parse(
  readFileSync(resolve(fixtureRoot, 'region.json'), 'utf-8')
) as RegionConfig;

function loadFixtureTerrain(): TerrainData {
  const level = fixtureConfig.terrain.levels.find((l) => l.id === 'balanced')!;
  const buf = readFileSync(resolve(fixtureRoot, level.file));
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new TerrainData(fixtureConfig, level, arrayBuf);
}

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('Atmospheric, Override, and Persistence Integrity', () => {
  it('interprets meteorological wind direction (origin) into travel vectors correctly', () => {
    const [nx, nz] = windFromDegToTravelUnit(0); // From North -> South (+Z)
    expect(Math.abs(nx)).toBeLessThan(1e-6);
    expect(nz).toBeCloseTo(1, 6);

    const [ex, ez] = windFromDegToTravelUnit(90); // From East -> West (-X)
    expect(ex).toBeCloseTo(-1, 6);
    expect(Math.abs(ez)).toBeLessThan(1e-6);

    const [wx, wz] = windFromDegToTravelUnit(270); // From West -> East (+X)
    expect(wx).toBeCloseTo(1, 6);
    expect(Math.abs(wz)).toBeLessThan(1e-6);
  });

  it('transitions weather smoothly and flags failed network fetches without throwing', async () => {
    const provider = new WeatherProvider(40.72, -89.58);
    await provider.refresh((async () => {
      throw new Error('Network down');
    }) as typeof fetch);

    const status = provider.getStatus();
    expect(status.state).toBe('offline');
    expect(provider.getLatestSample().isModeled).toBe(true);

    // Smooth interpolation check on RealityStore
    const reality = new RealityStore(40.72, -89.58, 155, Date.UTC(2026, 6, 1, 18, 0, 0));
    const ov = new OverrideManager();
    const astro = reality.computeAstronomicalState(ov.getState(), 0);
    const e0 = reality.computeEffectiveEnvironment(astro, ov.getState(), 1.0, 0);

    ov.setWeatherManual({ cloudCoverTotal: 1.0, precipitationType: 'rain', precipitationIntensity: 1.0 });
    const e1 = reality.computeEffectiveEnvironment(astro, ov.getState(), 1.0, 0.05);
    expect(e1.cloudCoverTotal).toBeGreaterThan(e0.cloudCoverTotal);
    expect(e1.cloudCoverTotal).toBeLessThan(1.0);
  });

  it('coalesces concurrent weather refreshes to avoid request bursts', async () => {
    const provider = new WeatherProvider(40.72, -89.58, 45 * 60 * 1000, 0);
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ current: { temperature_2m: 16, time: '2026-07-01T18:00' } }),
    })) as unknown as typeof fetch;
    await Promise.all([provider.refresh(fetchFn), provider.refresh(fetchFn)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps precipitation within regional volume and cloud advection independent of camera', () => {
    const terrain = loadFixtureTerrain();
    const precip = new PrecipitationSystem(fixtureConfig, terrain);
    const clouds = new CloudSystem(fixtureConfig);
    const reality = new RealityStore(40.72, -89.58, 155, Date.UTC(2026, 6, 1, 18, 0, 0));
    const ov = new OverrideManager();
    ov.setWeatherManual({ cloudCoverTotal: 0.8, precipitationType: 'rain', precipitationIntensity: 0.9 });
    ov.setWindManual(10, 270);

    const astro = reality.computeAstronomicalState(ov.getState(), 0);
    const env = reality.computeEffectiveEnvironment(astro, ov.getState(), 1.0, 0);

    for (let i = 0; i < 20; i++) {
      precip.update(0.1, env, 1.0);
      clouds.update(0.1, astro, env, new THREE.Color(0xffffff));
    }

    const active = precip.getActiveCount();
    expect(active).toBeGreaterThan(100);
    const pos = precip.getParticlePositions();
    const halfW = fixtureConfig.coordinateSystem.extentMeters.width * 0.5;
    const halfD = fixtureConfig.coordinateSystem.extentMeters.depth * 0.5;
    for (let i = 0; i < active; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      expect(Math.abs(x)).toBeLessThanOrEqual(halfW);
      expect(Math.abs(z)).toBeLessThanOrEqual(halfD);
      expect(y).toBeGreaterThanOrEqual(terrain.sampleYAt(x, z, 1.0));
    }
  });

  it('applies explicit cloud quality budgets', () => {
    const clouds = new CloudSystem(fixtureConfig);
    clouds.setQuality('low');
    expect(clouds.getVisibleInstanceCount()).toBe(108);
    clouds.setQuality('balanced');
    expect(clouds.getVisibleInstanceCount()).toBe(180);
    clouds.setQuality('high');
    expect(clouds.getVisibleInstanceCount()).toBe(240);
    clouds.dispose();
  });

  it('isolates synchronization channels and persists scenarios accurately', () => {
    const ov = new OverrideManager();
    const fixedTime = Date.UTC(2026, 0, 15, 18, 0, 0);
    ov.setAstronomyManual(fixedTime, 60, false);
    ov.setWeatherManual({ cloudCoverTotal: 0.9, precipitationType: 'rain', precipitationIntensity: 0.7 });

    // Manual weather must not mutate manual astronomy timestamp
    expect(ov.getState().astronomy.manualTimeMs).toBe(fixedTime);

    // Restoring weather keeps astronomy manual
    ov.restoreChannelToLive('weather');
    expect(ov.getState().weather.mode).toBe('live');
    expect(ov.getState().astronomy.mode).toBe('manual');

    // Scenario save & reload round-trip
    const storage = new MemoryStorage();
    const surface = new SurfaceStateModel({ wetness: 0.65, snowCover: 0.22 });
    const scenario: SavedScenario = {
      version: 1,
      name: 'Winter Storm Test',
      regionId: 'peoria-il',
      savedAtIso: '2026-11-25T16:00:00Z',
      overrides: ov.getState(),
      surface: surface.getState(),
      verticalExaggeration: 1.4,
    };
    saveScenario(scenario, storage);
    const loaded = listScenarios(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].overrides.astronomy.manualTimeMs).toBe(fixedTime);
    expect(loaded[0].surface.wetness).toBeCloseTo(0.65, 5);
    expect(loaded[0].verticalExaggeration).toBe(1.4);
  });

  it('applies fixed benchmark scenarios through explicit override channels', () => {
    expect(BENCHMARK_SCENARIOS).toHaveLength(3);
    for (const scenario of BENCHMARK_SCENARIOS) {
      const overrides = new OverrideManager();
      applyBenchmarkScenario(overrides, scenario.id);
      const state = overrides.getState();
      expect(state.astronomy.mode).toBe('manual');
      expect(state.astronomy.manualTimeMs).toBe(scenario.timestampMs);
      expect(state.weather.precipitationType).toBe(scenario.precipitation);
      expect(state.wind.fromDeg).toBe(scenario.windFromDeg);
      expect(state.surface.snowCover).toBe(scenario.snowCover);
    }
  });

  it('clamps camera positions to the celestial envelope without mutating world vectors', () => {
    const position = new THREE.Vector3(30_000, 4_000, -10_000);
    const originalDirection = new THREE.Vector3(0.4, 0.8, -0.4);
    expect(clampPointToSphere(position, 20_000)).toBe(true);
    expect(position.length()).toBeCloseTo(20_000, 6);
    expect(clampPointToSphere(position, 20_000)).toBe(false);
    expect(originalDirection.toArray()).toEqual([0.4, 0.8, -0.4]);
  });
});
