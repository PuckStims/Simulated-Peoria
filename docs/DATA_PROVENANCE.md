# Data Provenance

The Peoria manifest identifies 3DEP bare-earth elevation as `measured`, OpenStreetMap geometry as `measured`, Open-Meteo output as `inferred` (modeled), and procedural clouds, stars, vegetation detail, substrate, fog, and precipitation as procedural representations. The `test-fixture` region is explicitly `fixture` data.

The terrain and vectors currently bundled are attributed to USGS 3DEP (public domain) and OpenStreetMap contributors (ODbL 1.0). Open-Meteo is attributed under CC BY 4.0. Building heights derived from levels or class defaults carry `heightEstimated: true`. Water-polygon surfaces use local measured 3DEP elevation plus a 0.12 m rendering clearance when no gauge stage is bundled; those records carry `elevationEstimated: true` and must not be described as live gauge observations.

Each region manifest now carries SHA-256 digests and byte sizes for every terrain and vector artifact. These records verify that a deployment matches its declared bundle; they are not independent evidence of upstream USGS or OSM provenance.

City Atlas and Kinstead were reviewed as artistic/technical references only. No external code, assets, models, or textures were imported during this increment; Microcosm therefore makes no license claim on either project. Any future reuse requires a license review before import.
