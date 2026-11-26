"""Local meter-based coordinate projection centered on a configured region.

Three.js local axes:
  +X = True East (meters)
  -X = True West (meters)
  +Y = Elevation above vertical datum (meters)
  +Z = True South (meters)
  -Z = True North (meters)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Tuple

from pyproj import CRS, Proj, Transformer


@dataclass(frozen=True)
class LocalProjection:
    projected_crs: str
    proj4_def: str
    origin_lon: float
    origin_lat: float
    origin_easting: float
    origin_northing: float
    elevation_datum_meters: float
    meridian_convergence_deg: float
    align_true_north_to_neg_z: bool = True
    _to_proj_cache: Transformer = field(init=False, repr=False, compare=False)
    _to_wgs84_cache: Transformer = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "_to_proj_cache",
            Transformer.from_crs("EPSG:4326", self.projected_crs, always_xy=True),
        )
        object.__setattr__(
            self,
            "_to_wgs84_cache",
            Transformer.from_crs(self.projected_crs, "EPSG:4326", always_xy=True),
        )

    @classmethod
    def from_origin(
        cls,
        origin_lon: float,
        origin_lat: float,
        projected_crs: str = "EPSG:26916",
        elevation_datum_meters: float = 130.0,
        align_true_north_to_neg_z: bool = True,
    ) -> "LocalProjection":
        crs_obj = CRS.from_user_input(projected_crs)
        proj4_def = crs_obj.to_proj4() or "+proj=utm +zone=16 +datum=NAD83 +units=m +no_defs"
        transformer = Transformer.from_crs("EPSG:4326", crs_obj, always_xy=True)
        easting, northing = transformer.transform(origin_lon, origin_lat)

        # Compute exact meridian convergence (angle from grid north to true north, clockwise)
        p = Proj(crs_obj)
        factors = p.get_factors(origin_lon, origin_lat)
        # Note: pyproj meridian_convergence is positive when grid north is east of true north,
        # or let's determine exact true-north azimuth in grid space numerically to guarantee zero sign ambiguity.
        _, _ = factors.meridian_convergence, p
        dlat = 1e-4
        e_n, n_n = transformer.transform(origin_lon, origin_lat + dlat)
        de = e_n - easting
        dn = n_n - northing
        # Angle of true north clockwise from grid +Y (northing)
        true_north_cw_from_grid_deg = math.degrees(math.atan2(de, dn))

        return cls(
            projected_crs=projected_crs,
            proj4_def=proj4_def,
            origin_lon=origin_lon,
            origin_lat=origin_lat,
            origin_easting=float(easting),
            origin_northing=float(northing),
            elevation_datum_meters=float(elevation_datum_meters),
            meridian_convergence_deg=float(true_north_cw_from_grid_deg),
            align_true_north_to_neg_z=align_true_north_to_neg_z,
        )

    def _transformer_to_proj(self) -> Transformer:
        return self._to_proj_cache

    def _transformer_to_wgs84(self) -> Transformer:
        return self._to_wgs84_cache

    def lonlat_to_local(self, lon: float, lat: float) -> Tuple[float, float]:
        """Convert WGS84 (lon, lat) -> local (x_east, z_south) in meters."""
        easting, northing = self._transformer_to_proj().transform(lon, lat)
        return self.projected_to_local(easting, northing)

    def projected_to_local(self, easting: float, northing: float) -> Tuple[float, float]:
        """Convert projected (easting, northing) -> local (x_east, z_south) in meters."""
        dx_grid = easting - self.origin_easting
        dy_grid = northing - self.origin_northing
        if not self.align_true_north_to_neg_z:
            return dx_grid, -dy_grid

        # Rotate projected offset so that true-north unit vector aligns with (x=0, z=-1)
        # In grid space, true north is at angle theta = meridian_convergence_deg CW from +Y_grid:
        #   u_north_grid = (sin(theta), cos(theta))
        #   u_east_grid  = (cos(theta), -sin(theta))
        theta = math.radians(self.meridian_convergence_deg)
        c = math.cos(theta)
        s = math.sin(theta)
        x_east = dx_grid * c - dy_grid * s
        y_north = dx_grid * s + dy_grid * c
        return x_east, -y_north

    def local_to_projected(self, x_east: float, z_south: float) -> Tuple[float, float]:
        """Convert local (x_east, z_south) in meters -> projected (easting, northing)."""
        y_north = -z_south
        if not self.align_true_north_to_neg_z:
            return self.origin_easting + x_east, self.origin_northing + y_north

        theta = math.radians(self.meridian_convergence_deg)
        c = math.cos(theta)
        s = math.sin(theta)
        dx_grid = x_east * c + y_north * s
        dy_grid = -x_east * s + y_north * c
        return self.origin_easting + dx_grid, self.origin_northing + dy_grid

    def local_to_lonlat(self, x_east: float, z_south: float) -> Tuple[float, float]:
        """Convert local (x_east, z_south) in meters -> WGS84 (lon, lat)."""
        easting, northing = self.local_to_projected(x_east, z_south)
        lon, lat = self._transformer_to_wgs84().transform(easting, northing)
        return float(lon), float(lat)

    def elevation_to_y(self, elevation_meters: float) -> float:
        return elevation_meters - self.elevation_datum_meters

    def y_to_elevation(self, y_meters: float) -> float:
        return y_meters + self.elevation_datum_meters
