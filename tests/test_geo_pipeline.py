"""Automated tests for the offline geospatial Python pipeline."""

from pathlib import Path
import json

from tools.build_fixture import build_fixture
from tools.geo.integrity import validate_asset_integrity
from tools.geo.projection import LocalProjection


def test_local_projection_roundtrip():
    proj = LocalProjection.from_origin(-89.58, 40.72)
    for lon, lat in [(-89.589, 40.6936), (-89.66, 40.637), (-89.57, 40.822)]:
        x, z = proj.lonlat_to_local(lon, lat)
        lon2, lat2 = proj.local_to_lonlat(x, z)
        assert abs(lon2 - lon) < 1e-7
        assert abs(lat2 - lat) < 1e-7

    # True north step aligns with -Z
    nx, nz = proj.lonlat_to_local(-89.58, 40.73)
    assert abs(nx) < 0.05
    assert nz < -1000.0


def test_build_fixture_outputs(tmp_path: Path):
    out_dir = tmp_path / "fixture"
    cache_dir = tmp_path / "cache"
    manifest_path = build_fixture(out_dir, cache_dir)
    assert manifest_path.exists()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["dataMode"] == "fixture"
    assert len(manifest["terrain"]["levels"]) == 2
    for lvl in manifest["terrain"]["levels"]:
        assert (out_dir / lvl["file"]).exists()
    for key in ["hydrologyFile", "roadsFile", "railwaysFile", "bridgesFile", "buildingsFile", "landcoverFile"]:
        assert (out_dir / manifest["vectors"][key]).exists()

    integrity = manifest["assetIntegrity"]
    expected_assets = {level["file"] for level in manifest["terrain"]["levels"]}
    expected_assets.update(manifest["vectors"].values())
    assert set(integrity["assets"]) == expected_assets
    assert validate_asset_integrity(out_dir, integrity) == []


def test_committed_peoria_region_integrity():
    root = Path(__file__).resolve().parent.parent
    region_dir = root / "public" / "regions" / "peoria-il"
    manifest = json.loads((region_dir / "region.json").read_text(encoding="utf-8"))
    assert manifest["dataMode"] == "real"
    assert validate_asset_integrity(region_dir, manifest["assetIntegrity"]) == []
