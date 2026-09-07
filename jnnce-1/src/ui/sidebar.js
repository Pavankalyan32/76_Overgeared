// UI Sidebar Module
// Handles all UI bindings, sidebar controls, and view actions

// Module state
let ui = {};
let featureFlags = { showLandmarks: true, gestureDebug: false, twoHand: false, hologram: false, multiplayer: false };
let lockCenter = true;
let frameSkip = 0;
let orbitControls = null;

// External function references (set by main.js)
let setBaselineScaleFn = null;
let loadModelFn = null;
let loadCustomFromURLFn = null;
let loadCustomFromFileFn = null;
let loadOBJFileFn = null;
let applyHandOptionsFn = null;
let resetGestureStatesFn = null;
let startRecordingFn = null;
let stopRecordingFn = null;
let replayRecordingFn = null;
let clearRecordingFn = null;
let resetModelsFn = null;
let fitCameraToObjectFn = null;
let zoomToSurfaceFn = null;
let orbitDistanceFn = null;
let centerObjectFn = null;
let resetCameraFn = null;
let setFeatureFlagsFn = null;
let setLockCenterFn = null;
let setFrameSkipFn = null;
let getRecordingFramesFn = null;
let setMultiplayerStatusFn = null;

// Initialize UI bindings with dependencies
export function initUI(dependencies) {
    ui = {
        twoHand: document.getElementById('toggle_twohand'),
        hologram: document.getElementById('toggle_hologram'),
        multiplayer: document.getElementById('toggle_multiplayer'),
        frameSkip: document.getElementById('frame_skip'),
        frameSkipValue: document.getElementById('frame_skip_value'),
        modelSelect: document.getElementById('model_select'),
        scaleSlider: document.getElementById('scale_slider'),
        scaleNumber: document.getElementById('scale_number'),
        scaleValue: document.getElementById('scale_value'),
        fileInput: document.getElementById('file_input'),
        urlInput: document.getElementById('url_input'),
        btnLoadURL: document.getElementById('btn_load_url'),
        btnRecord: document.getElementById('btn_record'),
        btnStop: document.getElementById('btn_stop'),
        btnReplay: document.getElementById('btn_replay'),
        btnClear: document.getElementById('btn_clear'),
        btnResetModels: document.getElementById('btn_reset_models'),
        btnExtend: document.getElementById('btn_extend'),
        btnCollapse: document.getElementById('btn_collapse'),
        btnVoiceToggle: document.getElementById('btn_voice_toggle'),
        btnScreenRead: document.getElementById('btn_screen_read'),
        btnRefreshScreen: document.getElementById('btn_refresh_screen'),
        btnChatToggle: document.getElementById('btn_chat_toggle'),
        chatInput: document.getElementById('chat_input'),
        btnSend: document.getElementById('btn_send'),
        toggleTracking: document.getElementById('toggle_tracking'),
        toggleGestureDebug: document.getElementById('toggle_gesture_debug'),
        lockCenter: document.getElementById('toggle_lock_center'),
    };
    
    featureFlags = dependencies.featureFlags;
    lockCenter = dependencies.lockCenter;
    frameSkip = dependencies.frameSkip;
    orbitControls = dependencies.orbitControls;
    
    setBaselineScaleFn = dependencies.setBaselineScale;
    loadModelFn = dependencies.loadModel;
    loadCustomFromURLFn = dependencies.loadCustomFromURL;
    loadCustomFromFileFn = dependencies.loadCustomFromFile;
    loadOBJFileFn = dependencies.loadOBJFile;
    applyHandOptionsFn = dependencies.applyHandOptions;
    resetGestureStatesFn = dependencies.resetGestureStates;
    startRecordingFn = dependencies.startRecording;
    stopRecordingFn = dependencies.stopRecording;
    replayRecordingFn = dependencies.replayRecording;
    clearRecordingFn = dependencies.clearRecording;
    resetModelsFn = dependencies.resetModels;
    fitCameraToObjectFn = dependencies.fitCameraToObject;
    zoomToSurfaceFn = dependencies.zoomToSurface;
    orbitDistanceFn = dependencies.orbitDistance;
    centerObjectFn = dependencies.centerObject;
    resetCameraFn = dependencies.resetCamera;
    setFeatureFlagsFn = dependencies.setFeatureFlags;
    setLockCenterFn = dependencies.setLockCenter;
    setFrameSkipFn = dependencies.setFrameSkip;
    getRecordingFramesFn = dependencies.getRecordingFrames;
    setMultiplayerStatusFn = dependencies.setMultiplayerStatus;
    
    bindUI();
}

