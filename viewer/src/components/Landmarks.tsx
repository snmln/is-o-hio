import { useEffect, useState } from 'react';
import './Landmarks.css';

interface Landmark {
  name: string;
  x: number;
  y: number;
  description?: string;
}

// Default landmarks (will be loaded from landmarks.json when available)
const DEFAULT_LANDMARKS: Landmark[] = [
  {
    name: 'Ohio Stadium',
    x: 0.5,
    y: 0.5,
    description: 'The Horseshoe - Home of OSU Football',
  },
  {
    name: 'Thompson Library',
    x: 0.45,
    y: 0.55,
    description: 'Main campus library',
  },
  {
    name: 'Ohio Union',
    x: 0.55,
    y: 0.45,
    description: 'Student union and activities center',
  },
  {
    name: 'The Oval',
    x: 0.48,
    y: 0.52,
    description: 'Historic center of campus',
  },
  {
    name: 'Wexner Center',
    x: 0.52,
    y: 0.48,
    description: 'Contemporary arts center',
  },
  {
    name: 'St. John Arena',
    x: 0.47,
    y: 0.53,
    description: 'Historic basketball venue',
  },
];

function Landmarks() {
  const [landmarks, setLandmarks] = useState<Landmark[]>(DEFAULT_LANDMARKS);
  const [selectedLandmark, setSelectedLandmark] = useState<Landmark | null>(null);

  // Try to load landmarks from JSON file
  useEffect(() => {
    fetch('./tiles/landmarks.json')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setLandmarks(data);
        }
      })
      .catch(() => {
        // Use default landmarks if file not found
      });
  }, []);

  const handleLandmarkClick = (landmark: Landmark) => {
    setSelectedLandmark(selectedLandmark?.name === landmark.name ? null : landmark);
  };

  return (
    <div className="landmarks">
      <div className="landmarks-header">
        <h3>Landmarks</h3>
      </div>
      <ul className="landmarks-list">
        {landmarks.map((landmark) => (
          <li
            key={landmark.name}
            className={`landmark-item ${
              selectedLandmark?.name === landmark.name ? 'selected' : ''
            }`}
            onClick={() => handleLandmarkClick(landmark)}
          >
            <span className="landmark-marker">📍</span>
            <span className="landmark-name">{landmark.name}</span>
          </li>
        ))}
      </ul>
      {selectedLandmark && selectedLandmark.description && (
        <div className="landmark-info">
          <p>{selectedLandmark.description}</p>
        </div>
      )}
    </div>
  );
}

export default Landmarks;
