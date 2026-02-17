import { useEffect, useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import './ModelViewer.css';

// Local path for the GLB file (used in development and when deployed with the file)
const DEFAULT_MODEL_URL = './tiles/google_tiles.glb';

// Create a 2-tone gradient map for cel-shading
function createToonGradientMap(): THREE.DataTexture {
  const colors = new Uint8Array([
    140, 140, 140, 255,  // Shadow tone (darker)
    255, 255, 255, 255,  // Lit tone (full brightness)
  ]);

  const gradientMap = new THREE.DataTexture(colors, 2, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;

  return gradientMap;
}

// Convert a mesh to use toon shading while preserving its color
function applyToonMaterial(mesh: THREE.Mesh, gradientMap: THREE.DataTexture): void {
  const originalMaterial = mesh.material as THREE.Material | THREE.Material[];

  const convertMaterial = (mat: THREE.Material): THREE.MeshToonMaterial => {
    let color = new THREE.Color(0xcccccc);
    let map: THREE.Texture | null = null;

    // Extract color and texture from original material
    if (mat instanceof THREE.MeshStandardMaterial ||
        mat instanceof THREE.MeshBasicMaterial ||
        mat instanceof THREE.MeshPhongMaterial ||
        mat instanceof THREE.MeshLambertMaterial) {
      color = mat.color.clone();
      map = mat.map;
    }

    const toonMat = new THREE.MeshToonMaterial({
      color: color,
      map: map,
      gradientMap: gradientMap,
    });

    return toonMat;
  };

  if (Array.isArray(originalMaterial)) {
    mesh.material = originalMaterial.map(convertMaterial);
  } else {
    mesh.material = convertMaterial(originalMaterial);
  }
}

// Pixel size range based on zoom
const MIN_PIXEL_SIZE = 1; // When zoomed out
const MAX_PIXEL_SIZE = 4; // When zoomed in

// SimCity-style Pixel Art Shader
// Vibrant colors, dark outlines, warm palette
const PixelArtShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    pixelSize: { value: 4.0 },
    colorLevels: { value: 8.0 },      // Pronounced color banding
    brightness: { value: 0.02 },
    contrast: { value: 1.25 },        // Strong contrast
    saturation: { value: 1.4 },       // Rich saturated colors
    outlineStrength: { value: 0.5 },  // Subtle dark outlines
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float pixelSize;
    uniform float colorLevels;
    uniform float brightness;
    uniform float contrast;
    uniform float saturation;
    uniform float outlineStrength;
    varying vec2 vUv;

    float luminance(vec3 c) {
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    // RGB to HSL conversion
    vec3 rgb2hsl(vec3 c) {
      float maxC = max(max(c.r, c.g), c.b);
      float minC = min(min(c.r, c.g), c.b);
      float l = (maxC + minC) / 2.0;

      if (maxC == minC) {
        return vec3(0.0, 0.0, l); // achromatic
      }

      float d = maxC - minC;
      float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);

      float h;
      if (maxC == c.r) {
        h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
      } else if (maxC == c.g) {
        h = (c.b - c.r) / d + 2.0;
      } else {
        h = (c.r - c.g) / d + 4.0;
      }
      h /= 6.0;

      return vec3(h, s, l);
    }

    void main() {
      // Use larger sample distance for silhouette-only edges
      vec2 texel = pixelSize * 2.0 / resolution;

      // Pixelation: snap UV to pixel grid
      vec2 pixelatedUV = floor(vUv * resolution / pixelSize) * pixelSize / resolution;

      // Sample the pixelated color
      vec4 color = texture2D(tDiffuse, pixelatedUV);

      // === COLOR PALETTE SNAPPING ===
      // Snap grass, water, and roads to uniform colors while preserving building detail
      vec3 hsl = rgb2hsl(color.rgb);
      float h = hsl.x;  // Hue 0-1
      float s = hsl.y;  // Saturation 0-1
      float l = hsl.z;  // Lightness 0-1

      // Grass detection (green hues with decent saturation)
      if (h > 0.20 && h < 0.45 && s > 0.2) {
        color.rgb = vec3(0.30, 0.55, 0.20);  // Uniform grass green
      }
      // Road detection (low saturation grays in mid-lightness range)
      else if (s < 0.15 && l > 0.3 && l < 0.6) {
        color.rgb = vec3(0.50, 0.50, 0.50);  // Uniform road gray
      }

      // === SILHOUETTE EDGE DETECTION ===
      // Sample at larger distance to ignore fine details
      float tl = luminance(texture2D(tDiffuse, pixelatedUV + vec2(-texel.x, -texel.y)).rgb);
      float tm = luminance(texture2D(tDiffuse, pixelatedUV + vec2(0.0, -texel.y)).rgb);
      float tr = luminance(texture2D(tDiffuse, pixelatedUV + vec2(texel.x, -texel.y)).rgb);
      float ml = luminance(texture2D(tDiffuse, pixelatedUV + vec2(-texel.x, 0.0)).rgb);
      float mr = luminance(texture2D(tDiffuse, pixelatedUV + vec2(texel.x, 0.0)).rgb);
      float bl = luminance(texture2D(tDiffuse, pixelatedUV + vec2(-texel.x, texel.y)).rgb);
      float bm = luminance(texture2D(tDiffuse, pixelatedUV + vec2(0.0, texel.y)).rgb);
      float br = luminance(texture2D(tDiffuse, pixelatedUV + vec2(texel.x, texel.y)).rgb);

      // Sobel edge detection
      float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
      float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
      float edge = sqrt(gx*gx + gy*gy);

      // === COLOR ADJUSTMENTS ===
      // Brightness/Contrast
      color.rgb = (color.rgb - 0.5) * contrast + 0.5 + brightness;

      // Saturation boost
      float gray = luminance(color.rgb);
      color.rgb = mix(vec3(gray), color.rgb, saturation);

      // Posterization (color quantization)
      color.rgb = floor(color.rgb * colorLevels + 0.5) / colorLevels;

      // === APPLY OUTLINES (silhouettes only) ===
      // Higher threshold to ignore small details
      vec3 outlineColor = vec3(0.1, 0.08, 0.05);
      float outlineMix = smoothstep(0.4, 0.7, edge) * outlineStrength;
      color.rgb = mix(color.rgb, outlineColor, outlineMix);

      // Clamp final color
      gl_FragColor = clamp(color, 0.0, 1.0);
    }
  `,
};

interface ModelViewerProps {
  modelPath?: string;
}

function ModelViewer({ modelPath }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const initialZoomRef = useRef<number>(1);
  const modelSizeRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const pixelPassRef = useRef<ShaderPass | null>(null);
  const minZoomRef = useRef<number>(0.05);
  const maxZoomRef = useRef<number>(10);

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pixelArtEnabled, setPixelArtEnabled] = useState(true);
  const [currentPixelSize, setCurrentPixelSize] = useState(MIN_PIXEL_SIZE);

  const effectiveModelPath = modelPath || DEFAULT_MODEL_URL;

  // Calculate pixel size based on zoom level
  const calculatePixelSize = useCallback((zoom: number): number => {
    const minZoom = minZoomRef.current;
    const maxZoom = maxZoomRef.current;

    // Normalize zoom to 0-1 range
    const normalizedZoom = (zoom - minZoom) / (maxZoom - minZoom);

    // Interpolate pixel size: zoomed out (low zoom) = small pixels, zoomed in (high zoom) = large pixels
    const pixelSize = MIN_PIXEL_SIZE + normalizedZoom * (MAX_PIXEL_SIZE - MIN_PIXEL_SIZE);

    // Round to nearest 0.5 for smoother transitions
    return Math.round(pixelSize * 2) / 2;
  }, []);

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

  // Update pixel art shader when enabled state changes
  useEffect(() => {
    if (pixelPassRef.current) {
      pixelPassRef.current.enabled = pixelArtEnabled;
    }
  }, [pixelArtEnabled]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    sceneRef.current = scene;

    // Camera
    const aspect = width / height;
    const frustumSize = 500;
    const camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      5000
    );
    cameraRef.current = camera;

    const distance = 500;
    const azimuth = (280 * Math.PI) / 180;
    camera.position.set(
      distance * Math.cos(azimuth),
      distance,
      distance * Math.sin(azimuth)
    );
    camera.lookAt(0, 0, 0);

    // Renderer - disable antialiasing for crisp pixels
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(1); // Use 1:1 pixel ratio for pixel art
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Effect Composer for post-processing
    const composer = new EffectComposer(renderer);
    composerRef.current = composer;

    // Render pass
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Pixel art pass (SimCity style)
    const pixelPass = new ShaderPass(PixelArtShader);
    pixelPass.uniforms.resolution.value.set(width, height);
    pixelPass.uniforms.pixelSize.value = MIN_PIXEL_SIZE;
    pixelPass.uniforms.colorLevels.value = 8.0;       // Pronounced banding
    pixelPass.uniforms.brightness.value = 0.02;       // Slight brightness
    pixelPass.uniforms.contrast.value = 1.25;         // Strong contrast
    pixelPass.uniforms.saturation.value = 1.4;        // Rich colors
    pixelPass.uniforms.outlineStrength.value = 0.5;   // Subtle outlines
    pixelPass.enabled = pixelArtEnabled;
    composer.addPass(pixelPass);
    pixelPassRef.current = pixelPass;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minZoom = 0.05;
    controls.maxZoom = 10;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.zoomSpeed = 1.5;
    controlsRef.current = controls;

    // Store zoom bounds
    minZoomRef.current = controls.minZoom;
    maxZoomRef.current = controls.maxZoom;

    // Lighting
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

    const fillLight = new THREE.DirectionalLight(0xE6F0FF, 0.8);
    fillLight.position.set(-50, 80, -50);
    scene.add(fillLight);

    const ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.4);
    scene.add(ambientLight);

    // Ground with toon shading
    const groundGradientMap = createToonGradientMap();
    const groundGeometry = new THREE.PlaneGeometry(500, 500);
    const groundMaterial = new THREE.MeshToonMaterial({
      color: 0x7CA84A,
      gradientMap: groundGradientMap,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);

    // Load model
    const loader = new GLTFLoader();
    setIsLoading(true);
    setLoadProgress(0);
    setLoadError(null);

    loader.load(
      effectiveModelPath,
      (gltf) => {
        const model = gltf.scene;
        modelRef.current = model;

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        model.position.sub(center);
        model.position.y = -box.min.y;

        // Create gradient map for 2-tone cel shading
        const gradientMap = createToonGradientMap();

        // Apply toon materials and shadows to all meshes
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            // Convert to toon material for 2-tone shading
            applyToonMaterial(child, gradientMap);
          }
        });

        scene.add(model);

        const maxDim = Math.max(size.x, size.y, size.z);
        const fitZoom = frustumSize / (maxDim * 2.5);
        camera.zoom = Math.min(fitZoom, 1);
        camera.updateProjectionMatrix();

        initialZoomRef.current = camera.zoom;
        modelSizeRef.current = size;

        controls.target.set(0, size.y / 4, 0);
        controls.update();

        setIsLoading(false);
        setLoadProgress(100);
      },
      (progress) => {
        if (progress.total > 0) {
          setLoadProgress((progress.loaded / progress.total) * 100);
        }
      },
      (error: unknown) => {
        console.error('Error loading model:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        setLoadError(`Failed to load 3D model: ${message}`);
        setIsLoading(false);
      }
    );

    // Animation loop - update pixel size based on zoom
    let animationId: number;
    let lastZoom = camera.zoom;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();

      // Update pixel size based on current zoom level
      if (pixelPassRef.current && camera.zoom !== lastZoom) {
        const newPixelSize = calculatePixelSize(camera.zoom);
        pixelPassRef.current.uniforms.pixelSize.value = newPixelSize;
        setCurrentPixelSize(newPixelSize);
        lastZoom = camera.zoom;
      }

      composer.render();
    };
    animate();

    // Resize handler
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
      composer.setSize(newWidth, newHeight);

      pixelPass.uniforms.resolution.value.set(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [effectiveModelPath, calculatePixelSize]);

  return (
    <div className="model-viewer">
      <div ref={containerRef} className="threejs-container" />

      {/* Loading overlay */}
      {isLoading && (
        <div className="model-loading-overlay">
          <div className="model-loading-content">
            <div className="model-loading-spinner" />
            <div className="model-loading-text">Loading 3D Model...</div>
            <div className="model-loading-progress-bar">
              <div
                className="model-loading-progress-fill"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
            <div className="model-loading-percent">
              {loadProgress > 0 ? `${loadProgress.toFixed(0)}%` : 'Connecting...'}
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {loadError && (
        <div className="model-error-overlay">
          <div className="model-error-content">
            <div className="model-error-icon">!</div>
            <div className="model-error-text">{loadError}</div>
            <button
              className="model-error-retry"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Pixel Art Controls */}
      <div className="pixel-art-controls">
        <label className="pixel-art-toggle">
          <input
            type="checkbox"
            checked={pixelArtEnabled}
            onChange={(e) => setPixelArtEnabled(e.target.checked)}
          />
          <span>Pixel Art</span>
        </label>
        {pixelArtEnabled && (
          <div className="pixel-size-display">
            <span>{currentPixelSize.toFixed(1)}x</span>
          </div>
        )}
      </div>

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
