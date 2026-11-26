# Project Microcosm

**Geographically Anchored Procedural Environmental Terrarium**
*Initial Region:* Greater Peoria and the Illinois River Valley, Illinois, USA (`20 × 25 km`)

Project Microcosm is an interactive Three.js / WebGL miniature environmental diorama built from real elevation and vector data, real astronomical ephemeris calculations, and modeled real-world meteorology, paired with independent manual overrides ("Environmental Godmode").

---

## Quick Start

### 1. Install Frontend Dependencies
```bash
npm install
```

### 2. Run Development Server
```bash
npm run dev
```
Open the local Vite URL (default `http://localhost:5173`).
To inspect the synthetic verification fixture instead of Peoria:
`http://localhost:5173/?region=test-fixture`

### 3. Build for Production (Static Hosting)
```bash
npm run build
npm run preview
```

### 4. Run Automated Tests
```bash
# TypeScript unit & integration tests (geography, astronomy, shadows, atmosphere, overrides)
npm test

# Python geospatial pipeline tests
tools\.venv\Scripts\python.exe -m pytest tests\test_geo_pipeline.py
```

---

## Offline Geospatial Pipeline (Python)

The repository includes pre-exported regional data under `public/regions/peoria-il/` and a deterministic verification fixture under `public/regions/test-fixture/`.

To regenerate or import regions using the offline Python pipeline (`rasterio`, `pyproj`, `shapely`, `numpy`):

```powershell
python -m venv tools\.venv
tools\.venv\Scripts\pip.exe install -r tools\requirements.txt

# Re-import Greater Peoria (USGS 3DEP bare-earth DEM + OpenStreetMap Overpass vectors)
npm run geo:import

# Rebuild the synthetic test fixture
npm run geo:fixture
```

---

## Controls

| Action | Input |
|---|---|
| Orbit 360° / Tilt | Left-drag (or 1-finger touch) |
| Pan | Right-drag / `WASD` / Arrow keys |
| Zoom | Mouse wheel / Pinch |
| Auto-orbit toggle | `Space` |
| Snap to True North | `N` (or click compass rose) |
| Reset camera | `R` |
| Perspective / Orthographic | `O` |
| Toggle Landmark Labels | `L` |
| Unobstructed Observation Mode | `H` |

---

## Architecture Summary

- `src/core/`: `World.ts`, `Clock.ts` (UTC internally, IANA timezone display with DST), `EventBus.ts`, `RegionLoader.ts`, `types.ts`
- `src/geography/`: `Projection.ts` (`proj4` true-north-aligned local meters), `TerrainData.ts`, `TerrainLOD.ts` (chunked LOD with edge skirts & cutaway substrate), `Terrain.ts`, `Hydrology.ts`
- `src/celestial/`: `Ephemeris.ts` (`astronomy-engine`), `Sun.ts`, `Moon.ts`, `CelestialSpace.ts`
- `src/atmosphere/`: `WeatherProvider.ts` (Open-Meteo), `AtmosphereState.ts`, `Wind.ts`, `Clouds.ts`, `Fog.ts`, `Precipitation.ts`
- `src/ecology/`: `Seasons.ts`, `SurfaceState.ts`, `Vegetation.ts`
- `src/civilization/`: `Buildings.ts`, `Roads.ts`, `Bridges.ts`
- `src/state/`: `Reality.ts`, `Overrides.ts`, `Persistence.ts`
- `src/rendering/`: `Renderer.ts`, `Camera.ts`, `Lighting.ts`, `Diorama.ts`
- `src/ui/`: `HudView.ts`, `GodmodePanel.ts`, `styles.css`
- `tools/`: Offline Python geospatial pipeline (`import_region.py`, `prepare_terrain.py`, `prepare_vectors.py`, `build_fixture.py`, `geo/`)

## Operational documentation

- [Architecture](docs/ARCHITECTURE.md) and [physical invariants](docs/PHYSICAL_INVARIANTS.md)
- [Data provenance](docs/DATA_PROVENANCE.md) and [geographic pipeline](docs/GEOGRAPHIC_PIPELINE.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md), [performance](docs/PERFORMANCE.md), [known issues](docs/KNOWN_ISSUES.md), and [roadmap](docs/ROADMAP.md)
- [Expert re-orientation review](docs/EXPERT_REVIEW.md)

If a real-region asset fails to load, startup stops with an error. It never silently substitutes the synthetic fixture; choose it explicitly with `?region=test-fixture`.
