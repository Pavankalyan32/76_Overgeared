// App is an ES module now; import loaders and AR when needed
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Basic Three.js scene setup
let renderer, scene, camera;
let cube, activeObject = null;
let targetScale = 1.0; // gesture-driven scale
let baselineScale = 1.0; // user slider base
let targetRotation = { x: 0, y: 0 };
let targetPosition = { x: 0, y: 0 };

const ui = {};

const gestureState = {
    current: 'None',
    lastIndexPos: null,
    lastPinchDist: null,
    pinchActive: false,
    lastPinchNorm: null,
    emaPinchNorm: null,
    fistActive: false,
    lastFistTime: 0,
    twoFingersActive: false,
    lastTwoFingersTime: 0,
    oneFingerActive: false,
    lastOneFingerTime: 0,
    lastOneFingerPos: null,
    threeFingerActive: false,
    lastThreeFingerTime: 0,
    lastThreeFingerPos: null,
};

const featureFlags = {
    twoHand: false,
    hologram: false,
    multiplayer: false,
    useGemini: false,
    showLandmarks: true,
    gestureDebug: false,
};

let frameSkip = 0, frameCounter = 0;
let orbitControls = null;
let lockCenter = true;
let fpsCounter = 0;
let lastFpsTime = 0;


// Fist zoom settings
const FIST_ZOOM = {
    speed: 0.015, // zoom speed per frame
    maxZoom: 0.1, // maximum zoom distance (much closer)
    minDistance: 0.01, // minimum camera distance (very close)
};

// Two-finger zoom out settings
const TWO_FINGER_ZOOM = {
    speed: 0.015, // zoom out speed per frame
    maxDistance: 15.0, // maximum zoom out distance
    minDistance: 0.01, // minimum camera distance (very close)
};

// One-finger panning settings
const ONE_FINGER_PAN = {
    sensitivity: 0.8, // panning sensitivity
    maxPanDistance: 3.0, // maximum pan distance from center
    smoothing: 0.1, // smoothing factor for pan movement
};

// Three-finger viewport panning settings
const THREE_FINGER_PAN = {
    sensitivity: 1.2, // sensitivity for viewport panning
    maxPanDistance: 3.0, // maximum pan distance from center
    smoothing: 0.1, // smoothing factor for pan movement
};

function setBaselineScale(v) {
    baselineScale = v;
    if (ui.scaleSlider) ui.scaleSlider.value = String(v);
    if (ui.scaleNumber) ui.scaleNumber.value = String(v);
    if (ui.scaleValue) ui.scaleValue.textContent = Number(v).toFixed(2);
}

function setGesture(name) {
    gestureState.current = name;
    const el = document.getElementById('gesture');
    if (el) el.textContent = name;
}

function updateTrackingStatus(status, text) {
    const dot = document.getElementById('tracking_dot');
    const textEl = document.getElementById('tracking_text');
    if (dot) {
        dot.className = 'status-dot ' + status;
    }
    if (textEl) {
        textEl.textContent = text;
    }
}

function updateFPS() {
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        const fps = Math.round(fpsCounter * 1000 / (now - lastFpsTime));
        const fpsEl = document.getElementById('fps_counter');
        if (fpsEl) fpsEl.textContent = `${fps} FPS`;
        fpsCounter = 0;
        lastFpsTime = now;
    }
    fpsCounter++;
}

// Pinch tuning parameters
const PINCH = {
    start: 0.045, // engage pinch when distance below this
    end: 0.060,   // disengage pinch when distance above this
    emaAlpha: 0.3,
    minChangeRatio: 0.01, // deadzone
    ratioClampMin: 0.85,
    ratioClampMax: 1.18,
};

function initThree() {
    const container = document.getElementById('scene');
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = false;
    renderer.setClearColor(0x0c0e12, 1);
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, width / height, 0.001, 2000);
    camera.position.set(0, 0, 6);
    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.08;
    orbitControls.enabled = true;
    orbitControls.enablePan = false;
    orbitControls.enableZoom = true;
    orbitControls.minDistance = 0.01;
    orbitControls.maxDistance = 1000;

    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(2, 4, 3);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x8899aa, 0.5));

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x54a0ff, roughness: 0.35, metalness: 0.1 });
    cube = new THREE.Mesh(geo, mat);
    scene.add(cube);
    activeObject = cube;

    window.addEventListener('resize', () => {
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        // Optionally re-fit on resize to keep fully visible
        if (activeObject) fitCameraToObject(activeObject, 1.8);
    });
}

// Mouse input mapping
const mouseState = { isDown: false, mode: 'rotate', lastX: 0, lastY: 0 };

function screenDeltaToWorld(dx, dy) {
    if (!activeObject) return { wx: 0, wy: 0 };
    const box = new THREE.Box3().setFromObject(activeObject);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const dist = camera.position.distanceTo(center);
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const worldPerPixelY = (2 * Math.tan(vFov / 2) * dist) / (renderer.domElement.clientHeight || 1);
    const worldPerPixelX = worldPerPixelY * camera.aspect;
    return { wx: dx * worldPerPixelX, wy: dy * worldPerPixelY };
}

function bindMouseInput() {
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
        mouseState.isDown = true;
        mouseState.lastX = e.clientX;
        mouseState.lastY = e.clientY;
        if (e.button === 0) {
            if (e.ctrlKey || e.metaKey) mouseState.mode = 'scale';
            else if (e.shiftKey || e.altKey) mouseState.mode = 'translate';
            else mouseState.mode = 'rotate';
        } else if (e.button === 1 || e.button === 2) {
            mouseState.mode = 'translate';
        }
        el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
        if (!mouseState.isDown) return;
        const dx = e.clientX - mouseState.lastX;
        const dy = e.clientY - mouseState.lastY;
        mouseState.lastX = e.clientX;
        mouseState.lastY = e.clientY;

        if (mouseState.mode === 'rotate') {
            targetRotation.y += -dx * Math.PI * 0.01;
            targetRotation.x += -dy * Math.PI * 0.01;
            setGesture('Rotate (Mouse)');
        } else if (mouseState.mode === 'translate') {
            if (lockCenter) {
                // Pan the model when lock center is enabled
                const { wx, wy } = screenDeltaToWorld(dx, dy);
                targetPosition.x += wx;
                targetPosition.y -= wy; // screen y down -> world y up
                setGesture('Pan Model (Mouse)');
            } else {
                // Pan the viewport when lock center is disabled
                if (camera && activeObject) {
                    const box = new THREE.Box3().setFromObject(activeObject);
                    const center = new THREE.Vector3();
                    box.getCenter(center);
                    
                    // Get camera's right and up vectors for panning
                    const cameraRight = new THREE.Vector3();
                    camera.getWorldDirection(cameraRight);
                    cameraRight.cross(camera.up).normalize();
                    
                    const cameraUp = new THREE.Vector3(0, 1, 0);
                    
                    // Calculate pan movement
                    const panRight = cameraRight.clone().multiplyScalar(-dx * 0.01);
                    const panUp = cameraUp.clone().multiplyScalar(dy * 0.01);
                    
                    // Apply panning
                    camera.position.add(panRight).add(panUp);
                    camera.lookAt(center);
                }
                setGesture('Pan Viewport (Mouse)');
            }
        } else if (mouseState.mode === 'scale') {
            const factor = Math.exp(-dy * 0.003);
            const newBase = THREE.MathUtils.clamp(baselineScale * factor, 0.05, 10);
            if (typeof setBaselineScale === 'function') setBaselineScale(newBase); else baselineScale = newBase;
            setGesture('Scale (Mouse)');
        }
    });

    const end = (e) => {
        mouseState.isDown = false;
        try { el.releasePointerCapture(e.pointerId); } catch {}
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);

    el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = 1 + THREE.MathUtils.clamp(e.deltaY * 0.001, -0.5, 0.5);
        orbitDistance(factor);
        setGesture(e.deltaY > 0 ? 'Zoom Out (Wheel)' : 'Zoom In (Wheel)');
    }, { passive: false });
}

function lerp(a, b, t) { return a + (b - a) * t; }

function animate() {
    const loop = () => {
        // Smooth transforms
        if (activeObject) {
            const s = activeObject.scale.x;
            const combinedTarget = targetScale * baselineScale;
            const newS = lerp(s, combinedTarget, 0.18);
            activeObject.scale.setScalar(newS);
            activeObject.rotation.x = lerp(activeObject.rotation.x, targetRotation.x, 0.16);
            activeObject.rotation.y = lerp(activeObject.rotation.y, targetRotation.y, 0.16);
            activeObject.position.x = lerp(activeObject.position.x, targetPosition.x, 0.2);
            activeObject.position.y = lerp(activeObject.position.y, targetPosition.y, 0.2);
        }

        if (orbitControls && orbitControls.enabled) {
            if (activeObject && lockCenter) {
                const center = new THREE.Box3().setFromObject(activeObject).getCenter(new THREE.Vector3());
                orbitControls.target.lerp(center, 0.3);
            }
            orbitControls.update();
        }
        if (lockCenter && activeObject) {
            // Keep object centered when locked; decay any translation back to origin
            targetPosition.x = lerp(targetPosition.x, 0, 0.25);
            targetPosition.y = lerp(targetPosition.y, 0, 0.25);
            ensureInView(activeObject, 1.12);
        }
        if (featureFlags.hologram) {
            renderHologram();
        } else {
            renderer.setScissorTest(false);
            renderer.render(scene, camera);
        }
    };

    if (renderer.xr.enabled) {
        renderer.setAnimationLoop(loop);
    } else {
        function raf() {
            requestAnimationFrame(raf);
            loop();
        }
        raf();
    }
}

// MediaPipe Hands setup
let hands, cameraFeed, overlayCtx;
let suppressHands = false; // pause during AR

async function initMediaPipe() {
    const videoEl = document.getElementById('input_video');
    const overlay = document.getElementById('overlay');
    overlayCtx = overlay.getContext('2d');

    // Configure Hands
    hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });
    
    // Set fixed quality settings for optimal performance
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
    });
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
    updateTrackingStatus('tracking', 'Camera active');
}

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

function mapLandmarksToCanvasPx(landmarks, videoEl, canvasEl) {
    const rect = getDisplayedVideoRect(videoEl, canvasEl);
    return landmarks.map(lm => ({ x: rect.x + lm.x * rect.w, y: rect.y + lm.y * rect.h }));
}

