# Gesture Calibration Instructions

## Quick Start

### 1. Serve the calibration page
```bash
cd E:\Tesst\jnnce-1
npx serve scripts -p 3001
# Or use the existing server:
cd server
npm start
# Then open http://localhost:3000/scripts/calibrate-gestures.html
```

### 2. Run calibration session
**Requirements:**
- 3+ people with webcams
- Chrome/Edge/Firefox (Safari needs HTTPS)
- Good lighting, plain background

**Per person (5-10 minutes):**
1. Open the calibration page
2. Allow camera permission
3. For each **distance** (Near/Mid/Far):
   - **Near**: Hand ~20cm from camera (fills frame)
   - **Mid**: Hand ~50cm from camera (comfortable)
   - **Far**: Hand ~100cm from camera (small in frame)
4. For each **pose** (5 total):
   - Click the pose card to select it
   - Hold the pose steady in view
   - Press **Space** to capture (or click "Capture Sample")
   - Collect **30+ samples** per pose per distance
   - Move hand slightly between captures (different positions/rotations)
5. Repeat for all 5 poses × 3 distances = 15 combinations
6. Click **"Download .json File"** → save as `gesture-calibration-<name>.json`

**Pose reference:**
| Pose | Description |
|------|-------------|
| ✊ Fist | All fingers curled tightly into palm, thumb tucked |
| 🖐️ Open Palm | All 5 fingers extended straight, spread naturally |
| ☝️ One Finger | Only index finger extended, others curled |
| ✌️ Two Fingers | Index + middle extended, ring + pinky curled |
| 🤟 Three Fingers | Index + middle + ring extended, pinky curled |

### 3. Analyze calibration data
```bash
cd E:\Tesst\jnnce-1\scripts
node analyze-calibration.js gesture-calibration-<name>.json
# Or combine multiple files first (see below)
```

### 4. Combine multiple users' data (optional but recommended)
```bash
# Simple merge (concatenate samples)
node -e "
const fs = require('fs');
const files = process.argv.slice(2);
const combined = { version: '1.0', timestamp: new Date().toISOString(), targetSamplesPerPose: 30, poses: ['fist','openPalm','oneFinger','twoFingers','threeFingers'], distances: ['near','mid','far'], data: {} };
for (const pose of combined.poses) { combined.data[pose] = {}; for (const d of combined.distances) combined.data[pose][d] = []; }
for (const f of files) { const d = JSON.parse(fs.readFileSync(f)); for (const pose of combined.poses) for (const dist of combined.distances) combined.data[pose][dist].push(...d.data[pose][dist]); }
fs.writeFileSync('gesture-calibration-combined.json', JSON.stringify(combined, null, 2));
console.log('Combined:', Object.keys(combined.data).map(p => p + '=' + Object.values(combined.data[p]).reduce((a,b)=>a+b.length,0)).join(' '));
" gesture-calibration-*.json

node analyze-calibration.js gesture-calibration-combined.json
```

### 5. Apply thresholds
The analyzer outputs a `THRESHOLDS` object. Copy it into `jnnce-1/gestures.js`:

```javascript
// In gestures.js, replace the THRESHOLDS object:
export const THRESHOLDS = {
  fist: { enter: 0.XX, exit: 0.XX },
  extended: { enter: 0.XX, exit: 0.XX },
  curled: { enter: 0.XX, exit: 0.XX },
  thumbCurled: { enter: 0.XX, exit: 0.XX },
  pointingUpSlack: 0.15,
};
```

Add a comment with calibration date/version:
```javascript
// Calibrated: 2026-09-07, combined N users, 30 samples/pose/distance
// See CALIBRATION.md for methodology
```

### 6. Run tests
```bash
cd E:\Tesst\jnnce-1\server
npm test
# All 51 tests should pass
```

## Tips for Good Data

- **Lighting**: Bright, even lighting (no backlighting)
- **Background**: Plain wall, avoid clutter
- **Hand position**: Keep hand flat to camera, vary rotation slightly between captures
- **Samples**: More is better — 30 minimum, 50+ ideal
- **Distances**: Actually measure ~20cm, ~50cm, ~100cm for consistency
- **Pauses**: Brief pause between captures lets MediaPipe re-detect

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Camera not detected | Use `http://localhost` (not `file://`), or HTTPS |
| No hand landmarks | Better lighting, move hand closer, check MediaPipe CDN |
| Pose not registering | Hold pose steady 1-2s before pressing Space |
| Low sample count | Increase target, capture more varied positions |
| Thresholds feel wrong | Re-run with more people, check analysis output for overlap |

## Files Created

- `scripts/calibrate-gestures.html` — Data collection UI
- `scripts/calibrate-gestures.js` — MediaPipe integration, capture logic
- `scripts/analyze-calibration.js` — Statistical analysis + threshold recommendation
- `scripts/gesture-calibration-*.json` — Raw calibration data (generated)
- `scripts/gesture-calibration-*-analysis.json` — Analysis output (generated)