import * as THREE from 'three';

/**
 * Create an orthographic camera with SimCity 2000-style isometric projection.
 * Uses true isometric angles (2:1 ratio).
 */
export function createIsometricCamera(
  viewWidth: number,
  viewHeight: number,
  zoom: number = 1
): THREE.OrthographicCamera {
  const aspect = viewWidth / viewHeight;
  const frustumSize = 100 / zoom;

  const camera = new THREE.OrthographicCamera(
    (-frustumSize * aspect) / 2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    2000
  );

  // Position camera for isometric view
  // SimCity 2000 uses a 2:1 isometric ratio
  const distance = 500;
  camera.position.set(distance, distance, distance);
  camera.lookAt(0, 0, 0);

  // Set rotation for true isometric (26.565° pitch, 45° yaw)
  // This gives the classic 2:1 pixel ratio
  camera.rotation.order = 'YXZ';
  camera.rotation.y = Math.PI / 4; // 45 degrees
  camera.rotation.x = Math.atan(1 / Math.sqrt(2)); // ~35.264 degrees (true isometric)

  camera.updateProjectionMatrix();

  return camera;
}

/**
 * Update camera to center on a specific world position.
 */
export function centerCameraOn(
  camera: THREE.OrthographicCamera,
  x: number,
  z: number
): void {
  const distance = 500;
  camera.position.set(x + distance, distance, z + distance);
  camera.lookAt(x, 0, z);
  camera.updateProjectionMatrix();
}

/**
 * Set camera frustum size (zoom level).
 */
export function setCameraZoom(
  camera: THREE.OrthographicCamera,
  viewWidth: number,
  viewHeight: number,
  zoom: number
): void {
  const aspect = viewWidth / viewHeight;
  const frustumSize = 100 / zoom;

  camera.left = (-frustumSize * aspect) / 2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;

  camera.updateProjectionMatrix();
}