function renderHandLandmarks(landmarks) {
    const overlay = document.getElementById('overlay');
    const video = document.getElementById('input_video');
    overlayCtx.save();
    
    // Map normalized landmarks to canvas pixels respecting letterbox
    const mapped = mapLandmarksToCanvasPx(landmarks, video, overlay);
    
    // Draw all landmarks (joints) - directly on hands
    mapped.forEach((landmark, index) => {
        // Draw landmark dot
        overlayCtx.fillStyle = '#f72585';
        overlayCtx.beginPath();
        overlayCtx.arc(landmark.x, landmark.y, 3, 0, 2 * Math.PI);
        overlayCtx.fill();
        
        // Draw landmark number for debugging
        if (featureFlags.gestureDebug) {
            overlayCtx.fillStyle = '#ffffff';
            overlayCtx.font = '10px Arial';
            overlayCtx.fillText(index.toString(), landmark.x + 5, landmark.y - 5);
        }
    });
    
    // Draw hand connections (bones) - directly on hands
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
    
    // Draw key landmark highlights - directly on hands
    const keyLandmarks = [0, 4, 8, 12, 16, 20]; // palm, thumb tip, index tip, middle tip, ring tip, pinky tip
    keyLandmarks.forEach(index => {
        if (mapped[index]) {
            // Draw larger green circle for key landmarks
            overlayCtx.fillStyle = '#00ff00';
            overlayCtx.beginPath();
            overlayCtx.arc(mapped[index].x, mapped[index].y, 5, 0, 2 * Math.PI);
            overlayCtx.fill();
            
            // Draw landmark number for key points
            overlayCtx.fillStyle = '#ffffff';
            overlayCtx.font = 'bold 12px Arial';
            overlayCtx.fillText(index.toString(), mapped[index].x + 6, mapped[index].y - 6);
        }
    });
    
    // Draw palm center - directly on hand
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

// Draw gesture-specific visual feedback
function renderGestureFeedback(landmarks, gestureType) {
    const overlay = document.getElementById('overlay');
    const video = document.getElementById('input_video');
    const mapped = mapLandmarksToCanvasPx(landmarks, video, overlay);
    
    overlayCtx.save();
    
    switch(gestureType) {
        case 'fist':
            // Highlight fist gesture with red circle around palm
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
            // Highlight index and middle fingers with green lines
            overlayCtx.strokeStyle = '#00ff00';
            overlayCtx.lineWidth = 4;
            overlayCtx.beginPath();
            overlayCtx.moveTo(mapped[8].x, mapped[8].y);
            overlayCtx.lineTo(mapped[12].x, mapped[12].y);
            overlayCtx.stroke();
            break;
            
        case 'oneFinger':
            // Highlight index finger with blue circle
            overlayCtx.strokeStyle = '#0080ff';
            overlayCtx.lineWidth = 3;
            overlayCtx.beginPath();
            overlayCtx.arc(mapped[8].x, mapped[8].y, 25, 0, 2 * Math.PI);
            overlayCtx.stroke();
            break;
            
        case 'threeFingers':
            // Highlight three fingers with purple triangle
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
            // Draw line between thumb and index finger
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

// Draw hand tracking statistics and information
function renderHandTrackingInfo(landmarks) {
    const overlay = document.getElementById('overlay');
    const video = document.getElementById('input_video');
    const mapped = mapLandmarksToCanvasPx(landmarks, video, overlay);
    
    overlayCtx.save();
    
    // Calculate hand bounding box
    const minX = Math.min(...mapped.map(lm => lm.x));
    const maxX = Math.max(...mapped.map(lm => lm.x));
    const minY = Math.min(...mapped.map(lm => lm.y));
    const maxY = Math.max(...mapped.map(lm => lm.y));
    const handWidth = maxX - minX;
    
    // Position for elements below the hand
    const belowHandY = maxY + 20;
    const centerX = (minX + maxX) / 2;
    
    // Draw hand bounding box - positioned below hand
    const offsetMinX = minX - minX + centerX - handWidth/2;
    const offsetMinY = minY - minY + belowHandY;
    const offsetMaxX = maxX - minX + centerX - handWidth/2;
    const offsetMaxY = maxY - minY + belowHandY;
    
    overlayCtx.strokeStyle = '#ffffff';
    overlayCtx.lineWidth = 1;
    overlayCtx.setLineDash([5, 5]);
    overlayCtx.strokeRect(offsetMinX - 10, offsetMinY - 10, offsetMaxX - offsetMinX + 20, offsetMaxY - offsetMinY + 20);
    overlayCtx.setLineDash([]);
    
    // Draw hand center - positioned below hand
    const handCenter = {
        x: (offsetMinX + offsetMaxX) / 2,
        y: (offsetMinY + offsetMaxY) / 2
    };
    
    overlayCtx.fillStyle = '#ffffff';
    overlayCtx.font = 'bold 14px Arial';
    overlayCtx.fillText('Hand Center', handCenter.x - 30, handCenter.y - 10);
    
    // Draw finger extension information - positioned below hand
    const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
    const fingerTips = [4, 8, 12, 16, 20];
    const fingerBases = [2, 5, 9, 13, 17];
    
    const infoStartY = belowHandY + handWidth + 30;
    
    fingerNames.forEach((name, index) => {
        const tip = mapped[fingerTips[index]];
        const base = mapped[fingerBases[index]];
        const distance = calculateDistance(tip, base);
        const isExtended = distance > 0.1;
        
        overlayCtx.fillStyle = isExtended ? '#00ff00' : '#ff0000';
        overlayCtx.font = '12px Arial';
        overlayCtx.fillText(`${name}: ${isExtended ? 'Extended' : 'Closed'}`, centerX - 50, infoStartY + index * 20);
    });
    
    overlayCtx.restore();
}

// Gesture logic
function calculateDistance(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return Math.hypot(dx, dy); }

function isFist(landmarks) {
    // Check if fingers are curled by comparing tip positions to palm center
    const palmCenter = {
        x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
        y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5
    };
    
    // Check if finger tips are close to palm center
    const fingerTips = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky tips
    const avgDistance = fingerTips.reduce((sum, tipIndex) => {
        return sum + calculateDistance(landmarks[tipIndex], palmCenter);
    }, 0) / fingerTips.length;
    
    // Fist if average distance is small
    return avgDistance < 0.08;
}

function handleFistZoom(landmarks) {
    if (isFist(landmarks)) {
        if (!gestureState.fistActive) {
            gestureState.fistActive = true;
            gestureState.lastFistTime = performance.now();
            setGesture('Fist → Zooming in');
        }
        
        // Draw gesture feedback
        renderGestureFeedback(landmarks, 'fist');
        
        // Slowly zoom in by moving camera closer to object
        if (activeObject && camera) {
            const box = new THREE.Box3().setFromObject(activeObject);
            const center = new THREE.Vector3();
            box.getCenter(center);
            
            const dir = new THREE.Vector3().subVectors(camera.position, center);
            const currentDistance = dir.length();
            const newDistance = Math.max(FIST_ZOOM.minDistance, currentDistance - FIST_ZOOM.speed);
            
            if (newDistance < currentDistance) {
                dir.setLength(newDistance);
                camera.position.copy(center.clone().add(dir));
                camera.lookAt(center);
            }
        }
    } else if (gestureState.fistActive) {
        // Fist released, stop zooming
        gestureState.fistActive = false;
        setGesture('Fist released');
    }
}

function isTwoFingers(landmarks) {
    // Calculate palm center for better reference
    const palmCenter = {
        x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
        y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5
    };
    
    // Check if exactly two fingers are extended (index and middle)
    const fingerTips = [8, 12]; // index and middle finger tips
    const fingerBases = [5, 9]; // index and middle finger bases
    
    // Check if these two fingers are extended (distance from palm center)
    const indexExtended = calculateDistance(landmarks[fingerTips[0]], palmCenter) > 0.15;
    const middleExtended = calculateDistance(landmarks[fingerTips[1]], palmCenter) > 0.15;
    
    // Check if other fingers are closed (distance from palm center)
    const ringFinger = calculateDistance(landmarks[16], palmCenter) < 0.12;
    const pinkyFinger = calculateDistance(landmarks[20], palmCenter) < 0.12;
    const thumbClosed = calculateDistance(landmarks[4], palmCenter) < 0.12;
    
    // Additional check: ensure fingers are pointing upward
    const indexPointingUp = landmarks[fingerTips[0]].y < landmarks[fingerBases[0]].y;
    const middlePointingUp = landmarks[fingerTips[1]].y < landmarks[fingerBases[1]].y;
    
    const result = indexExtended && middleExtended && indexPointingUp && middlePointingUp && 
                   ringFinger && pinkyFinger && thumbClosed;
    
    // Debug logging
    if (featureFlags.gestureDebug) {
        console.log('Two fingers check:', {
            indexExtended,
            middleExtended,
            indexPointingUp,
            middlePointingUp,
            ringFinger,
            pinkyFinger,
            thumbClosed,
            result
        });
    }
    
    return result;
}

function handleTwoFingerZoom(landmarks) {
    if (isTwoFingers(landmarks)) {

        if (!gestureState.twoFingersActive) {
            gestureState.twoFingersActive = true;
            gestureState.lastTwoFingersTime = performance.now();
            setGesture('Two fingers → Zooming out');
        }
        
        // Draw gesture feedback
        renderGestureFeedback(landmarks, 'twoFingers');
        
        // Slowly zoom out by moving camera away from object
        if (camera) {
            let center;
            if (activeObject) {
                const box = new THREE.Box3().setFromObject(activeObject);
                center = new THREE.Vector3();
                box.getCenter(center);
            } else {
                // Fallback to scene center if no active object
                center = new THREE.Vector3(0, 0, 0);
            }
            
            const dir = new THREE.Vector3().subVectors(camera.position, center);
            const currentDistance = dir.length();
            const newDistance = Math.min(TWO_FINGER_ZOOM.maxDistance, currentDistance + TWO_FINGER_ZOOM.speed);
            
            if (newDistance > currentDistance) {
                dir.setLength(newDistance);
                camera.position.copy(center.clone().add(dir));
                camera.lookAt(center);
            }
        }
    } else if (gestureState.twoFingersActive) {
        // Two fingers released, stop zooming
        gestureState.twoFingersActive = false;
        setGesture('Two fingers released');
    }
}

function isOneFinger(landmarks) {
    // Calculate palm center for better reference
    const palmCenter = {
        x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
        y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5
    };
    
    // Check if only index finger is extended
    const indexTip = landmarks[8]; // index finger tip
    const indexBase = landmarks[5]; // index finger base
    
    // Check if index finger is extended (distance from palm center)
    const indexExtended = calculateDistance(indexTip, palmCenter) > 0.15;
    
    // Check if other fingers are closed (distance from palm center)
    const middleFinger = calculateDistance(landmarks[12], palmCenter) < 0.12;
    const ringFinger = calculateDistance(landmarks[16], palmCenter) < 0.12;
    const pinkyFinger = calculateDistance(landmarks[20], palmCenter) < 0.12;
    const thumbClosed = calculateDistance(landmarks[4], palmCenter) < 0.12;
    
    // Additional check: ensure index finger is pointing upward
    const indexPointingUp = indexTip.y < indexBase.y;
    
    return indexExtended && indexPointingUp && middleFinger && ringFinger && pinkyFinger && thumbClosed;
}

function isThreeFingers(landmarks) {
    // Calculate palm center for better reference
    const palmCenter = {
        x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5,
        y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5
    };
    
    // Check if exactly three fingers are extended (index, middle, ring)
    const fingerTips = [8, 12, 16]; // index, middle, ring finger tips
    const fingerBases = [5, 9, 13]; // index, middle, ring finger bases
    
    // Check if these three fingers are extended (distance from palm center)
    const indexExtended = calculateDistance(landmarks[fingerTips[0]], palmCenter) > 0.15;
    const middleExtended = calculateDistance(landmarks[fingerTips[1]], palmCenter) > 0.15;
    const ringExtended = calculateDistance(landmarks[fingerTips[2]], palmCenter) > 0.15;
    
    // Check if other fingers are closed (distance from palm center)
    const pinkyFinger = calculateDistance(landmarks[20], palmCenter) < 0.12;
    const thumbClosed = calculateDistance(landmarks[4], palmCenter) < 0.12;
    
    // Additional check: ensure fingers are pointing upward
    const indexPointingUp = landmarks[fingerTips[0]].y < landmarks[fingerBases[0]].y;
    const middlePointingUp = landmarks[fingerTips[1]].y < landmarks[fingerBases[1]].y;
    const ringPointingUp = landmarks[fingerTips[2]].y < landmarks[fingerBases[2]].y;
    
    const result = indexExtended && middleExtended && ringExtended && 
                   indexPointingUp && middlePointingUp && ringPointingUp &&
                   pinkyFinger && thumbClosed;
    
    // Debug logging
    if (featureFlags.gestureDebug) {
        console.log('Three fingers check:', {
            indexExtended,
            middleExtended,
            ringExtended,
            indexPointingUp,
            middlePointingUp,
            ringPointingUp,
            pinkyFinger,
            thumbClosed,
            result
        });
    }
    
    return result;
}

function handleThreeFingerPan(landmarks) {
    if (isThreeFingers(landmarks)) {
        // Use the center point between the three fingers for panning
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];
        const ringTip = landmarks[16];
        
        const currentPos = {
            x: (indexTip.x + middleTip.x + ringTip.x) / 3,
            y: (indexTip.y + middleTip.y + ringTip.y) / 3
        };
        
        if (!gestureState.threeFingerActive) {
            gestureState.threeFingerActive = true;
            gestureState.lastThreeFingerTime = performance.now();
            gestureState.lastThreeFingerPos = currentPos;
            setGesture('Three fingers → Panning model');
        }
        
        // Draw gesture feedback
        renderGestureFeedback(landmarks, 'threeFingers');
        
        // Always pan the model with three fingers
        if (activeObject && gestureState.lastThreeFingerPos) {
            // Calculate movement delta
            const deltaX = (currentPos.x - gestureState.lastThreeFingerPos.x) * THREE_FINGER_PAN.sensitivity;
            const deltaY = (currentPos.y - gestureState.lastThreeFingerPos.y) * THREE_FINGER_PAN.sensitivity;
            
            // Get camera's right and up vectors for movement direction
            const cameraRight = new THREE.Vector3();
            camera.getWorldDirection(cameraRight);
            cameraRight.cross(camera.up).normalize();
            
            const cameraUp = new THREE.Vector3(0, 1, 0);
            
            // Calculate model movement (inverted for natural feel)
            const moveRight = cameraRight.clone().multiplyScalar(-deltaX * 2.5);
            const moveUp = cameraUp.clone().multiplyScalar(deltaY * 2.5);
            
            // Apply movement to the model with smoothing
            const newPosition = activeObject.position.clone().add(moveRight).add(moveUp);
            
            // Clamp movement to prevent going too far
            const distance = newPosition.length();
            if (distance > THREE_FINGER_PAN.maxPanDistance) {
                newPosition.setLength(THREE_FINGER_PAN.maxPanDistance);
            }
            
            // Update target position for smooth movement
            targetPosition.x = newPosition.x;
            targetPosition.y = newPosition.y;
            
            // Update last position for next frame
            gestureState.lastThreeFingerPos = currentPos;
        }
    } else if (gestureState.threeFingerActive) {
        // Three fingers released, stop panning
        gestureState.threeFingerActive = false;
        setGesture('Three fingers released');
    }
}

function handleOneFingerPan(landmarks) {
    if (isOneFinger(landmarks)) {

        const indexTip = landmarks[8];
        const currentPos = { x: indexTip.x, y: indexTip.y };
        
        if (!gestureState.oneFingerActive) {
            gestureState.oneFingerActive = true;
            gestureState.lastOneFingerTime = performance.now();
            gestureState.lastOneFingerPos = currentPos;
            setGesture(lockCenter ? 'One finger → Panning model' : 'One finger → Panning viewport');
        }
        
        // Draw gesture feedback
        renderGestureFeedback(landmarks, 'oneFinger');
        
        // Calculate pan movement based on finger position change
        if (gestureState.lastOneFingerPos) {
            if (lockCenter) {
                // Pan the model when lock center is enabled
                if (activeObject) {
                    // Calculate movement delta
                    const deltaX = (currentPos.x - gestureState.lastOneFingerPos.x) * ONE_FINGER_PAN.sensitivity;
                    const deltaY = (currentPos.y - gestureState.lastOneFingerPos.y) * ONE_FINGER_PAN.sensitivity;
                    
                    // Get camera's right and up vectors for movement direction
                    const cameraRight = new THREE.Vector3();
                    camera.getWorldDirection(cameraRight);
                    cameraRight.cross(camera.up).normalize();
                    
                    const cameraUp = new THREE.Vector3(0, 1, 0);
                    
                    // Calculate model movement (inverted for natural feel)
                    const moveRight = cameraRight.clone().multiplyScalar(-deltaX * 2.5);
                    const moveUp = cameraUp.clone().multiplyScalar(deltaY * 2.5);
                    
                    // Apply movement to the model with smoothing
                    const newPosition = activeObject.position.clone().add(moveRight).add(moveUp);
                    
                    // Update target position for smooth movement
                    targetPosition.x = newPosition.x;
                    targetPosition.y = newPosition.y;
                }
            } else {
                // Pan the viewport when lock center is disabled
                if (camera) {
                    let center;
                    if (activeObject) {
                        const box = new THREE.Box3().setFromObject(activeObject);
                        center = new THREE.Vector3();
                        box.getCenter(center);
                    } else {
                        // Fallback to scene center if no active object
                        center = new THREE.Vector3(0, 0, 0);
                    }
                    
                    // Calculate movement delta
                    const deltaX = (currentPos.x - gestureState.lastOneFingerPos.x) * ONE_FINGER_PAN.sensitivity;
                    const deltaY = (currentPos.y - gestureState.lastOneFingerPos.y) * ONE_FINGER_PAN.sensitivity;
                    
                    // Get camera's right and up vectors for panning
                    const cameraRight = new THREE.Vector3();
                    camera.getWorldDirection(cameraRight);
                    cameraRight.cross(camera.up).normalize();
                    
                    const cameraUp = new THREE.Vector3(0, 1, 0);
                    
                    // Calculate pan movement (inverted for natural camera movement)
                    const panRight = cameraRight.clone().multiplyScalar(deltaX * 3);
                    const panUp = cameraUp.clone().multiplyScalar(-deltaY * 3);
                    
                    // Apply panning with smoothing
                    const newPosition = camera.position.clone().add(panRight).add(panUp);
                    
                    // Keep camera looking at the object center
                    camera.position.lerp(newPosition, ONE_FINGER_PAN.smoothing);
                    camera.lookAt(center);
                }
            }
            
            // Update last position for next frame
            gestureState.lastOneFingerPos = currentPos;
        }
    } else if (gestureState.oneFingerActive) {
        // One finger released, stop panning
        gestureState.oneFingerActive = false;
        setGesture('One finger released');
    }
}

function onResults(results) {
    const overlay = document.getElementById('overlay');
    const video = document.getElementById('input_video');
    
    // Ensure overlay dimensions exactly match the video display size
    if (overlay.width !== overlay.clientWidth || overlay.height !== overlay.clientHeight) {
        overlay.width = overlay.clientWidth;
        overlay.height = overlay.clientHeight;
    }

    overlayCtx.save();
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    overlayCtx.restore();

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        setGesture('None');
        // Reset all gesture states when no hands detected
        resetGestureStates();
        updateTrackingStatus('processing', 'No hands detected');
        return;
    }

    const handsLms = results.multiHandLandmarks;
    updateTrackingStatus('tracking', `${handsLms.length} hand${handsLms.length > 1 ? 's' : ''} detected`);

    if (handsLms.length === 1) {
        const landmarks = handsLms[0];
        if (featureFlags.showLandmarks) {
            renderHandLandmarks(landmarks);
        }
        
        // Show hand tracking info in debug mode
        if (featureFlags.gestureDebug) {
            renderHandTrackingInfo(landmarks);
        }

        // Check for fist zooming first
        handleFistZoom(landmarks);
        
        // Check for two-finger zooming second
        handleTwoFingerZoom(landmarks);
        
        // Check for one-finger panning third
        handleOneFingerPan(landmarks);
        
        // Check for three-finger viewport panning fourth
        handleThreeFingerPan(landmarks);
        
        // If fist, two fingers, one finger, or three fingers are active, don't process other gestures
        if (gestureState.fistActive || gestureState.twoFingersActive || gestureState.oneFingerActive || gestureState.threeFingerActive) {
            return;
        }

        // Landmark indices: 4 thumb tip, 8 index tip, 12 middle tip
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];

        const pinchDistance = calculateDistance(thumbTip, indexTip);
        // Normalize pinch by hand span to reduce perspective variance
        const span = Math.max(0.001, calculateDistance(landmarks[5], landmarks[17]));
        const pinchNorm = pinchDistance / span;
        // Hysteresis around thresholds for stability
        if (!gestureState.pinchActive && pinchNorm < PINCH.start) gestureState.pinchActive = true;
        if (gestureState.pinchActive && pinchNorm > PINCH.end) gestureState.pinchActive = false;
        const isPinching = gestureState.pinchActive;
        const indexMiddleDistance = calculateDistance(indexTip, middleTip);
        const isOpenPalm = !isPinching && pinchNorm > (PINCH.end + 0.01) && indexMiddleDistance > 0.09;

        if (isPinching) {
            setGesture('Pinch → Scale');
            // Draw gesture feedback
            renderGestureFeedback(landmarks, 'pinch');
            // EMA smooth normalized pinch
            const last = gestureState.emaPinchNorm ?? pinchNorm;
            const ema = last * (1 - PINCH.emaAlpha) + pinchNorm * PINCH.emaAlpha;
            gestureState.emaPinchNorm = ema;
            if (gestureState.lastPinchNorm != null && gestureState.lastPinchNorm > 0) {
                let ratio = ema / gestureState.lastPinchNorm;
                const delta = Math.abs(ratio - 1);
                if (delta > PINCH.minChangeRatio) {
                    ratio = THREE.MathUtils.clamp(ratio, PINCH.ratioClampMin, PINCH.ratioClampMax);
                    const newBase = THREE.MathUtils.clamp(baselineScale * ratio, 0.05, 10);
                    setBaselineScale(newBase);
                }
            }
            gestureState.lastPinchNorm = ema;
            gestureState.lastPinchDist = pinchDistance;
        } else if (isOpenPalm) {
            setGesture('Open palm → Translate');
            const nx = (indexTip.x - 0.5) * 2;
            const ny = (0.5 - indexTip.y) * 2;
            targetPosition.x = nx * 1.2;
            targetPosition.y = ny * 0.9;
            gestureState.lastPinchDist = null;
            gestureState.lastPinchNorm = null;
            gestureState.emaPinchNorm = null;
        } else {
            setGesture('Index move → Rotate');
            const idx = { x: indexTip.x, y: indexTip.y };
            if (gestureState.lastIndexPos) {
                const dx = idx.x - gestureState.lastIndexPos.x;
                const dy = idx.y - gestureState.lastIndexPos.y;
                targetRotation.y += -dx * Math.PI * 1.8;
                targetRotation.x += -dy * Math.PI * 1.8;
            }
            gestureState.lastIndexPos = idx;
            gestureState.lastPinchDist = null;
            gestureState.lastPinchNorm = null;
            gestureState.emaPinchNorm = null;
        }
    } else if (handsLms.length >= 2 && featureFlags.twoHand) {
        const a = handsLms[0];
        const b = handsLms[1];
        if (featureFlags.showLandmarks) {
            renderHandLandmarks(a);
            renderHandLandmarks(b);
        }
        const aIndex = a[8];
        const bIndex = b[8];
        const dist = calculateDistance(aIndex, bIndex);
        const midx = (aIndex.x + bIndex.x) / 2;
        const midy = (aIndex.y + bIndex.y) / 2;
        setGesture('Two hands → Scale + Translate');
        targetScale = THREE.MathUtils.clamp(0.2 + dist * 6.0, 0.1, 8.0);
        targetPosition.x = (midx - 0.5) * 2 * 1.1;
        targetPosition.y = (0.5 - midy) * 2 * 0.9;
    }
    
    updateFPS();
}

