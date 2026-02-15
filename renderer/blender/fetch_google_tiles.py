#!/usr/bin/env python3
"""
Blender Python script to fetch Google 3D Tiles using the Blosm addon.
Downloads photorealistic 3D tiles for a specified area and exports to OBJ + textures.

Prerequisites:
    - Blender 4.3.2+ with Blosm addon installed
    - Google Maps Tiles API key (unrestricted)
    - Maps Tiles API enabled in Google Cloud Console

Usage:
    blender --background --python fetch_google_tiles.py -- config.json
"""

import bpy
import json
import sys
import os
import math

# Default configuration
DEFAULT_CONFIG = {
    "minLon": -83.026,
    "maxLon": -83.012,
    "minLat": 39.996,
    "maxLat": 40.006,
    "apiKey": None,
    "outputDir": None,
    "detailLevel": "medium",  # "low", "medium", "high"
    "exportFormat": "obj",  # "obj", "gltf", "fbx"
}

# Detail level mapping for Blosm
DETAIL_LEVELS = {
    "low": "city",
    "medium": "buildings",
    "high": "buildings_more_details",
}


def check_blosm_addon():
    """Check if Blosm addon is installed and enabled."""
    addon_name = "blosm"

    # Check if addon is in preferences
    if addon_name not in bpy.context.preferences.addons:
        # Try to enable it
        try:
            bpy.ops.preferences.addon_enable(module=addon_name)
            print(f"Enabled {addon_name} addon")
        except Exception as e:
            print(f"ERROR: Blosm addon not found or could not be enabled: {e}")
            print("\nTo install Blosm:")
            print("  1. Download from: https://prochitecture.gumroad.com/l/blosm")
            print("  2. In Blender: Edit > Preferences > Add-ons > Install")
            print("  3. Select the downloaded .zip file")
            print("  4. Enable the 'blosm' addon")
            return False

    return True


def setup_blosm_settings(api_key, bounds, detail_level):
    """Configure Blosm addon settings for Google 3D Tiles."""
    try:
        # Access Blosm preferences
        addon_prefs = bpy.context.preferences.addons.get("blosm")
        if addon_prefs and hasattr(addon_prefs, "preferences"):
            prefs = addon_prefs.preferences

            # Set API key
            if hasattr(prefs, "googleMapsApiKey"):
                prefs.googleMapsApiKey = api_key
            elif hasattr(prefs, "google3dTilesApiKey"):
                prefs.google3dTilesApiKey = api_key

            print(f"Configured Blosm with API key: {api_key[:10]}...")

        # Access scene-level Blosm properties
        scene = bpy.context.scene
        if hasattr(scene, "blosm"):
            blosm = scene.blosm

            # Set data source to Google 3D Tiles
            if hasattr(blosm, "dataType"):
                blosm.dataType = "3d_tiles"

            if hasattr(blosm, "source"):
                blosm.source = "google"

            # Set coordinates
            if hasattr(blosm, "minLon"):
                blosm.minLon = bounds["minLon"]
                blosm.maxLon = bounds["maxLon"]
                blosm.minLat = bounds["minLat"]
                blosm.maxLat = bounds["maxLat"]

            # Set detail level
            if hasattr(blosm, "lodLevel"):
                blosm.lodLevel = DETAIL_LEVELS.get(detail_level, "buildings")

            print(f"Set bounds: [{bounds['minLon']}, {bounds['minLat']}] to [{bounds['maxLon']}, {bounds['maxLat']}]")
            print(f"Detail level: {detail_level}")

        return True

    except Exception as e:
        print(f"ERROR: Failed to configure Blosm: {e}")
        return False


def import_google_tiles():
    """Trigger Blosm import of Google 3D Tiles."""
    try:
        # The Blosm operator for importing 3D tiles
        if hasattr(bpy.ops, "blosm") and hasattr(bpy.ops.blosm, "import_data"):
            bpy.ops.blosm.import_data()
            print("Import triggered successfully")
            return True
        elif hasattr(bpy.ops, "import_scene") and hasattr(bpy.ops.import_scene, "blosm"):
            bpy.ops.import_scene.blosm()
            print("Import triggered successfully")
            return True
        else:
            print("ERROR: Could not find Blosm import operator")
            print("Available blosm operators:", dir(bpy.ops.blosm) if hasattr(bpy.ops, "blosm") else "None")
            return False

    except Exception as e:
        print(f"ERROR: Import failed: {e}")
        return False


def export_scene(output_dir, export_format, base_name="google_tiles"):
    """Export the imported 3D tiles to specified format."""
    os.makedirs(output_dir, exist_ok=True)

    # Select all mesh objects
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.select_set(True)

    mesh_count = len([o for o in bpy.data.objects if o.type == 'MESH'])
    print(f"Exporting {mesh_count} mesh objects...")

    if mesh_count == 0:
        print("WARNING: No mesh objects to export")
        return None

    if export_format == "obj":
        filepath = os.path.join(output_dir, f"{base_name}.obj")
        bpy.ops.wm.obj_export(
            filepath=filepath,
            export_selected_objects=True,
            export_materials=True,
            export_uv=True,
            export_normals=True,
        )
        print(f"Exported OBJ: {filepath}")

    elif export_format == "gltf":
        filepath = os.path.join(output_dir, f"{base_name}.glb")
        bpy.ops.export_scene.gltf(
            filepath=filepath,
            use_selection=True,
            export_format='GLB',
            export_materials='EXPORT',
            export_texcoords=True,
        )
        print(f"Exported glTF: {filepath}")

    elif export_format == "fbx":
        filepath = os.path.join(output_dir, f"{base_name}.fbx")
        bpy.ops.export_scene.fbx(
            filepath=filepath,
            use_selection=True,
            embed_textures=True,
        )
        print(f"Exported FBX: {filepath}")

    # Also export textures separately
    export_textures(output_dir)

    return filepath


