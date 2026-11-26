/**
 * Top-level simulation world controller (Sections 20 & 21).
 * Bridges RealityStore, OverrideManager, SurfaceStateModel, DioramaScene, and CameraController.
 */

import * as THREE from 'three';
import { EventBus } from './EventBus';
import type {
  AstronomicalState,
  ChannelOverrideState,
  EffectiveEnvironmentState,
  GraphicsQuality,
  BenchmarkScenarioId,
  PerformanceDiagnostics,
  PersistentSurfaceState,
  RegionConfig,
  SavedScenario,
  SyncChannelName,
  WeatherProviderStatus,
} from './types';
import { GeoProjection } from '../geography/Projection';
import { RealityStore } from '../state/Reality';
import { OverrideManager } from '../state/Overrides';
import { SurfaceStateModel } from '../ecology/SurfaceState';
import {
  deleteScenario,
  listScenarios,
  loadSurfaceState,
  saveScenario,
  saveSurfaceState,
} from '../state/Persistence';
import { DioramaScene, type RegionAssets } from '../rendering/Diorama';
import { CameraController } from '../rendering/Camera';
import { MicrocosmRenderer } from '../rendering/Renderer';
import { applyBenchmarkScenario } from './Benchmarks';
import type { BuildingFunctionCategory, BuildingVisualizationMode } from '../civilization/Buildings';

export interface WorldSnapshot {
  config: RegionConfig;
  astro: AstronomicalState;
  env: EffectiveEnvironmentState;
  surface: PersistentSurfaceState;
  overrides: ChannelOverrideState;
  weatherStatus: WeatherProviderStatus;
  weatherSourceName: string;
  compassHeadingDeg: number;
  cameraMode: 'perspective' | 'orthographic';
  autoOrbit: boolean;
  quality: GraphicsQuality;
  fps: number;
  diagnostics: PerformanceDiagnostics;
  activeBenchmark: BenchmarkScenarioId | null;
  daylightMode: boolean;
}

export type WorldEvents = {
  snapshot: WorldSnapshot;
  scenariosChanged: SavedScenario[];
};

export class MicrocosmWorld {
  readonly bus = new EventBus<WorldEvents>();
  readonly assets: RegionAssets;
  readonly projection: GeoProjection;
  readonly reality: RealityStore;
  readonly overrides: OverrideManager;
  readonly surfaceModel: SurfaceStateModel;
  readonly diorama: DioramaScene;
  readonly cameraCtrl: CameraController;
  readonly renderer: MicrocosmRenderer;

  private verticalExaggeration = 2.0;
  private daylightMode = false;
  private rafId = 0;
  private lastFrameMs = 0;
  private elapsedSeconds = 0;
  private surfaceAccumSeconds = 0;
  private persistAccumSeconds = 0;
  private uiEmitAccumSeconds = 0;
  private weatherTimerId = 0;
  private isHidden = false;
  private fps = 60;
  private frameCounter = 0;
  private fpsAccumSeconds = 0;
  private activeBenchmark: BenchmarkScenarioId | null = null;
  private diagnostics: PerformanceDiagnostics;

  private lastAstro: AstronomicalState;
  private lastEnv: EffectiveEnvironmentState;
  private lastSurface: PersistentSurfaceState;