// Hologram pyramid rendering (quad view)
function renderHologram() {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const halfW = Math.floor(w / 2);
    const halfH = Math.floor(h / 2);
    renderer.setScissorTest(true);

    // Top
    renderer.setViewport(halfW / 2, halfH, halfW, halfH);
    renderer.setScissor(halfW / 2, halfH, halfW, halfH);
    renderer.render(scene, camera);

    // Left (rotate 90)
    const rotY = activeObject ? activeObject.rotation.y : 0;
    if (activeObject) activeObject.rotation.y = rotY + Math.PI / 2;
    renderer.setViewport(0, 0, halfW, halfH);
    renderer.setScissor(0, 0, halfW, halfH);
    renderer.render(scene, camera);
    if (activeObject) activeObject.rotation.y = rotY;

    // Right (rotate -90)
    if (activeObject) activeObject.rotation.y = rotY - Math.PI / 2;
    renderer.setViewport(halfW, 0, halfW, halfH);
    renderer.setScissor(halfW, 0, halfW, halfH);
    renderer.render(scene, camera);
    if (activeObject) activeObject.rotation.y = rotY;

    // Bottom (upside-down)
    const rotX = activeObject ? activeObject.rotation.x : 0;
    if (activeObject) activeObject.rotation.x = rotX + Math.PI;
    renderer.setViewport(halfW / 2, 0, halfW, halfH);
    renderer.setScissor(halfW / 2, 0, halfW, halfH);
    renderer.render(scene, camera);
    if (activeObject) activeObject.rotation.x = rotX;
}

