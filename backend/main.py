from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

from models import (
    AlertLevel,
    Coordinate,
    NavigationResponse,
    SafeRoute,
)
from services import (
    fetch_fires,
    create_danger_zones,
    determine_alert_level,
    fetch_safe_places,
    estimate_coverage_simple,
    get_route,
    get_route_to_nearest_safe_place,
)

app = FastAPI(
    title="Fire-Proof API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "status": "ok",
        "service": "Fire-Proof API",
        "version": "1.0.0",
    }


@app.get("/api/fires/check")
async def check_fire_alert(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    alert_threshold_km: float = Query(10, ge=1, le=100),
):
    try:
        fires = await fetch_fires(latitude, longitude, radius_km=alert_threshold_km + 10)
        nearby = [f for f in fires if (f.distance_km or 999) <= alert_threshold_km]
        closest_km = fires[0].distance_km if fires else None

        return {
            "is_alert": len(nearby) > 0,
            "alert_level": determine_alert_level(closest_km, len(nearby)),
            "fires_within_threshold": len(nearby),
            "closest_fire_km": closest_km,
            "threshold_km": alert_threshold_km,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/navigate", response_model=NavigationResponse)
async def get_navigation_data(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    fire_radius_km: float = Query(50, ge=10, le=200),
    safe_place_radius_km: float = Query(20, ge=5, le=50),
    include_route: bool = Query(True),
):
    warnings = []

    try:
        fires = await fetch_fires(latitude, longitude, radius_km=fire_radius_km)
        danger_zones = create_danger_zones(fires)
        closest_fire_km = fires[0].distance_km if fires else None
        alert_level = determine_alert_level(closest_fire_km, len(fires))
    except Exception as e:
        fires = []
        danger_zones = []
        closest_fire_km = None
        alert_level = AlertLevel.NONE
        warnings.append(f"Could not fetch fire data: {e}")

    if len(fires) == 0:
        return NavigationResponse(
            user_location=Coordinate(latitude=latitude, longitude=longitude),
            alert_level=AlertLevel.NONE,
            fires_detected=0,
            closest_fire_km=None,
            danger_zones=[],
            safe_places=[],
            recommended_destination=None,
            route=None,
            cell_coverage_status="normal",
            warnings=warnings,
            evacuation_recommended=False,
        )

    safe_places = []
    try:
        places = await fetch_safe_places(
            latitude, longitude,
            radius_km=safe_place_radius_km,
            danger_zones=danger_zones,
        )
        safe_places = [p for p in places if not p.is_in_danger_zone]
    except Exception as e:
        warnings.append(f"Could not fetch safe places: {e}")

    coverage = estimate_coverage_simple(latitude, longitude, danger_zones)
    cell_status = coverage.get('quality', 'unknown')
    if not coverage.get('has_coverage'):
        warnings.append("Cell coverage may be degraded in your area")

    route = None
    recommended = None

    if include_route and safe_places:
        destinations = [
            {"lat": p.latitude, "lng": p.longitude, "name": p.name, "id": p.id}
            for p in safe_places[:5]
        ]

        try:
            result = await get_route_to_nearest_safe_place(
                latitude, longitude,
                destinations,
                danger_zones=danger_zones,
            )
            if result:
                route, dest_info = result
                recommended = next((p for p in safe_places if p.id == dest_info['id']), None)
                if recommended:
                    recommended.route_distance_km = route.distance_km
                    recommended.route_duration_minutes = route.duration_minutes
        except Exception as e:
            warnings.append(f"Could not calculate route: {e}")

    return NavigationResponse(
        user_location=Coordinate(latitude=latitude, longitude=longitude),
        alert_level=alert_level,
        fires_detected=len(fires),
        closest_fire_km=closest_fire_km,
        danger_zones=danger_zones,
        safe_places=safe_places,
        recommended_destination=recommended,
        route=route,
        cell_coverage_status=cell_status,
        warnings=warnings,
        evacuation_recommended=alert_level in [AlertLevel.CRITICAL, AlertLevel.HIGH],
    )


@app.get("/api/route", response_model=SafeRoute)
async def get_safe_route(
    origin_lat: float = Query(..., ge=-90, le=90),
    origin_lng: float = Query(..., ge=-180, le=180),
    dest_lat: float = Query(..., ge=-90, le=90),
    dest_lng: float = Query(..., ge=-180, le=180),
    avoid_fires: bool = Query(True),
    profile: str = Query("driving-car"),
):
    danger_zones = []
    if avoid_fires:
        try:
            mid_lat = (origin_lat + dest_lat) / 2
            mid_lng = (origin_lng + dest_lng) / 2
            fires = await fetch_fires(mid_lat, mid_lng, radius_km=100)
            danger_zones = create_danger_zones(fires)
        except Exception:
            pass

    try:
        route = await get_route(
            origin_lat, origin_lng,
            dest_lat, dest_lng,
            danger_zones=danger_zones if avoid_fires else None,
            profile=profile,
        )

        if not route:
            raise HTTPException(
                status_code=404,
                detail="No route found. The destination may be unreachable due to fire zones."
            )

        return route

    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Routing error: {e}")
