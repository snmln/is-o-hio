#!/usr/bin/env node
/**
 * Node.js wrapper for Blender-based tile rendering.
 * Spawns Blender subprocess with Python script for isometric rendering.
 */

import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When compiled, __dirname is dist/scripts. Need to go up to renderer root.
const RENDERER_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(RENDERER_ROOT, '..');
const DATA_PATH = path.join(PROJECT_ROOT, 'data', 'processed', 'osu-buildings.geojson');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'tiles', 'raw');
const BLENDER_SCRIPT = path.join(RENDERER_ROOT, 'blender', 'render_tiles.py');
const IMAGERY_DIR = path.join(PROJECT_ROOT, 'data', 'imagery');
const SATELLITE_IMAGE = path.join(IMAGERY_DIR, 'satellite.png');
const SATELLITE_METADATA = path.join(IMAGERY_DIR, 'satellite-metadata.json');
const STREETVIEW_DIR = path.join(PROJECT_ROOT, 'data', 'streetview');
const STREETVIEW_MANIFEST = path.join(STREETVIEW_DIR, 'streetview-manifest.json');
const GOOGLE_TILES_DIR = path.join(PROJECT_ROOT, 'data', 'google-tiles');
const GOOGLE_TILES_MODEL = path.join(GOOGLE_TILES_DIR, 'google_tiles.glb');
const GOOGLE_TILES_METADATA = path.join(GOOGLE_TILES_DIR, 'google-tiles-metadata.json');

// Tile configuration (must match Three.js implementation)
const TILE_SIZE = 512;
const WORLD_TILE_SIZE = 15;

// Focus bounds (same as batch-render.ts)
const FOCUS_BOUNDS = {
  minLon: -83.026,
  maxLon: -83.012,
  minLat: 39.996,
  maxLat: 40.006,
};

interface Building {
  id?: string;
  coords: number[][];
  height: number;
  type: string;
}

interface SceneData {
  centerLon: number;
  centerLat: number;
  scale: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

interface SatelliteConfig {
  texturePath: string;
  bounds: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  };
}

interface StreetviewWallInfo {
  path: string;
  imageId: string;
  angle: number;
}

interface StreetviewConfig {
  [buildingId: string]: {
    [direction: string]: StreetviewWallInfo;
  };
}

interface GoogleTilesConfig {
  modelPath: string;
  bounds?: {
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
  };
  replaceBuildings: boolean;
  applyFreestyle: boolean;
  transform: boolean;
  offset?: [number, number, number];
  scale?: number;
  rotation?: [number, number, number];
}

interface BlenderConfig {
  buildings: Building[];
  sceneData: SceneData;
  outputDir: string;
  tileSize: number;
  worldTileSize: number;
  satelliteConfig?: SatelliteConfig;
  streetviewConfig?: StreetviewConfig;
  googleTilesConfig?: GoogleTilesConfig;
}

/**
 * Load satellite imagery config if available.
 */
function loadSatelliteConfig(): SatelliteConfig | null {
  if (!fs.existsSync(SATELLITE_IMAGE) || !fs.existsSync(SATELLITE_METADATA)) {
    return null;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(SATELLITE_METADATA, 'utf-8'));
    return {
      texturePath: SATELLITE_IMAGE,
      bounds: metadata.bounds,
    };
  } catch (err) {
    console.warn('Warning: Could not load satellite metadata:', err);
    return null;
  }
}

/**
 * Load streetview wall texture config if available.
 */
function loadStreetviewConfig(): StreetviewConfig | null {
  if (!fs.existsSync(STREETVIEW_MANIFEST)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(STREETVIEW_MANIFEST, 'utf-8'));
    const config: StreetviewConfig = {};

    for (const building of manifest.buildings || []) {
      if (building.buildingId && building.walls) {
        config[building.buildingId] = building.walls;
      }
    }

    return Object.keys(config).length > 0 ? config : null;
  } catch (err) {
    console.warn('Warning: Could not load streetview manifest:', err);
    return null;
  }
}

/**
 * Load Google 3D Tiles config if available.
 */
