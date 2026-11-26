/**
 * Visible solar body and atmospheric halo positioned at the diorama's compressed celestial radius
 * along the single authoritative solarDirection vector (Section 9.3 & 9.4).
 */

import * as THREE from 'three';
import type { AstronomicalState, EffectiveEnvironmentState } from '../core/types';

export class SunVisual {
  readonly group = new THREE.Group();
  readonly disc: THREE.Mesh;
  readonly halo: THREE.Mesh;
  private readonly radiusMeters: number;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.ShaderMaterial;

  constructor(celestialRadiusMeters: number) {
    this.group.name = 'SunVisual';
    this.radiusMeters = celestialRadiusMeters;

    const discGeom = new THREE.SphereGeometry(celestialRadiusMeters * 0.026, 24, 18);
    this.discMat = new THREE.MeshBasicMaterial({
      color: 0xfff4d6,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
    });
    this.disc = new THREE.Mesh(discGeom, this.discMat);

    const haloGeom = new THREE.PlaneGeometry(celestialRadiusMeters * 0.24, celestialRadiusMeters * 0.24);
    this.haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffdfa3) },
        uOpacity: { value: 0.75 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float glow = exp(-r * 3.4) * smoothstep(1.0, 0.12, r);
          gl_FragColor = vec4(uColor, glow * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.halo = new THREE.Mesh(haloGeom, this.haloMat);

    this.group.add(this.disc, this.halo);
  }

  update(
    astro: AstronomicalState,
    env: EffectiveEnvironmentState,
    cameraWorldPos: THREE.Vector3,
    sunColor: THREE.Color
  ): void {
    const [dx, dy, dz] = astro.solarDirection;
    this.group.position.set(
      dx * this.radiusMeters,
      dy * this.radiusMeters,
      dz * this.radiusMeters
    );

    // Hide below horizon/substrate so the Sun never glows beneath the diorama plinth
    const elevDeg = (astro.solarAltitudeRad * 180) / Math.PI;
    const horizonFade = Math.max(0, Math.min(1, (elevDeg + 2.5) / 5.0));
    const cloudAtten = 1 - 0.72 * env.cloudCoverTotal;
    const visibility = horizonFade * (0.25 + 0.75 * cloudAtten);

    this.group.visible = visibility > 0.01;
    if (!this.group.visible) return;

    this.discMat.color.copy(sunColor);
    this.discMat.opacity = Math.min(1, visibility * 1.15);
    this.haloMat.uniforms.uColor.value.copy(sunColor);
    this.haloMat.uniforms.uOpacity.value = visibility * 0.65;
    this.halo.lookAt(cameraWorldPos);
  }

  dispose(): void {
    this.disc.geometry.dispose();
    this.discMat.dispose();
    this.halo.geometry.dispose();
    this.haloMat.dispose();
  }
}
