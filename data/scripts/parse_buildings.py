#!/usr/bin/env python3
"""
Parse downloaded OSM data and convert to GeoJSON for the renderer.

This script:
1. Reads the downloaded OSM JSON files
2. Reconstructs polygon geometries from node references
3. Estimates building heights from tags or defaults
4. Exports to GeoJSON format suitable for Three.js consumption
"""

import json
from pathlib import Path
from typing import Any, Optional, List, Dict

# Directory setup
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

# Default building height in meters (3 stories * 3.5m)
DEFAULT_HEIGHT = 10.5

# OSU landmark buildings with known heights (approximate)
OSU_LANDMARKS = {
    "Ohio Stadium": {"height": 30, "type": "stadium"},
    "Thompson Library": {"height": 25, "type": "library"},
    "Ohio Union": {"height": 20, "type": "civic"},
    "Wexner Center": {"height": 18, "type": "cultural"},
    "Morrill Tower": {"height": 70, "type": "residential"},
    "Lincoln Tower": {"height": 70, "type": "residential"},
    "St. John Arena": {"height": 25, "type": "stadium"},
    "Mershon Auditorium": {"height": 20, "type": "cultural"},
    "Knowlton Hall": {"height": 20, "type": "university"},
    "Fisher College of Business": {"height": 20, "type": "university"},
}


def parse_osm_json(filepath: Path) -> dict:
    """Load OSM JSON and index nodes for geometry reconstruction."""
    with open(filepath) as f:
        data = json.load(f)

    # Index nodes by ID for quick lookup
    nodes = {}
    ways = []
    relations = []

    for element in data.get("elements", []):
        if element["type"] == "node":
            nodes[element["id"]] = (element["lon"], element["lat"])
        elif element["type"] == "way":
            ways.append(element)
        elif element["type"] == "relation":
            relations.append(element)

    return {"nodes": nodes, "ways": ways, "relations": relations}


def way_to_polygon(way: dict, nodes: dict) -> Optional[list]:
    """Convert an OSM way to a polygon coordinate list."""
    coords = []
    for node_id in way.get("nodes", []):
        if node_id in nodes:
            coords.append(nodes[node_id])
        else:
            return None  # Missing node, skip this way

    if len(coords) < 3:
        return None

    return coords


def estimate_height(tags: dict, name: Optional[str] = None) -> float:
    """Estimate building height from OSM tags."""
    # Check for known landmarks
    if name:
        for landmark, info in OSU_LANDMARKS.items():
            if landmark.lower() in name.lower():
                return info["height"]

    # Try height tag (in meters)
    if "height" in tags:
        try:
            h = tags["height"]
            if isinstance(h, str):
                h = h.replace("m", "").replace("'", "").strip()
            return float(h)
        except (ValueError, TypeError):
            pass

    # Try building:levels tag
    if "building:levels" in tags:
        try:
            levels = int(tags["building:levels"])
            return levels * 3.5  # Assume 3.5m per floor
        except (ValueError, TypeError):
            pass

    # Estimate by building type
    building_type = tags.get("building", "yes")
    type_heights = {
        "university": 15,
        "school": 12,
        "college": 15,
        "dormitory": 25,
        "residential": 12,
        "apartments": 20,
        "stadium": 30,
        "church": 18,
        "chapel": 12,
        "hospital": 25,
        "commercial": 12,
        "retail": 8,
        "industrial": 10,
        "warehouse": 8,
        "garage": 6,
        "parking": 15,
        "house": 8,
        "detached": 8,
        "terrace": 9,
    }

    return type_heights.get(building_type, DEFAULT_HEIGHT)


def get_building_type(tags: dict, name: Optional[str] = None) -> str:
    """Determine building type for coloring."""
    # Check for known landmarks
    if name:
        for landmark, info in OSU_LANDMARKS.items():
            if landmark.lower() in name.lower():
                return info["type"]

    # Check amenity tag
    amenity = tags.get("amenity", "")
    if amenity in ["university", "college", "school"]:
        return "university"
    if amenity in ["library"]:
        return "library"
    if amenity in ["hospital", "clinic"]:
        return "hospital"
    if amenity in ["theatre", "cinema", "arts_centre"]:
        return "cultural"

    # Check building tag
    building = tags.get("building", "yes")
    if building in ["university", "college", "school"]:
        return "university"
    if building in ["dormitory", "residential", "apartments"]:
        return "residential"
    if building in ["stadium"]:
        return "stadium"
    if building in ["church", "chapel"]:
        return "religious"
    if building in ["commercial", "retail", "office"]:
        return "commercial"
    if building in ["industrial", "warehouse"]:
        return "industrial"

    return "default"


