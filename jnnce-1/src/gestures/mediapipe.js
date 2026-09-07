// MediaPipe Pipeline Module
// Handles MediaPipe Hands initialization, camera feed, landmark rendering, and gesture feedback visuals

// Module state
let hands = null;
let cameraFeed = null;
let overlayCtx = null;
let suppressHands = false;
let frameSkip = 0;
let frameCounter = 0;
let featureFlags = { showLandmarks: true, gestureDebug: false, twoHand: false };

// External function references (set by main.js)
let updateTrackingStatusFn = null;
let processHandResultsFn = null;
let applyHandOptionsFn = null;

// Initialize MediaPipe Hands
export async function initMediaPipe() {
    const videoEl = document.getElementById('input_video');
    const overlay = document.getElementById('overlay');
    overlayCtx = overlay.getContext('2d');

    // Configure Hands
    hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    
    if (applyHandOptionsFn) applyHandOptionsFn();
    hands.onResults(onResults);

    // Camera utils
    cameraFeed = new window.Camera(videoEl, {
        onFrame: async () => {
            if (suppressHands) return;
            frameCounter++;
            if (frameSkip > 0 && (frameCounter % (frameSkip + 1)) !== 0) return;
            await hands.send({ image: videoEl });
        },
        width: 480,
        height: 360,
    });
    await cameraFeed.start();
    if (updateTrackingStatusFn) updateTrackingStatusFn('tracking', 'Camera active');
}

// MediaPipe results callback
function onResults(results) {
    if (processHandResultsFn) processHandResultsFn(results);
}

// Update hand tracking options (e.g., when two-hand mode toggles)
export function applyHandOptions() {
    if (!hands) return;
    hands.setOptions({
        maxNumHands: featureFlags.twoHand ? 2 : 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });
}

// Get displayed video rect (handles letterboxing)
function getDisplayedVideoRect(videoEl, canvasEl) {
    const cw = canvasEl.width;
    const ch = canvasEl.height;
    const vw = videoEl.videoWidth || cw;
    const vh = videoEl.videoHeight || ch;
    if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch };
    const scale = Math.min(cw / vw, ch / vh);
    const w = vw * scale;
    const h = vh * scale;
    const x = (cw - w) / 2;
    const y = (ch - h) / 2;
    return { x, y, w, h };
}

// Map normalized landmarks to canvas pixels
function mapLandmarksToCanvasPx(landmarks, videoEl, canvasEl) {
    const rect = getDisplayedVideoRect(videoEl, canvasEl);
    return landmarks.map(lm => ({ x: rect.x + lm.x * rect.w, y: rect.y + lm.y * rect.h }));
}

// Render hand landmarks on overlay
export function renderHandLandmarks(landmarks) {
    const overlay = document.getElementById('overlay');
    const video = document.getElementById('input_video');
    overlayCtx.save();
    
    const mapped = mapLandmarksToCanvasPx(landmarks, video, overlay);
    
    // Draw all landmarks (joints)
    mapped.forEach((landmark, index) => {
        overlayCtx.fillStyle = '#f72585';
        overlayCtx.beginPath();
        overlayCtx.arc(landmark.x, landmark.y, 3, 0, 2 * Math.PI);
        overlayCtx.fill();
        
        if (featureFlags.gestureDebug) {
            overlayCtx.fillStyle = '#ffffff';
            overlayCtx.font = '10px Arial';
            overlayCtx.fillText(index.toString(), landmark.x + 5, landmark.y - 5);
        }
    });
    
    // Draw hand connections (bones)
    if (window.HAND_CONNECTIONS) {
        overlayCtx.strokeStyle = '#4cc9f0';
        overlayCtx.lineWidth = 2;
        
        window.HAND_CONNECTIONS.forEach(connection => {
            const [start, end] = connection;
            if (mapped[start] && mapped[end]) {
                overlayCtx.beginPath();
                overlayCtx.moveTo(mapped[start].x, mapped[start].y);
                overlayCtx.lineTo(mapped[end].x, mapped[end].y);
                overlayCtx.stroke();
            }
        });
    }
    
    // Draw key landmark highlights
    const keyLandmarks = [0, 4, 8, 12, 16, 20];
    keyLandmarks.forEach(index => {
        if (mapped[index]) {
            overlayCtx.fillStyle = '#00ff00';
            overlayCtx.beginPath();
            overlayCtx.arc(mapped[index].x, mapped[index].y, 5, 0, 2 * Math.PI);
            overlayCtx.fill();
            
            overlayCtx.fillStyle = '#ffffff';
            overlayCtx.font = 'bold 12px Arial';
            overlayCtx.fillText(index.toString(), mapped[index].x + 6, mapped[index].y - 6);
        }
    });
    
    // Draw palm center
    const palmCenter = {
        x: (mapped[0].x + mapped[5].x + mapped[9].x + mapped[13].x + mapped[17].x) / 5,
        y: (mapped[0].y + mapped[5].y + mapped[9].y + mapped[13].y + mapped[17].y) / 5
    };
    
    overlayCtx.fillStyle = '#ffff00';
    overlayCtx.beginPath();
    overlayCtx.arc(palmCenter.x, palmCenter.y, 6, 0, 2 * Math.PI);
    overlayCtx.fill();
    overlayCtx.fillStyle = '#000000';
    overlayCtx.font = 'bold 10px Arial';
    overlayCtx.fillText('P', palmCenter.x - 3, palmCenter.y + 3);
    
    overlayCtx.restore();
}

