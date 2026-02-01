/**
 * Dithering algorithms for pixel art post-processing.
 *
 * Implements ordered (Bayer) dithering for a consistent, retro look.
 */

import { RGB, SIMCITY_PALETTE, findNearestColor } from './palette.js';

// 4x4 Bayer matrix for ordered dithering (normalized to 0-1)
const BAYER_4X4 = [
  [0 / 16, 8 / 16, 2 / 16, 10 / 16],
  [12 / 16, 4 / 16, 14 / 16, 6 / 16],
  [3 / 16, 11 / 16, 1 / 16, 9 / 16],
  [15 / 16, 7 / 16, 13 / 16, 5 / 16],
];

// 8x8 Bayer matrix for finer dithering
const BAYER_8X8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => v / 64));

export type DitherMatrix = number[][];

/**
 * Apply ordered (Bayer) dithering to reduce colors.
 */
export function orderedDither(
  imageData: Uint8ClampedArray<ArrayBufferLike>,
  width: number,
  height: number,
  palette: RGB[] = SIMCITY_PALETTE,
  strength: number = 32, // Dither strength (0-255)
  matrix: DitherMatrix = BAYER_4X4
): Uint8ClampedArray<ArrayBuffer> {
  const result = new Uint8ClampedArray(imageData.length);
  const matrixSize = matrix.length;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Get threshold from Bayer matrix
      const threshold = matrix[y % matrixSize][x % matrixSize];
      const offset = (threshold - 0.5) * strength;

      // Apply dither offset to color
      const color: RGB = {
        r: Math.max(0, Math.min(255, imageData[i] + offset)),
        g: Math.max(0, Math.min(255, imageData[i + 1] + offset)),
        b: Math.max(0, Math.min(255, imageData[i + 2] + offset)),
      };

      // Find nearest palette color
      const nearest = findNearestColor(color, palette);

      result[i] = nearest.r;
      result[i + 1] = nearest.g;
      result[i + 2] = nearest.b;
      result[i + 3] = imageData[i + 3]; // Preserve alpha
    }
  }

  return result;
}

/**
 * Apply Floyd-Steinberg error diffusion dithering.
 * This gives a more natural look but can be noisier.
 */
export function floydSteinbergDither(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGB[] = SIMCITY_PALETTE
): Uint8ClampedArray {
  // Create a working copy with floats for error accumulation
  const working = new Float32Array(imageData.length);
  for (let i = 0; i < imageData.length; i++) {
    working[i] = imageData[i];
  }

  const result = new Uint8ClampedArray(imageData.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Get current pixel
      const color: RGB = {
        r: Math.max(0, Math.min(255, working[i])),
        g: Math.max(0, Math.min(255, working[i + 1])),
        b: Math.max(0, Math.min(255, working[i + 2])),
      };

      // Find nearest palette color
      const nearest = findNearestColor(color, palette);

      // Store result
      result[i] = nearest.r;
      result[i + 1] = nearest.g;
      result[i + 2] = nearest.b;
      result[i + 3] = imageData[i + 3];

      // Calculate error
      const errR = color.r - nearest.r;
      const errG = color.g - nearest.g;
      const errB = color.b - nearest.b;

      // Distribute error to neighbors
      // Floyd-Steinberg coefficients: 7/16, 3/16, 5/16, 1/16
      const distribute = (dx: number, dy: number, factor: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = (ny * width + nx) * 4;
          working[ni] += errR * factor;
          working[ni + 1] += errG * factor;
          working[ni + 2] += errB * factor;
        }
      };

      distribute(1, 0, 7 / 16);
      distribute(-1, 1, 3 / 16);
      distribute(0, 1, 5 / 16);
      distribute(1, 1, 1 / 16);
    }
  }

  return result;
}

export { BAYER_4X4, BAYER_8X8 };
