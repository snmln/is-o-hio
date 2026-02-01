import './Controls.css';

interface ControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onToggleLandmarks: () => void;
  showLandmarks: boolean;
}

function Controls({
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleLandmarks,
  showLandmarks,
}: ControlsProps) {
  return (
    <div className="controls">
      <div className="control-group">
        <button
          className="control-button"
          onClick={onZoomIn}
          title="Zoom In"
          aria-label="Zoom In"
        >
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="currentColor"
              d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
            />
          </svg>
        </button>
        <button
          className="control-button"
          onClick={onZoomOut}
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path fill="currentColor" d="M19 13H5v-2h14v2z" />
          </svg>
        </button>
      </div>

      <div className="control-group">
        <button
          className="control-button"
          onClick={onResetView}
          title="Reset View"
          aria-label="Reset View"
        >
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="currentColor"
              d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"
            />
          </svg>
        </button>
        <button
          className={`control-button ${showLandmarks ? 'active' : ''}`}
          onClick={onToggleLandmarks}
          title="Toggle Landmarks"
          aria-label="Toggle Landmarks"
        >
          <svg viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="currentColor"
              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default Controls;