// Update module state from external changes
export function updateFeatureFlags(flags) { featureFlags = flags; }
export function updateLockCenter(value) { lockCenter = value; }
export function updateOrbitControls(controls) { orbitControls = controls; }
export function updateFrameSkip(value) { frameSkip = value; }

// Keyboard shortcuts handler
function handleKeyboardShortcuts(e) {
    // Ignore if typing in an input field
    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable);
    if (isInput && e.key !== 'Escape') return;
    
    // Don't trigger if modifier keys are held (except for specific shortcuts)
    const hasCtrl = e.ctrlKey || e.metaKey;
    const hasShift = e.shiftKey;
    const hasAlt = e.altKey;
    
    switch (e.key) {
        // Recording shortcuts
        case 'r':
        case 'R':
            if (!hasCtrl && !hasAlt) {
                e.preventDefault();
                if (startRecordingFn) startRecordingFn();
                if (ui.btnRecord) ui.btnRecord.disabled = true;
                if (ui.btnStop) ui.btnStop.disabled = false;
                if (ui.btnReplay) ui.btnReplay.disabled = true;
                if (ui.btnClear) ui.btnClear.disabled = true;
            }
            break;
        case 'p':
        case 'P':
            if (!hasCtrl && !hasAlt) {
                e.preventDefault();
                if (stopRecordingFn) stopRecordingFn();
                if (ui.btnRecord) ui.btnRecord.disabled = false;
                if (ui.btnStop) ui.btnStop.disabled = true;
                const frames = getRecordingFramesFn ? getRecordingFramesFn() : 0;
                if (ui.btnReplay) ui.btnReplay.disabled = frames === 0;
                if (ui.btnClear) ui.btnClear.disabled = frames === 0;
            }
            break;
        case 'c':
        case 'C':
            if (!hasCtrl && !hasAlt) {
                e.preventDefault();
                if (clearRecordingFn) clearRecordingFn();
                if (ui.btnReplay) ui.btnReplay.disabled = true;
                if (ui.btnClear) ui.btnClear.disabled = true;
            }
            break;
            
        // View shortcuts
        case 'f':
        case 'F':
            if (!hasCtrl && !hasAlt) {
                e.preventDefault();
                const activeObj = dependencies.getActiveObject ? dependencies.getActiveObject() : null;
                if (activeObj && fitCameraToObjectFn) fitCameraToObjectFn(activeObj, 1.8);
            }
            break;
            
        // Rotation shortcuts (arrow keys)
        case 'ArrowLeft':
            if (!hasCtrl && !hasAlt) {
                e.preventDefault();
                const targetRotation = dependencies.getTargetRotation ? dependencies.getTargetRotation() : { x: 0, y: 0 };
                targetRotation.y += Math.PI * 0.05;
                if (dependencies.setTargetRotation) dependencies.setTargetRotation(targetRotation);
            }
            break;
        case 'ArrowRight':
            if (!hasCtrl && !hasAlt) {
                e.preventDefault();
                const targetRotation = dependencies.getTargetRotation ? dependencies.getTargetRotation() : { x: 0, y: 0 };
                targetRotation.y -= Math.PI * 0.05;
                if (dependencies.setTargetRotation) dependencies.setTargetRotation(targetRotation);
            }
            break;
        case 'ArrowUp':
            if (!hasCtrl && !hasAlt) {
                e.preventDefault();
                if (orbitDistanceFn) orbitDistanceFn(0.9);
            }
            break;
        case 'ArrowDown':
            if (!hasCtrl && !hasAlt) {
                e.preventDefault();
                if (orbitDistanceFn) orbitDistanceFn(1.1);
            }
            break;
            
        // Gesture debug toggle
        case ' ':
            if (!hasCtrl && !hasAlt && !hasShift) {
                e.preventDefault();
                if (ui.toggleGestureDebug) {
                    ui.toggleGestureDebug.checked = !ui.toggleGestureDebug.checked;
                    featureFlags.gestureDebug = ui.toggleGestureDebug.checked;
                    if (setFeatureFlagsFn) setFeatureFlagsFn(featureFlags);
                }
            }
            break;
            
        // Escape - close dropdowns, stop recording, etc.
        case 'Escape':
            // Close any open dropdowns
            document.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open'));
            // Blur active element
            if (activeEl && activeEl.blur) activeEl.blur();
            break;
    }
}

// Bind all UI event listeners
function bindUI() {
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Feature toggles
    ui.twoHand.addEventListener('change', (e) => {
        featureFlags.twoHand = e.target.checked;
        if (applyHandOptionsFn) applyHandOptionsFn();
        if (resetGestureStatesFn) resetGestureStatesFn();
    });
    ui.hologram.addEventListener('change', (e) => { featureFlags.hologram = e.target.checked; if (setFeatureFlagsFn) setFeatureFlagsFn(featureFlags); });
    ui.multiplayer.addEventListener('change', (e) => {
        featureFlags.multiplayer = e.target.checked;
        if (setFeatureFlagsFn) setFeatureFlagsFn(featureFlags);
        // Socket connection handled in multiplayer module
        if (!featureFlags.multiplayer && setMultiplayerStatusFn) setMultiplayerStatusFn('Not connected');
    });

    // Copy room link
    const btnCopyRoom = document.getElementById('btn_copy_room');
    if (btnCopyRoom) {
        btnCopyRoom.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(location.href);
                btnCopyRoom.textContent = 'Copied';
            } catch {
                document.getElementById('room_id')?.select();
                btnCopyRoom.textContent = 'Press Ctrl+C';
            }
            setTimeout(() => { btnCopyRoom.textContent = 'Copy link'; }, 1500);
        });
    }

    // Lock center
    ui.lockCenter.addEventListener('change', (e) => { 
        lockCenter = !!e.target.checked; 
        if (setLockCenterFn) setLockCenterFn(lockCenter);
        if (orbitControls) orbitControls.enablePan = !lockCenter;
    });

    // Frame skip
    ui.frameSkip.addEventListener('input', (e) => { 
        frameSkip = Number(e.target.value); 
        if (ui.frameSkipValue) ui.frameSkipValue.textContent = String(frameSkip);
        if (setFrameSkipFn) setFrameSkipFn(frameSkip);
    });

    // Model selection
    ui.modelSelect.addEventListener('change', async (e) => { 
        if (loadModelFn) await loadModelFn(e.target.value); 
    });

    // Sidebar collapse/extend
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

    // Camera/tracking toggles
    ui.toggleTracking.addEventListener('change', (e) => { featureFlags.showLandmarks = e.target.checked; if (setFeatureFlagsFn) setFeatureFlagsFn(featureFlags); });
    ui.toggleGestureDebug.addEventListener('change', (e) => { featureFlags.gestureDebug = e.target.checked; if (setFeatureFlagsFn) setFeatureFlagsFn(featureFlags); });

    // Scale controls
    ui.scaleSlider.addEventListener('input', (e) => { if (setBaselineScaleFn) setBaselineScaleFn(Number(e.target.value)); });
    ui.scaleNumber.addEventListener('input', (e) => { if (setBaselineScaleFn) setBaselineScaleFn(Number(e.target.value)); });

    // File upload
    ui.fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        
        try {
            if (dependencies.showLoadingIndicator) dependencies.showLoadingIndicator();
            
            const objFiles = files.filter(f => f.name.toLowerCase().endsWith('.obj'));
            const mtlFiles = files.filter(f => f.name.toLowerCase().endsWith('.mtl'));
            const otherFiles = files.filter(f => {
                const ext = f.name.toLowerCase();
                return ['.glb', '.gltf', '.stl'].some(format => ext.endsWith(format));
            });
            
            if (objFiles.length > 0) {
                const objFile = objFiles[0];
                const mtlFile = mtlFiles.find(mtl => 
                    mtl.name.toLowerCase().replace('.mtl', '') === 
                    objFile.name.toLowerCase().replace('.obj', '')
                );
                if (loadOBJFileFn) await loadOBJFileFn(objFile, mtlFile);
            } else if (otherFiles.length > 0) {
                if (loadCustomFromFileFn) await loadCustomFromFileFn(otherFiles[0]);
            } else {
                alert('Please select a supported 3D file format (.glb, .gltf, .obj, .stl)');
                return;
            }
        } catch (error) {
            console.error('File loading error:', error);
            alert(`Failed to load file: ${error.message}`);
        } finally {
            if (dependencies.hideLoadingIndicator) dependencies.hideLoadingIndicator();
            e.target.value = '';
        }
    });

    // URL loading
    ui.btnLoadURL.addEventListener('click', async () => {
        const u = (ui.urlInput.value || '').trim();
        if (u && loadCustomFromURLFn) await loadCustomFromURLFn(u);
    });
    ui.urlInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const u = (ui.urlInput.value || '').trim();
            if (u && loadCustomFromURLFn) await loadCustomFromURLFn(u);
        }
    });

    // Recording controls
    ui.btnRecord.addEventListener('click', () => { 
        if (startRecordingFn) startRecordingFn(); 
        ui.btnRecord.disabled = true; 
        ui.btnStop.disabled = false; 
        ui.btnReplay.disabled = true; 
        ui.btnClear.disabled = true; 
    });
    ui.btnStop.addEventListener('click', () => { 
        if (stopRecordingFn) stopRecordingFn(); 
        ui.btnRecord.disabled = false; 
        ui.btnStop.disabled = true; 
        const frames = getRecordingFramesFn ? getRecordingFramesFn() : 0;
        ui.btnReplay.disabled = frames === 0; 
        ui.btnClear.disabled = frames === 0; 
    });
    ui.btnReplay.addEventListener('click', () => { if (replayRecordingFn) replayRecordingFn(); });
    ui.btnClear.addEventListener('click', () => { 
        if (clearRecordingFn) clearRecordingFn(); 
        ui.btnReplay.disabled = true; 
        ui.btnClear.disabled = true; 
    });
    ui.btnResetModels.addEventListener('click', () => { if (resetModelsFn) resetModelsFn(); });

    // View actions (navbar + sidebar)
    const viewActions = {
        fit: () => { 
            const activeObj = dependencies.getActiveObject ? dependencies.getActiveObject() : null;
            if (activeObj && fitCameraToObjectFn) fitCameraToObjectFn(activeObj, 1.8); 
        },
        surface: () => { 
            const activeObj = dependencies.getActiveObject ? dependencies.getActiveObject() : null;
            if (activeObj && zoomToSurfaceFn) zoomToSurfaceFn(); 
        },
        zoom_in: () => { if (orbitDistanceFn) orbitDistanceFn(0.5); },
        zoom_out: () => { if (orbitDistanceFn) orbitDistanceFn(1.5); },
        center: () => { if (centerObjectFn) centerObjectFn(); },
        reset_camera: () => { if (resetCameraFn) resetCameraFn(); },
    };
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const action = viewActions[btn.dataset.act];
        if (action) action();
    });
}

// Get UI elements for external access
export function getUI() { return ui; }
export function getFeatureFlags() { return featureFlags; }
export function getLockCenter() { return lockCenter; }
export function getFrameSkip() { return frameSkip; }