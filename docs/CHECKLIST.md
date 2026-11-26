# Project Microcosm — Historical Implementation Checklist (v0.1)

> This is a component inventory from the initial handoff, not current verification evidence. For the audited condition, corrections, and known limits, use [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Phase A — Foundation
- [x] TypeScript + Three.js + Vite + Vitest project setup with pinned dependency versions and `package-lock.json`
- [x] Region configuration schema (`public/regions/<id>/region.json`) supporting extensible regions
- [x] Authoritative UTC simulation clock with IANA timezone & DST conversion (`src/core/Clock.ts`)
- [x] Identical Python (`tools/geo/projection.py`) & TypeScript (`src/geography/Projection.ts`) UTM <-> True-North local meter transforms
- [x] Deterministic synthetic test fixture (`tools/build_fixture.py` -> `public/regions/test-fixture/`)

## Phase B — The Land
- [x] Offline USGS 3DEP terrain importer, validator, reprojector, nodata filler, multi-LOD binary quantizer (`tools/prepare_terrain.py`)
- [x] Greater Peoria (`20 × 25 km`) bare-earth DEM imported from USGS 3DEP (`public/regions/peoria-il/`)
- [x] Chunked LOD terrain meshes with seamless border skirts (`src/geography/TerrainLOD.ts`)
- [x] Physical cutaway geological substrate and architectural plinth (`buildDioramaSubstrate`)
- [x] Real water boundaries & waterways with procedural wind-driven ripples and solar specular shader (`src/geography/Hydrology.ts`)
- [x] Complete 360° orbital camera, zoom, pan, auto-orbit, reset, snap-to-north, perspective/ortho, keyboard/mouse/touch (`src/rendering/Camera.ts`)

## Phase C — The Heavens
- [x] Ephemeris calculations via `astronomy-engine` (`src/celestial/Ephemeris.ts`)
- [x] Shared authoritative `solarDirection` vector driving visible Sun, directional sunlight, sky scattering, and water reflections
- [x] Phase-shaded Moon at calculated horizontal coordinates (`src/celestial/Moon.ts`)
- [x] Finite diorama sky dome + GMST/latitude-oriented procedural starfield (`src/celestial/CelestialSpace.ts`)

## Phase D — Civilization & Ecology
- [x] Offline OSM Overpass vector pipeline (`tools/prepare_vectors.py`)
- [x] Batched building extrusion preserving footprints and flagging estimated heights (`src/civilization/Buildings.ts`)
- [x] Terrain-following road & railway ribbons (`src/civilization/Roads.ts`)
- [x] Elevated bridge decks & support piers spanning waterways (`src/civilization/Bridges.ts`)
- [x] Deterministic multi-species vegetation excluding water/roads/buildings with seasonal phenology (`src/ecology/Vegetation.ts`, `src/ecology/Seasons.ts`)

## Phase E — The Atmosphere
- [x] Open-Meteo live provider with modeled provenance, stale/offline handling (`src/atmosphere/WeatherProvider.ts`)
- [x] Meteorological wind-origin to travel-vector conversion (`src/atmosphere/Wind.ts`)
- [x] 3-layer 3D instanced cloud decks with wind drift and smooth density transitions (`src/atmosphere/Clouds.ts`)
- [x] Atmospheric haze + elevation-weighted Illinois River Valley mist (`src/atmosphere/Fog.ts`)
- [x] Region-bounded 3D rain/snow particle system clamped above terrain (`src/atmosphere/Precipitation.ts`)

## Phase F — Environmental Persistence
- [x] Bounded-timestep wetness, puddle, evaporation, snow accumulation/melt model (`src/ecology/SurfaceState.ts`)
- [x] LocalStorage persistence for surface state & scenarios (`src/state/Persistence.ts`)

## Phase G — Godmode & UI
- [x] 6 independent Live/Manual synchronization channels (`src/state/Overrides.ts`, `src/state/Reality.ts`)
- [x] Collapsible Godmode drawer + Scenario save/load (`src/ui/GodmodePanel.ts`)
- [x] Minimal HUD, compass rose, landmark pins, unobstructed observation mode, provenance modal (`src/ui/HudView.ts`)

## Phase H — Verification & Handoff
- [x] Automated Vitest suite covering geography, astronomy, shadows, atmosphere, overrides, and persistence
- [x] Automated Pytest suite covering offline geospatial pipeline
- [x] Production build verification (`tsc --noEmit && vite build`)
- [x] Documentation (`README.md`, `AGENTS.md`, `docs/DATA_SOURCES.md`, `docs/KNOWN_ISSUES.md`)
