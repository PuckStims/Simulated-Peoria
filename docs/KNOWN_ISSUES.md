# Known Issues, Approximations, and Inferred Systems (v0.1)

This document explicitly distinguishes verified real-world data from approximations, procedural systems, and current limitations for Codex handoff.

## 1. Placeholders & Approximations
- **Stellar positions (`src/celestial/CelestialSpace.ts`)**: The night sky rotates accurately with Greenwich Mean Sidereal Time (GMST) and observer latitude (`40.72°N`), but individual star points are procedurally distributed rather than loaded from a validated star catalog (Hipparcos/Yale Bright Star). Stellar catalog accuracy is not claimed in v0.1.
- **Moon illumination (`src/celestial/Moon.ts`)**: Uses the exact ephemeris horizontal direction and solar vector for phase shading, without detailed lunar mare texture maps or libration.
- **Weather spatial resolution (`src/atmosphere/WeatherProvider.ts`)**: Currently samples Open-Meteo at the region's reference coordinates `(40.720, -89.580)` rather than a multi-point spatial grid across the 20 × 25 km domain.
- **Valley mist (`src/atmosphere/Fog.ts`)**: Terrain-elevation-weighted procedural mist approximating river-valley condensation; not a physical boundary-layer thermodynamic observation.
- **Hydrology stage**: Water-polygon display elevation is inferred from the local 3DEP DEM plus a 0.12 m rendering clearance, not from a live USGS gauge. The Illinois River centerline has a 320 m inferred visual width where OpenStreetMap lacks a usable width tag. Both inferences are explicitly marked in `hydrology.json`; neither represents a live river-stage or surveyed bank-to-bank measurement.

## 2. Inferred & Estimated Data
- **Building heights (`src/civilization/Buildings.ts`)**: Where OpenStreetMap lacks `height` tags, heights are inferred from `building:levels` (`3.4 m/level`) or deterministic building-class defaults and explicitly flagged `heightEstimated: true` in `buildings.json`.
- **Building roof shapes**: Generalized flat extruded footprints in v0.1; pitched/hipped roof geometry and landmark custom GLTF models are planned for future increments.
- **Bluff woodland fill (`src/ecology/Vegetation.ts`)**: Combines explicit OSM woodland/park/wetland landcover polygons with slope-based bluff woodland inference (`slope >= 0.035`), deterministically excluding water, roads, and buildings.

## 3. Terrain & Performance Notes
- **Peoria terrain resolution**: Balanced level uses a `25 m` grid (`801 × 1001`, 1.60 MB `uint16-linear`) derived from a `20 m` USGS 3DEP export. Close-inspection `2–5 m` streaming tiles from raw 2022 Mid-North Illinois LiDAR are supported by the pipeline design (`prepare_terrain_from_rasters`) but not pre-bundled to keep static bundle size light.
- **Vertical exaggeration**: Default is `1.0×` (true physical scale). Adjusting the `Vert. Scale` slider in Godmode scales Y visually and alters geometric shadow relationships; it is labeled accordingly.
- **FPS measurements**: Target of 30 FPS in balanced mode on modest integrated GPUs should be verified directly in a browser session on target hardware; headless/Node unit tests verify math, geometry, and state invariants but do not benchmark WebGL rasterization FPS.
- **Browser WebGL verification**: This audit reran `tsc --noEmit`, `vite build`, Vitest (Node), and Pytest. Interactive WebGL visual inspection remains outstanding because the available browser surface cannot reach the terminal-hosted local server. Perform a live visual pass on a normal developer browser before releasing.
