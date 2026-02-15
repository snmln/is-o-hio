#!/usr/bin/env python3
"""
Blender Python script for illustrated isometric tile rendering.
Renders GeoJSON building data to PNG tiles with Cycles raytracing,
Freestyle outlines, toon shading, and environment details.

Usage:
    blender --background --python render_tiles.py -- config.json
    blender --background --python render_tiles.py -- --test
"""

import bpy
import bmesh
import json
import sys
import math
import os
import random
from mathutils import Vector

# Configuration constants (must match Three.js implementation)
TILE_SIZE = 512
WORLD_TILE_SIZE = 15
CAMERA_DISTANCE = 200
HEIGHT_SCALE = 0.8

# Illustrated style settings
FREESTYLE_LINE_THICKNESS = 1.5
FREESTYLE_LINE_COLOR = (0.15, 0.12, 0.1)  # Dark brown, not pure black
TOON_SHADOW_THRESHOLD = 0.3
TOON_HIGHLIGHT_THRESHOLD = 0.7

# Color palette (RGB 0-255) - adjusted for illustrated look
COLORS = {
    "university": {
        "wall": (0xE8, 0xC0, 0x90),
        "roof": (0xA0, 0x60, 0x30),
        "window": (0x40, 0x50, 0x60),
        "window_lit": (0xFF, 0xE0, 0x90),
    },
    "library": {
        "wall": (0xF0, 0xD8, 0xB0),
        "roof": (0x78, 0x60, 0x48),
        "window": (0x45, 0x55, 0x65),
        "window_lit": (0xFF, 0xE5, 0xA0),
    },
    "stadium": {
        "wall": (0xA8, 0xA8, 0xB0),
        "roof": (0x30, 0xA0, 0x30),
        "window": (0x50, 0x50, 0x55),
        "window_lit": (0xFF, 0xD8, 0x80),
    },
    "residential": {
        "wall": (0xE8, 0xD0, 0xA8),
        "roof": (0xB8, 0x48, 0x38),
        "window": (0x3A, 0x4A, 0x5A),
        "window_lit": (0xFF, 0xE8, 0xB0),
    },
    "commercial": {
        "wall": (0xC8, 0xC8, 0xD0),
        "roof": (0x48, 0x70, 0xA8),
        "window": (0x30, 0x45, 0x60),
        "window_lit": (0xE0, 0xF0, 0xFF),
    },
    "default": {
        "wall": (0xD8, 0xC0, 0xA0),
        "roof": (0x90, 0x78, 0x60),
        "window": (0x40, 0x50, 0x60),
        "window_lit": (0xFF, 0xE0, 0x90),
    },
}

# Ground colors for grass texture
GRASS_BASE = (0x6A, 0x9A, 0x40)  # Slightly darker base
GRASS_LIGHT = (0x8C, 0xB8, 0x5A)  # Lighter patches
GRASS_DARK = (0x5A, 0x85, 0x35)  # Darker patches

# Tree colors
TREE_GREENS = [
    (0x4A, 0x80, 0x35),  # Dark forest green
    (0x5A, 0x90, 0x40),  # Medium green
    (0x6A, 0xA0, 0x4A),  # Lighter green
]
TREE_TRUNK = (0x6A, 0x4A, 0x30)  # Brown bark

BACKGROUND_COLOR = (0x7C, 0xA8, 0x4A)  # Grass green for sky/ambient


def rgb_to_linear(r, g, b):
    """Convert sRGB (0-255) to linear color space (0-1)."""
    def to_linear(c):
        c = c / 255.0
        if c <= 0.04045:
            return c / 12.92
        return ((c + 0.055) / 1.055) ** 2.4
    return (to_linear(r), to_linear(g), to_linear(b), 1.0)


def rgb_to_linear_3(r, g, b):
    """Convert sRGB (0-255) to linear color space (0-1), returns 3-tuple."""
    def to_linear(c):
        c = c / 255.0
        if c <= 0.04045:
            return c / 12.92
        return ((c + 0.055) / 1.055) ** 2.4
    return (to_linear(r), to_linear(g), to_linear(b))


# ============================================================================
# FREESTYLE OUTLINE SETUP
# ============================================================================

def setup_freestyle():
    """Enable and configure Freestyle for hand-drawn outline effect."""
    scene = bpy.context.scene
    view_layer = scene.view_layers["ViewLayer"]

    # Enable Freestyle
    scene.render.use_freestyle = True
    view_layer.use_freestyle = True

    # Get or create freestyle settings
    freestyle = view_layer.freestyle_settings

    # Clear existing linesets and create new one
    for lineset in freestyle.linesets:
        freestyle.linesets.remove(lineset)

    lineset = freestyle.linesets.new("IllustratedOutlines")

    # Configure which edges to include
    lineset.select_silhouette = True  # Object outlines
    lineset.select_border = True  # Mesh borders
    lineset.select_crease = True  # Sharp edges
    lineset.select_edge_mark = False
    lineset.select_external_contour = True
    lineset.select_material_boundary = True  # Lines between materials
    lineset.select_suggestive_contour = False
    lineset.select_ridge_valley = False

    # Configure line style
    linestyle = lineset.linestyle
    linestyle.color = FREESTYLE_LINE_COLOR
    linestyle.thickness = FREESTYLE_LINE_THICKNESS

    # Add slight thickness variation for hand-drawn feel
    linestyle.thickness_position = 'CENTER'

    # Crease angle for detecting sharp edges
    freestyle.crease_angle = math.radians(134)

    print("Freestyle outlines configured")


# ============================================================================
# SATELLITE ROOF MATERIAL
# ============================================================================

def create_satellite_roof_material(name, texture_path, imagery_bounds, scene_data):
    """
    Create a material that projects satellite imagery onto roofs based on world position.
    Uses object coordinates to map XZ position to UV coordinates within imagery bounds.
    """
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    # Load satellite texture with CLIP extension (no repeat/edge bleeding)
    tex_image = nodes.new('ShaderNodeTexImage')
    tex_image.location = (-200, 400)
    tex_image.extension = 'CLIP'  # Don't repeat, show transparent/black outside bounds
    try:
        tex_image.image = bpy.data.images.load(texture_path)
        tex_image.image.colorspace_settings.name = 'sRGB'
    except Exception as e:
        print(f"Warning: Could not load satellite texture: {e}")
        # Fallback to gray
        tex_image.image = None

    # Use Object coordinates (world XZ position)
    tex_coord = nodes.new('ShaderNodeTexCoord')
    tex_coord.location = (-800, 300)

    # Separate XYZ to get X and Z
    separate = nodes.new('ShaderNodeSeparateXYZ')
    separate.location = (-600, 300)

    # Calculate scene coordinate bounds from imagery bounds
    center_lon = scene_data["centerLon"]
    center_lat = scene_data["centerLat"]
    scale = scene_data["scale"]
    meters_per_deg_lon = 111320 * math.cos(center_lat * math.pi / 180)
    meters_per_deg_lat = 111320

    # Convert imagery bounds to scene coordinates
    # Don't swap min/max during conversion - let MapRange handle the inversion
    img_min_x = (imagery_bounds["minLon"] - center_lon) * meters_per_deg_lon * scale
    img_max_x = (imagery_bounds["maxLon"] - center_lon) * meters_per_deg_lon * scale
    img_min_z = -(imagery_bounds["minLat"] - center_lat) * meters_per_deg_lat * scale
    img_max_z = -(imagery_bounds["maxLat"] - center_lat) * meters_per_deg_lat * scale

    # Map X -> U (0-1 range based on imagery bounds) with clamping
    map_x = nodes.new('ShaderNodeMapRange')
    map_x.location = (-400, 400)
    map_x.clamp = True  # Enable clamping to prevent texture repeat
    map_x.inputs['From Min'].default_value = img_min_x
    map_x.inputs['From Max'].default_value = img_max_x
    map_x.inputs['To Min'].default_value = 0.0
    map_x.inputs['To Max'].default_value = 1.0

    # Map Z -> V (0-1 range, inverted for image coordinates) with clamping
    map_z = nodes.new('ShaderNodeMapRange')
    map_z.location = (-400, 200)
    map_z.clamp = True  # Enable clamping to prevent texture repeat
    map_z.inputs['From Min'].default_value = img_min_z
    map_z.inputs['From Max'].default_value = img_max_z
    map_z.inputs['To Min'].default_value = 1.0  # Single inversion for correct orientation
    map_z.inputs['To Max'].default_value = 0.0

    # Combine U and V to UV vector
    combine = nodes.new('ShaderNodeCombineXYZ')
    combine.location = (-200, 300)

    # Diffuse BSDF for base lighting
    diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.location = (0, 400)

    # Shader to RGB for toon effect
    shader_to_rgb = nodes.new('ShaderNodeShaderToRGB')
    shader_to_rgb.location = (200, 400)

    # ColorRamp for subtle toon shading (less dramatic than walls)
    color_ramp = nodes.new('ShaderNodeValToRGB')
    color_ramp.location = (400, 400)
    color_ramp.color_ramp.interpolation = 'CONSTANT'

    cr = color_ramp.color_ramp
    while len(cr.elements) > 2:
        cr.elements.remove(cr.elements[-1])
    # Shadow (darkens satellite texture slightly)
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.7, 0.7, 0.7, 1.0)
    # Midtone (full texture)
    mid_stop = cr.elements.new(0.25)
    mid_stop.color = (1.0, 1.0, 1.0, 1.0)
    # Highlight
    cr.elements[1].position = 0.8
    cr.elements[1].color = (1.1, 1.1, 1.1, 1.0)

    # Multiply toon shading with texture
    mix = nodes.new('ShaderNodeMixRGB')
    mix.location = (600, 400)
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Fac'].default_value = 1.0

    # Final diffuse shader with toon-shaded texture color
    final_diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    final_diffuse.location = (800, 400)

    # Output
    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (1000, 400)

    # Connect nodes
    links.new(tex_coord.outputs['Object'], separate.inputs['Vector'])
    links.new(separate.outputs['X'], map_x.inputs['Value'])
    links.new(separate.outputs['Z'], map_z.inputs['Value'])
    links.new(map_x.outputs['Result'], combine.inputs['X'])
    links.new(map_z.outputs['Result'], combine.inputs['Y'])
    links.new(combine.outputs['Vector'], tex_image.inputs['Vector'])
    links.new(tex_image.outputs['Color'], diffuse.inputs['Color'])
    links.new(diffuse.outputs['BSDF'], shader_to_rgb.inputs['Shader'])
    links.new(shader_to_rgb.outputs['Color'], color_ramp.inputs['Fac'])
    links.new(tex_image.outputs['Color'], mix.inputs['Color1'])
    links.new(color_ramp.outputs['Color'], mix.inputs['Color2'])
    links.new(mix.outputs['Color'], final_diffuse.inputs['Color'])
    links.new(final_diffuse.outputs['BSDF'], output.inputs['Surface'])

    return mat


