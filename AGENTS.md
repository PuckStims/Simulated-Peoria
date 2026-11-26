# AGENTS.md — Architectural Invariants for Project Microcosm

This document defines the non-negotiable architectural invariants for engineers and coding agents extending Project Microcosm.

## 1. Local Coordinate System
- `+X` = True East (meters)
- `-X` = True West (meters)
- `+Y` = Elevation above vertical datum (meters)
- `+Z` = True South (meters)
- `-Z` = True North (meters)
- `GeoProjection` (`src/geography/Projection.ts`) and `LocalProjection` (`tools/geo/projection.py`) MUST remain mathematically identical, including meridian convergence rotation (`meridianConvergenceDeg`) so `-Z` aligns with True Geographic North rather than unrotated UTM Grid North.

## 2. Authoritative Solar & Wind Vectors
- Maintain **UTC epoch milliseconds** internally (`SimulationClock`); convert to the region's IANA time zone only for display and human input (`formatRegionalTime`, `regionalWallClockToUtcMs`).
- Never equate civil noon with solar noon.
- Compute `solarDirection` once in `EphemerisEngine.compute()` using:
  `[cos(H)*sin(A), sin(H), -cos(H)*cos(A)]`.
  `LightingSystem`, `SunVisual`, `CelestialSpace`, `HydrologySystem`, `CloudSystem`, and `SurfaceStateModel` MUST all read from this single vector.
- Never replace the directional sun light with a nearby point light.
- `windFromDeg` follows meteorological convention (**where wind originates**). Travel vector MUST be computed via `windFromDegToTravelUnit()` = `[-sin(rad), cos(rad)]`.

## 3. Camera Independence
- Orbiting, panning, or switching between Perspective and Orthographic cameras (`CameraController`) MUST NEVER mutate solar azimuth, wind direction, geographical orientation, or simulation time.
- The world stays stationary; the camera orbits around the diorama.

## 4. Reality vs. Overrides Isolation
- `RealityStore` owns live UTC time and Open-Meteo modeled weather.
- `OverrideManager` owns the 6 independent override channels (`astronomy`, `weather`, `wind`, `temperature`, `ecology`, `surface`).
- Modifying one channel (e.g., manual precipitation) MUST NOT mutate another channel (e.g., astronomical time).
- Returning a channel to `'live'` restores only that channel.

## 5. Provenance & Honesty
- Real data (`measured`), modeled/inferred data (`inferred` / `heightEstimated: true`), procedural details (`procedural`), and verification fixtures (`fixture`) must remain explicitly labeled.
- Never silently substitute randomized terrain for missing real terrain without entering an explicitly labeled fixture/demonstration mode.
- The physical diorama substrate (`buildDioramaSubstrate`) is purely aesthetic and must never alter `TerrainData` elevation queries.
- Vertical exaggeration (`setVerticalExaggeration`) is an explicit visualization option (`1.0×` default) because it alters terrain slope and shadow geometry.
