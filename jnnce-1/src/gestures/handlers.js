// Gesture Handlers Module
// Handles all gesture processing: fist zoom, two-finger zoom, 1/2/3-finger pan, pinch, palm, rotate, two-hand

import * as THREE from 'three';
import {
    distance as calculateDistance,
    handSpan,
    pinchRatio,
    isFist,
    isOneFinger,
    isTwoFingers,
    isThreeFingers,
    describeHand,
} from '../../gestures.js';

// Module state
let activeObject = null;
let camera = null;
let featureFlags = { showLandmarks: true, gestureDebug: false };
let lockCenter = true;
let gestureState = {
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

// Gesture configuration constants
const FIST_ZOOM = { speed: 0.015, maxZoom: 0.1, minDistance: 0.01 };
const TWO_FINGER_ZOOM = { speed: 0.015, maxDistance: 15.0, minDistance: 0.01 };
const ONE_FINGER_PAN = { sensitivity: 0.8, maxPanDistance: 3.0, smoothing: 0.1 };
const THREE_FINGER_PAN = { sensitivity: 1.2, maxPanDistance: 3.0, smoothing: 0.1 };
const PINCH = {
    start: 0.045, end: 0.060, emaAlpha: 0.3,
    minChangeRatio: 0.01, ratioClampMin: 0.85, ratioClampMax: 1.18,
};

// External function references (set by main.js)
let setGestureFn = null;
let updateTrackingStatusFn = null;
let renderGestureFeedbackFn = null;
let renderHandLandmarksFn = null;
let renderHandTrackingInfoFn = null;
let setBaselineScaleFn = null;
let getBaselineScaleFn = null;
let setTargetRotationFn = null;
let setTargetPositionFn = null;
let getTargetRotationFn = null;
let getTargetPositionFn = null;
let getActiveObjectFn = null;
let getCameraFn = null;
let getLockCenterFn = null;

// Initialize gesture handlers with dependencies
export function initGestureHandlers(dependencies) {
    activeObject = dependencies.activeObject;
    camera = dependencies.camera;
    featureFlags = dependencies.featureFlags;
    lockCenter = dependencies.lockCenter;
    gestureState = dependencies.gestureState;
    
    setGestureFn = dependencies.setGesture;
    updateTrackingStatusFn = dependencies.updateTrackingStatus;
    renderGestureFeedbackFn = dependencies.renderGestureFeedback;
    renderHandLandmarksFn = dependencies.renderHandLandmarks;
    renderHandTrackingInfoFn = dependencies.renderHandTrackingInfo;
    setBaselineScaleFn = dependencies.setBaselineScale;
    getBaselineScaleFn = dependencies.getBaselineScale;
    setTargetRotationFn = dependencies.setTargetRotation;
    setTargetPositionFn = dependencies.setTargetPosition;
    getTargetRotationFn = dependencies.getTargetRotation;
    getTargetPositionFn = dependencies.getTargetPosition;
    getActiveObjectFn = dependencies.getActiveObject;
    getCameraFn = dependencies.getCamera;
    getLockCenterFn = dependencies.getLockCenter;
}

// Update module state from external changes
export function updateActiveObject(obj) { activeObject = obj; }
export function updateCamera(cam) { camera = cam; }
export function updateFeatureFlags(flags) { featureFlags = flags; }
export function updateLockCenter(value) { lockCenter = value; }
export function updateGestureState(state) { gestureState = state; }

// Main gesture processing entry point
export function processHandResults(results) {
    const overlay = document.getElementById('overlay');
    const video = document.getElementById('input_video');
    
    if (overlay.width !== overlay.clientWidth || overlay.height !== overlay.clientHeight) {
        overlay.width = overlay.clientWidth;
        overlay.height = overlay.clientHeight;
    }
    
    const overlayCtx = overlay.getContext('2d');
    overlayCtx.save();
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    overlayCtx.restore();

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        if (setGestureFn) setGestureFn('None');
        resetGestureStates();
        if (updateTrackingStatusFn) updateTrackingStatusFn('processing', 'No hands detected');
        return;
    }

    const handsLms = results.multiHandLandmarks;
    if (updateTrackingStatusFn) updateTrackingStatusFn('tracking', `${handsLms.length} hand${handsLms.length > 1 ? 's' : ''} detected`);

    if (handsLms.length === 1) {
        const landmarks = handsLms[0];
        if (featureFlags.showLandmarks && renderHandLandmarksFn) {
            renderHandLandmarksFn(landmarks);
        }
        
        if (featureFlags.gestureDebug) {
            if (renderHandTrackingInfoFn) renderHandTrackingInfoFn(landmarks);
            console.log('hand:', describeHand(landmarks, false));
        }

        // Call all handlers - each owns its own release branch
        handleFistZoom(landmarks);
        handleTwoFingerZoom(landmarks);
        handleOneFingerPan(landmarks);
        handleThreeFingerPan(landmarks);

        // Latched gestures take precedence
        if (gestureState.fistActive || gestureState.twoFingersActive || gestureState.oneFingerActive || gestureState.threeFingerActive) {
            return;
        }

        // Pinch / palm / rotate logic
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];

        const span = handSpan(landmarks);
        const pinchNorm = pinchRatio(landmarks);

        // Hysteresis around thresholds
        if (!gestureState.pinchActive && pinchNorm < PINCH.start) gestureState.pinchActive = true;
        if (gestureState.pinchActive && pinchNorm > PINCH.end) gestureState.pinchActive = false;
        const isPinching = gestureState.pinchActive;
        
        const indexMiddleSpread = calculateDistance(indexTip, middleTip) / span;
        const isOpenPalm = !isPinching && pinchNorm > (PINCH.end + 0.01) && indexMiddleSpread > 0.5;

        if (isPinching) {
            if (setGestureFn) setGestureFn('Pinch → Scale');
            if (renderGestureFeedbackFn) renderGestureFeedbackFn(landmarks, 'pinch');
            
            const last = gestureState.emaPinchNorm ?? pinchNorm;
            const ema = last * (1 - PINCH.emaAlpha) + pinchNorm * PINCH.emaAlpha;
            gestureState.emaPinchNorm = ema;
            
            if (gestureState.lastPinchNorm != null && gestureState.lastPinchNorm > 0) {
                let ratio = ema / gestureState.lastPinchNorm;
                const delta = Math.abs(ratio - 1);
                if (delta > PINCH.minChangeRatio) {
                    ratio = THREE.MathUtils.clamp(ratio, PINCH.ratioClampMin, PINCH.ratioClampMax);
                    const baselineScale = getBaselineScaleFn ? getBaselineScaleFn() : 1.0;
                    const newBase = THREE.MathUtils.clamp(baselineScale * ratio, 0.05, 10);
                    if (setBaselineScaleFn) setBaselineScaleFn(newBase);
                }
            }
            gestureState.lastPinchNorm = ema;
            gestureState.lastPinchDist = calculateDistance(thumbTip, indexTip);
        } else if (isOpenPalm) {
            if (setGestureFn) setGestureFn('Open palm → Translate');
            const nx = (indexTip.x - 0.5) * 2;
            const ny = (0.5 - indexTip.y) * 2;
            if (setTargetPositionFn) setTargetPositionFn({ x: nx * 1.2, y: ny * 0.9 });
            gestureState.lastPinchDist = null;
            gestureState.lastPinchNorm = null;
            gestureState.emaPinchNorm = null;
        } else {
            if (setGestureFn) setGestureFn('Index move → Rotate');
            const idx = { x: indexTip.x, y: indexTip.y };
            if (gestureState.lastIndexPos) {
                const dx = idx.x - gestureState.lastIndexPos.x;
                const dy = idx.y - gestureState.lastIndexPos.y;
                const targetRotation = getTargetRotationFn ? getTargetRotationFn() : { x: 0, y: 0 };
                targetRotation.y += -dx * Math.PI * 1.8;
                targetRotation.x += -dy * Math.PI * 1.8;
                if (setTargetRotationFn) setTargetRotationFn(targetRotation);
            }
            gestureState.lastIndexPos = idx;
            gestureState.lastPinchDist = null;
            gestureState.lastPinchNorm = null;
            gestureState.emaPinchNorm = null;
        }
    } else if (handsLms.length >= 2 && featureFlags.twoHand) {
        const a = handsLms[0];
        const b = handsLms[1];
        if (featureFlags.showLandmarks && renderHandLandmarksFn) {
            renderHandLandmarksFn(a);
            renderHandLandmarksFn(b);
        }
        const aIndex = a[8];
        const bIndex = b[8];
        const dist = calculateDistance(aIndex, bIndex);
        const midx = (aIndex.x + bIndex.x) / 2;
        const midy = (aIndex.y + bIndex.y) / 2;
        if (setGestureFn) setGestureFn('Two hands → Scale + Translate');
        if (setBaselineScaleFn) setBaselineScaleFn(THREE.MathUtils.clamp(0.2 + dist * 6.0, 0.1, 8.0));
        if (setTargetPositionFn) setTargetPositionFn({ x: (midx - 0.5) * 2 * 1.1, y: (0.5 - midy) * 2 * 0.9 });
    }
    
    updateFPS();
}