# ============================================================================
# STREETVIEW WALL MATERIAL
# ============================================================================

def create_streetview_wall_material(name, texture_path, wall_height):
    """
    Create material from street-level image for building wall.
    Uses planar projection based on wall height.
    """
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    # Load wall texture with CLIP extension
    tex_image = nodes.new('ShaderNodeTexImage')
    tex_image.location = (-400, 300)
    tex_image.extension = 'CLIP'
    try:
        tex_image.image = bpy.data.images.load(texture_path)
        tex_image.image.colorspace_settings.name = 'sRGB'
    except Exception as e:
        print(f"Warning: Could not load streetview texture: {e}")
        tex_image.image = None

    # Use Generated UV coordinates for planar projection
    tex_coord = nodes.new('ShaderNodeTexCoord')
    tex_coord.location = (-800, 300)

    # Mapping node for scale control based on wall height
    mapping = nodes.new('ShaderNodeMapping')
    mapping.location = (-600, 300)
    # Scale UV based on wall height (assume typical building ~10m)
    scale_factor = max(1.0, wall_height / 10.0)
    mapping.inputs['Scale'].default_value = (1.0, scale_factor, 1.0)

    # Diffuse BSDF for base lighting
    diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.location = (-100, 300)

    # Shader to RGB for toon effect
    shader_to_rgb = nodes.new('ShaderNodeShaderToRGB')
    shader_to_rgb.location = (100, 300)

    # ColorRamp for subtle toon shading
    color_ramp = nodes.new('ShaderNodeValToRGB')
    color_ramp.location = (300, 300)
    color_ramp.color_ramp.interpolation = 'CONSTANT'

    cr = color_ramp.color_ramp
    while len(cr.elements) > 2:
        cr.elements.remove(cr.elements[-1])
    # Shadow (darkens texture slightly)
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.7, 0.7, 0.7, 1.0)
    # Midtone (full texture)
    mid_stop = cr.elements.new(0.3)
    mid_stop.color = (1.0, 1.0, 1.0, 1.0)
    # Highlight
    cr.elements[1].position = 0.8
    cr.elements[1].color = (1.1, 1.1, 1.1, 1.0)

    # Multiply toon shading with texture
    mix = nodes.new('ShaderNodeMixRGB')
    mix.location = (500, 300)
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Fac'].default_value = 1.0

    # Final diffuse shader
    final_diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    final_diffuse.location = (700, 300)

    # Output
    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (900, 300)

    # Connect nodes
    links.new(tex_coord.outputs['Generated'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], tex_image.inputs['Vector'])
    links.new(tex_image.outputs['Color'], diffuse.inputs['Color'])
    links.new(diffuse.outputs['BSDF'], shader_to_rgb.inputs['Shader'])
    links.new(shader_to_rgb.outputs['Color'], color_ramp.inputs['Fac'])
    links.new(tex_image.outputs['Color'], mix.inputs['Color1'])
    links.new(color_ramp.outputs['Color'], mix.inputs['Color2'])
    links.new(mix.outputs['Color'], final_diffuse.inputs['Color'])
    links.new(final_diffuse.outputs['BSDF'], output.inputs['Surface'])

    return mat


# ============================================================================
# TOON/CEL SHADER MATERIALS
# ============================================================================

def create_toon_material(name, base_color_rgb, shadow_color_rgb=None, highlight_color_rgb=None):
    """
    Create a cel-shaded material with flat color bands.
    Uses Shader to RGB + ColorRamp for toon effect.
    """
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Clear default nodes
    nodes.clear()

    # Calculate shadow and highlight colors if not provided
    base_linear = rgb_to_linear_3(*base_color_rgb)
    if shadow_color_rgb:
        shadow_linear = rgb_to_linear_3(*shadow_color_rgb)
    else:
        # Darken base color for shadow
        shadow_linear = tuple(c * 0.65 for c in base_linear)

    if highlight_color_rgb:
        highlight_linear = rgb_to_linear_3(*highlight_color_rgb)
    else:
        # Lighten base color for highlight
        highlight_linear = tuple(min(1.0, c * 1.15) for c in base_linear)

    # Create nodes
    # Diffuse BSDF for base lighting calculation
    diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.location = (-400, 300)
    diffuse.inputs['Color'].default_value = (*base_linear, 1.0)

    # Shader to RGB converts lighting to color data
    shader_to_rgb = nodes.new('ShaderNodeShaderToRGB')
    shader_to_rgb.location = (-200, 300)

    # ColorRamp for stepped toon shading (3 bands: shadow, midtone, highlight)
    color_ramp = nodes.new('ShaderNodeValToRGB')
    color_ramp.location = (0, 300)
    color_ramp.color_ramp.interpolation = 'CONSTANT'

    # Configure color stops for 3-band toon shading
    cr = color_ramp.color_ramp
    # Remove extra stops, keep 2
    while len(cr.elements) > 2:
        cr.elements.remove(cr.elements[-1])

    # Shadow band (0 to 0.3)
    cr.elements[0].position = 0.0
    cr.elements[0].color = (*shadow_linear, 1.0)

    # Midtone band (0.3 to 0.7) - add new stop
    mid_stop = cr.elements.new(TOON_SHADOW_THRESHOLD)
    mid_stop.color = (*base_linear, 1.0)

    # Highlight band (0.7 to 1.0)
    cr.elements[1].position = TOON_HIGHLIGHT_THRESHOLD
    cr.elements[1].color = (*highlight_linear, 1.0)

    # Output node
    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (300, 300)

    # Connect nodes
    links.new(diffuse.outputs['BSDF'], shader_to_rgb.inputs['Shader'])
    links.new(shader_to_rgb.outputs['Color'], color_ramp.inputs['Fac'])
    links.new(color_ramp.outputs['Color'], output.inputs['Surface'])

    return mat


