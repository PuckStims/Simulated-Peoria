# Performance

Balanced terrain uses a 25 m, 801×1001 quantized elevation grid (about 1.6 MB) partitioned into 20 chunks. Each chunk has 96/48/24-segment LOD meshes with skirts. Buildings, roads, rails, bridges, and vegetation use batching or instancing where implemented.

The runtime `Diagnostics` panel reports rolling frame/update/render times, renderer draw/triangle/memory counts, terrain/water/vegetation/cloud/precipitation counts, and asset-load/scene-construction time. The bottom `Benchmark` selector supplies three fixed manual scenarios—Clear Summer Noon, Overcast Rain, and Winter Snow—so a quality comparison has repeatable environmental inputs.

Quality presets now have explicit budgets:

| Setting | Low | Balanced | High |
|---|---:|---:|---:|
| Device pixel ratio cap | 1.0 | 1.5 | 2.0 |
| Direct shadows | Off | 2048 | 4096 |
| Terrain maximum segments/chunk | 24 | 48 | 96 |
| Vegetation/cloud instance budget | 45% | 75% | 100% |
| Precipitation budget | 40% | 72% | 100% |

Water, road, building, and terrain source boundaries are deliberately retained at every quality level. The diagnostics reveal their cost before any fidelity-reducing change is considered.

This audit verified build size and CPU-side tests, not a calibrated GPU benchmark: the production build currently emits a 599 kB uncompressed Three.js chunk (about 150 kB gzip) plus 105 kB application code. Profile target hardware before asserting the 30 FPS target. Use the fixed scenarios to capture draw calls, triangles, GPU memory, first meaningful scene time, and WebGL frame time on integrated graphics.
