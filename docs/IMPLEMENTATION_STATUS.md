# Implementation Status — 2026-11-25

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
- Browser runtime visual validation was attempted but this environment’s browser cannot reach the terminal-hosted `127.0.0.1` server. Build and asset loading are verified through automated checks, not a captured WebGL frame.
- No repository metadata exists in this workspace (`.git` is absent), so baseline history/recoverability could not be audited.

See `KNOWN_ISSUES.md`, `PERFORMANCE.md`, and `ROADMAP.md` for the operational next steps.

The current architectural/experience assessment and ranked remediation order are in `EXPERT_REVIEW.md`.