  constructor(canvas: HTMLCanvasElement, assets: RegionAssets) {
    this.assets = assets;
    this.projection = new GeoProjection(assets.config);
    this.reality = new RealityStore(
      assets.config.reference.latitude,
      assets.config.reference.longitude,
      assets.config.reference.elevationMeters
    );
    this.overrides = new OverrideManager();

    const savedSurface = loadSurfaceState(assets.config.id);
    this.surfaceModel = new SurfaceStateModel(savedSurface ?? undefined);

    this.diorama = new DioramaScene(assets);
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.renderer = new MicrocosmRenderer(canvas);
    this.renderer.resize(width, height);
    this.cameraCtrl = new CameraController(canvas, width / Math.max(1, height));
    this.cameraCtrl.setWorldEnvelope(this.diorama.getCelestialEnvelopeRadius());

    const ov = this.overrides.getState();
    this.lastAstro = this.reality.computeAstronomicalState(ov, 0);
    this.lastEnv = this.reality.computeEffectiveEnvironment(
      this.lastAstro,
      ov,
      this.verticalExaggeration,
      0
    );
    this.lastSurface = this.surfaceModel.getState();
    this.diagnostics = {
      frameMs: 0,
      updateMs: 0,
      renderMs: 0,
      drawCalls: 0,
      triangles: 0,
      points: 0,
      lines: 0,
      geometries: 0,
      textures: 0,
      activeTerrainChunks: this.diorama.getDiagnostics().activeTerrainChunks,
      waterMeshes: this.diorama.getDiagnostics().waterMeshes,
      vegetationInstances: this.diorama.getDiagnostics().vegetationInstances,
      cloudInstances: this.diorama.getDiagnostics().cloudInstances,
      precipitationPoints: 0,
      sourceAssetBytes: Object.values(assets.config.assetIntegrity?.assets ?? {}).reduce(
        (total, asset) => total + asset.bytes,
        0
      ),
      assetLoadMs: null,
      sceneConstructionMs: null,
    };

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  start(): void {
    void this.reality.weatherProvider.refresh();
    this.weatherTimerId = window.setInterval(() => {
      if (!this.isHidden) {
        void this.reality.weatherProvider.refresh();
      }
    }, 15 * 60 * 1000);

    this.lastFrameMs = performance.now();
    this.emitSnapshot();
    this.loop(this.lastFrameMs);
  }

  private loop = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (this.isHidden) {
      this.lastFrameMs = nowMs;
      return;
    }

    const dtReal = Math.max(0.001, Math.min((nowMs - this.lastFrameMs) / 1000, 0.25));
    this.lastFrameMs = nowMs;
    const updateStartedMs = performance.now();
    this.elapsedSeconds += dtReal;

    this.frameCounter++;
    this.fpsAccumSeconds += dtReal;
    if (this.fpsAccumSeconds >= 0.6) {
      this.fps = Math.round(this.frameCounter / this.fpsAccumSeconds);
      this.frameCounter = 0;
      this.fpsAccumSeconds = 0;
    }

    const ovState = this.overrides.getState();
    this.lastAstro = this.reality.computeAstronomicalState(ovState, dtReal, Date.now());
    // Sync advancing manual clock back to OverrideManager
    if (ovState.astronomy.mode === 'manual') {
      this.overrides.setAstronomyManual(
        this.lastAstro.timestampMs,
        ovState.astronomy.timeScale,
        ovState.astronomy.paused
      );
    }

    this.lastEnv = this.reality.computeEffectiveEnvironment(
      this.lastAstro,
      ovState,
      this.verticalExaggeration,
      dtReal
    );

    // Low-frequency environmental persistence update (every ~0.5s real time)
    this.surfaceAccumSeconds += dtReal;
    if (this.surfaceAccumSeconds >= 0.5) {
      const simScale = ovState.astronomy.mode === 'manual' ? ovState.astronomy.timeScale : 1;
      const dtSim = ovState.astronomy.paused ? 0 : this.surfaceAccumSeconds * simScale;
      this.lastSurface = this.surfaceModel.step(
        dtSim,
        this.lastEnv,
        this.lastAstro.solarAltitudeRad,
        this.lastAstro.dayOfYear
      );
      this.surfaceAccumSeconds = 0;
    }

    this.persistAccumSeconds += dtReal;
    if (this.persistAccumSeconds >= 10) {
      saveSurfaceState(this.assets.config.id, this.lastSurface);
      this.persistAccumSeconds = 0;
    }

    this.cameraCtrl.update(dtReal);
    this.diorama.update(
      dtReal,
      this.elapsedSeconds,
      this.lastAstro,
      this.lastEnv,
      this.lastSurface,
      this.cameraCtrl.activeCamera,
      this.cameraCtrl.getTarget()
    );
    const renderStartedMs = performance.now();
    this.renderer.render(this.diorama.scene, this.cameraCtrl.activeCamera);
    const renderEndedMs = performance.now();
    const renderStats = this.renderer.getDiagnostics();
    const dioramaStats = this.diorama.getDiagnostics();
    const smooth = (previous: number, next: number) =>
      previous === 0 ? next : previous + (next - previous) * 0.12;
    this.diagnostics = {
      ...this.diagnostics,
      frameMs: smooth(this.diagnostics.frameMs, dtReal * 1000),
      updateMs: smooth(this.diagnostics.updateMs, renderStartedMs - updateStartedMs),
      renderMs: smooth(this.diagnostics.renderMs, renderEndedMs - renderStartedMs),
      ...renderStats,
      ...dioramaStats,
    };

    this.uiEmitAccumSeconds += dtReal;
    if (this.uiEmitAccumSeconds >= 0.2) {
      this.emitSnapshot();
      this.uiEmitAccumSeconds = 0;
    }
  };

  private onResize = (): void => {
    const canvas = this.renderer.webgl.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.renderer.resize(width, height);
    this.cameraCtrl.resize(width / Math.max(1, height));
  };

