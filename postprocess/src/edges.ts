/**
 * Edge detection for pixel art outlines.
 *
 * Adds dark outlines around shapes for that classic pixel art look.
 */

import { RGB } from './palette.js';

/**
 * Simple Sobel edge detection.
 */
export function detectEdges(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 30
): Uint8ClampedArray {
  const edges = new Uint8ClampedArray(width * height);

  // Sobel kernels
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0;
      let gy = 0;

      // Apply Sobel kernels
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const i = ((y + ky) * width + (x + kx)) * 4;
          // Use luminance
          const lum = 0.299 * imageData[i] + 0.587 * imageData[i + 1] + 0.114 * imageData[i + 2];
          const ki = (ky + 1) * 3 + (kx + 1);
          gx += lum * sobelX[ki];
          gy += lum * sobelY[ki];
        }
      }

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edges[y * width + x] = magnitude > threshold ? 255 : 0;
    }
  }

  return edges;
}

/**
 * Add dark outlines to an image based on edge detection.
 */
export function addOutlines(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  outlineColor: RGB = { r: 32, g: 32, b: 32 },
  threshold: number = 30
): Uint8ClampedArray {
  const edges = detectEdges(imageData, width, height, threshold);
  const result = new Uint8ClampedArray(imageData);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ei = y * width + x;
      if (edges[ei] > 0) {
        const i = ei * 4;
        result[i] = outlineColor.r;
        result[i + 1] = outlineColor.g;
        result[i + 2] = outlineColor.b;
        // Keep alpha
      }
    }
  }

  return result;
}

/**
 * Detect and add outlines only at color boundaries (better for pixel art).
 */
export function addColorBoundaryOutlines(
  imageData: Uint8ClampedArray<ArrayBufferLike>,
  width: number,
  height: number,
  outlineColor: RGB = { r: 32, g: 32, b: 32 },
  colorThreshold: number = 50
): Uint8ClampedArray<ArrayBuffer> {
  const result = new Uint8ClampedArray(imageData);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Skip transparent pixels
      if (imageData[i + 3] < 128) continue;

      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];

      // Check neighbors
      let isEdge = false;

      const checkNeighbor = (dx: number, dy: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;

        const ni = (ny * width + nx) * 4;
        const nr = imageData[ni];
        const ng = imageData[ni + 1];
        const nb = imageData[ni + 2];
        const na = imageData[ni + 3];

        // Check for significant color difference or transparency boundary
        if (na < 128) {
          isEdge = true;
          return;
        }

        const diff = Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb);
        if (diff > colorThreshold) {
          isEdge = true;
        }
      };

      // Check 4-connected neighbors
      checkNeighbor(-1, 0);
      checkNeighbor(1, 0);
      checkNeighbor(0, -1);
      checkNeighbor(0, 1);

      if (isEdge) {
        // Darken the pixel instead of replacing it
        result[i] = Math.max(0, r - 60);
        result[i + 1] = Math.max(0, g - 60);
        result[i + 2] = Math.max(0, b - 60);
      }
    }
  }

  return result;
}
