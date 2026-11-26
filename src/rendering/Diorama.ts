/**
 * Diorama assembly uniting geography, hydrology, civilization, ecology, atmosphere, and celestial space.
 */

import * as THREE from 'three';
import type {
  AstronomicalState,
  EffectiveEnvironmentState,
  GraphicsQuality,
  PersistentSurfaceState,
  RegionConfig,
} from '../core/types';
import { TerrainData } from '../geography/TerrainData';
import { TerrainSystem } from '../geography/Terrain';
import { HydrologySystem, type HydrologyPayload } from '../geography/Hydrology';
import { RoadNetworkSystem, type RailwaysPayload, type RoadsPayload } from '../civilization/Roads';
import { BridgeSystem, type BridgesPayload } from '../civilization/Bridges';
import { BuildingSystem, type BuildingsPayload } from '../civilization/Buildings';
import { VegetationSystem, type LandcoverPayload } from '../ecology/Vegetation';
import { CelestialSpace } from '../celestial/CelestialSpace';
import { SunVisual } from '../celestial/Sun';
import { MoonVisual } from '../celestial/Moon';
import { CloudSystem } from '../atmosphere/Clouds';
import { FogSystem } from '../atmosphere/Fog';
import { PrecipitationSystem } from '../atmosphere/Precipitation';
import { LightingSystem } from './Lighting';

export interface RegionAssets {
  config: RegionConfig;
  terrainData: TerrainData;
  hydrology: HydrologyPayload;
  roads: RoadsPayload;
  railways: RailwaysPayload;
  bridges: BridgesPayload;
  buildings: BuildingsPayload;
  landcover: LandcoverPayload;
}

export interface DioramaDiagnostics {
  activeTerrainChunks: number;
  waterMeshes: number;
  vegetationInstances: number;
  cloudInstances: number;
  precipitationPoints: number;
}

export class DioramaScene {
  readonly scene = new THREE.Scene();
  readonly worldGroup = new THREE.Group();
  readonly terrain: TerrainSystem;
  readonly hydrology: HydrologySystem;
  readonly roads: RoadNetworkSystem;
  readonly bridges: BridgeSystem;
  readonly buildings: BuildingSystem;
  readonly vegetation: VegetationSystem;
  readonly celestialSpace: CelestialSpace;
  readonly sunVisual: SunVisual;
  readonly moonVisual: MoonVisual;
  readonly clouds: CloudSystem;
  readonly fog: FogSystem;
  readonly precipitation: PrecipitationSystem;
  readonly lighting: LightingSystem;
  readonly config: RegionConfig;
  private quality: GraphicsQuality = 'balanced';
  private lastSurfaceSig = -1;
  private readonly celestialEnvelopeRadius: number;

  constructor(assets: RegionAssets) {
    this.config = assets.config;
    this.scene.background = new THREE.Color(0x0b0f16);
    this.worldGroup.name = 'MicrocosmWorld';
    this.scene.add(this.worldGroup);

    const maxExtent = Math.max(
      assets.config.coordinateSystem.extentMeters.width,
      assets.config.coordinateSystem.extentMeters.depth
    );
    const celestialRadius = maxExtent * 0.88;
    this.celestialEnvelopeRadius = celestialRadius * 1.04;

    this.terrain = new TerrainSystem(assets.terrainData);
    this.hydrology = new HydrologySystem(assets.config, assets.hydrology);
    this.roads = new RoadNetworkSystem(assets.config, assets.terrainData, assets.roads, assets.railways);
    this.bridges = new BridgeSystem(assets.config, assets.terrainData, assets.bridges);
    this.buildings = new BuildingSystem(assets.config, assets.buildings);
    this.vegetation = new VegetationSystem(
      assets.config,
      assets.terrainData,
      assets.landcover,
      assets.hydrology,
      assets.roads,
      assets.buildings
    );

    this.celestialSpace = new CelestialSpace(
      celestialRadius,
      assets.config.reference.latitude,
      assets.config.reference.longitude
    );
    this.sunVisual = new SunVisual(celestialRadius * 0.96);
    this.moonVisual = new MoonVisual(celestialRadius * 0.94);
    this.clouds = new CloudSystem(assets.config);
    this.fog = new FogSystem(assets.config, assets.terrainData);
    this.precipitation = new PrecipitationSystem(assets.config, assets.terrainData);
    this.lighting = new LightingSystem();

    this.scene.fog = this.fog.sceneFog;

    this.worldGroup.add(
      this.terrain.group,
      this.hydrology.group,
      this.roads.group,
      this.bridges.group,
      this.buildings.group,
      this.vegetation.group,
      this.celestialSpace.group,
      this.sunVisual.group,
      this.moonVisual.mesh,
      this.clouds.group,
      this.fog.group,
      this.precipitation.group,
      this.lighting.group
    );
    this.setQuality(this.quality);
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    this.lighting.setQuality(quality);
    this.clouds.setQuality(quality);
    this.vegetation.setQuality(quality);
    this.fog.setQuality(quality);
  }

