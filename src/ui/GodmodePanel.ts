/**
 * Collapsible Environmental Godmode drawer (Section 16).
 * Exposes 6 independent Live/Manual synchronization channels, time progression,
 * vertical exaggeration visualization option, and scenario save/load.
 */

import type { PrecipitationType, SyncChannelName } from '../core/types';
import { formatRegionalTime, regionalWallClockToUtcMs } from '../core/Clock';
import type { MicrocosmWorld, WorldSnapshot } from '../core/World';
import { formatCompassBearing } from '../atmosphere/Wind';
import { computeSeasonalPhenology } from '../ecology/Seasons';

export class GodmodePanel {
  readonly root: HTMLElement;
  private readonly world: MicrocosmWorld;
  private isOpen = false;
  private isDraggingInput = false;

  // Input references
  private dateInput!: HTMLInputElement;
  private timeInput!: HTMLInputElement;
  private speedSelect!: HTMLSelectElement;
  private astroPauseBtn!: HTMLButtonElement;
  private cloudRange!: HTMLInputElement;
  private cloudVal!: HTMLSpanElement;
  private precipSelect!: HTMLSelectElement;
  private precipRange!: HTMLInputElement;
  private precipVal!: HTMLSpanElement;
  private fogRange!: HTMLInputElement;
  private fogVal!: HTMLSpanElement;
  private windSpeedRange!: HTMLInputElement;
  private windSpeedVal!: HTMLSpanElement;
  private windDirRange!: HTMLInputElement;
  private windDirVal!: HTMLSpanElement;
  private tempRange!: HTMLInputElement;
  private tempVal!: HTMLSpanElement;
  private seasonRange!: HTMLInputElement;
  private seasonVal!: HTMLSpanElement;
  private snowRange!: HTMLInputElement;
  private snowVal!: HTMLSpanElement;
  private wetRange!: HTMLInputElement;
  private wetVal!: HTMLSpanElement;
  private exagRange!: HTMLInputElement;
  private exagVal!: HTMLSpanElement;
  private scenarioNameInput!: HTMLInputElement;
  private scenarioListEl!: HTMLDivElement;
  private astroReadout!: HTMLDivElement;
  private modeButtons = new Map<SyncChannelName, HTMLButtonElement>();

  constructor(world: MicrocosmWorld) {
    this.world = world;
    this.root = document.createElement('aside');
    this.root.className = 'glass-card godmode-drawer';
    this.root.innerHTML = this.template();
    this.bindElements();
    this.renderScenarios();
  }

