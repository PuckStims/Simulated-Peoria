"""Offline vector acquisition and preparation from OpenStreetMap (Overpass or local cache).

Exports browser-ready, terrain-sampled, local-coordinate JSON layers:
  - hydrology.json
  - roads.json
  - railways.json
  - bridges.json
  - buildings.json
  - landcover.json
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import requests
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon, box
from shapely.ops import unary_union

from tools.geo.config import RegionSpec
from tools.geo.projection import LocalProjection
from tools.prepare_terrain import sample_grid_elevation

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

HIGHWAY_WIDTHS = {
    "motorway": 16.0,
    "motorway_link": 9.0,
    "trunk": 14.0,
    "trunk_link": 8.0,
    "primary": 12.0,
    "primary_link": 7.5,
    "secondary": 10.0,
    "tertiary": 8.0,
    "residential": 6.0,
    "unclassified": 5.5,
    "service": 4.2,
    "footway": 2.2,
    "path": 2.0,
    "cycleway": 2.6,
}

BUILDING_DEFAULT_HEIGHTS = {
    "landmark": (28.0, 8),
    "commercial": (13.5, 3),
    "industrial": (11.0, 2),
    "civic": (15.0, 3),
    "residential": (7.2, 2),
}


def fetch_overpass_layer(
    layer_name: str,
    query: str,
    cache_dir: Path,
    timeout_s: int = 90,
) -> Dict[str, Any]:
    """Fetch an Overpass JSON response with local caching and multi-mirror backoff."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{layer_name}.osm.json"
    if cache_file.exists() and cache_file.stat().st_size > 200:
        return json.loads(cache_file.read_text(encoding="utf-8"))

    last_err: Optional[Exception] = None
    for attempt in range(len(OVERPASS_ENDPOINTS) * 2):
        endpoint = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        try:
            resp = requests.post(
                endpoint,
                data={"data": query},
                headers={
                    "User-Agent": "MicrocosmGeoPipeline/0.1 (Illinois River Valley diorama)",
                    "Accept": "application/json",
                },
                timeout=timeout_s,
            )
            if resp.status_code == 200:
                data = resp.json()
                if "elements" in data:
                    cache_file.write_text(json.dumps(data), encoding="utf-8")
                    return data
            last_err = RuntimeError(f"HTTP {resp.status_code} from {endpoint}: {resp.text[:160]}")
        except Exception as exc:  # noqa: BLE001
            last_err = exc
        time.sleep(min(8.0, 1.5 * (attempt + 1)))

    raise RuntimeError(f"Failed to fetch Overpass layer '{layer_name}': {last_err}")


def _bbox_str(spec: RegionSpec, pad_deg: float = 0.008) -> str:
    return (
        f"{spec.south - pad_deg:.5f},"
        f"{spec.west - pad_deg:.5f},"
        f"{spec.north + pad_deg:.5f},"
        f"{spec.east + pad_deg:.5f}"
    )


def build_overpass_queries(spec: RegionSpec) -> Dict[str, str]:
    bb = _bbox_str(spec)
    return {
        "hydrology": f"""
[out:json][timeout:90];
(
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  way["waterway"~"^(river|stream|canal)$"]({bb});
  way["natural"="wetland"]({bb});
  relation["natural"="wetland"]({bb});
);
out geom;
""".strip(),
        "roads": f"""
[out:json][timeout:90];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|tertiary|residential|unclassified|footway|path|cycleway)$"]({bb});
  way["railway"~"^(rail|light_rail)$"]({bb});
);
out geom;
""".strip(),
        "buildings": f"""
[out:json][timeout:120];
(
  way["building"]({bb});
  relation["building"]({bb});
);
out geom;
""".strip(),
        "landcover": f"""
[out:json][timeout:90];
(
  way["landuse"~"^(forest|farmland|meadow|grass|residential|commercial|industrial|retail|recreation_ground)$"]({bb});
  relation["landuse"~"^(forest|farmland|meadow|grass|residential|commercial|industrial|retail|recreation_ground)$"]({bb});
  way["natural"~"^(wood|grassland|scrub|wetland)$"]({bb});
  relation["natural"~"^(wood|grassland|scrub|wetland)$"]({bb});
  way["leisure"~"^(park|nature_reserve|golf_course)$"]({bb});
  relation["leisure"~"^(park|nature_reserve|golf_course)$"]({bb});
);
out geom;
""".strip(),
    }


