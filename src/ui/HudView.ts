/**
 * Primary minimal HUD overlay (Section 18).
 * Keeps the diorama dominant on screen while surfacing region, time, modeled weather,
 * sync status, compass, camera controls, unobstructed observation mode, and provenance modal.
 */

import type { GraphicsQuality } from '../core/types';
import { formatRegionalTime } from '../core/Clock';
import type { MicrocosmWorld, WorldSnapshot } from '../core/World';
import { formatCompassBearing } from '../atmosphere/Wind';
import { GodmodePanel } from './GodmodePanel';
import { formatFahrenheit } from '../core/Temperature';

export class HudView {
  readonly root: HTMLElement;
  private readonly world: MicrocosmWorld;
  private readonly godmode: GodmodePanel;
  private unobstructed = false;
  private showLandmarks = true;
  private landmarkEls: Array<{ lon: number; lat: number; el: HTMLDivElement }> = [];

  private regionTitleEl!: HTMLSpanElement;
  private dataBadgeEl!: HTMLSpanElement;
  private timeEl!: HTMLSpanElement;
  private astroModeEl!: HTMLSpanElement;
  private weatherEl!: HTMLSpanElement;
  private syncDotEl!: HTMLSpanElement;
  private syncTextEl!: HTMLSpanElement;
  private compassNeedleEl!: SVGElement;
  private orbitBtn!: HTMLButtonElement;
  private orthoBtn!: HTMLButtonElement;
  private landmarksBtn!: HTMLButtonElement;
  private qualitySelect!: HTMLSelectElement;
  private buildingModeSelect!: HTMLSelectElement;
  private buildingCategorySelect!: HTMLSelectElement;
  private benchmarkSelect!: HTMLSelectElement;
  private godmodeBtn!: HTMLButtonElement;
  private modalEl!: HTMLDivElement;
  private modalBodyEl!: HTMLDivElement;
  private modalTitleEl!: HTMLSpanElement;
  private landmarksLayer!: HTMLDivElement;

  constructor(world: MicrocosmWorld) {
    this.world = world;
    this.godmode = new GodmodePanel(world);

    this.root = document.createElement('div');
    this.root.className = 'hud-layer';
    this.root.innerHTML = this.template();
    this.root.appendChild(this.godmode.root);

    this.bindElements();
    this.createLandmarkPins();
    this.populateProvenanceModal();

    this.world.bus.on('snapshot', (snap) => this.render(snap));
    window.addEventListener('keydown', this.onKeyDown);
  }

