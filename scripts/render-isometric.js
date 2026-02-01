#!/usr/bin/env node
/**
 * Render OSU campus in isometric pixel-art style using node-canvas.
 * Version 3: Added roads, shadows, better scale, and pixel-art post-processing.
 */

import { createCanvas } from 'canvas';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUILDINGS_PATH = path.join(PROJECT_ROOT, 'data', 'processed', 'osu-buildings.geojson');
const CAMPUS_PATH = path.join(PROJECT_ROOT, 'data', 'processed', 'osu-campus.geojson');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'viewer', 'public', 'tiles');

// Rendering configuration
const IMAGE_SIZE = 4096;
const TILE_SIZE = 256;
const PIXEL_SIZE = 3; // Size of "pixels" for retro look (larger = chunkier)
const OUTLINE_WIDTH = 1; // Building outline thickness

// Focus on campus core (tighter zoom on Ohio Stadium and surroundings)
const FOCUS_BOUNDS = {
  minLon: -83.026,
  maxLon: -83.012,
  minLat: 39.996,
  maxLat: 40.006,
};

// Vibrant SimCity 2000-style color palette (32 colors)
const SIMCITY_PALETTE = [
  // Grayscale
  { r: 16, g: 16, b: 16 },      // Near black
  { r: 56, g: 56, b: 64 },      // Dark gray
  { r: 104, g: 104, b: 112 },   // Gray
  { r: 152, g: 152, b: 160 },   // Light gray
  { r: 200, g: 200, b: 208 },   // Silver
  { r: 248, g: 248, b: 240 },   // Off-white

  // Warm browns/tans (buildings)
  { r: 160, g: 96, b: 48 },     // Rich brown
  { r: 200, g: 144, b: 88 },    // Warm tan
  { r: 232, g: 192, b: 144 },   // Light beige
  { r: 176, g: 104, b: 56 },    // Terracotta
  { r: 216, g: 160, b: 96 },    // Sandy

  // Reds (OSU colors, brick)
  { r: 200, g: 32, b: 32 },     // Bright scarlet
  { r: 152, g: 24, b: 24 },     // Dark red
  { r: 184, g: 72, b: 56 },     // Brick red

  // Greens (grass, trees, stadium turf)
  { r: 48, g: 160, b: 48 },     // Bright green
  { r: 96, g: 144, b: 64 },     // Olive
  { r: 136, g: 184, b: 80 },    // Grass
  { r: 104, g: 152, b: 56 },    // Dark grass
  { r: 64, g: 112, b: 48 },     // Forest

  // Grays (roads, concrete)
  { r: 64, g: 64, b: 72 },      // Dark asphalt
  { r: 96, g: 96, b: 104 },     // Asphalt
  { r: 136, g: 136, b: 144 },   // Concrete
  { r: 184, g: 180, b: 168 },   // Sidewalk

  // Blues (accents, roofs)
  { r: 72, g: 112, b: 168 },    // Steel blue
  { r: 112, g: 152, b: 200 },   // Sky blue

  // More building colors
  { r: 232, g: 208, b: 168 },   // Cream
  { r: 208, g: 184, b: 144 },   // Warm cream
  { r: 176, g: 152, b: 120 },   // Taupe
  { r: 144, g: 120, b: 88 },    // Dark taupe

  // Accent colors
  { r: 88, g: 64, b: 40 },      // Dark brown
  { r: 120, g: 96, b: 64 },     // Medium brown
  { r: 240, g: 232, b: 208 },   // Background cream
];