// Render gesture-specific visual feedback
export function renderGestureFeedback(landmarks, gestureType) {
    const overlay = document.getElementById('overlay');
    const video = document.getElementById('input_video');
    const mapped = mapLandmarksToCanvasPx(landmarks, video, overlay);
    
    overlayCtx.save();
    
    switch(gestureType) {
        case 'fist':
            const palmCenter = {
                x: (mapped[0].x + mapped[5].x + mapped[9].x + mapped[13].x + mapped[17].x) / 5,
                y: (mapped[0].y + mapped[5].y + mapped[9].y + mapped[13].y + mapped[17].y) / 5
            };
            overlayCtx.strokeStyle = '#ff0000';
            overlayCtx.lineWidth = 3;
            overlayCtx.beginPath();
            overlayCtx.arc(palmCenter.x, palmCenter.y, 30, 0, 2 * Math.PI);
            overlayCtx.stroke();
            break;
            
        case 'twoFingers':
            overlayCtx.strokeStyle = '#00ff00';
            overlayCtx.lineWidth = 4;
            overlayCtx.beginPath();
            overlayCtx.moveTo(mapped[8].x, mapped[8].y);
            overlayCtx.lineTo(mapped[12].x, mapped[12].y);
            overlayCtx.stroke();
            break;
            
        case 'oneFinger':
            overlayCtx.strokeStyle = '#0080ff';
            overlayCtx.lineWidth = 3;
            overlayCtx.beginPath();
            overlayCtx.arc(mapped[8].x, mapped[8].y, 25, 0, 2 * Math.PI);
            overlayCtx.stroke();
            break;
            
        case 'threeFingers':
            overlayCtx.strokeStyle = '#8000ff';
            overlayCtx.lineWidth = 3;
            overlayCtx.beginPath();
            overlayCtx.moveTo(mapped[8].x, mapped[8].y);
            overlayCtx.lineTo(mapped[12].x, mapped[12].y);
            overlayCtx.lineTo(mapped[16].x, mapped[16].y);
            overlayCtx.closePath();
            overlayCtx.stroke();
            break;
            
        case 'pinch':
            overlayCtx.strokeStyle = '#ff00ff';
            overlayCtx.lineWidth = 3;
            overlayCtx.beginPath();
            overlayCtx.moveTo(mapped[4].x, mapped[4].y);
            overlayCtx.lineTo(mapped[8].x, mapped[8].y);
            overlayCtx.stroke();
            break;
    }
    
    overlayCtx.restore();
}

// Render hand tracking statistics and info (debug mode)
export function renderHandTrackingInfo(landmarks) {
    const overlay = document.getElementById('overlay');
    const video = document.getElementById('input_video');
    const mapped = mapLandmarksToCanvasPx(landmarks, video, overlay);
    
    overlayCtx.save();
    
    const minX = Math.min(...mapped.map(lm => lm.x));
    const maxX = Math.max(...mapped.map(lm => lm.x));
    const minY = Math.min(...mapped.map(lm => lm.y));
    const maxY = Math.max(...mapped.map(lm => lm.y));
    const handWidth = maxX - minX;
    
    const belowHandY = maxY + 20;
    const centerX = (minX + maxX) / 2;
    
    const offsetMinX = minX - minX + centerX - handWidth/2;
    const offsetMinY = minY - minY + belowHandY;
    const offsetMaxX = maxX - minX + centerX - handWidth/2;
    const offsetMaxY = maxY - minY + belowHandY;
    
    overlayCtx.strokeStyle = '#ffffff';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([5, 5]);
    overlayCtx.strokeRect(offsetMinX - 10, offsetMinY - 10, offsetMaxX - offsetMinX + 20, offsetMaxY - offsetMinY + 20);
    overlayCtx.setLineDash([]);
    
    const handCenter = {
        x: (offsetMinX + offsetMaxX) / 2,
        y: (offsetMinY + offsetMaxY) / 2
    };
    
    overlayCtx.fillStyle = '#ffffff';
    overlayCtx.font = 'bold 14px Arial';
    overlayCtx.fillText('Hand Center', handCenter.x - 30, handCenter.y - 10);
    
    const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    const fingerTips = [4, 8, 12, 16, 20];
    const fingerBases = [2, 5, 9, 13, 17];
    
    const infoStartY = belowHandY + handWidth + 30;
    
    fingerNames.forEach((name, index) => {
        const tip = mapped[fingerTips[index]];
        const base = mapped[fingerBases[index]];
        const distance = Math.hypot(tip.x - base.x, tip.y - base.y);
        const isExtended = distance > 0.1;
        
        overlayCtx.fillStyle = isExtended ? '#00ff00' : '#ff0000';
        overlayCtx.font = '12px Arial';
        overlayCtx.fillText(`${name}: ${isExtended ? 'Extended' : 'Closed'}`, centerX - 50, infoStartY + index * 20);
    });
    
    overlayCtx.restore();
}

// Setters for external dependencies
export function setUpdateTrackingStatusFn(fn) { updateTrackingStatusFn = fn; }
export function setProcessHandResultsFn(fn) { processHandResultsFn = fn; }
export function setApplyHandOptionsFn(fn) { applyHandOptionsFn = fn; }
export function setFeatureFlags(flags) { featureFlags = flags; }
export function setFrameSkip(value) { frameSkip = value; }
export function setSuppressHands(value) { suppressHands = value; }
export function getHands() { return hands; }
export function getCameraFeed() { return cameraFeed; }