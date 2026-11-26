# Geographic Pipeline

The reproducible importer is `tools/import_region.py`. It builds a region from the configured `RegionSpec` using a USGS 3DEP bare-earth raster and OpenStreetMap Overpass vector responses, then writes the browser payloads under `public/regions/<id>/`.

1. `LocalProjection.from_origin()` establishes NAD83 / UTM 16N and records numerical meridian convergence.
2. `prepare_terrain.py` reprojects, clips, fills nodata, resamples, and quantizes overview and balanced elevation grids.
3. `prepare_vectors.py` clips projected OSM water, roads, rails, bridges, buildings, and landcover. Missing building heights are marked `heightEstimated: true`; they are never presented as measured heights.
4. `region.json` records extents, datums, sources, processing time, vector counts, and SHA-256/byte-size records for every terrain and vector asset.

Run `npm run geo:import` only after creating `tools/.venv` and installing `tools/requirements.txt`. It requires network access to the documented public sources. `npm run geo:fixture` produces the separate deterministic verification fixture and must not be used as a real-region replacement. Run `npm run geo:verify` to validate the committed real-region assets against their manifest integrity record.

The committed payload’s byte identity is now verifiable against its manifest. This detects accidental modification or incomplete deployment; it does not independently establish the upstream source identity because the checksum is stored beside the assets. This audit did not independently redownload and compare the 3DEP/OSM source exports.
