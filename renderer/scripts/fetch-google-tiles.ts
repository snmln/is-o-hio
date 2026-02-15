#!/usr/bin/env node
/**
 * Fetch Google Photorealistic 3D Tiles for the project bounds.
 * Uses Blosm addon in Blender to download and export tiles.
 *
 * Prerequisites:
 *   - Blender 4.3.2+ with Blosm addon installed
 *   - GOOGLE_MAPS_API_KEY environment variable (or in .env)
 *   - Maps Tiles API enabled in Google Cloud Console
 *
 * Get API key: https://console.cloud.google.com/google/maps-apis/credentials
 * Install Blosm: https://prochitecture.gumroad.com/l/blosm
 */

import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const RENDERER_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(RENDERER_ROOT, '..');
const BLENDER_SCRIPT = path.join(RENDERER_ROOT, 'blender', 'fetch_google_tiles.py');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'data', 'google-tiles');

// Focus bounds (same as other scripts)
const FOCUS_BOUNDS = {
  minLon: -83.026,
  maxLon: -83.012,
  minLat: 39.996,
  maxLat: 40.006,
};

interface FetchConfig {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  apiKey: string;
  outputDir: string;
  detailLevel: 'low' | 'medium' | 'high';
  exportFormat: 'obj' | 'gltf' | 'fbx';
}

/**
 * Load Google Maps API key from environment or .env file.
 */
function getApiKey(): string | null {
  // Check environment variable
  if (process.env.GOOGLE_MAPS_API_KEY) {
    return process.env.GOOGLE_MAPS_API_KEY;
  }

  // Try loading from .env file
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/GOOGLE_MAPS_API_KEY=(.+)/);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Find Blender executable path.
 */
function findBlender(): string | null {
  const platform = os.platform();
  const paths: string[] = [];

  if (platform === 'darwin') {
    paths.push('/Applications/Blender.app/Contents/MacOS/Blender');
    paths.push('/Applications/Blender.app/Contents/MacOS/blender');
  } else if (platform === 'win32') {
    paths.push('C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe');
    paths.push('C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe');
    paths.push('C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe');
  } else {
    paths.push('/usr/bin/blender');
    paths.push('/usr/local/bin/blender');
    paths.push('/snap/bin/blender');
  }

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Try 'which' or 'where' command
  try {
    const cmd = platform === 'win32' ? 'where blender' : 'which blender';
    const result = execSync(cmd, { encoding: 'utf-8' }).trim();
    if (result && fs.existsSync(result.split('\n')[0])) {
      return result.split('\n')[0];
    }
  } catch {
    // Command failed
  }

  return null;
}

/**
 * Check Blender version.
 */
