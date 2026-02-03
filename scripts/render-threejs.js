#!/usr/bin/env node
/**
 * Three.js isometric renderer - Detailed style with architectural features.
 * Includes: roof variations, window details, roads, building variety.
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUILDINGS_PATH = path.join(PROJECT_ROOT, 'data', 'processed', 'osu-buildings.geojson');
const CAMPUS_PATH = path.join(PROJECT_ROOT, 'data', 'processed', 'osu-campus.geojson');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'viewer', 'public', 'tiles');

// High resolution configuration
const RENDER_SIZE = 4096;
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
 * Generate HTML for Three.js rendering with full architectural detail.
 */
function generateHtml(buildings, roads, sceneData) {
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
const ROADS = ${JSON.stringify(roads)};
const SCENE_DATA = ${JSON.stringify(sceneData)};
const RENDER_SIZE = ${RENDER_SIZE};

// Color palette with more detail
const COLORS = {
  university: {
    wall: 0xC8A878, wallDark: 0xA88858, roof: 0x6B4535, window: 0x3A5070, trim: 0x8B7355
  },
  library: {
    wall: 0xD8C8A8, wallDark: 0xB8A888, roof: 0x504030, window: 0x405868, trim: 0x706050
  },
  stadium: {
    wall: 0xA8A8B0, wallDark: 0x888890, roof: 0x308830, window: 0x506070, trim: 0x707078
  },
  residential: {
    wall: 0xE8D8C0, wallDark: 0xC8B8A0, roof: 0xA04828, window: 0x354858, trim: 0x987050
  },
  commercial: {
    wall: 0xB8C0D0, wallDark: 0x98A0B0, roof: 0x3858A0, window: 0x607898, trim: 0x606878
  },
  religious: {
    wall: 0xE0D8C8, wallDark: 0xC0B8A8, roof: 0x484040, window: 0x506080, trim: 0x605850
  },
  default: {
    wall: 0xC8BCA8, wallDark: 0xA89880, roof: 0x686058, window: 0x405060, trim: 0x787068
  },
};

// Road colors
const ROAD_COLORS = {
  primary: 0x606060,
  secondary: 0x707070,
  tertiary: 0x787878,
  residential: 0x888888,
  service: 0x909090,
  footway: 0xC8C0B0,
  path: 0xB8B0A0,
  cycleway: 0x98A090,
  pedestrian: 0xC0B8A8,
  default: 0x808080
};

const GROUND_COLOR = 0xA8B888;
const SHADOW_COLOR = 0x000000;
const SHADOW_OPACITY = 0.2;
const OUTLINE_COLOR = 0x303030;

const metersPerDegreeLon = 111320 * Math.cos((SCENE_DATA.centerLat * Math.PI) / 180);
const metersPerDegreeLat = 111320;

function geoToScene(lon, lat) {
  return {
    x: (lon - SCENE_DATA.centerLon) * metersPerDegreeLon * SCENE_DATA.scale,
    z: -(lat - SCENE_DATA.centerLat) * metersPerDegreeLat * SCENE_DATA.scale
  };
}

// Create different window textures for variety
function createWindowTexture(config, style = 'grid') {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  const wallHex = '#' + config.wall.toString(16).padStart(6, '0');
  const winHex = '#' + config.window.toString(16).padStart(6, '0');
  const trimHex = '#' + config.trim.toString(16).padStart(6, '0');

  // Wall background with subtle brick/stone texture
  ctx.fillStyle = wallHex;
  ctx.fillRect(0, 0, 64, 64);

  // Add texture variation
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 0.02;
  for (let i = 0; i < 150; i++) {
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 1);
  }
  ctx.globalAlpha = 1.0;

  if (style === 'grid') {
    // Standard grid windows (office/university)
    const winW = 8, winH = 12;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 6 + col * 20;
        const y = 5 + row * 20;

        // Window frame
        ctx.fillStyle = trimHex;
        ctx.fillRect(x - 1, y - 1, winW + 2, winH + 2);

        // Window glass
        ctx.fillStyle = winHex;
        ctx.fillRect(x, y, winW, winH);

        // Reflection
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x + 1, y + 1, 2, winH - 2);
        ctx.globalAlpha = 1.0;
      }
    }
  } else if (style === 'residential') {
    // Larger, fewer windows (residential)
    const winW = 12, winH = 16;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const x = 8 + col * 28;
        const y = 8 + row * 28;

        ctx.fillStyle = trimHex;
        ctx.fillRect(x - 2, y - 2, winW + 4, winH + 4);

        ctx.fillStyle = winHex;
        ctx.fillRect(x, y, winW, winH);

        // Window panes
        ctx.fillStyle = trimHex;
        ctx.fillRect(x + winW/2 - 1, y, 2, winH);
        ctx.fillRect(x, y + winH/2 - 1, winW, 2);

        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x + 1, y + 1, winW/2 - 2, winH/2 - 2);
        ctx.globalAlpha = 1.0;
      }
    }
  } else if (style === 'commercial') {
    // Large glass panels (commercial/modern)
    ctx.fillStyle = winHex;
    ctx.fillRect(4, 4, 56, 56);

    // Mullions
    ctx.fillStyle = trimHex;
    ctx.fillRect(0, 0, 64, 4);
    ctx.fillRect(0, 60, 64, 4);
    ctx.fillRect(0, 0, 4, 64);
    ctx.fillRect(60, 0, 4, 64);
    ctx.fillRect(31, 4, 2, 56);

    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.15;
    ctx.fillRect(6, 6, 24, 52);
    ctx.globalAlpha = 1.0;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Create pitched roof geometry - vertices in world coordinates
function createPitchedRoof(bounds, wallHeight, roofHeight, roofColor) {
  const group = new THREE.Group();

  const { minX, maxX, minZ, maxZ } = bounds;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const rh = roofHeight;
  const h = wallHeight;

  // Create gabled roof with vertices in world coordinates
  const roofGeo = new THREE.BufferGeometry();

  // Vertices for a simple gabled roof (ridge runs along X axis)
  const vertices = new Float32Array([
    // Front face (triangle at minZ)
    minX, h, minZ,   maxX, h, minZ,   centerX, h + rh, centerZ,
    // Back face (triangle at maxZ)
    maxX, h, maxZ,   minX, h, maxZ,   centerX, h + rh, centerZ,
    // Left slope
    minX, h, minZ,   centerX, h + rh, centerZ,   minX, h, maxZ,
    // Right slope
    maxX, h, minZ,   maxX, h, maxZ,   centerX, h + rh, centerZ,
  ]);

  roofGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  roofGeo.computeVertexNormals();

  const roofMat = new THREE.MeshLambertMaterial({ color: roofColor, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  group.add(roof);

  // Add roof edges
  const roofEdges = new THREE.EdgesGeometry(roofGeo, 30);
  const roofOutline = new THREE.LineSegments(
    roofEdges,
    new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0.4 })
  );
  group.add(roofOutline);

  return group;
}

// Create parapet (raised edge around flat roof) - using world coordinates
function createParapet(points, wallHeight, parapetHeight, color) {
  const group = new THREE.Group();

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    // points are Vector2 where x=worldX, y=worldZ
    const dx = p2.x - p1.x;
    const dz = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dz * dz);

    if (len < 0.1) continue;

    const wallGeo = new THREE.BoxGeometry(len, parapetHeight, 0.12);
    const wallMat = new THREE.MeshLambertMaterial({ color: color });
    const wall = new THREE.Mesh(wallGeo, wallMat);

    // cx is world X, cz is world Z (stored in p.y)
    const cx = (p1.x + p2.x) / 2;
    const cz = (p1.y + p2.y) / 2;
    const angle = Math.atan2(dz, dx);

    wall.position.set(cx, wallHeight + parapetHeight / 2, cz);
    wall.rotation.y = -angle;
    group.add(wall);
  }

  return group;
}

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xE8E4DC);

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xFFF4E0, 0.65);
sun.position.set(-1, 2, -0.5).normalize();
scene.add(sun);

