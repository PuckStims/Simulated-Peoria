# Architecture

Microcosm is a static Vite application. `main.ts` selects a region explicitly, loads its manifest, terrain binary, and vector layers through `RegionLoader`, then constructs `MicrocosmWorld`.

`MicrocosmWorld` is the frame-loop coordinator. It advances `RealityStore`'s UTC clock, obtains the authoritative ephemeris and effective environment, advances persistent surface state on a bounded simulation cadence, updates `DioramaScene`, and renders through `MicrocosmRenderer`.

`DioramaScene` composes terrain/substrate, hydrology, infrastructure, buildings, vegetation, celestial space, Sun/Moon visuals, clouds, fog, precipitation, and lights beneath one stationary world group. `CameraController` orbits outside that assembly. Region data is described by `public/regions/<id>/region.json`; `dataMode` distinguishes real data from the deterministic `test-fixture`.

The browser has no secret-bearing backend. Open-Meteo is fetched directly as modeled weather. LocalStorage stores surface state and saved manual scenarios.
