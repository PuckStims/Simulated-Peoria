# Roadmap

1. Independently reacquire the 3DEP/OSM source payloads and record source-response checksums or immutable source identifiers; bundle-integrity checks now exist, but they cannot establish upstream source identity alone.
2. Run the new fixed benchmarks on integrated GPUs, record traces, and use them to decide whether water batching or staged construction is warranted.
3. Add browser-level WebGL smoke and visual regression tests for real and fixture regions.
4. Add terrain tiles only if close-inspection fidelity is needed without inflating initial download size.
5. Consider geographically distributed weather samples and a live USGS river-stage channel, preserving separate provenance and override channels.

No population simulation, fabricated geography, or externally hosted paid service is planned.
