#!/usr/bin/env node
/**
 * Three.js isometric renderer - Clean high-resolution style.
 * Inspired by cannoneyed.com/isometric-nyc
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(PROJECT_ROOT, 'data', 'processed', 'osu-buildings.geojson');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'viewer', 'public', 'tiles');

// High resolution configuration
const RENDER_SIZE = 4096; // Render at full resolution
const OUTPUT_SIZE = 4096;
const TILE_SIZE = 256;

// Full campus view
const FOCUS_BOUNDS = {
  minLon: -83.032,
  maxLon: -83.006,
  minLat: 39.992,
  maxLat: 40.010,
};

/**
 * Generate HTML for Three.js rendering - clean style.
 */
function generateHtml(buildings, sceneData) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>* { margin: 0; padding: 0; } body { overflow: hidden; background: #E8E4DC; }</style>
</head>
<body>
<script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
<script>
const BUILDINGS = ${JSON.stringify(buildings)};
const SCENE_DATA = ${JSON.stringify(sceneData)};
const RENDER_SIZE = ${RENDER_SIZE};

// Clean, modern color palette
const COLORS = {
  university: {
    wall: 0xD4C4A8, wallDark: 0xB8A888, roof: 0x8B7355
  },
  library: {
    wall: 0xE0D8C8, wallDark: 0xC8C0B0, roof: 0x706050
  },
  stadium: {
    wall: 0xC0C0C8, wallDark: 0xA0A0A8, roof: 0x4A8B4A
  },
  residential: {
    wall: 0xE8DCD0, wallDark: 0xD0C4B8, roof: 0xA86048
  },
  commercial: {
    wall: 0xD8D8E0, wallDark: 0xB8B8C0, roof: 0x5878A0
  },
  default: {
    wall: 0xDDD4C4, wallDark: 0xC4B8A8, roof: 0x887868
  },
};

const GROUND_COLOR = 0xC8D4A8; // Muted grass
const SHADOW_COLOR = 0x000000;
const SHADOW_OPACITY = 0.15;
const OUTLINE_COLOR = 0x404040;

const metersPerDegreeLon = 111320 * Math.cos((SCENE_DATA.centerLat * Math.PI) / 180);
const metersPerDegreeLat = 111320;

function geoToScene(lon, lat) {
  return {
    x: (lon - SCENE_DATA.centerLon) * metersPerDegreeLon * SCENE_DATA.scale,
    z: -(lat - SCENE_DATA.centerLat) * metersPerDegreeLat * SCENE_DATA.scale
  };
}

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xE8E4DC); // Warm off-white

// Soft, even lighting for clean look
const ambient = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambient);

// Main directional light
const sun = new THREE.DirectionalLight(0xffffff, 0.5);
sun.position.set(-1, 2, -1).normalize();
scene.add(sun);

// Hemisphere light for natural sky/ground colors
const hemi = new THREE.HemisphereLight(0xE8F0FF, 0xC8D4A8, 0.4);
scene.add(hemi);

// Ground plane
const groundGeo = new THREE.PlaneGeometry(2000, 2000);
const groundMat = new THREE.MeshLambertMaterial({ color: GROUND_COLOR });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
ground.receiveShadow = true;
scene.add(ground);

// Shadow plane (separate for soft shadows)
const shadowGroup = new THREE.Group();
scene.add(shadowGroup);

// Building group
const buildingGroup = new THREE.Group();
scene.add(buildingGroup);

console.log('Creating ' + BUILDINGS.length + ' buildings...');
let addedCount = 0;