def _project_ring(
    coords: Sequence[Dict[str, float]],
    projection: LocalProjection,
) -> List[Tuple[float, float]]:
    out: List[Tuple[float, float]] = []
    for pt in coords:
        x, z = projection.lonlat_to_local(float(pt["lon"]), float(pt["lat"]))
        out.append((round(x, 2), round(z, 2)))
    return out


def _extract_polygons_from_element(
    el: Dict[str, Any],
    projection: LocalProjection,
    clip_box: Polygon,
    simplify_m: float = 1.5,
) -> List[Polygon]:
    polys: List[Polygon] = []
    el_type = el.get("type")
    if el_type == "way" and el.get("geometry"):
        ring = _project_ring(el["geometry"], projection)
        if len(ring) >= 4:
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            poly = Polygon(ring)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if not poly.is_empty:
                polys.append(poly)
    elif el_type == "relation" and el.get("members"):
        outers: List[List[Tuple[float, float]]] = []
        inners: List[List[Tuple[float, float]]] = []
        for member in el["members"]:
            geom = member.get("geometry")
            if not geom or len(geom) < 3:
                continue
            pts = _project_ring(geom, projection)
            if member.get("role") == "inner":
                inners.append(pts)
            else:
                outers.append(pts)
        # Stitch outer rings if closed or nearly closed
        outer_polys: List[Polygon] = []
        for ring in outers:
            if len(ring) >= 4:
                if ring[0] != ring[-1]:
                    ring.append(ring[0])
                p = Polygon(ring)
                if not p.is_valid:
                    p = p.buffer(0)
                if not p.is_empty:
                    outer_polys.append(p)
        if outer_polys:
            merged = unary_union(outer_polys)
            if inners:
                inner_polys = []
                for ring in inners:
                    if len(ring) >= 4:
                        if ring[0] != ring[-1]:
                            ring.append(ring[0])
                        ip = Polygon(ring)
                        if ip.is_valid and not ip.is_empty:
                            inner_polys.append(ip)
                if inner_polys:
                    merged = merged.difference(unary_union(inner_polys))
            if isinstance(merged, Polygon):
                polys.append(merged)
            elif isinstance(merged, MultiPolygon):
                polys.extend(list(merged.geoms))

    clipped: List[Polygon] = []
    for p in polys:
        inter = p.intersection(clip_box)
        if inter.is_empty:
            continue
        if isinstance(inter, Polygon):
            s = inter.simplify(simplify_m, preserve_topology=True)
            if not s.is_empty and s.area > 4.0:
                clipped.append(s)
        elif isinstance(inter, MultiPolygon):
            for g in inter.geoms:
                s = g.simplify(simplify_m, preserve_topology=True)
                if not s.is_empty and s.area > 4.0:
                    clipped.append(s)
    return clipped


def _extract_lines_from_element(
    el: Dict[str, Any],
    projection: LocalProjection,
    clip_box: Polygon,
    simplify_m: float = 1.5,
) -> List[LineString]:
    geom = el.get("geometry")
    if not geom or len(geom) < 2:
        return []
    pts = _project_ring(geom, projection)
    line = LineString(pts)
    inter = line.intersection(clip_box)
    if inter.is_empty:
        return []
    lines: List[LineString] = []
    if isinstance(inter, LineString):
        s = inter.simplify(simplify_m, preserve_topology=True)
        if s.length > 2.0:
            lines.append(s)
    elif isinstance(inter, MultiLineString):
        for g in inter.geoms:
            s = g.simplify(simplify_m, preserve_topology=True)
            if s.length > 2.0:
                lines.append(s)
    return lines


def _ring_coords(ring: Any) -> List[List[float]]:
    return [[round(float(x), 2), round(float(z), 2)] for x, z in list(ring.coords)[:-1]]


def _parse_height_meters(tags: Dict[str, str]) -> Tuple[Optional[float], Optional[int]]:
    h: Optional[float] = None
    lv: Optional[int] = None
    if "height" in tags:
        raw = tags["height"].strip().lower().replace("m", "").strip()
        try:
            h = float(raw)
        except ValueError:
            h = None
    if "building:levels" in tags:
        try:
            lv = max(1, int(float(tags["building:levels"])))
        except ValueError:
            lv = None
    return h, lv


