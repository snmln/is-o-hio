import { useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import './MapViewer.css';

interface ViewerState {
  zoom: number;
  center: { x: number; y: number };
}

interface MapViewerProps {
  zoom: number;
  center: { x: number; y: number };
  onViewChange: (state: ViewerState) => void;
}

function MapViewer({ zoom, center, onViewChange }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const lastZoomRef = useRef(zoom);
  const lastCenterRef = useRef(center);

  // Initialize OpenSeadragon
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = OpenSeadragon({
      element: containerRef.current,
      prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/',
      tileSources: './tiles/osu-campus.dzi',
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      navigatorSizeRatio: 0.15,
      animationTime: 0.3,
      blendTime: 0.1,
      constrainDuringPan: true,
      maxZoomPixelRatio: 4,
      minZoomLevel: 0.8,
      defaultZoomLevel: 2,
      visibilityRatio: 0.8,
      springStiffness: 10,
      zoomPerClick: 1.5,
      zoomPerScroll: 1.2,
      gestureSettingsMouse: {
        clickToZoom: true,
        dblClickToZoom: true,
        scrollToZoom: true,
      },
      gestureSettingsTouch: {
        pinchToZoom: true,
        flickEnabled: true,
        flickMinSpeed: 120,
        flickMomentum: 0.25,
      },
      // Fallback for when tiles aren't generated yet
      placeholderFillStyle: '#e8e4d4',
    });

    // Track view changes
    viewer.addHandler('zoom', () => {
      const currentZoom = viewer.viewport.getZoom();
      if (Math.abs(currentZoom - lastZoomRef.current) > 0.01) {
        lastZoomRef.current = currentZoom;
        const viewportCenter = viewer.viewport.getCenter();
        onViewChange({
          zoom: currentZoom,
          center: { x: viewportCenter.x, y: viewportCenter.y },
        });
      }
    });

    viewer.addHandler('pan', () => {
      const viewportCenter = viewer.viewport.getCenter();
      if (
        Math.abs(viewportCenter.x - lastCenterRef.current.x) > 0.001 ||
        Math.abs(viewportCenter.y - lastCenterRef.current.y) > 0.001
      ) {
        lastCenterRef.current = { x: viewportCenter.x, y: viewportCenter.y };
        onViewChange({
          zoom: viewer.viewport.getZoom(),
          center: { x: viewportCenter.x, y: viewportCenter.y },
        });
      }
    });

    // Handle tile load errors gracefully
    viewer.addHandler('tile-load-failed', (event) => {
      console.warn('Tile load failed:', event);
    });

    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [onViewChange]);

  // Handle external zoom changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.viewport) return;

    const currentZoom = viewer.viewport.getZoom();
    if (Math.abs(zoom - currentZoom) > 0.01) {
      viewer.viewport.zoomTo(zoom);
    }
  }, [zoom]);

  // Handle external center changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.viewport) return;

    const currentCenter = viewer.viewport.getCenter();
    if (
      Math.abs(center.x - currentCenter.x) > 0.001 ||
      Math.abs(center.y - currentCenter.y) > 0.001
    ) {
      viewer.viewport.panTo(new OpenSeadragon.Point(center.x, center.y));
    }
  }, [center]);

  return (
    <div className="map-viewer">
      <div ref={containerRef} className="openseadragon-container" />
      <div className="map-instructions">
        <span>Scroll to zoom</span>
        <span className="separator">|</span>
        <span>Drag to pan</span>
        <span className="separator">|</span>
        <span>Double-click to zoom in</span>
      </div>
    </div>
  );
}

export default MapViewer;
