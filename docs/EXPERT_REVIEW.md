# Expert Re-orientation Review — 2026-11-25

## Verdict

Microcosm has a sound, unusually disciplined physical/data foundation for an early 3D application. Its real strength is that coordinate orientation, astronomical direction, override isolation, and data provenance have explicit contracts and meaningful tests. It is **not yet performance-validated or release-ready**: its current graphics presets are only partial, startup is monolithic, and no browser WebGL frame has been captured in this environment.

This review distinguishes structural evidence from unmeasured performance. It does not claim an FPS problem without a browser trace.

## What should be preserved

- One UTC clock, one solar vector, true-north local coordinates, and independent reality/override channels are the correct architectural spine.
- The importer, deterministic fixture, control-point tests, and asset-integrity records make geographic work recoverable rather than magical.
- Buildings, roads, rails, bridges, and vegetation are mostly batched or instanced; the application is not naively creating one draw call per building/tree/road.
- The compact HUD and explicit provenance presentation fit the observational character of the product.

## Ranked findings

### P1 — quality presets do not yet control the expensive whole scene

`low`, `balanced`, and `high` currently vary pixel-ratio cap, shadow-map size, terrain LOD ceiling, and precipitation count. Cloud count (240), water geometry, vegetation population (up to 6,500), building geometry, and most CPU update work do not vary by preset. Therefore “low” is not a dependable integrated-GPU escape hatch.

**Resolved in this increment:** quality budgets now cover pixel ratio, shadows, terrain LOD, tree/cloud draw ranges, precipitation, and fog; the Diagnostics panel exposes the effective workload. Browser traces on target hardware remain required.

### P1 — finite sky can be exited by the camera

`DioramaScene` creates a celestial radius of 22 km for Peoria, while `CameraController.maxDistance` is 42 km and pan can move the camera target farther away. The sky dome uses `BackSide`, so the observer can leave the intended celestial enclosure. This conflicts with the finite, self-contained heaven requirement.

**Resolved in this increment:** orbit distance, pan target, and camera world position are constrained inside the dome while the world and its celestial vectors remain stationary.

### P1 — water surface draw-call pressure is structural

The Peoria payload contains 627 water bodies. `HydrologySystem` currently creates one `ShapeGeometry` mesh per body; most share the same material but are not merged. This is a likely draw-call cost independent of terrain LOD.

**Next action:** benchmark first, then batch compatible water and wetland shapes into one mesh per material while retaining exact polygon boundaries and holes.

### P2 — startup is all-or-nothing and main-thread heavy

The initial region loads and parses approximately 14.8 MB of geographic source assets at once, including 8.7 MB of buildings and 2.9 MB of roads. Construction then extrudes 24,000 building footprints and creates terrain, water, and vegetation synchronously. The loading banner has no stage/progress signal, cancellation, worker preparation, or deferred detail.

**Next action:** instrument time-to-first-frame and construction time. Only then introduce staged loading—terrain/hydrology first, then buildings/vegetation—without changing data provenance.

### P2 — frame-loop CPU costs need measurement

During wind, vegetation can rewrite matrices for every deciduous instance per frame; clouds rewrite all 240 instance matrices; rain/snow updates up to 3,200 particles on the CPU. These may be acceptable, but their aggregate cost is unknown.

**Resolved in this increment:** the opt-in diagnostics panel reports `renderer.info`, rolling update/render timings, scene counts, and startup timings. Clear Noon, Rain Storm, and Winter Snow scenarios provide fixed inputs. Capture target-hardware traces before changing algorithms.

### P3 — provenance presentation had two misleading details

The modal rendered Peoria longitude as `-89.5800°E`; it now correctly presents `89.5800°W`. The asset-load failure guidance previously implied that generating the fixture prepared real Peoria data; it now states the separation explicitly.

## Baseline evidence

| Measure | Observed |
|---|---:|
| Peoria region source assets | 14.8 MB |
| Building records / footprint vertices | 24,000 / 194,558 |
| Road records / source points | 15,954 / 60,057 |
| Water bodies | 627 |
| Terrain grid | 801 × 1001, 20 chunks |
| Vegetation cap | 6,500 instances |
| Maximum precipitation | 3,200 points |

## Recommended sequence

1. Add diagnostics and fixed benchmark scenarios.
2. Make quality presets comprehensive and observable.
3. Enforce the camera/celestial envelope.
4. Measure, then batch water and stage startup based on the trace.
5. Add browser visual regression only after the runtime can be reached from the test browser.

This sequence deliberately avoids trading geographic fidelity for guessed performance wins.