// Building color schemes (more vibrant)
const BUILDING_COLORS = {
  university: {
    top: { r: 160, g: 96, b: 48 },
    front: { r: 232, g: 192, b: 144 },
    right: { r: 176, g: 136, b: 88 },
    outline: { r: 88, g: 56, b: 24 },
  },
  library: {
    top: { r: 120, g: 96, b: 64 },
    front: { r: 240, g: 216, b: 176 },
    right: { r: 184, g: 160, b: 120 },
    outline: { r: 72, g: 56, b: 32 },
  },
  stadium: {
    top: { r: 48, g: 160, b: 48 },  // Bright green turf
    front: { r: 168, g: 168, b: 176 },
    right: { r: 112, g: 112, b: 120 },
    outline: { r: 48, g: 48, b: 56 },
  },
  residential: {
    top: { r: 184, g: 72, b: 56 },  // Brick red roof
    front: { r: 232, g: 208, b: 168 },
    right: { r: 184, g: 160, b: 120 },
    outline: { r: 96, g: 64, b: 40 },
  },
  commercial: {
    top: { r: 72, g: 112, b: 168 },  // Blue roof
    front: { r: 200, g: 200, b: 208 },
    right: { r: 152, g: 152, b: 160 },
    outline: { r: 48, g: 48, b: 56 },
  },
  default: {
    top: { r: 144, g: 120, b: 88 },
    front: { r: 216, g: 192, b: 160 },
    right: { r: 168, g: 144, b: 112 },
    outline: { r: 80, g: 64, b: 48 },
  },
};

const OUTLINE_COLOR = { r: 32, g: 32, b: 40 };

const ROAD_COLOR = { r: 70, g: 70, b: 80 };
const ROAD_LINE_COLOR = { r: 200, g: 180, b: 50 };
const GRASS_COLOR = { r: 124, g: 168, b: 74 };
const GRASS_DARK = { r: 98, g: 142, b: 58 };
const SHADOW_COLOR = { r: 0, g: 0, b: 0, a: 0.25 };

/**
 * Find nearest color in palette.
 */
function findNearestColor(r, g, b) {
  let minDist = Infinity;
  let nearest = SIMCITY_PALETTE[0];

  for (const color of SIMCITY_PALETTE) {
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < minDist) {
      minDist = dist;
      nearest = color;
    }
  }
  return nearest;
}

/**
 * 4x4 Bayer matrix for ordered dithering.
 */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map(row => row.map(v => (v / 16 - 0.5) * 32));

/**
 * Apply pixel-art post-processing: pixelation + dithering + palette reduction.
 */
