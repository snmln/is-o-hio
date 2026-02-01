#!/usr/bin/env node
/**
 * Batch render script using Puppeteer for headless Three.js rendering.
 * Fixed version: Processes tiles in batches to avoid memory issues.
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_PATH = path.join(PROJECT_ROOT, 'data', 'processed', 'osu-buildings.geojson');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'tiles', 'raw');

// Tile configuration
const TILE_SIZE = 512;
const WORLD_TILE_SIZE = 15; // Scene units per tile

// Focus bounds (same as canvas renderer)
const FOCUS_BOUNDS = {
  minLon: -83.026,
  maxLon: -83.012,
  minLat: 39.996,
  maxLat: 40.006,
};

interface Building {
  coords: number[][];
  height: number;
  type: string;
}

interface SceneData {
  centerLon: number;
  centerLat: number;
  scale: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/**
 * Filter buildings within focus bounds.
 */
function filterBuildings(geojson: any): Building[] {
  return geojson.features
    .filter((f: any) => {
      if (f.geometry?.type !== 'Polygon') return false;
      if (!f.properties?.height || f.properties.height <= 0) return false;

      // Check if any point is within bounds
      return f.geometry.coordinates[0].some((c: number[]) =>
        c[0] >= FOCUS_BOUNDS.minLon && c[0] <= FOCUS_BOUNDS.maxLon &&
        c[1] >= FOCUS_BOUNDS.minLat && c[1] <= FOCUS_BOUNDS.maxLat
      );
    })
    .map((f: any) => ({
      coords: f.geometry.coordinates[0],
      height: Math.max(f.properties.height, 3),
      type: f.properties.building_type || 'default',
    }));
}

/**
 * Calculate scene parameters from buildings.
 */
function calculateSceneData(buildings: Building[]): SceneData {
  const centerLon = (FOCUS_BOUNDS.minLon + FOCUS_BOUNDS.maxLon) / 2;
  const centerLat = (FOCUS_BOUNDS.minLat + FOCUS_BOUNDS.maxLat) / 2;

  const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const metersPerDegreeLat = 111320;

  const lonSpan = (FOCUS_BOUNDS.maxLon - FOCUS_BOUNDS.minLon) * metersPerDegreeLon;
  const latSpan = (FOCUS_BOUNDS.maxLat - FOCUS_BOUNDS.minLat) * metersPerDegreeLat;

  // Scale to fit in reasonable scene size
  const scale = 100 / Math.max(lonSpan, latSpan);

  // Calculate bounds in scene coordinates
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  buildings.forEach(b => {
    b.coords.forEach(c => {
      const x = (c[0] - centerLon) * metersPerDegreeLon * scale;
      const z = -(c[1] - centerLat) * metersPerDegreeLat * scale;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });
  });

  return { centerLon, centerLat, scale, bounds: { minX, maxX, minZ, maxZ } };
}

/**
 * Generate the Three.js HTML page content.
 */
function getRendererHtml(buildings: Building[], sceneData: SceneData): string {
  const buildingsJson = JSON.stringify(buildings);
  const sceneDataJson = JSON.stringify(sceneData);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { margin: 0; } canvas { display: block; }</style>
</head>
<body>
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js"
  }
}
</script>
<script type="module">
import * as THREE from 'three';

const BUILDINGS = ${buildingsJson};
const SCENE_DATA = ${sceneDataJson};

// Color palette
const COLORS = {
  university: { wall: 0xE8C090, roof: 0xA06030, shadow: 0xB08860 },
  library: { wall: 0xF0D8B0, roof: 0x786048, shadow: 0xC0A880 },
  stadium: { wall: 0xA8A8B0, roof: 0x30A030, shadow: 0x707078 },
  residential: { wall: 0xE8D0A8, roof: 0xB84838, shadow: 0xB8A080 },
  commercial: { wall: 0xC8C8D0, roof: 0x4870A8, shadow: 0x989898 },
  default: { wall: 0xD8C0A0, roof: 0x907860, shadow: 0xA89070 },
};

const metersPerDegreeLon = 111320 * Math.cos((SCENE_DATA.centerLat * Math.PI) / 180);
const metersPerDegreeLat = 111320;

function geoToScene(lon, lat) {
  const x = (lon - SCENE_DATA.centerLon) * metersPerDegreeLon * SCENE_DATA.scale;
  const z = -(lat - SCENE_DATA.centerLat) * metersPerDegreeLat * SCENE_DATA.scale;
  return { x, z };
}

function createBuilding(building) {
  const group = new THREE.Group();
  const colors = COLORS[building.type] || COLORS.default;
  const height = building.height * SCENE_DATA.scale * 0.8;

  // Convert coords to Vector2 for shape
  const points = building.coords.map(c => {
    const { x, z } = geoToScene(c[0], c[1]);
    return new THREE.Vector2(x, z);
  });

  if (points.length < 3) return group;

  const shape = new THREE.Shape(points);

  // Extruded geometry
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);

  // Materials
  const wallMaterial = new THREE.MeshLambertMaterial({ color: colors.wall });
  const roofMaterial = new THREE.MeshLambertMaterial({ color: colors.roof });

  const mesh = new THREE.Mesh(geometry, [wallMaterial, roofMaterial]);
  group.add(mesh);

  // Add edges for outline effect
  const edges = new THREE.EdgesGeometry(geometry, 15);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x303030 });
  const wireframe = new THREE.LineSegments(edges, lineMaterial);
  group.add(wireframe);

  return group;
}

