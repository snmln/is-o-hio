/**
 * Process a single tile with pixel art effects.
 */

import sharp from 'sharp';
import { RGB, SIMCITY_PALETTE } from './palette.js';
import { orderedDither, BAYER_4X4 } from './dither.js';
import { addColorBoundaryOutlines } from './edges.js';

export interface ProcessOptions {
  palette?: RGB[];
  ditherStrength?: number;
  addOutlines?: boolean;
  outlineThreshold?: number;
  downscale?: number; // Factor to downscale before processing (for chunkier pixels)
}

const DEFAULT_OPTIONS: ProcessOptions = {
  palette: SIMCITY_PALETTE,
  ditherStrength: 24,
  addOutlines: true,
  outlineThreshold: 40,
  downscale: 2, // Downscale to half size, then process, then upscale
};

/**
 * Process a tile image with pixel art effects.
 */
export async function processTile(
  inputPath: string,
  outputPath: string,
  options: ProcessOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Read the input image
  const image = sharp(inputPath);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions: ${inputPath}`);
  }

  let width = metadata.width;
  let height = metadata.height;

  // Downscale for chunkier pixels
  if (opts.downscale && opts.downscale > 1) {
    width = Math.floor(width / opts.downscale);
    height = Math.floor(height / opts.downscale);
  }

  // Get raw pixel data
  const { data, info } = await image
    .resize(width, height, { kernel: 'nearest' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let imageData = new Uint8ClampedArray(data);

  // Apply ordered dithering with palette reduction
  imageData = orderedDither(
    imageData,
    info.width,
    info.height,
    opts.palette!,
    opts.ditherStrength!,
    BAYER_4X4
  );

  // Add outlines
  if (opts.addOutlines) {
    imageData = addColorBoundaryOutlines(
      imageData,
      info.width,
      info.height,
      { r: 32, g: 32, b: 32 },
      opts.outlineThreshold!
    );
  }

  // Create output image
  let output = sharp(Buffer.from(imageData), {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels as 3 | 4,
    },
  });

  // Upscale back to original size with nearest neighbor
  if (opts.downscale && opts.downscale > 1) {
    output = output.resize(metadata.width, metadata.height, {
      kernel: 'nearest',
    });
  }

  // Save as PNG
  await output.png().toFile(outputPath);
}

/**
 * Get image info without processing.
 */
export async function getImageInfo(imagePath: string): Promise<{
  width: number;
  height: number;
  format: string;
}> {
  const metadata = await sharp(imagePath).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || 'unknown',
  };
}
