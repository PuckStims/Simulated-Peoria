# Physical Invariants

This document restates the executable contracts in `AGENTS.md`.

- Local space is East/Up/South: `+X` east, `+Y` elevation, `+Z` south. `GeoProjection` and the Python `LocalProjection` apply the same configured meridian-convergence rotation so `-Z` is true north.
- `SimulationClock` stores UTC epoch milliseconds. The regional IANA zone is used only for display and wall-clock input.
- `EphemerisEngine.compute()` is the sole producer of the solar direction. Its East/Up/South vector drives the visible Sun, directional light, sky, water, cloud shading, and surface integration.
- Winds retain the meteorological “from” convention and are converted to travel using `[-sin(rad), cos(rad)]`.
- Camera movement operates on cameras and their orbit target only. It must not mutate simulation time, geographic orientation, or environmental vectors.
- `RealityStore` owns live inputs and `OverrideManager` owns six independently restorable override channels.
- Terrain queries remain real-data queries. The diorama substrate and vertical exaggeration are visual geometry only; exaggeration is explicit and defaults to `1.0×`.
