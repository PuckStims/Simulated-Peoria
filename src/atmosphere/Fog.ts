/**
 * Atmospheric haze and localized Illinois River Valley mist (Section 11.6).
 */

import * as THREE from 'three';
import type { AstronomicalState, EffectiveEnvironmentState, GraphicsQuality, RegionConfig } from '../core/types';
import type { TerrainData } from '../geography/TerrainData';

export class FogSystem {
  readonly group = new THREE.Group();
  readonly sceneFog = new THREE.FogExp2(0x9fb8cc, 0.000012);
  private readonly valleyMistMesh: THREE.Mesh;
  private readonly mistMat: THREE.ShaderMaterial;
  private quality: GraphicsQuality = 'balanced';
  private daylightMode = false;

  constructor(config: RegionConfig, terrainData: TerrainData) {
    this.group.name = 'FogSystem';
    const w = config.coordinateSystem.extentMeters.width;
    const d = config.coordinateSystem.extentMeters.depth;
    const datum = config.coordinateSystem.origin.elevationDatumMeters;
    const waterRef = config.terrain.waterReferenceElevationMeters;

    // Build a low-altitude valley mist sheet following the floodplain / river valley mask
    const segsX = 64;
    const segsZ = 80;
    const geom = new THREE.PlaneGeometry(w * 0.98, d * 0.98, segsX, segsZ);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const mistStrength = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const elev = terrainData.sampleElevationAt(x, z);
      const heightAboveRiver = elev - waterRef;
      // Mist settles strongest in low valley floor & side ravines (< 22m above river)
      const valleyWeight = Math.max(0, Math.min(1, 1 - heightAboveRiver / 26));
      mistStrength[i] = valleyWeight;
      pos.setY(i, waterRef - datum + 14.0);
    }
    geom.setAttribute('aMistWeight', new THREE.BufferAttribute(mistStrength, 1));

    this.mistMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWindVec: { value: new THREE.Vector2(1, 0) },
        uMistFactor: { value: 0.2 },
        uColor: { value: new THREE.Color(0xcfdce6) },
      },
      vertexShader: /* glsl */ `
        attribute float aMistWeight;
        varying float vMistWeight;
        varying vec3 vWorldPos;
        void main() {
          vMistWeight = aMistWeight;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uWindVec;
        uniform float uMistFactor;
        uniform vec3 uColor;
        varying float vMistWeight;
        varying vec3 vWorldPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          vec2 uv = vWorldPos.xz * 0.00045 - uWindVec * (uTime * 0.012);
          float wisp = noise(uv) * 0.65 + noise(uv * 2.3 + 4.1) * 0.35;
          float alpha = vMistWeight * uMistFactor * (0.25 + 0.75 * wisp) * 0.55;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.valleyMistMesh = new THREE.Mesh(geom, this.mistMat);
    this.valleyMistMesh.name = 'ValleyMistLayer';
    this.group.add(this.valleyMistMesh);
  }

  setVerticalExaggeration(factor: number): void {
    this.group.scale.set(1, factor, 1);
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
  }

  setDaylightMode(enabled: boolean): void {
    this.daylightMode = enabled;
  }

  update(
    elapsedSeconds: number,
    astro: AstronomicalState,
    env: EffectiveEnvironmentState,
    skyColor: THREE.Color
  ): void {
    const dayT = Math.max(0, Math.min(1, (astro.solarAltitudeRad + 0.06) / 0.28));
    const fogColor = new THREE.Color(0x131b29).lerp(skyColor, dayT * 0.85 + 0.15);
    this.sceneFog.color.copy(fogColor);

    // Keep distant visibility crisp when clear, denser under fog/haze
    const baseDensity = 0.000004 + env.fogDensity * 0.000085;
    this.sceneFog.density = baseDensity * (this.quality === 'low' ? 0.8 : 1) * (this.daylightMode ? 0.35 : 1);

    this.mistMat.uniforms.uTime.value = elapsedSeconds;
    this.mistMat.uniforms.uWindVec.value.set(env.windVector[0], env.windVector[1]);
    this.mistMat.uniforms.uMistFactor.value = env.valleyMistFactor;
    this.mistMat.uniforms.uColor.value.copy(fogColor).lerp(new THREE.Color(0xdde6ee), 0.35 * dayT);
    this.valleyMistMesh.visible = !this.daylightMode && env.valleyMistFactor > (this.quality === 'low' ? 0.1 : 0.03);
  }

  dispose(): void {
    this.valleyMistMesh.geometry.dispose();
    this.mistMat.dispose();
  }
}
