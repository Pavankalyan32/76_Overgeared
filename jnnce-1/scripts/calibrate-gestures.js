// Gesture Calibration Data Collector
// Records MediaPipe hand landmarks for each pose at multiple distances

const POSES = ['fist', 'openPalm', 'oneFinger', 'twoFingers', 'threeFingers'];
const DISTANCES = ['near', 'mid', 'far'];
const TARGET_SAMPLES_PER_POSE = 30;

let hands = null;
let cameraFeed = null;
let overlayCtx = null;
let currentPose = null;
let currentDistance = 'mid';
let calibrationData = {};
let totalSamples = 0;
let isCapturing = false;

const videoEl = document.getElementById('input_video');
const overlay = document.getElementById('overlay');
const statusText = document.getElementById('statusText');
const selectedPoseEl = document.getElementById('selectedPose');
const selectedDistEl = document.getElementById('selectedDist');
const totalSamplesEl = document.getElementById('totalSamples');
const progressBar = document.getElementById('progressBar');
const btnCapture = document.getElementById('btnCapture');
const landmarkDebug = document.getElementById('landmarkDebug');
const exportOutput = document.getElementById('exportOutput');

// Initialize calibration data structure
function initCalibrationData() {
    for (const pose of POSES) {
        calibrationData[pose] = {};
        for (const dist of DISTANCES) {
            calibrationData[pose][dist] = [];
        }
    }
}

// Update UI counts
function updateCounts() {
    for (const pose of POSES) {
        let poseTotal = 0;
        for (const dist of DISTANCES) {
            poseTotal += calibrationData[pose][dist].length;
        }
        const el = document.getElementById(`count-${pose}`);
        if (el) el.textContent = `${poseTotal} samples`;
        const card = document.querySelector(`.pose-card[data-pose="${pose}"]`);
        if (card) {
            card.classList.toggle('completed', poseTotal >= TARGET_SAMPLES_PER_POSE);
        }
    }
    totalSamples = 0;
    for (const pose of POSES) {
        for (const dist of DISTANCES) {
            totalSamples += calibrationData[pose][dist].length;
        }
    }
    totalSamplesEl.textContent = totalSamples;
    const targetTotal = POSES.length * DISTANCES.length * TARGET_SAMPLES_PER_POSE;
    progressBar.style.width = `${Math.min(100, (totalSamples / targetTotal) * 100)}%`;
}

// Select distance
function selectDistance(dist) {
    currentDistance = dist;
    document.querySelectorAll('.dist-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.dist === dist);
    });
    selectedDistEl.textContent = dist.charAt(0).toUpperCase() + dist.slice(1);
    updateCaptureButton();
}

// Select pose
function selectPose(pose) {
    currentPose = pose;
    document.querySelectorAll('.pose-card').forEach(card => {
        card.classList.toggle('active', card.dataset.pose === pose);
    });
    selectedPoseEl.textContent = pose;
    updateCaptureButton();
}

function updateCaptureButton() {
    btnCapture.disabled = !(currentPose && currentDistance);
}

// Capture a sample
function captureSample() {
    if (!currentPose || !currentDistance || isCapturing) return;
    isCapturing = true;
    btnCapture.textContent = 'Capturing...';
    btnCapture.disabled = true;

    // The landmarks are already computed in onResults, we just need to save the latest
    if (window.lastLandmarks) {
        const sample = {
            landmarks: window.lastLandmarks,
            handSpan: window.lastHandSpan,
            fingerExtensions: window.lastFingerExtensions,
            pinchRatio: window.lastPinchRatio,
            timestamp: Date.now(),
            distance: currentDistance
        };
        calibrationData[currentPose][currentDistance].push(sample);
        statusText.textContent = `Captured! ${calibrationData[currentPose][currentDistance].length}/${TARGET_SAMPLES_PER_POSE} for ${currentPose} @ ${currentDistance}`;
        updateCounts();
    } else {
        statusText.textContent = 'No hand detected - try again';
    }

    setTimeout(() => {
        isCapturing = false;
        updateCaptureButton();
        btnCapture.textContent = 'Capture Sample (Space)';
    }, 300);
}

// Clear current pose data
function clearCurrentPose() {
    if (!currentPose) return;
    for (const dist of DISTANCES) {
        calibrationData[currentPose][dist] = [];
    }
    updateCounts();
    statusText.textContent = `Cleared all data for ${currentPose}`;
}

// Clear all data
function clearAllData() {
    if (!confirm('Clear ALL calibration data? This cannot be undone.')) return;
    initCalibrationData();
    updateCounts();
    statusText.textContent = 'All data cleared';
    exportOutput.value = '';
}

// Export JSON
function exportJSON() {
    const output = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        targetSamplesPerPose: TARGET_SAMPLES_PER_POSE,
        poses: POSES,
        distances: DISTANCES,
        data: calibrationData,
        summary: {}
    };

    // Add summary stats
    for (const pose of POSES) {
        output.summary[pose] = {};
        for (const dist of DISTANCES) {
            const samples = calibrationData[pose][dist];
            output.summary[pose][dist] = {
                count: samples.length,
                avgHandSpan: samples.length ? samples.reduce((a, b) => a + b.handSpan, 0) / samples.length : 0,
                avgPinchRatio: samples.length ? samples.reduce((a, b) => a + b.pinchRatio, 0) / samples.length : 0
            };
        }
    }

    const json = JSON.stringify(output, null, 2);
    exportOutput.value = json;
    statusText.textContent = 'JSON exported to textarea. Click "Download .json File" to save.';
}

