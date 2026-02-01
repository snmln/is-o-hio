import * as THREE from 'three';

export interface BuildingFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
  properties: {
    id: number;
    name?: string;
    height: number;
    building_type: string;
    osm_tags?: Record<string, string>;
  };
}

export interface GeoJSONData {
  type: 'FeatureCollection';
  features: BuildingFeature[];
}

// SimCity 2000-inspired color palette
const BUILDING_COLORS: Record<string, { wall: number; roof: number }> = {
  university: { wall: 0xb8860b, roof: 0x8b4513 }, // Brick/terracotta
  library: { wall: 0xd2b48c, roof: 0x8b4513 }, // Tan/brown
  stadium: { wall: 0x808080, roof: 0x228b22 }, // Gray/green (for turf)
  residential: { wall: 0xdeb887, roof: 0xa0522d }, // Burlywood/sienna
  commercial: { wall: 0xc0c0c0, roof: 0x696969 }, // Silver/gray
  industrial: { wall: 0xa9a9a9, roof: 0x556b2f }, // Dark gray/olive
  religious: { wall: 0xf5f5dc, roof: 0x8b4513 }, // Beige/brown
  hospital: { wall: 0xf0f0f0, roof: 0x4169e1 }, // White/blue
  cultural: { wall: 0xe6e6fa, roof: 0x483d8b }, // Lavender/slate blue
  default: { wall: 0xd3d3d3, roof: 0x808080 }, // Light gray
};

// OSU Scarlet for special buildings
const OSU_SCARLET = 0xbb0000;

/**
 * Convert WGS84 coordinates to local scene coordinates.
 * Uses a simple equirectangular projection centered on the campus.
 */
export function geoToScene(
  lon: number,
  lat: number,
  centerLon: number,
  centerLat: number,
  scale: number = 10000 // meters per unit adjustment
): { x: number; z: number } {
  // Approximate meters per degree at this latitude
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const x = (lon - centerLon) * metersPerDegreeLon / scale;
  const z = -(lat - centerLat) * metersPerDegreeLat / scale; // Negative because z increases south

  return { x, z };
}

/**
 * Create a building mesh from a GeoJSON feature.
 */
export function createBuildingMesh(
  feature: BuildingFeature,
  centerLon: number,
  centerLat: number,
  scale: number = 10000
): THREE.Group {
  const group = new THREE.Group();
  const coords = feature.geometry.coordinates[0];
  const props = feature.properties;

  // Convert coordinates to scene space
  const points: THREE.Vector2[] = coords.map((coord) => {
    const { x, z } = geoToScene(coord[0], coord[1], centerLon, centerLat, scale);
    return new THREE.Vector2(x, z);
  });

  // Create shape from points
  const shape = new THREE.Shape(points);

  // Get colors based on building type
  const colors = BUILDING_COLORS[props.building_type] || BUILDING_COLORS.default;

  // Scale height for scene (meters to scene units)
  const heightScale = 1 / (scale / 1000);
  const height = props.height * heightScale;

  // Create extruded geometry for the building
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: height,
    bevelEnabled: false,
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  // Rotate so extrusion goes up (Y axis) instead of out (Z axis)
  geometry.rotateX(-Math.PI / 2);

  // Create materials
  const wallMaterial = new THREE.MeshLambertMaterial({ color: colors.wall });
  const roofMaterial = new THREE.MeshLambertMaterial({ color: colors.roof });

  // Create mesh with multi-material
  // ExtrudeGeometry creates groups: 0=sides, 1=top, 2=bottom (if bevel)
  const materials = [wallMaterial, roofMaterial];
  const mesh = new THREE.Mesh(geometry, materials);

  // Store metadata for later use
  mesh.userData = {
    id: props.id,
    name: props.name,
    type: props.building_type,
    height: props.height,
  };

  group.add(mesh);

  return group;
}

/**
 * Load buildings from GeoJSON and add to scene.
 */
export function loadBuildings(
  scene: THREE.Scene,
  geojson: GeoJSONData,
  bounds?: { minLon: number; maxLon: number; minLat: number; maxLat: number }
): {
  buildings: THREE.Group[];
  center: { lon: number; lat: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
} {
  const buildings = geojson.features.filter(
    (f) => f.geometry.type === 'Polygon' && f.properties.height
  );

  // Calculate center and bounds
  let minLon = Infinity,
    maxLon = -Infinity;
  let minLat = Infinity,
    maxLat = -Infinity;

  buildings.forEach((building) => {
    building.geometry.coordinates[0].forEach((coord) => {
      minLon = Math.min(minLon, coord[0]);
      maxLon = Math.max(maxLon, coord[0]);
      minLat = Math.min(minLat, coord[1]);
      maxLat = Math.max(maxLat, coord[1]);
    });
  });

  // Use provided bounds or calculated bounds
  if (bounds) {
    minLon = bounds.minLon;
    maxLon = bounds.maxLon;
    minLat = bounds.minLat;
    maxLat = bounds.maxLat;
  }

  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;

  // Create building meshes
  const buildingGroups: THREE.Group[] = [];
  const scale = 5000; // Adjust for good visual scale

  buildings.forEach((feature) => {
    const buildingGroup = createBuildingMesh(
      feature,
      centerLon,
      centerLat,
      scale
    );
    scene.add(buildingGroup);
    buildingGroups.push(buildingGroup);
  });

  // Calculate scene bounds
  let minX = Infinity,
    maxX = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;

  buildingGroups.forEach((group) => {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.computeBoundingBox();
        const box = obj.geometry.boundingBox;
        if (box) {
          minX = Math.min(minX, box.min.x);
          maxX = Math.max(maxX, box.max.x);
          minZ = Math.min(minZ, box.min.z);
          maxZ = Math.max(maxZ, box.max.z);
        }
      }
    });
  });

  console.log(`Loaded ${buildingGroups.length} buildings`);
  console.log(`Scene bounds: X[${minX.toFixed(2)}, ${maxX.toFixed(2)}], Z[${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`);

  return {
    buildings: buildingGroups,
    center: { lon: centerLon, lat: centerLat },
    bounds: { minX, maxX, minZ, maxZ },
  };
}