  getCelestialEnvelopeRadius(): number {
    return this.celestialEnvelopeRadius;
  }

  getDiagnostics(): DioramaDiagnostics {
    return {
      activeTerrainChunks: this.terrain.getActiveChunkCount(),
      waterMeshes: this.hydrology.getMeshCount(),
      vegetationInstances: this.vegetation.getVisibleInstanceCount(),
      cloudInstances: this.clouds.getVisibleInstanceCount(),
      precipitationPoints: this.precipitation.getActiveCount(),
    };
  }

  setVerticalExaggeration(factor: number): void {
    this.terrain.setVerticalExaggeration(factor);
    this.hydrology.setVerticalExaggeration(factor);
    this.roads.setVerticalExaggeration(factor);
    this.bridges.setVerticalExaggeration(factor);
    this.buildings.setVerticalExaggeration(factor);
    this.vegetation.setVerticalExaggeration(factor);
    this.fog.setVerticalExaggeration(factor);
    this.precipitation.setVerticalExaggeration(factor);
  }

  update(
    dtRealSeconds: number,
    elapsedSeconds: number,
    astro: AstronomicalState,
    env: EffectiveEnvironmentState,
    surface: PersistentSurfaceState,
    camera: THREE.Camera,
    cameraTarget: THREE.Vector3
  ): void {
    this.setVerticalExaggeration(env.verticalExaggeration);

    const maxSegs = this.quality === 'high' ? 96 : this.quality === 'balanced' ? 48 : 24;
    this.terrain.updateLOD(camera.position, maxSegs);

    this.celestialSpace.update(astro, env);
    const skyColor = this.celestialSpace.getHorizonSkyColor();
    this.lighting.update(astro, env, cameraTarget, skyColor);
    this.sunVisual.update(astro, env, camera.position, this.lighting.sunColor);
    this.moonVisual.update(astro, env);
    this.clouds.update(dtRealSeconds, astro, env, this.lighting.sunColor);
    this.fog.update(elapsedSeconds, astro, env, skyColor);
    this.hydrology.update(elapsedSeconds, astro, env, this.lighting.sunColor, skyColor);
    this.buildings.update(astro);

    const precipScale = this.quality === 'high' ? 1.0 : this.quality === 'balanced' ? 0.72 : 0.4;
    this.precipitation.update(dtRealSeconds, env, precipScale);
    this.vegetation.update(elapsedSeconds, astro.dayOfYear, env, surface);

    // Update terrain vertex shading only when surface wetness/snow/grass shifts noticeably
    const sig =
      Math.round(surface.wetness * 40) +
      Math.round(surface.snowCover * 40) * 100 +
      Math.round(surface.foliageGreenness * 40) * 10000 +
      Math.round(surface.foliageAutumnFactor * 40) * 1000000;
    if (sig !== this.lastSurfaceSig) {
      this.lastSurfaceSig = sig;
      const grass = Math.max(0.18, surface.foliageGreenness * 0.85 + surface.foliageLeafRetention * 0.15);
      this.terrain.updateSurfaceAppearance(surface, grass);
    }
  }

  dispose(): void {
    this.terrain.dispose();
    this.hydrology.dispose();
    this.roads.dispose();
    this.bridges.dispose();
    this.buildings.dispose();
    this.vegetation.dispose();
    this.celestialSpace.dispose();
    this.sunVisual.dispose();
    this.moonVisual.dispose();
    this.clouds.dispose();
    this.fog.dispose();
    this.precipitation.dispose();
    this.lighting.dispose();
  }
}
