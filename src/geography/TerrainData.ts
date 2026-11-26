/**
 * Decoded digital elevation grid and bilinear surface queries.
 * Works identically in browser and Node/Vitest environments.
 */

import type { RegionConfig, TerrainLevelConfig } from '../core/types';

export class TerrainData {
  readonly config: RegionConfig;
  readonly level: TerrainLevelConfig;
  readonly elevations: Float32Array;
  readonly cols: number;
  readonly rows: number;
  readonly widthMeters: number;
  readonly depthMeters: number;
  readonly datumMeters: number;

  constructor(config: RegionConfig, level: TerrainLevelConfig, buffer: ArrayBuffer) {
    this.config = config;
    this.level = level;
    this.cols = level.cols;
    this.rows = level.rows;
    this.widthMeters = config.coordinateSystem.extentMeters.width;
    this.depthMeters = config.coordinateSystem.extentMeters.depth;
    this.datumMeters = config.coordinateSystem.origin.elevationDatumMeters;

    const total = this.cols * this.rows;
    this.elevations = new Float32Array(total);

    if (level.encoding === 'float32') {
      if (buffer.byteLength < total * Float32Array.BYTES_PER_ELEMENT) {
        throw new Error(
          `Terrain buffer is truncated: expected at least ${total * Float32Array.BYTES_PER_ELEMENT} bytes for ${level.id}, received ${buffer.byteLength}.`
        );
      }
      const src = new Float32Array(buffer);
      this.elevations.set(src.subarray(0, total));
    } else {
      if (buffer.byteLength < total * Uint16Array.BYTES_PER_ELEMENT) {
        throw new Error(
          `Terrain buffer is truncated: expected at least ${total * Uint16Array.BYTES_PER_ELEMENT} bytes for ${level.id}, received ${buffer.byteLength}.`
        );
      }
      const view = new DataView(buffer);
      const minE = level.minElevationMeters;
      const span = Math.max(0.01, level.maxElevationMeters - minE);
      for (let i = 0; i < total; i++) {
        const q = view.getUint16(i * 2, true);
        this.elevations[i] = minE + (q / 65535) * span;
      }
    }
  }

  /**
   * Sample real elevation (meters above datum) at local coordinates (xEast, zSouth).
   */
  sampleElevationAt(xEast: number, zSouth: number): number {
    const u = ((xEast + this.widthMeters * 0.5) / this.widthMeters) * (this.cols - 1);
    const v = ((zSouth + this.depthMeters * 0.5) / this.depthMeters) * (this.rows - 1);
    const uc = Math.max(0, Math.min(this.cols - 1.00001, u));
    const vc = Math.max(0, Math.min(this.rows - 1.00001, v));
    const c0 = Math.floor(uc);
    const r0 = Math.floor(vc);
    const c1 = Math.min(this.cols - 1, c0 + 1);
    const r1 = Math.min(this.rows - 1, r0 + 1);
    const fu = uc - c0;
    const fv = vc - r0;

    const h00 = this.elevations[r0 * this.cols + c0];
    const h10 = this.elevations[r0 * this.cols + c1];
    const h01 = this.elevations[r1 * this.cols + c0];
    const h11 = this.elevations[r1 * this.cols + c1];

    return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv;
  }

  /**
   * Sample Three.js local Y coordinate (meters relative to elevationDatumMeters).
   */
  sampleYAt(xEast: number, zSouth: number, verticalExaggeration = 1.0): number {
    const elev = this.sampleElevationAt(xEast, zSouth);
    return (elev - this.datumMeters) * this.config.coordinateSystem.verticalScale * verticalExaggeration;
  }

  /**
   * Sample unit surface normal at local (xEast, zSouth).
   */
  sampleNormalAt(xEast: number, zSouth: number, verticalExaggeration = 1.0): [number, number, number] {
    const eps = Math.max(10, this.level.spacingMeters * 0.6);
    const hL = this.sampleYAt(xEast - eps, zSouth, verticalExaggeration);
    const hR = this.sampleYAt(xEast + eps, zSouth, verticalExaggeration);
    const hN = this.sampleYAt(xEast, zSouth - eps, verticalExaggeration);
    const hS = this.sampleYAt(xEast, zSouth + eps, verticalExaggeration);

    const dx = (hR - hL) / (2 * eps);
    const dz = (hS - hN) / (2 * eps);
    const nx = -dx;
    const ny = 1;
    const nz = -dz;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }
}
