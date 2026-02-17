# Isometric Ohio

An isometric pixel-art style map of the OSU campus, inspired by SimCity 2000. Another test

## Quick Start

```bash
# Install dependencies
npm install

# Run the viewer in development mode
npm run dev
```

## Full Pipeline

### 1. Data Pipeline

Download and process building data from OpenStreetMap:

```bash
# Set up Python environment
cd data/scripts
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt

# Download OSU campus data
python download_data.py

# Parse buildings to GeoJSON
python parse_buildings.py
```

### 2. Render Tiles

Generate isometric 3D renders of the campus:

```bash
npm run render
```

This uses Puppeteer to run Three.js headlessly and generates raw tiles.

### 3. Post-Process

Apply pixel-art effects (dithering, palette reduction, outlines):

```bash
npm run postprocess
```

### 4. Generate Tile Pyramid

Create the Deep Zoom Image pyramid for the viewer:

```bash
npm run pyramid
```

### 5. View

Run the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Project Structure

```
isometric-ohio/
├── data/                 # Data pipeline
│   ├── scripts/          # Python scripts for data processing
│   ├── raw/              # Downloaded source data
│   └── processed/        # Processed GeoJSON files
├── renderer/             # Three.js isometric renderer
├── postprocess/          # Pixel-art post-processing
├── viewer/               # React + OpenSeaDragon frontend
└── tiles/                # Generated tile output
```

## Technology Stack

- **Data Processing**: Python + requests
- **3D Rendering**: Three.js (headless via Puppeteer)
- **Post-Processing**: Sharp.js
- **Frontend**: React + TypeScript + Vite
- **Tile Viewer**: OpenSeaDragon

## Data Sources

- OpenStreetMap (buildings, roads, landmarks)
- Open City Model (building heights where available)

## License

MIT