def _classify_building(tags: Dict[str, str]) -> str:
    b = tags.get("building", "yes").lower()
    if tags.get("landmark") or tags.get("tourism") in {"museum", "attraction"} or b in {"cathedral", "church", "civic", "stadium"}:
        return "civic"
    if b in {"industrial", "warehouse", "factory", "manufacture", "hangar"}:
        return "industrial"
    if b in {"commercial", "retail", "office", "hotel", "supermarket", "hospital"} or "shop" in tags:
        return "commercial"
    if b in {"school", "university", "public", "government", "train_station"} or tags.get("amenity") in {"school", "hospital", "university", "townhall"}:
        return "civic"
    return "residential"


def _classify_landcover(tags: Dict[str, str]) -> Optional[str]:
    nat = tags.get("natural", "")
    lu = tags.get("landuse", "")
    leis = tags.get("leisure", "")
    if nat == "wetland":
        return "wetland"
    if nat == "wood" or lu == "forest":
        return "deciduous"
    if lu in {"farmland", "farm"}:
        return "agriculture"
    if lu in {"meadow", "grass"} or nat in {"grassland", "scrub"}:
        return "grassland"
    if leis in {"park", "nature_reserve", "golf_course"} or lu == "recreation_ground":
        return "park"
    if lu in {"industrial"}:
        return "industrial"
    if lu in {"commercial", "retail"}:
        return "commercial"
    if lu in {"residential"}:
        return "residential"
    return None


def _parse_waterway_width_meters(tags: Dict[str, str]) -> Tuple[float, bool]:
    """Return an OSM width when usable, otherwise an explicit visual inference."""
    for key in ("width", "est_width"):
        raw = tags.get(key, "").lower().replace("meters", "").replace("meter", "").replace("m", "").strip()
        try:
            width = float(raw)
            if 1.0 <= width <= 2000.0:
                return width, key == "est_width"
        except ValueError:
            pass

    # The Illinois River is a mapped centerline in the initial region but often
    # lacks a width tag. Keep its source geometry and label the 320m display width
    # as inferred rather than pretending it is an observed bank-to-bank measure.
    if tags.get("name") == "Illinois River":
        return 320.0, True
    kind = tags.get("waterway", "")
    return (28.0 if kind == "river" else (12.0 if kind == "canal" else 5.0)), True