BUILDINGS.forEach((b, idx) => {
  const colors = COLORS[b.type] || COLORS.default;
  const height = Math.max(b.height * SCENE_DATA.scale, 1);

  const points = b.coords.map(c => {
    const p = geoToScene(c[0], c[1]);
    return new THREE.Vector2(p.x, p.z);
  });

  if (points.length < 3) return;

  try {
    const shape = new THREE.Shape(points);

    // Create extruded building
    const buildingGeo = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false
    });
    buildingGeo.rotateX(-Math.PI / 2);

    // Create materials for different faces
    const wallMat = new THREE.MeshLambertMaterial({
      color: colors.wall,
    });
    const roofMat = new THREE.MeshLambertMaterial({
      color: colors.roof,
    });

    const building = new THREE.Mesh(buildingGeo, [wallMat, roofMat]);
    buildingGroup.add(building);

    // Add thin outline for definition
    const edges = new THREE.EdgesGeometry(buildingGeo, 30);
    const outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: OUTLINE_COLOR,
        transparent: true,
        opacity: 0.3
      })
    );
    buildingGroup.add(outline);

    // Create shadow (offset dark shape on ground)
    const shadowGeo = new THREE.ShapeGeometry(shape);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: SHADOW_COLOR,
      transparent: true,
      opacity: SHADOW_OPACITY
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);

    // Offset shadow based on height (taller = longer shadow)
    const shadowOffset = height * 0.4;
    shadow.position.set(shadowOffset, 0.01, shadowOffset);
    shadowGroup.add(shadow);

    addedCount++;
  } catch (e) {
    // Skip invalid geometries
  }
});

console.log('Added ' + addedCount + ' buildings');

// High quality renderer
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
  precision: 'highp'
});
renderer.setSize(RENDER_SIZE, RENDER_SIZE);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Calculate scene bounds
let minX = Infinity, maxX = -Infinity;
let minZ = Infinity, maxZ = -Infinity;

BUILDINGS.forEach(b => {
  b.coords.forEach(c => {
    const p = geoToScene(c[0], c[1]);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  });
});

const centerX = (minX + maxX) / 2;
const centerZ = (minZ + maxZ) / 2;
const spanX = maxX - minX;
const spanZ = maxZ - minZ;
const maxSpan = Math.max(spanX, spanZ) * 1.15;

console.log('Scene bounds:', minX.toFixed(1), maxX.toFixed(1), minZ.toFixed(1), maxZ.toFixed(1));
console.log('Frustum:', maxSpan.toFixed(1));

// Orthographic camera - true isometric
const frustum = maxSpan;
const camera = new THREE.OrthographicCamera(
  -frustum / 2, frustum / 2,
  frustum / 2, -frustum / 2,
  0.1, 3000
);

// Isometric camera position
const camDist = 1000;
camera.position.set(
  centerX + camDist,
  camDist,
  centerZ + camDist
);
camera.lookAt(centerX, 0, centerZ);
camera.updateProjectionMatrix();

// Render
renderer.render(scene, camera);
console.log('Render complete');

