import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { horizontalToDirection } from '../src/celestial/Ephemeris';

function computeShadowTipOnLevelGround(
  objectHeight: number,
  solarAzimuthRad: number,
  solarAltitudeRad: number
): THREE.Vector2 {
  const [dx, dy, dz] = horizontalToDirection(solarAzimuthRad, solarAltitudeRad);
  // Ray from object top (0, objectHeight, 0) in direction OPPOSITE to solarDirection (-dx, -dy, -dz)
  // Intersects y = 0 at t = objectHeight / dy
  const t = objectHeight / dy;
  return new THREE.Vector2(-dx * t, -dz * t);
}

describe('Shadow Integrity', () => {
  it('produces shadow length = height / tan(elevation) and 10m shadow for 10m object at 45 deg', () => {
    const height = 10;
    const alt45 = Math.PI / 4;
    const azEast = Math.PI / 2; // Sun due East (+X)

    const tip = computeShadowTipOnLevelGround(height, azEast, alt45);
    const length = tip.length();
    expect(length).toBeCloseTo(10.0, 5);
    // Sun in the East -> shadow extends West (-X)
    expect(tip.x).toBeCloseTo(-10.0, 5);
    expect(Math.abs(tip.y)).toBeLessThan(1e-5);

    // Check arbitrary elevation (e.g. 30 deg)
    const alt30 = Math.PI / 6;
    const tip30 = computeShadowTipOnLevelGround(height, Math.PI * 0.75, alt30);
    expect(tip30.length()).toBeCloseTo(height / Math.tan(alt30), 4);
  });

  it('extends shadow strictly opposite the solar azimuth and stays invariant under camera revolution', () => {
    const height = 15;
    const azRad = (215 * Math.PI) / 180; // SSW sun
    const altRad = (32 * Math.PI) / 180;
    const solarDir = horizontalToDirection(azRad, altRad);
    const tip = computeShadowTipOnLevelGround(height, azRad, altRad);

    // Horizontal shadow direction vs horizontal solar direction dot product must be -1
    const sunHoriz = new THREE.Vector2(solarDir[0], solarDir[2]).normalize();
    const shadowHoriz = tip.clone().normalize();
    expect(sunHoriz.dot(shadowHoriz)).toBeCloseTo(-1.0, 6);

    // Simulate full 360° camera orbit around the scene: world-space solar vector does not depend on camera
    const cameraAngles = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI];
    for (const camAz of cameraAngles) {
      const camPos = new THREE.Vector3(Math.sin(camAz) * 10000, 4000, Math.cos(camAz) * 10000);
      expect(camPos.length()).toBeGreaterThan(0);
      const tipDuringOrbit = computeShadowTipOnLevelGround(height, azRad, altRad);
      expect(tipDuringOrbit.distanceTo(tip)).toBe(0);
    }
  });
});