  private template(): string {
    return `
      <div class="landmarks-overlay hud-chrome" data-el="landmarks-layer"></div>

      <section class="glass-card hud-top-left hud-chrome">
        <div class="region-header">
          <span class="region-title" data-el="region-title">Loading Region...</span>
          <span class="badge badge-real" data-el="data-badge">REAL</span>
        </div>
        <div class="time-row">
          <span data-el="time-str">--:--:--</span>
          <span class="badge badge-modeled" data-el="astro-mode">LIVE</span>
        </div>
        <div class="weather-row">
          <span data-el="weather-str">--°F · Calm</span>
          <span class="badge badge-modeled" title="Atmospheric output from Open-Meteo model">Modeled</span>
        </div>
        <div class="sync-strip">
          <span class="sync-dot" data-el="sync-dot"></span>
          <span data-el="sync-text">Synchronized with reality</span>
        </div>
      </section>

      <div class="hud-top-right hud-chrome">
        <button class="icon-btn compass-btn" data-action="north" title="Snap to True Geographic North (N)">
          <svg width="24" height="24" viewBox="0 0 24 24" class="compass-needle" data-el="compass-needle">
            <polygon points="12,3 15,12 12,10 9,12" fill="#e26b5c"/>
            <polygon points="12,21 15,12 12,14 9,12" fill="#8998aa"/>
            <text x="12" y="2.6" text-anchor="middle" font-size="4.5" fill="#eef2f6" font-weight="700">N</text>
          </svg>
        </button>
        <button class="pill-btn" data-action="sources" title="Data Provenance & Diagnostics">Sources</button>
        <button class="pill-btn" data-action="diagnostics" title="Performance Diagnostics">Diagnostics</button>
        <button class="pill-btn" data-action="godmode" title="Environmental Godmode">Environment</button>
        <button class="pill-btn" data-action="hide-hud" title="Unobstructed Observation Mode (H)">Observe</button>
      </div>

      <button class="pill-btn unobstructed-restore" data-action="show-hud" title="Show Controls (H)">Show HUD</button>

      <div class="glass-card hud-bottom-bar hud-chrome">
        <button class="mini-btn" data-action="orbit" title="Toggle slow revolution (Space)">Orbit</button>
        <button class="mini-btn" data-action="reset-cam" title="Reset Camera (R)">Reset</button>
        <button class="mini-btn" data-action="north-btn" title="Return to True North (N)">North</button>
        <button class="mini-btn" data-action="ortho" title="Perspective / Orthographic (O)">Persp</button>
        <button class="mini-btn" data-action="landmarks" title="Toggle Landmark Labels (L)">Labels</button>
        <button class="mini-btn" data-action="daylight" title="Neutral inspection light; does not change simulation time">Daylight: Off</button>
        <select data-el="building-mode" title="Building visualization mode">
          <option value="natural">Buildings: Natural</option>
          <option value="functional">Buildings: Functional</option>
          <option value="selective">Buildings: Selective</option>
        </select>
        <select data-el="building-category" title="Selective category and compact color legend">
          <option value="">All functions</option>
          <option value="medical">Medical (teal)</option><option value="emergency-medical">Emergency medical (deep teal)</option>
          <option value="retail">Retail (gold)</option><option value="education">Education (periwinkle)</option>
          <option value="industrial">Industrial (slate)</option><option value="transportation">Transport (steel blue)</option>
          <option value="residential">Residential (sand)</option><option value="unknown">Unknown (grey)</option>
        </select>
        <select data-el="quality-select" title="Graphics Quality">
          <option value="low">Low</option>
          <option value="balanced" selected>Balanced</option>
          <option value="high">High</option>
        </select>
        <select data-el="benchmark-select" title="Repeatable performance benchmark scenario">
          <option value="">Benchmark…</option>
          <option value="clear-noon">Clear Noon</option>
          <option value="rain-storm">Rain Storm</option>
          <option value="winter-snow">Winter Snow</option>
        </select>
      </div>

      <div class="modal-backdrop" data-el="sources-modal">
        <div class="modal-card">
          <div class="drawer-header">
            <span class="drawer-title" data-el="modal-title">Data Provenance &amp; Coordinate System</span>
            <button class="mini-btn" data-action="close-modal">✕</button>
          </div>
          <div class="modal-body" data-el="sources-body"></div>
        </div>
      </div>
    `;
  }