function loadGoogleTilesConfig(replaceBuildings: boolean): GoogleTilesConfig | null {
  // Check for glTF model first, then OBJ
  let modelPath: string | null = null;

  if (fs.existsSync(GOOGLE_TILES_MODEL)) {
    modelPath = GOOGLE_TILES_MODEL;
  } else {
    const objPath = path.join(GOOGLE_TILES_DIR, 'google_tiles.obj');
    if (fs.existsSync(objPath)) {
      modelPath = objPath;
    }
  }

  if (!modelPath) {
    return null;
  }

  // Load metadata if available
  let bounds: GoogleTilesConfig['bounds'] | undefined;
  if (fs.existsSync(GOOGLE_TILES_METADATA)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(GOOGLE_TILES_METADATA, 'utf-8'));
      bounds = metadata.bounds;
    } catch {
      // Ignore metadata errors
    }
  }

  return {
    modelPath,
    bounds,
    replaceBuildings,
    applyFreestyle: true,
    transform: true,
  };
}

/**
 * Find Blender executable path.
 */
function findBlender(): string | null {
  const platform = os.platform();

  // Common Blender paths
  const paths: string[] = [];

  if (platform === 'darwin') {
    paths.push('/Applications/Blender.app/Contents/MacOS/Blender');
    paths.push('/Applications/Blender.app/Contents/MacOS/blender');
  } else if (platform === 'win32') {
    paths.push('C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe');
    paths.push('C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe');
  } else {
    paths.push('/usr/bin/blender');
    paths.push('/usr/local/bin/blender');
    paths.push('/snap/bin/blender');
  }

  // Check each path
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
 * Filter buildings within focus bounds.
 */
function filterBuildings(geojson: any): Building[] {
  return geojson.features
    .filter((f: any) => {
      if (f.geometry?.type !== 'Polygon') return false;
      if (!f.properties?.height || f.properties.height <= 0) return false;

      // Check if any point is within bounds
      return f.geometry.coordinates[0].some((c: number[]) =>
        c[0] >= FOCUS_BOUNDS.minLon && c[0] <= FOCUS_BOUNDS.maxLon &&
        c[1] >= FOCUS_BOUNDS.minLat && c[1] <= FOCUS_BOUNDS.maxLat
      );
    })
    .map((f: any, index: number) => ({
      id: f.properties?.osm_id || `building_${index}`,
      coords: f.geometry.coordinates[0],
      height: Math.max(f.properties.height, 3),
      type: f.properties.building_type || 'default',
    }));
}

/**
 * Calculate scene parameters from buildings.
 */
function calculateSceneData(buildings: Building[]): SceneData {
  const centerLon = (FOCUS_BOUNDS.minLon + FOCUS_BOUNDS.maxLon) / 2;
  const centerLat = (FOCUS_BOUNDS.minLat + FOCUS_BOUNDS.maxLat) / 2;

  const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const metersPerDegreeLat = 111320;

  const lonSpan = (FOCUS_BOUNDS.maxLon - FOCUS_BOUNDS.minLon) * metersPerDegreeLon;
  const latSpan = (FOCUS_BOUNDS.maxLat - FOCUS_BOUNDS.minLat) * metersPerDegreeLat;

  // Scale to fit in reasonable scene size
  const scale = 100 / Math.max(lonSpan, latSpan);

  // Calculate bounds in scene coordinates
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  buildings.forEach(b => {
    b.coords.forEach(c => {
      const x = (c[0] - centerLon) * metersPerDegreeLon * scale;
      const z = -(c[1] - centerLat) * metersPerDegreeLat * scale;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });
  });

  return { centerLon, centerLat, scale, bounds: { minX, maxX, minZ, maxZ } };
}

/**
 * Run Blender with the render script.
 */
async function runBlender(
  blenderPath: string,
  configPath: string,
  engine: string,
  extraArgs: string[] = []
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '--background',
      '--python', BLENDER_SCRIPT,
      '--',
      configPath,
      '--engine', engine,
      ...extraArgs,
    ];

    console.log(`Running: ${blenderPath} ${args.join(' ')}`);

    const proc = spawn(blenderPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastProgress = 0;

    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('PROGRESS:')) {
          const parts = line.split(':');
          const progress = parseFloat(parts[1]);
          const filename = parts[2];

          // Update progress display
          if (progress - lastProgress >= 1 || progress === 100) {
            process.stdout.write(`\r  [${progress.toFixed(1)}%] ${filename}    `);
            lastProgress = progress;
          }
        } else if (line.startsWith('DONE')) {
          console.log('\n');
        } else if (line.trim()) {
          console.log(`  Blender: ${line}`);
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      // Show render progress (Fra: lines show frame progress)
      if (text.includes('Fra:') && text.includes('Rendering')) {
        // Extract and show render progress
        process.stdout.write(`\r  ${text.substring(0, 80)}...`);
      } else if (text.includes('Mem:') || text.includes('| Time:')) {
        // Show memory/time info occasionally
        process.stdout.write(`\r  ${text.substring(0, 80)}   `);
      } else if (text && !text.includes('Fra:') && !text.includes('Mem:')) {
        console.error(`  Blender stderr: ${text}`);
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

async function main() {
  console.log('Blender Illustrated Isometric Renderer');
  console.log('='.repeat(50));

  // Parse command line arguments
  const args = process.argv.slice(2);
  let engine = 'CYCLES';  // Default to Cycles for illustrated style
  const extraArgs: string[] = [];

  // Parse --engine
  const engineIdx = args.indexOf('--engine');
  if (engineIdx !== -1 && args[engineIdx + 1]) {
    engine = args[engineIdx + 1].toUpperCase();
    if (!['EEVEE', 'CYCLES'].includes(engine)) {
      console.error(`Invalid engine: ${engine}. Use EEVEE or CYCLES.`);
      process.exit(1);
    }
  }

  // Parse --no-illustrated
  if (args.includes('--no-illustrated')) {
    extraArgs.push('--no-illustrated');
    console.log('Illustrated mode: DISABLED');
  } else {
    console.log('Illustrated mode: ENABLED (Freestyle outlines, toon shading, trees)');
  }

  // Parse --no-trees
  if (args.includes('--no-trees')) {
    extraArgs.push('--no-trees');
    console.log('Trees: DISABLED');
  }

  // Parse --trees N
  const treesIdx = args.indexOf('--trees');
  if (treesIdx !== -1 && args[treesIdx + 1]) {
    const count = parseInt(args[treesIdx + 1], 10);
    if (!isNaN(count)) {
      extraArgs.push('--trees', count.toString());
      console.log(`Trees: ${count}`);
    }
  }

  // Parse --samples N
  const samplesIdx = args.indexOf('--samples');
  if (samplesIdx !== -1 && args[samplesIdx + 1]) {
    const samples = parseInt(args[samplesIdx + 1], 10);
    if (!isNaN(samples)) {
      extraArgs.push('--samples', samples.toString());
      console.log(`Cycles samples: ${samples}`);
    }
  } else {
    console.log('Cycles samples: 128 (default)');
  }

  // Parse --pixel-art flag for pixel art rendering effect
  if (args.includes('--pixel-art')) {
    extraArgs.push('--pixel-art');
    console.log('Pixel art mode: ENABLED');

    // Parse --pixel-scale N (default: 4)
    const pixelScaleIdx = args.indexOf('--pixel-scale');
    if (pixelScaleIdx !== -1 && args[pixelScaleIdx + 1]) {
      const scale = parseInt(args[pixelScaleIdx + 1], 10);
      if (!isNaN(scale) && scale >= 1 && scale <= 16) {
        extraArgs.push('--pixel-scale', scale.toString());
        console.log(`  Pixel scale: ${scale}x`);
      }
    } else {
      console.log('  Pixel scale: 4x (default)');
    }

    // Parse --color-levels N (default: 8)
    const colorLevelsIdx = args.indexOf('--color-levels');
    if (colorLevelsIdx !== -1 && args[colorLevelsIdx + 1]) {
      const levels = parseInt(args[colorLevelsIdx + 1], 10);
      if (!isNaN(levels) && levels >= 2 && levels <= 32) {
        extraArgs.push('--color-levels', levels.toString());
        console.log(`  Color levels: ${levels}`);
      }
    } else {
      console.log('  Color levels: 8 (default)');
    }
  }

  // Parse --no-satellite (disable satellite textures even if available)
  const useSatellite = !args.includes('--no-satellite');

  console.log(`Render engine: ${engine}`);

  // Find Blender
  console.log('\nLocating Blender...');
  const blenderPath = findBlender();
  if (!blenderPath) {
    console.error('Error: Blender not found!');
    console.error('Please install Blender 3.6+ from https://www.blender.org/download/');
    process.exit(1);
  }
  console.log(`Found: ${blenderPath}`);

  // Check version
  const version = checkBlenderVersion(blenderPath);
  if (version) {
    console.log(`Version: ${version}`);
    const major = parseFloat(version);
    if (major < 3.6) {
      console.warn(`Warning: Blender ${version} detected. Version 3.6+ recommended.`);
    }
  }

  // Check Python script exists
  if (!fs.existsSync(BLENDER_SCRIPT)) {
    console.error(`Error: Blender script not found: ${BLENDER_SCRIPT}`);
    process.exit(1);
  }

  // Load and filter GeoJSON
  console.log('\nLoading GeoJSON data...');
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Error: ${DATA_PATH} not found`);
    process.exit(1);
  }

  const geojson = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  console.log(`Loaded ${geojson.features.length} total buildings`);

  const buildings = filterBuildings(geojson);
  console.log(`Filtered to ${buildings.length} buildings in focus area`);

  if (buildings.length === 0) {
    console.error('No buildings in focus area!');
    process.exit(1);
  }

  const sceneData = calculateSceneData(buildings);
  console.log(`Scene center: ${sceneData.centerLat.toFixed(4)}, ${sceneData.centerLon.toFixed(4)}`);
  console.log(`Scene bounds: X[${sceneData.bounds.minX.toFixed(1)}, ${sceneData.bounds.maxX.toFixed(1)}]`);

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load satellite config if available and enabled
  let satelliteConfig: SatelliteConfig | null = null;
  if (useSatellite) {
    satelliteConfig = loadSatelliteConfig();
    if (satelliteConfig) {
      console.log('Satellite imagery: ENABLED');
      console.log(`  Texture: ${satelliteConfig.texturePath}`);
    } else {
      console.log('Satellite imagery: NOT AVAILABLE (run npm run fetch:imagery first)');
    }
  } else {
    console.log('Satellite imagery: DISABLED');
  }

  // Load streetview config if available (--no-streetview to disable)
  const useStreetview = !args.includes('--no-streetview');
  let streetviewConfig: StreetviewConfig | null = null;
  if (useStreetview) {
    streetviewConfig = loadStreetviewConfig();
    if (streetviewConfig) {
      const buildingCount = Object.keys(streetviewConfig).length;
      console.log(`Streetview wall textures: ENABLED (${buildingCount} buildings)`);
    } else {
      console.log('Streetview wall textures: NOT AVAILABLE (run npm run fetch:streetview first)');
    }
  } else {
    console.log('Streetview wall textures: DISABLED');
  }

  // Load Google 3D Tiles config if available
  // --google-tiles: use Google tiles alongside OSM buildings
  // --google-tiles-only: replace OSM buildings with Google tiles
  const useGoogleTiles = args.includes('--google-tiles') || args.includes('--google-tiles-only');
  const replaceWithGoogleTiles = args.includes('--google-tiles-only');
  let googleTilesConfig: GoogleTilesConfig | null = null;
  if (useGoogleTiles) {
    googleTilesConfig = loadGoogleTilesConfig(replaceWithGoogleTiles);
    if (googleTilesConfig) {
      console.log(`Google 3D Tiles: ENABLED (${replaceWithGoogleTiles ? 'replacing' : 'alongside'} OSM buildings)`);
      console.log(`  Model: ${googleTilesConfig.modelPath}`);
    } else {
      console.log('Google 3D Tiles: NOT AVAILABLE (run npm run fetch:google-tiles first)');
    }
  }

  // Write config to temp file
  const config: BlenderConfig = {
    buildings,
    sceneData,
    outputDir: OUTPUT_DIR,
    tileSize: TILE_SIZE,
    worldTileSize: WORLD_TILE_SIZE,
    ...(satelliteConfig && { satelliteConfig }),
    ...(streetviewConfig && { streetviewConfig }),
    ...(googleTilesConfig && { googleTilesConfig }),
  };

  const configPath = path.join(os.tmpdir(), `blender-config-${Date.now()}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config));
  console.log(`Config written to: ${configPath}`);

  // Run Blender
  console.log('\nStarting Blender render...');
  try {
    await runBlender(blenderPath, configPath, engine, extraArgs);
    console.log('Render complete!');
    console.log(`Output: ${OUTPUT_DIR}`);
  } catch (err) {
    console.error('Render failed:', err);
    process.exit(1);
  } finally {
    // Clean up temp config
    try {
      fs.unlinkSync(configPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
