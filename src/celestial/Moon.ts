/**
 * Visible Moon positioned at compressed celestial radius along the calculated lunar direction,
 * shaded according to the solar-lunar phase geometry.
 */

import * as THREE from 'three';
import type { AstronomicalState, EffectiveEnvironmentState } from '../core/types';

export class MoonVisual {
  readonly mesh: THREE.Mesh;
  private readonly radiusMeters: number;
  private readonly material: THREE.ShaderMaterial;

  constructor(celestialRadiusMeters: number) {
    this.radiusMeters = celestialRadiusMeters;
    const geom = new THREE.SphereGeometry(celestialRadiusMeters * 0.019, 24, 18);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uOpacity: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldNormal;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform float uOpacity;
        varying vec3 vWorldNormal;
        void main() {
          float ndl = dot(normalize(vWorldNormal), normalize(uSunDir));
          float lit = smoothstep(-0.08, 0.14, ndl);
          vec3 moonAlbedo = vec3(0.86, 0.89, 0.94);
          vec3 earthshine = vec3(0.08, 0.10, 0.14);
          vec3 color = mix(earthshine, moonAlbedo, lit);
          gl_FragColor = vec4(color, uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.name = 'MoonVisual';
  }

  update(astro: AstronomicalState, env: EffectiveEnvironmentState): void {
    const [dx, dy, dz] = astro.lunarDirection;
    this.mesh.position.set(
      dx * this.radiusMeters,
      dy * this.radiusMeters,
      dz * this.radiusMeters
    );

    const elevDeg = (astro.lunarAltitudeRad * 180) / Math.PI;
    const horizonFade = Math.max(0, Math.min(1, (elevDeg + 1.5) / 4.0));
    const dayBlend = astro.isDaylight ? 0.52 : 0.96;
    const cloudAtten = 1 - 0.82 * env.cloudCoverTotal;
    const opacity = horizonFade * dayBlend * (0.2 + 0.8 * cloudAtten);

    this.mesh.visible = opacity > 0.02;
    this.material.uniforms.uSunDir.value.set(
      astro.solarDirection[0],
      astro.solarDirection[1],
      astro.solarDirection[2]
    );
    this.material.uniforms.uOpacity.value = opacity;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
