import * as THREE from 'three';

/**
 * Create the Three.js scene with appropriate lighting for isometric rendering.
 */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();

  // Light background color (will be made transparent in final render)
  scene.background = new THREE.Color(0xe8e4d4); // Warm paper color

  // Ambient light for base illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  // Directional light from top-left (classic SimCity shadow direction)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(-1, 2, -1);
  directionalLight.castShadow = false; // We'll fake shadows in post-processing
  scene.add(directionalLight);

  // Subtle fill light from opposite side
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.2);
  fillLight.position.set(1, 0.5, 1);
  scene.add(fillLight);

  return scene;
}

/**
 * Add a ground plane to the scene.
 */
export function addGroundPlane(
  scene: THREE.Scene,
  width: number,
  depth: number,
  centerX: number = 0,
  centerZ: number = 0
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, depth);
  const material = new THREE.MeshLambertMaterial({
    color: 0x90a955, // Grass green
    side: THREE.DoubleSide,
  });

  const plane = new THREE.Mesh(geometry, material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(centerX, -0.01, centerZ); // Slightly below 0 to avoid z-fighting

  scene.add(plane);
  return plane;
}

/**
 * Clear all meshes from the scene (except lights).
 */
export function clearScene(scene: THREE.Scene): void {
  const toRemove: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      toRemove.push(object);
    }
  });

  toRemove.forEach((obj) => {
    scene.remove(obj);
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}
