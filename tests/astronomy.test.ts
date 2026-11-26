import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EphemerisEngine } from '../src/celestial/Ephemeris';
import { formatRegionalTime, regionalWallClockToUtcMs } from '../src/core/Clock';
import { LightingSystem } from '../src/rendering/Lighting';
import { SunVisual } from '../src/celestial/Sun';
import { createDefaultOverrides } from '../src/state/Overrides';
import { RealityStore } from '../src/state/Reality';

const PEORIA_LAT = 40.72;
const PEORIA_LON = -89.58;
const PEORIA_TZ = 'America/Chicago';

describe('Astronomical Integrity', () => {
  it('computes seasonal solar trajectory differences between summer and winter solstices', () => {
    const eph = new EphemerisEngine(PEORIA_LAT, PEORIA_LON, 155);

    // Solar noon in Peoria (~18:00 UTC in summer CDT / ~17:58 UTC in winter CST)
    const summerNoonUtc = Date.UTC(2026, 5, 21, 17, 58, 0);
    const winterNoonUtc = Date.UTC(2026, 11, 21, 17, 56, 0);

    const summer = eph.compute(summerNoonUtc);
    const winter = eph.compute(winterNoonUtc);

    const summerAltDeg = (summer.solarAltitudeRad * 180) / Math.PI;
    const winterAltDeg = (winter.solarAltitudeRad * 180) / Math.PI;

    // Peoria lat 40.72°: summer max ~72.7°, winter max ~25.8°, difference ~46.9°
    expect(summerAltDeg).toBeGreaterThan(70);
    expect(summerAltDeg).toBeLessThan(75);
    expect(winterAltDeg).toBeGreaterThan(24);
    expect(winterAltDeg).toBeLessThan(28);
    expect(summerAltDeg - winterAltDeg).toBeCloseTo(46.88, 0);
  });

  it('shifts sunrise and sunset azimuths seasonally', () => {
    const eph = new EphemerisEngine(PEORIA_LAT, PEORIA_LON, 155);
    const summer = eph.compute(Date.UTC(2026, 5, 21, 18, 0, 0));
    const winter = eph.compute(Date.UTC(2026, 11, 21, 18, 0, 0));

    expect(summer.sunriseMs).not.toBeNull();
    expect(winter.sunriseMs).not.toBeNull();

    const summerRise = eph.compute(summer.sunriseMs!);
    const winterRise = eph.compute(winter.sunriseMs!);
    const summerRiseAz = ((summerRise.solarAzimuthRad * 180) / Math.PI + 360) % 360;
    const winterRiseAz = ((winterRise.solarAzimuthRad * 180) / Math.PI + 360) % 360;

    // Summer sunrise is north of east (< 90°); winter sunrise is south of east (> 90°)
    expect(summerRiseAz).toBeLessThan(65);
    expect(winterRiseAz).toBeGreaterThan(115);
  });

  it('does not equate civil noon with solar noon and handles DST transitions accurately', () => {
    // 2026-03-08 is US DST spring-forward in America/Chicago; 2026-11-01 is fall-back
    const summerWallMs = regionalWallClockToUtcMs('2026-06-21', '12:00', PEORIA_TZ);
    const winterWallMs = regionalWallClockToUtcMs('2026-12-21', '12:00', PEORIA_TZ);

    const summerParts = formatRegionalTime(summerWallMs, PEORIA_TZ);
    const winterParts = formatRegionalTime(winterWallMs, PEORIA_TZ);
    expect(summerParts.timeZoneName).toBe('CDT');
    expect(winterParts.timeZoneName).toBe('CST');

    // During CDT (UTC-5) at -89.58° (~6° west of 90°W, ~1h offset), solar noon is ~12:58 CDT,
    // so at 12:00 CDT the Sun is still significantly east of due south (azimuth < 165°)
    const eph = new EphemerisEngine(PEORIA_LAT, PEORIA_LON, 155);
    const civilNoonSummer = eph.compute(summerWallMs);
    const azDeg = ((civilNoonSummer.solarAzimuthRad * 180) / Math.PI + 360) % 360;
    expect(azDeg).toBeLessThan(165);
  });

  it('aligns visible Sun and directional sunlight along the same authoritative solarDirection vector', () => {
    const reality = new RealityStore(PEORIA_LAT, PEORIA_LON, 155, Date.UTC(2026, 5, 21, 19, 0, 0));
    const overrides = createDefaultOverrides();
    overrides.astronomy.mode = 'manual';
    overrides.astronomy.manualTimeMs = Date.UTC(2026, 5, 21, 19, 0, 0);

    const astro = reality.computeAstronomicalState(overrides, 0);
    const env = reality.computeEffectiveEnvironment(astro, overrides, 1.0, 0);

    const lighting = new LightingSystem();
    const sunVisual = new SunVisual(18000);
    const focus = new THREE.Vector3(0, 0, 0);
    const camPos = new THREE.Vector3(5000, 4000, 9000);

    lighting.update(astro, env, focus, new THREE.Color(0x6e9bc5));
    sunVisual.update(astro, env, camPos, lighting.sunColor);

    const lightDir = lighting.sunLight.position.clone().sub(focus).normalize();
    const visualDir = sunVisual.group.position.clone().normalize();
    const expectedDir = new THREE.Vector3(...astro.solarDirection).normalize();

    expect(lightDir.distanceTo(expectedDir)).toBeLessThan(1e-5);
    expect(visualDir.distanceTo(expectedDir)).toBeLessThan(1e-5);
  });
});
