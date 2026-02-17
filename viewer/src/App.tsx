import { useState, useCallback } from 'react';
import MapViewer from './components/MapViewer';
import ModelViewer from './components/ModelViewer';
import Controls from './components/Controls';
import Landmarks from './components/Landmarks';
import Header from './components/Header';
import './App.css';

type ViewMode = '2d' | '3d';

interface ViewerState {
  zoom: number;
  center: { x: number; y: number };
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [viewerState, setViewerState] = useState<ViewerState>({
    zoom: 1,
    center: { x: 0.5, y: 0.5 },
  });
  const [showLandmarks, setShowLandmarks] = useState(true);

  const handleZoomIn = useCallback(() => {
    setViewerState((prev) => ({ ...prev, zoom: prev.zoom * 1.5 }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewerState((prev) => ({ ...prev, zoom: prev.zoom / 1.5 }));
  }, []);

  const handleResetView = useCallback(() => {
    setViewerState({ zoom: 1, center: { x: 0.5, y: 0.5 } });
  }, []);

  const handleToggleLandmarks = useCallback(() => {
    setShowLandmarks((prev) => !prev);
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="main-content">
        {/* View Mode Toggle */}
        <div className="view-mode-toggle">
          <button
            className={viewMode === '2d' ? 'active' : ''}
            onClick={() => setViewMode('2d')}
          >
            2D Map
          </button>
          <button
            className={viewMode === '3d' ? 'active' : ''}
            onClick={() => setViewMode('3d')}
          >
            3D Model
          </button>
        </div>

        {/* Conditional Viewer */}
        {viewMode === '2d' ? (
          <>
            <MapViewer
              zoom={viewerState.zoom}
              center={viewerState.center}
              onViewChange={setViewerState}
            />
            {showLandmarks && <Landmarks />}
            <Controls
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onResetView={handleResetView}
              onToggleLandmarks={handleToggleLandmarks}
              showLandmarks={showLandmarks}
            />
          </>
        ) : (
          <ModelViewer />
        )}
      </main>
    </div>
  );
}

export default App;
