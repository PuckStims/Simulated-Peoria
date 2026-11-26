# Data Sources, Provenance, and Licensing Manifest

| Dataset / Service | Kind | Scope / Resolution | CRS / Datum | License & Attribution |
|---|---|---|---|---|
| **USGS 3D Elevation Program (3DEP)** | Measured | `20 × 25 km` Greater Peoria & Illinois River Valley bare-earth DEM (`20 m` export resampled to `25 m` balanced / `100 m` overview) | `EPSG:26916` (NAD83 / UTM 16N), `NAVD88` meters | Public Domain (U.S. Geological Survey) |
| **OpenStreetMap (Overpass API)** | Measured footprints & polylines; missing heights inferred | Water bodies, waterways, roads, railways, bridges, building footprints, landcover within regional bounds | `EPSG:4326` projected to `EPSG:26916` | ODbL 1.0 (`© OpenStreetMap contributors`) |
| **Open-Meteo Forecast API** | Modeled atmospheric output | Point sample at `(40.720°N, -89.580°W)`, 15-minute live refresh | WGS84 | CC BY 4.0 (`Weather data by Open-Meteo.com`) |
| **Astronomy Engine (`astronomy-engine@2.1.19`)** | Ephemeris calculation | Solar & lunar altitude/azimuth, phase, rise/set, civil twilight, GMST | Topocentric observer | MIT License |
| **Synthetic Verification Fixture (`test-fixture`)** | Fixture | `8 × 10 km` deterministic synthetic river valley for automated CI/unit testing | `EPSG:26916`, synthetic NAVD88 | MIT License (Project Microcosm) |
