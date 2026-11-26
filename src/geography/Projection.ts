/**
 * Local meter-based coordinate projection matching tools/geo/projection.py.
 *
 * Three.js local axes:
 *   +X = True East (meters)
 *   -X = True West (meters)
 *   +Y = Elevation above vertical datum (meters)
 *   +Z = True South (meters)
 *   -Z = True North (meters)
 */

import proj4, { type Converter } from 'proj4';
import type { RegionConfig } from '../core/types';

export class GeoProjection {
  private readonly converter: Converter;
  private readonly originEasting: number;
  private readonly originNorthing: number;
  private readonly elevationDatumMeters: number;
  private readonly alignTrueNorth: boolean;
  private readonly cosTheta: number;
  private readonly sinTheta: number;
  readonly verticalScale: number;
  readonly horizontalScale: number;

  constructor(config: RegionConfig) {
    const cs = config.coordinateSystem;
    const crsName = cs.projectedCrs;
    if (!proj4.defs(crsName)) {
      proj4.defs(crsName, cs.proj4);
    }
    this.converter = proj4('EPSG:4326', crsName);
    this.originEasting = cs.origin.easting;
    this.originNorthing = cs.origin.northing;
    this.elevationDatumMeters = cs.origin.elevationDatumMeters;
    this.alignTrueNorth = cs.alignTrueNorthToNegativeZ;
    this.horizontalScale = cs.horizontalScale;
    this.verticalScale = cs.verticalScale;

    const theta = (cs.meridianConvergenceDeg * Math.PI) / 180;
    this.cosTheta = Math.cos(theta);
    this.sinTheta = Math.sin(theta);
  }

  lonLatToProjected(lon: number, lat: number): [number, number] {
    const [easting, northing] = this.converter.forward([lon, lat]);
    return [easting, northing];
  }

  projectedToLonLat(easting: number, northing: number): [number, number] {
    const [lon, lat] = this.converter.inverse([easting, northing]);
    return [lon, lat];
  }

  projectedToLocal(easting: number, northing: number): [number, number] {
    const dxGrid = easting - this.originEasting;
    const dyGrid = northing - this.originNorthing;
    if (!this.alignTrueNorth) {
      return [dxGrid * this.horizontalScale, -dyGrid * this.horizontalScale];
    }
    const xEast = dxGrid * this.cosTheta - dyGrid * this.sinTheta;
    const yNorth = dxGrid * this.sinTheta + dyGrid * this.cosTheta;
    return [xEast * this.horizontalScale, -yNorth * this.horizontalScale];
  }

  localToProjected(xEast: number, zSouth: number): [number, number] {
    const sx = xEast / this.horizontalScale;
    const sz = zSouth / this.horizontalScale;
    const yNorth = -sz;
    if (!this.alignTrueNorth) {
      return [this.originEasting + sx, this.originNorthing + yNorth];
    }
    const dxGrid = sx * this.cosTheta + yNorth * this.sinTheta;
    const dyGrid = -sx * this.sinTheta + yNorth * this.cosTheta;
    return [this.originEasting + dxGrid, this.originNorthing + dyGrid];
  }

  lonLatToLocal(lon: number, lat: number): [number, number] {
    const [e, n] = this.lonLatToProjected(lon, lat);
    return this.projectedToLocal(e, n);
  }

  localToLonLat(xEast: number, zSouth: number): [number, number] {
    const [e, n] = this.localToProjected(xEast, zSouth);
    return this.projectedToLonLat(e, n);
  }

  elevationToY(elevationMeters: number, exaggeration = 1.0): number {
    return (elevationMeters - this.elevationDatumMeters) * this.verticalScale * exaggeration;
  }

  yToElevation(yMeters: number, exaggeration = 1.0): number {
    return yMeters / (this.verticalScale * exaggeration) + this.elevationDatumMeters;
  }
}
