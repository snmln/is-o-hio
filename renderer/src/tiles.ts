import * as THREE from 'three';
import { createIsometricCamera, centerCameraOn } from './camera.js';

export interface TileConfig {
  tileSize: number; // pixels
  worldTileSize: number; // scene units per tile
  overlap: number; // pixel overlap between tiles
}

export interface TileInfo {
  col: number;
  row: number;
  worldX: number;
  worldZ: number;
  filename: string;
}

/**
 * Calculate tile grid for the given scene bounds.
 */
export function calculateTileGrid(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  config: TileConfig
): TileInfo[] {
  const { worldTileSize } = config;

  // Add padding around bounds
  const padding = worldTileSize * 0.5;
  const minX = bounds.minX - padding;
  const maxX = bounds.maxX + padding;
  const minZ = bounds.minZ - padding;
  const maxZ = bounds.maxZ + padding;

  const width = maxX - minX;
  const height = maxZ - minZ;

  const cols = Math.ceil(width / worldTileSize);
  const rows = Math.ceil(height / worldTileSize);

  const tiles: TileInfo[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const worldX = minX + (col + 0.5) * worldTileSize;
      const worldZ = minZ + (row + 0.5) * worldTileSize;

      tiles.push({
        col,
        row,
        worldX,
        worldZ,
        filename: `tile_${col}_${row}.png`,
      });
    }
  }

  console.log(`Tile grid: ${cols}x${rows} = ${tiles.length} tiles`);
  return tiles;
}

/**
 * Setup renderer for tile generation.
 */
export function createTileRenderer(
  tileSize: number
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // We want crisp pixels for pixel art
    alpha: true,
    preserveDrawingBuffer: true,
  });

  renderer.setSize(tileSize, tileSize);
  renderer.setPixelRatio(1); // No pixel ratio scaling
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  return renderer;
}

/**
 * Render a single tile and return as data URL.
 */
export function renderTile(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  tile: TileInfo,
  config: TileConfig
): string {
  const { tileSize, worldTileSize } = config;

  // Create camera for this tile
  const camera = createIsometricCamera(tileSize, tileSize, 1);

  // Set frustum size based on world tile size
  const frustumSize = worldTileSize;
  camera.left = -frustumSize / 2;
  camera.right = frustumSize / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();

  // Center camera on tile
  centerCameraOn(camera, tile.worldX, tile.worldZ);

  // Render
  renderer.render(scene, camera);

  // Get data URL
  return renderer.domElement.toDataURL('image/png');
}

/**
 * Get tile configuration for default rendering.
 */
export function getDefaultTileConfig(): TileConfig {
  return {
    tileSize: 512,
    worldTileSize: 20, // scene units
    overlap: 0,
  };
}
