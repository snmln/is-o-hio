#!/usr/bin/env node
/**
 * Fetch NAIP satellite imagery from USGS for the project bounds.
 * Downloads PNG at ~2 pixels/meter resolution and caches to data/imagery/.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When compiled, __dirname is dist/scripts. Need to go up to renderer root.
const RENDERER_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(RENDERER_ROOT, '..');
const IMAGERY_DIR = path.join(PROJECT_ROOT, 'data', 'imagery');

// NAIP imagery API endpoint (USGS National Map)
const NAIP_URL = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';

// Focus bounds (same as blender-render.ts)
const FOCUS_BOUNDS = {
  minLon: -83.026,
  maxLon: -83.012,
  minLat: 39.996,
  maxLat: 40.006,
};

// Image resolution - aim for ~2 pixels per meter
// At these bounds, that's roughly 2048x2048
const IMAGE_SIZE = 2048;

interface ImageryMetadata {
  bounds: typeof FOCUS_BOUNDS;
  width: number;
  height: number;
  pixelsPerMeter: number;
  fetchedAt: string;
  source: string;
}

/**
 * Calculate approximate meters for the bounds.
 */
function calculateBoundsMeters(bounds: typeof FOCUS_BOUNDS): { width: number; height: number } {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const metersPerDegreeLat = 111320;

  const width = (bounds.maxLon - bounds.minLon) * metersPerDegreeLon;
  const height = (bounds.maxLat - bounds.minLat) * metersPerDegreeLat;

  return { width, height };
}

/**
 * Fetch NAIP satellite imagery for the given bounds.
 */
async function fetchNAIPImagery(
  bounds: typeof FOCUS_BOUNDS,
  outputDir: string
): Promise<void> {
  console.log('Fetching NAIP satellite imagery...');
  console.log(`Bounds: [${bounds.minLon}, ${bounds.minLat}] to [${bounds.maxLon}, ${bounds.maxLat}]`);

  // Calculate bounds in meters for resolution info
  const boundsMeters = calculateBoundsMeters(bounds);
  console.log(`Coverage: ${boundsMeters.width.toFixed(0)}m x ${boundsMeters.height.toFixed(0)}m`);

  // Build request URL
  const url = new URL(NAIP_URL);
  url.searchParams.set('bbox', `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`);
  url.searchParams.set('bboxSR', '4326');  // WGS84 coordinate system
  url.searchParams.set('size', `${IMAGE_SIZE},${IMAGE_SIZE}`);
  url.searchParams.set('format', 'png');
  url.searchParams.set('f', 'image');
  url.searchParams.set('interpolation', 'RSP_BilinearInterpolation');

  console.log(`Request URL: ${url.toString()}`);

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Fetch the image
  console.log('Downloading...');
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    // API returned an error as JSON
    const errorData = await response.json();
    throw new Error(`API error: ${JSON.stringify(errorData)}`);
  }

  // Get image data
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Save image
  const imagePath = path.join(outputDir, 'satellite.png');
  fs.writeFileSync(imagePath, buffer);
  console.log(`Saved: ${imagePath} (${(buffer.length / 1024).toFixed(0)} KB)`);

  // Calculate and save metadata
  const pixelsPerMeter = IMAGE_SIZE / Math.max(boundsMeters.width, boundsMeters.height);
  const metadata: ImageryMetadata = {
    bounds,
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    pixelsPerMeter,
    fetchedAt: new Date().toISOString(),
    source: 'USGS NAIP (National Agriculture Imagery Program)',
  };

  const metadataPath = path.join(outputDir, 'satellite-metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  console.log(`Saved: ${metadataPath}`);

  console.log(`\nImagery resolution: ${pixelsPerMeter.toFixed(2)} pixels/meter`);
}

async function main() {
  console.log('NAIP Satellite Imagery Fetcher');
  console.log('='.repeat(50));

  try {
    await fetchNAIPImagery(FOCUS_BOUNDS, IMAGERY_DIR);
    console.log('\nDone! Satellite imagery cached to data/imagery/');
  } catch (error) {
    console.error('Error fetching imagery:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
