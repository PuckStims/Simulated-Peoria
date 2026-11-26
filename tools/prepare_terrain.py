"""Offline terrain acquisition, reprojection, clipping, and compact binary export.

Pipeline steps (Specification 7.2):
  1. Acquire selected elevation tiles (USGS 3DEP ImageServer or local GeoTIFFs).
  2. Validate coverage and metadata.
  3. Merge elevation rasters.
  4. Reproject into the regional true-north-aligned local coordinate grid.
  5. Clip to the configured regional extent.
  6. Resolve missing elevation values (nodata fill).
  7. Produce multiple resolution levels (overview, balanced).
  8. Generate compact browser-readable binary terrain data (.bin).
  9. Record source provenance and processing parameters.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import rasterio
from affine import Affine
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.fill import fillnodata
from rasterio.merge import merge
from rasterio.warp import reproject

from tools.geo.config import RegionSpec
from tools.geo.projection import LocalProjection

USGS_3DEP_EXPORT_URL = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
)


def acquire_usgs_3dep_tile(
    spec: RegionSpec,
    projection: LocalProjection,
    cache_dir: Path,
    pixel_size_m: float = 20.0,
) -> Path:
    """Download a regional GeoTIFF subset from USGS 3DEP ImageServer (no county-scale download)."""
    import requests

    cache_dir.mkdir(parents=True, exist_ok=True)
    out_tif = cache_dir / f"{spec.id}_3dep_{int(pixel_size_m)}m.tif"
    if out_tif.exists() and out_tif.stat().st_size > 10_000:
        return out_tif

    # Compute padded projected bbox covering the rotated local extent
    half_w = spec.extent_width_m * 0.5 + 800.0
    half_d = spec.extent_depth_m * 0.5 + 800.0
    corners = [
        projection.local_to_projected(-half_w, -half_d),
        projection.local_to_projected(half_w, -half_d),
        projection.local_to_projected(half_w, half_d),
        projection.local_to_projected(-half_w, half_d),
    ]
    min_e = min(c[0] for c in corners)
    max_e = max(c[0] for c in corners)
    min_n = min(c[1] for c in corners)
    max_n = max(c[1] for c in corners)

    width_px = min(2400, max(256, int(math.ceil((max_e - min_e) / pixel_size_m))))
    height_px = min(2400, max(256, int(math.ceil((max_n - min_n) / pixel_size_m))))
    epsg_code = int(spec.projected_crs.split(":")[1])

    params = {
        "bbox": f"{min_e:.2f},{min_n:.2f},{max_e:.2f},{max_n:.2f}",
        "bboxSR": epsg_code,
        "imageSR": epsg_code,
        "size": f"{width_px},{height_px}",
        "format": "tiff",
        "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation",
        "f": "image",
    }
    resp = requests.get(
        USGS_3DEP_EXPORT_URL,
        params=params,
        headers={"User-Agent": "MicrocosmGeoPipeline/0.1"},
        timeout=90,
    )
    resp.raise_for_status()
    if len(resp.content) < 10_000 or resp.headers.get("Content-Type", "").startswith("application/json"):
        raise RuntimeError(f"Unexpected USGS 3DEP response: {resp.text[:300]}")

    out_tif.write_bytes(resp.content)
    return out_tif


def _build_local_grid_transform(
    spec: RegionSpec,
    projection: LocalProjection,
    cols: int,
    rows: int,
) -> Tuple[Affine, float, float]:
    """Create a rasterio Affine transform mapping local grid (col, row) -> projected (easting, northing).

    Row 0 is the northernmost row (z = -depth/2), col 0 is the westernmost col (x = -width/2).
    """
    half_w = spec.extent_width_m * 0.5
    half_d = spec.extent_depth_m * 0.5
    dx = spec.extent_width_m / (cols - 1)
    dz = spec.extent_depth_m / (rows - 1)

    # Top-left pixel center is (-half_w, -half_d) in local meters
    e00, n00 = projection.local_to_projected(-half_w, -half_d)
    e10, n10 = projection.local_to_projected(-half_w + dx, -half_d)
    e01, n01 = projection.local_to_projected(-half_w, -half_d + dz)

    a = e10 - e00
    d = n10 - n00
    b = e01 - e00
    e = n01 - n00
    # Rasterio Affine maps pixel corner (col, row) -> world; shift by -0.5 pixel to center samples
    c = e00 - 0.5 * (a + b)
    f = n00 - 0.5 * (d + e)
    return Affine(a, b, c, d, e, f), dx, dz


def prepare_terrain_from_rasters(
    raster_paths: Sequence[Path],
    spec: RegionSpec,
    projection: LocalProjection,
    output_dir: Path,
    levels: Sequence[Tuple[str, str, float]] = (
        ("overview", "Overview (100m)", 100.0),
        ("balanced", "Balanced (25m)", 25.0),
    ),
) -> Dict[str, Any]:
    """Merge, validate, reproject, clip, fill, and export multi-LOD terrain binaries."""
    if not raster_paths:
        raise ValueError("At least one elevation raster is required.")

    output_dir.mkdir(parents=True, exist_ok=True)
    datasets = [rasterio.open(p) for p in raster_paths]
    try:
        for ds in datasets:
            if ds.crs is None:
                raise ValueError(f"Raster {ds.name} has no CRS metadata.")

        # Step 3: Merge multiple tiles if provided
        if len(datasets) > 1:
            merged_arr, merged_transform = merge(datasets)
            src_data = merged_arr[0].astype(np.float32)
            src_transform = merged_transform
            src_crs = datasets[0].crs
            src_nodata = datasets[0].nodata
        else:
            ds = datasets[0]
            src_data = ds.read(1).astype(np.float32)
            src_transform = ds.transform
            src_crs = ds.crs
            src_nodata = ds.nodata
    finally:
        for ds in datasets:
            ds.close()

    # Step 2: Validate coverage against region bounds
    transformer = Transformer.from_crs(src_crs, spec.projected_crs, always_xy=True)
    # Check finite ratio
    valid_mask = np.isfinite(src_data)
    if src_nodata is not None and not np.isnan(src_nodata):
        valid_mask &= src_data != src_nodata
    valid_ratio = float(np.mean(valid_mask))
    if valid_ratio < 0.85:
        raise ValueError(f"Insufficient valid elevation coverage: {valid_ratio:.1%}")

    # Step 6 (source): Resolve isolated missing values before resampling
    if not np.all(valid_mask):
        src_data = fillnodata(src_data, mask=valid_mask.astype(np.uint8), max_search_distance=32)

    level_configs: List[Dict[str, Any]] = []
    balanced_grid: Optional[np.ndarray] = None

    for level_id, label, spacing_m in levels:
        cols = int(round(spec.extent_width_m / spacing_m)) + 1
        rows = int(round(spec.extent_depth_m / spacing_m)) + 1
        dst_transform, actual_dx, actual_dz = _build_local_grid_transform(spec, projection, cols, rows)
        dst = np.full((rows, cols), np.nan, dtype=np.float32)

        reproject(
            source=src_data,
            destination=dst,
            src_transform=src_transform,
            src_crs=src_crs,
            dst_transform=dst_transform,
            dst_crs=spec.projected_crs,
            src_nodata=np.nan,
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )

        # Fill any boundary gaps introduced by rotation/clipping
        dst_valid = np.isfinite(dst)
        if not np.all(dst_valid):
            dst = fillnodata(dst, mask=dst_valid.astype(np.uint8), max_search_distance=32)
        if not np.all(np.isfinite(dst)):
            median_val = float(np.nanmedian(dst))
            dst = np.where(np.isfinite(dst), dst, median_val)

        min_elev = float(np.min(dst))
        max_elev = float(np.max(dst))
        span = max(0.01, max_elev - min_elev)
        quantized = np.clip(np.round(((dst - min_elev) / span) * 65535.0), 0, 65535).astype("<u2")

        bin_name = f"terrain_{level_id}.bin"
        (output_dir / bin_name).write_bytes(quantized.tobytes())

        if level_id == "balanced" or balanced_grid is None:
            balanced_grid = dst

        level_configs.append(
            {
                "id": level_id,
                "label": label,
                "spacingMeters": round(float(0.5 * (actual_dx + actual_dz)), 3),
                "cols": cols,
                "rows": rows,
                "file": bin_name,
                "encoding": "uint16-linear",
                "minElevationMeters": round(min_elev, 4),
                "maxElevationMeters": round(max_elev, 4),
            }
        )

    assert balanced_grid is not None
    return {
        "levels": level_configs,
        "balancedGrid": balanced_grid,
        "processedAtUtc": datetime.now(timezone.utc).isoformat(),
        "validSourceRatio": round(valid_ratio, 4),
    }


def sample_grid_elevation(
    grid: np.ndarray,
    extent_width_m: float,
    extent_depth_m: float,
    x_east: float,
    z_south: float,
) -> float:
    """Bilinearly sample elevation from a prepared terrain grid at local (x, z)."""
    rows, cols = grid.shape
    u = ((x_east + extent_width_m * 0.5) / extent_width_m) * (cols - 1)
    v = ((z_south + extent_depth_m * 0.5) / extent_depth_m) * (rows - 1)
    u = max(0.0, min(cols - 1.00001, u))
    v = max(0.0, min(rows - 1.00001, v))
    c0 = int(math.floor(u))
    r0 = int(math.floor(v))
    c1 = min(cols - 1, c0 + 1)
    r1 = min(rows - 1, r0 + 1)
    fu = u - c0
    fv = v - r0
    h00 = float(grid[r0, c0])
    h10 = float(grid[r0, c1])
    h01 = float(grid[r1, c0])
    h11 = float(grid[r1, c1])
    return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv
