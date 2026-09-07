// Main Bootstrap Module
// Entry point that initializes all modules and wires them together

import { 
    initThree, 
    animate, 
    bindMouseInput, 
    setSetGestureFn, 
    setUpdateTrackingStatusFn, 
    setEnsureInViewFn, 
    setRenderHologramFn, 
    setFitCameraToObjectFn,
    setLockCenter,
    setFeatureFlags as setSceneFeatureFlags,
    setBaselineScale as setSceneBaselineScale,
    setTargetRotation as setSceneTargetRotation,
    setTargetPosition as setSceneTargetPosition,
    setActiveObject,
    getActiveObject,
    getRenderer,
    getScene,
    getCamera,
    getOrbitControls,
    getBaselineScale,
    getTargetRotation,
    getTargetPosition,
    getLockCenter,
    fitCameraToObject,
    centerObject,
    resetCamera,
    orbitDistance,
    zoomToSurface,
    ensureInView,
} from './three/scene.js';

import { 
    initModels, 
    loadModel, 
    loadCustomFromURL, 
    loadCustomFromFile, 
    loadOBJFile, 
    centerAndScale, 
    clearAllModels, 
    resetModels,
    setCube,
} from './three/models.js';

import { 
    initGestureHandlers, 
    processHandResults, 
    resetGestureStates, 
    getGestureState,
    getCurrentGesture,
} from './gestures/handlers.js';

import { 
    initMediaPipe, 
    applyHandOptions, 
    renderHandLandmarks, 
    renderGestureFeedback, 
    renderHandTrackingInfo, 
    setUpdateTrackingStatusFn as setMediaPipeUpdateTrackingStatus,
    setProcessHandResultsFn,
    setApplyHandOptionsFn,
    setFeatureFlags as setMediaPipeFeatureFlags,
    setFrameSkip,
    setSuppressHands,
    getHands,
    getCameraFeed,
} from './gestures/mediapipe.js';

import { 
    initUI, 
    updateFeatureFlags as updateUIFeatureFlags,
    updateLockCenter as updateUILockCenter,
    updateOrbitControls,
    updateFrameSkip,
    getUI,
    getFeatureFlags as getUIFeatureFlags,
    getLockCenter as getUILockCenter,
    getFrameSkip as getUIFrameSkip,
} from './ui/sidebar.js';

import { 
    initAIChat, 
    handleUserInput, 
    startVoiceRecognition, 
    stopVoiceRecognition, 
    toggleChat, 
    updateAIStatus, 
    showLoadingIndicator, 
    hideLoadingIndicator, 
    performRealTimeAnalysis,
    getAIState,
    isListening,
} from './ui/ai-chat.js';

import { 
    initMultiplayer, 
    setMultiplayerEnabled, 
    maybeEmitState, 
    getSocket,
    isConnected,
} from './multiplayer/socket.js';

import { 
    initRecording, 
    startRecording, 
    stopRecording, 
    pushFrame, 
    clearRecording, 
    replayRecording, 
    getRecordingFrames, 
    isRecording, 
    isReplaying,
} from './recording/index.js';

import { initAR } from './ar/index.js';
import { initErrorHandling, setupThreeJSErrorBoundary } from './errors/client.js';

// Module state
let featureFlags = {
    twoHand: false,
    hologram: false,
    multiplayer: false,
    showLandmarks: true,
    gestureDebug: false,
};
let lockCenter = true;
let frameSkip = 0;
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
let baselineScale = 1.0;
let targetRotation = { x: 0, y: 0 };
let targetPosition = { x: 0, y: 0 };
let activeObject = null;
let orbitControls = null;
let renderer = null;
let camera = null;

// DOM elements
let ui = {};

// Initialize all modules
async function bootstrap() {
    // Initialize error handling first
    initErrorHandling();

    // Initialize Three.js scene
    const threeInit = initThree();
    renderer = threeInit.renderer;
    activeObject = threeInit.cube;
    
    // Set up Three.js error boundary
    setupThreeJSErrorBoundary(renderer);

    // Initialize models
    initModels({
        cube: threeInit.cube,
        activeObject,
        scene: threeInit.scene,
        ui,
        fitCameraToObject,
        showLoadingIndicator,
        hideLoadingIndicator,
        setActiveObject,
        getActiveObject,
        setBaselineScale,
        setTargetRotation,
        setTargetPosition,
        resetGestureStates,
    });

    // Initialize UI
    initUI({
        featureFlags,
        lockCenter,
        frameSkip,
        orbitControls: threeInit.orbitControls,
        setBaselineScale,
        loadModel,
        loadCustomFromURL,
        loadCustomFromFile,
        loadOBJFile,
        applyHandOptions,
        resetGestureStates,
        startRecording,
        stopRecording,
        replayRecording,
        clearRecording,
        resetModels,
        fitCameraToObject,
        zoomToSurface,
        orbitDistance,
        centerObject,
        resetCamera,
        setFeatureFlags: (flags) => { featureFlags = flags; },
        setLockCenter: (value) => { lockCenter = value; },
        setFrameSkip: (value) => { frameSkip = value; },
        getRecordingFrames,
        setMultiplayerStatus,
        showLoadingIndicator,
        hideLoadingIndicator,
        getActiveObject,
    });

    // Initialize AI Chat
    initAIChat({
        getRenderer,
        getActiveObject,
        getCamera,
        getGestureState,
        getFeatureFlags: () => featureFlags,
        updateAIStatus,
        addMessage: addChatMessage,
    });

    // Initialize Multiplayer
    initMultiplayer({
        featureFlags,
        setBaselineScale,
        getBaselineScale,
        setTargetRotation,
        setTargetPosition,
        getTargetRotation,
        getTargetPosition,
        setMultiplayerStatus,
        getFeatureFlags: () => featureFlags,
        setFeatureFlags: (flags) => { featureFlags = flags; },
    });

    // Initialize Recording
    initRecording({
        getActiveObject,
        getBaselineScale,
        getTargetRotation,
        getTargetPosition,
        setBaselineScale,
        setTargetRotation,
        setTargetPosition,
        setSuppressHands,
    });

    // Initialize AR
    initAR({
        renderer,
        setSuppressHands,
    });

    // Initialize MediaPipe
    setMediaPipeUpdateTrackingStatus(updateTrackingStatus);
    setProcessHandResultsFn(processHandResults);
    setApplyHandOptionsFn(applyHandOptions);
    setMediaPipeFeatureFlags(featureFlags);

    // Initialize Gesture Handlers
    initGestureHandlers({
        activeObject,
        camera: threeInit.camera,
        featureFlags,
        lockCenter,
        gestureState,
        setGesture,
        updateTrackingStatus,
        renderGestureFeedback,
        renderHandLandmarks,
        renderHandTrackingInfo,
        setBaselineScale,
        getBaselineScale,
        setTargetRotation,
        setTargetPosition,
        getTargetRotation,
        getTargetPosition,
        getActiveObject,
        getCamera,
        getLockCenter: () => lockCenter,
    });

    // Wire up Three.js scene with external functions
    setSetGestureFn(setGesture);
    setUpdateTrackingStatusFn(updateTrackingStatus);
    setEnsureInViewFn(ensureInView);
    setRenderHologramFn(renderHologram);
    setFitCameraToObjectFn(fitCameraToObject);

    // Bind mouse input
    bindMouseInput();

    // Start animation loop
    animate();

    // Load default model
    await loadModel('cube');

    // Start recording/replay interval
    setInterval(() => { pushFrame(); maybeEmitState(); }, 50);

    // Check AI availability
    reportAIAvailability();

    // Initialize hand tracking (optional)
    try {
        await initMediaPipe();
    } catch (err) {
        console.warn('Hand tracking unavailable:', err);
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        updateTrackingStatus('', denied ? 'Camera blocked - use mouse' : 'No camera - use mouse');
        showCameraHelp(denied);
    }
}

