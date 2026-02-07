/**
 * Process a single tile with pixel art effects.
 */

import sharp from 'sharp';
import { RGB, SIMCITY_PALETTE, PaletteSize, getPalette } from './palette.js';
import { orderedDither, DitherMatrix, BAYER_4X4, BAYER_8X8 } from './dither.js';
import { addColorBoundaryOutlines } from './edges.js';

export interface ProcessOptions {
  paletteSize?: PaletteSize;
  palette?: RGB[] | null;
  ditherStrength?: number | null; // null = no dithering
  ditherMatrix?: 4 | 8;
  addOutlines?: boolean;
  outlineThreshold?: number;
  downscale?: number | null; // null or 1 = no downscale
}

const DEFAULT_OPTIONS: ProcessOptions = {
  paletteSize: 32,
  ditherStrength: 24,
  ditherMatrix: 4,
  addOutlines: true,
  outlineThreshold: 40,
  downscale: 2,
};

function getDitherMatrix(size: 4 | 8): DitherMatrix {
  return size === 8 ? BAYER_8X8 : BAYER_4X4;
}

/**
 * Process a tile image with pixel art effects.
 *
 * Processing order: downscale → outlines → dither → upscale
 * Edge detection runs before dithering so it operates on clean image data.
 */
export async function processTile(
  inputPath: string,
  outputPath: string,
  options: ProcessOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Resolve palette from paletteSize if not explicitly provided
  const palette = opts.palette !== undefined
    ? opts.palette
    : getPalette(opts.paletteSize!);

  // Read the input image
  const image = sharp(inputPath);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions: ${inputPath}`);
  }

  let width = metadata.width;
  let height = metadata.height;

  // Downscale for chunkier pixels
  const shouldDownscale = opts.downscale && opts.downscale > 1;
  if (shouldDownscale) {
    width = Math.floor(width / opts.downscale!);
    height = Math.floor(height / opts.downscale!);
  }

  // Get raw pixel data
  const { data, info } = await image
    .resize(width, height, { kernel: 'nearest' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let imageData = new Uint8ClampedArray(data);

  // Step 1: Add outlines BEFORE dithering (edge detection on clean image)
  if (opts.addOutlines) {
    imageData = addColorBoundaryOutlines(
      imageData,
      info.width,
      info.height,
      { r: 32, g: 32, b: 32 },
      opts.outlineThreshold!
    );
  }

  // Step 2: Apply ordered dithering with palette reduction
  if (palette && opts.ditherStrength != null && opts.ditherStrength > 0) {
    const matrix = getDitherMatrix(opts.ditherMatrix!);
    imageData = orderedDither(
      imageData,
      info.width,
      info.height,
      palette,
      opts.ditherStrength,
      matrix
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
  if (shouldDownscale) {
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