function checkBlenderVersion(blenderPath: string): string | null {
  try {
    const result = execSync(`"${blenderPath}" --version`, { encoding: 'utf-8' });
    const match = result.match(/Blender (\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Run Blender with the fetch script.
 */
async function runBlender(blenderPath: string, configPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '--background',
      '--python', BLENDER_SCRIPT,
      '--',
      configPath,
    ];

    console.log(`Running: ${blenderPath} ${args.join(' ')}`);

    const proc = spawn(blenderPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`  ${line}`);
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text && !text.includes('Fra:') && !text.includes('Mem:')) {
        console.error(`  stderr: ${text}`);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Blender exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Blender: ${err.message}`));
    });
  });
}

/**
 * Print manual instructions for Blosm import.
 */
function printManualInstructions(config: FetchConfig): void {
  console.log('\n' + '='.repeat(60));
  console.log('MANUAL IMPORT INSTRUCTIONS');
  console.log('='.repeat(60));
  console.log('\nBlosm requires GUI mode for initial setup. Follow these steps:\n');

  console.log('1. INSTALL BLOSM ADDON:');
  console.log('   - Download from: https://prochitecture.gumroad.com/l/blosm');
  console.log('   - In Blender: Edit > Preferences > Add-ons > Install');
  console.log('   - Enable the "blosm" addon\n');

  console.log('2. CONFIGURE API KEY:');
  console.log('   - In Blender: Edit > Preferences > Add-ons > blosm');
  console.log(`   - Enter your Google Maps API key: ${config.apiKey.substring(0, 15)}...`);
  console.log('   - Click "Save Preferences"\n');

  console.log('3. IMPORT 3D TILES:');
  console.log('   - Press N to open sidebar, find "Blosm" panel');
  console.log('   - Select "3D Tiles" from dropdown');
  console.log('   - Set Source to "Google"');
  console.log('   - Click "select" to open map, or enter coordinates:');
  console.log(`     Min Longitude: ${config.minLon}`);
  console.log(`     Max Longitude: ${config.maxLon}`);
  console.log(`     Min Latitude: ${config.minLat}`);
  console.log(`     Max Latitude: ${config.maxLat}`);
  console.log(`   - Detail Level: ${config.detailLevel}`);
  console.log('   - Click "Import"\n');

  console.log('4. EXPORT:');
  console.log('   - File > Export > glTF 2.0 (.glb/.gltf)');
  console.log(`   - Save to: ${config.outputDir}/google_tiles.glb\n`);

  console.log('5. EXTRACT TEXTURES:');
  console.log('   - In Image Editor, save each texture');
  console.log('   - Or: File > External Data > Unpack Resources\n');

  console.log('='.repeat(60));
}

async function main() {
  console.log('Google 3D Tiles Fetcher');
  console.log('='.repeat(50));

  // Parse arguments
  const args = process.argv.slice(2);

  // Get detail level
  let detailLevel: 'low' | 'medium' | 'high' = 'medium';
  const detailIdx = args.indexOf('--detail');
  if (detailIdx !== -1 && args[detailIdx + 1]) {
    const level = args[detailIdx + 1].toLowerCase();
    if (['low', 'medium', 'high'].includes(level)) {
      detailLevel = level as 'low' | 'medium' | 'high';
    }
  }

  // Get export format
  let exportFormat: 'obj' | 'gltf' | 'fbx' = 'gltf';
  const formatIdx = args.indexOf('--format');
  if (formatIdx !== -1 && args[formatIdx + 1]) {
    const format = args[formatIdx + 1].toLowerCase();
    if (['obj', 'gltf', 'fbx'].includes(format)) {
      exportFormat = format as 'obj' | 'gltf' | 'fbx';
    }
  }

  // Check for manual mode
  const manualMode = args.includes('--manual');

  console.log(`Detail level: ${detailLevel}`);
  console.log(`Export format: ${exportFormat}`);

  // Get API key
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('\nERROR: GOOGLE_MAPS_API_KEY not found!');
    console.error('\nTo get an API key:');
    console.error('  1. Go to: https://console.cloud.google.com/google/maps-apis/credentials');
    console.error('  2. Create a new API key (unrestricted)');
    console.error('  3. Enable "Map Tiles API" in your project');
    console.error('  4. Add to .env file: GOOGLE_MAPS_API_KEY=your_key_here');
    process.exit(1);
  }
  console.log(`API Key: ${apiKey.substring(0, 15)}...`);

  // Build config
  const config: FetchConfig = {
    ...FOCUS_BOUNDS,
    apiKey,
    outputDir: OUTPUT_DIR,
    detailLevel,
    exportFormat,
  };

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // If manual mode, just print instructions
  if (manualMode) {
    printManualInstructions(config);
    process.exit(0);
  }

  // Find Blender
  console.log('\nLocating Blender...');
  const blenderPath = findBlender();
  if (!blenderPath) {
    console.error('ERROR: Blender not found!');
    console.error('Please install Blender 4.3+ from https://www.blender.org/download/');
    process.exit(1);
  }
  console.log(`Found: ${blenderPath}`);

  // Check version
  const version = checkBlenderVersion(blenderPath);
  if (version) {
    console.log(`Version: ${version}`);
    const major = parseFloat(version);
    if (major < 4.3) {
      console.warn(`Warning: Blender ${version} detected. Version 4.3+ recommended for texture unpacking.`);
    }
  }

  // Write config to temp file
  const configPath = path.join(os.tmpdir(), `google-tiles-config-${Date.now()}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Config written to: ${configPath}`);

  // Calculate area info
  const latCenter = (config.minLat + config.maxLat) / 2;
  const lonSpan = (config.maxLon - config.minLon) * 111320 * Math.cos(latCenter * Math.PI / 180);
  const latSpan = (config.maxLat - config.minLat) * 111320;
  console.log(`\nArea: ${(lonSpan / 1000).toFixed(2)} km × ${(latSpan / 1000).toFixed(2)} km`);
  console.log(`Center: ${latCenter.toFixed(4)}, ${((config.minLon + config.maxLon) / 2).toFixed(4)}`);

  // Run Blender
  console.log('\nStarting Blender...');
  console.log('Note: Blosm may require GUI mode for first-time setup.\n');

  try {
    await runBlender(blenderPath, configPath);
    console.log('\nFetch complete!');
    console.log(`Output: ${OUTPUT_DIR}`);

    // Check what was exported
    if (fs.existsSync(path.join(OUTPUT_DIR, 'google_tiles.glb'))) {
      console.log('  - google_tiles.glb');
    }
    if (fs.existsSync(path.join(OUTPUT_DIR, 'google_tiles.obj'))) {
      console.log('  - google_tiles.obj');
    }
    if (fs.existsSync(path.join(OUTPUT_DIR, 'textures'))) {
      const textures = fs.readdirSync(path.join(OUTPUT_DIR, 'textures'));
      console.log(`  - textures/ (${textures.length} files)`);
    }

  } catch (err) {
    console.error('\nBlender script failed.');
    console.log('\nThis is expected if Blosm addon is not installed or configured.');
    printManualInstructions(config);
    process.exit(1);
  } finally {
    // Clean up temp config
    try {
      fs.unlinkSync(configPath);
    } catch {
      // Ignore
    }
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