  private bindElements(): void {
    const q = <T extends HTMLElement | SVGElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.regionTitleEl = q('[data-el="region-title"]');
    this.dataBadgeEl = q('[data-el="data-badge"]');
    this.timeEl = q('[data-el="time-str"]');
    this.astroModeEl = q('[data-el="astro-mode"]');
    this.weatherEl = q('[data-el="weather-str"]');
    this.syncDotEl = q('[data-el="sync-dot"]');
    this.syncTextEl = q('[data-el="sync-text"]');
    this.compassNeedleEl = q('[data-el="compass-needle"]');
    this.orbitBtn = q('[data-action="orbit"]');
    this.orthoBtn = q('[data-action="ortho"]');
    this.landmarksBtn = q('[data-action="landmarks"]');
    this.qualitySelect = q('[data-el="quality-select"]');
    this.buildingModeSelect = q('[data-el="building-mode"]');
    this.buildingCategorySelect = q('[data-el="building-category"]');
    this.benchmarkSelect = q('[data-el="benchmark-select"]');
    this.godmodeBtn = q('[data-action="godmode"]');
    this.modalEl = q('[data-el="sources-modal"]');
    this.modalBodyEl = q('[data-el="sources-body"]');
    this.modalTitleEl = q('[data-el="modal-title"]');
    this.landmarksLayer = q('[data-el="landmarks-layer"]');

    q('[data-action="north"]').addEventListener('click', () => this.world.cameraCtrl.snapToNorth());
    q('[data-action="north-btn"]').addEventListener('click', () => this.world.cameraCtrl.snapToNorth());
    q('[data-action="reset-cam"]').addEventListener('click', () => this.world.cameraCtrl.resetView());
    q('[data-action="orbit"]').addEventListener('click', () => {
      this.world.cameraCtrl.toggleAutoOrbit();
      this.world.emitSnapshot();
    });
    q('[data-action="ortho"]').addEventListener('click', () => {
      const next = this.world.cameraCtrl.getMode() === 'perspective' ? 'orthographic' : 'perspective';
      this.world.cameraCtrl.setMode(next, window.innerWidth / Math.max(1, window.innerHeight));
      this.world.emitSnapshot();
    });
    q('[data-action="landmarks"]').addEventListener('click', () => {
      this.showLandmarks = !this.showLandmarks;
      this.landmarksLayer.style.display = this.showLandmarks ? 'block' : 'none';
      this.landmarksBtn.textContent = this.showLandmarks ? 'Labels: On' : 'Labels: Off';
    });
    q('[data-action="daylight"]').addEventListener('click', () => {
      this.world.setDaylightMode(!this.world.getSnapshot().daylightMode);
    });
    this.landmarksBtn.textContent = 'Labels: On';

    this.qualitySelect.addEventListener('change', () => {
      this.world.setQuality(this.qualitySelect.value as GraphicsQuality);
    });
    const applyBuildingPresentation = () => {
      const category = this.buildingCategorySelect.value;
      this.world.setBuildingVisualization(
        this.buildingModeSelect.value as import('../civilization/Buildings').BuildingVisualizationMode,
        category ? [category as import('../civilization/Buildings').BuildingFunctionCategory] : null
      );
    };
    this.buildingModeSelect.addEventListener('change', applyBuildingPresentation);
    this.buildingCategorySelect.addEventListener('change', applyBuildingPresentation);
    this.benchmarkSelect.addEventListener('change', () => {
      const id = this.benchmarkSelect.value;
      if (id) this.world.applyBenchmarkScenario(id as 'clear-noon' | 'rain-storm' | 'winter-snow');
      else this.world.restoreAllToReality();
    });

    this.godmodeBtn.addEventListener('click', () => {
      const open = this.godmode.toggle();
      this.godmodeBtn.classList.toggle('active', open);
    });

    q('[data-action="hide-hud"]').addEventListener('click', () => this.setUnobstructed(true));
    q('[data-action="show-hud"]').addEventListener('click', () => this.setUnobstructed(false));
    q('[data-action="sources"]').addEventListener('click', () => {
      this.modalEl.dataset.mode = 'sources';
      this.modalTitleEl.textContent = 'Data Provenance & Coordinate System';
      this.populateProvenanceModal();
      this.modalEl.classList.add('open');
    });
    q('[data-action="diagnostics"]').addEventListener('click', () => {
      this.modalEl.dataset.mode = 'diagnostics';
      this.modalTitleEl.textContent = 'Performance Diagnostics';
      this.populateDiagnosticsModal(this.world.getSnapshot());
      this.modalEl.classList.add('open');
    });
    q('[data-action="close-modal"]').addEventListener('click', () => this.modalEl.classList.remove('open'));
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.modalEl.classList.remove('open');
    });
  }

  private createLandmarkPins(): void {
    for (const lm of this.world.assets.config.landmarks) {
      const el = document.createElement('div');
      el.className = `landmark-pin ${lm.category}`;
      el.textContent = lm.name;
      this.landmarksLayer.appendChild(el);
      this.landmarkEls.push({ lon: lm.lon, lat: lm.lat, el });
    }
  }

  private populateProvenanceModal(): void {
    const cfg = this.world.assets.config;
    const latHemisphere = cfg.reference.latitude >= 0 ? 'N' : 'S';
    const lonHemisphere = cfg.reference.longitude >= 0 ? 'E' : 'W';
    const sourcesHtml = cfg.dataSources
      .map(
        (s) => `
        <div class="source-item">
          <div><strong>${s.name}</strong> <span class="badge badge-${s.kind === 'fixture' ? 'fixture' : 'real'}">${s.kind}</span></div>
          <div>Extent: ${s.extent} · Resolution: ${s.resolution}</div>
          <div>CRS: ${s.crs}${s.datum ? ' · Datum: ' + s.datum : ''}</div>
          <div>License: ${s.license} — ${s.attribution}</div>
        </div>`
      )
      .join('');

    this.modalBodyEl.innerHTML = `
      <p><strong>Region:</strong> ${cfg.name} (${cfg.id}) · Data Mode: <code>${cfg.dataMode}</code></p>
      <p><strong>Local Coordinate System:</strong> ${cfg.coordinateSystem.projectedCrs} centered at (${Math.abs(cfg.reference.latitude).toFixed(4)}°${latHemisphere}, ${Math.abs(cfg.reference.longitude).toFixed(4)}°${lonHemisphere}), meridian convergence ${cfg.coordinateSystem.meridianConvergenceDeg.toFixed(3)}°, True North = -Z, East = +X, Elevation = +Y.</p>
      <p><strong>Distinction Notice:</strong> Terrain elevation and infrastructure footprints originate from the listed geospatial datasets. Building heights marked <code>heightEstimated</code>, procedural foliage placement, valley mist, clouds, and weather conditions (modeled via Open-Meteo) are procedural or modeled representations.</p>
      ${sourcesHtml}
    `;
  }

  private populateDiagnosticsModal(snap: WorldSnapshot): void {
    const d = snap.diagnostics;
    const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    const ms = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)} ms`);
    const benchmark = snap.activeBenchmark
      ? snap.activeBenchmark.replace('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
      : 'Live / custom conditions';
    this.modalBodyEl.innerHTML = `
      <p><strong>${benchmark}</strong> · ${snap.quality} quality · ${snap.fps} FPS estimate</p>
      <div class="diagnostics-grid">
        <span>Frame</span><strong>${d.frameMs.toFixed(1)} ms</strong>
        <span>World update</span><strong>${d.updateMs.toFixed(1)} ms</strong>
        <span>Renderer</span><strong>${d.renderMs.toFixed(1)} ms</strong>
        <span>Draw calls</span><strong>${d.drawCalls}</strong>
        <span>Triangles</span><strong>${d.triangles.toLocaleString()}</strong>
        <span>GPU geometries / textures</span><strong>${d.geometries} / ${d.textures}</strong>
        <span>Terrain chunks</span><strong>${d.activeTerrainChunks}</strong>
        <span>Water meshes</span><strong>${d.waterMeshes}</strong>
        <span>Vegetation instances</span><strong>${d.vegetationInstances.toLocaleString()}</strong>
        <span>Cloud instances</span><strong>${d.cloudInstances}</strong>
        <span>Precipitation points</span><strong>${d.precipitationPoints.toLocaleString()}</strong>
        <span>Geographic source assets</span><strong>${mb(d.sourceAssetBytes)}</strong>
        <span>Asset load / scene construction</span><strong>${ms(d.assetLoadMs)} / ${ms(d.sceneConstructionMs)}</strong>
      </div>
      <p class="diagnostics-note">Values are rolling frame samples from this browser, not a benchmark score. Use the fixed benchmark selector below the scene when comparing quality presets.</p>
    `;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'KeyH') this.setUnobstructed(!this.unobstructed);
    else if (e.code === 'KeyR') this.world.cameraCtrl.resetView();
    else if (e.code === 'KeyN') this.world.cameraCtrl.snapToNorth();
    else if (e.code === 'Space') {
      e.preventDefault();
      this.world.cameraCtrl.toggleAutoOrbit();
      this.world.emitSnapshot();
    } else if (e.code === 'KeyO') {
      const next = this.world.cameraCtrl.getMode() === 'perspective' ? 'orthographic' : 'perspective';
      this.world.cameraCtrl.setMode(next, window.innerWidth / Math.max(1, window.innerHeight));
      this.world.emitSnapshot();
    } else if (e.code === 'KeyL') {
      this.landmarksBtn.click();
    }
  };

  setUnobstructed(enabled: boolean): void {
    this.unobstructed = enabled;
    this.root.classList.toggle('is-unobstructed', enabled);
  }

  private render(snap: WorldSnapshot): void {
    this.regionTitleEl.textContent = snap.config.name;
    this.dataBadgeEl.textContent =
      snap.config.dataMode === 'real'
        ? 'USGS · OSM'
        : snap.config.dataMode === 'fixture'
          ? 'FIXTURE'
          : 'DEMO';
    this.dataBadgeEl.className = `badge ${
      snap.config.dataMode === 'real' ? 'badge-real' : 'badge-fixture'
    }`;

    const tParts = formatRegionalTime(snap.astro.timestampMs, snap.config.timezone);
    this.timeEl.textContent = tParts.formattedDateTime;
    this.astroModeEl.textContent =
      snap.overrides.astronomy.mode === 'live'
        ? 'LIVE'
        : `MANUAL ${snap.overrides.astronomy.timeScale}×`;

    const cloudPct = Math.round(snap.env.cloudCoverTotal * 100);
    const windDir = formatCompassBearing(snap.env.windFromDeg);
    const precipStr =
      snap.env.precipitationType === 'none'
        ? ''
        : ` · ${snap.env.precipitationType.toUpperCase()}`;
    this.weatherEl.textContent = `${formatFahrenheit(snap.env.temperatureC)} · Wind ${windDir} ${snap.env.windSpeedMs.toFixed(1)} m/s · Clouds ${cloudPct}%${precipStr}`;

    const anyManual = this.world.overrides.isAnyManual();
    if (anyManual) {
      this.syncDotEl.className = 'sync-dot manual';
      this.syncTextEl.textContent = `Manual overrides active · ${snap.fps} FPS`;
    } else if (snap.weatherStatus.state !== 'live') {
      this.syncDotEl.className = `sync-dot ${snap.weatherStatus.state}`;
      this.syncTextEl.textContent = `${snap.weatherStatus.message} · ${snap.fps} FPS`;
    } else {
      this.syncDotEl.className = 'sync-dot';
      this.syncTextEl.textContent = `Live reality sync · ${snap.fps} FPS`;
    }

    this.compassNeedleEl.style.transform = `rotate(${-snap.compassHeadingDeg}deg)`;
    this.orbitBtn.textContent = snap.autoOrbit ? 'Orbiting' : 'Orbit';
    this.orthoBtn.textContent = snap.cameraMode === 'perspective' ? 'Persp' : 'Ortho';
    const daylightButton = this.root.querySelector<HTMLButtonElement>('[data-action="daylight"]')!;
    daylightButton.textContent = snap.daylightMode ? 'Daylight: On' : 'Daylight: Off';
    daylightButton.classList.toggle('active', snap.daylightMode);
    this.qualitySelect.value = snap.quality;
    this.benchmarkSelect.value = snap.activeBenchmark ?? '';
    if (this.modalEl.classList.contains('open') && this.modalEl.dataset.mode === 'diagnostics') {
      this.populateDiagnosticsModal(snap);
    }

    if (this.showLandmarks && !this.unobstructed) {
      for (const lm of this.landmarkEls) {
        const pt = this.world.projectLandmarkToScreen(lm.lon, lm.lat);
        if (!pt.visible || pt.x < -40 || pt.x > window.innerWidth + 40 || pt.y < -20 || pt.y > window.innerHeight + 20) {
          lm.el.style.display = 'none';
        } else {
          lm.el.style.display = 'block';
          lm.el.style.left = `${pt.x.toFixed(1)}px`;
          lm.el.style.top = `${pt.y.toFixed(1)}px`;
        }
      }
    }

    this.godmode.updateFromSnapshot(snap);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