// Gesture state setters
function setGesture(name) {
    gestureState.current = name;
    const el = document.getElementById('gesture');
    if (el) el.textContent = name;
}

function updateTrackingStatus(status, text) {
    const dot = document.getElementById('tracking_dot');
    const textEl = document.getElementById('tracking_text');
    if (dot) dot.className = 'status-dot ' + status;
    if (textEl) textEl.textContent = text;
}

function renderHologram() {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const halfW = Math.floor(w / 2);
    const halfH = Math.floor(h / 2);
    renderer.setScissorTest(true);

    renderer.setViewport(halfW / 2, halfH, halfW, halfH);
    renderer.setScissor(halfW / 2, halfH, halfW, halfH);
    renderer.render(getScene(), getCamera());

    const rotY = getActiveObject()?.rotation.y ?? 0;
    if (getActiveObject()) getActiveObject().rotation.y = rotY + Math.PI / 2;
    renderer.setViewport(0, 0, halfW, halfH);
    renderer.setScissor(0, 0, halfW, halfH);
    renderer.render(getScene(), getCamera());
    if (getActiveObject()) getActiveObject().rotation.y = rotY;

    if (getActiveObject()) getActiveObject().rotation.y = rotY - Math.PI / 2;
    renderer.setViewport(halfW, 0, halfW, halfH);
    renderer.setScissor(halfW, 0, halfW, halfH);
    renderer.render(getScene(), getCamera());
    if (getActiveObject()) getActiveObject().rotation.y = rotY;

    const rotX = getActiveObject()?.rotation.x ?? 0;
    if (getActiveObject()) getActiveObject().rotation.x = rotX + Math.PI;
    renderer.setViewport(halfW / 2, 0, halfW, halfH);
    renderer.setScissor(halfW / 2, 0, halfW, halfH);
    renderer.render(getScene(), getCamera());
    if (getActiveObject()) getActiveObject().rotation.x = rotX;
}

// Chat message handler
function addChatMessage(content, sender = 'user', transient = false) {
    const chatMessages = document.getElementById('chat_messages');
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = String(content);
    messageDiv.appendChild(contentDiv);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    if (transient) return;

    const aiState = getAIState();
    aiState.chatHistory.push({ content, sender, timestamp: Date.now() });

    if (sender === 'ai' && aiState.voiceOutput && 'speechSynthesis' in window) {
        try {
            const utter = new SpeechSynthesisUtterance(String(content));
            utter.rate = 1.0; utter.pitch = 1.0; utter.volume = 1.0;
            speechSynthesis.cancel();
            speechSynthesis.speak(utter);
        } catch (e) {
            console.warn('TTS failed:', e);
        }
    }
}

// AI availability check
async function reportAIAvailability() {
    try {
        const res = await fetch('/api/ai/status');
        const { enabled } = await res.json();
        if (!enabled) {
            updateAIStatus('error', 'AI disabled - no API key on server');
        }
    } catch {
        updateAIStatus('error', 'AI unavailable - server not reachable');
    }
}

// Camera help fallback
function showCameraHelp(denied) {
    const feed = document.querySelector('.camera-feed');
    if (!feed || feed.querySelector('.camera-help')) return;
    const note = document.createElement('div');
    note.className = 'camera-help';
    note.textContent = denied
        ? 'Camera permission denied. Gesture control is off; drag to rotate, shift-drag to move, ctrl-drag or scroll to zoom.'
        : 'No camera available. Gesture control is off; drag to rotate, shift-drag to move, ctrl-drag or scroll to zoom.';
    feed.appendChild(note);
}

// Start bootstrap when DOM is ready
window.addEventListener('DOMContentLoaded', bootstrap);