function updateFPS() {
    // FPS counter handled in scene module
}

// Fist zoom handler
function handleFistZoom(landmarks) {
    if (isFist(landmarks, gestureState.fistActive)) {
        if (!gestureState.fistActive) {
            gestureState.fistActive = true;
            gestureState.lastFistTime = performance.now();
            if (setGestureFn) setGestureFn('Fist → Zooming in');
        }
        
        if (renderGestureFeedbackFn) renderGestureFeedbackFn(landmarks, 'fist');
        
        const cam = getCameraFn ? getCameraFn() : camera;
        const obj = getActiveObjectFn ? getActiveObjectFn() : activeObject;
        if (obj && cam) {
            const box = new THREE.Box3().setFromObject(obj);
            const center = new THREE.Vector3();
            box.getCenter(center);
            
            const dir = new THREE.Vector3().subVectors(cam.position, center);
            const currentDistance = dir.length();
            const newDistance = Math.max(FIST_ZOOM.minDistance, currentDistance - FIST_ZOOM.speed);
            
            if (newDistance < currentDistance) {
                dir.setLength(newDistance);
                cam.position.copy(center.clone().add(dir));
                cam.lookAt(center);
            }
        }
    } else if (gestureState.fistActive) {
        gestureState.fistActive = false;
        if (setGestureFn) setGestureFn('Fist released');
    }
}