  private onVisibilityChange = (): void => {
    this.isHidden = document.hidden;
    if (!this.isHidden) {
      this.lastFrameMs = performance.now();
    }
  };

  getSnapshot(): WorldSnapshot {
    return {
      config: this.assets.config,
      astro: this.lastAstro,
      env: this.lastEnv,
      surface: this.lastSurface,
      overrides: this.overrides.getState(),
      weatherStatus: this.reality.getWeatherStatus(),
      weatherSourceName: this.reality.getWeatherSample().sourceName,
      compassHeadingDeg: this.cameraCtrl.getCompassHeadingDeg(),
      cameraMode: this.cameraCtrl.getMode(),
      autoOrbit: this.cameraCtrl.isAutoOrbit(),
      quality: this.renderer.getQuality(),
      fps: this.fps,
      diagnostics: { ...this.diagnostics },
      activeBenchmark: this.activeBenchmark,
      daylightMode: this.daylightMode,
    };
  }

  emitSnapshot(): void {
    this.bus.emit('snapshot', this.getSnapshot());
  }

  setQuality(quality: GraphicsQuality): void {
    this.renderer.setQuality(quality);
    this.diorama.setQuality(quality);
    this.emitSnapshot();
  }

  setStartupMetrics(assetLoadMs: number, sceneConstructionMs: number): void {
    this.diagnostics = {
      ...this.diagnostics,
      assetLoadMs,
      sceneConstructionMs,
    };
  }

  applyBenchmarkScenario(id: BenchmarkScenarioId): void {
    applyBenchmarkScenario(this.overrides, id);
    this.activeBenchmark = id;
    this.emitSnapshot();
  }

  setVerticalExaggeration(factor: number): void {
    this.verticalExaggeration = Math.max(1.0, Math.min(2.5, factor));
    this.emitSnapshot();
  }

  setDaylightMode(enabled: boolean): void {
    this.daylightMode = enabled;
    this.diorama.setDaylightMode(enabled);
    this.emitSnapshot();
  }

  setBuildingVisualization(mode: BuildingVisualizationMode, categories: Iterable<BuildingFunctionCategory> | null = null): void {
    this.diorama.setBuildingVisualization(mode, categories);
    this.emitSnapshot();
  }

  getVerticalExaggeration(): number {
    return this.verticalExaggeration;
  }

  restoreChannel(channel: SyncChannelName): void {
    this.overrides.restoreChannelToLive(channel, Date.now());
    this.emitSnapshot();
  }

  restoreAllToReality(): void {
    this.overrides.restoreAllToLive(Date.now());
    this.verticalExaggeration = 2.0;
    this.setDaylightMode(false);
    this.activeBenchmark = null;
    this.emitSnapshot();
  }

  refreshWeatherNow(): void {
    void this.reality.weatherProvider.refresh().then(() => this.emitSnapshot());
  }

  listSavedScenarios(): SavedScenario[] {
    return listScenarios();
  }

  saveCurrentScenario(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const scenario: SavedScenario = {
      version: 1,
      name: trimmed,
      regionId: this.assets.config.id,
      savedAtIso: new Date().toISOString(),
      overrides: this.overrides.getState(),
      surface: this.surfaceModel.getState(),
      verticalExaggeration: this.verticalExaggeration,
    };
    const next = saveScenario(scenario);
    this.bus.emit('scenariosChanged', next);
  }

  applyScenario(scenario: SavedScenario): void {
    this.overrides.setState(scenario.overrides);
    this.surfaceModel.setState(scenario.surface);
    this.verticalExaggeration = scenario.verticalExaggeration ?? 2.0;
    this.lastSurface = this.surfaceModel.getState();
    this.emitSnapshot();
  }

  removeScenario(name: string): void {
    const next = deleteScenario(name);
    this.bus.emit('scenariosChanged', next);
  }

  projectLandmarkToScreen(lon: number, lat: number): { x: number; y: number; visible: boolean } {
    const [lx, lz] = this.projection.lonLatToLocal(lon, lat);
    const ly = this.assets.terrainData.sampleYAt(lx, lz, this.verticalExaggeration) + 60;
    const v = new THREE.Vector3(lx, ly, lz);
    v.project(this.cameraCtrl.activeCamera);
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      visible: v.z > -1 && v.z < 1,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    clearInterval(this.weatherTimerId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    saveSurfaceState(this.assets.config.id, this.lastSurface);
    this.cameraCtrl.dispose();
    this.diorama.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }
}