def create_toon_wall_material_with_windows(name, building_type, colors):
    """
    Create a cel-shaded wall material with procedural window pattern.
    Uses Brick Texture for regular window grid.
    """
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    # Get colors
    wall_linear = rgb_to_linear_3(*colors["wall"])
    window_linear = rgb_to_linear_3(*colors["window"])
    window_lit_linear = rgb_to_linear_3(*colors.get("window_lit", colors["window"]))
    shadow_linear = tuple(c * 0.65 for c in wall_linear)
    highlight_linear = tuple(min(1.0, c * 1.15) for c in wall_linear)

    # Window parameters by building type
    window_params = {
        "university": {"scale": 4.0, "mortar": 0.85, "bias": 0.0},
        "library": {"scale": 3.5, "mortar": 0.82, "bias": 0.1},
        "commercial": {"scale": 2.5, "mortar": 0.70, "bias": -0.2},  # Large glass panels
        "residential": {"scale": 5.0, "mortar": 0.88, "bias": 0.1},  # Small windows
        "stadium": {"scale": 3.0, "mortar": 0.90, "bias": 0.2},
        "default": {"scale": 4.0, "mortar": 0.85, "bias": 0.0},
    }
    params = window_params.get(building_type, window_params["default"])

    # Texture coordinate for UV mapping
    tex_coord = nodes.new('ShaderNodeTexCoord')
    tex_coord.location = (-800, 200)

    # Mapping node for scale control
    mapping = nodes.new('ShaderNodeMapping')
    mapping.location = (-600, 200)
    mapping.inputs['Scale'].default_value = (params["scale"], params["scale"] * 1.5, 1.0)

    # Brick texture for window grid
    brick = nodes.new('ShaderNodeTexBrick')
    brick.location = (-400, 200)
    brick.inputs['Color1'].default_value = (1.0, 1.0, 1.0, 1.0)  # Window areas
    brick.inputs['Color2'].default_value = (0.0, 0.0, 0.0, 1.0)  # Wall areas
    brick.inputs['Mortar'].default_value = (0.5, 0.5, 0.5, 1.0)
    brick.inputs['Scale'].default_value = 1.0
    brick.inputs['Mortar Size'].default_value = params["mortar"]
    brick.inputs['Bias'].default_value = params["bias"]
    brick.inputs['Brick Width'].default_value = 0.5
    brick.inputs['Row Height'].default_value = 0.25

    # Mix window color with potentially lit windows (random)
    noise = nodes.new('ShaderNodeTexNoise')
    noise.location = (-400, 0)
    noise.inputs['Scale'].default_value = 10.0
    noise.inputs['Detail'].default_value = 0.0

    # Threshold for lit windows (about 15% lit)
    lit_threshold = nodes.new('ShaderNodeMath')
    lit_threshold.location = (-200, 0)
    lit_threshold.operation = 'GREATER_THAN'
    lit_threshold.inputs[1].default_value = 0.85

    # Mix between dark window and lit window
    window_color_mix = nodes.new('ShaderNodeMixRGB')
    window_color_mix.location = (-100, 100)
    window_color_mix.inputs['Color1'].default_value = (*window_linear, 1.0)
    window_color_mix.inputs['Color2'].default_value = (*window_lit_linear, 1.0)

    # Main wall/window color mix
    wall_window_mix = nodes.new('ShaderNodeMixRGB')
    wall_window_mix.location = (100, 300)
    wall_window_mix.inputs['Color1'].default_value = (*wall_linear, 1.0)  # Wall base color

    # Diffuse for toon shading
    diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.location = (300, 300)

    # Shader to RGB for toon effect
    shader_to_rgb = nodes.new('ShaderNodeShaderToRGB')
    shader_to_rgb.location = (500, 300)

    # ColorRamp for toon banding
    color_ramp = nodes.new('ShaderNodeValToRGB')
    color_ramp.location = (700, 300)
    color_ramp.color_ramp.interpolation = 'CONSTANT'

    cr = color_ramp.color_ramp
    while len(cr.elements) > 2:
        cr.elements.remove(cr.elements[-1])
    cr.elements[0].position = 0.0
    cr.elements[0].color = (*shadow_linear, 1.0)
    mid_stop = cr.elements.new(TOON_SHADOW_THRESHOLD)
    mid_stop.color = (1.0, 1.0, 1.0, 1.0)  # Will be mixed with actual color
    cr.elements[1].position = TOON_HIGHLIGHT_THRESHOLD
    cr.elements[1].color = (*highlight_linear, 1.0)

    # Multiply toon shading with base color
    final_mix = nodes.new('ShaderNodeMixRGB')
    final_mix.location = (900, 300)
    final_mix.blend_type = 'MULTIPLY'
    final_mix.inputs['Fac'].default_value = 1.0

    # Output
    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (1100, 300)

    # Connect nodes
    links.new(tex_coord.outputs['Object'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], brick.inputs['Vector'])
    links.new(mapping.outputs['Vector'], noise.inputs['Vector'])

    links.new(noise.outputs['Fac'], lit_threshold.inputs[0])
    links.new(lit_threshold.outputs['Value'], window_color_mix.inputs['Fac'])

    links.new(brick.outputs['Fac'], wall_window_mix.inputs['Fac'])
    links.new(window_color_mix.outputs['Color'], wall_window_mix.inputs['Color2'])

    links.new(wall_window_mix.outputs['Color'], diffuse.inputs['Color'])
    links.new(diffuse.outputs['BSDF'], shader_to_rgb.inputs['Shader'])
    links.new(shader_to_rgb.outputs['Color'], color_ramp.inputs['Fac'])

    links.new(wall_window_mix.outputs['Color'], final_mix.inputs['Color1'])
    links.new(color_ramp.outputs['Color'], final_mix.inputs['Color2'])
    links.new(final_mix.outputs['Color'], output.inputs['Surface'])

    return mat


# ============================================================================
# GOOGLE 3D TILES IMPORT
# ============================================================================

def import_google_tiles(config, scene_data):
    """
    Import pre-fetched Google 3D Tiles into the scene.

    Args:
        config: Dict with modelPath (glTF/OBJ), bounds, and options
        scene_data: Scene configuration with center/scale

    Returns:
        List of imported objects
    """
    model_path = config.get("modelPath")
    if not model_path or not os.path.exists(model_path):
        print(f"Warning: Google Tiles model not found: {model_path}")
        return []

    print(f"Importing Google 3D Tiles from: {model_path}")

    # Determine file type and import
    ext = os.path.splitext(model_path)[1].lower()
    imported_objects = []

    try:
        # Store existing objects to find new ones after import
        existing_objects = set(bpy.data.objects.keys())

        if ext == '.glb' or ext == '.gltf':
            bpy.ops.import_scene.gltf(filepath=model_path)
        elif ext == '.obj':
            bpy.ops.wm.obj_import(filepath=model_path)
        elif ext == '.fbx':
            bpy.ops.import_scene.fbx(filepath=model_path)
        else:
            print(f"Warning: Unsupported format: {ext}")
            return []

        # Find newly imported objects
        new_objects = [bpy.data.objects[name] for name in bpy.data.objects.keys()
                      if name not in existing_objects]
        imported_objects = [obj for obj in new_objects if obj.type == 'MESH']

        print(f"Imported {len(imported_objects)} mesh objects from Google Tiles")

        # Transform to match scene coordinates
        if imported_objects and config.get("transform", True):
            transform_google_tiles(imported_objects, config, scene_data)

        # Apply Freestyle edges for illustrated look
        if config.get("applyFreestyle", True):
            for obj in imported_objects:
                # Add edge split modifier
                edge_mod = obj.modifiers.new(name="EdgeSplit", type='EDGE_SPLIT')
                edge_mod.split_angle = math.radians(30)

                # Mark edges for Freestyle
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.mode_set(mode='EDIT')
                bpy.ops.mesh.select_all(action='SELECT')
                bpy.ops.mesh.mark_freestyle_edge(clear=False)
                bpy.ops.object.mode_set(mode='OBJECT')

    except Exception as e:
        print(f"Error importing Google Tiles: {e}")

    return imported_objects


def transform_google_tiles(objects, config, scene_data):
    """
    Transform Google Tiles to match scene coordinate system.

    Google Tiles are typically in a local coordinate system that needs
    to be aligned with our scene's lat/lon based coordinates.
    """
    # Get transformation parameters from config
    tile_bounds = config.get("bounds", {})
    offset = config.get("offset", [0, 0, 0])
    scale_factor = config.get("scale", 1.0)
    rotation = config.get("rotation", [0, 0, 0])

    # Calculate center of tile bounds in scene coordinates
    if tile_bounds:
        center_lon = scene_data["centerLon"]
        center_lat = scene_data["centerLat"]
        scale = scene_data["scale"]
        meters_per_deg_lon = 111320 * math.cos(center_lat * math.pi / 180)
        meters_per_deg_lat = 111320

        tile_center_lon = (tile_bounds.get("minLon", center_lon) +
                          tile_bounds.get("maxLon", center_lon)) / 2
        tile_center_lat = (tile_bounds.get("minLat", center_lat) +
                          tile_bounds.get("maxLat", center_lat)) / 2

        offset_x = (tile_center_lon - center_lon) * meters_per_deg_lon * scale
        offset_z = -(tile_center_lat - center_lat) * meters_per_deg_lat * scale
    else:
        offset_x, offset_z = offset[0], offset[2]

    # Apply transformation to all objects
    for obj in objects:
        # Apply rotation (convert degrees to radians if needed)
        obj.rotation_euler = (
            math.radians(rotation[0]) if rotation[0] else 0,
            math.radians(rotation[1]) if rotation[1] else 0,
            math.radians(rotation[2]) if rotation[2] else 0,
        )

        # Apply scale
        obj.scale = (scale_factor, scale_factor, scale_factor)

        # Apply offset
        obj.location = (
            obj.location.x + offset_x + offset[0],
            obj.location.y + offset[1],
            obj.location.z + offset_z + offset[2],
        )

    print(f"Transformed Google Tiles: offset=({offset_x:.1f}, 0, {offset_z:.1f}), scale={scale_factor}")


