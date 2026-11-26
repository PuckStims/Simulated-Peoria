/**
 * WebGLRenderer lifecycle with quality presets, adaptive pixel ratio, and clean disposal.
 */

import * as THREE from 'three';
import type { GraphicsQuality } from '../core/types';

export class MicrocosmRenderer {
  readonly webgl: THREE.WebGLRenderer;
  private quality: GraphicsQuality = 'balanced';

  constructor(canvas: HTMLCanvasElement) {
    this.webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.05;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.setQuality('balanced');
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    const dprCap = quality === 'high' ? 2.0 : quality === 'balanced' ? 1.5 : 1.0;
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.webgl.shadowMap.enabled = quality !== 'low';
  }

  getQuality(): GraphicsQuality {
    return this.quality;
  }

  resize(width: number, height: number): void {
    this.webgl.setSize(width, height, false);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.webgl.render(scene, camera);
  }

  getDiagnostics(): {
    drawCalls: number;
    triangles: number;
    points: number;
    lines: number;
    geometries: number;
    textures: number;
  } {
    const { render, memory } = this.webgl.info;
    return {
      drawCalls: render.calls,
      triangles: render.triangles,
      points: render.points,
      lines: render.lines,
      geometries: memory.geometries,
      textures: memory.textures,
    };
  }

  dispose(): void {
    this.webgl.dispose();
  }
}