// Recording & replay
const recording = { active: false, startTime: 0, frames: [] };
let replayTimer = null;

function startRecording() {
    recording.active = true;
    recording.startTime = performance.now();
    recording.frames = [];
}
function stopRecording() { recording.active = false; }
function pushFrame() {
    if (!recording.active || !activeObject) return;
    const t = performance.now() - recording.startTime;
    recording.frames.push({ t, s: targetScale, rx: targetRotation.x, ry: targetRotation.y, px: targetPosition.x, py: targetPosition.y });
}
function clearRecording() { recording.frames = []; }
function replayRecording() {
    if (replayTimer || recording.frames.length === 0) return;
    // Disable live processing during replay
    suppressHands = true;
    let i = 0;
    const start = performance.now();
    replayTimer = setInterval(() => {
        const elapsed = performance.now() - start;
        while (i < recording.frames.length && recording.frames[i].t <= elapsed) {
            const f = recording.frames[i++];
            targetScale = f.s; targetRotation.x = f.rx; targetRotation.y = f.ry; targetPosition.x = f.px; targetPosition.y = f.py;
        }
        if (i >= recording.frames.length) {
            clearInterval(replayTimer); replayTimer = null; suppressHands = false;
        }
    }, 16);
}

// GLTF model loading
let currentModel = null;
const SAMPLE_MODELS = {
    helmet: 'https://rawcdn.githack.com/mrdoob/three.js/r160/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf',
    duck: 'https://rawcdn.githack.com/mrdoob/three.js/r160/examples/models/gltf/Duck/glTF/Duck.gltf',
    fox: 'https://rawcdn.githack.com/mrdoob/three.js/r160/examples/models/gltf/Fox/glTF/Fox.gltf',
    robot: 'https://rawcdn.githack.com/mrdoob/three.js/r160/examples/models/gltf/RobotExpressive/glTF/RobotExpressive.gltf',
};

async function loadModel(kind) {
    // Clear all existing models and objects except lights and default cube
    clearAllModels();
    
    // Basic geometric shapes
    if (kind === 'earth') {
        const geometry = new THREE.SphereGeometry(0.8, 64, 64);
        try {
            const loader = new THREE.TextureLoader();
            const texture = await loader.loadAsync('https://rawcdn.githack.com/mrdoob/three.js/r160/examples/textures/planets/earth_atmos_2048.jpg');
            texture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, metalness: 0.0 });
            const earth = new THREE.Mesh(geometry, material);
            scene.add(earth);
            activeObject = earth;
        } catch (e) {
            // Fallback: show untextured earth if texture fails to load
            const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.8, metalness: 0.0 });
            const earth = new THREE.Mesh(geometry, fallbackMat);
            scene.add(earth);
            activeObject = earth;
            console.warn('Earth texture failed to load, using fallback sphere:', e);
        }
        fitCameraToObject(activeObject, 1.15);
        return;
    }
    
    // Basic geometric shapes
    if (kind === 'cube') { 
        activeObject = cube; 
        cube.visible = true; 
        fitCameraToObject(activeObject, 1.15); 
        return; 
    }
    
    // Basic geometric shapes
    if (kind === 'cube') { 
        activeObject = cube; 
        cube.visible = true; 
        fitCameraToObject(activeObject, 1.15); 
        return; 
    }
    
    if (kind === 'sphere') {
        const geometry = new THREE.SphereGeometry(0.8, 32, 32);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x54a0ff, 
            roughness: 0.3, 
            metalness: 0.2 
        });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);
        activeObject = sphere;
        fitCameraToObject(activeObject, 1.15);
        return;
    }
    
    if (kind === 'torus') {
        const geometry = new THREE.TorusGeometry(0.6, 0.2, 16, 100);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xff6b6b, 
            roughness: 0.4, 
            metalness: 0.1 
        });
        const torus = new THREE.Mesh(geometry, material);
        scene.add(torus);
        activeObject = torus;
        fitCameraToObject(activeObject, 1.15);
        return;
    }
    
    if (kind === 'cylinder') {
        const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x51cf66, 
            roughness: 0.5, 
            metalness: 0.1 
        });
        const cylinder = new THREE.Mesh(geometry, material);
        scene.add(cylinder);
        activeObject = cylinder;
        fitCameraToObject(activeObject, 1.15);
        return;
    }
    
    if (kind === 'cone') {
        const geometry = new THREE.ConeGeometry(0.6, 1.2, 32);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xffd43b, 
            roughness: 0.6, 
            metalness: 0.05 
        });
        const cone = new THREE.Mesh(geometry, material);
        scene.add(cone);
        activeObject = cone;
        fitCameraToObject(activeObject, 1.15);
        return;
    }
    
    // Complex geometric shapes
    if (['octahedron', 'dodecahedron', 'icosahedron', 'ring', 'plane'].includes(kind)) {
        const complexShape = createComplexShape(kind);
        if (complexShape) {
            scene.add(complexShape);
            activeObject = complexShape;
            fitCameraToObject(activeObject, 1.15);
            return;
        }
    }
    
    // GLTF models
    cube.visible = false;
    const url = SAMPLE_MODELS[kind];
    if (!url) {
        console.error('Unknown model type:', kind);
        return;
    }
    
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
        loader.load(url, (gltf) => {
            currentModel = gltf.scene;
            currentModel.position.set(0, 0, 0);
            currentModel.scale.setScalar(1);
            scene.add(currentModel);
            activeObject = currentModel;
            fitCameraToObject(activeObject, 1.15);
            resolve();
        }, undefined, reject);
    });
}

