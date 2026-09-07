// Multiplayer Module
// Handles Socket.IO connection, room management, and state synchronization

// Module state
let socket = null;
let lastEmit = 0;
let applyingRemoteState = false;
let featureFlags = { multiplayer: false };

// External function references (set by main.js)
let setBaselineScaleFn = null;
let getBaselineScaleFn = null;
let setTargetRotationFn = null;
let setTargetPositionFn = null;
let getTargetRotationFn = null;
let getTargetPositionFn = null;
let setMultiplayerStatusFn = null;
let getFeatureFlagsFn = null;
let setFeatureFlagsFn = null;

// Initialize multiplayer with dependencies
export function initMultiplayer(dependencies) {
    featureFlags = dependencies.featureFlags;
    
    setBaselineScaleFn = dependencies.setBaselineScale;
    getBaselineScaleFn = dependencies.getBaselineScale;
    setTargetRotationFn = dependencies.setTargetRotation;
    setTargetPositionFn = dependencies.setTargetPosition;
    getTargetRotationFn = dependencies.getTargetRotation;
    getTargetPositionFn = dependencies.getTargetPosition;
    setMultiplayerStatusFn = dependencies.setMultiplayerStatus;
    getFeatureFlagsFn = dependencies.getFeatureFlags;
    setFeatureFlagsFn = dependencies.setFeatureFlags;
    
    if (featureFlags.multiplayer) {
        initSocket();
    }
}

// Get current room from URL fragment
function currentRoom() {
    const fromHash = location.hash.replace(/^#/, '').trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(fromHash)) return fromHash;
    const generated = Math.random().toString(36).slice(2, 10);
    location.hash = generated;
    return generated;
}

// Initialize Socket.IO connection
function initSocket() {
    if (!window.io) {
        console.warn('Socket.IO client not loaded; multiplayer disabled.');
        const toggle = document.getElementById('toggle_multiplayer');
        if (toggle) { toggle.disabled = true; toggle.title = 'Socket.IO unavailable'; }
        return;
    }

    const room = currentRoom();
    const roomLabel = document.getElementById('room_id');
    if (roomLabel) roomLabel.value = room;

    socket = window.io({ autoConnect: false, auth: { room } });

    socket.on('connect', () => console.log(`Connected to multiplayer room "${room}"`));
    socket.on('joined', ({ room: joined }) => { if (setMultiplayerStatusFn) setMultiplayerStatusFn(`Room ${joined}`); });
    socket.on('room_error', ({ error }) => { if (setMultiplayerStatusFn) setMultiplayerStatusFn(error); });

    socket.on('connect_error', (err) => {
        if (err.data && err.data.code === 'PASSPHRASE_REQUIRED') {
            const phrase = prompt('This server requires a multiplayer passphrase:');
            if (phrase) {
                socket.auth = { room, passphrase: phrase };
                socket.connect();
                return;
            }
            if (setMultiplayerStatusFn) setMultiplayerStatusFn('Passphrase required');
        } else {
            if (setMultiplayerStatusFn) setMultiplayerStatusFn(`Connection failed: ${err.message}`);
        }
        console.warn('Multiplayer connection failed:', err.message);
    });

    socket.on('state', (state) => {
        if (!state) return;
        applyingRemoteState = true;
        if (setBaselineScaleFn) setBaselineScaleFn(state.s);
        if (setTargetRotationFn) setTargetRotationFn({ x: state.rx, y: state.ry });
        if (setTargetPositionFn) setTargetPositionFn({ x: state.px, y: state.py });
        applyingRemoteState = false;
    });
}

// Update multiplayer feature flag
export function setMultiplayerEnabled(enabled) {
    featureFlags.multiplayer = enabled;
    if (setFeatureFlagsFn) setFeatureFlagsFn(featureFlags);
    
    if (socket) {
        if (enabled) socket.connect(); else socket.disconnect();
    }
    if (!enabled && setMultiplayerStatusFn) setMultiplayerStatusFn('Not connected');
}

// Emit current state to other clients in room
export function maybeEmitState() {
    if (!socket || !featureFlags.multiplayer || applyingRemoteState) return;
    const now = performance.now();
    if (now - lastEmit < 50) return; // 20 Hz
    lastEmit = now;
    
    const baselineScale = getBaselineScaleFn ? getBaselineScaleFn() : 1.0;
    const targetRotation = getTargetRotationFn ? getTargetRotationFn() : { x: 0, y: 0 };
    const targetPosition = getTargetPositionFn ? getTargetPositionFn() : { x: 0, y: 0 };
    
    socket.emit('state', { 
        s: baselineScale, 
        rx: targetRotation.x, 
        ry: targetRotation.y, 
        px: targetPosition.x, 
        py: targetPosition.y 
    });
}

// Get socket for external access
export function getSocket() { return socket; }
export function isConnected() { return socket?.connected ?? false; }