#!/usr/bin/env node
/**
 * Batch process tiles with pixel art effects.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { processTile, ProcessOptions } from './process-tile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const INPUT_DIR = path.join(PROJECT_ROOT, 'tiles', 'raw');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'tiles', 'processed');

const PROCESS_OPTIONS: ProcessOptions = {
  ditherStrength: 24,
  addOutlines: true,
  outlineThreshold: 40,
  downscale: 2,
};

async function main() {
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
  console.log(`Options: ${JSON.stringify(PROCESS_OPTIONS)}`);
  console.log();

  // Process each tile
  let processed = 0;
  let errors = 0;

  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, file);

    try {
      await processTile(inputPath, outputPath, PROCESS_OPTIONS);
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