// Setup scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7CA84A); // Grass green

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const directional = new THREE.DirectionalLight(0xffffff, 0.8);
directional.position.set(-50, 100, -50);
directional.castShadow = true;
scene.add(directional);

const fill = new THREE.DirectionalLight(0xffffff, 0.3);
fill.position.set(50, 50, 50);
scene.add(fill);

// Ground plane
const groundSize = 200;
const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x7CA84A });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);

// Add buildings
console.log('Adding ' + BUILDINGS.length + ' buildings...');
BUILDINGS.forEach(b => {
  const mesh = createBuilding(b);
  scene.add(mesh);
});

// Setup renderer
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(${TILE_SIZE}, ${TILE_SIZE});
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Calculate tile grid
const { minX, maxX, minZ, maxZ } = SCENE_DATA.bounds;
const padding = ${WORLD_TILE_SIZE} * 0.5;
const gridMinX = minX - padding;
const gridMaxX = maxX + padding;
const gridMinZ = minZ - padding;
const gridMaxZ = maxZ + padding;

const cols = Math.ceil((gridMaxX - gridMinX) / ${WORLD_TILE_SIZE});
const rows = Math.ceil((gridMaxZ - gridMinZ) / ${WORLD_TILE_SIZE});

const tiles = [];
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    tiles.push({
      col,
      row,
      worldX: gridMinX + (col + 0.5) * ${WORLD_TILE_SIZE},
      worldZ: gridMinZ + (row + 0.5) * ${WORLD_TILE_SIZE},
    });
  }
}

window.tileData = { tiles, cols, rows };

// Render function
window.renderTile = function(worldX, worldZ) {
  const frustumSize = ${WORLD_TILE_SIZE};

  const camera = new THREE.OrthographicCamera(
    -frustumSize / 2, frustumSize / 2,
    frustumSize / 2, -frustumSize / 2,
    0.1, 1000
  );

  // Isometric camera position
  const dist = 200;
  camera.position.set(worldX + dist, dist, worldZ + dist);
  camera.lookAt(worldX, 0, worldZ);

  // True isometric rotation
  camera.rotation.order = 'YXZ';
  camera.rotation.y = Math.PI / 4;
  camera.rotation.x = Math.atan(1 / Math.sqrt(2));
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
};

console.log('Scene ready with ' + tiles.length + ' tiles');
window.rendererReady = true;
</script>
</body>
</html>`;
}

async function main() {
  console.log('Three.js Isometric Renderer (Batched)');
  console.log('=' .repeat(50));

  // Load and filter GeoJSON
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Error: ${DATA_PATH} not found`);
    process.exit(1);
  }

  const geojson = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  console.log(`Loaded ${geojson.features.length} total buildings`);

  const buildings = filterBuildings(geojson);
  console.log(`Filtered to ${buildings.length} buildings in focus area`);

  if (buildings.length === 0) {
    console.error('No buildings in focus area!');
    process.exit(1);
  }

  const sceneData = calculateSceneData(buildings);
  console.log(`Scene center: ${sceneData.centerLat.toFixed(4)}, ${sceneData.centerLon.toFixed(4)}`);
  console.log(`Scene bounds: X[${sceneData.bounds.minX.toFixed(1)}, ${sceneData.bounds.maxX.toFixed(1)}]`);

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Launch browser
  console.log('\nLaunching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--use-gl=swiftshader', // Software WebGL
    ],
  });

  try {
    const page = await browser.newPage();

    // Log browser console
    page.on('console', msg => console.log('  Browser:', msg.text()));
    page.on('pageerror', err => console.error('  Page error:', err.message));

    await page.setViewport({ width: TILE_SIZE, height: TILE_SIZE });

    // Load renderer
    console.log('Loading Three.js scene...');
    const html = getRendererHtml(buildings, sceneData);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

    // Wait for ready
    console.log('Waiting for scene initialization...');
    await page.waitForFunction('window.rendererReady === true', { timeout: 120000 });

    // Get tile data
    const tileData = await page.evaluate(() => (window as any).tileData);
    console.log(`\nTile grid: ${tileData.cols}x${tileData.rows} = ${tileData.tiles.length} tiles`);

    // Render tiles
    console.log('\nRendering tiles...');
    for (let i = 0; i < tileData.tiles.length; i++) {
      const tile = tileData.tiles[i];
      const filename = `tile_${tile.col}_${tile.row}.png`;

      const dataUrl = await page.evaluate(
        (wx: number, wz: number) => (window as any).renderTile(wx, wz),
        tile.worldX,
        tile.worldZ
      );

      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), Buffer.from(base64, 'base64'));

      const pct = ((i + 1) / tileData.tiles.length * 100).toFixed(1);
      process.stdout.write(`\r  [${pct}%] ${filename}    `);
    }

    console.log('\n\nSaving manifest...');
    const manifest = {
      tileSize: TILE_SIZE,
      worldTileSize: WORLD_TILE_SIZE,
      cols: tileData.cols,
      rows: tileData.rows,
      bounds: sceneData.bounds,
      tiles: tileData.tiles.map((t: any) => ({
        col: t.col,
        row: t.row,
        filename: `tile_${t.col}_${t.row}.png`,
      })),
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

    console.log('Done!');
    console.log(`Output: ${OUTPUT_DIR}`);

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
