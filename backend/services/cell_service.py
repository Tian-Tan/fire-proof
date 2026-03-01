import httpx
import math
from typing import Optional
from models import CellTower, DangerZone
from services.fire_service import calculate_distance_km, is_point_in_danger_zone
import os

OPENCELLID_API_KEY = os.getenv("OPENCELLID_API_KEY", "")
OPENCELLID_API_URL = "https://opencellid.org/cell/getInArea"


async def fetch_cell_towers_opencellid(
    latitude: float,
    longitude: float,
    radius_km: float = 10,
) -> list[CellTower]:
    if not OPENCELLID_API_KEY:
        return []

    lat_delta = radius_km / 111
    lng_delta = radius_km / (111 * math.cos(math.radians(latitude)))

    params = {
        "key": OPENCELLID_API_KEY,
        "BBOX": f"{latitude - lat_delta},{longitude - lng_delta},{latitude + lat_delta},{longitude + lng_delta}",
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(OPENCELLID_API_URL, params=params)

            if response.status_code != 200:
                return []

            data = response.json()

        towers = []
        for cell in data.get('cells', []):
            towers.append(CellTower(
                latitude=cell.get('lat'),
                longitude=cell.get('lon'),
                mcc=cell.get('mcc', 0),
                mnc=cell.get('mnc', 0),
                lac=cell.get('lac', 0),
                cell_id=cell.get('cellid', 0),
                radio=cell.get('radio', 'unknown'),
                range_m=cell.get('range'),
                is_operational=True,
            ))

        return towers

    except Exception as e:
        print(f"Error fetching cell towers: {e}")
        return []


def estimate_cell_coverage(
    towers: list[CellTower],
    latitude: float,
    longitude: float,
) -> dict:
    if not towers:
        return {
            "has_coverage": False,
            "quality": "unknown",
            "tower_count": 0,
            "closest_tower_m": None,
        }

    tower_distances = []
    for tower in towers:
        if tower.is_operational:
            distance = calculate_distance_km(
                latitude, longitude,
                tower.latitude, tower.longitude
            ) * 1000

            tower_distances.append({
                "tower": tower,
                "distance_m": distance,
            })

    if not tower_distances:
        return {
            "has_coverage": False,
            "quality": "no_service",
            "tower_count": 0,
            "closest_tower_m": None,
        }

    tower_distances.sort(key=lambda x: x['distance_m'])
    closest_distance = tower_distances[0]['distance_m']

    towers_in_range = sum(
        1 for t in tower_distances
        if t['distance_m'] < 5000
    )

    if closest_distance < 500 and towers_in_range >= 3:
        quality = "excellent"
    elif closest_distance < 1000 and towers_in_range >= 2:
        quality = "good"
    elif closest_distance < 2000:
        quality = "fair"
    elif closest_distance < 5000:
        quality = "poor"
    else:
        quality = "no_service"

    return {
        "has_coverage": quality not in ["no_service", "unknown"],
        "quality": quality,
        "tower_count": towers_in_range,
        "closest_tower_m": round(closest_distance),
    }


def mark_towers_in_fire_zones(
    towers: list[CellTower],
    danger_zones: list[DangerZone],
) -> list[CellTower]:
    for tower in towers:
        if is_point_in_danger_zone(tower.latitude, tower.longitude, danger_zones):
            tower.is_operational = False

    return towers


async def check_route_coverage(
    route_points: list[tuple[float, float]],
    towers: list[CellTower],
    sample_interval: int = 5,
) -> dict:
    if not route_points:
        return {
            "coverage_percentage": 0,
            "has_coverage_throughout": False,
            "dead_zones": [],
        }

    sampled_points = route_points[::sample_interval]
    covered_count = 0
    dead_zones = []
    in_dead_zone = False
    dead_zone_start = None

    for i, (lat, lng) in enumerate(sampled_points):
        coverage = estimate_cell_coverage(towers, lat, lng)

        if coverage['has_coverage']:
            covered_count += 1
            if in_dead_zone and dead_zone_start is not None:
                dead_zones.append({
                    "start": dead_zone_start,
                    "end": (lat, lng),
                })
                in_dead_zone = False
                dead_zone_start = None
        else:
            if not in_dead_zone:
                in_dead_zone = True
                dead_zone_start = (lat, lng)

    if in_dead_zone and dead_zone_start is not None and sampled_points:
        dead_zones.append({
            "start": dead_zone_start,
            "end": sampled_points[-1],
        })

    coverage_percentage = (covered_count / len(sampled_points)) * 100 if sampled_points else 0

    return {
        "coverage_percentage": round(coverage_percentage, 1),
        "has_coverage_throughout": coverage_percentage >= 95,
        "dead_zones": dead_zones,
    }


def estimate_coverage_simple(
    latitude: float,
    longitude: float,
    danger_zones: list[DangerZone],
) -> dict:
    in_danger = is_point_in_danger_zone(latitude, longitude, danger_zones)

    if in_danger:
        return {
            "has_coverage": False,
            "quality": "likely_degraded",
            "reason": "Location is in fire danger zone",
            "tower_count": None,
            "closest_tower_m": None,
        }

    return {
        "has_coverage": True,
        "quality": "assumed_available",
        "reason": "Location is outside fire zones",
        "tower_count": None,
        "closest_tower_m": None,
    }
