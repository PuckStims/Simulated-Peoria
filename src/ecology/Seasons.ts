/**
 * Regional seasonal phenology model for central Illinois (humid continental climate).
 * Computes smooth foliage greenness, autumn color transition, and leaf retention
 * from simulated day-of-year and regional temperature history.
 */

export interface SeasonalPhenology {
  /** Normalized year progress [0, 1). */
  seasonProgress: number;
  /** Leaf canopy retention [0.08, 1.0]. */
  leafRetention: number;
  /** Chlorophyll lushness [0, 1]. */
  greenness: number;
  /** Autumn gold/amber/russet factor [0, 1]. */
  autumnFactor: number;
  /** Grass greenness [0.15, 1.0]. */
  grassGreenness: number;
  /** Agricultural crop fullness [0, 1]. */
  cropFactor: number;
  label: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Compute seasonal phenology from dayOfYear (1..366) or manual seasonProgress [0, 1).
 */
export function computeSeasonalPhenology(
  dayOfYear: number,
  overrideProgress: number | null = null,
  temperatureC = 14
): SeasonalPhenology {
  const progress =
    overrideProgress !== null
      ? ((overrideProgress % 1) + 1) % 1
      : clamp01((dayOfYear - 1) / 365.25);
  const doy = progress * 365.25;

  // Illinois phenology milestones:
  // Budbreak: ~DOY 95..130 (April - early May)
  // Full summer canopy: DOY 135..265 (mid-May - late Sept)
  // Autumn peak: DOY 285..305 (mid-late October)
  // Leaf drop complete: ~DOY 325 (late November)
  const springFlush = smoothstep(90, 132, doy);
  const leafDrop = smoothstep(285, 326, doy);
  const coldMod = overrideProgress === null && temperatureC < 2 && doy < 120 ? 0.85 : 1.0;

  const leafRetention = clamp01(0.08 + 0.92 * springFlush * (1 - leafDrop) * coldMod);

  const autumnRise = smoothstep(255, 290, doy);
  const autumnFade = 1 - smoothstep(308, 334, doy);
  const autumnFactor = clamp01(autumnRise * autumnFade);

  const greenness = clamp01(springFlush * (1 - smoothstep(255, 305, doy)));
  const grassGreenness = clamp01(0.18 + 0.82 * smoothstep(75, 125, doy) * (1 - 0.72 * smoothstep(280, 335, doy)));
  const cropFactor = clamp01(smoothstep(125, 175, doy) * (1 - smoothstep(250, 295, doy)));

  let label = 'Winter';
  if (doy >= 75 && doy < 145) label = 'Spring';
  else if (doy >= 145 && doy < 255) label = 'Summer';
  else if (doy >= 255 && doy < 328) label = 'Autumn';

  return {
    seasonProgress: progress,
    leafRetention,
    greenness,
    autumnFactor,
    grassGreenness,
    cropFactor,
    label,
  };
}
