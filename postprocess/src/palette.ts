/**
 * SimCity 2000-inspired color palette for pixel art post-processing.
 *
 * The palette is designed to evoke the classic isometric city builder aesthetic
 * with warm, muted colors.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

// 32-color SimCity-inspired palette
export const SIMCITY_PALETTE: RGB[] = [
  // Grayscale
  { r: 0, g: 0, b: 0 },       // Black
  { r: 64, g: 64, b: 64 },    // Dark gray
  { r: 128, g: 128, b: 128 }, // Gray
  { r: 192, g: 192, b: 192 }, // Light gray
  { r: 255, g: 255, b: 255 }, // White

  // Browns/Tans (buildings)
  { r: 139, g: 90, b: 43 },   // Brown
  { r: 184, g: 134, b: 11 },  // Dark goldenrod
  { r: 210, g: 180, b: 140 }, // Tan
  { r: 222, g: 184, b: 135 }, // Burlywood
  { r: 245, g: 222, b: 179 }, // Wheat

  // Reds (brick, roofs)
  { r: 139, g: 69, b: 19 },   // Saddle brown
  { r: 165, g: 42, b: 42 },   // Brown red
  { r: 178, g: 34, b: 34 },   // Firebrick
  { r: 187, g: 0, b: 0 },     // OSU Scarlet

  // Greens (grass, parks)
  { r: 34, g: 139, b: 34 },   // Forest green
  { r: 85, g: 107, b: 47 },   // Dark olive
  { r: 107, g: 142, b: 35 },  // Olive drab
  { r: 144, g: 169, b: 85 },  // Yellow green
  { r: 152, g: 251, b: 152 }, // Pale green

  // Blues (water, sky accents)
  { r: 70, g: 130, b: 180 },  // Steel blue
  { r: 65, g: 105, b: 225 },  // Royal blue
  { r: 135, g: 206, b: 235 }, // Sky blue

  // Background/Ground colors
  { r: 232, g: 228, b: 212 }, // Paper (background)
  { r: 205, g: 198, b: 175 }, // Concrete
  { r: 189, g: 183, b: 165 }, // Sidewalk

  // Roof colors
  { r: 112, g: 128, b: 144 }, // Slate gray
  { r: 72, g: 61, b: 139 },   // Dark slate blue
  { r: 105, g: 105, b: 105 }, // Dim gray

  // Accent colors
  { r: 255, g: 215, b: 0 },   // Gold
  { r: 255, g: 165, b: 0 },   // Orange
  { r: 128, g: 0, b: 0 },     // Maroon
  { r: 75, g: 0, b: 130 },    // Indigo
];

// 48-color palette — adds intermediate tones for smoother gradients
export const SIMCITY_PALETTE_48: RGB[] = [
  ...SIMCITY_PALETTE,

  // Extra grayscale
  { r: 32, g: 32, b: 32 },    // Near black
  { r: 96, g: 96, b: 96 },    // Mid-dark gray
  { r: 160, g: 160, b: 160 }, // Mid-light gray
  { r: 224, g: 224, b: 224 }, // Near white

  // Extra browns/tans
  { r: 160, g: 110, b: 60 },  // Mid brown
  { r: 196, g: 160, b: 100 }, // Sandy tan

  // Extra greens
  { r: 60, g: 120, b: 50 },   // Mid green
  { r: 120, g: 155, b: 60 },  // Yellow-green mid

  // Extra blues
  { r: 100, g: 150, b: 200 }, // Light steel blue
  { r: 50, g: 80, b: 160 },   // Medium blue

  // Extra reds/warm
  { r: 200, g: 80, b: 60 },   // Warm red
  { r: 160, g: 50, b: 30 },   // Dark brick

  // Extra roof/ground
  { r: 140, g: 140, b: 130 }, // Warm gray
  { r: 170, g: 165, b: 150 }, // Light concrete
  { r: 90, g: 80, b: 70 },    // Dark earth
  { r: 220, g: 200, b: 160 }, // Pale sand
];

// 64-color palette — even more tones for subtle gradations
export const SIMCITY_PALETTE_64: RGB[] = [
  ...SIMCITY_PALETTE_48,

  // Additional grayscale
  { r: 48, g: 48, b: 48 },    // Charcoal
  { r: 176, g: 176, b: 176 }, // Silver

  // Additional browns
  { r: 120, g: 75, b: 35 },   // Dark brown
  { r: 230, g: 200, b: 160 }, // Light wheat

  // Additional greens
  { r: 70, g: 100, b: 40 },   // Dark moss
  { r: 130, g: 180, b: 100 }, // Light olive
  { r: 40, g: 80, b: 40 },    // Deep forest

  // Additional blues
  { r: 80, g: 120, b: 160 },  // Dusty blue
  { r: 120, g: 170, b: 210 }, // Pale azure

  // Additional warm
  { r: 220, g: 120, b: 50 },  // Burnt orange
  { r: 180, g: 60, b: 50 },   // Terra cotta
  { r: 240, g: 190, b: 100 }, // Light gold

  // Additional neutrals
  { r: 150, g: 130, b: 110 }, // Warm taupe
  { r: 200, g: 190, b: 170 }, // Light stone
  { r: 110, g: 100, b: 90 },  // Dark taupe
  { r: 80, g: 90, b: 100 },   // Cool dark gray
];

export type PaletteSize = 32 | 48 | 64 | 'full';

/**
 * Get a palette by size. Returns null for 'full' (no palette reduction).
 */
export function getPalette(size: PaletteSize): RGB[] | null {
  switch (size) {
    case 32: return SIMCITY_PALETTE;
    case 48: return SIMCITY_PALETTE_48;
    case 64: return SIMCITY_PALETTE_64;
    case 'full': return null;
  }
}

/**
 * Find the nearest color in the palette using Euclidean distance in RGB space.
 */
export function findNearestColor(color: RGB, palette: RGB[] = SIMCITY_PALETTE): RGB {
  let minDistance = Infinity;
  let nearest = palette[0];

  for (const paletteColor of palette) {
    const dr = color.r - paletteColor.r;
    const dg = color.g - paletteColor.g;
    const db = color.b - paletteColor.b;
    const distance = dr * dr + dg * dg + db * db;

    if (distance < minDistance) {
      minDistance = distance;
      nearest = paletteColor;
    }
  }

  return nearest;
}

/**
 * Reduce image colors to the palette without dithering.
 */
export function reduceColors(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  palette: RGB[] = SIMCITY_PALETTE
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(imageData.length);

  for (let i = 0; i < imageData.length; i += 4) {
    const color: RGB = {
      r: imageData[i],
      g: imageData[i + 1],
      b: imageData[i + 2],
    };

    const nearest = findNearestColor(color, palette);

    result[i] = nearest.r;
    result[i + 1] = nearest.g;
    result[i + 2] = nearest.b;
    result[i + 3] = imageData[i + 3]; // Preserve alpha
  }

  return result;
}
