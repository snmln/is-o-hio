#!/usr/bin/env node
/**
 * Batch process tiles with pixel art effects.
 *
 * Usage:
 *   node dist/index.js                              # defaults (classic preset)
 *   node dist/index.js --preset raw                  # no processing
 *   node dist/index.js --preset subtle               # light touch
 *   node dist/index.js --preset retro                # heavy retro look
 *   node dist/index.js --no-dither --no-outlines     # custom flags
 *   node dist/index.js --dither-strength 12 --palette-size 64
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { processTile, ProcessOptions } from './process-tile.js';
import { PaletteSize } from './palette.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const INPUT_DIR = path.join(PROJECT_ROOT, 'tiles', 'raw');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'tiles', 'processed');

// ---------- Presets ----------

const PRESETS: Record<string, ProcessOptions> = {
  raw: {
    downscale: null,
    ditherStrength: null,
    addOutlines: false,
    paletteSize: 'full',
  },
  subtle: {
    downscale: null,
    ditherStrength: 8,
    ditherMatrix: 8,
    addOutlines: true,
    outlineThreshold: 60,
    paletteSize: 64,
  },
  classic: {
    downscale: 2,
    ditherStrength: 24,
    ditherMatrix: 4,
    addOutlines: true,
    outlineThreshold: 40,
    paletteSize: 32,
  },
  retro: {
    downscale: 2,
    ditherStrength: 32,
    ditherMatrix: 4,
    addOutlines: true,
    outlineThreshold: 30,
    paletteSize: 32,
  },
};

// ---------- CLI arg parsing ----------

function parseArgs(argv: string[]): ProcessOptions {
  const args = argv.slice(2);
  let options: ProcessOptions = { ...PRESETS.classic }; // default to classic

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      i++;
      if (i >= args.length) throw new Error(`Missing value for ${arg}`);
      return args[i];
    };

    switch (arg) {
      case '--preset': {
        const name = next();
        if (!(name in PRESETS)) {
          throw new Error(`Unknown preset: ${name}. Available: ${Object.keys(PRESETS).join(', ')}`);
        }
        options = { ...PRESETS[name] };
        break;
      }
      case '--no-dither':
        options.ditherStrength = null;
        break;
      case '--dither-strength':
        options.ditherStrength = parseInt(next(), 10);
        break;
      case '--no-outlines':
        options.addOutlines = false;
        break;
      case '--outline-threshold':
        options.addOutlines = true;
        options.outlineThreshold = parseInt(next(), 10);
        break;
      case '--no-downscale':
        options.downscale = null;
        break;
      case '--downscale':
        options.downscale = parseInt(next(), 10);
        break;
      case '--palette-size': {
        const val = next();
        if (val === 'full') {
          options.paletteSize = 'full';
        } else {
          const n = parseInt(val, 10);
          if (n !== 32 && n !== 48 && n !== 64) {
            throw new Error(`Invalid palette size: ${val}. Must be 32, 48, 64, or full`);
          }
          options.paletteSize = n as PaletteSize;
        }
        break;
      }
      case '--dither-matrix': {
        const val = parseInt(next(), 10);
        if (val !== 4 && val !== 8) {
          throw new Error(`Invalid dither matrix size: ${val}. Must be 4 or 8`);
        }
        options.ditherMatrix = val as 4 | 8;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Pixel Art Post-Processor

Usage: node dist/index.js [options]

Options:
  --preset <name>          Use a preset: raw, subtle, classic (default), retro
  --no-dither              Disable dithering
  --dither-strength <n>    Dither strength (default: 24)
  --dither-matrix <4|8>    Bayer matrix size (default: 4)
  --no-outlines            Disable outline detection
  --outline-threshold <n>  Color diff threshold for outlines (default: 40)
  --no-downscale           Disable downscaling
  --downscale <n>          Downscale factor (default: 2)
  --palette-size <n>       Palette size: 32, 48, 64, or full (default: 32)
  -h, --help               Show this help

Presets:
  raw      No processing (passthrough)
  subtle   Light touch: no downscale, 8x8 dither at strength 8, 64-color palette
  classic  Default: 2x downscale, 4x4 dither at strength 24, 32-color palette
  retro    Heavy: 2x downscale, 4x4 dither at strength 32, 32-color palette
`.trim());
}

function describeOptions(opts: ProcessOptions): string {
  const parts: string[] = [];
  if (opts.downscale && opts.downscale > 1) {
    parts.push(`downscale: ${opts.downscale}x`);
  } else {
    parts.push('downscale: off');
  }
  if (opts.ditherStrength != null && opts.ditherStrength > 0) {
    parts.push(`dither: ${opts.ditherStrength} (${opts.ditherMatrix || 4}x${opts.ditherMatrix || 4})`);
  } else {
    parts.push('dither: off');
  }
  parts.push(`outlines: ${opts.addOutlines ? `on (threshold ${opts.outlineThreshold})` : 'off'}`);
  parts.push(`palette: ${opts.paletteSize || 32}`);
  return parts.join(', ');
}

// ---------- Main ----------

async function main() {
  const options = parseArgs(process.argv);

  console.log('Pixel Art Post-Processor');
  console.log('=' .repeat(50));

  // Check input directory
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Error: Input directory not found: ${INPUT_DIR}`);
    console.error('Run the renderer first: npm run render');
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Get list of PNG files
  const files = fs.readdirSync(INPUT_DIR).filter((f) => f.endsWith('.png'));

  if (files.length === 0) {
    console.error('No PNG files found in input directory');
    process.exit(1);
  }

  console.log(`Found ${files.length} tiles to process`);
  console.log(`Options: ${describeOptions(options)}`);
  console.log();

  // Process each tile
  let processed = 0;
  let errors = 0;

  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, file);

    try {
      await processTile(inputPath, outputPath, options);
      processed++;
      const progress = ((processed / files.length) * 100).toFixed(1);
      process.stdout.write(`\r[${progress}%] Processed ${file}`);
    } catch (err) {
      errors++;
      console.error(`\nError processing ${file}:`, err);
    }
  }

  console.log('\n');
  console.log('Processing complete!');
  console.log(`  Processed: ${processed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Output: ${OUTPUT_DIR}`);

  // Copy manifest
  const manifestSrc = path.join(INPUT_DIR, 'manifest.json');
  const manifestDst = path.join(OUTPUT_DIR, 'manifest.json');
  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, manifestDst);
    console.log(`  Manifest copied to: ${manifestDst}`);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