function downloadJSON() {
    if (!exportOutput.value) exportJSON();
    const blob = new Blob([exportOutput.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gesture-calibration-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusText.textContent = 'File downloaded';
}

// MediaPipe setup
async function initMediaPipe() {
    statusText.textContent = 'Loading MediaPipe Hands...';

    hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults(onResults);

    cameraFeed = new window.Camera(videoEl, {
        onFrame: async () => {
            await hands.send({ image: videoEl });
        },
        width: 640,
        height: 480,
    });

    overlay.width = videoEl.width;
    overlay.height = videoEl.height;
    overlayCtx = overlay.getContext('2d');

    await cameraFeed.start();
    statusText.textContent = 'Camera active. Select a pose and distance, then press Space to capture.';
    initCalibrationData();
    updateCounts();
}

// Landmark indices
const LM = {
    WRIST: 0,
    THUMB_TIP: 4,
    INDEX_MCP: 5,
    INDEX_TIP: 8,
    MIDDLE_MCP: 9,
    MIDDLE_TIP: 12,
    RING_MCP: 13,
    RING_TIP: 16,
    PINKY_MCP: 17,
    PINKY_TIP: 20,
};

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function palmCenter(landmarks) {
    const pts = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
    let x = 0, y = 0;
    for (const i of pts) { x += landmarks[i].x; y += landmarks[i].y; }
    return { x: x / pts.length, y: y / pts.length };
}

function handSpan(landmarks) {
    return Math.max(0.001, distance(landmarks[LM.INDEX_MCP], landmarks[LM.PINKY_MCP]));
}

function fingerExtensions(landmarks) {
    const palm = palmCenter(landmarks);
    const span = handSpan(landmarks);
    return {
        thumb: distance(landmarks[LM.THUMB_TIP], palm) / span,
        index: distance(landmarks[LM.INDEX_TIP], palm) / span,
        middle: distance(landmarks[LM.MIDDLE_TIP], palm) / span,
        ring: distance(landmarks[LM.RING_TIP], palm) / span,
        pinky: distance(landmarks[LM.PINKY_TIP], palm) / span,
    };
}

function pinchRatio(landmarks) {
    return distance(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) / handSpan(landmarks);
}

// Render landmarks on overlay
function renderLandmarks(landmarks) {
    overlayCtx.save();
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    // MediaPipe landmarks are normalized 0-1, map to canvas
    const mapped = landmarks.map(lm => ({
        x: lm.x * overlay.width,
        y: lm.y * overlay.height
    }));

    // Draw connections
    if (window.HAND_CONNECTIONS) {
        overlayCtx.strokeStyle = '#4cc9f0';
        overlayCtx.lineWidth = 2;
        window.HAND_CONNECTIONS.forEach(([start, end]) => {
            if (mapped[start] && mapped[end]) {
                overlayCtx.beginPath();
                overlayCtx.moveTo(mapped[start].x, mapped[start].y);
                overlayCtx.lineTo(mapped[end].x, mapped[end].y);
                overlayCtx.stroke();
            }
        });
    }

    // Draw landmarks
    mapped.forEach((lm, i) => {
        overlayCtx.fillStyle = i === 0 || [4,8,12,16,20].includes(i) ? '#f72585' : '#4cc9f0';
        overlayCtx.beginPath();
        overlayCtx.arc(lm.x, lm.y, [4,8,12,16,20].includes(i) ? 6 : 4, 0, 2 * Math.PI);
        overlayCtx.fill();
    });

    // Palm center
    const palm = palmCenter(landmarks);
    const palmX = palm.x * overlay.width;
    const palmY = palm.y * overlay.height;
    overlayCtx.fillStyle = '#ffff00';
    overlayCtx.beginPath();
    overlayCtx.arc(palmX, palmY, 8, 0, 2 * Math.PI);
    overlayCtx.fill();

    overlayCtx.restore();
}

function onResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        statusText.textContent = 'No hand detected. Position your hand in view.';
        landmarkDebug.textContent = '';
        return;
    }

    const landmarks = results.multiHandLandmarks[0];
    window.lastLandmarks = landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z }));

    const span = handSpan(landmarks);
    const exts = fingerExtensions(landmarks);
    const pinch = pinchRatio(landmarks);

    window.lastHandSpan = span;
    window.lastFingerExtensions = exts;
    window.lastPinchRatio = pinch;

    renderLandmarks(landmarks);

    // Debug output
    landmarkDebug.textContent = [
        `Hand Span: ${span.toFixed(4)}`,
        `Pinch Ratio: ${pinch.toFixed(4)}`,
        `Extensions: thumb=${exts.thumb.toFixed(3)} index=${exts.index.toFixed(3)} middle=${exts.middle.toFixed(3)} ring=${exts.ring.toFixed(3)} pinky=${exts.pinky.toFixed(3)}`,
        `Mean Ext: ${((exts.thumb + exts.index + exts.middle + exts.ring + exts.pinky) / 5).toFixed(3)}`,
        `---`,
        `Pose: ${currentPose || 'none'} | Dist: ${currentDistance}`,
        `Samples this pose/dist: ${currentPose ? calibrationData[currentPose][currentDistance].length : 0}`
    ].join('\n');
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isCapturing) {
        e.preventDefault();
        captureSample();
    }
    // Number keys 1-5 for poses
    if (e.key >= '1' && e.key <= '5') {
        selectPose(POSES[parseInt(e.key) - 1]);
    }
    // Keys n/m/f for distances
    if (e.key === 'n') selectDistance('near');
    if (e.key === 'm') selectDistance('mid');
    if (e.key === 'f') selectDistance('far');
});

// Initialize
document.addEventListener('DOMContentLoaded', initMediaPipe);