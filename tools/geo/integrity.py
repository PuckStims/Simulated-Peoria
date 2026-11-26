"""Integrity records for prepared, browser-consumable region assets."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Dict, Iterable


def sha256_file(path: Path) -> str:
    """Return a streaming SHA-256 digest without loading a geographic payload at once."""
    digest = hashlib.sha256()
    with path.open("rb") as asset:
        for block in iter(lambda: asset.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_asset_integrity(output_dir: Path, asset_names: Iterable[str]) -> Dict[str, Any]:
    """Create a deterministic integrity record for named files directly under a region directory."""
    root = output_dir.resolve()
    assets: Dict[str, Dict[str, Any]] = {}
    for name in sorted(set(asset_names)):
        path = (root / name).resolve()
        if path.parent != root or not path.is_file():
            raise ValueError(f"Asset integrity target is missing or outside region directory: {name}")
        assets[name] = {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
    return {"algorithm": "sha256", "assets": assets}


def validate_asset_integrity(output_dir: Path, integrity: Dict[str, Any]) -> list[str]:
    """Return all integrity failures; an empty list means all declared assets match."""
    if integrity.get("algorithm") != "sha256":
        return ["Unsupported or missing integrity algorithm (expected sha256)."]
    assets = integrity.get("assets")
    if not isinstance(assets, dict) or not assets:
        return ["Integrity record has no assets."]

    root = output_dir.resolve()
    failures: list[str] = []
    for name, expected in assets.items():
        if not isinstance(name, str) or not isinstance(expected, dict):
            failures.append("Integrity record contains an invalid asset entry.")
            continue
        path = (root / name).resolve()
        if path.parent != root or not path.is_file():
            failures.append(f"Missing or invalid asset: {name}")
            continue
        if path.stat().st_size != expected.get("bytes"):
            failures.append(f"Byte size mismatch: {name}")
        if sha256_file(path) != expected.get("sha256"):
            failures.append(f"SHA-256 mismatch: {name}")
    return failures
