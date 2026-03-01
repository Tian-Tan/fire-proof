import httpx
from typing import Optional
from models import SafePlace, SafePlaceType, DangerZone
from services.fire_service import calculate_distance_km, is_point_in_danger_zone

OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

SAFE_PLACE_QUERIES = {
    SafePlaceType.HOSPITAL: 'nwr["amenity"="hospital"]',
    SafePlaceType.FIRE_STATION: 'nwr["amenity"="fire_station"]',
    SafePlaceType.POLICE: 'nwr["amenity"="police"]',
    SafePlaceType.SHELTER: 'nwr["amenity"="shelter"]',
    SafePlaceType.SCHOOL: 'nwr["amenity"="school"]',
    SafePlaceType.COMMUNITY_CENTER: 'nwr["amenity"="community_centre"]',
    SafePlaceType.STADIUM: 'nwr["leisure"="stadium"]',
}


def build_overpass_query(
    latitude: float,
    longitude: float,
    radius_m: int,
    place_types: list[SafePlaceType]
) -> str:
    queries = []
    for place_type in place_types:
        if place_type in SAFE_PLACE_QUERIES:
            queries.append(f'{SAFE_PLACE_QUERIES[place_type]}(around:{radius_m},{latitude},{longitude});')

    query = f"""
    [out:json][timeout:25];
    (
        {chr(10).join(queries)}
    );
    out center;
    """
    return query


def parse_osm_element(element: dict, place_type: SafePlaceType) -> Optional[dict]:
    if element.get('type') == 'node':
        lat = element.get('lat')
        lng = element.get('lon')
    else:
        center = element.get('center', {})
        lat = center.get('lat')
        lng = center.get('lon')

    if lat is None or lng is None:
        return None

    tags = element.get('tags', {})

    return {
        'id': f"{element.get('type')}_{element.get('id')}",
        'name': tags.get('name'),
        'place_type': place_type,
        'latitude': lat,
        'longitude': lng,
        'address': _build_address(tags),
        'phone': tags.get('phone') or tags.get('contact:phone'),
    }


def _build_address(tags: dict) -> Optional[str]:
    parts = []
    if tags.get('addr:housenumber'):
        parts.append(tags['addr:housenumber'])
    if tags.get('addr:street'):
        parts.append(tags['addr:street'])
    if tags.get('addr:city'):
        parts.append(tags['addr:city'])

    return ', '.join(parts) if parts else None


async def fetch_safe_places(
    latitude: float,
    longitude: float,
    radius_km: float = 20,
    place_types: Optional[list[SafePlaceType]] = None,
    danger_zones: Optional[list[DangerZone]] = None,
    limit: int = 20,
) -> list[SafePlace]:
    if place_types is None:
        place_types = list(SafePlaceType)

    if danger_zones is None:
        danger_zones = []

    radius_m = int(radius_km * 1000)
    query = build_overpass_query(latitude, longitude, radius_m, place_types)

    data = None
    last_error = None

    async with httpx.AsyncClient(timeout=45.0) as client:
        for server_url in OVERPASS_SERVERS:
            try:
                response = await client.post(
                    server_url,
                    data={"data": query},
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )

                if response.status_code == 200:
                    data = response.json()
                    break
                else:
                    last_error = f"Server {server_url} returned {response.status_code}"
            except httpx.TimeoutException:
                last_error = f"Server {server_url} timed out"
                continue
            except Exception as e:
                last_error = f"Server {server_url} error: {e}"
                continue

    if data is None:
        raise Exception(f"All Overpass servers failed. Last error: {last_error}")

    safe_places = []
    elements = data.get('elements', [])

    for element in elements:
        tags = element.get('tags', {})
        place_type = _determine_place_type(tags)
        if place_type is None:
            continue

        parsed = parse_osm_element(element, place_type)
        if parsed is None:
            continue

        distance = calculate_distance_km(
            latitude, longitude,
            parsed['latitude'], parsed['longitude']
        )

        is_in_danger = is_point_in_danger_zone(
            parsed['latitude'],
            parsed['longitude'],
            danger_zones
        )

        safe_places.append(SafePlace(
            id=parsed['id'],
            name=parsed['name'],
            place_type=parsed['place_type'],
            latitude=parsed['latitude'],
            longitude=parsed['longitude'],
            distance_km=round(distance, 2),
            address=parsed['address'],
            phone=parsed['phone'],
            is_in_danger_zone=is_in_danger,
            has_cell_coverage=True,
        ))

    safe_places.sort(key=lambda p: (p.is_in_danger_zone, p.distance_km))
    return safe_places[:limit]


def _determine_place_type(tags: dict) -> Optional[SafePlaceType]:
    amenity = tags.get('amenity')
    leisure = tags.get('leisure')

    if amenity == 'hospital':
        return SafePlaceType.HOSPITAL
    elif amenity == 'fire_station':
        return SafePlaceType.FIRE_STATION
    elif amenity == 'police':
        return SafePlaceType.POLICE
    elif amenity == 'shelter':
        return SafePlaceType.SHELTER
    elif amenity == 'school':
        return SafePlaceType.SCHOOL
    elif amenity == 'community_centre':
        return SafePlaceType.COMMUNITY_CENTER
    elif leisure == 'stadium':
        return SafePlaceType.STADIUM

    return None


async def search_place_by_name(
    query: str,
    latitude: float,
    longitude: float,
    radius_km: float = 50,
) -> list[SafePlace]:
    nominatim_url = "https://nominatim.openstreetmap.org/search"

    params = {
        "q": query,
        "format": "json",
        "limit": 10,
        "viewbox": f"{longitude - 0.5},{latitude + 0.5},{longitude + 0.5},{latitude - 0.5}",
        "bounded": 1,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            nominatim_url,
            params=params,
            headers={"User-Agent": "FireProof-App/1.0"}
        )

        if response.status_code != 200:
            return []

        results = response.json()

    places = []
    for result in results:
        lat = float(result.get('lat', 0))
        lng = float(result.get('lon', 0))
        distance = calculate_distance_km(latitude, longitude, lat, lng)

        if distance > radius_km:
            continue

        places.append(SafePlace(
            id=f"nominatim_{result.get('place_id')}",
            name=result.get('display_name', '').split(',')[0],
            place_type=SafePlaceType.SHELTER,
            latitude=lat,
            longitude=lng,
            distance_km=round(distance, 2),
            address=result.get('display_name'),
            is_in_danger_zone=False,
            has_cell_coverage=True,
        ))

    places.sort(key=lambda p: p.distance_km)
    return places