# ============================================================================
# GROUND TEXTURE
# ============================================================================

def create_illustrated_ground_material():
    """
    Create an illustrated grass texture with patchy variation.
    Uses noise and voronoi for natural look while staying flat/illustrated.
    """
    mat = bpy.data.materials.new(name="IllustratedGround")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    # Colors
    base_linear = rgb_to_linear_3(*GRASS_BASE)
    light_linear = rgb_to_linear_3(*GRASS_LIGHT)
    dark_linear = rgb_to_linear_3(*GRASS_DARK)

    # Texture coordinate
    tex_coord = nodes.new('ShaderNodeTexCoord')
    tex_coord.location = (-800, 300)

    # Mapping for scale
    mapping = nodes.new('ShaderNodeMapping')
    mapping.location = (-600, 300)
    mapping.inputs['Scale'].default_value = (0.1, 0.1, 0.1)  # Large scale for subtle patches

    # Voronoi for patchy grass areas
    voronoi = nodes.new('ShaderNodeTexVoronoi')
    voronoi.location = (-400, 400)
    voronoi.feature = 'F1'
    voronoi.inputs['Scale'].default_value = 3.0

    # Noise for additional variation
    noise = nodes.new('ShaderNodeTexNoise')
    noise.location = (-400, 200)
    noise.inputs['Scale'].default_value = 5.0
    noise.inputs['Detail'].default_value = 2.0
    noise.inputs['Roughness'].default_value = 0.5

    # Combine voronoi and noise
    combine = nodes.new('ShaderNodeMixRGB')
    combine.location = (-200, 300)
    combine.blend_type = 'OVERLAY'
    combine.inputs['Fac'].default_value = 0.5

    # ColorRamp for stepped grass colors (illustrated look)
    color_ramp = nodes.new('ShaderNodeValToRGB')
    color_ramp.location = (0, 300)
    color_ramp.color_ramp.interpolation = 'CONSTANT'

    cr = color_ramp.color_ramp
    while len(cr.elements) > 2:
        cr.elements.remove(cr.elements[-1])

    # Dark grass
    cr.elements[0].position = 0.0
    cr.elements[0].color = (*dark_linear, 1.0)

    # Base grass
    base_stop = cr.elements.new(0.35)
    base_stop.color = (*base_linear, 1.0)

    # Light grass
    cr.elements[1].position = 0.7
    cr.elements[1].color = (*light_linear, 1.0)

    # Diffuse shader
    diffuse = nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.location = (200, 300)

    # Output
    output = nodes.new('ShaderNodeOutputMaterial')
    output.location = (400, 300)

    # Connect
    links.new(tex_coord.outputs['Object'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], voronoi.inputs['Vector'])
    links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    links.new(voronoi.outputs['Distance'], combine.inputs['Color1'])
    links.new(noise.outputs['Fac'], combine.inputs['Color2'])
    links.new(combine.outputs['Color'], color_ramp.inputs['Fac'])
    links.new(color_ramp.outputs['Color'], diffuse.inputs['Color'])
    links.new(diffuse.outputs['BSDF'], output.inputs['Surface'])

    return mat


# ============================================================================
# TREE GENERATION
# ============================================================================

def create_tree_material(color_rgb):
    """Create a simple toon material for tree foliage."""
    return create_toon_material(f"TreeFoliage_{hash(color_rgb)}", color_rgb)


def create_trunk_material():
    """Create material for tree trunk."""
    return create_toon_material("TreeTrunk", TREE_TRUNK)


def create_tree(location, scale=1.0, style="cluster"):
    """
    Create a simple illustrated tree at the given location.

    Styles:
    - "cluster": Icosphere cluster canopy (fluffy)
    - "cone": Cone on cylinder (classic low-poly)
    """
    tree_collection = bpy.data.collections.get("Trees")
    if not tree_collection:
        tree_collection = bpy.data.collections.new("Trees")
        bpy.context.scene.collection.children.link(tree_collection)

    x, y, z = location
    tree_scale = scale * (0.8 + random.random() * 0.4)  # Random variation

    # Create trunk
    trunk_height = 0.8 * tree_scale
    trunk_radius = 0.15 * tree_scale

    bpy.ops.mesh.primitive_cylinder_add(
        radius=trunk_radius,
        depth=trunk_height,
        location=(x, trunk_height / 2, z)
    )
    trunk = bpy.context.active_object
    trunk.name = "TreeTrunk"

    # Move to trees collection (handle Blender 5.0+ where object may be in different collection)
    for coll in trunk.users_collection:
        coll.objects.unlink(trunk)
    tree_collection.objects.link(trunk)

    # Apply trunk material
    trunk_mat = create_trunk_material()
    trunk.data.materials.append(trunk_mat)

    # Create canopy
    canopy_objects = []
    if style == "cluster":
        # Create cluster of spheres for fluffy canopy
        canopy_base_y = trunk_height
        num_spheres = random.randint(3, 5)

        for i in range(num_spheres):
            # Random position around trunk top
            angle = random.random() * 2 * math.pi
            radius = random.random() * 0.5 * tree_scale
            sphere_x = x + radius * math.cos(angle)
            sphere_z = z + radius * math.sin(angle)
            sphere_y = canopy_base_y + random.random() * 0.8 * tree_scale

            sphere_size = (0.6 + random.random() * 0.4) * tree_scale

            bpy.ops.mesh.primitive_ico_sphere_add(
                subdivisions=1,  # Low poly
                radius=sphere_size,
                location=(sphere_x, sphere_y, sphere_z)
            )
            sphere = bpy.context.active_object
            sphere.name = f"TreeCanopy_{i}"

            # Move to trees collection
            for coll in sphere.users_collection:
                coll.objects.unlink(sphere)
            tree_collection.objects.link(sphere)

            # Random green color
            green = random.choice(TREE_GREENS)
            canopy_mat = create_tree_material(green)
            sphere.data.materials.append(canopy_mat)

            canopy_objects.append(sphere)

    else:  # cone style
        canopy_y = trunk_height + 0.5 * tree_scale
        cone_height = 2.0 * tree_scale
        cone_radius = 1.0 * tree_scale

        bpy.ops.mesh.primitive_cone_add(
            vertices=6,  # Hexagonal for low-poly look
            radius1=cone_radius,
            radius2=0,
            depth=cone_height,
            location=(x, canopy_y + cone_height / 2, z)
        )
        cone = bpy.context.active_object
        cone.name = "TreeCanopy"

        # Move to trees collection
        for coll in cone.users_collection:
            coll.objects.unlink(cone)
        tree_collection.objects.link(cone)

        green = random.choice(TREE_GREENS)
        canopy_mat = create_tree_material(green)
        cone.data.materials.append(canopy_mat)

        canopy_objects.append(cone)

    return trunk, canopy_objects


def scatter_trees(buildings_data, scene_data, ground_bounds, count=80):
    """
    Scatter trees around the scene, avoiding building footprints.

    Args:
        buildings_data: List of building dicts with coords
        scene_data: Scene configuration with center/scale
        ground_bounds: Dict with minX, maxX, minZ, maxZ
        count: Number of trees to place
    """
    print(f"Scattering {count} trees...")

    # Build list of building polygons for collision detection
    building_polys = []
    center_lon = scene_data["centerLon"]
    center_lat = scene_data["centerLat"]
    scale = scene_data["scale"]
    meters_per_deg_lon = 111320 * math.cos(center_lat * math.pi / 180)
    meters_per_deg_lat = 111320

    for b in buildings_data:
        poly = []
        for coord in b["coords"]:
            lon, lat = coord[0], coord[1]
            x = (lon - center_lon) * meters_per_deg_lon * scale
            z = -(lat - center_lat) * meters_per_deg_lat * scale
            poly.append((x, z))
        if len(poly) >= 3:
            building_polys.append(poly)

    def point_in_polygon(px, pz, polygon):
        """Ray casting algorithm for point-in-polygon test."""
        n = len(polygon)
        inside = False
        j = n - 1
        for i in range(n):
            xi, zi = polygon[i]
            xj, zj = polygon[j]
            if ((zi > pz) != (zj > pz)) and (px < (xj - xi) * (pz - zi) / (zj - zi) + xi):
                inside = not inside
            j = i
        return inside

    def is_valid_tree_location(x, z, margin=2.0):
        """Check if location is valid (not inside or too close to buildings)."""
        for poly in building_polys:
            # Check if inside polygon
            if point_in_polygon(x, z, poly):
                return False
            # Check if too close to any edge
            for i in range(len(poly)):
                x1, z1 = poly[i]
                x2, z2 = poly[(i + 1) % len(poly)]
                # Distance from point to line segment
                dx, dz = x2 - x1, z2 - z1
                length_sq = dx * dx + dz * dz
                if length_sq > 0:
                    t = max(0, min(1, ((x - x1) * dx + (z - z1) * dz) / length_sq))
                    proj_x = x1 + t * dx
                    proj_z = z1 + t * dz
                    dist_sq = (x - proj_x) ** 2 + (z - proj_z) ** 2
                    if dist_sq < margin * margin:
                        return False
        return True

    # Scatter trees
    placed = 0
    attempts = 0
    max_attempts = count * 20

    margin = 3.0  # Distance from edge of bounds
    min_x = ground_bounds["minX"] + margin
    max_x = ground_bounds["maxX"] - margin
    min_z = ground_bounds["minZ"] + margin
    max_z = ground_bounds["maxZ"] - margin

    while placed < count and attempts < max_attempts:
        attempts += 1

        # Random position
        x = min_x + random.random() * (max_x - min_x)
        z = min_z + random.random() * (max_z - min_z)

        if is_valid_tree_location(x, z):
            # Vary tree style
            style = "cluster" if random.random() > 0.3 else "cone"
            scale = 0.8 + random.random() * 0.6
            create_tree((x, 0, z), scale=scale, style=style)
            placed += 1

    print(f"Placed {placed} trees ({attempts} attempts)")


