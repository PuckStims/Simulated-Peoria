/**
 * Meteorological wind conversion.
 *
 * Meteorological wind direction indicates where wind ORIGINATES (degrees CW from True North).
 * Travel vector in Three.js local coordinates (+X East, +Z South):
 *   From North (0°)   -> blows South (+Z): (0, +1)
 *   From East (90°)   -> blows West  (-X): (-1, 0)
 *   From South (180°) -> blows North (-Z): (0, -1)
 *   From West (270°)  -> blows East  (+X): (+1, 0)
 */

const DEG_TO_RAD = Math.PI / 180;

export function windFromDegToTravelUnit(windFromDeg: number): [number, number] {
  const rad = windFromDeg * DEG_TO_RAD;
  return [-Math.sin(rad), Math.cos(rad)];
}

export function windFromDegToVelocity(windFromDeg: number, speedMs: number): [number, number] {
  const [ux, uz] = windFromDegToTravelUnit(windFromDeg);
  return [ux * speedMs, uz * speedMs];
}

export function formatCompassBearing(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const norm = ((deg % 360) + 360) % 360;
  const idx = Math.round(norm / 22.5) % 16;
  return dirs[idx];
}
