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

// Parse command line args
const args = process.argv.slice(2);
const useRaw = args.includes('--raw');

const INPUT_DIR = path.join(PROJECT_ROOT, 'tiles', useRaw ? 'raw' : 'processed');
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
  console.log(`Source: ${useRaw ? 'raw (geometry only)' : 'processed (with effects)'}`);
  console.log(`Input: ${INPUT_DIR}`);

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

  const manifest: any = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`Tile grid: ${manifest.cols}x${manifest.rows} tiles`);

  // Check if we have a full render or need to stitch tiles
  const fullRenderPath = path.join(INPUT_DIR, manifest.fullImage || 'full-render.png');
  const hasFullRender = fs.existsSync(fullRenderPath);

  let fullWidth: number;
  let fullHeight: number;
  let fullImage: Buffer;

  if (hasFullRender) {
    // Use pre-rendered full image
    console.log(`Using pre-rendered full image: ${fullRenderPath}`);
    fullImage = fs.readFileSync(fullRenderPath);
    const metadata = await sharp(fullImage).metadata();
    fullWidth = metadata.width!;
    fullHeight = metadata.height!;
    console.log(`Full image size: ${fullWidth}x${fullHeight}px`);
  } else {
    // Stitch tiles into full image
    console.log(`Tile size: ${manifest.tileSize}px`);
    fullWidth = manifest.cols * manifest.tileSize;
    fullHeight = manifest.rows * manifest.tileSize;
    console.log(`Full image size: ${fullWidth}x${fullHeight}px (from tiles)`);
    console.log('\nStitching tiles into composite image...');

    const rowBuffers: Buffer[] = [];

    for (let row = 0; row < manifest.rows; row++) {
      const rowTiles: Buffer[] = [];

      for (let col = 0; col < manifest.cols; col++) {
        const tile = manifest.tiles?.find((t: any) => t.col === col && t.row === row);
        const tilePath = tile ? path.join(INPUT_DIR, tile.filename) : null;

        if (tilePath && fs.existsSync(tilePath)) {
          rowTiles.push(fs.readFileSync(tilePath));
        } else {
          const emptyTile = await sharp({
            create: {
              width: manifest.tileSize,
              height: manifest.tileSize,
              channels: 3,
              background: { r: 124, g: 168, b: 74 },
            },
          }).png().toBuffer();
          rowTiles.push(emptyTile);
        }
      }

      const rowImages = rowTiles.map((buf, i) => ({
        input: buf,
        left: i * manifest.tileSize,
        top: 0,
      }));

      const rowBuffer = await sharp({
        create: {
          width: fullWidth,
          height: manifest.tileSize,
          channels: 3,
          background: { r: 124, g: 168, b: 74 },
        },
      }).composite(rowImages).png().toBuffer();

      rowBuffers.push(rowBuffer);
      console.log(`  Row ${row + 1}/${manifest.rows} stitched`);
    }

    const rowComposites = rowBuffers.map((buf, i) => ({
      input: buf,
      left: 0,
      top: i * manifest.tileSize,
    }));

    fullImage = await sharp({
      create: {
        width: fullWidth,
        height: fullHeight,
        channels: 3,
        background: { r: 124, g: 168, b: 74 },
      },
    }).composite(rowComposites).png().toBuffer();

    console.log('  Composite created');
  }

  // Create output directories
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const dziName = 'osu-campus';
  const dziFilesDir = path.join(OUTPUT_DIR, `${dziName}_files`);
  fs.mkdirSync(dziFilesDir, { recursive: true });

  // Save full composite
  const fullImagePath = path.join(OUTPUT_DIR, 'full-composite.png');
  await sharp(fullImage).toFile(fullImagePath);
  console.log(`Full image saved: ${fullImagePath}`);

  // Calculate number of zoom levels
  const maxDimension = Math.max(fullWidth, fullHeight);
  const maxLevel = Math.ceil(Math.log2(maxDimension / DZI_TILE_SIZE));
  console.log(`Zoom levels: 0-${maxLevel}`);

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
