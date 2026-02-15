#!/usr/bin/env node
/**
 * Fetch Mapillary street-level images for building wall textures.
 * Uses Mapillary API v4 to find images near buildings and match them to wall orientations.
 *
 * Requires MAPILLARY_TOKEN environment variable.
 * Get a free token at: https://www.mapillary.com/dashboard/developers
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When compiled, __dirname is dist/scripts. Need to go up to renderer root.
const RENDERER_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(RENDERER_ROOT, '..');
const DATA_PATH = path.join(PROJECT_ROOT, 'data', 'processed', 'osu-buildings.geojson');
const STREETVIEW_DIR = path.join(PROJECT_ROOT, 'data', 'streetview');

// Mapillary API v4
const MAPILLARY_API = 'https://graph.mapillary.com';

// Focus bounds (same as blender-render.ts)
const FOCUS_BOUNDS = {
  minLon: -83.026,
  maxLon: -83.012,
  minLat: 39.996,
  maxLat: 40.006,
};

// Configuration
const MAX_DISTANCE_METERS = 50; // Max distance from building centroid to image
const ANGLE_TOLERANCE = 30; // Degrees tolerance for matching compass angle to wall
const IMAGE_LIMIT = 2000; // Max images to fetch from API

interface MapillaryImage {
  id: string;
  compass_angle: number;
  geometry: { type: string; coordinates: [number, number] };
  thumb_1024_url?: string;
  captured_at: number;
}

interface Building {
  id: string;
  coords: number[][];
  height: number;
  type: string;
  centroid: [number, number];
}

interface WallTexture {
  direction: string;
  angle: number;
  imagePath: string;
  imageId: string;
}

interface BuildingTextures {
  buildingId: string;
  walls: WallTexture[];
}

/**
 * Load Mapillary token from environment.
 */
function getMapillaryToken(): string {
  // Check environment variable
  const token = process.env.MAPILLARY_TOKEN;
  if (token) {
    return token;
  }

  // Try loading from .env file
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/MAPILLARY_TOKEN=(.+)/);
    if (match) {
      return match[1].trim();
    }
  }

  throw new Error(
    'MAPILLARY_TOKEN not found!\n' +
    'Set it as an environment variable or add it to .env file.\n' +
    'Get a free token at: https://www.mapillary.com/dashboard/developers'
  );
}

/**
 * Calculate distance between two lat/lon points in meters.
 */
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate centroid of a polygon.
 */
function calculateCentroid(coords: number[][]): [number, number] {
  let sumLon = 0;
  let sumLat = 0;
  const n = coords.length;

  for (const [lon, lat] of coords) {
    sumLon += lon;
    sumLat += lat;
  }

  return [sumLon / n, sumLat / n];
}

/**
 * Calculate wall angles from building polygon edges.
 * Returns array of [direction label, angle in degrees] pairs.
 */
function calculateWallAngles(coords: number[][]): Array<[string, number]> {
  const walls: Array<[string, number]> = [];

  // Process each edge
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];

    // Calculate edge angle (direction the wall faces, perpendicular to edge)
    const dx = lon2 - lon1;
    const dy = lat2 - lat1;
    // Edge direction
    const edgeAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    // Wall faces perpendicular to edge (add 90 degrees)
    let wallAngle = (edgeAngle + 90 + 360) % 360;

    // Determine cardinal direction label
    let direction: string;
    if (wallAngle >= 315 || wallAngle < 45) {
      direction = 'east';
    } else if (wallAngle >= 45 && wallAngle < 135) {
      direction = 'north';
    } else if (wallAngle >= 135 && wallAngle < 225) {
      direction = 'west';
    } else {
      direction = 'south';
    }

    // Only add unique directions (first wall of each orientation)
    if (!walls.some(([d]) => d === direction)) {
      walls.push([direction, wallAngle]);
    }
  }

  return walls;
}

/**
 * Check if image compass angle matches wall orientation.
 */
function angleMatchesWall(compassAngle: number, wallAngle: number): boolean {
  const diff = Math.abs(compassAngle - wallAngle) % 360;
  const normalizedDiff = Math.min(diff, 360 - diff);
  return normalizedDiff < ANGLE_TOLERANCE;
}

/**
 * Fetch all Mapillary images in the bounding box.
 */
async function fetchMapillaryImages(
  bounds: typeof FOCUS_BOUNDS,
  token: string
): Promise<MapillaryImage[]> {
  const url = new URL(`${MAPILLARY_API}/images`);
  url.searchParams.set('bbox', `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`);
  url.searchParams.set('fields', 'id,compass_angle,geometry,thumb_1024_url,captured_at');
  url.searchParams.set('limit', IMAGE_LIMIT.toString());
  url.searchParams.set('access_token', token);

  console.log(`Fetching Mapillary images in bounds...`);

  const response = await fetch(url.toString());

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mapillary API error: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const data = await response.json();
  const images = data.data as MapillaryImage[];

  console.log(`Found ${images.length} Mapillary images`);
  return images;
}

/**
 * Download an image from URL to local path.
 */