def prepare_vectors_from_osm(
    osm_layers: Dict[str, Dict[str, Any]],
    spec: RegionSpec,
    projection: LocalProjection,
    terrain_grid: np.ndarray,
    output_dir: Path,
    source_note: str = "OpenStreetMap Overpass API",
    max_buildings: int = 24000,
) -> Dict[str, Any]:
    """Process OSM layers into clipped, terrain-anchored JSON files."""
    output_dir.mkdir(parents=True, exist_ok=True)
    half_w = spec.extent_width_m * 0.5
    half_d = spec.extent_depth_m * 0.5
    clip_box = box(-half_w, -half_d, half_w, half_d)

    def elev_at(x: float, z: float) -> float:
        return sample_grid_elevation(terrain_grid, spec.extent_width_m, spec.extent_depth_m, x, z)

    provenance_base = {
        "source": source_note,
        "license": "ODbL 1.0 (© OpenStreetMap contributors)",
        "processedAtUtc": datetime.now(timezone.utc).isoformat(),
    }

    # 1. Hydrology
    water_bodies: List[Dict[str, Any]] = []
    waterways: List[Dict[str, Any]] = []
    for el in osm_layers.get("hydrology", {}).get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name", "")
        if tags.get("natural") == "wetland":
            for idx, poly in enumerate(_extract_polygons_from_element(el, projection, clip_box, simplify_m=3.0)):
                cx, cz = poly.representative_point().x, poly.representative_point().y
                water_bodies.append({
                    "id": f"wet-{el['id']}-{idx}",
                    "name": name,
                    "kind": "wetland",
                    "elevationMeters": round(elev_at(cx, cz) + 0.08, 2),
                    "outer": _ring_coords(poly.exterior),
                    "holes": [_ring_coords(r) for r in poly.interiors],
                })
        elif tags.get("natural") == "water":
            wkind = tags.get("water", "lake")
            if wkind not in {"river", "lake", "pond", "reservoir"}:
                wkind = "lake"
            if wkind == "reservoir":
                wkind = "lake"
            for idx, poly in enumerate(_extract_polygons_from_element(el, projection, clip_box, simplify_m=2.5)):
                cx, cz = poly.representative_point().x, poly.representative_point().y
                # A static normal-pool constant can disagree with the acquired DEM by
                # more than a metre, which buries the rendered river under its real
                # terrain. Derive the display surface from the measured DEM instead.
                # This is an inference, not a gauge observation, so it is labeled.
                local_e = elev_at(cx, cz)
                water_elev = local_e + 0.12
                water_bodies.append({
                    "id": f"wb-{el['id']}-{idx}",
                    "name": name,
                    "kind": wkind,
                    "elevationMeters": round(water_elev, 2),
                    "elevationEstimated": True,
                    "outer": _ring_coords(poly.exterior),
                    "holes": [_ring_coords(r) for r in poly.interiors],
                })
        elif tags.get("waterway"):
            ww_kind = tags["waterway"]
            width_m, width_estimated = _parse_waterway_width_meters(tags)
            for idx, line in enumerate(_extract_lines_from_element(el, projection, clip_box, simplify_m=3.0)):
                pts = [
                    [round(x, 2), round(elev_at(x, z) + 0.15, 2), round(z, 2)]
                    for x, z in line.coords
                ]
                waterways.append({
                    "id": f"ww-{el['id']}-{idx}",
                    "name": name,
                    "kind": ww_kind if ww_kind in {"river", "stream", "canal"} else "stream",
                    "widthMeters": width_m,
                    "widthEstimated": width_estimated,
                    "points": pts,
                })

    (output_dir / "hydrology.json").write_text(
        json.dumps({"provenance": provenance_base, "waterBodies": water_bodies, "waterways": waterways}),
        encoding="utf-8",
    )

    # 2. Roads, Railways, and Bridges
    roads: List[Dict[str, Any]] = []
    railways: List[Dict[str, Any]] = []
    bridges: List[Dict[str, Any]] = []
    for el in osm_layers.get("roads", {}).get("elements", []):
        tags = el.get("tags", {})
        is_bridge = tags.get("bridge") in {"yes", "viaduct", "aqueduct", "movable"}
        name = tags.get("name", "")
        if "highway" in tags:
            hw = tags["highway"]
            width_m = HIGHWAY_WIDTHS.get(hw, 5.5)
            for idx, line in enumerate(_extract_lines_from_element(el, projection, clip_box, simplify_m=2.0)):
                pts2d = [[round(x, 2), round(z, 2)] for x, z in line.coords]
                if is_bridge:
                    clearance = 14.5 if hw in {"motorway", "trunk", "primary"} else 8.5
                    pts3d = _compute_bridge_profile(pts2d, elev_at, spec.water_reference_m, clearance)
                    bridges.append({
                        "id": f"br-rd-{el['id']}-{idx}",
                        "name": name or f"{hw} bridge",
                        "kind": "road",
                        "widthMeters": width_m,
                        "points": pts3d,
                    })
                else:
                    roads.append({
                        "id": f"rd-{el['id']}-{idx}",
                        "name": name,
                        "highway": hw,
                        "widthMeters": width_m,
                        "points": pts2d,
                    })
        elif "railway" in tags:
            for idx, line in enumerate(_extract_lines_from_element(el, projection, clip_box, simplify_m=2.5)):
                pts2d = [[round(x, 2), round(z, 2)] for x, z in line.coords]
                if is_bridge:
                    pts3d = _compute_bridge_profile(pts2d, elev_at, spec.water_reference_m, 9.0)
                    bridges.append({
                        "id": f"br-rl-{el['id']}-{idx}",
                        "name": name or "Railway bridge",
                        "kind": "rail",
                        "widthMeters": 4.5,
                        "points": pts3d,
                    })
                else:
                    railways.append({
                        "id": f"rl-{el['id']}-{idx}",
                        "name": name,
                        "points": pts2d,
                    })

    (output_dir / "roads.json").write_text(
        json.dumps({"provenance": provenance_base, "roads": roads}),
        encoding="utf-8",
    )
    (output_dir / "railways.json").write_text(
        json.dumps({"provenance": provenance_base, "railways": railways}),
        encoding="utf-8",
    )
    (output_dir / "bridges.json").write_text(
        json.dumps({"provenance": provenance_base, "bridges": bridges}),
        encoding="utf-8",
    )

    # 3. Buildings
    raw_buildings: List[Tuple[float, Dict[str, Any]]] = []
    for el in osm_layers.get("buildings", {}).get("elements", []):
        tags = el.get("tags", {})
        kind = _classify_building(tags)
        parsed_h, parsed_lv = _parse_height_meters(tags)
        default_h, default_lv = BUILDING_DEFAULT_HEIGHTS[kind]
        if parsed_h is not None:
            height_m = max(3.0, parsed_h)
            levels = parsed_lv or max(1, int(round(height_m / 3.4)))
            estimated = False
        elif parsed_lv is not None:
            levels = parsed_lv
            height_m = round(levels * 3.4, 2)
            estimated = True
        else:
            levels = default_lv
            # Deterministic small variation based on OSM id so neighborhoods look varied yet reproducible
            jitter = ((int(el["id"]) % 17) - 8) * 0.18
            height_m = round(max(3.5, default_h + jitter), 2)
            estimated = True

        roof_raw = tags.get("roof:shape", "").lower()
        roof_shape = roof_raw if roof_raw in {"flat", "gabled", "hipped"} else (
            "gabled" if kind == "residential" else "flat"
        )

        for idx, poly in enumerate(_extract_polygons_from_element(el, projection, clip_box, simplify_m=0.8)):
            if poly.area < 24.0:
                continue
            cx, cz = poly.centroid.x, poly.centroid.y
            base_elev = elev_at(cx, cz)
            priority_score = poly.area * (3.0 if kind in {"civic", "commercial", "landmark"} else 1.0)
            if not estimated:
                priority_score *= 2.0
            raw_buildings.append((
                priority_score,
                {
                    "id": f"bld-{el['id']}-{idx}",
                    "name": tags.get("name", ""),
                    "kind": kind,
                    "footprint": _ring_coords(poly.exterior),
                    "baseElevationMeters": round(base_elev, 2),
                    "heightMeters": round(height_m, 2),
                    "heightEstimated": estimated,
                    "levels": levels,
                    "roofShape": roof_shape,
                },
            ))

    raw_buildings.sort(key=lambda item: item[0], reverse=True)
    buildings = [item[1] for item in raw_buildings[:max_buildings]]
    (output_dir / "buildings.json").write_text(
        json.dumps({
            "provenance": {
                **provenance_base,
                "totalExtracted": len(raw_buildings),
                "exportedCount": len(buildings),
                "heightEstimationNote": "Buildings with heightEstimated=true use building:levels or deterministic class defaults.",
            },
            "buildings": buildings,
        }),
        encoding="utf-8",
    )

    # 4. Landcover
    areas: List[Dict[str, Any]] = []
    for el in osm_layers.get("landcover", {}).get("elements", []):
        tags = el.get("tags", {})
        lc_kind = _classify_landcover(tags)
        if not lc_kind:
            continue
        for idx, poly in enumerate(_extract_polygons_from_element(el, projection, clip_box, simplify_m=4.0)):
            if poly.area < 400.0:
                continue
            areas.append({
                "id": f"lc-{el['id']}-{idx}",
                "kind": lc_kind,
                "ring": _ring_coords(poly.exterior),
            })

    (output_dir / "landcover.json").write_text(
        json.dumps({"provenance": provenance_base, "areas": areas}),
        encoding="utf-8",
    )

    return {
        "waterBodies": len(water_bodies),
        "waterways": len(waterways),
        "roads": len(roads),
        "railways": len(railways),
        "bridges": len(bridges),
        "buildings": len(buildings),
        "buildingsTotalExtracted": len(raw_buildings),
        "landcoverAreas": len(areas),
    }


