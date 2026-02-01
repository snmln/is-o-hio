#!/usr/bin/env node
/**
 * Generate placeholder tiles for development/testing.
 * Creates a SimCity-style grid pattern so the viewer has something to display.
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, '..', 'viewer', 'public', 'tiles');
const TILE_SIZE = 256;
const IMAGE_SIZE = 4096;
const MAX_LEVEL = Math.ceil(Math.log2(IMAGE_SIZE));

// SimCity-inspired colors
const COLORS = {
  background: { r: 232, g: 228, b: 212 },
  grass: { r: 144, g: 169, b: 85 },
  grassDark: { r: 120, g: 145, b: 65 },
  building1: { r: 184, g: 134, b: 11 },   // Gold/brick
  building2: { r: 178, g: 102, b: 85 },   // Terracotta
  building3: { r: 160, g: 160, b: 160 },  // Gray
  roof1: { r: 139, g: 90, b: 43 },        // Brown roof
  roof2: { r: 100, g: 100, b: 110 },      // Slate roof
  road: { r: 96, g: 96, b: 96 },
  roadLine: { r: 200, g: 200, b: 80 },
  stadium: { r: 187, g: 0, b: 0 },        // OSU Scarlet
  stadiumField: { r: 34, g: 139, b: 34 }, // Green field
};

// Pseudo-random based on position (deterministic)
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return h ^ (h >> 16);
}

async function createFullImage() {
  const pixels = Buffer.alloc(IMAGE_SIZE * IMAGE_SIZE * 3);

  // Block size for city grid (in pixels)
  const blockSize = 128;
  const roadWidth = 12;
  const sidewalkWidth = 4;

  for (let py = 0; py < IMAGE_SIZE; py++) {
    for (let px = 0; px < IMAGE_SIZE; px++) {
      const i = (py * IMAGE_SIZE + px) * 3;

      // Grid position
      const blockX = Math.floor(px / blockSize);
      const blockY = Math.floor(py / blockSize);
      const inBlockX = px % blockSize;
      const inBlockY = py % blockSize;

      let color = COLORS.grass;

      // Vary grass color slightly
      if ((px + py) % 3 === 0) {
        color = COLORS.grassDark;
      }

      // Roads
      const onRoadX = inBlockX < roadWidth;
      const onRoadY = inBlockY < roadWidth;

      if (onRoadX || onRoadY) {
        color = COLORS.road;
        // Center line
        if (onRoadX && inBlockY >= roadWidth / 2 - 1 && inBlockY <= roadWidth / 2 + 1 && inBlockY % 8 < 4) {
          color = COLORS.roadLine;
        }
        if (onRoadY && inBlockX >= roadWidth / 2 - 1 && inBlockX <= roadWidth / 2 + 1 && inBlockX % 8 < 4) {
          color = COLORS.roadLine;
        }
      }
      // Sidewalks
      else if (inBlockX < roadWidth + sidewalkWidth || inBlockY < roadWidth + sidewalkWidth) {
        color = COLORS.background;
      }
      // Buildings
      else {
        const buildingMargin = roadWidth + sidewalkWidth + 8;
        const inBuildingZone = inBlockX > buildingMargin && inBlockY > buildingMargin &&
                               inBlockX < blockSize - 8 && inBlockY < blockSize - 8;

        if (inBuildingZone) {
          const h = hash(blockX, blockY);
          const buildingType = h % 10;

          // Stadium in center area
          if (blockX >= 14 && blockX <= 17 && blockY >= 14 && blockY <= 17) {
            // Ohio Stadium placeholder
            const stadiumCenterX = 16 * blockSize;
            const stadiumCenterY = 16 * blockSize;
            const dx = px - stadiumCenterX;
            const dy = py - stadiumCenterY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 180) {
              if (dist < 120) {
                color = COLORS.stadiumField; // Field
              } else {
                color = COLORS.stadium; // Stands
              }
            } else {
              color = COLORS.grass;
            }
          }
          // Regular buildings
          else if (buildingType < 7) {
            // Building footprint within block
            const bw = 40 + (h % 40);
            const bh = 40 + ((h >> 8) % 40);
            const bx = buildingMargin + ((h >> 4) % 20);
            const by = buildingMargin + ((h >> 12) % 20);

            if (inBlockX >= bx && inBlockX < bx + bw && inBlockY >= by && inBlockY < by + bh) {
              // Building colors based on hash
              const colorChoice = (h >> 16) % 3;
              if (colorChoice === 0) color = COLORS.building1;
              else if (colorChoice === 1) color = COLORS.building2;
              else color = COLORS.building3;

              // Roof (top portion of building)
              if (inBlockY < by + 10) {
                color = (h >> 20) % 2 === 0 ? COLORS.roof1 : COLORS.roof2;
              }

              // Windows
              const winX = (inBlockX - bx) % 12;
              const winY = (inBlockY - by) % 10;
              if (winX >= 2 && winX <= 6 && winY >= 3 && winY <= 7 && inBlockY >= by + 10) {
                // Darken for window
                color = { r: color.r - 40, g: color.g - 40, b: color.b - 30 };
              }
            }
          }
        }
      }

      pixels[i] = Math.max(0, Math.min(255, color.r));
      pixels[i + 1] = Math.max(0, Math.min(255, color.g));
      pixels[i + 2] = Math.max(0, Math.min(255, color.b));
    }
  }

  return sharp(pixels, { raw: { width: IMAGE_SIZE, height: IMAGE_SIZE, channels: 3 } }).png().toBuffer();
}

async function main() {
  console.log('Generating placeholder city tiles...');

  // Create the full image first
  console.log(`  Creating ${IMAGE_SIZE}x${IMAGE_SIZE} base image...`);
  const fullImage = await createFullImage();

  // Create DZI file
  const dziContent = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"
  Format="png"
  Overlap="1"
  TileSize="${TILE_SIZE}">
  <Size Width="${IMAGE_SIZE}" Height="${IMAGE_SIZE}"/>
</Image>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'osu-campus.dzi'), dziContent);

  // Generate tiles for each level
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const levelDir = path.join(OUTPUT_DIR, 'osu-campus_files', String(level));
    fs.mkdirSync(levelDir, { recursive: true });

    const scale = Math.pow(2, MAX_LEVEL - level);
    const levelSize = Math.ceil(IMAGE_SIZE / scale);
    const tilesX = Math.ceil(levelSize / TILE_SIZE);
    const tilesY = Math.ceil(levelSize / TILE_SIZE);

    console.log(`  Level ${level}: ${tilesX}x${tilesY} tiles (${levelSize}px)`);

    // Resize full image to this level's size
    const levelImage = await sharp(fullImage)
      .resize(levelSize, levelSize, { kernel: 'nearest' })
      .raw()
      .toBuffer();

    for (let y = 0; y < tilesY; y++) {
      for (let x = 0; x < tilesX; x++) {
        const left = x * TILE_SIZE;
        const top = y * TILE_SIZE;
        const tileWidth = Math.min(TILE_SIZE, levelSize - left);
        const tileHeight = Math.min(TILE_SIZE, levelSize - top);

        if (tileWidth <= 0 || tileHeight <= 0) continue;

        const tilePath = path.join(levelDir, `${x}_${y}.png`);

        // Extract tile from level image
        await sharp(levelImage, { raw: { width: levelSize, height: levelSize, channels: 3 } })
          .extract({ left, top, width: tileWidth, height: tileHeight })
          .png()
          .toFile(tilePath);
      }
    }
  }

  console.log('Done! Placeholder city tiles generated.');
}

main().catch(console.error);
