import { useState, useCallback, useRef, useEffect } from 'react';
import Header from './components/Header';
import './App.css';

function App() {
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.1, Math.min(5, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="main-content">
        <div
          ref={containerRef}
          className="simple-viewer"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <img
            src="./tiles/full-composite.png"
            alt="OSU Campus Isometric Map"
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
        <div className="map-instructions">
          <span>Scroll to zoom</span>
          <span className="separator">|</span>
          <span>Drag to pan</span>
        </div>
        <div className="zoom-controls">
          <button onClick={() => setZoom(z => Math.min(5, z * 1.2))}>+</button>
          <button onClick={() => setZoom(z => Math.max(0.1, z / 1.2))}>−</button>
          <button onClick={() => { setZoom(0.5); setPan({ x: 0, y: 0 }); }}>Reset</button>
        </div>
      </main>
    </div>
  );
}

export default App;