def process_buildings() -> List[Dict[str, Any]]:
    """Process OSM buildings into GeoJSON features."""
    osm_path = RAW_DIR / "osm_buildings.json"
    if not osm_path.exists():
        print(f"Error: {osm_path} not found. Run download_data.py first.")
        return []

    print(f"Processing {osm_path}...")
    data = parse_osm_json(osm_path)

    features = []
    for way in data["ways"]:
        tags = way.get("tags", {})
        if "building" not in tags:
            continue

        coords = way_to_polygon(way, data["nodes"])
        if not coords:
            continue

        name = tags.get("name")
        height = estimate_height(tags, name)
        building_type = get_building_type(tags, name)

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
            "properties": {
                "id": way["id"],
                "name": name,
                "height": height,
                "building_type": building_type,
                "osm_tags": tags,
            },
        }
        features.append(feature)

    # Also process stadiums from landuse data
    landuse_path = RAW_DIR / "osm_landuse.json"
    if landuse_path.exists():
        print(f"Adding stadiums from {landuse_path}...")
        landuse_data = parse_osm_json(landuse_path)

        for way in landuse_data["ways"]:
            tags = way.get("tags", {})
            leisure = tags.get("leisure", "")

            # Include stadiums as 3D buildings
            if leisure == "stadium":
                coords = way_to_polygon(way, landuse_data["nodes"])
                if not coords:
                    continue

                name = tags.get("name")
                # Use known heights for OSU stadiums
                height = 40  # Default stadium height
                if name:
                    for landmark, info in OSU_LANDMARKS.items():
                        if landmark.lower() in name.lower():
                            height = info["height"]
                            break
                    # Ohio Stadium is very tall
                    if "ohio stadium" in name.lower():
                        height = 45
                    elif "st. john" in name.lower() or "saint john" in name.lower():
                        height = 30

                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [coords],
                    },
                    "properties": {
                        "id": way["id"],
                        "name": name,
                        "height": height,
                        "building_type": "stadium",
                        "osm_tags": tags,
                    },
                }
                features.append(feature)
                print(f"  Added stadium: {name} (height={height}m)")

    return features


def process_roads() -> List[Dict[str, Any]]:
    """Process OSM roads into GeoJSON features."""
    osm_path = RAW_DIR / "osm_roads.json"
    if not osm_path.exists():
        print(f"Warning: {osm_path} not found, skipping roads.")
        return []

    print(f"Processing {osm_path}...")
    data = parse_osm_json(osm_path)

    features = []
    for way in data["ways"]:
        tags = way.get("tags", {})
        if "highway" not in tags:
            continue

        coords = []
        for node_id in way.get("nodes", []):
            if node_id in data["nodes"]:
                coords.append(data["nodes"][node_id])

        if len(coords) < 2:
            continue

        highway_type = tags.get("highway", "road")
        width = {
            "motorway": 12,
            "trunk": 10,
            "primary": 9,
            "secondary": 8,
            "tertiary": 7,
            "residential": 6,
            "service": 4,
            "footway": 2,
            "path": 1.5,
            "cycleway": 2,
            "pedestrian": 4,
        }.get(highway_type, 5)

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coords,
            },
            "properties": {
                "id": way["id"],
                "name": tags.get("name"),
                "highway_type": highway_type,
                "width": width,
            },
        }
        features.append(feature)

    return features


def process_landuse() -> List[Dict[str, Any]]:
    """Process OSM landuse into GeoJSON features."""
    osm_path = RAW_DIR / "osm_landuse.json"
    if not osm_path.exists():
        print(f"Warning: {osm_path} not found, skipping landuse.")
        return []

    print(f"Processing {osm_path}...")
    data = parse_osm_json(osm_path)

    features = []
    for way in data["ways"]:
        tags = way.get("tags", {})

        coords = way_to_polygon(way, data["nodes"])
        if not coords:
            continue

        landuse_type = (
            tags.get("landuse")
            or tags.get("leisure")
            or tags.get("natural")
            or "unknown"
        )

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords],
            },
            "properties": {
                "id": way["id"],
                "name": tags.get("name"),
                "landuse_type": landuse_type,
            },
        }
        features.append(feature)

    return features


def main():
    print("=" * 60)
    print("Parsing OSU Campus Data")
    print("=" * 60)

    # Process each data type
    buildings = process_buildings()
    roads = process_roads()
    landuse = process_landuse()

    # Create combined GeoJSON
    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "OpenStreetMap",
            "area": "OSU Campus, Columbus, Ohio",
        },
        "features": [],
    }

    # Add features with layer property
    for f in landuse:
        f["properties"]["layer"] = "landuse"
        geojson["features"].append(f)

    for f in roads:
        f["properties"]["layer"] = "road"
        geojson["features"].append(f)

    for f in buildings:
        f["properties"]["layer"] = "building"
        geojson["features"].append(f)

    # Write output
    output_path = PROCESSED_DIR / "osu-campus.geojson"
    with open(output_path, "w") as f:
        json.dump(geojson, f, indent=2)

    print()
    print(f"Output written to {output_path}")
    print(f"  Buildings: {len(buildings)}")
    print(f"  Roads: {len(roads)}")
    print(f"  Landuse areas: {len(landuse)}")
    print(f"  Total features: {len(geojson['features'])}")

    # Also write buildings-only file for the renderer
    buildings_geojson = {
        "type": "FeatureCollection",
        "features": buildings,
    }
    buildings_path = PROCESSED_DIR / "osu-buildings.geojson"
    with open(buildings_path, "w") as f:
        json.dump(buildings_geojson, f, indent=2)
    print(f"  Buildings-only: {buildings_path}")


if __name__ == "__main__":
    main()
