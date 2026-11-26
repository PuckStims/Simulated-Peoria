"""Validate or backfill integrity metadata for a prepared browser region.

Usage:
  python tools/verify_region.py --region peoria-il
  python tools/verify_region.py --region peoria-il --write-integrity
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from tools.geo.integrity import build_asset_integrity, validate_asset_integrity


def asset_names_from_manifest(manifest: dict[str, Any]) -> list[str]:
    terrain_files = [level["file"] for level in manifest["terrain"]["levels"]]
    vector_files = list(manifest["vectors"].values())
    return terrain_files + vector_files


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify prepared Microcosm region payload integrity.")
    parser.add_argument("--region", required=True, help="Region directory name under public/regions.")
    parser.add_argument(
        "--write-integrity",
        action="store_true",
        help="Write SHA-256/byte-size metadata into an existing region manifest.",
    )
    args = parser.parse_args()
    if not args.region.replace("-", "").isalnum():
        raise ValueError("Region id must contain only letters, numbers, and hyphens.")

    root = Path(__file__).resolve().parent.parent
    region_dir = root / "public" / "regions" / args.region
    manifest_path = region_dir / "region.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_names = asset_names_from_manifest(manifest)

    if args.write_integrity:
        manifest["assetIntegrity"] = build_asset_integrity(region_dir, expected_names)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote integrity metadata for {len(expected_names)} assets: {manifest_path}")
        return

    integrity = manifest.get("assetIntegrity")
    if not isinstance(integrity, dict):
        raise ValueError("Manifest has no assetIntegrity record. Run with --write-integrity after verifying the source payload.")
    declared_names = set(integrity.get("assets", {}).keys())
    if declared_names != set(expected_names):
        raise ValueError("Integrity record does not cover exactly the terrain and vector assets declared by the manifest.")
    failures = validate_asset_integrity(region_dir, integrity)
    if failures:
        raise ValueError("\n".join(failures))
    print(f"Verified {len(expected_names)} assets for region {args.region}.")


if __name__ == "__main__":
    main()