const fill = new THREE.DirectionalLight(0xE0E8FF, 0.25);
fill.position.set(1, 1, 1).normalize();
scene.add(fill);

const hemi = new THREE.HemisphereLight(0xD8E8FF, 0x98A878, 0.3);
scene.add(hemi);

// Ground plane
const groundGeo = new THREE.PlaneGeometry(2000, 2000);
const groundMat = new THREE.MeshLambertMaterial({ color: GROUND_COLOR });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.05;
scene.add(ground);

// Road group (render first, under buildings)
const roadGroup = new THREE.Group();
scene.add(roadGroup);

// Create roads
console.log('Creating ' + ROADS.length + ' roads...');
ROADS.forEach(road => {
  if (road.coords.length < 2) return;

  const points = road.coords.map(c => {
    const p = geoToScene(c[0], c[1]);
    return new THREE.Vector3(p.x, 0.01, p.z);
  });

  const roadColor = ROAD_COLORS[road.roadType] || ROAD_COLORS.default;
  const width = road.width * SCENE_DATA.scale * 0.3;

  // Create road as a series of quads
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.sqrt(dx * dx + dz * dz);

    if (len < 0.01) continue;

    const roadGeo = new THREE.PlaneGeometry(len, width);
    const roadMat = new THREE.MeshLambertMaterial({ color: roadColor });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);

    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.set((p1.x + p2.x) / 2, 0.02, (p1.z + p2.z) / 2);
    roadMesh.rotation.z = -Math.atan2(dz, dx);

    roadGroup.add(roadMesh);
  }
});

