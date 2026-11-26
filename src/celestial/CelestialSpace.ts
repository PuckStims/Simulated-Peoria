/**
 * Finite celestial and atmospheric space belonging to the diorama (Section 9.5 & 9.6).
 *
 * Renders:
 *   1. Soft atmospheric horizon & zenith gradient dome (distinct from the outer app backdrop).
 *   2. Geographically oriented procedural night sky (tilted by observer latitude and rotated by GMST;
 *      explicitly non-catalog stars, see Section 9.5).
 */

import * as THREE from 'three';
import type { AstronomicalState, EffectiveEnvironmentState } from '../core/types';
import { EphemerisEngine } from './Ephemeris';

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vLocalDir;
  void main() {
    vLocalDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform float uOvercast;
  uniform float uOpacity;
  varying vec3 vLocalDir;

  void main() {
    vec3 dir = normalize(vLocalDir);
    float y = max(0.0, dir.y);
    float horizonT = pow(1.0 - y, 2.2);
    vec3 sky = mix(uZenithColor, uHorizonColor, horizonT);

    // Subtle Rayleigh/Mie forward glow toward the Sun
    float sunDot = max(0.0, dot(dir, normalize(uSunDir)));
    float sunVis = smoothstep(-0.14, 0.25, uSunDir.y);
    vec3 scatterCol = mix(vec3(0.95, 0.45, 0.20), vec3(1.0, 0.94, 0.80), smoothstep(0.0, 0.35, uSunDir.y));
    sky += scatterCol * pow(sunDot, 7.0) * 0.32 * sunVis * (1.0 - 0.7 * uOvercast);

    // Soft boundary fade at horizon skirt
    float edgeFade = smoothstep(-0.04, 0.08, dir.y);
    gl_FragColor = vec4(sky, edgeFade * uOpacity);
  }
`;

export class CelestialSpace {
  readonly group = new THREE.Group();
  readonly skyDome: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly starField: THREE.Points;
  private readonly starMat: THREE.PointsMaterial;
  private readonly latitudeRad: number;
  private readonly longitudeRad: number;
  private readonly currentSkyColor = new THREE.Color(0x6e9bc5);

  constructor(celestialRadiusMeters: number, latitudeDeg: number, longitudeDeg: number) {
    this.group.name = 'CelestialSpace';
    this.latitudeRad = (latitudeDeg * Math.PI) / 180;
    this.longitudeRad = (longitudeDeg * Math.PI) / 180;

    // Hemisphere sky with slight below-horizon skirt for soft diorama edge
    const domeGeom = new THREE.SphereGeometry(
      celestialRadiusMeters * 1.04,
      40,
      24,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.54
    );
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uZenithColor: { value: new THREE.Color(0x285a8f) },
        uHorizonColor: { value: new THREE.Color(0x9bc0de) },
        uOvercast: { value: 0.2 },
        uOpacity: { value: 0.72 },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    this.skyDome = new THREE.Mesh(domeGeom, this.skyMat);
    this.group.add(this.skyDome);

    // Procedurally distributed celestial sphere stars oriented by local sidereal time and latitude
    const starCount = 950;
    const starPos = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    let seed = 42197;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const r = celestialRadiusMeters * 1.01;
    for (let i = 0; i < starCount; i++) {
      const u = rand();
      const v = rand();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const tint = 0.75 + 0.25 * rand();
      starColors[i * 3] = tint;
      starColors[i * 3 + 1] = tint * (0.94 + 0.06 * rand());
      starColors[i * 3 + 2] = Math.min(1, tint * (0.95 + 0.12 * rand()));
    }

    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    this.starMat = new THREE.PointsMaterial({
      size: celestialRadiusMeters * 0.0045,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });
    this.starField = new THREE.Points(starGeom, this.starMat);
    this.group.add(this.starField);
  }

  getHorizonSkyColor(): THREE.Color {
    return this.currentSkyColor;
  }

  update(astro: AstronomicalState, env: EffectiveEnvironmentState): void {
    const sunElev = astro.solarAltitudeRad;
    const dayT = Math.max(0, Math.min(1, (sunElev + 0.05) / 0.35));
    const twilightT = Math.max(0, 1 - Math.abs(sunElev + 0.03) / 0.18);

    const dayZenith = new THREE.Color(0x30639c);
    const dayHorizon = new THREE.Color(0x9fc2de);
    const duskZenith = new THREE.Color(0x283558);
    const duskHorizon = new THREE.Color(0xd9875b);
    const nightZenith = new THREE.Color(0x090f1c);
    const nightHorizon = new THREE.Color(0x18253b);

    const zenith = nightZenith.clone().lerp(dayZenith, dayT).lerp(duskZenith, twilightT * 0.55);
    const horizon = nightHorizon.clone().lerp(dayHorizon, dayT).lerp(duskHorizon, twilightT * 0.65);

    const overcastGray = new THREE.Color(0x6d7782).multiplyScalar(0.25 + 0.75 * dayT);
    zenith.lerp(overcastGray, env.cloudCoverTotal * 0.68);
    horizon.lerp(overcastGray, env.cloudCoverTotal * 0.72);

    this.currentSkyColor.copy(horizon);
    this.skyMat.uniforms.uZenithColor.value.copy(zenith);
    this.skyMat.uniforms.uHorizonColor.value.copy(horizon);
    this.skyMat.uniforms.uOvercast.value = env.cloudCoverTotal;
    this.skyMat.uniforms.uSunDir.value.set(
      astro.solarDirection[0],
      astro.solarDirection[1],
      astro.solarDirection[2]
    );
    // Slightly softer sky envelope during daytime so the diorama remains framed against outer studio backdrop
    this.skyMat.uniforms.uOpacity.value = 0.52 + 0.25 * (1 - dayT);

    // Orient star dome by observer latitude (celestial pole tilted at latitude above north -Z)
    // and Local Sidereal Time (GMST + observer longitude)
    const gmst = EphemerisEngine.siderealAngleRad(astro.timestampMs);
    const lst = gmst + this.longitudeRad;
    this.starField.rotation.set(0, 0, 0);
    this.starField.rotateX(-(Math.PI / 2 - this.latitudeRad));
    this.starField.rotateY(-lst);

    const nightT = Math.max(0, Math.min(1, (-sunElev - 0.04) / 0.16));
    this.starMat.opacity = nightT * (1 - 0.9 * env.cloudCoverTotal) * 0.85;
    this.starField.visible = this.starMat.opacity > 0.02;
  }

  dispose(): void {
    this.skyDome.geometry.dispose();
    this.skyMat.dispose();
    this.starField.geometry.dispose();
    this.starMat.dispose();
  }
}