window.getImageData = () => renderer.domElement.toDataURL('image/png');
window.rendererReady = true;
</script>
</body>
</html>`;
}

/**
 * Filter and prepare buildings.
 */
function prepareBuildings(geojson) {
  return geojson.features
    .filter(f => {
      if (f.geometry?.type !== 'Polygon') return false;
      if (!f.properties?.height || f.properties.height <= 0) return false;
      return f.geometry.coordinates[0].some(c =>
        c[0] >= FOCUS_BOUNDS.minLon && c[0] <= FOCUS_BOUNDS.maxLon &&
        c[1] >= FOCUS_BOUNDS.minLat && c[1] <= FOCUS_BOUNDS.maxLat
      );
    })
    .map(f => ({
      coords: f.geometry.coordinates[0],
      height: Math.max(f.properties.height, 5),
      type: f.properties.building_type || 'default',
    }));
}

async function main() {
  console.log('Three.js Isometric Renderer - High Resolution');
  console.log('='.repeat(50));
  console.log('Style: Clean, detailed (inspired by isometric-nyc)\n');

  // Load data
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Error: ${DATA_PATH} not found`);
    process.exit(1);
  }

  const geojson = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  console.log(`Loaded ${geojson.features.length} buildings`);

  const buildings = prepareBuildings(geojson);
  console.log(`Filtered to ${buildings.length} in view area`);

  // Calculate scene data
  const centerLon = (FOCUS_BOUNDS.minLon + FOCUS_BOUNDS.maxLon) / 2;
  const centerLat = (FOCUS_BOUNDS.minLat + FOCUS_BOUNDS.maxLat) / 2;
  const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const lonSpan = (FOCUS_BOUNDS.maxLon - FOCUS_BOUNDS.minLon) * metersPerDegreeLon;
  const latSpan = (FOCUS_BOUNDS.maxLat - FOCUS_BOUNDS.minLat) * 111320;
  const scale = 200 / Math.max(lonSpan, latSpan);

  const sceneData = { centerLon, centerLat, scale };
  console.log(`Scale: ${scale.toFixed(4)}`);

  // Launch browser
  console.log('\nLaunching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('parser-blocking') && !text.includes('deprecated') && !text.includes('GL Driver')) {
      console.log('  Browser:', text);
    }
  });

  await page.setViewportSize({ width: RENDER_SIZE, height: RENDER_SIZE });

  // Load and render
  console.log('Loading Three.js scene...');
  const html = generateHtml(buildings, sceneData);
  await page.setContent(html, { waitUntil: 'networkidle' });

  console.log('Waiting for render...');
  await page.waitForFunction('window.rendererReady === true', { timeout: 120000 });
  await page.waitForTimeout(1000);

  // Capture at full resolution
  console.log('Capturing high-res screenshot...');
  let imageBuffer = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width: RENDER_SIZE, height: RENDER_SIZE }
  });

  await browser.close();

  // Light post-processing: just sharpen slightly
  console.log('Applying light sharpening...');
  imageBuffer = await sharp(imageBuffer)
    .sharpen({ sigma: 0.5 })
    .png({ quality: 100 })
    .toBuffer();

  // Save full image
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fullPath = path.join(OUTPUT_DIR, 'full-render.png');
  fs.writeFileSync(fullPath, imageBuffer);
  console.log(`Saved: ${fullPath}`);

  // Check image stats
  const stats = await sharp(imageBuffer).stats();
  console.log('Image stats:', stats.channels.map(c => `min:${c.min} max:${c.max}`).join(', '));

  // Generate tile pyramid
  console.log('\nGenerating tile pyramid...');
  const maxLevel = Math.ceil(Math.log2(OUTPUT_SIZE));

  const dziContent = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"
  Format="png" Overlap="1" TileSize="${TILE_SIZE}">
  <Size Width="${OUTPUT_SIZE}" Height="${OUTPUT_SIZE}"/>
</Image>`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'osu-campus.dzi'), dziContent);

  for (let level = 0; level <= maxLevel; level++) {
    const levelDir = path.join(OUTPUT_DIR, 'osu-campus_files', String(level));
    fs.mkdirSync(levelDir, { recursive: true });

    const scaleFactor = Math.pow(2, maxLevel - level);
    const levelSize = Math.ceil(OUTPUT_SIZE / scaleFactor);
    const tilesX = Math.ceil(levelSize / TILE_SIZE);
    const tilesY = Math.ceil(levelSize / TILE_SIZE);

    console.log(`  Level ${level}: ${tilesX}x${tilesY} tiles`);

    const levelImage = await sharp(imageBuffer)
      .resize(levelSize, levelSize, { kernel: 'lanczos3' })
      .toBuffer();

    for (let y = 0; y < tilesY; y++) {
      for (let x = 0; x < tilesX; x++) {
        const left = x * TILE_SIZE;
        const top = y * TILE_SIZE;
        const width = Math.min(TILE_SIZE, levelSize - left);
        const height = Math.min(TILE_SIZE, levelSize - top);

        if (width > 0 && height > 0) {
          await sharp(levelImage)
            .extract({ left, top, width, height })
            .png()
            .toFile(path.join(levelDir, `${x}_${y}.png`));
        }
      }
    }
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