function applyPixelArtEffect(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Process in PIXEL_SIZE x PIXEL_SIZE blocks
  for (let by = 0; by < height; by += PIXEL_SIZE) {
    for (let bx = 0; bx < width; bx += PIXEL_SIZE) {
      // Average the colors in this block
      let totalR = 0, totalG = 0, totalB = 0, count = 0;

      for (let py = 0; py < PIXEL_SIZE && by + py < height; py++) {
        for (let px = 0; px < PIXEL_SIZE && bx + px < width; px++) {
          const i = ((by + py) * width + (bx + px)) * 4;
          totalR += data[i];
          totalG += data[i + 1];
          totalB += data[i + 2];
          count++;
        }
      }

      const avgR = totalR / count;
      const avgG = totalG / count;
      const avgB = totalB / count;

      // Apply dithering offset based on block position
      const ditherOffset = BAYER_4X4[(by / PIXEL_SIZE) % 4][(bx / PIXEL_SIZE) % 4];

      const r = Math.max(0, Math.min(255, avgR + ditherOffset));
      const g = Math.max(0, Math.min(255, avgG + ditherOffset));
      const b = Math.max(0, Math.min(255, avgB + ditherOffset));

      // Find nearest palette color
      const nearest = findNearestColor(r, g, b);

      // Fill the entire block with this color
      for (let py = 0; py < PIXEL_SIZE && by + py < height; py++) {
        for (let px = 0; px < PIXEL_SIZE && bx + px < width; px++) {
          const i = ((by + py) * width + (bx + px)) * 4;
          data[i] = nearest.r;
          data[i + 1] = nearest.g;
          data[i + 2] = nearest.b;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Convert geo coordinates to world coordinates.
 */
function geoToWorld(lon, lat, centerLon, centerLat) {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  return {
    x: (lon - centerLon) * metersPerDegreeLon,
    y: (lat - centerLat) * metersPerDegreeLat,
  };
}

/**
 * Convert world coordinates to isometric screen coordinates.
 */
function worldToScreen(wx, wy, wz, scale, offsetX, offsetY) {
  const screenX = (wx - wy) * scale;
  const screenY = (wx + wy) * scale * 0.5 - wz * scale;
  return {
    x: screenX + offsetX,
    y: -screenY + offsetY,
  };
}

/**
 * Draw a filled polygon.
 */
function fillPolygon(ctx, points, color, alpha = 1) {
  if (points.length < 3) return;

  if (alpha < 1) {
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
  } else {
    ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw a road as a thick line in isometric view.
 */
function drawRoad(ctx, coords, width, centerLon, centerLat, scale, offsetX, offsetY) {
  if (coords.length < 2) return;

  const points = coords.map(c => {
    const world = geoToWorld(c[0], c[1], centerLon, centerLat);
    return worldToScreen(world.x, world.y, 0, scale, offsetX, offsetY);
  });

  // Draw road
  ctx.strokeStyle = `rgb(${ROAD_COLOR.r}, ${ROAD_COLOR.g}, ${ROAD_COLOR.b})`;
  ctx.lineWidth = width * scale * 0.15;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // Draw center line for wider roads
  if (width >= 6) {
    ctx.strokeStyle = `rgb(${ROAD_LINE_COLOR.r}, ${ROAD_LINE_COLOR.g}, ${ROAD_LINE_COLOR.b})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/**
 * Draw building shadow.
 */
function drawShadow(ctx, coords, height, centerLon, centerLat, scale, offsetX, offsetY) {
  if (coords.length < 3) return;

  const shadowOffset = height * scale * 0.4;

  const points = coords.map(c => {
    const world = geoToWorld(c[0], c[1], centerLon, centerLat);
    const screen = worldToScreen(world.x, world.y, 0, scale, offsetX, offsetY);
    return {
      x: screen.x + shadowOffset,
      y: screen.y + shadowOffset * 0.5,
    };
  });

  fillPolygon(ctx, points, { r: 0, g: 0, b: 0 }, 0.2);
}

/**
 * Draw a stroked polygon outline.
 */
function strokePolygon(ctx, points, color, lineWidth = 1) {
  if (points.length < 2) return;

  ctx.strokeStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.stroke();
}

/**
 * Draw an isometric building with outlines.
 */
function drawBuilding(ctx, coords, height, colors, centerLon, centerLat, scale, offsetX, offsetY) {
  if (coords.length < 3) return;

  const outlineColor = colors.outline || OUTLINE_COLOR;

  // Get base and top footprints
  const basePoints = coords.map(c => {
    const world = geoToWorld(c[0], c[1], centerLon, centerLat);
    return worldToScreen(world.x, world.y, 0, scale, offsetX, offsetY);
  });

  const topPoints = coords.map(c => {
    const world = geoToWorld(c[0], c[1], centerLon, centerLat);
    return worldToScreen(world.x, world.y, height, scale, offsetX, offsetY);
  });

  // Collect visible walls
  const walls = [];
  for (let i = 0; i < basePoints.length - 1; i++) {
    const b1 = basePoints[i];
    const b2 = basePoints[i + 1];
    const t1 = topPoints[i];
    const t2 = topPoints[i + 1];

    const edgeDx = b2.x - b1.x;
    const edgeDy = b2.y - b1.y;

    const normal = { x: -edgeDy, y: edgeDx };
    const toCamera = { x: 1, y: 1 };
    const dot = normal.x * toCamera.x + normal.y * toCamera.y;

    if (dot < 0) continue;

    const isRightFacing = edgeDx < 0;
    walls.push({
      points: [b1, b2, t2, t1],
      color: isRightFacing ? colors.right : colors.front,
    });
  }

  // Draw wall fills
  walls.forEach(wall => {
    fillPolygon(ctx, wall.points, wall.color);
  });

  // Draw roof fill
  fillPolygon(ctx, topPoints, colors.top);

  // Draw outlines on top
  walls.forEach(wall => {
    strokePolygon(ctx, wall.points, outlineColor, OUTLINE_WIDTH);
  });

  // Draw roof outline
  strokePolygon(ctx, topPoints, outlineColor, OUTLINE_WIDTH);

  // Draw vertical edge lines for more definition
  for (let i = 0; i < basePoints.length - 1; i++) {
    const b = basePoints[i];
    const t = topPoints[i];

    ctx.strokeStyle = `rgb(${outlineColor.r}, ${outlineColor.g}, ${outlineColor.b})`;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
  }
}

/**
 * Calculate sort key for depth ordering.
 */
function getSortKey(coords, centerLon, centerLat) {
  let sum = 0;
  coords.forEach(c => {
    const world = geoToWorld(c[0], c[1], centerLon, centerLat);
    sum += world.x + world.y;
  });
  return sum / coords.length;
}

/**
 * Check if a coordinate is within bounds.
 */
function isInBounds(lon, lat, bounds) {
  return lon >= bounds.minLon && lon <= bounds.maxLon &&
         lat >= bounds.minLat && lat <= bounds.maxLat;
}

/**
 * Check if any coordinate of a feature is within bounds.
 */
function featureInBounds(coords, bounds) {
  return coords.some(c => isInBounds(c[0], c[1], bounds));
}

async function main() {
  console.log('Isometric Campus Renderer v3');
  console.log('=' .repeat(50));
  console.log('Features: Roads, Shadows, Zoomed scale, Pixel-art effect');
  console.log();

  // Load GeoJSON files
  if (!fs.existsSync(BUILDINGS_PATH)) {
    console.error(`Error: ${BUILDINGS_PATH} not found`);
    process.exit(1);
  }

  const buildingsGeoJson = JSON.parse(fs.readFileSync(BUILDINGS_PATH, 'utf-8'));
  console.log(`Loaded ${buildingsGeoJson.features.length} buildings`);

  let roadsGeoJson = { features: [] };
  if (fs.existsSync(CAMPUS_PATH)) {
    const campusData = JSON.parse(fs.readFileSync(CAMPUS_PATH, 'utf-8'));
    roadsGeoJson.features = campusData.features.filter(f => f.properties?.layer === 'road');
    console.log(`Loaded ${roadsGeoJson.features.length} roads`);
  }

  // Use focus bounds
  const centerLon = (FOCUS_BOUNDS.minLon + FOCUS_BOUNDS.maxLon) / 2;
  const centerLat = (FOCUS_BOUNDS.minLat + FOCUS_BOUNDS.maxLat) / 2;

  // Calculate scale for focused area
  const lonSpan = (FOCUS_BOUNDS.maxLon - FOCUS_BOUNDS.minLon) * 111320 * Math.cos(centerLat * Math.PI / 180);
  const latSpan = (FOCUS_BOUNDS.maxLat - FOCUS_BOUNDS.minLat) * 111320;
  const worldSpan = Math.max(lonSpan, latSpan);
  const scale = (IMAGE_SIZE * 0.45) / worldSpan;

  console.log(`Focus center: ${centerLat.toFixed(4)}, ${centerLon.toFixed(4)}`);
  console.log(`Scale: ${scale.toFixed(4)} px/m (${(scale * 100).toFixed(1)}x zoom)`);

  // Create canvas
  const canvas = createCanvas(IMAGE_SIZE, IMAGE_SIZE);
  const ctx = canvas.getContext('2d');

  const offsetX = IMAGE_SIZE / 2;
  const offsetY = IMAGE_SIZE / 2;

  // Draw grass background with texture
  console.log('Drawing background...');
  ctx.fillStyle = `rgb(${GRASS_COLOR.r}, ${GRASS_COLOR.g}, ${GRASS_COLOR.b})`;
  ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);

  // Grass texture
  for (let y = 0; y < IMAGE_SIZE; y += 3) {
    for (let x = 0; x < IMAGE_SIZE; x += 3) {
      if ((x + y) % 7 < 2) {
        ctx.fillStyle = `rgb(${GRASS_DARK.r}, ${GRASS_DARK.g}, ${GRASS_DARK.b})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  // Filter and prepare roads
  const roads = roadsGeoJson.features
    .filter(f => f.geometry?.type === 'LineString' && featureInBounds(f.geometry.coordinates, FOCUS_BOUNDS))
    .map(f => ({
      coords: f.geometry.coordinates,
      width: f.properties?.width || 5,
      type: f.properties?.highway_type || 'road',
    }));

  // Draw roads
  console.log(`Drawing ${roads.length} roads...`);
  roads.forEach(road => {
    drawRoad(ctx, road.coords, road.width, centerLon, centerLat, scale, offsetX, offsetY);
  });

  // Filter and prepare buildings
  const buildings = buildingsGeoJson.features
    .filter(f => {
      if (f.geometry?.type !== 'Polygon') return false;
      if (!f.properties?.height || f.properties.height <= 0) return false;
      return featureInBounds(f.geometry.coordinates[0], FOCUS_BOUNDS);
    })
    .map(f => ({
      coords: f.geometry.coordinates[0],
      height: Math.max(f.properties.height, 4),
      type: f.properties.building_type || 'default',
      sortKey: getSortKey(f.geometry.coordinates[0], centerLon, centerLat),
    }))
    .sort((a, b) => a.sortKey - b.sortKey);

  console.log(`Drawing ${buildings.length} buildings...`);

  // Draw shadows first
  console.log('  Drawing shadows...');
  buildings.forEach(building => {
    drawShadow(ctx, building.coords, building.height, centerLon, centerLat, scale, offsetX, offsetY);
  });

  // Draw buildings
  console.log('  Drawing buildings...');
  buildings.forEach((building, i) => {
    const colors = BUILDING_COLORS[building.type] || BUILDING_COLORS.default;
    drawBuilding(ctx, building.coords, building.height, colors, centerLon, centerLat, scale, offsetX, offsetY);

    if ((i + 1) % 200 === 0) {
      console.log(`    ${i + 1}/${buildings.length}`);
    }
  });

  // Apply pixel-art post-processing
  console.log('Applying pixel-art effect...');
  applyPixelArtEffect(ctx, IMAGE_SIZE, IMAGE_SIZE);

  // Generate tiles
  console.log('Generating tile pyramid...');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Save full image
  const fullImagePath = path.join(OUTPUT_DIR, 'full-render.png');
  fs.writeFileSync(fullImagePath, canvas.toBuffer('image/png'));
  console.log(`  Full image: ${fullImagePath}`);

  // DZI manifest
  const maxLevel = Math.ceil(Math.log2(IMAGE_SIZE));
  const dziContent = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"
  Format="png"
  Overlap="1"
  TileSize="${TILE_SIZE}">
  <Size Width="${IMAGE_SIZE}" Height="${IMAGE_SIZE}"/>
</Image>`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'osu-campus.dzi'), dziContent);

  // Generate tile levels
  for (let level = 0; level <= maxLevel; level++) {
    const levelDir = path.join(OUTPUT_DIR, 'osu-campus_files', String(level));
    fs.mkdirSync(levelDir, { recursive: true });

    const scaleFactor = Math.pow(2, maxLevel - level);
    const levelSize = Math.ceil(IMAGE_SIZE / scaleFactor);
    const tilesX = Math.ceil(levelSize / TILE_SIZE);
    const tilesY = Math.ceil(levelSize / TILE_SIZE);

    console.log(`  Level ${level}: ${tilesX}x${tilesY} tiles`);

    const levelCanvas = createCanvas(levelSize, levelSize);
    const levelCtx = levelCanvas.getContext('2d');
    levelCtx.imageSmoothingEnabled = false; // Keep pixels crisp
    levelCtx.drawImage(canvas, 0, 0, levelSize, levelSize);

    for (let y = 0; y < tilesY; y++) {
      for (let x = 0; x < tilesX; x++) {
        const tileCanvas = createCanvas(TILE_SIZE, TILE_SIZE);
        const tileCtx = tileCanvas.getContext('2d');
        tileCtx.imageSmoothingEnabled = false;

        const srcX = x * TILE_SIZE;
        const srcY = y * TILE_SIZE;
        const srcW = Math.min(TILE_SIZE, levelSize - srcX);
        const srcH = Math.min(TILE_SIZE, levelSize - srcY);

        tileCtx.fillStyle = `rgb(${GRASS_COLOR.r}, ${GRASS_COLOR.g}, ${GRASS_COLOR.b})`;
        tileCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

        if (srcW > 0 && srcH > 0) {
          tileCtx.drawImage(levelCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
        }

        fs.writeFileSync(path.join(levelDir, `${x}_${y}.png`), tileCanvas.toBuffer('image/png'));
      }
    }
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