# ============================================================================
# LIGHTING FOR ILLUSTRATED STYLE
# ============================================================================

def setup_illustrated_lighting():
    """
    Setup scene lighting for illustrated style with dramatic shadows.
    Lower sun angle creates longer shadows for depth.
    Warm ambient for golden hour feel.
    """
    # Key light (sun) - lower angle for dramatic shadows
    sun_data = bpy.data.lights.new(name="Sun", type='SUN')
    sun_data.energy = 5.0
    sun_data.color = (1.0, 0.98, 0.95)  # Slightly warm
    sun_data.angle = math.radians(0.5)  # Soft shadow edge

    sun_obj = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun_obj)

    # Lower sun angle (35° elevation) for longer shadows
    # Azimuth pointing from southeast for nice shadow direction
    sun_obj.rotation_euler = (math.radians(35), 0, math.radians(-60))

    # Softer fill light
    fill_data = bpy.data.lights.new(name="Fill", type='SUN')
    fill_data.energy = 0.8
    fill_data.color = (0.9, 0.95, 1.0)  # Slightly cool for contrast

    fill_obj = bpy.data.objects.new("Fill", fill_data)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(70), 0, math.radians(135))

    # Setup world for warm ambient light (golden hour feel)
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world

    world.use_nodes = True
    nodes = world.node_tree.nodes
    bg_node = nodes.get("Background")
    if bg_node:
        # Warm sky color
        bg_node.inputs["Color"].default_value = (0.9, 0.85, 0.8, 1.0)
        bg_node.inputs["Strength"].default_value = 0.5

    print("Illustrated lighting configured")


# ============================================================================
# CYCLES RENDER SETUP
# ============================================================================

# ============================================================================
# PIXEL ART COMPOSITOR
# ============================================================================

def setup_pixel_art_compositor(pixel_scale=4, color_levels=8):
    """
    Setup Blender compositor for pixel art effect.

    Creates a node tree that:
    1. Downscales the render to create chunky pixels
    2. Applies a pixelate node to remove interpolation
    3. Posterizes colors for flat color regions
    4. Upscales back to original resolution with nearest-neighbor

    Args:
        pixel_scale: Downscale factor (4 = chunky pixels, 2 = finer)
        color_levels: Number of color bands for posterization (8 = default)
    """
    scene = bpy.context.scene
    scene.use_nodes = True
    tree = scene.node_tree
    nodes = tree.nodes
    links = tree.links

    # Clear existing compositor nodes
    nodes.clear()

    # ---- Input: Render Layers ----
    render_layers = nodes.new('CompositorNodeRLayers')
    render_layers.location = (0, 300)

    # ---- Scale Down (create chunky pixels) ----
    scale_down = nodes.new('CompositorNodeScale')
    scale_down.location = (200, 300)
    scale_down.space = 'RELATIVE'
    scale_down.inputs['X'].default_value = 1.0 / pixel_scale
    scale_down.inputs['Y'].default_value = 1.0 / pixel_scale

    # ---- Pixelate Node (removes interpolation artifacts) ----
    pixelate = nodes.new('CompositorNodePixelate')
    pixelate.location = (400, 300)

    # ---- Color Posterization via RGB Curves ----
    # This creates flat color bands for the pixel art look
    posterize_r = nodes.new('CompositorNodeMath')
    posterize_r.location = (600, 400)
    posterize_r.operation = 'MULTIPLY'
    posterize_r.inputs[1].default_value = color_levels

    round_r = nodes.new('CompositorNodeMath')
    round_r.location = (800, 400)
    round_r.operation = 'ROUND'

    divide_r = nodes.new('CompositorNodeMath')
    divide_r.location = (1000, 400)
    divide_r.operation = 'DIVIDE'
    divide_r.inputs[1].default_value = color_levels

    # Separate and combine RGB for color quantization
    separate_rgb = nodes.new('CompositorNodeSeparateColor')
    separate_rgb.location = (400, 100)
    separate_rgb.mode = 'RGB'

    # Process each channel (R, G, B)
    # Red channel
    mult_r = nodes.new('CompositorNodeMath')
    mult_r.location = (600, 200)
    mult_r.operation = 'MULTIPLY'
    mult_r.inputs[1].default_value = color_levels

    round_r = nodes.new('CompositorNodeMath')
    round_r.location = (750, 200)
    round_r.operation = 'ROUND'

    div_r = nodes.new('CompositorNodeMath')
    div_r.location = (900, 200)
    div_r.operation = 'DIVIDE'
    div_r.inputs[1].default_value = color_levels

    # Green channel
    mult_g = nodes.new('CompositorNodeMath')
    mult_g.location = (600, 50)
    mult_g.operation = 'MULTIPLY'
    mult_g.inputs[1].default_value = color_levels

    round_g = nodes.new('CompositorNodeMath')
    round_g.location = (750, 50)
    round_g.operation = 'ROUND'

    div_g = nodes.new('CompositorNodeMath')
    div_g.location = (900, 50)
    div_g.operation = 'DIVIDE'
    div_g.inputs[1].default_value = color_levels

    # Blue channel
    mult_b = nodes.new('CompositorNodeMath')
    mult_b.location = (600, -100)
    mult_b.operation = 'MULTIPLY'
    mult_b.inputs[1].default_value = color_levels

    round_b = nodes.new('CompositorNodeMath')
    round_b.location = (750, -100)
    round_b.operation = 'ROUND'

    div_b = nodes.new('CompositorNodeMath')
    div_b.location = (900, -100)
    div_b.operation = 'DIVIDE'
    div_b.inputs[1].default_value = color_levels

    # Combine channels back
    combine_rgb = nodes.new('CompositorNodeCombineColor')
    combine_rgb.location = (1100, 100)
    combine_rgb.mode = 'RGB'

    # ---- Scale Up (nearest neighbor to preserve pixels) ----
    scale_up = nodes.new('CompositorNodeScale')
    scale_up.location = (1300, 300)
    scale_up.space = 'RELATIVE'
    scale_up.inputs['X'].default_value = pixel_scale
    scale_up.inputs['Y'].default_value = pixel_scale

    # ---- Output ----
    composite = nodes.new('CompositorNodeComposite')
    composite.location = (1500, 300)

    # Optional: Viewer node for preview
    viewer = nodes.new('CompositorNodeViewer')
    viewer.location = (1500, 100)

    # ---- Connect the nodes ----
    # Main flow: Render -> Scale Down -> Pixelate
    links.new(render_layers.outputs['Image'], scale_down.inputs['Image'])
    links.new(scale_down.outputs['Image'], pixelate.inputs['Color'])

    # Split to RGB channels for posterization
    links.new(pixelate.outputs['Color'], separate_rgb.inputs['Image'])

    # Red channel posterization
    links.new(separate_rgb.outputs['Red'], mult_r.inputs[0])
    links.new(mult_r.outputs['Value'], round_r.inputs[0])
    links.new(round_r.outputs['Value'], div_r.inputs[0])

    # Green channel posterization
    links.new(separate_rgb.outputs['Green'], mult_g.inputs[0])
    links.new(mult_g.outputs['Value'], round_g.inputs[0])
    links.new(round_g.outputs['Value'], div_g.inputs[0])

    # Blue channel posterization
    links.new(separate_rgb.outputs['Blue'], mult_b.inputs[0])
    links.new(mult_b.outputs['Value'], round_b.inputs[0])
    links.new(round_b.outputs['Value'], div_b.inputs[0])

    # Combine channels
    links.new(div_r.outputs['Value'], combine_rgb.inputs['Red'])
    links.new(div_g.outputs['Value'], combine_rgb.inputs['Green'])
    links.new(div_b.outputs['Value'], combine_rgb.inputs['Blue'])
    links.new(separate_rgb.outputs['Alpha'], combine_rgb.inputs['Alpha'])

    # Scale up and output
    links.new(combine_rgb.outputs['Image'], scale_up.inputs['Image'])
    links.new(scale_up.outputs['Image'], composite.inputs['Image'])
    links.new(scale_up.outputs['Image'], viewer.inputs['Image'])

    print(f"Pixel art compositor enabled: {pixel_scale}x pixels, {color_levels} color levels")