def export_textures(output_dir):
    """Unpack and save all textures to output directory."""
    textures_dir = os.path.join(output_dir, "textures")
    os.makedirs(textures_dir, exist_ok=True)

    # Unpack all images
    texture_count = 0
    for image in bpy.data.images:
        if image.packed_file:
            try:
                # Set filepath and unpack
                image.filepath_raw = os.path.join(textures_dir, image.name)
                image.save()
                texture_count += 1
            except Exception as e:
                print(f"Warning: Could not save texture {image.name}: {e}")

    # Also try the built-in unpack
    try:
        bpy.ops.file.unpack_all(method='WRITE_LOCAL')
    except:
        pass

    print(f"Exported {texture_count} textures to: {textures_dir}")


def write_metadata(output_dir, config, stats):
    """Write metadata about the imported tiles."""
    metadata = {
        "source": "Google Photorealistic 3D Tiles",
        "bounds": {
            "minLon": config["minLon"],
            "maxLon": config["maxLon"],
            "minLat": config["minLat"],
            "maxLat": config["maxLat"],
        },
        "detailLevel": config["detailLevel"],
        "exportFormat": config["exportFormat"],
        "stats": stats,
        "attribution": "Map data ©2024 Google",
    }

    metadata_path = os.path.join(output_dir, "google-tiles-metadata.json")
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"Metadata written: {metadata_path}")


def get_scene_stats():
    """Get statistics about the imported scene."""
    mesh_count = 0
    vertex_count = 0
    face_count = 0

    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            mesh_count += 1
            vertex_count += len(obj.data.vertices)
            face_count += len(obj.data.polygons)

    return {
        "meshCount": mesh_count,
        "vertexCount": vertex_count,
        "faceCount": face_count,
        "textureCount": len(bpy.data.images),
        "materialCount": len(bpy.data.materials),
    }


def clear_scene():
    """Remove all objects from scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def main():
    """Main entry point."""
    print("=" * 60)
    print("Google 3D Tiles Fetcher (Blosm)")
    print("=" * 60)

    # Parse arguments
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1:]
    else:
        args = []

    # Load config
    if len(args) < 1:
        print("Usage: blender --background --python fetch_google_tiles.py -- config.json")
        sys.exit(1)

    config_path = args[0]
    print(f"Loading config: {config_path}")

    with open(config_path, 'r') as f:
        config = {**DEFAULT_CONFIG, **json.load(f)}

    # Validate required fields
    if not config.get("apiKey"):
        print("ERROR: apiKey is required in config")
        print("Get a free API key at: https://console.cloud.google.com/")
        sys.exit(1)

    if not config.get("outputDir"):
        print("ERROR: outputDir is required in config")
        sys.exit(1)

    # Check Blosm addon
    print("\nChecking Blosm addon...")
    if not check_blosm_addon():
        sys.exit(1)

    # Clear scene
    print("\nClearing scene...")
    clear_scene()

    # Configure Blosm
    print("\nConfiguring Blosm...")
    bounds = {
        "minLon": config["minLon"],
        "maxLon": config["maxLon"],
        "minLat": config["minLat"],
        "maxLat": config["maxLat"],
    }

    if not setup_blosm_settings(config["apiKey"], bounds, config["detailLevel"]):
        sys.exit(1)

    # Import tiles
    print("\nImporting Google 3D Tiles...")
    print("This may take several minutes depending on area size and detail level...")

    if not import_google_tiles():
        print("\n" + "=" * 60)
        print("MANUAL IMPORT REQUIRED")
        print("=" * 60)
        print("\nBlosm automated import is not available in background mode.")
        print("Please follow these steps manually:")
        print("\n1. Open Blender (GUI mode)")
        print("2. Press N to open the sidebar, find the Blosm panel")
        print("3. Select '3D Tiles' from the dropdown")
        print("4. Set Source to 'Google'")
        print(f"5. Enter coordinates:")
        print(f"   Min: {bounds['minLon']}, {bounds['minLat']}")
        print(f"   Max: {bounds['maxLon']}, {bounds['maxLat']}")
        print("6. Click 'Import'")
        print(f"7. Export to: {config['outputDir']}")
        print("=" * 60)

        # Save a Blender file with settings pre-configured for manual import
        blend_path = os.path.join(config["outputDir"], "google_tiles_import.blend")
        os.makedirs(config["outputDir"], exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
        print(f"\nSaved Blender file for manual import: {blend_path}")

        sys.exit(0)

    # Get stats
    stats = get_scene_stats()
    print(f"\nImport complete!")
    print(f"  Meshes: {stats['meshCount']}")
    print(f"  Vertices: {stats['vertexCount']:,}")
    print(f"  Faces: {stats['faceCount']:,}")
    print(f"  Textures: {stats['textureCount']}")

    # Export
    print(f"\nExporting to {config['exportFormat'].upper()}...")
    export_scene(config["outputDir"], config["exportFormat"])

    # Write metadata
    write_metadata(config["outputDir"], config, stats)

    print("\nDONE!")


if __name__ == "__main__":
    main()
