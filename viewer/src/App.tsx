import { useState, useCallback } from 'react';
import MapViewer from './components/MapViewer';
import Controls from './components/Controls';
import Landmarks from './components/Landmarks';
import Header from './components/Header';
import ModelViewer from './components/ModelViewer';
import './App.css';

interface ViewerState {
  zoom: number;
  center: { x: number; y: number };
}

function App() {
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
      </main>
    </div>
  );
}

export default App;