def setup_pixel_art_render_settings():
    """
    Configure render settings optimized for pixel-perfect output.
    Disables anti-aliasing and other effects that blur pixels.
    """
    scene = bpy.context.scene

    # Disable anti-aliasing by using minimum pixel filter
    scene.render.filter_size = 0.01  # Minimum pixel filter for crisp edges

    # Use Standard color transform for accurate colors (not Filmic which adds contrast)
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'

    # Disable effects that could blur the pixel art look
    scene.render.use_motion_blur = False

    # For Cycles: disable denoising (can blur pixels)
    if scene.render.engine == 'CYCLES':
        scene.cycles.use_denoising = False

    # For EEVEE: disable bloom and other post-effects
    try:
        scene.eevee.use_bloom = False
        scene.eevee.use_ssr = False  # Screen space reflections
        scene.eevee.use_motion_blur = False
    except AttributeError:
        pass  # EEVEE settings may vary by version

    print("Pixel art render settings configured (no AA, no blur effects)")


def setup_cycles_rendering(samples=128):
    """
    Configure Cycles rendering for quality illustrated output.
    Uses GPU acceleration if available.
    """
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'

    # Cycles settings
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True

    # Try to set denoiser (API varies by version)
    try:
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    except:
        pass

    # Try to enable GPU
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences

        # Try Metal (macOS), then CUDA, then OptiX
        for device_type in ['METAL', 'CUDA', 'OPTIX', 'HIP']:
            try:
                prefs.compute_device_type = device_type
                prefs.get_devices()
                # Enable all available devices
                for device in prefs.devices:
                    device.use = True
                scene.cycles.device = 'GPU'
                print(f"Cycles GPU rendering enabled ({device_type})")
                break
            except:
                continue
        else:
            scene.cycles.device = 'CPU'
            print("Cycles CPU rendering (no GPU available)")
    except Exception as e:
        print(f"GPU setup failed: {e}")
        scene.cycles.device = 'CPU'

    # Enable ambient occlusion for illustrated depth
    try:
        scene.cycles.use_fast_gi = True
        world = scene.world
        if world:
            world.light_settings.ao_factor = 0.5
    except:
        pass

    print(f"Cycles configured: {samples} samples, device: {scene.cycles.device}")