// Shadow and building groups
const shadowGroup = new THREE.Group();
scene.add(shadowGroup);

const buildingGroup = new THREE.Group();
scene.add(buildingGroup);

// Texture cache
const textureCache = {};

console.log('Creating ' + BUILDINGS.length + ' buildings...');
let addedCount = 0;

BUILDINGS.forEach((b, idx) => {
  const colors = COLORS[b.type] || COLORS.default;
  const height = Math.max(b.height * SCENE_DATA.scale, 0.8);
  const isStadium = b.type === 'stadium';
  const isResidential = b.type === 'residential';
  const isCommercial = b.type === 'commercial';
  const isReligious = b.type === 'religious';
  const isTall = b.height > 25;

  const points = b.coords.map(c => {
    const p = geoToScene(c[0], c[1]);
    return new THREE.Vector2(p.x, p.z);
  });

  if (points.length < 3) return;

  try {
    const shape = new THREE.Shape(points);

    // Calculate bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    points.forEach(p => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
    });
    const bWidth = maxX - minX;
    const bDepth = maxZ - minZ;
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    // Determine roof style
    const hasPitchedRoof = isResidential && b.height < 15 && bWidth < 8 && bDepth < 8;
    const hasParapet = (isCommercial || b.type === 'university') && !isTall;

    // Adjust building height for pitched roofs
    const wallHeight = hasPitchedRoof ? height * 0.75 : height;

    // Create extruded building walls
    const buildingGeo = new THREE.ExtrudeGeometry(shape, {
      depth: wallHeight,
      bevelEnabled: false
    });
    buildingGeo.rotateX(-Math.PI / 2);

    // Get appropriate window texture
    let windowStyle = 'grid';
    if (isResidential) windowStyle = 'residential';
    if (isCommercial) windowStyle = 'commercial';

    const cacheKey = b.type + '_' + windowStyle;
    if (!textureCache[cacheKey]) {
      textureCache[cacheKey] = createWindowTexture(colors, windowStyle);
    }
    const windowTex = textureCache[cacheKey].clone();

    const texScaleX = Math.max(1, Math.floor(bWidth / 2.5));
    const texScaleY = Math.max(1, Math.floor(wallHeight / 2.5));
    windowTex.repeat.set(texScaleX, texScaleY);

    // Materials
    const wallMat = new THREE.MeshLambertMaterial({
      map: isStadium ? null : windowTex,
      color: isStadium ? colors.wall : 0xffffff,
    });
    const roofMat = new THREE.MeshLambertMaterial({ color: colors.roof });

    const building = new THREE.Mesh(buildingGeo, [wallMat, roofMat]);
    buildingGroup.add(building);

    // Add pitched roof for small residential
    if (hasPitchedRoof) {
      const roofHeight = height * 0.35;
      const roofBounds = { minX, maxX, minZ, maxZ };
      const pitchedRoof = createPitchedRoof(roofBounds, wallHeight, roofHeight, colors.roof);
      buildingGroup.add(pitchedRoof);
    }

    // Add parapet for commercial/university
    if (hasParapet) {
      const parapetHeight = 0.25;
      const parapet = createParapet(points, wallHeight, parapetHeight, colors.trim);
      buildingGroup.add(parapet);
    }

    // Add edge outline
    const edges = new THREE.EdgesGeometry(buildingGeo, 20);
    const outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: OUTLINE_COLOR,
        transparent: true,
        opacity: 0.45
      })
    );
    buildingGroup.add(outline);

    // Add floor lines for tall buildings
    if (isTall && !isStadium) {
      const floorHeight = 3.5 * SCENE_DATA.scale;
      const floors = Math.floor(wallHeight / floorHeight);
      for (let f = 1; f < Math.min(floors, 20); f++) {
        const y = f * floorHeight;
        const floorShape = new THREE.Shape(points);
        const floorGeo = new THREE.ShapeGeometry(floorShape);
        floorGeo.rotateX(-Math.PI / 2);
        const floorLine = new THREE.LineSegments(
          new THREE.EdgesGeometry(floorGeo),
          new THREE.LineBasicMaterial({
            color: colors.trim,
            transparent: true,
            opacity: 0.2
          })
        );
        floorLine.position.y = y;
        buildingGroup.add(floorLine);
      }
    }

    // Stadium field
    if (isStadium && b.name && b.name.toLowerCase().includes('ohio stadium')) {
      const fieldGeo = new THREE.PlaneGeometry(bWidth * 0.55, bDepth * 0.35);
      const fieldMat = new THREE.MeshLambertMaterial({ color: 0x2D8B2D });
      const field = new THREE.Mesh(fieldGeo, fieldMat);
      field.rotation.x = -Math.PI / 2;
      field.position.set(centerX, 0.15, centerZ);
      scene.add(field);

      // Field lines
      const lineGeo = new THREE.PlaneGeometry(bWidth * 0.5, 0.05);
      const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      for (let i = 0; i <= 10; i++) {
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(centerX, 0.16, centerZ - bDepth * 0.15 + i * bDepth * 0.03);
        scene.add(line);
      }
    }

    // Shadow
    const shadowGeo = new THREE.ShapeGeometry(shape);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: SHADOW_COLOR,
      transparent: true,
      opacity: SHADOW_OPACITY
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    const shadowOffset = wallHeight * 0.35;
    shadow.position.set(shadowOffset, 0.03, shadowOffset);
    shadowGroup.add(shadow);

    addedCount++;
  } catch (e) {
    // Skip invalid geometries
  }
});

