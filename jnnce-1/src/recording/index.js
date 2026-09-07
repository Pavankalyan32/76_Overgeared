// Recording Module
// Handles recording and replay of gesture sessions

// Module state
const recording = { 
    active: false, 
    startTime: 0, 
    frames: [] 
};
let replayTimer = null;
let suppressHands = false;

// External function references (set by main.js)
let getActiveObjectFn = null;
let getBaselineScaleFn = null;
let getTargetRotationFn = null;
let getTargetPositionFn = null;
let setBaselineScaleFn = null;
let setTargetRotationFn = null;
let setTargetPositionFn = null;
let setSuppressHandsFn = null;

// Initialize recording with dependencies
export function initRecording(dependencies) {
    getActiveObjectFn = dependencies.getActiveObject;
    getBaselineScaleFn = dependencies.getBaselineScale;
    getTargetRotationFn = dependencies.getTargetRotation;
    getTargetPositionFn = dependencies.getTargetPosition;
    setBaselineScaleFn = dependencies.setBaselineScale;
    setTargetRotationFn = dependencies.setTargetRotation;
    setTargetPositionFn = dependencies.setTargetPosition;
    setSuppressHandsFn = dependencies.setSuppressHands;
}

export function startRecording() {
    recording.active = true;
    recording.startTime = performance.now();
    recording.frames = [];
}

export function stopRecording() { 
    recording.active = false; 
}

export function pushFrame() {
    if (!recording.active) return;
    const activeObject = getActiveObjectFn ? getActiveObjectFn() : null;
    if (!activeObject) return;
    const t = performance.now() - recording.startTime;
    recording.frames.push({ 
        t, 
        s: getBaselineScaleFn ? getBaselineScaleFn() : 1.0, 
        rx: getTargetRotationFn ? getTargetRotationFn().x : 0, 
        ry: getTargetRotationFn ? getTargetRotationFn().y : 0, 
        px: getTargetPositionFn ? getTargetPositionFn().x : 0, 
        py: getTargetPositionFn ? getTargetPositionFn().y : 0 
    });
}

export function clearRecording() { 
    recording.frames = []; 
}

export function replayRecording() {
    if (replayTimer || recording.frames.length === 0) return;
    if (setSuppressHandsFn) setSuppressHandsFn(true);
    let i = 0;
    const start = performance.now();
    replayTimer = setInterval(() => {
        const elapsed = performance.now() - start;
        while (i < recording.frames.length && recording.frames[i].t <= elapsed) {
            const f = recording.frames[i++];
            if (setBaselineScaleFn) setBaselineScaleFn(f.s);
            if (setTargetRotationFn) setTargetRotationFn({ x: f.rx, y: f.ry });
            if (setTargetPositionFn) setTargetPositionFn({ x: f.px, y: f.py });
        }
        if (i >= recording.frames.length) {
            clearInterval(replayTimer); 
            replayTimer = null; 
            if (setSuppressHandsFn) setSuppressHandsFn(false);
        }
    }, 16);
}

export function getRecordingFrames() { return recording.frames.length; }
export function isRecording() { return recording.active; }
export function isReplaying() { return replayTimer !== null; }