def clear_scene():
    """Remove all objects from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    # Clear orphan data
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        if block.users == 0:
            bpy.data.materials.remove(block)


def create_material(name, color_rgb, use_toon=True):
    """Create a material - toon shaded by default for illustrated look."""
    if use_toon:
        return create_toon_material(name, color_rgb)
    else:
        # Fallback to simple diffuse
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True

        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = rgb_to_linear(*color_rgb)
            bsdf.inputs["Roughness"].default_value = 0.8
            bsdf.inputs["Specular IOR Level"].default_value = 0.2

        return mat


def setup_lighting(illustrated=True):
    """Setup scene lighting - illustrated style by default."""
    if illustrated:
        setup_illustrated_lighting()
        return

    # Legacy lighting setup (for comparison)
    sun_data = bpy.data.lights.new(name="Sun", type='SUN')
    sun_data.energy = 3.0
    sun_data.color = (1.0, 1.0, 1.0)

    sun_obj = bpy.data.objects.new("Sun", sun_data)
    bpy.context.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(45), 0, math.radians(-45))

    fill_data = bpy.data.lights.new(name="Fill", type='SUN')
    fill_data.energy = 1.0
    fill_data.color = (1.0, 1.0, 1.0)

    fill_obj = bpy.data.objects.new("Fill", fill_data)
    bpy.context.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(60), 0, math.radians(135))

    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world

    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs["Color"].default_value = rgb_to_linear(*BACKGROUND_COLOR)
        bg_node.inputs["Strength"].default_value = 0.6


def create_ground_plane(size=500, illustrated=True):
    """Create a ground plane with optional illustrated grass texture."""
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, -0.01, 0))
    ground = bpy.context.active_object
    ground.name = "Ground"

    # Rotate plane to lie in XZ plane (perpendicular to Y, our up direction)
    ground.rotation_euler = (math.radians(90), 0, 0)

    if illustrated:
        mat = create_illustrated_ground_material()
    else:
        mat = create_material("GroundMaterial", BACKGROUND_COLOR, use_toon=False)
    ground.data.materials.append(mat)

    return ground


def create_building(coords, height, building_type, scene_data, use_windows=True,
                   satellite_config=None, streetview_config=None, building_id=None):
    """Create a building mesh from polygon coordinates with illustrated materials.

    Args:
        coords: List of [lon, lat] coordinate pairs
        height: Building height in meters
        building_type: Type of building (university, library, etc.)
        scene_data: Scene configuration with center/scale
        use_windows: Whether to use procedural window material
        satellite_config: Optional dict with satellite imagery config:
            - texturePath: Path to satellite.png
            - bounds: Dict with minLon, maxLon, minLat, maxLat
        streetview_config: Optional dict mapping building_id to wall textures:
            - {building_id: {"north": path, "south": path, ...}}
        building_id: Optional building ID for streetview texture lookup
    """
    colors = COLORS.get(building_type, COLORS["default"])
    scaled_height = height * scene_data["scale"] * HEIGHT_SCALE

    # Convert geo coords to scene coords
    center_lon = scene_data["centerLon"]
    center_lat = scene_data["centerLat"]
    scale = scene_data["scale"]
    meters_per_deg_lon = 111320 * math.cos(center_lat * math.pi / 180)
    meters_per_deg_lat = 111320

    # Build 2D polygon vertices (in XZ plane, Y is up)
    verts_2d = []
    for coord in coords:
        lon, lat = coord[0], coord[1]
        x = (lon - center_lon) * meters_per_deg_lon * scale
        z = -(lat - center_lat) * meters_per_deg_lat * scale
        verts_2d.append((x, z))

    if len(verts_2d) < 3:
        return None

    # Remove duplicate last vertex if it matches first (closed polygon)
    if verts_2d[0] == verts_2d[-1]:
        verts_2d = verts_2d[:-1]

    if len(verts_2d) < 3:
        return None

    # Create mesh using bmesh for proper extrusion
    mesh = bpy.data.meshes.new("Building")
    bm = bmesh.new()

    # Create bottom face vertices
    bottom_verts = [bm.verts.new((v[0], 0, v[1])) for v in verts_2d]
    bm.verts.ensure_lookup_table()

    # Create bottom face
    try:
        bottom_face = bm.faces.new(bottom_verts)
    except ValueError:
        # Face creation failed (collinear or duplicate verts)
        bm.free()
        return None

    # Extrude up
    ret = bmesh.ops.extrude_face_region(bm, geom=[bottom_face])
    extruded_verts = [v for v in ret["geom"] if isinstance(v, bmesh.types.BMVert)]

    # Move extruded verts up
    for v in extruded_verts:
        v.co.y += scaled_height

    bm.faces.ensure_lookup_table()

    # Finalize mesh
    bm.to_mesh(mesh)
    bm.free()

    mesh.update()

    # Create object
    obj = bpy.data.objects.new("Building", mesh)
    bpy.context.collection.objects.link(obj)

    # Create and assign materials (with illustrated toon shading)
    # Check for streetview wall texture first
    streetview_wall_path = None
    if streetview_config and building_id and building_id in streetview_config:
        # Use first available wall direction (prefer south/east for typical viewing angle)
        for direction in ['south', 'east', 'north', 'west']:
            if direction in streetview_config[building_id]:
                wall_info = streetview_config[building_id][direction]
                texture_path = wall_info.get('path') if isinstance(wall_info, dict) else wall_info
                if texture_path and os.path.exists(texture_path):
                    streetview_wall_path = texture_path
                    break

    if streetview_wall_path:
        # Use streetview texture for walls
        wall_mat = create_streetview_wall_material(
            f"StreetviewWall_{building_type}_{id(obj)}",
            streetview_wall_path,
            height
        )
    elif use_windows:
        # Use wall material with procedural windows
        wall_mat = create_toon_wall_material_with_windows(
            f"Wall_{building_type}_{id(obj)}",
            building_type,
            colors
        )
    else:
        wall_mat = create_toon_material(f"Wall_{building_type}", colors["wall"])

    # Roofs: use satellite imagery if available, otherwise toon shading
    if satellite_config:
        roof_mat = create_satellite_roof_material(
            f"SatelliteRoof_{building_type}_{id(obj)}",
            texture_path=satellite_config["texturePath"],
            imagery_bounds=satellite_config["bounds"],
            scene_data=scene_data
        )
    else:
        roof_mat = create_toon_material(f"Roof_{building_type}", colors["roof"])

    obj.data.materials.append(wall_mat)
    obj.data.materials.append(roof_mat)

    # Assign materials to faces (roof = top face, walls = sides)
    mesh.update()
    for poly in mesh.polygons:
        # Check if face is mostly horizontal (roof) by looking at normal
        if abs(poly.normal.y) > 0.9:
            if poly.center.y > scaled_height * 0.5:  # Top face
                poly.material_index = 1  # Roof
            else:
                poly.material_index = 0  # Bottom (not visible)
        else:
            poly.material_index = 0  # Wall

    # Add edge split for crisp edges (important for Freestyle)
    edge_mod = obj.modifiers.new(name="EdgeSplit", type='EDGE_SPLIT')
    edge_mod.split_angle = math.radians(30)

    # Mark edges for Freestyle (all sharp edges)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.mark_freestyle_edge(clear=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    return obj


def setup_camera(world_tile_size=WORLD_TILE_SIZE):
    """Create orthographic camera for isometric view."""
    cam_data = bpy.data.cameras.new("TileCamera")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = world_tile_size
    cam_data.clip_start = 0.1
    cam_data.clip_end = 1000

    cam_obj = bpy.data.objects.new("TileCamera", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Create target empty for track-to constraint
    target = bpy.data.objects.new("CameraTarget", None)
    bpy.context.collection.objects.link(target)
    target.location = (0, 0, 0)

    # Add track-to constraint to always point at target
    constraint = cam_obj.constraints.new(type='TRACK_TO')
    constraint.target = target
    constraint.track_axis = 'TRACK_NEGATIVE_Z'
    constraint.up_axis = 'UP_Y'

    # Store target reference
    cam_obj["target_name"] = target.name

    return cam_obj


def position_camera(camera, world_x, world_z):
    """Position camera for a specific tile.

    For orthographic camera with track-to constraint:
    - Move target to tile center
    - Position camera at isometric angle from target
    """
    dist = CAMERA_DISTANCE

    # Update target location
    target_name = camera.get("target_name")
    if target_name:
        target = bpy.data.objects.get(target_name)
        if target:
            target.location = (world_x, 0, world_z)

    # Position camera at isometric angle: (+X, +Y, +Z) from target
    # True isometric has camera along (1, 1, 1) direction
    camera.location = (
        world_x + dist,
        dist,
        world_z + dist
    )


def setup_render_settings(engine="EEVEE", tile_size=TILE_SIZE):
    """Configure render settings."""
    scene = bpy.context.scene

    # Select render engine
    if engine.upper() == "CYCLES":
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 64
        scene.cycles.use_denoising = True
    else:
        # Handle different Blender versions for EEVEE
        # Blender 4.2+ uses BLENDER_EEVEE_NEXT, older versions use BLENDER_EEVEE
        try:
            scene.render.engine = 'BLENDER_EEVEE_NEXT'
        except:
            scene.render.engine = 'BLENDER_EEVEE'

        # Try to set EEVEE samples (API varies by version)
        try:
            scene.eevee.taa_render_samples = 32
        except AttributeError:
            pass  # Older EEVEE API

    # Output settings
    scene.render.resolution_x = tile_size
    scene.render.resolution_y = tile_size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 15


def render_tile(camera, col, row, world_x, world_z, output_dir):
    """Render a single tile."""
    position_camera(camera, world_x, world_z)

    filename = f"tile_{col}_{row}.png"
    filepath = os.path.join(output_dir, filename)

    bpy.context.scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)

    return filename


def calculate_tile_grid(bounds, world_tile_size):
    """Calculate tile grid from scene bounds."""
    padding = world_tile_size * 0.5

    grid_min_x = bounds["minX"] - padding
    grid_max_x = bounds["maxX"] + padding
    grid_min_z = bounds["minZ"] - padding
    grid_max_z = bounds["maxZ"] + padding

    cols = math.ceil((grid_max_x - grid_min_x) / world_tile_size)
    rows = math.ceil((grid_max_z - grid_min_z) / world_tile_size)

    tiles = []
    for row in range(rows):
        for col in range(cols):
            tiles.append({
                "col": col,
                "row": row,
                "worldX": grid_min_x + (col + 0.5) * world_tile_size,
                "worldZ": grid_min_z + (row + 0.5) * world_tile_size,
            })

    return {
        "tiles": tiles,
        "cols": cols,
        "rows": rows,
        "gridBounds": {
            "minX": grid_min_x,
            "maxX": grid_max_x,
            "minZ": grid_min_z,
            "maxZ": grid_max_z,
        }
    }


def write_manifest(output_dir, tile_data, scene_bounds, tile_size, world_tile_size):
    """Write manifest.json file."""
    manifest = {
        "tileSize": tile_size,
        "worldTileSize": world_tile_size,
        "cols": tile_data["cols"],
        "rows": tile_data["rows"],
        "bounds": scene_bounds,
        "tiles": [
            {
                "col": t["col"],
                "row": t["row"],
                "filename": f"tile_{t['col']}_{t['row']}.png",
            }
            for t in tile_data["tiles"]
        ],
    }

    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)

    return manifest_path


def run_test():
    """Run a test render with illustrated style features."""
    print("Running illustrated style test render...")

    clear_scene()

    # Setup illustrated lighting and Freestyle
    setup_lighting(illustrated=True)
    setup_freestyle()

    # Create illustrated ground
    create_ground_plane(size=50, illustrated=True)

    # Create a test building with toon material and windows
    bpy.ops.mesh.primitive_cube_add(size=4, location=(0, 2, 0))
    cube = bpy.context.active_object
    cube.name = "TestBuilding"
    cube.scale = (1.5, 2, 1.5)

    # Apply edge split for Freestyle
    edge_mod = cube.modifiers.new(name="EdgeSplit", type='EDGE_SPLIT')
    edge_mod.split_angle = math.radians(30)

    # Apply toon wall material with windows
    colors = COLORS["university"]
    wall_mat = create_toon_wall_material_with_windows("TestWall", "university", colors)
    cube.data.materials.append(wall_mat)

    # Add a second building
    bpy.ops.mesh.primitive_cube_add(size=3, location=(6, 1.5, -3))
    cube2 = bpy.context.active_object
    cube2.name = "TestBuilding2"
    cube2.scale = (1.2, 1.5, 1.0)

    edge_mod2 = cube2.modifiers.new(name="EdgeSplit", type='EDGE_SPLIT')
    edge_mod2.split_angle = math.radians(30)

    colors2 = COLORS["residential"]
    wall_mat2 = create_toon_wall_material_with_windows("TestWall2", "residential", colors2)
    cube2.data.materials.append(wall_mat2)

    # Add some trees
    for i in range(5):
        x = -8 + i * 4
        z = 6 + (i % 2) * 2
        style = "cluster" if i % 2 == 0 else "cone"
        create_tree((x, 0, z), scale=0.8 + random.random() * 0.4, style=style)

    # Setup camera with track-to constraint
    camera = setup_camera(world_tile_size=25)
    position_camera(camera, 0, 0)

    # Use Cycles for quality rendering
    setup_cycles_rendering(samples=64)

    # Configure output
    scene = bpy.context.scene
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'

    # Render
    output_path = "/tmp/blender_illustrated_test.png"
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)

    print(f"Illustrated test render saved to: {output_path}")
    return True


def main():
    """Main entry point."""
    # Get arguments after '--'
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1:]
    else:
        args = []

    # Check for test mode
    if "--test" in args:
        run_test()
        return

    # Load config
    if len(args) < 1:
        print("Usage: blender --background --python render_tiles.py -- config.json")
        print("       blender --background --python render_tiles.py -- --test")
        sys.exit(1)

    config_path = args[0]

    # Check for engine flag
    engine = "EEVEE"
    if "--engine" in args:
        idx = args.index("--engine")
        if idx + 1 < len(args):
            engine = args[idx + 1].upper()

    print(f"Loading config from: {config_path}")
    with open(config_path, 'r') as f:
        config = json.load(f)

    buildings = config["buildings"]
    scene_data = config["sceneData"]
    output_dir = config["outputDir"]
    tile_size = config.get("tileSize", 512)
    world_tile_size = config.get("worldTileSize", 15)

    # Satellite imagery config (optional)
    satellite_config = config.get("satelliteConfig", None)
    if satellite_config:
        print(f"Satellite imagery enabled: {satellite_config['texturePath']}")

    # Streetview wall texture config (optional)
    streetview_config = config.get("streetviewConfig", None)
    if streetview_config:
        print(f"Streetview wall textures enabled: {len(streetview_config)} buildings")

    # Google 3D Tiles config (optional)
    google_tiles_config = config.get("googleTilesConfig", None)
    if google_tiles_config:
        print(f"Google 3D Tiles enabled: {google_tiles_config.get('modelPath', 'N/A')}")

    # Check for illustrated mode (default: true)
    illustrated = "--no-illustrated" not in args

    # Check for trees flag (default: true when illustrated)
    add_trees = illustrated and "--no-trees" not in args

    # Get tree count if specified
    tree_count = 80
    if "--trees" in args:
        idx = args.index("--trees")
        if idx + 1 < len(args):
            try:
                tree_count = int(args[idx + 1])
            except ValueError:
                pass

    # Get Cycles samples if specified
    cycles_samples = 128
    if "--samples" in args:
        idx = args.index("--samples")
        if idx + 1 < len(args):
            try:
                cycles_samples = int(args[idx + 1])
            except ValueError:
                pass

    # Check for pixel art mode
    pixel_art_enabled = "--pixel-art" in args

    # Get pixel scale if specified (default: 4)
    pixel_scale = 4
    if "--pixel-scale" in args:
        idx = args.index("--pixel-scale")
        if idx + 1 < len(args):
            try:
                pixel_scale = int(args[idx + 1])
                pixel_scale = max(1, min(16, pixel_scale))  # Clamp to reasonable range
            except ValueError:
                pass

    # Get color levels for posterization (default: 8)
    color_levels = 8
    if "--color-levels" in args:
        idx = args.index("--color-levels")
        if idx + 1 < len(args):
            try:
                color_levels = int(args[idx + 1])
                color_levels = max(2, min(32, color_levels))  # Clamp to reasonable range
            except ValueError:
                pass

    print(f"Building count: {len(buildings)}")
    print(f"Output directory: {output_dir}")
    print(f"Render engine: {engine}")
    print(f"Illustrated mode: {illustrated}")
    print(f"Add trees: {add_trees} (count: {tree_count})")
    print(f"Pixel art mode: {pixel_art_enabled}" + (f" (scale: {pixel_scale}x, colors: {color_levels})" if pixel_art_enabled else ""))

    # Setup scene
    print("Setting up scene...")
    clear_scene()
    setup_lighting(illustrated=illustrated)

    # Setup Freestyle outlines for illustrated look
    if illustrated:
        setup_freestyle()

    create_ground_plane(illustrated=illustrated)

    # Import Google 3D Tiles if available (can be used instead of or alongside OSM buildings)
    google_tiles_objects = []
    use_osm_buildings = True
    if google_tiles_config:
        google_tiles_objects = import_google_tiles(google_tiles_config, scene_data)
        # If Google Tiles loaded successfully and replaceBuildings is true, skip OSM buildings
        if google_tiles_objects and google_tiles_config.get("replaceBuildings", False):
            use_osm_buildings = False
            print(f"Using Google 3D Tiles (replacing {len(buildings)} OSM buildings)")

    # Create buildings with illustrated materials (unless replaced by Google Tiles)
    building_count = 0
    if use_osm_buildings:
        print("Creating OSM buildings...")
        for b in buildings:
            obj = create_building(
                b["coords"],
                b["height"],
                b["type"],
                scene_data,
                use_windows=illustrated,
                satellite_config=satellite_config,
                streetview_config=streetview_config,
                building_id=b.get("id")
            )
            if obj:
                building_count += 1
    else:
        building_count = len(google_tiles_objects)

    print(f"Created {building_count} building meshes")

    # Scatter trees if enabled
    if add_trees and tree_count > 0:
        scatter_trees(
            buildings,
            scene_data,
            scene_data["bounds"],
            count=tree_count
        )

    # Calculate tile grid to determine full image size
    tile_data = calculate_tile_grid(scene_data["bounds"], world_tile_size)
    cols = tile_data["cols"]
    rows = tile_data["rows"]
    grid_bounds = tile_data["gridBounds"]

    print(f"Tile grid: {cols}x{rows} tiles")

    # Calculate full scene dimensions
    full_width = cols * tile_size
    full_height = rows * tile_size
    scene_width = grid_bounds["maxX"] - grid_bounds["minX"]
    scene_height = grid_bounds["maxZ"] - grid_bounds["minZ"]

    print(f"Full image: {full_width}x{full_height} pixels")
    print(f"Scene size: {scene_width:.1f}x{scene_height:.1f} world units")

    # Calculate center of tile grid (not building bounds)
    # This ensures the camera view matches what tile-based rendering would produce
    grid_center_x = (grid_bounds["minX"] + grid_bounds["maxX"]) / 2
    grid_center_z = (grid_bounds["minZ"] + grid_bounds["maxZ"]) / 2
    center_x = grid_center_x
    center_z = grid_center_z


    # Match the tile-based rendering scale
    # ortho_scale is the vertical extent of the camera view
    # rows * world_tile_size = vertical world units that should fit in render height
    iso_scale = rows * world_tile_size  # 8 * 15 = 120 world units vertically

    print(f"Camera ortho_scale: {iso_scale:.1f}")

    # Setup camera
    cam_data = bpy.data.cameras.new("FullSceneCamera")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = iso_scale
    cam_data.clip_start = 0.1
    cam_data.clip_end = 1000

    cam_obj = bpy.data.objects.new("FullSceneCamera", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Debug: print where buildings actually are
    print(f"Scene center: ({center_x:.1f}, 0, {center_z:.1f})")
    print(f"Grid bounds: X[{grid_bounds['minX']:.1f}, {grid_bounds['maxX']:.1f}] Z[{grid_bounds['minZ']:.1f}, {grid_bounds['maxZ']:.1f}]")

    # List all mesh objects to verify buildings exist
    mesh_objects = [obj for obj in bpy.data.objects if obj.type == 'MESH' and obj.name.startswith('Building')]
    print(f"Found {len(mesh_objects)} building mesh objects")
    if mesh_objects:
        # Sample a few building vertex positions
        for i, obj in enumerate(mesh_objects[:3]):
            mesh = obj.data
            if mesh.vertices:
                # Get bounding box
                min_co = [float('inf')] * 3
                max_co = [float('-inf')] * 3
                for v in mesh.vertices:
                    for j in range(3):
                        min_co[j] = min(min_co[j], v.co[j])
                        max_co[j] = max(max_co[j], v.co[j])
                print(f"Building {i}: X[{min_co[0]:.1f}, {max_co[0]:.1f}] Y[{min_co[1]:.1f}, {max_co[1]:.1f}] Z[{min_co[2]:.1f}, {max_co[2]:.1f}]")

    # Position camera at isometric angle
    # For true isometric: camera along (1, 1, 1) direction from scene center
    # azimuth = 45°, elevation = atan(1/√2) ≈ 35.264°
    dist = CAMERA_DISTANCE

    # Place camera at isometric angle, rotated to align with campus street grid
    # Azimuth angle from +X axis (counter-clockwise when viewed from above)
    # 315° = southeast, adjust to align with campus grid
    azimuth = math.radians(280)  # Rotated further clockwise
    horizontal_dist = dist * math.sqrt(2)  # Distance in XZ plane
    cam_obj.location = (
        center_x + horizontal_dist * math.cos(azimuth),
        dist,
        center_z + horizontal_dist * math.sin(azimuth)
    )

    # Create target empty at scene center for track-to constraint
    target = bpy.data.objects.new("CameraTarget", None)
    bpy.context.collection.objects.link(target)
    target.location = (center_x, 0, center_z)

    # Add track-to constraint
    # Track -Z (camera forward) toward target
    # UP_Y keeps camera's Y axis aligned with world Y (our up direction)
    constraint = cam_obj.constraints.new(type='TRACK_TO')
    constraint.target = target
    constraint.track_axis = 'TRACK_NEGATIVE_Z'
    constraint.up_axis = 'UP_Y'

    print(f"Camera at: ({cam_obj.location.x:.1f}, {cam_obj.location.y:.1f}, {cam_obj.location.z:.1f})")
    print(f"Looking at: ({target.location.x:.1f}, {target.location.y:.1f}, {target.location.z:.1f})")

    # Setup render settings for full image
    scene = bpy.context.scene

    # Illustrated mode defaults to Cycles for quality shadows
    if illustrated or engine.upper() == "CYCLES":
        setup_cycles_rendering(samples=cycles_samples)
    else:
        try:
            scene.render.engine = 'BLENDER_EEVEE_NEXT'
        except:
            scene.render.engine = 'BLENDER_EEVEE'

    # Use the original tile-based resolution
    scene.render.resolution_x = full_width
    scene.render.resolution_y = full_height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

    # Setup pixel art compositor if enabled
    if pixel_art_enabled:
        setup_pixel_art_compositor(pixel_scale=pixel_scale, color_levels=color_levels)
        setup_pixel_art_render_settings()

    # Render full image
    print("Rendering full scene...")
    full_image_path = os.path.join(output_dir, "full-render.png")
    scene.render.filepath = full_image_path
    bpy.ops.render.render(write_still=True)
    print(f"Full render saved: {full_image_path}")

    # Write manifest (for compatibility)
    manifest = {
        "tileSize": tile_size,
        "worldTileSize": world_tile_size,
        "cols": cols,
        "rows": rows,
        "bounds": scene_data["bounds"],
        "fullImage": "full-render.png",
        "width": full_width,
        "height": full_height,
    }
    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"Manifest written to: {manifest_path}")

    print("DONE")


if __name__ == "__main__":
    main()