function centerAndScale(object3d) {
    const box = new THREE.Box3().setFromObject(object3d);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    
    // Center the object
    object3d.position.sub(center);
    
    // Calculate appropriate scale for better visibility
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 1.0 / maxDim;
    
    // Use a more conservative scale to ensure the model fits well in view
    object3d.scale.multiplyScalar(scale * 1.2);
    
    // Ensure the object is not too small or too large
    const finalBox = new THREE.Box3().setFromObject(object3d);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);
    const finalMaxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
    
    if (finalMaxDim < 0.5) {
        object3d.scale.multiplyScalar(2.0);
    } else if (finalMaxDim > 3.0) {
        object3d.scale.multiplyScalar(0.5);
    }
}

async function loadCustomFromURL(url) {
    const u = String(url || '').trim();
    const lower = u.toLowerCase();
    showLoadingIndicator();
    try {
        // Clear all existing models first
        clearAllModels();
        cube.visible = false;
        if (lower.endsWith('.gltf') || lower.endsWith('.glb')) {
            const loader = new GLTFLoader();
            try {
                // Set resource path for external .bin/textures if URL has a directory
                const base = u.substring(0, u.lastIndexOf('/') + 1);
                if (base.startsWith('http')) loader.setResourcePath(base);
            } catch {}
            const gltf = await loader.loadAsync(u);
            currentModel = gltf.scene;
        } else if (lower.endsWith('.obj')) {
            // Enhanced OBJ loading with better error handling
            try {
                // Try to locate a sibling .mtl if same base name
                const base = u.replace(/\.obj$/i, '');
                const mtlUrl = base + '.mtl';
                
                const mtlLoader = new MTLLoader();
                const mtl = await mtlLoader.loadAsync(mtlUrl);
                mtl.preload();
                
                const loader = new OBJLoader();
                loader.setMaterials(mtl);
                currentModel = await loader.loadAsync(u);
                console.log('OBJ with MTL loaded successfully from URL');
            } catch (mtlError) {
                // Fallback to OBJ without MTL
                console.log('No MTL file found, loading OBJ with default materials');
                const loader = new OBJLoader();
                currentModel = await loader.loadAsync(u);
            }
            
            // Process the OBJ model
            currentModel.traverse(child => {
                if (child.isMesh) {
                    // Ensure geometry has normals
                    if (child.geometry && !child.geometry.attributes.normal) {
                        child.geometry.computeVertexNormals();
                    }
                    
                    // Ensure material exists
                    if (!child.material) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0xcccccc,
                            roughness: 0.5,
                            metalness: 0.1
                        });
                    }
                    
                    // Enable shadows
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        } else if (lower.endsWith('.stl')) {
            const loader = new STLLoader();
            const geom = await loader.loadAsync(u);
            const mat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, roughness: 0.6, metalness: 0.05 });
            currentModel = new THREE.Mesh(geom, mat);
        } else {
            alert('Unsupported format. Use .glb, .gltf, .obj, or .stl');
            cube.visible = true; activeObject = cube; return;
        }
        // Ensure normals for basic lighting
        currentModel.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry && !child.geometry.attributes.normal) {
                    child.geometry.computeVertexNormals();
                }
                if (child.material) {
                    child.material.needsUpdate = true;
                }
            }
        });
        centerAndScale(currentModel);
        scene.add(currentModel);
        activeObject = currentModel;
        // Reflect custom selection in UI
        if (ui.modelSelect) ui.modelSelect.value = 'custom';
        fitCameraToObject(activeObject, 1.8);
    } catch (err) {
        console.error('Failed to load model:', err);
        alert('Failed to load model. If loading from a URL, ensure it allows CORS. For file uploads, prefer .glb (binary GLTF).');
        cube.visible = true; activeObject = cube;
    } finally {
        hideLoadingIndicator();
    }
}

async function loadOBJFile(objFile, mtlFile = null) {
    const objURL = URL.createObjectURL(objFile);
    const urlsToRevoke = [objURL];
    
    try {
        // Clear existing models
        clearAllModels();
        cube.visible = false;
        
        let materials = null;
        
        // Load MTL file if provided
        if (mtlFile) {
            const mtlURL = URL.createObjectURL(mtlFile);
            urlsToRevoke.push(mtlURL);
            
            try {
                const mtlLoader = new MTLLoader();
                materials = await mtlLoader.loadAsync(mtlURL);
                materials.preload();
                console.log('MTL materials loaded successfully');
            } catch (mtlError) {
                console.warn('Failed to load MTL file, using default materials:', mtlError);
                materials = null;
            }
        }
        
        // Load OBJ file
        const loader = new OBJLoader();
        if (materials) {
            loader.setMaterials(materials);
        }
        
        const model = await loader.loadAsync(objURL);
        
        // Process the model
        model.traverse(child => {
            if (child.isMesh) {
                // Ensure geometry has normals
                if (child.geometry && !child.geometry.attributes.normal) {
                    child.geometry.computeVertexNormals();
                }
                
                // Ensure material exists
                if (!child.material) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xcccccc,
                        roughness: 0.5,
                        metalness: 0.1
                    });
                }
                
                // Enable shadows
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        // Center and scale the model
        centerAndScale(model);
        scene.add(model);
        activeObject = model;
        fitCameraToObject(activeObject, 1.8);
        
        console.log('OBJ file loaded successfully:', objFile.name);
        return model;
        
    } catch (error) {
        console.error('Error loading OBJ file:', error);
        throw new Error(`Failed to load OBJ file: ${error.message}`);
    } finally {
        // Clean up URLs
        setTimeout(() => {
            urlsToRevoke.forEach(url => URL.revokeObjectURL(url));
        }, 5000);
    }
}

async function loadCustomFromFile(file) {
    const name = (file?.name || '').toLowerCase();
    if (name.endsWith('.gltf')) {
        alert('Note: .gltf may reference external files. Prefer .glb for a single-file upload.');
    }
    
    // Special handling for OBJ files
    if (name.endsWith('.obj')) {
        return await loadOBJFile(file);
    }
    
    const url = URL.createObjectURL(file);
    try {
        await loadCustomFromURL(url);
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
}

// Multiplayer (Socket.io)
let socket = null, lastEmit = 0;
function initSocket() {
    if (!window.io) return;
    socket = window.io('http://localhost:3000', { transports: ['websocket'], autoConnect: false });
    socket.on('connect', () => console.log('Connected to multiplayer'));
    socket.on('state', (state) => {
        if (!state) return;
        targetScale = state.s; targetRotation.x = state.rx; targetRotation.y = state.ry; targetPosition.x = state.px; targetPosition.y = state.py;
    });
}
function maybeEmitState() {
    if (!socket || !featureFlags.multiplayer) return;
    const now = performance.now();
    if (now - lastEmit < 50) return; // 20 Hz
    lastEmit = now;
    socket.emit('state', { s: targetScale, rx: targetRotation.x, ry: targetRotation.y, px: targetPosition.x, py: targetPosition.y });
}

// AR mode
function setupARButton() {
    try {
        const btn = ARButton.createButton(renderer, { requiredFeatures: [] });
        const container = document.getElementById('ar_container');
        if (container && btn) {
            container.innerHTML = '';
            container.appendChild(btn);
            btn.addEventListener('click', () => {
                // When entering AR, pause hands because camera conflicts with WebXR camera
                const isPresenting = renderer.xr.isPresenting;
                suppressHands = isPresenting;
            });
        }
    } catch (e) {
        console.log('');
    }
}

// Clear all models and objects from scene
function clearAllModels() {
    // Remove current model if exists
    if (currentModel) {
        scene.remove(currentModel);
        currentModel.traverse((child) => {
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        if (mat) mat.dispose();
                    });
                } else {
                    child.material.dispose();
                }
            }
            if (child.geometry) {
                child.geometry.dispose();
            }
        });
        currentModel = null;
    }
    
    // Remove all other objects except lights, scene, and default cube
    const objectsToRemove = [];
    scene.children.forEach(child => {
        if (child !== cube && child !== scene && 
            child.type !== 'DirectionalLight' && child.type !== 'AmbientLight') {
            objectsToRemove.push(child);
        }
    });
    
    // Remove and dispose of objects
    objectsToRemove.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => {
                    if (mat) mat.dispose();
                });
            } else {
                obj.material.dispose();
            }
        }
    });
    
    // Hide default cube initially
    cube.visible = false;
}

// Reset all gesture states
function resetGestureStates() {
    gestureState.fistActive = false;
    gestureState.twoFingersActive = false;
    gestureState.oneFingerActive = false;
    gestureState.threeFingerActive = false;
    gestureState.pinchActive = false;
    gestureState.lastIndexPos = null;
    gestureState.lastPinchDist = null;
    gestureState.lastPinchNorm = null;
    gestureState.emaPinchNorm = null;
    gestureState.lastFistTime = 0;
    gestureState.lastTwoFingersTime = 0;
    gestureState.lastOneFingerTime = 0;
    gestureState.lastOneFingerPos = null;
    gestureState.lastThreeFingerTime = 0;
    gestureState.lastThreeFingerPos = null;
    console.log('All gesture states reset');
}

// Reset all models to default cube
function resetModels() {
    // Clear all models first
    clearAllModels();
    
    // Reset to default cube
    cube.visible = true;
    activeObject = cube;
    
    // Reset transforms
    cube.position.set(0, 0, 0);
    cube.rotation.set(0, 0, 0);
    cube.scale.setScalar(1);
    
    // Reset gesture targets
    targetScale = 1.0;
    targetRotation = { x: 0, y: 0 };
    targetPosition = { x: 0, y: 0 };
    baselineScale = 1.0;
    
    // Reset gesture states
    resetGestureStates();
    
    // Reset UI
    if (ui.scaleSlider) ui.scaleSlider.value = '1';
    if (ui.scaleNumber) ui.scaleNumber.value = '1';
    if (ui.scaleValue) ui.scaleValue.textContent = '1.0';
    if (ui.modelSelect) ui.modelSelect.value = 'cube';
    
    // Fit camera to cube
    fitCameraToObject(cube, 1.15);
    
    console.log('Models reset to default cube');
}

