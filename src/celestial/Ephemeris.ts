/**
 * Astronomical calculations powered by astronomy-engine.
 *
 * Uses UTC timestamps internally and outputs local Three.js unit vectors
 * aligned with:
 *   +X = East, +Y = Up, +Z = South, -Z = North
 */

import * as Astronomy from 'astronomy-engine';
import type { AstronomicalState } from '../core/types';

const DEG_TO_RAD = Math.PI / 180;

/**
 * Convert north-referenced clockwise azimuth A (rad) and altitude H (rad)
 * into the authoritative Three.js direction vector (Spec 9.3).
 */
export function horizontalToDirection(azimuthRad: number, altitudeRad: number): [number, number, number] {
  const cosH = Math.cos(altitudeRad);
  return [
    cosH * Math.sin(azimuthRad),
    Math.sin(altitudeRad),
    -cosH * Math.cos(azimuthRad),
  ];
}

export class EphemerisEngine {
  private readonly observer: Astronomy.Observer;
  private cachedDayKey = '';
  private cachedSunTimes: {
    sunriseMs: number | null;
    sunsetMs: number | null;
    civilDawnMs: number | null;
    civilDuskMs: number | null;
  } = { sunriseMs: null, sunsetMs: null, civilDawnMs: null, civilDuskMs: null };

  constructor(
    latitude: number,
    longitude: number,
    elevationMeters = 0
  ) {
    this.observer = new Astronomy.Observer(latitude, longitude, elevationMeters);
  }

  compute(timestampMs: number): AstronomicalState {
    const date = new Date(timestampMs);

    const sunEq = Astronomy.Equator(Astronomy.Body.Sun, date, this.observer, true, true);
    const sunHor = Astronomy.Horizon(date, this.observer, sunEq.ra, sunEq.dec, 'normal');

    const moonEq = Astronomy.Equator(Astronomy.Body.Moon, date, this.observer, true, true);
    const moonHor = Astronomy.Horizon(date, this.observer, moonEq.ra, moonEq.dec, 'normal');

    const solarAltRad = sunHor.altitude * DEG_TO_RAD;
    const solarAzRad = sunHor.azimuth * DEG_TO_RAD;
    const lunarAltRad = moonHor.altitude * DEG_TO_RAD;
    const lunarAzRad = moonHor.azimuth * DEG_TO_RAD;

    const phaseDeg = Astronomy.MoonPhase(date);
    const moonIllum = Astronomy.Illumination(Astronomy.Body.Moon, date);

    // Cache daily rise/set/twilight searches (keyed by UTC date + rough solar day around observer)
    const dayKey = `${Math.floor(timestampMs / 86400000)}-${this.observer.latitude.toFixed(2)}`;
    if (dayKey !== this.cachedDayKey) {
      this.cachedDayKey = dayKey;
      const startOfDay = new Date(Math.floor(timestampMs / 86400000) * 86400000);
      const sunrise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, this.observer, +1, startOfDay, 1.5);
      const sunset = Astronomy.SearchRiseSet(Astronomy.Body.Sun, this.observer, -1, startOfDay, 1.5);
      const civilDawn = Astronomy.SearchAltitude(Astronomy.Body.Sun, this.observer, +1, startOfDay, 1.5, -6);
      const civilDusk = Astronomy.SearchAltitude(Astronomy.Body.Sun, this.observer, -1, startOfDay, 1.5, -6);

      this.cachedSunTimes = {
        sunriseMs: sunrise ? sunrise.date.getTime() : null,
        sunsetMs: sunset ? sunset.date.getTime() : null,
        civilDawnMs: civilDawn ? civilDawn.date.getTime() : null,
        civilDuskMs: civilDusk ? civilDusk.date.getTime() : null,
      };
    }

    const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((timestampMs - startOfYear) / 86400000) + 1;

    return {
      timestampMs,
      solarAltitudeRad: solarAltRad,
      solarAzimuthRad: solarAzRad,
      solarDirection: horizontalToDirection(solarAzRad, solarAltRad),
      lunarAltitudeRad: lunarAltRad,
      lunarAzimuthRad: lunarAzRad,
      lunarDirection: horizontalToDirection(lunarAzRad, lunarAltRad),
      lunarPhaseFraction: phaseDeg / 360,
      lunarIllumination: moonIllum.phase_fraction,
      sunriseMs: this.cachedSunTimes.sunriseMs,
      sunsetMs: this.cachedSunTimes.sunsetMs,
      civilDawnMs: this.cachedSunTimes.civilDawnMs,
      civilDuskMs: this.cachedSunTimes.civilDuskMs,
      isDaylight: sunHor.altitude > -0.833,
      isTwilight: sunHor.altitude <= -0.833 && sunHor.altitude >= -6.0,
      dayOfYear,
    };
  }

  /**
   * Greenwich Mean Sidereal Time in radians for orienting the celestial sphere.
   */
  static siderealAngleRad(timestampMs: number): number {
    const time = Astronomy.MakeTime(new Date(timestampMs));
    return (Astronomy.SiderealTime(time) * 15) * DEG_TO_RAD;
  }
}
