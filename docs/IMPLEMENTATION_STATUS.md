# Implementation Status — 2026-11-25

## Phase II status — 2026-11-25

### Implemented and verified

- Corrected upward triangle winding for road, railway, waterway ribbons and bridge decks. Automated geometry tests inspect generated face orientation with ordinary front-face culling.
- Increased cartographic contrast and minimum display widths for roads, rails, and the Illinois River centerline without modifying source coordinates or authoritative widths.
- User-facing temperature HUD and Godmode temperature controls use Fahrenheit; Celsius remains the environmental and provider unit.
- Vertical exaggeration now defaults and resets to `2.0×`; true-scale `1.0×` remains selectable. Terrain, water, roads, bridges, buildings, vegetation, fog, precipitation, labels, and placement queries share the scale path.
- Daylight Mode is an explicit inspection-light/fog override. It does not alter simulation time, astronomical vectors, weather, or surface processes.
- Batched building visualization now supports Natural, Functional, and Selective presentation modes. The importer preserves conservative semantic function, address/operator fields, selected OSM tags, confidence, and unknown classifications rather than coercing unknown buildings to residential on future imports.
- `SurfaceResolver` now distinguishes real elevation from rendered elevation and resolves terrain, road, rail, bridge, and polygon-water surfaces for future entities.
- Initial reusable transport contracts, provider boundary, graph foundation, operating modes, provenance/staleness fields, and observed-vs-procedural duplicate suppression are implemented and tested. They are intentionally not presented as live feeds.

### Implemented but awaiting browser visual verification

- The corrected ribbons, inspection lighting, building palette/filter UI, and 2× default scale compile and have geometry/unit coverage. They still require an interactive WebGL inspection on a browser that can access the local Vite host.

### External-data limitations / awaiting credentials

- No live ADS-B, GTFS-Realtime, AIS, or freight position credentials/endpoints have been committed or enabled. `.env.example` reserves server-side-only optional credentials; no key is bundled in the client.
- USGS stage-to-local-datum conversion, CityLink realtime availability, AIS coverage, and traffic feeds remain unverified here. Current river heights remain explicitly inferred from the bundled DEM, not gauge observations.

### Procedural approximations and deferred work

- Transport entities are not yet rendered, provider polling is not wired, network routing/map matching is only the reusable graph foundation, and no provider should be represented as observed until an integration is validated.
- Building click selection/metadata inspector, POI-to-footprint spatial association, live/public schedule ingestion, vessel wakes, detailed bridge surface routing, and ambience systems remain deferred.

## Verified this increment

`npm test` passes 21 TypeScript tests. `npm run build` passes type checking and creates a static Vite build. Python pipeline tests pass (3 tests, with non-failing pyproj/Affine warnings). `npm run geo:verify` validates SHA-256 and byte-size records for all eight Peoria terrain/vector assets. The region manifest includes the required Greater Peoria communities, Peoria Lake, bluffs, floodplain, and a 20×25 km real-data extent. Coordinate round trips, true-north alignment, terrain control points, chunk seams, solar-vector alignment, seasonal sun behavior, wind convention, atmospheric bounds, overrides, benchmark isolation, camera-envelope math, quality budgets, and scenario persistence have automated coverage.

## Implemented and functioning

- Real-data manifest and bundled terrain/vector payloads, plus a deliberately labeled fixture.
- UTC clock, timezone presentation, solar/lunar ephemeris, unified Sun/light direction, and independent orbital camera.
- Chunked terrain, hydrology, roads, bridges, batched buildings, vegetation, atmospheric effects, weather polling, surface continuity, independent override channels, and LocalStorage scenarios.
- Static build output, direct fetch failure handling, validated region IDs, terrain-buffer validation, and coalesced concurrent weather fetches.

## Corrected in this increment

- A real-region load failure previously autoloaded the synthetic fixture before hiding the loading banner. Startup now fails explicitly; fixture selection requires `?region=test-fixture`.
- Truncated terrain payloads now produce an intelligible error rather than a low-level `DataView` failure.
- Concurrent manual/automatic weather refreshes now share one request; a 60-second minimum interval prevents refresh-button bursts.
- The geospatial npm scripts now run as Python modules (rather than broken direct scripts), and each committed region manifest records/verifies its terrain and vector asset byte sizes plus SHA-256 digests.
- An opt-in diagnostics panel and three fixed benchmark scenarios now expose actual browser timing/render counts. Quality presets now alter shadows, terrain LOD, vegetation, clouds, fog, and precipitation; the camera is constrained inside the finite celestial envelope.
- The Illinois River no longer receives the stale fixed `134.1 m` water surface that buried it beneath the bundled 3DEP terrain. Water polygons now carry explicitly inferred DEM-derived elevations, and its OSM centerline renders as the same animated water material with a labeled 320 m inferred width when OSM provides no usable width tag. Roads use subdued, terrain-following cartographic strokes rather than opaque cuts.

## Incomplete or approximate

- Current bundle provenance is declared by its manifest. The bundle now has self-contained integrity records, but independent source re-acquisition/checksums were not performed.
- Weather is one modeled Open-Meteo point; water-polygon elevation and the Illinois River fallback width are inferred rather than live/surveyed; individual clouds/fog/precipitation are procedural; stars are non-catalog procedural points; and no close-range LiDAR tiles are bundled.
- Browser runtime visual validation was attempted but this environment’s browser cannot reach the terminal-hosted `127.0.0.1` server. Build and asset loading are verified through automated checks, not a captured WebGL frame. Reproduce locally with `npm run dev`, start in night conditions, toggle **Daylight Mode**, then inspect roads/rails/bridges and the Illinois River at regional and neighborhood zoom.
- No repository metadata exists in this workspace (`.git` is absent), so baseline history/recoverability could not be audited.

See `KNOWN_ISSUES.md`, `PERFORMANCE.md`, and `ROADMAP.md` for the operational next steps.

The current architectural/experience assessment and ranked remediation order are in `EXPERT_REVIEW.md`.