async function downloadImage(imageUrl: string, outputPath: string): Promise<void> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(outputPath, buffer);
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
    .map((f: any, index: number) => {
      const coords = f.geometry.coordinates[0];
      return {
        id: f.properties?.osm_id || `building_${index}`,
        coords,
        height: Math.max(f.properties.height, 3),
        type: f.properties.building_type || 'default',
        centroid: calculateCentroid(coords),
      };
    });
}

/**
 * Match images to building walls and download textures.
 */
async function matchAndDownloadTextures(
  buildings: Building[],
  images: MapillaryImage[],
  outputDir: string
): Promise<BuildingTextures[]> {
  console.log(`\nMatching images to ${buildings.length} buildings...`);

  const results: BuildingTextures[] = [];
  let downloadCount = 0;

  for (const building of buildings) {
    const [centLon, centLat] = building.centroid;
    const buildingDir = path.join(outputDir, building.id);

    // Find images within MAX_DISTANCE_METERS of building centroid
    const nearbyImages = images.filter(img => {
      const [imgLon, imgLat] = img.geometry.coordinates;
      const dist = haversineDistance(centLat, centLon, imgLat, imgLon);
      return dist <= MAX_DISTANCE_METERS;
    });

    if (nearbyImages.length === 0) {
      continue;
    }

    // Calculate wall angles for this building
    const wallAngles = calculateWallAngles(building.coords);
    const wallTextures: WallTexture[] = [];

    for (const [direction, angle] of wallAngles) {
      // Find images that match this wall orientation
      const matchingImages = nearbyImages.filter(img =>
        angleMatchesWall(img.compass_angle, angle) && img.thumb_1024_url
      );

      if (matchingImages.length === 0) {
        continue;
      }

      // Sort by captured_at (prefer newer images) and pick the best one
      matchingImages.sort((a, b) => b.captured_at - a.captured_at);
      const bestImage = matchingImages[0];

      // Create building directory if needed
      if (!fs.existsSync(buildingDir)) {
        fs.mkdirSync(buildingDir, { recursive: true });
      }

      // Download the image
      const imagePath = path.join(buildingDir, `wall_${direction}.jpg`);
      try {
        await downloadImage(bestImage.thumb_1024_url!, imagePath);
        downloadCount++;

        wallTextures.push({
          direction,
          angle,
          imagePath,
          imageId: bestImage.id,
        });

        process.stdout.write(`\r  Downloaded ${downloadCount} wall textures...`);
      } catch (err) {
        console.warn(`\n  Warning: Failed to download image ${bestImage.id}: ${err}`);
      }
    }

    if (wallTextures.length > 0) {
      results.push({
        buildingId: building.id,
        walls: wallTextures,
      });
    }
  }

  console.log(`\n  Total: ${downloadCount} wall textures for ${results.length} buildings`);
  return results;
}

/**
 * Write manifest file for Blender to consume.
 */
function writeManifest(textures: BuildingTextures[], outputDir: string): void {
  const manifest = {
    fetchedAt: new Date().toISOString(),
    source: 'Mapillary',
    buildings: textures.map(bt => ({
      buildingId: bt.buildingId,
      walls: bt.walls.reduce((acc, wt) => {
        acc[wt.direction] = {
          path: wt.imagePath,
          imageId: wt.imageId,
          angle: wt.angle,
        };
        return acc;
      }, {} as Record<string, any>),
    })),
  };

  const manifestPath = path.join(outputDir, 'streetview-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written: ${manifestPath}`);
}

async function main() {
  console.log('Mapillary Street-Level Image Fetcher');
  console.log('='.repeat(50));

  // Get token
  let token: string;
  try {
    token = getMapillaryToken();
    console.log('Mapillary token: Found');
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // Load buildings
  console.log('\nLoading building data...');
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Error: ${DATA_PATH} not found`);
    process.exit(1);
  }

  const geojson = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const buildings = filterBuildings(geojson);
  console.log(`Found ${buildings.length} buildings in focus area`);

  if (buildings.length === 0) {
    console.error('No buildings found!');
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(STREETVIEW_DIR, { recursive: true });

  // Fetch Mapillary images
  console.log('\nFetching Mapillary images...');
  const images = await fetchMapillaryImages(FOCUS_BOUNDS, token);

  if (images.length === 0) {
    console.log('No Mapillary images found in this area.');
    console.log('Wall textures will fall back to procedural generation.');
    process.exit(0);
  }

  // Match and download
  const textures = await matchAndDownloadTextures(buildings, images, STREETVIEW_DIR);

  if (textures.length > 0) {
    // Write manifest
    writeManifest(textures, STREETVIEW_DIR);
    console.log(`\nDone! Street-level textures saved to ${STREETVIEW_DIR}`);
  } else {
    console.log('\nNo matching wall textures found.');
    console.log('This could mean:');
    console.log('  - No Mapillary coverage in this specific area');
    console.log('  - Images don\'t match building wall orientations');
    console.log('Wall textures will fall back to procedural generation.');
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
