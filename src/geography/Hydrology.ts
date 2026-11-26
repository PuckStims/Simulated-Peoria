/**
 * Hydrology rendering: distinct water surfaces for lakes, rivers, ponds, streams, and wetlands.
 * Water surfaces preserve real geographic boundaries and respond to wind, solar direction, and cloud cover.
 */

import * as THREE from 'three';
import type { AstronomicalState, EffectiveEnvironmentState, RegionConfig } from '../core/types';

export interface WaterBodyRecord {
  id: string;
  name: string;
  kind: 'river' | 'lake' | 'pond' | 'wetland';
  elevationMeters: number;
  /** True when the water surface was inferred from the measured DEM rather than a stage gauge. */
  elevationEstimated?: boolean;
  outer: [number, number][];
  holes?: [number, number][][];
}

export interface WaterwayRecord {
  id: string;
  name: string;
  kind: 'river' | 'stream' | 'canal';
  widthMeters: number;
  /** True when width was inferred because the source line has no usable width tag. */
  widthEstimated?: boolean;
  points: [number, number, number][];
}

export interface HydrologyPayload {
  provenance: Record<string, unknown>;
  waterBodies: WaterBodyRecord[];
  waterways: WaterwayRecord[];
}

const WATER_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const WATER_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec2 uWindVec;
  uniform float uWindSpeed;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform float uCloudCover;
  uniform float uOpacity;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;

  varying vec3 vWorldPos;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 drift = uWindVec * (uTime * (2.5 + uWindSpeed * 0.9));
    vec2 uv1 = vWorldPos.xz * 0.022 - drift * 0.14;
    vec2 uv2 = vWorldPos.xz * 0.055 - drift * 0.24 + vec2(17.3, 9.1);

    float n1 = noise(uv1);
    float n2 = noise(uv2);
    float wave = (n1 * 0.65 + n2 * 0.35) - 0.5;

    float eps = 0.04;
    float nx = (noise(uv1 + vec2(eps, 0.0)) - n1) * 1.4 + (noise(uv2 + vec2(eps, 0.0)) - n2) * 0.8;
    float nz = (noise(uv1 + vec2(0.0, eps)) - n1) * 1.4 + (noise(uv2 + vec2(0.0, eps)) - n2) * 0.8;
    float rippleAmp = 0.12 + min(0.28, uWindSpeed * 0.025);
    vec3 normal = normalize(vec3(-nx * rippleAmp, 1.0, -nz * rippleAmp));

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.2);

    vec3 baseWater = mix(uDeepColor, uShallowColor, 0.35 + wave * 0.3);
    float sunVis = smoothstep(-0.04, 0.12, uSunDir.y);

    // Diffuse + cloud-modulated sky reflection
    vec3 skyReflect = mix(uSkyColor, vec3(0.55, 0.59, 0.64), uCloudCover * 0.65);
    vec3 color = mix(baseWater, skyReflect, clamp(0.18 + fresnel * 0.62, 0.0, 0.85));

    // Solar specular path
    vec3 halfVec = normalize(normalize(uSunDir) + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), 96.0) * sunVis * (1.0 - 0.72 * uCloudCover);
    color += uSunColor * spec * 1.15;

    // Gentle daylight illumination
    float dayFactor = 0.24 + 0.76 * sunVis;
    color *= dayFactor;

    gl_FragColor = vec4(color, uOpacity);
  }