// Create complex geometric shapes
function createComplexShape(type) {
    let geometry, material;
    
    switch(type) {
        case 'octahedron':
            geometry = new THREE.OctahedronGeometry(0.8);
            material = new THREE.MeshStandardMaterial({ 
                color: 0x845ef7, 
                roughness: 0.2, 
                metalness: 0.3 
            });
            break;
        case 'dodecahedron':
            geometry = new THREE.DodecahedronGeometry(0.7);
            material = new THREE.MeshStandardMaterial({ 
                color: 0xfd7e14, 
                roughness: 0.4, 
                metalness: 0.1 
            });
            break;
        case 'icosahedron':
            geometry = new THREE.IcosahedronGeometry(0.8);
            material = new THREE.MeshStandardMaterial({ 
                color: 0x20c997, 
                roughness: 0.3, 
                metalness: 0.2 
            });
            break;
        case 'ring':
            geometry = new THREE.RingGeometry(0.3, 0.8, 32);
            material = new THREE.MeshStandardMaterial({ 
                color: 0xe83e8c, 
                roughness: 0.5, 
                metalness: 0.1,
                side: THREE.DoubleSide 
            });
            break;
        case 'plane':
            geometry = new THREE.PlaneGeometry(2, 2);
            material = new THREE.MeshStandardMaterial({ 
                color: 0x6c757d, 
                roughness: 0.8, 
                metalness: 0.0,
                side: THREE.DoubleSide 
            });
            break;
        default:
            return null;
    }
    
    return new THREE.Mesh(geometry, material);
}

// Gemini stub (placeholder)
async function processWithGeminiStub(videoEl) {
    // Placeholder: return null to let MediaPipe path handle; or mirror a simple rotation gesture
    return null;
}

function bindUI() {
    ui.twoHand = document.getElementById('toggle_twohand');
    ui.hologram = document.getElementById('toggle_hologram');
    ui.multiplayer = document.getElementById('toggle_multiplayer');
    ui.gemini = document.getElementById('toggle_gemini');

    ui.frameSkip = document.getElementById('frame_skip');
    ui.frameSkipValue = document.getElementById('frame_skip_value');
    ui.modelSelect = document.getElementById('model_select');
    ui.scaleSlider = document.getElementById('scale_slider');
    ui.scaleNumber = document.getElementById('scale_number');
    ui.scaleValue = document.getElementById('scale_value');
    ui.fileInput = document.getElementById('file_input');
    ui.urlInput = document.getElementById('url_input');
    ui.btnLoadURL = document.getElementById('btn_load_url');
    ui.btnRecord = document.getElementById('btn_record');
    ui.btnStop = document.getElementById('btn_stop');
    ui.btnReplay = document.getElementById('btn_replay');
    ui.btnClear = document.getElementById('btn_clear');
    ui.btnZoomOut = document.getElementById('btn_zoom_out');
    ui.btnZoomIn = document.getElementById('btn_zoom_in');
    ui.btnFit = document.getElementById('btn_fit');
    ui.btnSurface = document.getElementById('btn_surface');
    ui.btnResetModels = document.getElementById('btn_reset_models');
    
    // Sidebar controls
    ui.btnExtend = document.getElementById('btn_extend');
    ui.btnCollapse = document.getElementById('btn_collapse');
    
    // AI Chat controls
    ui.btnVoiceToggle = document.getElementById('btn_voice_toggle');
    ui.btnScreenRead = document.getElementById('btn_screen_read');
    ui.btnRefreshScreen = document.getElementById('btn_refresh_screen');
    ui.btnChatToggle = document.getElementById('btn_chat_toggle');
    ui.chatInput = document.getElementById('chat_input');
    ui.btnSend = document.getElementById('btn_send');
    
    // Camera controls

    ui.toggleTracking = document.getElementById('toggle_tracking');
    ui.toggleGestureDebug = document.getElementById('toggle_gesture_debug');

    ui.twoHand.addEventListener('change', (e) => featureFlags.twoHand = e.target.checked);
    ui.hologram.addEventListener('change', (e) => featureFlags.hologram = e.target.checked);
    ui.multiplayer.addEventListener('change', (e) => {
        featureFlags.multiplayer = e.target.checked;
        if (socket) {
            if (featureFlags.multiplayer) socket.connect(); else socket.disconnect();
        }
    });
    ui.gemini.addEventListener('change', (e) => featureFlags.useGemini = e.target.checked);

    ui.lockCenter = document.getElementById('toggle_lock_center');
    ui.lockCenter.addEventListener('change', (e) => { lockCenter = !!e.target.checked; if (orbitControls) orbitControls.enablePan = !lockCenter; });
    ui.frameSkip.addEventListener('input', (e) => { frameSkip = Number(e.target.value); ui.frameSkipValue.textContent = String(frameSkip); });
    ui.modelSelect.addEventListener('change', async (e) => { await loadModel(e.target.value); });
    
    // Sidebar control bindings
    ui.btnExtend.addEventListener('click', () => {
        const sidebar = document.querySelector('.sidebar');
        const isCollapsed = sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed', !isCollapsed);
        ui.btnExtend.classList.toggle('collapsed', !isCollapsed);
        ui.btnExtend.textContent = isCollapsed ? '←' : '→';
    });
    
    ui.btnCollapse.addEventListener('click', () => {
        const sidebar = document.querySelector('.sidebar');
        sidebar.classList.add('collapsed');
        ui.btnExtend.classList.remove('collapsed');
        ui.btnExtend.textContent = '→';
    });
    
    // AI Chat control bindings
    ui.btnVoiceToggle.addEventListener('click', () => {
        if (aiState.isListening) {
            stopVoiceRecognition();
        } else {
            startVoiceRecognition();
        }
    });
    
    ui.btnScreenRead.addEventListener('click', async () => {
        addMessage('Analyzing your screen...', 'ai');
        const response = await performRealTimeAnalysis('What can you see on my screen? Please describe the current state and any 3D objects or gestures visible.');
        const chatMessages = document.getElementById('chat_messages');
        if (chatMessages.lastChild) {
            chatMessages.removeChild(chatMessages.lastChild);
        }
        addMessage(response, 'ai');
    });
    
    ui.btnRefreshScreen.addEventListener('click', async () => {
        addMessage('Refreshing screen...', 'ai');
        const response = await performRealTimeAnalysis('Please describe the current state of the screen, including any 3D objects or gestures visible.');
        const chatMessages = document.getElementById('chat_messages');
        if (chatMessages.lastChild) {
            chatMessages.removeChild(chatMessages.lastChild);
        }
        addMessage(response, 'ai');
    });

    ui.btnChatToggle.addEventListener('click', toggleChat);
    
    ui.btnSend.addEventListener('click', () => {
        const input = ui.chatInput.value.trim();
        if (input) {
            handleUserInput(input);
            ui.chatInput.value = '';
        }
    });
    
    ui.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const input = e.target.value.trim();
            if (input) {
                handleUserInput(input);
                e.target.value = '';
            }
        }
    });
    

    
    ui.toggleTracking.addEventListener('change', (e) => {
        featureFlags.showLandmarks = e.target.checked;
    });
    
    ui.toggleGestureDebug.addEventListener('change', (e) => {
        featureFlags.gestureDebug = e.target.checked;
    });

    function setBaselineScale(v) {
        baselineScale = v;
        if (ui.scaleSlider) ui.scaleSlider.value = String(v);
        if (ui.scaleNumber) ui.scaleNumber.value = String(v);
        if (ui.scaleValue) ui.scaleValue.textContent = Number(v).toFixed(2);
    }
    ui.scaleSlider.addEventListener('input', (e) => setBaselineScale(Number(e.target.value)));
    ui.scaleNumber.addEventListener('input', (e) => setBaselineScale(Number(e.target.value)));
    ui.fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        
        try {
            showLoadingIndicator();
            
            // Enhanced file handling with better OBJ support
            const supportedFormats = ['.glb', '.gltf', '.obj', '.mtl', '.stl'];
            const objFiles = files.filter(f => f.name.toLowerCase().endsWith('.obj'));
            const mtlFiles = files.filter(f => f.name.toLowerCase().endsWith('.mtl'));
            const otherFiles = files.filter(f => {
                const ext = f.name.toLowerCase();
                return ['.glb', '.gltf', '.stl'].some(format => ext.endsWith(format));
            });
            
            if (objFiles.length > 0) {
                // Handle OBJ files with optional MTL materials
                const objFile = objFiles[0];
                const mtlFile = mtlFiles.find(mtl => 
                    mtl.name.toLowerCase().replace('.mtl', '') === 
                    objFile.name.toLowerCase().replace('.obj', '')
                );
                
                await loadOBJFile(objFile, mtlFile);
            } else if (otherFiles.length > 0) {
                // Handle other 3D formats
                await loadCustomFromFile(otherFiles[0]);
            } else {
                alert('Please select a supported 3D file format (.glb, .gltf, .obj, .stl)');
                return;
            }
        } catch (error) {
            console.error('File loading error:', error);
            alert(`Failed to load file: ${error.message}`);
        } finally {
            hideLoadingIndicator();
            e.target.value = '';
        }
    });
    ui.btnLoadURL.addEventListener('click', async () => {
        const u = (ui.urlInput.value || '').trim();
        if (u) await loadCustomFromURL(u);
    });
    ui.urlInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const u = (ui.urlInput.value || '').trim();
            if (u) await loadCustomFromURL(u);
        }
    });

    ui.btnRecord.addEventListener('click', () => { startRecording(); ui.btnRecord.disabled = true; ui.btnStop.disabled = false; ui.btnReplay.disabled = true; ui.btnClear.disabled = true; });
    ui.btnStop.addEventListener('click', () => { stopRecording(); ui.btnRecord.disabled = false; ui.btnStop.disabled = true; ui.btnReplay.disabled = recording.frames.length === 0; ui.btnClear.disabled = recording.frames.length === 0; });
    ui.btnReplay.addEventListener('click', () => { replayRecording(); });
    ui.btnClear.addEventListener('click', () => { clearRecording(); ui.btnReplay.disabled = true; ui.btnClear.disabled = true; });
    ui.btnZoomOut.addEventListener('click', () => { orbitDistance(1.5); });
    ui.btnZoomIn.addEventListener('click', () => { orbitDistance(0.5); });
    ui.btnFit.addEventListener('click', () => { if (activeObject) fitCameraToObject(activeObject, 1.8); });
    ui.btnSurface.addEventListener('click', () => { if (activeObject) zoomToSurface(); });
    ui.btnResetModels.addEventListener('click', resetModels);
    
    // Bind new centering buttons
    const btnCenterObject = document.getElementById('btn_center_object');
    const btnResetCamera = document.getElementById('btn_reset_camera');
    if (btnCenterObject) btnCenterObject.addEventListener('click', centerObject);
    if (btnResetCamera) btnResetCamera.addEventListener('click', resetCamera);
    
    // Add gesture reset button for debugging
    const gestureResetBtn = document.createElement('button');
    gestureResetBtn.textContent = 'Reset Gestures';
    gestureResetBtn.style.cssText = 'position: fixed; top: 10px; right: 10px; z-index: 1000; padding: 8px; background: #ff6b6b; color: white; border: none; border-radius: 4px; cursor: pointer;';
    gestureResetBtn.addEventListener('click', resetGestureStates);
    document.body.appendChild(gestureResetBtn);
}

