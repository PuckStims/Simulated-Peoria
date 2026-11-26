"""Region specification definitions and metadata helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class RegionSpec:
    id: str
    name: str
    subtitle: str
    west: float
    east: float
    south: float
    north: float
    ref_lat: float
    ref_lon: float
    ref_elevation_m: float
    projected_crs: str
    timezone: str
    elevation_datum: str
    extent_width_m: float
    extent_depth_m: float
    elevation_datum_m: float
    substrate_bottom_m: float
    water_reference_m: float
    chunks_x: int
    chunks_z: int
    landmarks: List[Dict[str, Any]] = field(default_factory=list)


PEORIA_SPEC = RegionSpec(
    id="peoria-il",
    name="Greater Peoria & Illinois River Valley",
    subtitle="Illinois, USA",
    west=-89.698,
    east=-89.462,
    south=40.607,
    north=40.833,
    ref_lat=40.720,
    ref_lon=-89.580,
    ref_elevation_m=155.0,
    projected_crs="EPSG:26916",
    timezone="America/Chicago",
    elevation_datum="NAVD88 (meters)",
    extent_width_m=20000.0,
    extent_depth_m=25000.0,
    elevation_datum_m=130.0,
    substrate_bottom_m=85.0,
    water_reference_m=134.1,  # Normal pool stage of Peoria Pool (~440 ft NAVD88 ≈ 134.1 m)
    chunks_x=4,
    chunks_z=5,
    landmarks=[
        {"id": "peoria", "name": "Peoria", "lon": -89.5890, "lat": 40.6936, "category": "city"},
        {"id": "west-peoria", "name": "West Peoria", "lon": -89.6220, "lat": 40.6950, "category": "city"},
        {"id": "peoria-heights", "name": "Peoria Heights", "lon": -89.5730, "lat": 40.7420, "category": "city"},
        {"id": "east-peoria", "name": "East Peoria", "lon": -89.5800, "lat": 40.6660, "category": "city"},
        {"id": "creve-coeur", "name": "Creve Coeur", "lon": -89.5960, "lat": 40.6460, "category": "city"},
        {"id": "bartonville", "name": "Bartonville", "lon": -89.6600, "lat": 40.6370, "category": "city"},
        {"id": "mossville", "name": "Mossville", "lon": -89.5700, "lat": 40.8220, "category": "city"},
        {"id": "peoria-lake", "name": "Peoria Lake", "lon": -89.5380, "lat": 40.7650, "category": "water"},
        {"id": "grandview-bluff", "name": "Grandview Drive Bluff", "lon": -89.5560, "lat": 40.7340, "category": "bluff"},
        {"id": "murray-baker", "name": "Murray Baker Bridge", "lon": -89.5858, "lat": 40.6887, "category": "landmark"},
        {"id": "mcclugage", "name": "McClugage Bridge", "lon": -89.5468, "lat": 40.7379, "category": "landmark"},
    ],
)


REGION_REGISTRY: Dict[str, RegionSpec] = {
    PEORIA_SPEC.id: PEORIA_SPEC,
}
