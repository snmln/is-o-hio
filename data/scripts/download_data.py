#!/usr/bin/env python3
"""
Download building data for OSU campus area from Open City Model and OpenStreetMap.

OSU Campus approximate bounding box (WGS84):
- SW: 39.9945, -83.0300
- NE: 40.0050, -83.0100

This script downloads:
1. CityGML data from Open City Model (AWS S3)
2. Building footprints from OpenStreetMap via Overpass API
"""

import os
import json
import requests
from pathlib import Path

# OSU Campus bounding box (expanded slightly for context)
BBOX = {
    "south": 39.9900,
    "west": -83.0350,
    "north": 40.0100,
    "east": -83.0050,
}

# Directory setup
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

RAW_DIR.mkdir(exist_ok=True)
PROCESSED_DIR.mkdir(exist_ok=True)


def download_osm_buildings():
    """Download building footprints from OpenStreetMap via Overpass API."""
    print("Downloading OSM buildings...")

    # Overpass QL query for buildings in the bounding box
    query = f"""
    [out:json][timeout:60];
    (
      way["building"]({BBOX['south']},{BBOX['west']},{BBOX['north']},{BBOX['east']});
      relation["building"]({BBOX['south']},{BBOX['west']},{BBOX['north']},{BBOX['east']});
    );
    out body;
    >;
    out skel qt;
    """

    url = "https://overpass-api.de/api/interpreter"

    try:
        response = requests.post(url, data={"data": query}, timeout=120)
        response.raise_for_status()

        data = response.json()
        output_path = RAW_DIR / "osm_buildings.json"

        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

        # Count buildings
        buildings = [e for e in data.get("elements", []) if e.get("type") == "way" and "building" in e.get("tags", {})]
        print(f"  Downloaded {len(buildings)} buildings to {output_path}")
        return True

    except requests.exceptions.RequestException as e:
        print(f"  Error downloading OSM data: {e}")
        return False


def download_osm_roads():
    """Download roads from OpenStreetMap via Overpass API."""
    print("Downloading OSM roads...")

    query = f"""
    [out:json][timeout:60];
    (
      way["highway"]({BBOX['south']},{BBOX['west']},{BBOX['north']},{BBOX['east']});
    );
    out body;
    >;
    out skel qt;
    """

    url = "https://overpass-api.de/api/interpreter"

    try:
        response = requests.post(url, data={"data": query}, timeout=120)
        response.raise_for_status()

        data = response.json()
        output_path = RAW_DIR / "osm_roads.json"

        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

        roads = [e for e in data.get("elements", []) if e.get("type") == "way" and "highway" in e.get("tags", {})]
        print(f"  Downloaded {len(roads)} roads to {output_path}")
        return True

    except requests.exceptions.RequestException as e:
        print(f"  Error downloading OSM roads: {e}")
        return False


def download_osm_landuse():
    """Download parks, grass, water from OpenStreetMap."""
    print("Downloading OSM landuse...")

    query = f"""
    [out:json][timeout:60];
    (
      way["landuse"~"grass|meadow|recreation_ground"]({BBOX['south']},{BBOX['west']},{BBOX['north']},{BBOX['east']});
      way["leisure"~"park|pitch|stadium"]({BBOX['south']},{BBOX['west']},{BBOX['north']},{BBOX['east']});
      way["natural"~"water|wood"]({BBOX['south']},{BBOX['west']},{BBOX['north']},{BBOX['east']});
      relation["landuse"~"grass|meadow|recreation_ground"]({BBOX['south']},{BBOX['west']},{BBOX['north']},{BBOX['east']});
      relation["leisure"~"park|pitch|stadium"]({BBOX['south']},{BBOX['west']},{BBOX['north']},{BBOX['east']});
    );
    out body;
    >;
    out skel qt;
    """

    url = "https://overpass-api.de/api/interpreter"

    try:
        response = requests.post(url, data={"data": query}, timeout=120)
        response.raise_for_status()

        data = response.json()
        output_path = RAW_DIR / "osm_landuse.json"

        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

        print(f"  Downloaded landuse data to {output_path}")
        return True

    except requests.exceptions.RequestException as e:
        print(f"  Error downloading OSM landuse: {e}")
        return False


def create_bbox_file():
    """Save the bounding box to a file for reference."""
    bbox_path = RAW_DIR / "bbox.json"
    with open(bbox_path, "w") as f:
        json.dump(BBOX, f, indent=2)
    print(f"Saved bounding box to {bbox_path}")


def main():
    print("=" * 60)
    print("Downloading OSU Campus Data")
    print("=" * 60)
    print(f"Bounding box: {BBOX}")
    print()

    create_bbox_file()

    success = True
    success = download_osm_buildings() and success
    success = download_osm_roads() and success
    success = download_osm_landuse() and success

    print()
    if success:
        print("Download complete! Run parse_buildings.py to process the data.")
    else:
        print("Some downloads failed. Check the errors above.")


if __name__ == "__main__":
    main()
