/**
 * Authoritative simulation clock.
 * Maintains UTC epoch milliseconds internally while formatting human displays in the region's time zone.
 */

export class SimulationClock {
  private simTimeMs: number;
  private mode: 'live' | 'manual' = 'live';
  private timeScale = 1;
  private paused = false;

  constructor(initialTimeMs: number = Date.now()) {
    this.simTimeMs = initialTimeMs;
  }

  getMode(): 'live' | 'manual' {
    return this.mode;
  }

  isPaused(): boolean {
    return this.paused;
  }

  getTimeScale(): number {
    return this.timeScale;
  }

  getTimestampMs(): number {
    return this.simTimeMs;
  }

  setLiveMode(nowMs: number = Date.now()): void {
    this.mode = 'live';
    this.paused = false;
    this.timeScale = 1;
    this.simTimeMs = nowMs;
  }

  setManualTimestampMs(timestampMs: number): void {
    this.mode = 'manual';
    this.simTimeMs = timestampMs;
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale);
    if (this.timeScale !== 1 && this.mode === 'live') {
      this.mode = 'manual';
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused && this.mode === 'live') {
      this.mode = 'manual';
    }
  }

  /**
   * Advance the clock by an elapsed real-time delta in seconds.
   * Bounded to prevent extreme jumps when resuming from a suspended browser tab.
   */
  tick(realDeltaSeconds: number, realNowMs: number = Date.now()): number {
    const boundedDt = Math.max(0, Math.min(realDeltaSeconds, 2.0));
    if (this.mode === 'live' && !this.paused && this.timeScale === 1) {
      this.simTimeMs = realNowMs;
    } else if (!this.paused) {
      this.simTimeMs += boundedDt * 1000 * this.timeScale;
    }
    return this.simTimeMs;
  }
}

export interface RegionalTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZoneName: string;
  formattedDate: string;
  formattedTime: string;
  formattedDateTime: string;
  localInputDate: string;
  localInputTime: string;
}

/**
 * Format a UTC epoch timestamp in the region's IANA time zone (handling DST automatically).
 */
export function formatRegionalTime(timestampMs: number, timeZone: string): RegionalTimeParts {
  const date = new Date(timestampMs);
  const partsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });

  const parts = partsFormatter.formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';

  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const rawHour = Number(get('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(get('minute'));
  const second = Number(get('second'));
  const tzName = get('timeZoneName');

  const pad = (n: number) => String(n).padStart(2, '0');
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

  const formattedTime = `${pad(hour)}:${pad(minute)}:${pad(second)} ${tzName}`;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    timeZoneName: tzName,
    formattedDate,
    formattedTime,
    formattedDateTime: `${formattedDate} · ${formattedTime}`,
    localInputDate: `${year}-${pad(month)}-${pad(day)}`,
    localInputTime: `${pad(hour)}:${pad(minute)}`,
  };
}

/**
 * Convert a regional wall-clock YYYY-MM-DD and HH:MM string into UTC epoch milliseconds,
 * properly respecting DST transitions in the given IANA timezone.
 */
export function regionalWallClockToUtcMs(
  dateStr: string,
  timeStr: string,
  timeZone: string
): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return Date.now();
  }
  const safeH = Number.isFinite(hh) ? hh : 12;
  const safeM = Number.isFinite(mm) ? mm : 0;

  // Iterative fixed-point offset solver (converges in 2 steps across DST boundaries)
  let guessUtc = Date.UTC(y, m - 1, d, safeH, safeM, 0);
  for (let i = 0; i < 3; i++) {
    const p = formatRegionalTime(guessUtc, timeZone);
    const renderedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    const desiredAsUtc = Date.UTC(y, m - 1, d, safeH, safeM, 0);
    const diff = desiredAsUtc - renderedAsUtc;
    guessUtc += diff;
    if (Math.abs(diff) < 1000) break;
  }
  return guessUtc;
}