// Two-finger zoom out handler
function handleTwoFingerZoom(landmarks) {
    if (isTwoFingers(landmarks, gestureState.twoFingersActive)) {
        if (!gestureState.twoFingersActive) {
            gestureState.twoFingersActive = true;
            gestureState.lastTwoFingersTime = performance.now();
            if (setGestureFn) setGestureFn('Two fingers → Zooming out');
        }
        
        if (renderGestureFeedbackFn) renderGestureFeedbackFn(landmarks, 'twoFingers');
        
        const cam = getCameraFn ? getCameraFn() : camera;
        const obj = getActiveObjectFn ? getActiveObjectFn() : activeObject;
        if (cam) {
            let center;
            if (obj) {
                const box = new THREE.Box3().setFromObject(obj);
                center = new THREE.Vector3();
                box.getCenter(center);
            } else {
                center = new THREE.Vector3(0, 0, 0);
            }
            
            const dir = new THREE.Vector3().subVectors(cam.position, center);
            const currentDistance = dir.length();
            const newDistance = Math.min(TWO_FINGER_ZOOM.maxDistance, currentDistance + TWO_FINGER_ZOOM.speed);
            
            if (newDistance > currentDistance) {
                dir.setLength(newDistance);
                cam.position.copy(center.clone().add(dir));
                cam.lookAt(center);
            }
        }
    } else if (gestureState.twoFingersActive) {
        gestureState.twoFingersActive = false;
        if (setGestureFn) setGestureFn('Two fingers released');
    }
}

// Three-finger pan handler
function handleThreeFingerPan(landmarks) {
    if (isThreeFingers(landmarks, gestureState.threeFingerActive)) {
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
            if (setGestureFn) setGestureFn('Three fingers → Panning model');
        }
        
        if (renderGestureFeedbackFn) renderGestureFeedbackFn(landmarks, 'threeFingers');
        
        const obj = getActiveObjectFn ? getActiveObjectFn() : activeObject;
        const cam = getCameraFn ? getCameraFn() : camera;
        if (obj && gestureState.lastThreeFingerPos) {
            const deltaX = (currentPos.x - gestureState.lastThreeFingerPos.x) * THREE_FINGER_PAN.sensitivity;
            const deltaY = (currentPos.y - gestureState.lastThreeFingerPos.y) * THREE_FINGER_PAN.sensitivity;
            
            const cameraRight = new THREE.Vector3();
            cam.getWorldDirection(cameraRight);
            cameraRight.cross(cam.up).normalize();
            
            const cameraUp = new THREE.Vector3(0, 1, 0);
            
            const moveRight = cameraRight.clone().multiplyScalar(-deltaX * 2.5);
            const moveUp = cameraUp.clone().multiplyScalar(deltaY * 2.5);
            
            const newPosition = obj.position.clone().add(moveRight).add(moveUp);
            const distance = newPosition.length();
            if (distance > THREE_FINGER_PAN.maxPanDistance) {
                newPosition.setLength(THREE_FINGER_PAN.maxPanDistance);
            }
            
            if (setTargetPositionFn) setTargetPositionFn({ x: newPosition.x, y: newPosition.y });
            gestureState.lastThreeFingerPos = currentPos;
        }
    } else if (gestureState.threeFingerActive) {
        gestureState.threeFingerActive = false;
        if (setGestureFn) setGestureFn('Three fingers released');
    }
}