  private template(): string {
    return `
      <div class="drawer-header">
        <span class="drawer-title">Environmental Godmode</span>
        <div style="display:flex;gap:6px;">
          <button class="mini-btn" data-action="restore-all" title="Resynchronize all channels to reality">Sync All</button>
          <button class="mini-btn" data-action="close">✕</button>
        </div>
      </div>
      <div class="drawer-body">
        <div class="channel-card">
          <div class="channel-head">
            <span class="channel-name">1 · Astronomical Clock</span>
            <button class="channel-mode-btn live" data-channel="astronomy">LIVE</button>
          </div>
          <div class="control-row">
            <label>Date</label>
            <input type="date" data-field="date" />
            <input type="time" data-field="time" />
          </div>
          <div class="control-row">
            <label>Rate</label>
            <select data-field="speed">
              <option value="1">1× Real</option>
              <option value="60">60× (1m/s)</option>
              <option value="600">600× (10m/s)</option>
              <option value="3600">3600× (1h/s)</option>
              <option value="14400">14400× (4h/s)</option>
            </select>
            <button class="mini-btn" data-action="pause-clock">Pause</button>
          </div>
          <div class="control-row" style="color:var(--text-muted);font-size:10.5px;" data-field="astro-readout"></div>
        </div>

        <div class="channel-card">
          <div class="channel-head">
            <span class="channel-name">2 · Weather &amp; Sky</span>
            <button class="channel-mode-btn live" data-channel="weather">LIVE</button>
          </div>
          <div class="control-row">
            <label>Clouds</label>
            <input type="range" min="0" max="100" step="1" data-field="clouds" />
            <span class="val-mono" data-val="clouds">0%</span>
          </div>
          <div class="control-row">
            <label>Precip</label>
            <select data-field="precip-type">
              <option value="none">None</option>
              <option value="rain">Rain</option>
              <option value="snow">Snow</option>
              <option value="mix">Wintry Mix</option>
            </select>
            <input type="range" min="0" max="100" step="1" data-field="precip-int" />
            <span class="val-mono" data-val="precip-int">0%</span>
          </div>
          <div class="control-row">
            <label>Fog / Mist</label>
            <input type="range" min="0" max="100" step="1" data-field="fog" />
            <span class="val-mono" data-val="fog">0%</span>
          </div>
        </div>

        <div class="channel-card">
          <div class="channel-head">
            <span class="channel-name">3 · Wind</span>
            <button class="channel-mode-btn live" data-channel="wind">LIVE</button>
          </div>
          <div class="control-row">
            <label>Speed</label>
            <input type="range" min="0" max="25" step="0.5" data-field="wind-speed" />
            <span class="val-mono" data-val="wind-speed">0 m/s</span>
          </div>
          <div class="control-row">
            <label>From</label>
            <input type="range" min="0" max="359" step="1" data-field="wind-dir" />
            <span class="val-mono" data-val="wind-dir">0° N</span>
          </div>
        </div>

        <div class="channel-card">
          <div class="channel-head">
            <span class="channel-name">4 · Temperature</span>
            <button class="channel-mode-btn live" data-channel="temperature">LIVE</button>
          </div>
          <div class="control-row">
            <label>Air Temp</label>
            <input type="range" min="-25" max="40" step="0.5" data-field="temp" />
            <span class="val-mono" data-val="temp">12°C</span>
          </div>
        </div>

        <div class="channel-card">
          <div class="channel-head">
            <span class="channel-name">5 · Seasonal Ecology</span>
            <button class="channel-mode-btn live" data-channel="ecology">LIVE</button>
          </div>
          <div class="control-row">
            <label>Phenology</label>
            <input type="range" min="0" max="0.99" step="0.01" data-field="season" />
            <span class="val-mono" data-val="season">Spring</span>
          </div>
        </div>

        <div class="channel-card">
          <div class="channel-head">
            <span class="channel-name">6 · Surface &amp; Scale</span>
            <button class="channel-mode-btn live" data-channel="surface">LIVE</button>
          </div>
          <div class="control-row">
            <label>Snow Cover</label>
            <input type="range" min="0" max="100" step="1" data-field="snow" />
            <span class="val-mono" data-val="snow">0%</span>
          </div>
          <div class="control-row">
            <label>Wetness</label>
            <input type="range" min="0" max="100" step="1" data-field="wetness" />
            <span class="val-mono" data-val="wetness">0%</span>
          </div>
          <div class="control-row">
            <label title="Visualization aid only; alters terrain slope and shadow geometry">Vert. Scale</label>
            <input type="range" min="1" max="2.5" step="0.1" data-field="exag" />
            <span class="val-mono" data-val="exag">1.0×</span>
          </div>
        </div>

        <div class="channel-card">
          <div class="channel-head">
            <span class="channel-name">Scenarios</span>
          </div>
          <div class="control-row">
            <input type="text" placeholder="Scenario name..." data-field="scenario-name" style="flex:1;" />
            <button class="mini-btn" data-action="save-scenario">Save</button>
          </div>
          <div data-field="scenario-list" style="display:flex;flex-direction:column;gap:4px;margin-top:6px;"></div>
        </div>
      </div>
    `;
  }

