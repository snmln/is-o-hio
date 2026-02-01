/**
 * Isometric Ohio Renderer
 *
 * This module provides Three.js-based isometric rendering of OSU campus buildings.
 * It's designed to be used both in browser (for preview) and headless (for batch rendering).
 */

export { createScene, addGroundPlane, clearScene } from './scene.js';
export { createIsometricCamera, centerCameraOn, setCameraZoom } from './camera.js';
export {
  loadBuildings,
  createBuildingMesh,
  geoToScene,
  type BuildingFeature,
  type GeoJSONData,
} from './buildings.js';
export {
  calculateTileGrid,
  createTileRenderer,
  renderTile,
  getDefaultTileConfig,
  type TileConfig,
  type TileInfo,
} from './tiles.js';
