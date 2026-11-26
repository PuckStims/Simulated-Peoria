"""Builds a compact, deterministic, clearly labeled test fixture region in public/regions/test-fixture/.

Used for fast automated verification of the terrain pipeline, projection round-trips,
waterway/bridge alignment, and offline browser testing.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine

from tools.geo.config import RegionSpec
from tools.geo.projection import LocalProjection
from tools.import_region import write_region_manifest
from tools.prepare_terrain import prepare_terrain_from_rasters, sample_grid_elevation
from tools.prepare_vectors import prepare_vectors_from_osm


FIXTURE_SPEC = RegionSpec(
    id="test-fixture",
    name="Microcosm Test Valley Fixture",
    subtitle="Synthetic Verification Fixture",
    west=-89.640,
    east=-89.520,
    south=40.675,
    north=40.765,
    ref_lat=40.720,
    ref_lon=-89.580,
    ref_elevation_m=150.0,
    projected_crs="EPSG:26916",
    timezone="America/Chicago",
    elevation_datum="NAVD88 (synthetic meters)",
    extent_width_m=8000.0,
    extent_depth_m=10000.0,
    elevation_datum_m=130.0,
    substrate_bottom_m=95.0,
    water_reference_m=134.0,
    chunks_x=2,
    chunks_z=2,
    landmarks=[
        {"id": "fixture-town", "name": "Fixture Landing", "lon": -89.592, "lat": 40.715, "category": "city"},
        {"id": "fixture-bridge", "name": "Fixture Crossing", "lon": -89.580, "lat": 40.720, "category": "landmark"},
    ],
)


def build_fixture(output_dir: Path, cache_dir: Path) -> Path:
    projection = LocalProjection.from_origin(
        origin_lon=FIXTURE_SPEC.ref_lon,
        origin_lat=FIXTURE_SPEC.ref_lat,
        projected_crs=FIXTURE_SPEC.projected_crs,
        elevation_datum_meters=FIXTURE_SPEC.elevation_datum_m,
        align_true_north_to_neg_z=True,
    )

    cache_dir.mkdir(parents=True, exist_ok=True)
    tif_path = cache_dir / "fixture_dem.tif"

    # Build a synthetic projected GeoTIFF with a flat river channel along x=0 and bluffs on both sides
    cols, rows = 240, 300
    dx, dy = 40.0, 40.0
    left = projection.origin_easting - (cols * dx) * 0.5
    top = projection.origin_northing + (rows * dy) * 0.5
    transform = Affine.translation(left, top) * Affine.scale(dx, -dy)

    xs = np.linspace(-(cols * dx) * 0.5, (cols * dx) * 0.5, cols)
    zs = np.linspace(-(rows * dy) * 0.5, (rows * dy) * 0.5, rows)
    gx, gz = np.meshgrid(xs, zs)

    # River channel curves gently through the center
    river_center = 420.0 * np.sin(gz / 2200.0)
    dist_river = np.abs(gx - river_center)
    bluff = 1.0 / (1.0 + np.exp(-(dist_river - 1100.0) / 180.0))
    elevation = 132.5 + 58.0 * bluff + 4.5 * np.sin(gx / 900.0) * np.cos(gz / 1100.0) * bluff
    # Carve river bed below water reference
    channel = np.exp(-((dist_river / 380.0) ** 4))
    elevation = elevation * (1.0 - channel) + 131.0 * channel

    with rasterio.open(
        tif_path,
        "w",
        driver="GTiff",
        height=rows,
        width=cols,
        count=1,
        dtype="float32",
        crs=FIXTURE_SPEC.projected_crs,
        transform=transform,
        nodata=-9999.0,
    ) as dst:
        dst.write(elevation.astype(np.float32), 1)

    terrain_meta = prepare_terrain_from_rasters(
        [tif_path],
        FIXTURE_SPEC,
        projection,
        output_dir,
        levels=(("overview", "Overview (100m)", 100.0), ("balanced", "Balanced (50m)", 50.0)),
    )

    # Construct synthetic OSM-shaped elements for the vector pipeline
    def to_lonlat(x: float, z: float) -> dict:
        lon, lat = projection.local_to_lonlat(x, z)
        return {"lon": lon, "lat": lat}

    river_poly = []
    for z in np.linspace(-4900, 4900, 25):
        cx = 420.0 * math.sin(z / 2200.0)
        river_poly.append(to_lonlat(cx - 340.0, float(z)))
    for z in np.linspace(4900, -4900, 25):
        cx = 420.0 * math.sin(z / 2200.0)
        river_poly.append(to_lonlat(cx + 340.0, float(z)))
    river_poly.append(river_poly[0])

    osm_layers = {
        "hydrology": {
            "elements": [
                {"type": "way", "id": 1001, "tags": {"natural": "water", "water": "river", "name": "Fixture River"}, "geometry": river_poly},
            ]
        },
        "roads": {
            "elements": [
                {
                    "type": "way",
                    "id": 2001,
                    "tags": {"highway": "primary", "name": "Valley Parkway"},
                    "geometry": [to_lonlat(-1400, -3500), to_lonlat(-1350, 0), to_lonlat(-1400, 3500)],
                },
                {
                    "type": "way",
                    "id": 2002,
                    "tags": {"highway": "primary", "bridge": "yes", "name": "Fixture Crossing Bridge"},
                    "geometry": [to_lonlat(-900, 0), to_lonlat(0, 0), to_lonlat(900, 0)],
                },
                {
                    "type": "way",
                    "id": 2003,
                    "tags": {"railway": "rail", "name": "Valley Rail"},
                    "geometry": [to_lonlat(-1050, -3500), to_lonlat(-1050, 3500)],
                },
            ]
        },
        "buildings": {
            "elements": [
                {
                    "type": "way",
                    "id": 3001,
                    "tags": {"building": "commercial", "height": "24", "name": "Fixture Tower"},
                    "geometry": [
                        to_lonlat(-1650, -80),
                        to_lonlat(-1570, -80),
                        to_lonlat(-1570, 0),
                        to_lonlat(-1650, 0),
                        to_lonlat(-1650, -80),
                    ],
                },
                {
                    "type": "way",
                    "id": 3002,
                    "tags": {"building": "residential"},
                    "geometry": [
                        to_lonlat(-1800, 120),
                        to_lonlat(-1750, 120),
                        to_lonlat(-1750, 170),
                        to_lonlat(-1800, 170),
                        to_lonlat(-1800, 120),
                    ],
                },
            ]
        },
        "landcover": {
            "elements": [
                {
                    "type": "way",
                    "id": 4001,
                    "tags": {"natural": "wood"},
                    "geometry": [
                        to_lonlat(1400, -2000),
                        to_lonlat(3200, -2000),
                        to_lonlat(3200, 2000),
                        to_lonlat(1400, 2000),
                        to_lonlat(1400, -2000),
                    ],
                },
                {
                    "type": "way",
                    "id": 4002,
                    "tags": {"landuse": "farmland"},
                    "geometry": [
                        to_lonlat(-3400, -2500),
                        to_lonlat(-2000, -2500),
                        to_lonlat(-2000, 2500),
                        to_lonlat(-3400, 2500),
                        to_lonlat(-3400, -2500),
                    ],
                },
            ]
        },
    }

    vector_counts = prepare_vectors_from_osm(
        osm_layers,
        FIXTURE_SPEC,
        projection,
        terrain_meta["balancedGrid"],
        output_dir,
        source_note="Synthetic Verification Fixture",
    )

    fixture_sources = [
        {
            "name": "Synthetic Verification Fixture DEM & Vectors",
            "kind": "fixture",
            "url": "local://tools/build_fixture.py",
            "acquisitionDate": "Deterministic generator",
            "extent": "8km x 10km synthetic valley",
            "resolution": "50m balanced / 100m overview",
            "crs": FIXTURE_SPEC.projected_crs,
            "datum": FIXTURE_SPEC.elevation_datum,
            "license": "Project Microcosm Test Fixture (MIT)",
            "attribution": "Generated locally by tools/build_fixture.py",
        }
    ]

    return write_region_manifest(
        FIXTURE_SPEC,
        projection,
        terrain_meta,
        vector_counts,
        output_dir,
        data_mode="fixture",
        extra_sources=fixture_sources,
    )


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out = build_fixture(
        root / "public" / "regions" / "test-fixture",
        root / "tools" / ".cache" / "test-fixture",
    )
    print(f"Built test fixture at {out}")


if __name__ == "__main__":
    main()