console.log('Added ' + addedCount + ' buildings');

// Renderer
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

// Camera
const frustum = maxSpan;
const camera = new THREE.OrthographicCamera(
  -frustum / 2, frustum / 2,
  frustum / 2, -frustum / 2,
  0.1, 3000
);

const camDist = 1000;
camera.position.set(centerX + camDist, camDist, centerZ + camDist);
camera.lookAt(centerX, 0, centerZ);
camera.updateProjectionMatrix();

// Render
renderer.render(scene, camera);
console.log('Render complete');

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
      name: f.properties.name || null,
    }));
}

/**
 * Filter and prepare roads.
 */
function prepareRoads(geojson) {
  return geojson.features
    .filter(f => {
      if (f.properties?.layer !== 'road') return false;
      if (f.geometry?.type !== 'LineString') return false;
      return f.geometry.coordinates.some(c =>
        c[0] >= FOCUS_BOUNDS.minLon && c[0] <= FOCUS_BOUNDS.maxLon &&
        c[1] >= FOCUS_BOUNDS.minLat && c[1] <= FOCUS_BOUNDS.maxLat
      );
    })
    .map(f => ({
      coords: f.geometry.coordinates,
      roadType: f.properties.highway_type || 'default',
      width: f.properties.width || 5,
      name: f.properties.name || null,
    }));
}

async function main() {
  console.log('Three.js Isometric Renderer - Full Detail');
  console.log('='.repeat(50));
  console.log('Features: Roof variations, windows, roads, building variety\n');

  // Load building data
  if (!fs.existsSync(BUILDINGS_PATH)) {
    console.error(`Error: ${BUILDINGS_PATH} not found`);
    process.exit(1);
  }

  const buildingsGeoJson = JSON.parse(fs.readFileSync(BUILDINGS_PATH, 'utf-8'));
  console.log(`Loaded ${buildingsGeoJson.features.length} buildings`);

  const buildings = prepareBuildings(buildingsGeoJson);
  console.log(`Filtered to ${buildings.length} buildings in view area`);

  // Load road data
  let roads = [];
  if (fs.existsSync(CAMPUS_PATH)) {
    const campusGeoJson = JSON.parse(fs.readFileSync(CAMPUS_PATH, 'utf-8'));
    roads = prepareRoads(campusGeoJson);
    console.log(`Loaded ${roads.length} roads`);
  } else {
    console.log('No campus data found, skipping roads');
  }

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
  const html = generateHtml(buildings, roads, sceneData);
  await page.setContent(html, { waitUntil: 'networkidle' });

  console.log('Waiting for render...');
  await page.waitForFunction('window.rendererReady === true', { timeout: 180000 });
  await page.waitForTimeout(1500);

  // Capture
  console.log('Capturing high-res screenshot...');
  let imageBuffer = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width: RENDER_SIZE, height: RENDER_SIZE }
  });

  await browser.close();

  // Post-processing
  console.log('Applying sharpening...');
  imageBuffer = await sharp(imageBuffer)
    .sharpen({ sigma: 0.6 })
    .png({ quality: 100 })
    .toBuffer();

  // Save full image
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fullPath = path.join(OUTPUT_DIR, 'full-render.png');
  fs.writeFileSync(fullPath, imageBuffer);
  console.log(`Saved: ${fullPath}`);

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