`;

export class HydrologySystem {
  readonly group = new THREE.Group();
  private readonly waterMaterial: THREE.ShaderMaterial;
  private readonly wetlandMaterial: THREE.MeshStandardMaterial;
  private readonly streamMaterial: THREE.MeshStandardMaterial;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly datumMeters: number;

  constructor(config: RegionConfig, payload: HydrologyPayload) {
    this.group.name = 'HydrologySystem';
    this.datumMeters = config.coordinateSystem.origin.elevationDatumMeters;

    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWindVec: { value: new THREE.Vector2(1, 0) },
        uWindSpeed: { value: 4.0 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, -0.4).normalize() },
        uSunColor: { value: new THREE.Color(0xfff1d6) },
        uSkyColor: { value: new THREE.Color(0x6e9bc5) },
        uCloudCover: { value: 0.3 },
        uOpacity: { value: 0.88 },
        uDeepColor: { value: new THREE.Color(0x1b3c4b) },
        uShallowColor: { value: new THREE.Color(0x2d5868) },
      },
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
    });

    this.wetlandMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b4d3b,
      roughness: 0.82,
      metalness: 0.04,
      transparent: true,
      opacity: 0.78,
    });

    this.streamMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b5363,
      roughness: 0.25,
      metalness: 0.15,
      transparent: true,
      opacity: 0.86,
    });

    this.buildWaterBodies(payload.waterBodies);
    this.buildWaterways(payload.waterways);
  }

  private buildWaterBodies(bodies: WaterBodyRecord[]): void {
    for (const body of bodies) {
      if (body.outer.length < 3) continue;
      // Shape uses (x, -z) so rotating -PI/2 around X places +Y_shape onto -Z_world (north)
      const shape = new THREE.Shape();
      shape.moveTo(body.outer[0][0], -body.outer[0][1]);
      for (let i = 1; i < body.outer.length; i++) {
        shape.lineTo(body.outer[i][0], -body.outer[i][1]);
      }
      shape.closePath();

      if (body.holes) {
        for (const hole of body.holes) {
          if (hole.length < 3) continue;
          const path = new THREE.Path();
          path.moveTo(hole[0][0], -hole[0][1]);
          for (let i = 1; i < hole.length; i++) {
            path.lineTo(hole[i][0], -hole[i][1]);
          }
          path.closePath();
          shape.holes.push(path);
        }
      }

      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      const y = body.elevationMeters - this.datumMeters;
      geom.translate(0, y, 0);

      const mat = body.kind === 'wetland' ? this.wetlandMaterial : this.waterMaterial;
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = body.name || body.id;
      mesh.userData.surfaceElevationMeters = body.elevationMeters;
      mesh.userData.elevationEstimated = body.elevationEstimated === true;
      // Water should win depth tests against its own sampled terrain bed without
      // changing its real horizontal boundary.
      mesh.renderOrder = body.kind === 'river' ? 2 : 1;
      mesh.receiveShadow = body.kind === 'wetland';
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  private buildWaterways(ways: WaterwayRecord[]): void {
    if (ways.length === 0) return;
    const riverLines = ways.filter((way) => way.kind === 'river');
    const minorLines = ways.filter((way) => way.kind !== 'river');
    const buildRibbon = (
      lines: WaterwayRecord[],
      material: THREE.Material,
      name: string,
      renderOrder: number
    ) => {
      const positions: number[] = [];
      const normals: number[] = [];
      const indices: number[] = [];
      let vertOffset = 0;

      for (const way of lines) {
        if (way.points.length < 2) continue;
        // The OSM Illinois River centerline is real geometry. Older prepared bundles
        // stored the generic 28m fallback, so retain a clearly documented 320m
        // inferred display width until source width tags are available on reimport.
        const displayWidth =
          way.name === 'Illinois River' && way.widthMeters < 100 ? 320 : way.widthMeters;
        const halfW = displayWidth * 0.5;
        for (let i = 0; i < way.points.length; i++) {
          const [x, elev, z] = way.points[i];
          const prev = way.points[Math.max(0, i - 1)];
          const next = way.points[Math.min(way.points.length - 1, i + 1)];
          let tx = next[0] - prev[0];
          let tz = next[2] - prev[2];
          const len = Math.hypot(tx, tz) || 1;
          tx /= len;
          tz /= len;
          const px = -tz * halfW;
          const pz = tx * halfW;
          const y = elev - this.datumMeters + 0.15;

          positions.push(x - px, y, z - pz, x + px, y, z + pz);
          normals.push(0, 1, 0, 0, 1, 0);
        }

        for (let i = 0; i < way.points.length - 1; i++) {
          const a = vertOffset + i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, c, b, b, c, d);
        }
        vertOffset += way.points.length * 2;
      }

      if (indices.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geom.setIndex(indices);
        const mesh = new THREE.Mesh(geom, material);
        mesh.name = name;
        mesh.renderOrder = renderOrder;
        this.group.add(mesh);
        this.meshes.push(mesh);
      }
    };

    // Large river centerlines use the same animated, solar-lit water shader as
    // mapped water bodies; streams/canals retain the quieter cartographic material.
    buildRibbon(riverLines, this.waterMaterial, 'RiverWaterwayRibbons', 2);
    buildRibbon(minorLines, this.streamMaterial, 'MinorWaterwayRibbons', 1);
  }

  setVerticalExaggeration(factor: number): void {
    this.group.scale.set(1, factor, 1);
  }

  getMeshCount(): number {
    return this.meshes.length;
  }

  update(
    elapsedSeconds: number,
    astro: AstronomicalState,
    env: EffectiveEnvironmentState,
    sunColor: THREE.Color,
    skyColor: THREE.Color
  ): void {
    const u = this.waterMaterial.uniforms;
    u.uTime.value = elapsedSeconds;
    u.uWindVec.value.set(env.windVector[0], env.windVector[1]);
    u.uWindSpeed.value = env.windSpeedMs;
    u.uSunDir.value.set(astro.solarDirection[0], astro.solarDirection[1], astro.solarDirection[2]);
    u.uSunColor.value.copy(sunColor);
    u.uSkyColor.value.copy(skyColor);
    u.uCloudCover.value = env.cloudCoverTotal;
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.waterMaterial.dispose();
    this.wetlandMaterial.dispose();
    this.streamMaterial.dispose();
  }
}