// One-finger pan handler
function handleOneFingerPan(landmarks) {
    if (isOneFinger(landmarks, gestureState.oneFingerActive)) {
        const indexTip = landmarks[8];
        const currentPos = { x: indexTip.x, y: indexTip.y };
        
        if (!gestureState.oneFingerActive) {
            gestureState.oneFingerActive = true;
            gestureState.lastOneFingerTime = performance.now();
            gestureState.lastOneFingerPos = currentPos;
            const lock = getLockCenterFn ? getLockCenterFn() : lockCenter;
            if (setGestureFn) setGestureFn(lock ? 'One finger → Panning model' : 'One finger → Panning viewport');
        }
        
        if (renderGestureFeedbackFn) renderGestureFeedbackFn(landmarks, 'oneFinger');
        
        const lock = getLockCenterFn ? getLockCenterFn() : lockCenter;
        const obj = getActiveObjectFn ? getActiveObjectFn() : activeObject;
        const cam = getCameraFn ? getCameraFn() : camera;
        
        if (gestureState.lastOneFingerPos) {
            if (lock) {
                if (obj) {
                    const deltaX = (currentPos.x - gestureState.lastOneFingerPos.x) * ONE_FINGER_PAN.sensitivity;
                    const deltaY = (currentPos.y - gestureState.lastOneFingerPos.y) * ONE_FINGER_PAN.sensitivity;
                    
                    const cameraRight = new THREE.Vector3();
                    cam.getWorldDirection(cameraRight);
                    cameraRight.cross(cam.up).normalize();
                    
                    const cameraUp = new THREE.Vector3(0, 1, 0);
                    
                    const moveRight = cameraRight.clone().multiplyScalar(-deltaX * 2.5);
                    const moveUp = cameraUp.clone().multiplyScalar(deltaY * 2.5);
                    
                    const newPosition = obj.position.clone().add(moveRight).add(moveUp);
                    if (setTargetPositionFn) setTargetPositionFn({ x: newPosition.x, y: newPosition.y });
                }
            } else {
                if (cam) {
                    let center;
                    if (obj) {
                        const box = new THREE.Box3().setFromObject(obj);
                        center = new THREE.Vector3();
                        box.getCenter(center);
                    } else {
                        center = new THREE.Vector3(0, 0, 0);
                    }
                    
                    const deltaX = (currentPos.x - gestureState.lastOneFingerPos.x) * ONE_FINGER_PAN.sensitivity;
                    const deltaY = (currentPos.y - gestureState.lastOneFingerPos.y) * ONE_FINGER_PAN.sensitivity;
                    
                    const cameraRight = new THREE.Vector3();
                    cam.getWorldDirection(cameraRight);
                    cameraRight.cross(cam.up).normalize();
                    
                    const cameraUp = new THREE.Vector3(0, 1, 0);
                    
                    const panRight = cameraRight.clone().multiplyScalar(deltaX * 3);
                    const panUp = cameraUp.clone().multiplyScalar(-deltaY * 3);
                    
                    const newPosition = cam.position.clone().add(panRight).add(panUp);
                    cam.position.lerp(newPosition, ONE_FINGER_PAN.smoothing);
                    cam.lookAt(center);
                }
            }
            
            gestureState.lastOneFingerPos = currentPos;
        }
    } else if (gestureState.oneFingerActive) {
        gestureState.oneFingerActive = false;
        if (setGestureFn) setGestureFn('One finger released');
    }
}

// Reset all gesture states
export function resetGestureStates() {
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

// Get current gesture state for external access
export function getGestureState() { return gestureState; }
export function getCurrentGesture() { return gestureState.current; }