import math
import httpx
from typing import Optional
from models import FireData, DangerZone, AlertLevel
import os

FIRMS_API_KEY = os.getenv("FIRMS_API_KEY", "")
FIRMS_AREA_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
SENSORS = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "MODIS_NRT"]


def calculate_distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)

    a = (math.sin(delta_lat / 2) ** 2 +
         math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lng / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def km_to_degrees(km: float, latitude: float) -> tuple[float, float]:
    lat_delta = km / 111
    lng_delta = km / (111 * math.cos(math.radians(latitude)))
    return lat_delta, lng_delta


def parse_firms_csv(csv_text: str) -> list[dict]:
    lines = csv_text.strip().split('\n')
    if len(lines) < 2:
        return []

    headers = lines[0].split(',')
    fires = []

    for line in lines[1:]:
        values = line.split(',')
        if len(values) < len(headers):
            continue

        fire = {}
        for i, header in enumerate(headers):
            value = values[i]
            if header in ['latitude', 'longitude', 'brightness', 'scan', 'track', 'bright_t31', 'frp']:
                try:
                    fire[header] = float(value)
                except ValueError:
                    fire[header] = None
            else:
                fire[header] = value
        fires.append(fire)

    return fires


def calculate_danger_radius(fire: dict) -> float:
    frp = fire.get('frp') or 0
    confidence = fire.get('confidence', 'nominal')

    if frp > 500:
        base_radius = 5.0
    elif frp > 100:
        base_radius = 3.0
    elif frp > 50:
        base_radius = 2.0
    elif frp > 10:
        base_radius = 1.5
    else:
        base_radius = 1.0

    if confidence == 'high' or (isinstance(confidence, int) and confidence > 80):
        base_radius *= 1.2
    elif confidence == 'low' or (isinstance(confidence, int) and confidence < 30):
        base_radius *= 0.8

    return base_radius


async def fetch_fires(
    latitude: float,
    longitude: float,
    radius_km: float = 50,
    days: int = 1,
) -> list[FireData]:
    if not FIRMS_API_KEY:
        raise ValueError("FIRMS_API_KEY not configured")

    lat_delta, lng_delta = km_to_degrees(radius_km, latitude)
    bbox = f"{longitude - lng_delta:.4f},{latitude - lat_delta:.4f},{longitude + lng_delta:.4f},{latitude + lat_delta:.4f}"

    all_fires: list[FireData] = []
    seen: set[str] = set()

    async with httpx.AsyncClient(timeout=30.0) as client:
        for sensor in SENSORS:
            try:
                url = f"{FIRMS_AREA_URL}/{FIRMS_API_KEY}/{sensor}/{bbox}/{days}"
                response = await client.get(url)

                if response.status_code != 200:
                    continue

                csv_text = response.text
                if "Invalid MAP_KEY" in csv_text or "Error" in csv_text:
                    continue

                raw_fires = parse_firms_csv(csv_text)

                for fire in raw_fires:
                    if fire.get('latitude') is None or fire.get('longitude') is None:
                        continue

                    key = f"{fire['latitude']:.4f},{fire['longitude']:.4f},{fire.get('acq_date')}"
                    if key in seen:
                        continue
                    seen.add(key)

                    distance = calculate_distance_km(
                        latitude, longitude,
                        fire['latitude'], fire['longitude']
                    )

                    if distance <= radius_km:
                        danger_radius = calculate_danger_radius(fire)
                        all_fires.append(FireData(
                            latitude=fire['latitude'],
                            longitude=fire['longitude'],
                            brightness=fire.get('brightness'),
                            acq_date=fire.get('acq_date'),
                            acq_time=fire.get('acq_time'),
                            satellite=fire.get('satellite'),
                            confidence=fire.get('confidence'),
                            frp=fire.get('frp'),
                            distance_km=round(distance, 2),
                            danger_radius_km=danger_radius,
                        ))

            except Exception as e:
                print(f"Error fetching from {sensor}: {e}")
                continue

    all_fires.sort(key=lambda f: f.distance_km or float('inf'))
    return all_fires


def create_danger_zones(fires: list[FireData], buffer_multiplier: float = 1.5) -> list[DangerZone]:
    danger_zones = []

    for i, fire in enumerate(fires):
        radius = (fire.danger_radius_km or 1.0) * buffer_multiplier

        if fire.distance_km and fire.distance_km <= 5:
            risk = AlertLevel.CRITICAL
        elif fire.distance_km and fire.distance_km <= 10:
            risk = AlertLevel.HIGH
        elif fire.distance_km and fire.distance_km <= 25:
            risk = AlertLevel.MEDIUM
        else:
            risk = AlertLevel.LOW

        danger_zones.append(DangerZone(
            center_lat=fire.latitude,
            center_lng=fire.longitude,
            radius_km=radius,
            fire_id=f"fire_{i}",
            risk_level=risk,
        ))

    return danger_zones


def determine_alert_level(closest_km: Optional[float], fire_count: int) -> AlertLevel:
    if closest_km is None or fire_count == 0:
        return AlertLevel.NONE
    if closest_km <= 5:
        return AlertLevel.CRITICAL
    elif closest_km <= 10:
        return AlertLevel.HIGH
    elif closest_km <= 25:
        return AlertLevel.MEDIUM
    elif closest_km <= 50:
        return AlertLevel.LOW
    return AlertLevel.NONE


def is_point_in_danger_zone(lat: float, lng: float, danger_zones: list[DangerZone]) -> bool:
    for zone in danger_zones:
        distance = calculate_distance_km(lat, lng, zone.center_lat, zone.center_lng)
        if distance <= zone.radius_km:
            return True
    return False


REGION_BBOXES = {
    "USA": "-125,24,-66,49",
    "CANADA": "-141,41,-52,84",
    "USA_CANADA": "-141,24,-52,84",
}


async def fetch_fires_by_country(
    country_code: str = "USA_CANADA",
    days: int = 1,
    limit: int = 100,
    ref_latitude: Optional[float] = None,
    ref_longitude: Optional[float] = None,
) -> list[dict]:
    if not FIRMS_API_KEY:
        raise ValueError("FIRMS_API_KEY not configured")

    bbox = REGION_BBOXES.get(country_code.upper(), REGION_BBOXES["USA_CANADA"])

    all_fires = []
    seen = set()

    async with httpx.AsyncClient(timeout=60.0) as client:
        for sensor in SENSORS:
            try:
                url = f"{FIRMS_AREA_URL}/{FIRMS_API_KEY}/{sensor}/{bbox}/{days}"
                response = await client.get(url)

                if response.status_code != 200:
                    continue

                csv_text = response.text
                if "Invalid MAP_KEY" in csv_text or "Error" in csv_text:
                    continue

                raw_fires = parse_firms_csv(csv_text)

                for fire in raw_fires:
                    if fire.get('latitude') is None or fire.get('longitude') is None:
                        continue

                    key = f"{fire['latitude']:.4f},{fire['longitude']:.4f}"
                    if key in seen:
                        continue
                    seen.add(key)

                    fire_entry = {
                        "latitude": fire['latitude'],
                        "longitude": fire['longitude'],
                        "brightness": fire.get('brightness'),
                        "acq_date": fire.get('acq_date'),
                        "acq_time": fire.get('acq_time'),
                        "confidence": fire.get('confidence'),
                        "frp": fire.get('frp'),
                    }

                    if ref_latitude is not None and ref_longitude is not None:
                        fire_entry["distance_km"] = round(calculate_distance_km(
                            ref_latitude, ref_longitude,
                            fire['latitude'], fire['longitude']
                        ), 2)

                    all_fires.append(fire_entry)

            except Exception as e:
                print(f"Error fetching from {sensor}: {e}")
                continue

    if ref_latitude is not None and ref_longitude is not None:
        all_fires.sort(key=lambda f: f.get("distance_km", float('inf')))

    return all_fires[:limit]
