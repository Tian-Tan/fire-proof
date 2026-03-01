import httpx
import math
from typing import Optional
from models import DangerZone, SafeRoute, RouteStep, Coordinate
import os

ORS_API_KEY = os.getenv("ORS_API_KEY", "")
ORS_BASE_URL = "https://api.openrouteservice.org/v2"


def create_avoid_polygon(danger_zone: DangerZone, num_points: int = 16) -> list[list[float]]:
    center_lat = danger_zone.center_lat
    center_lng = danger_zone.center_lng
    radius_km = danger_zone.radius_km

    lat_radius = radius_km / 111
    lng_radius = radius_km / (111 * math.cos(math.radians(center_lat)))

    points = []
    for i in range(num_points):
        angle = 2 * math.pi * i / num_points
        lat = center_lat + lat_radius * math.sin(angle)
        lng = center_lng + lng_radius * math.cos(angle)
        points.append([lng, lat])

    points.append(points[0])
    return points


def create_avoid_polygons(danger_zones: list[DangerZone]) -> dict:
    if not danger_zones:
        return None

    polygons = []
    for zone in danger_zones:
        polygon = create_avoid_polygon(zone)
        polygons.append([polygon])

    return {
        "type": "MultiPolygon",
        "coordinates": polygons,
    }


def decode_polyline(encoded: str, precision: int = 5) -> list[tuple[float, float]]:
    coordinates = []
    index = 0
    lat = 0
    lng = 0

    while index < len(encoded):
        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break

        dlat = ~(result >> 1) if result & 1 else result >> 1
        lat += dlat

        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break

        dlng = ~(result >> 1) if result & 1 else result >> 1
        lng += dlng

        coordinates.append((lat / (10 ** precision), lng / (10 ** precision)))

    return coordinates


async def get_route(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    danger_zones: Optional[list[DangerZone]] = None,
    profile: str = "driving-car",
) -> Optional[SafeRoute]:
    if not ORS_API_KEY:
        raise ValueError("ORS_API_KEY not configured")

    url = f"{ORS_BASE_URL}/directions/{profile}"

    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
    }

    body = {
        "coordinates": [
            [origin_lng, origin_lat],
            [dest_lng, dest_lat],
        ],
        "instructions": True,
        "geometry": True,
    }

    if danger_zones:
        avoid_polygons = create_avoid_polygons(danger_zones)
        if avoid_polygons:
            body["options"] = {
                "avoid_polygons": avoid_polygons,
            }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=body, headers=headers)

            if response.status_code == 404:
                return None

            if response.status_code != 200:
                error_msg = response.json().get('error', {}).get('message', response.text)
                raise Exception(f"ORS API error: {error_msg}")

            data = response.json()

    except httpx.TimeoutException:
        raise Exception("Routing service timeout")
    except httpx.RequestError as e:
        raise Exception(f"Failed to reach routing service: {e}")

    routes = data.get('routes', [])
    if not routes:
        return None

    route = routes[0]
    summary = route.get('summary', {})
    geometry = route.get('geometry', '')

    steps = []
    segments = route.get('segments', [])
    for segment in segments:
        for step in segment.get('steps', []):
            way_points = step.get('way_points', [0, 0])
            decoded = decode_polyline(geometry)
            step_index = min(way_points[0], len(decoded) - 1)
            step_lat, step_lng = decoded[step_index]

            steps.append(RouteStep(
                instruction=step.get('instruction', ''),
                distance_m=step.get('distance', 0),
                duration_s=step.get('duration', 0),
                latitude=step_lat,
                longitude=step_lng,
            ))

    danger_zones_nearby = []
    warnings = []

    if danger_zones:
        decoded_route = decode_polyline(geometry)
        for zone in danger_zones:
            for lat, lng in decoded_route:
                dist = _haversine(lat, lng, zone.center_lat, zone.center_lng)
                if dist < zone.radius_km * 2:
                    if zone not in danger_zones_nearby:
                        danger_zones_nearby.append(zone)
                        warnings.append(f"Route passes within {dist:.1f}km of active fire")
                    break

    return SafeRoute(
        origin=Coordinate(latitude=origin_lat, longitude=origin_lng),
        destination=Coordinate(latitude=dest_lat, longitude=dest_lng),
        distance_km=round(summary.get('distance', 0) / 1000, 2),
        duration_minutes=round(summary.get('duration', 0) / 60, 1),
        geometry=geometry,
        steps=steps,
        avoids_fire_zones=len(danger_zones_nearby) == 0,
        danger_zones_nearby=danger_zones_nearby,
        warnings=warnings,
    )


async def get_route_to_nearest_safe_place(
    origin_lat: float,
    origin_lng: float,
    destinations: list[dict],
    danger_zones: Optional[list[DangerZone]] = None,
    profile: str = "driving-car",
) -> Optional[tuple[SafeRoute, dict]]:
    best_route = None
    best_destination = None
    best_duration = float('inf')

    for dest in destinations:
        try:
            route = await get_route(
                origin_lat, origin_lng,
                dest['lat'], dest['lng'],
                danger_zones=danger_zones,
                profile=profile,
            )

            if route and route.avoids_fire_zones:
                if route.duration_minutes < best_duration:
                    best_route = route
                    best_destination = dest
                    best_duration = route.duration_minutes

        except Exception as e:
            print(f"Error getting route to {dest.get('name', 'unknown')}: {e}")
            continue

    if best_route is None:
        for dest in destinations:
            try:
                route = await get_route(
                    origin_lat, origin_lng,
                    dest['lat'], dest['lng'],
                    danger_zones=None,
                    profile=profile,
                )

                if route and route.duration_minutes < best_duration:
                    best_route = route
                    best_destination = dest
                    best_duration = route.duration_minutes
                    route.warnings.append("WARNING: This route may pass through or near fire zones")
                    route.avoids_fire_zones = False

            except Exception:
                continue

    if best_route and best_destination:
        best_route.destination_name = best_destination.get('name')
        return best_route, best_destination

    return None


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)

    a = (math.sin(delta_lat / 2) ** 2 +
         math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lng / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c