// Boot
window.addEventListener('DOMContentLoaded', async () => {
    initThree();
    bindUI();
    initSocket();
    setupARButton();
    bindMouseInput();
    initSpeechRecognition(); // Initialize AI voice recognition
    animate();
    await initMediaPipe();
    await loadModel('cube');

    // Push recording frames and maybe emit multiplayer state
    setInterval(() => { pushFrame(); maybeEmitState(); }, 50);
});

// Fit camera so object is fully visible
function fitCameraToObject(object3d, margin = 1.8) {
    if (!object3d || !camera || !renderer) return;
    const box = new THREE.Box3().setFromObject(object3d);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxSize = Math.max(size.x, size.y, size.z);
    if (!isFinite(maxSize) || maxSize === 0) return;

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const halfHeight = size.y / 2;
    const halfWidth = size.x / 2;
    const distanceY = halfHeight / Math.tan(vFov / 2);
    const distanceX = halfWidth / (Math.tan(vFov / 2) * camera.aspect);
    const distance = Math.max(distanceX, distanceY) * margin;

    // Increase near and far planes for better depth range and close inspection
    camera.near = Math.max(0.001, distance / 1000);
    camera.far = Math.max(distance * 1000, camera.near + 100);
    camera.updateProjectionMatrix();

    camera.position.set(center.x, center.y, center.z + distance);
    camera.lookAt(center);
    
    // Ensure the object is within the viewport
    ensureInView(object3d, 1.4);
}

// Center object in the scene
function centerObject() {
    if (!activeObject) return;
    
    // Reset object position to center
    activeObject.position.set(0, 0, 0);
    
    // Reset object rotation
    activeObject.rotation.set(0, 0, 0);
    
    // Reset gesture targets
    targetPosition = { x: 0, y: 0 };
    targetRotation = { x: 0, y: 0 };
    
    // Fit camera to centered object
    fitCameraToObject(activeObject, 1.8);
    
    console.log('Object centered and camera reset');
}

// Reset camera to default position
function resetCamera() {
    if (!activeObject) return;
    
    // Fit camera to object with default margin
    fitCameraToObject(activeObject, 1.8);
    
    console.log('Camera reset to default position');
}

// Zoom in/out while keeping camera aimed at object's center
function orbitDistance(multiplier) {
    if (!activeObject || !camera) return;
    const box = new THREE.Box3().setFromObject(activeObject);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const dir = new THREE.Vector3().subVectors(camera.position, center);
    const newPos = new THREE.Vector3().addVectors(center, dir.multiplyScalar(multiplier));
    camera.position.copy(newPos);
    camera.lookAt(center);
}

// Get extremely close to the model surface for detailed inspection
function zoomToSurface() {
    if (!activeObject || !camera) return;
    const box = new THREE.Box3().setFromObject(activeObject);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    
    // Calculate a very close distance (0.1% of model size)
    const maxSize = Math.max(size.x, size.y, size.z);
    const closeDistance = maxSize * 0.001; // Very close to surface
    
    // Position camera very close to the model
    const dir = new THREE.Vector3().subVectors(camera.position, center).normalize();
    const newPos = new THREE.Vector3().addVectors(center, dir.multiplyScalar(closeDistance));
    camera.position.copy(newPos);
    camera.lookAt(center);
    
    console.log('Zoomed to model surface for detailed inspection');
}

// Ensure the object remains within view frustum by nudging camera distance
function ensureInView(object3d, margin = 1.1) {
    if (!object3d || !camera) return;
    const box = new THREE.Box3().setFromObject(object3d);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const halfHeight = size.y / 2;
    const halfWidth = size.x / 2;
    const distanceY = halfHeight / Math.tan(vFov / 2);
    const distanceX = halfWidth / (Math.tan(vFov / 2) * camera.aspect);
    const required = Math.max(distanceX, distanceY) * margin;

    const dir = new THREE.Vector3().subVectors(camera.position, center);
    const current = dir.length();
    
    // Allow very close inspection but prevent clipping
    const minDistance = Math.max(0.001, required * 0.1); // Allow 10% of required distance
    
    if (current < minDistance) {
        // Too close - move back slightly
        dir.setLength(lerp(current, minDistance, 0.3));
        camera.position.copy(center.clone().add(dir));
        camera.lookAt(center);
    } else if (current < required) {
        // Within acceptable range but could be better
        dir.setLength(lerp(current, required, 0.2));
        camera.position.copy(center.clone().add(dir));
        camera.lookAt(center);
    }
}

// Gemini API configuration
const GEMINI_CONFIG = {
    apiKey: 'AIzaSyBs4KSZgdft0HlXCSg_LY84XY3GZZAzRpk', // Gemini API key
    model: 'gemini-1.5-flash',
    maxTokens: 400,
    temperature: 0.3,
};

// AI Chat state
const aiState = {
    isListening: false,
    isChatOpen: true,
    recognition: null,
    chatHistory: [],
    isProcessing: false,
    voiceOutput: true,
    lastVoiceQuestionAt: 0,
};

// Initialize speech recognition
function initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        aiState.recognition = new SpeechRecognition();
        // Stop after each utterance
        aiState.recognition.continuous = false;
        aiState.recognition.interimResults = false;
        aiState.recognition.lang = 'en-US';
        
        aiState.recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            handleVoiceInput(transcript);
        };
        
        aiState.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            stopVoiceRecognition();
        };
        
        aiState.recognition.onend = () => {
            // Do not auto-restart; ensure UI reflects stopped state
            stopVoiceRecognition();
        };
    } else {
        console.warn('Speech recognition not supported');
    }
}

// Voice recognition controls
function startVoiceRecognition() {
    if (aiState.recognition && !aiState.isListening) {
        aiState.recognition.start();
        aiState.isListening = true;
        updateVoiceUI(true);
        addMessage('Listening...', 'ai');
    }
}

function stopVoiceRecognition() {
    if (aiState.recognition && aiState.isListening) {
        aiState.recognition.stop();
        aiState.isListening = false;
        updateVoiceUI(false);
    }
}

function updateVoiceUI(isListening) {
    const voiceBtn = document.getElementById('btn_voice_toggle');
    const voiceIndicator = document.getElementById('voice_indicator');
    
    if (voiceBtn) {
        voiceBtn.classList.toggle('active', isListening);
        voiceBtn.textContent = isListening ? '⏹️' : '🎤';
    }
    
    if (voiceIndicator) {
        voiceIndicator.classList.toggle('active', isListening);
    }
}

// Screen capture and analysis
async function captureScreenForAI() {
    try {
        console.log('Starting screen capture...');
        
        // Capture the 3D scene
        const canvas = renderer.domElement;
        if (!canvas) {
            console.error('Renderer canvas not found');
            return null;
        }
        
        console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
        const dataURL = canvas.toDataURL('image/png');
        console.log('Scene captured, data length:', dataURL.length);
        
        // Also capture camera feed if available
        const video = document.getElementById('input_video');
        let videoDataURL = null;
        
        if (video && video.videoWidth > 0) {
            console.log('Video dimensions:', video.videoWidth, 'x', video.videoHeight);
            const videoCanvas = document.createElement('canvas');
            videoCanvas.width = video.videoWidth;
            videoCanvas.height = video.videoHeight;
            const ctx = videoCanvas.getContext('2d');
            ctx.drawImage(video, 0, 0);
            videoDataURL = videoCanvas.toDataURL('image/png');
            console.log('Video captured, data length:', videoDataURL.length);
        } else {
            console.log('Video not available or not ready');
        }
        
        // Gather real-time context data
        console.log('Gathering context data...');
        console.log('Active object:', activeObject);
        console.log('Camera:', camera);
        console.log('Gesture state:', gestureState);
        console.log('Feature flags:', featureFlags);
        
        const contextData = {
            timestamp: new Date().toISOString(),
            activeObject: activeObject ? {
                type: activeObject.type || 'unknown',
                position: activeObject.position ? {
                    x: Math.round(activeObject.position.x * 100) / 100,
                    y: Math.round(activeObject.position.y * 100) / 100,
                    z: Math.round(activeObject.position.z * 100) / 100
                } : null,
                rotation: activeObject.rotation ? {
                    x: Math.round(activeObject.rotation.x * 180 / Math.PI) / 1,
                    y: Math.round(activeObject.rotation.y * 180 / Math.PI) / 1,
                    z: Math.round(activeObject.rotation.z * 180 / Math.PI) / 1
                } : null,
                scale: activeObject.scale ? {
                    x: Math.round(activeObject.scale.x * 100) / 100,
                    y: Math.round(activeObject.scale.y * 100) / 100,
                    z: Math.round(activeObject.scale.z * 100) / 100
                } : null
            } : null,
            camera: camera ? {
                position: {
                    x: Math.round(camera.position.x * 100) / 100,
                    y: Math.round(camera.position.y * 100) / 100,
                    z: Math.round(camera.position.z * 100) / 100
                },
                fov: camera.fov,
                near: camera.near,
                far: camera.far
            } : null,
            gestureState: {
                currentGesture: gestureState.currentGesture || 'None',
                pinchActive: gestureState.pinchActive || false,
                lastGestureTime: gestureState.lastGestureTime || 0
            },
            featureFlags: {
                twoHand: featureFlags.twoHand || false,
                hologram: featureFlags.hologram || false,
                multiplayer: featureFlags.multiplayer || false
            }
        };
        
        const result = { 
            scene: dataURL, 
            video: videoDataURL, 
            context: contextData 
        };
        
        console.log('Screen capture result:', result);
        return result;
    } catch (error) {
        console.error('Screen capture error:', error);
        return null;
    }
}

