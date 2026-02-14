import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './ModelViewer.css';

interface ModelViewerProps {
  modelPath: string;
}

function ModelViewer({ modelPath }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const initialZoomRef = useRef<number>(1);
  const modelSizeRef = useRef<THREE.Vector3>(new THREE.Vector3());

  const handleFitView = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    camera.zoom = initialZoomRef.current;
    camera.updateProjectionMatrix();
    controls.target.set(0, modelSizeRef.current.y / 4, 0);
    controls.update();
  }, []);

  const handleZoomIn = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.zoom = Math.min(camera.zoom * 1.3, 10);
    camera.updateProjectionMatrix();
  }, []);

  const handleZoomOut = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.zoom = Math.max(camera.zoom / 1.3, 0.05);
    camera.updateProjectionMatrix();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue
    sceneRef.current = scene;

    // Orthographic camera for isometric view
    const aspect = width / height;
    const frustumSize = 500; // Larger frustum for big models
    const camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      5000
    );
    cameraRef.current = camera;

    // Position camera for isometric view (same angle as Blender render)
    const distance = 500;
    const azimuth = (280 * Math.PI) / 180; // Match Blender azimuth
    camera.position.set(
      distance * Math.cos(azimuth),
      distance,
      distance * Math.sin(azimuth)
    );
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minZoom = 0.05; // Allow zooming out much further
    controls.maxZoom = 10;
    controls.maxPolarAngle = Math.PI / 2.2; // Limit vertical rotation
    controls.zoomSpeed = 1.5; // Faster zoom
    controlsRef.current = controls;

    // Lighting (match Blender illustrated style)
    // Key light (sun)
    const sunLight = new THREE.DirectionalLight(0xFFFAF0, 3);
    sunLight.position.set(100, 100, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.camera.left = -150;
    sunLight.shadow.camera.right = 150;
    sunLight.shadow.camera.top = 150;
    sunLight.shadow.camera.bottom = -150;
    scene.add(sunLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0xE6F0FF, 0.8);
    fillLight.position.set(-50, 80, -50);
    scene.add(fillLight);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.4);
    scene.add(ambientLight);

    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(500, 500);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x7CA84A, // Grass green
      roughness: 0.9,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

    // Load the model
    const loader = new GLTFLoader();
    loader.load(
      modelPath,
      (gltf) => {
        const model = gltf.scene;
        modelRef.current = model;

        // Center the model
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        model.position.sub(center);
        model.position.y = -box.min.y; // Place bottom on ground

        // Enable shadows
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        scene.add(model);

        // Adjust camera to fit entire model with padding
        const maxDim = Math.max(size.x, size.y, size.z);
        const fitZoom = frustumSize / (maxDim * 2.5); // More padding to see whole model
        camera.zoom = Math.min(fitZoom, 1); // Don't zoom in too much
        camera.updateProjectionMatrix();

        // Store initial values for reset
        initialZoomRef.current = camera.zoom;
        modelSizeRef.current = size;

        // Update controls target to model center
        controls.target.set(0, size.y / 4, 0); // Look at lower-middle of model
        controls.update();

        console.log('Model loaded:', modelPath);
        console.log('Model size:', size.x.toFixed(1), 'x', size.y.toFixed(1), 'x', size.z.toFixed(1));
        console.log('Camera zoom:', camera.zoom.toFixed(3));
      },
      (progress) => {
        const percent = (progress.loaded / progress.total) * 100;
        console.log(`Loading model: ${percent.toFixed(1)}%`);
      },
      (error) => {
        console.error('Error loading model:', error);
      }
    );

    // Animation loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      const newAspect = newWidth / newHeight;

      camera.left = -frustumSize * newAspect / 2;
      camera.right = frustumSize * newAspect / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();

      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [modelPath]);

  return (
    <div className="model-viewer">
      <div ref={containerRef} className="threejs-container" />
      <div className="model-controls">
        <button onClick={handleZoomIn}>+</button>
        <button onClick={handleZoomOut}>-</button>
        <button onClick={handleFitView}>Fit</button>
      </div>
      <div className="model-instructions">
        <span>Scroll to zoom</span>
        <span className="separator">|</span>
        <span>Drag to rotate</span>
        <span className="separator">|</span>
        <span>Right-drag to pan</span>
      </div>
    </div>
  );
}

export default ModelViewer;