  private bindElements(): void {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.dateInput = q('[data-field="date"]');
    this.timeInput = q('[data-field="time"]');
    this.speedSelect = q('[data-field="speed"]');
    this.astroPauseBtn = q('[data-action="pause-clock"]');
    this.astroReadout = q('[data-field="astro-readout"]');
    this.cloudRange = q('[data-field="clouds"]');
    this.cloudVal = q('[data-val="clouds"]');
    this.precipSelect = q('[data-field="precip-type"]');
    this.precipRange = q('[data-field="precip-int"]');
    this.precipVal = q('[data-val="precip-int"]');
    this.fogRange = q('[data-field="fog"]');
    this.fogVal = q('[data-val="fog"]');
    this.windSpeedRange = q('[data-field="wind-speed"]');
    this.windSpeedVal = q('[data-val="wind-speed"]');
    this.windDirRange = q('[data-field="wind-dir"]');
    this.windDirVal = q('[data-val="wind-dir"]');
    this.tempRange = q('[data-field="temp"]');
    this.tempVal = q('[data-val="temp"]');
    this.seasonRange = q('[data-field="season"]');
    this.seasonVal = q('[data-val="season"]');
    this.snowRange = q('[data-field="snow"]');
    this.snowVal = q('[data-val="snow"]');
    this.wetRange = q('[data-field="wetness"]');
    this.wetVal = q('[data-val="wetness"]');
    this.exagRange = q('[data-field="exag"]');
    this.exagVal = q('[data-val="exag"]');
    this.scenarioNameInput = q('[data-field="scenario-name"]');
    this.scenarioListEl = q('[data-field="scenario-list"]');

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-channel]')) {
      const ch = btn.dataset.channel as SyncChannelName;
      this.modeButtons.set(ch, btn);
      btn.addEventListener('click', () => {
        if (this.world.overrides.getState()[ch].mode === 'manual') {
          this.world.restoreChannel(ch);
        }
      });
    }

    q('[data-action="restore-all"]').addEventListener('click', () => {
      this.world.restoreAllToReality();
    });
    q('[data-action="close"]').addEventListener('click', () => this.setOpen(false));

    // Track pointer drag so live UI polling doesn't fight slider drags
    this.root.addEventListener('pointerdown', () => {
      this.isDraggingInput = true;
    });
    window.addEventListener('pointerup', () => {
      this.isDraggingInput = false;
    });

    const applyClockInputs = () => {
      const tz = this.world.assets.config.timezone;
      const utcMs = regionalWallClockToUtcMs(this.dateInput.value, this.timeInput.value, tz);
      const ov = this.world.overrides.getState().astronomy;
      this.world.reality.clock.setManualTimestampMs(utcMs);
      this.world.overrides.setAstronomyManual(utcMs, ov.timeScale, ov.paused);
      this.world.emitSnapshot();
    };
    this.dateInput.addEventListener('change', applyClockInputs);
    this.timeInput.addEventListener('change', applyClockInputs);

    this.speedSelect.addEventListener('change', () => {
      const ov = this.world.overrides.getState().astronomy;
      const curMs = this.world.reality.clock.getTimestampMs();
      this.world.overrides.setAstronomyManual(curMs, Number(this.speedSelect.value), ov.paused);
      this.world.emitSnapshot();
    });

    this.astroPauseBtn.addEventListener('click', () => {
      const ov = this.world.overrides.getState().astronomy;
      const curMs = this.world.reality.clock.getTimestampMs();
      this.world.overrides.setAstronomyManual(curMs, ov.timeScale, !ov.paused);
      this.world.emitSnapshot();
    });

    const applyWeather = () => {
      this.world.overrides.setWeatherManual({
        cloudCoverTotal: Number(this.cloudRange.value) / 100,
        precipitationType: this.precipSelect.value as PrecipitationType,
        precipitationIntensity: Number(this.precipRange.value) / 100,
        fogDensity: Number(this.fogRange.value) / 100,
      });
      this.world.emitSnapshot();
    };
    this.cloudRange.addEventListener('input', applyWeather);
    this.precipSelect.addEventListener('change', applyWeather);
    this.precipRange.addEventListener('input', applyWeather);
    this.fogRange.addEventListener('input', applyWeather);

    const applyWind = () => {
      this.world.overrides.setWindManual(
        Number(this.windSpeedRange.value),
        Number(this.windDirRange.value)
      );
      this.world.emitSnapshot();
    };
    this.windSpeedRange.addEventListener('input', applyWind);
    this.windDirRange.addEventListener('input', applyWind);

    this.tempRange.addEventListener('input', () => {
      this.world.overrides.setTemperatureManual(Number(this.tempRange.value));
      this.world.emitSnapshot();
    });

    this.seasonRange.addEventListener('input', () => {
      this.world.overrides.setEcologyManual(Number(this.seasonRange.value));
      this.world.emitSnapshot();
    });

    const applySurface = () => {
      this.world.overrides.setSurfaceManual(
        Number(this.snowRange.value) / 100,
        Number(this.wetRange.value) / 100
      );
      this.world.emitSnapshot();
    };
    this.snowRange.addEventListener('input', applySurface);
    this.wetRange.addEventListener('input', applySurface);

    this.exagRange.addEventListener('input', () => {
      this.world.setVerticalExaggeration(Number(this.exagRange.value));
    });

    q('[data-action="save-scenario"]').addEventListener('click', () => {
      this.world.saveCurrentScenario(this.scenarioNameInput.value);
      this.scenarioNameInput.value = '';
    });

    this.world.bus.on('scenariosChanged', () => this.renderScenarios());
  }

  private renderScenarios(): void {
    const scenarios = this.world.listSavedScenarios();
    this.scenarioListEl.innerHTML = '';
    if (scenarios.length === 0) {
      const empty = document.createElement('span');
      empty.style.cssText = 'font-size:11px;color:var(--text-muted);';
      empty.textContent = 'No saved scenarios yet.';
      this.scenarioListEl.appendChild(empty);
      return;
    }
    for (const sc of scenarios) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const loadBtn = document.createElement('button');
      loadBtn.className = 'mini-btn';
      loadBtn.style.flex = '1';
      loadBtn.style.textAlign = 'left';
      loadBtn.textContent = sc.name;
      loadBtn.addEventListener('click', () => this.world.applyScenario(sc));

      const delBtn = document.createElement('button');
      delBtn.className = 'mini-btn';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', () => this.world.removeScenario(sc.name));

      row.append(loadBtn, delBtn);
      this.scenarioListEl.appendChild(row);
    }
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.root.classList.toggle('open', open);
  }

  toggle(): boolean {
    this.setOpen(!this.isOpen);
    return this.isOpen;
  }

  updateFromSnapshot(snap: WorldSnapshot): void {
    for (const [ch, btn] of this.modeButtons.entries()) {
      const mode = snap.overrides[ch].mode;
      btn.textContent = mode === 'live' ? 'LIVE' : 'MANUAL · SYNC';
      btn.className = `channel-mode-btn ${mode}`;
    }

    const altDeg = ((snap.astro.solarAltitudeRad * 180) / Math.PI).toFixed(1);
    const azDeg = (((snap.astro.solarAzimuthRad * 180) / Math.PI + 360) % 360).toFixed(1);
    const lunarPct = Math.round(snap.astro.lunarIllumination * 100);
    this.astroReadout.textContent = `Sun Alt ${altDeg}° · Az ${azDeg}° · Moon ${lunarPct}%`;
    this.astroPauseBtn.textContent = snap.overrides.astronomy.paused ? 'Resume' : 'Pause';

    if (this.isDraggingInput) return;

    const activeEl = document.activeElement;
    const tParts = formatRegionalTime(snap.astro.timestampMs, snap.config.timezone);
    if (activeEl !== this.dateInput) this.dateInput.value = tParts.localInputDate;
    if (activeEl !== this.timeInput) this.timeInput.value = tParts.localInputTime;
    if (activeEl !== this.speedSelect) {
      this.speedSelect.value = String(snap.overrides.astronomy.timeScale);
    }

    const cloudPct = Math.round(snap.env.cloudCoverTotal * 100);
    this.cloudRange.value = String(cloudPct);
    this.cloudVal.textContent = `${cloudPct}%`;

    if (activeEl !== this.precipSelect) {
      this.precipSelect.value = snap.env.precipitationType;
    }
    const precipPct = Math.round(snap.env.precipitationIntensity * 100);
    this.precipRange.value = String(precipPct);
    this.precipVal.textContent = `${precipPct}%`;

    const fogPct = Math.round(snap.env.fogDensity * 100);
    this.fogRange.value = String(fogPct);
    this.fogVal.textContent = `${fogPct}%`;

    this.windSpeedRange.value = snap.env.windSpeedMs.toFixed(1);
    this.windSpeedVal.textContent = `${snap.env.windSpeedMs.toFixed(1)} m/s`;

    const wDeg = Math.round(snap.env.windFromDeg);
    this.windDirRange.value = String(wDeg);
    this.windDirVal.textContent = `${wDeg}° ${formatCompassBearing(wDeg)}`;

    this.tempRange.value = snap.env.temperatureC.toFixed(1);
    this.tempVal.textContent = `${snap.env.temperatureC.toFixed(1)}°C`;

    const phenology = computeSeasonalPhenology(
      snap.astro.dayOfYear,
      snap.env.vegetationSeasonOverride,
      snap.env.temperatureC
    );
    this.seasonRange.value = phenology.seasonProgress.toFixed(2);
    this.seasonVal.textContent = phenology.label;

    const snowPct = Math.round(snap.surface.snowCover * 100);
    this.snowRange.value = String(snowPct);
    this.snowVal.textContent = `${snowPct}%`;

    const wetPct = Math.round(snap.surface.wetness * 100);
    this.wetRange.value = String(wetPct);
    this.wetVal.textContent = `${wetPct}%`;

    this.exagRange.value = snap.env.verticalExaggeration.toFixed(1);
    this.exagVal.textContent = `${snap.env.verticalExaggeration.toFixed(1)}×`;
  }
}