def _compute_bridge_profile(
    pts2d: List[List[float]],
    elev_at: Any,
    water_ref_m: float,
    clearance_m: float,
) -> List[List[float]]:
    """Compute a plausible elevated deck profile across a waterway or valley span."""
    n = len(pts2d)
    if n < 2:
        return []
    ground_elevs = [elev_at(p[0], p[1]) for p in pts2d]
    start_elev = max(ground_elevs[0], water_ref_m + 1.0)
    end_elev = max(ground_elevs[-1], water_ref_m + 1.0)
    deck_peak = max(water_ref_m + clearance_m, max(start_elev, end_elev) + 2.5)

    # Compute cumulative arc length parameter t in [0, 1]
    dists = [0.0]
    for i in range(1, n):
        dx = pts2d[i][0] - pts2d[i - 1][0]
        dz = pts2d[i][1] - pts2d[i - 1][1]
        dists.append(dists[-1] + math.hypot(dx, dz))
    total_len = max(1.0, dists[-1])

    out: List[List[float]] = []
    for i, (x, z) in enumerate(pts2d):
        t = dists[i] / total_len
        linear = start_elev * (1.0 - t) + end_elev * t
        arch = math.sin(math.pi * t) * max(0.0, deck_peak - 0.5 * (start_elev + end_elev))
        elev = max(ground_elevs[i] + 0.6, linear + arch)
        out.append([x, round(elev, 2), z])
    return out