// Gemini API integration
async function analyzeWithGemini(screenshots, userQuestion) {
    if (!GEMINI_CONFIG.apiKey) {
        return 'Please add your Gemini API key to use AI features.';
    }
    
    try {
        let prompt = `You are an AI assistant helping with a 3D modeling application called Gesture3D. 
        
        The user is asking: "${userQuestion}"`;
        
        if (screenshots) {
            // Add real-time context data to the prompt
            const context = screenshots.context;
            let contextInfo = '';
            
            if (context) {
                contextInfo = `
                
        **Real-Time Context Data (${context.timestamp}):**
        - Active Object: ${context.activeObject ? `${context.activeObject.type} at position (${context.activeObject.position.x}, ${context.activeObject.position.y}, ${context.activeObject.position.z})` : 'None'}
        - Object Rotation: ${context.activeObject && context.activeObject.rotation ? `X: ${context.activeObject.rotation.x}°, Y: ${context.activeObject.rotation.y}°, Z: ${context.activeObject.rotation.z}°` : 'None'}
        - Object Scale: ${context.activeObject && context.activeObject.scale ? `X: ${context.activeObject.scale.x}, Y: ${context.activeObject.scale.y}, Z: ${context.activeObject.scale.z}` : 'None'}
        - Camera Position: ${context.camera ? `(${context.camera.position.x}, ${context.camera.position.y}, ${context.camera.position.z})` : 'Unknown'}
        - Current Gesture: ${context.gestureState.currentGesture}
        - Features Active: ${Object.entries(context.featureFlags).filter(([k,v]) => v).map(([k]) => k).join(', ') || 'None'}`;
            }
            
            prompt += `
            
        I have captured real-time screenshots of the current screen and camera feed.${contextInfo}
        
        Please analyze the visual content AND the real-time data to provide a short answer as 3-5 concise bullet points covering:
        
        **Current Screen Analysis:**
        - What 3D objects are visible and their current state
        - Exact hand positions and gesture tracking status
        - Object transformation details (rotation angles, scale factors, position coordinates)
        - Camera view and perspective information
        - Any visible UI elements or controls
        
        **Real-Time Assessment:**
        - Immediate observations about what's working or not working
        - Specific technical details visible in the current moment
        - Precise measurements or positions if discernible
        - Current gesture recognition status
        
        **Actionable Guidance:**
        - What the user should do next based on current state
        - Immediate improvements or adjustments needed
        - Specific troubleshooting steps if issues are visible
        
        Use both the visual screenshots and the real-time context data. Be precise, factual, and focused on what is visible now. Output only 3-5 bullet points, one sentence each, no preamble or headings, and keep the total under 120 words.`;
        } else {
            prompt += `
            
        This appears to be a general question. Provide a short answer as 3-5 concise bullet points covering:
        - 3D modeling techniques and best practices
        - Gesture3D application features and capabilities
        - How to use hand tracking for 3D object manipulation
        - Troubleshooting common issues
        - Tips for effective 3D modeling workflow
        
        If the user needs help with something specific on their screen, suggest they ask a more specific question. Output only 3-5 bullet points, one sentence each, no preamble or headings, and keep the total under 120 words.`;
        }
        
        const requestBody = {
            contents: [{
                parts: [
                    { text: prompt }
                ]
            }]
        };
        
        // Add screenshots if available
        if (screenshots) {
            if (screenshots.scene) {
                requestBody.contents[0].parts.push({
                    inlineData: { 
                        mimeType: 'image/png', 
                        data: screenshots.scene.split(',')[1] 
                    }
                });
            }
            if (screenshots.video) {
                requestBody.contents[0].parts.push({
                    inlineData: { 
                        mimeType: 'image/png', 
                        data: screenshots.video.split(',')[1] 
                    }
                });
            }
        }
        
        console.log('Making Gemini API request to:', `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.model}:generateContent`);
        console.log('Request body:', requestBody);
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CONFIG.model}:generateContent?key=${GEMINI_CONFIG.apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('Gemini API response status:', response.status);
        console.log('Gemini API response headers:', response.headers);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API error response:', errorText);
            throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        console.log('Gemini API response data:', data);
        return data.candidates[0].content.parts[0].text;
        
    } catch (error) {
        console.error('Gemini API error:', error);
        return `Sorry, I encountered an error: ${error.message}. Please check your API key and try again.`;
    }
}

// Chat message handling
function addMessage(content, sender = 'user') {
    const chatMessages = document.getElementById('chat_messages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    messageDiv.innerHTML = `<div class="message-content">${content}</div>`;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Store in history
    aiState.chatHistory.push({ content, sender, timestamp: Date.now() });

    // If AI is speaking mode is on and this is an AI message, speak it
    if (sender === 'ai' && aiState.voiceOutput && 'speechSynthesis' in window) {
        try {
            const utter = new SpeechSynthesisUtterance(String(content).replace(/<[^>]+>/g, ''));
            utter.rate = 1.0; utter.pitch = 1.0; utter.volume = 1.0;
            speechSynthesis.cancel();
            speechSynthesis.speak(utter);
        } catch (e) {
            console.warn('TTS failed:', e);
        }
    }
}

async function handleUserInput(input) {
    if (!input.trim()) return;
    
    addMessage(input, 'user');
    
    // Check if the question is screen-related
    const screenKeywords = [
        'screen', 'what', 'see', 'show', 'display', 'current', 'now', 'this', 'that',
        'object', 'model', '3d', 'scene', 'gesture', 'hand', 'tracking', 'camera',
        'rotate', 'scale', 'move', 'position', 'size', 'color', 'shape', 'view',
        'help', 'how', 'why', 'problem', 'issue', 'error', 'working', 'not working'
    ];
    
    const isScreenRelated = screenKeywords.some(keyword => 
        input.toLowerCase().includes(keyword.toLowerCase())
    );
    
    // Show processing indicator
    addMessage('Analyzing your request...', 'ai');
    
    try {
        let screenshots = null;
        
        // Automatically capture screen for screen-related questions
        if (isScreenRelated) {
            // Update processing message to indicate screen capture
            const chatMessages = document.getElementById('chat_messages');
            if (chatMessages.lastChild) {
                chatMessages.lastChild.querySelector('.message-content').innerHTML = 
                    '📸 <em>Automatically capturing screen...</em>';
            }
            
            // Use enhanced real-time analysis
            const response = await performRealTimeAnalysis(input);
            
            // Remove processing message and add real response
            if (chatMessages.lastChild) {
                chatMessages.removeChild(chatMessages.lastChild);
            }
            addMessage(response, 'ai');
            // If the last input was spoken, stop listening after this answer
            if (aiState.isListening && (Date.now() - aiState.lastVoiceQuestionAt) < 5000) {
                stopVoiceRecognition();
            }
            return; // Exit early since we've already handled the response
        }
        
        // Get AI response for non-screen-related questions
        const response = await analyzeWithGemini(null, input);
        
        // Remove processing message and add real response
        const chatMessages = document.getElementById('chat_messages');
        if (chatMessages.lastChild) {
            chatMessages.removeChild(chatMessages.lastChild);
        }
        
        addMessage(response, 'ai');
        if (aiState.isListening && (Date.now() - aiState.lastVoiceQuestionAt) < 5000) {
            stopVoiceRecognition();
        }
        
    } catch (error) {
        console.error('AI processing error:', error);
        const chatMessages = document.getElementById('chat_messages');
        if (chatMessages.lastChild) {
            chatMessages.removeChild(chatMessages.lastChild);
        }
        addMessage('Sorry, I encountered an error processing your request. Please try again.', 'ai');
    }
}

function handleVoiceInput(transcript) {
    addMessage(transcript, 'user');
    aiState.lastVoiceQuestionAt = Date.now();
    handleUserInput(transcript);
}

// Toggle chat visibility
function toggleChat() {
    const aiContent = document.getElementById('ai_content');
    const chatBtn = document.getElementById('btn_chat_toggle');
    
    if (aiContent) {
        aiState.isChatOpen = !aiState.isChatOpen;
        aiContent.style.display = aiState.isChatOpen ? 'flex' : 'none';
        chatBtn.classList.toggle('active', aiState.isChatOpen);
    }
}

// Update AI status indicator
function updateAIStatus(status, message) {
    const statusElement = document.getElementById('ai_status');
    if (!statusElement) return;
    
    statusElement.className = `ai-status ${status}`;
    const statusText = statusElement.querySelector('.status-text');
    if (statusText) {
        statusText.textContent = message;
    }
}

// Loading indicator functions
function showLoadingIndicator() {
    const indicator = document.getElementById('loading_indicator');
    if (indicator) indicator.style.display = 'flex';
}

function hideLoadingIndicator() {
    const indicator = document.getElementById('loading_indicator');
    if (indicator) indicator.style.display = 'none';
}

// Enhanced screen analysis with real-time updates
async function performRealTimeAnalysis(userQuestion = null) {
    console.log('Starting real-time analysis with question:', userQuestion);
    updateAIStatus('analyzing', 'Analyzing screen in real-time...');
    
    try {
        console.log('Calling captureScreenForAI...');
        const screenshots = await captureScreenForAI();
        console.log('Screenshots captured:', screenshots);
        
        if (screenshots) {
            const question = userQuestion || 'Please describe the current state of the screen, including any 3D objects, gestures, or technical details visible.';
            console.log('Calling analyzeWithGemini with question:', question);
            const response = await analyzeWithGemini(screenshots, question);
            console.log('Gemini response received:', response);
            updateAIStatus('', 'Ready for real-time analysis');
            return response;
        } else {
            console.log('No screenshots captured');
            updateAIStatus('error', 'Failed to capture screen');
            return 'Sorry, I couldn\'t capture your screen. Please try again.';
        }
    } catch (error) {
        console.error('Real-time analysis error:', error);
        updateAIStatus('error', 'Analysis failed');
        return `Sorry, I encountered an error: ${error.message}`;
    }
}


