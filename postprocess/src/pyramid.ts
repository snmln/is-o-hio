#!/usr/bin/env node
/**
 * Generate Deep Zoom Image (DZI) pyramid for OpenSeaDragon.
 *
 * This script:
 * 1. Reads processed tiles from the manifest
 * 2. Stitches them into a single large image
 * 3. Generates a tile pyramid at multiple zoom levels
 * 4. Creates a .dzi manifest file
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const INPUT_DIR = path.join(PROJECT_ROOT, 'tiles', 'processed');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'viewer', 'public', 'tiles');

// DZI settings
const DZI_TILE_SIZE = 256;
const DZI_OVERLAP = 1;
const DZI_FORMAT = 'png';

interface TileManifest {
  tileSize: number;
  worldTileSize: number;
  cols: number;
  rows: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  center: { lon: number; lat: number };
  tiles: { col: number; row: number; filename: string }[];
}

async function main() {
  console.log('Deep Zoom Image Pyramid Generator');
  console.log('=' .repeat(50));

  // Check input directory
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Error: Input directory not found: ${INPUT_DIR}`);
    console.error('Run post-processing first: npm run postprocess');
    process.exit(1);
  }

  // Load manifest
  const manifestPath = path.join(INPUT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const manifest: TileManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`Tile grid: ${manifest.cols}x${manifest.rows} tiles`);
  console.log(`Tile size: ${manifest.tileSize}px`);

  // Calculate full image dimensions
  const fullWidth = manifest.cols * manifest.tileSize;
  const fullHeight = manifest.rows * manifest.tileSize;
  console.log(`Full image size: ${fullWidth}x${fullHeight}px`);

  // Create output directories
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const dziName = 'osu-campus';
  const dziFilesDir = path.join(OUTPUT_DIR, `${dziName}_files`);
  fs.mkdirSync(dziFilesDir, { recursive: true });

  // Calculate number of zoom levels
  const maxDimension = Math.max(fullWidth, fullHeight);
  const maxLevel = Math.ceil(Math.log2(maxDimension / DZI_TILE_SIZE));
  console.log(`Zoom levels: 0-${maxLevel}`);

  // Stitch tiles into full image
  console.log('\nStitching tiles into composite image...');

  // Create composite operation list
  const compositeOps: sharp.OverlayOptions[] = [];

  for (const tile of manifest.tiles) {
    const tilePath = path.join(INPUT_DIR, tile.filename);
    if (!fs.existsSync(tilePath)) {
      console.warn(`  Warning: Tile not found: ${tile.filename}`);
      continue;
    }

    compositeOps.push({
      input: tilePath,
      left: tile.col * manifest.tileSize,
      top: tile.row * manifest.tileSize,
    });
  }

  // Create base image and composite all tiles
  const fullImage = await sharp({
    create: {
      width: fullWidth,
      height: fullHeight,
      channels: 4,
      background: { r: 232, g: 228, b: 212, alpha: 255 }, // Background color
    },
  })
    .composite(compositeOps)
    .png()
    .toBuffer();

  console.log('  Composite created');

  // Generate pyramid levels
  console.log('\nGenerating pyramid levels...');

  for (let level = maxLevel; level >= 0; level--) {
    const scale = Math.pow(2, maxLevel - level);
    const levelWidth = Math.ceil(fullWidth / scale);
    const levelHeight = Math.ceil(fullHeight / scale);

    const levelDir = path.join(dziFilesDir, String(level));
    fs.mkdirSync(levelDir, { recursive: true });

    console.log(`  Level ${level}: ${levelWidth}x${levelHeight}px`);

    // Resize image to this level's size
    const levelImage = await sharp(fullImage)
      .resize(levelWidth, levelHeight, { kernel: 'nearest' })
      .toBuffer();

    // Calculate tiles for this level
    const tilesX = Math.ceil(levelWidth / DZI_TILE_SIZE);
    const tilesY = Math.ceil(levelHeight / DZI_TILE_SIZE);

    // Extract and save each tile
    for (let y = 0; y < tilesY; y++) {
      for (let x = 0; x < tilesX; x++) {
        const left = x * DZI_TILE_SIZE;
        const top = y * DZI_TILE_SIZE;

        // Calculate tile dimensions (may be smaller at edges)
        const tileWidth = Math.min(DZI_TILE_SIZE + DZI_OVERLAP, levelWidth - left);
        const tileHeight = Math.min(DZI_TILE_SIZE + DZI_OVERLAP, levelHeight - top);

        if (tileWidth <= 0 || tileHeight <= 0) continue;

        const tilePath = path.join(levelDir, `${x}_${y}.${DZI_FORMAT}`);

        await sharp(levelImage)
          .extract({
            left,
            top,
            width: tileWidth,
            height: tileHeight,
          })
          .png()
          .toFile(tilePath);
      }
    }
  }

  // Create DZI descriptor file
  const dziContent = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"
  Format="${DZI_FORMAT}"
  Overlap="${DZI_OVERLAP}"
  TileSize="${DZI_TILE_SIZE}">
  <Size Width="${fullWidth}" Height="${fullHeight}"/>
</Image>`;

  const dziPath = path.join(OUTPUT_DIR, `${dziName}.dzi`);
  fs.writeFileSync(dziPath, dziContent);

  // Save landmarks for the viewer
  const landmarks = [
    { name: 'Ohio Stadium', x: 0.5, y: 0.5 }, // Center (will need adjustment based on actual data)
    { name: 'Thompson Library', x: 0.45, y: 0.55 },
    { name: 'Ohio Union', x: 0.55, y: 0.45 },
    { name: 'The Oval', x: 0.48, y: 0.52 },
  ];

  const landmarksPath = path.join(OUTPUT_DIR, 'landmarks.json');
  fs.writeFileSync(landmarksPath, JSON.stringify(landmarks, null, 2));

  console.log('\nPyramid generation complete!');
  console.log(`  DZI file: ${dziPath}`);
  console.log(`  Tiles: ${dziFilesDir}`);
  console.log(`  Landmarks: ${landmarksPath}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
