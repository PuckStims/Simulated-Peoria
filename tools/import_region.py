"""CLI entrypoint to import a configured real-world region into public/regions/<regionId>/.

Usage:
  python tools/import_region.py --region peoria-il
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from tools.geo.config import REGION_REGISTRY, RegionSpec
from tools.geo.integrity import build_asset_integrity
from tools.geo.projection import LocalProjection
from tools.prepare_terrain import acquire_usgs_3dep_tile, prepare_terrain_from_rasters
from tools.prepare_vectors import (
    build_overpass_queries,
    fetch_overpass_layer,
    prepare_vectors_from_osm,
)


def write_region_manifest(
    spec: RegionSpec,
    projection: LocalProjection,
    terrain_meta: Dict[str, Any],
    vector_counts: Dict[str, Any],
    output_dir: Path,
    data_mode: str = "real",
    extra_sources: List[Dict[str, Any]] | None = None,
) -> Path:
    sources = extra_sources or [
        {
            "name": "USGS 3D Elevation Program (3DEP) Bare-Earth DEM",
            "kind": "measured",
            "url": "https://www.usgs.gov/the-national-map-data-delivery/gis-data-download",
            "acquisitionDate": datetime.now(timezone.utc).date().isoformat(),
            "extent": f"{spec.extent_width_m/1000:.1f}km x {spec.extent_depth_m/1000:.1f}km around ({spec.ref_lat}, {spec.ref_lon})",
            "resolution": "25m balanced / 100m overview resampled from 20m export",
            "crs": spec.projected_crs,
            "datum": spec.elevation_datum,
            "license": "Public Domain (U.S. Geological Survey)",
            "attribution": "U.S. Geological Survey, 3D Elevation Program (3DEP)",
        },
        {
            "name": "OpenStreetMap Infrastructure, Hydrology & Landcover",
            "kind": "measured",
            "url": "https://www.openstreetmap.org/copyright",
            "acquisitionDate": datetime.now(timezone.utc).date().isoformat(),
            "extent": f"[{spec.west}, {spec.south}, {spec.east}, {spec.north}]",
            "resolution": "Vector footprints & polylines; missing building heights marked heightEstimated=true",
            "crs": "EPSG:4326 -> " + spec.projected_crs,
            "license": "ODbL 1.0",
            "attribution": "© OpenStreetMap contributors",
        },
        {
            "name": "Open-Meteo Weather API",
            "kind": "inferred",
            "url": "https://open-meteo.com/en/docs",
            "acquisitionDate": "Live runtime fetch",
            "extent": f"Point sample at ({spec.ref_lat}, {spec.ref_lon})",
            "resolution": "Modeled atmospheric forecast/analysis",
            "crs": "WGS84",
            "license": "CC BY 4.0",
            "attribution": "Weather data by Open-Meteo.com",
        },
    ]

    manifest = {
        "id": spec.id,
        "name": spec.name,
        "subtitle": spec.subtitle,
        "dataMode": data_mode,
        "bounds": {
            "west": spec.west,
            "east": spec.east,
            "south": spec.south,
            "north": spec.north,
        },
        "reference": {
            "latitude": spec.ref_lat,
            "longitude": spec.ref_lon,
            "elevationMeters": spec.ref_elevation_m,
        },
        "coordinateSystem": {
            "projectedCrs": projection.projected_crs,
            "proj4": projection.proj4_def,
            "origin": {
                "lon": projection.origin_lon,
                "lat": projection.origin_lat,
                "easting": round(projection.origin_easting, 4),
                "northing": round(projection.origin_northing, 4),
                "elevationDatumMeters": projection.elevation_datum_meters,
            },
            "meridianConvergenceDeg": round(projection.meridian_convergence_deg, 6),
            "alignTrueNorthToNegativeZ": projection.align_true_north_to_neg_z,
            "extentMeters": {
                "width": spec.extent_width_m,
                "depth": spec.extent_depth_m,
            },
            "horizontalScale": 1.0,
            "verticalScale": 1.0,
        },
        "timezone": spec.timezone,
        "elevationDatum": spec.elevation_datum,
        "terrain": {
            "levels": terrain_meta["levels"],
            "chunksX": spec.chunks_x,
            "chunksZ": spec.chunks_z,
            "substrateBottomMeters": spec.substrate_bottom_m,
            "waterReferenceElevationMeters": spec.water_reference_m,
        },
        "vectors": {
            "hydrologyFile": "hydrology.json",
            "roadsFile": "roads.json",
            "railwaysFile": "railways.json",
            "bridgesFile": "bridges.json",
            "buildingsFile": "buildings.json",
            "landcoverFile": "landcover.json",
        },
        "landmarks": spec.landmarks,
        "dataSources": sources,
        "processingSummary": {
            "processedAtUtc": terrain_meta["processedAtUtc"],
            "vectorCounts": vector_counts,
        },
    }

    asset_names = [level["file"] for level in terrain_meta["levels"]] + list(manifest["vectors"].values())
    manifest["assetIntegrity"] = build_asset_integrity(output_dir, asset_names)

    out_path = output_dir / "region.json"
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Import geospatial region data for Microcosm.")
    parser.add_argument("--region", default="peoria-il", choices=sorted(REGION_REGISTRY.keys()))
    parser.add_argument("--skip-vectors", action="store_true", help="Skip Overpass fetch (terrain only).")
    args = parser.parse_args()

    spec = REGION_REGISTRY[args.region]
    root = Path(__file__).resolve().parent.parent
    cache_dir = root / "tools" / ".cache" / spec.id
    output_dir = root / "public" / "regions" / spec.id

    projection = LocalProjection.from_origin(
        origin_lon=spec.ref_lon,
        origin_lat=spec.ref_lat,
        projected_crs=spec.projected_crs,
        elevation_datum_meters=spec.elevation_datum_m,
        align_true_north_to_neg_z=True,
    )

    print(f"[1/3] Acquiring USGS 3DEP elevation tile for {spec.name}...")
    dem_path = acquire_usgs_3dep_tile(spec, projection, cache_dir, pixel_size_m=20.0)
    print(f"      Acquired {dem_path}")

    print("[2/3] Reprojecting, clipping, and quantizing multi-LOD terrain...")
    terrain_meta = prepare_terrain_from_rasters([dem_path], spec, projection, output_dir)
    print(f"      Exported {len(terrain_meta['levels'])} terrain levels.")

    vector_counts: Dict[str, Any] = {}
    if not args.skip_vectors:
        print("[3/3] Fetching OpenStreetMap vectors via Overpass API...")
        queries = build_overpass_queries(spec)
        osm_layers = {}
        for name, q in queries.items():
            print(f"      Fetching layer: {name}...")
            osm_layers[name] = fetch_overpass_layer(name, q, cache_dir)
        vector_counts = prepare_vectors_from_osm(
            osm_layers,
            spec,
            projection,
            terrain_meta["balancedGrid"],
            output_dir,
        )
        print(f"      Vector counts: {vector_counts}")

    manifest_path = write_region_manifest(spec, projection, terrain_meta, vector_counts, output_dir)
    print(f"Done! Region manifest written to {manifest_path}")


if __name__ == "__main__":
    main()
