# Blender Renderer Design Document

## Background

The current tile rendering pipeline uses Puppeteer to run Three.js in a headless Chrome browser. While functional, this approach has limitations:

- **Browser overhead**: Spawning a full browser process for WebGL rendering
- **Memory constraints**: Browser tab memory limits affect large scenes
- **Shader limitations**: WebGL has fewer features than native OpenGL/Vulkan
- **Quality ceiling**: Real-time rendering prioritizes speed over quality

## Why Blender?

Blender offers significant advantages for offline tile generation:

### Rendering Quality
- **Cycles raytracer**: Physically-based global illumination, soft shadows, ambient occlusion
- **EEVEE real-time**: Fast preview with good quality (PBR materials, screen-space reflections)
- **Material system**: Node-based materials for realistic brick, concrete, glass, etc.
- **Anti-aliasing**: High-quality supersampling without WebGL limitations

### Scripting & Automation
- **Python API (bpy)**: Full scene control from scripts
- **Headless mode**: `blender --background --python script.py`
- **Command-line rendering**: Batch processing without GUI
- **Reproducible**: Script-defined scenes are deterministic

### Isometric Support
- **Orthographic camera**: Native support, no perspective distortion
- **Camera presets**: Easy to set up true isometric angles
- **Consistent scaling**: World units map directly to pixels

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  GeoJSON Data   │────▶│  Blender Python  │────▶│   Raw Tiles     │
│  (buildings)    │     │  (scene + render)│     │   (PNG files)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  Post-process   │
                                                 │  (existing)     │
                                                 └─────────────────┘
```

## Key Design Decisions

### 1. Scene Generation Strategy

**Option A: Generate scene once, render tiles**
- Load all buildings into one Blender scene
- Move camera for each tile
- Faster for many tiles (scene setup is expensive)

**Option B: Generate per-tile scenes**
- Create minimal scene for each tile's visible buildings
- More memory efficient for huge datasets
- Slower due to repeated setup

**Decision**: Option A — our dataset is small enough to fit in memory, and scene setup (geometry, materials) is expensive.

### 2. Renderer Choice

| Renderer | Speed | Quality | Use Case |
|----------|-------|---------|----------|
| EEVEE | ~1-5 sec/tile | Good | Development, previews |
| Cycles | ~10-60 sec/tile | Excellent | Final output |

**Decision**: Support both via CLI flag. Default to EEVEE for iteration speed, Cycles for final renders.

### 3. Material Approach

**Option A: Simple flat colors** (match current Three.js look)
- Diffuse shader with building-type colors
- Fast, consistent with existing pipeline

**Option B: PBR materials** (realistic)
- Brick, concrete, glass, metal materials
- Roughness, normal maps, subtle variation
- More visually interesting but slower

**Decision**: Start with Option A for parity, add Option B as enhancement.

### 4. Building Geometry

Current Three.js approach: `ExtrudeGeometry` on 2D polygon footprints.

Blender equivalent:
1. Create 2D mesh from polygon coordinates
2. Extrude to building height
3. Optionally add roof geometry (flat, gabled, etc.)

### 5. Lighting Setup

For isometric pixel art aesthetic:
- **Key light**: Strong directional from upper-left (classic isometric shadow direction)
- **Fill light**: Soft ambient or hemisphere light
- **Optional**: Ambient occlusion for depth at corners

### 6. Tile Coordinate System

Must match existing pipeline:
- Orthographic camera sized to `WORLD_TILE_SIZE` scene units
- Camera positioned at tile center
- True isometric angle: `rotation = (54.736°, 0°, 45°)`

## Implementation Plan

### Phase 1: Core Blender Script
- [ ] Python script that loads GeoJSON
- [ ] Creates building meshes with extrusion
- [ ] Sets up isometric camera
- [ ] Basic lighting (ambient + directional)
- [ ] Renders single tile to PNG

### Phase 2: Tile Grid Rendering
- [ ] Calculate tile grid (same logic as current)
- [ ] Loop through tiles, position camera, render
- [ ] Generate manifest.json for downstream compatibility
- [ ] CLI arguments for tile size, world size, renderer

### Phase 3: Node.js Integration
- [ ] TypeScript wrapper that spawns Blender subprocess
- [ ] Pass configuration via JSON temp file
- [ ] Stream progress output
- [ ] Error handling for missing Blender

### Phase 4: Material Enhancement (Optional)
- [ ] Building-type specific materials
- [ ] Subtle color variation per building
- [ ] Roof styles (flat, angled)

## File Structure

```
renderer/
├── scripts/
│   ├── batch-render.ts      # Current Puppeteer renderer (keep as fallback)
│   └── blender-render.ts    # New Node.js wrapper for Blender
├── blender/
│   ├── render_tiles.py      # Main Blender Python script
│   ├── materials.py         # Material definitions
│   └── geometry.py          # Building mesh generation
```

## Dependencies

- **Blender 4.0+**: For modern Python API and EEVEE improvements
- **Node.js**: Existing, for wrapper script
- **No new npm packages**: Just child_process to spawn Blender

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| User doesn't have Blender installed | Clear error message, link to download, keep Three.js fallback |
| Blender version incompatibility | Document minimum version, test on 3.6 LTS and 4.x |
| Rendering too slow | EEVEE default, Cycles opt-in; tile-level parallelism possible |
| Color matching issues | Export current palette to Blender materials |

## Open Questions

1. Should we generate a `.blend` file for manual tweaking, or purely script-driven?
2. Do we want ground plane texture (grass) or solid color?
3. Should shadows be baked into tiles or added in post-processing?

## Next Steps

1. Verify Blender is installed and accessible from CLI
2. Create minimal Python script that renders a test cube isometrically
3. Extend to load one building from GeoJSON
4. Scale to full tile grid
