// Three.js Scene Module
// Handles renderer, scene, camera, lights, animation loop, and core Three.js setup

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Module state
let renderer = null;
let scene = null;
let camera = null;
let orbitControls = null;
let cube = null;
let activeObject = null;
let lockCenter = true;
let featureFlags = { hologram: false };
let baselineScale = 1.0;
let targetRotation = { x: 0, y: 0 };
let targetPosition = { x: 0, y: 0 };

// Animation timing
let fpsCounter = 0;
let lastFpsTime = 0;

// External references (set by main.js)
let setGestureFn = null;
let updateTrackingStatusFn = null;
let ensureInViewFn = null;
let renderHologramFn = null;
let fitCameraToObjectFn = null;

// Initialize Three.js scene
export function initThree() {
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

    window.addEventListener('resize', onResize);

    return { renderer, scene, camera, orbitControls, cube };
}

function onResize() {
    const container = document.getElementById('scene');
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (activeObject && fitCameraToObjectFn) fitCameraToObjectFn(activeObject, 1.8);
}

// Animation loop
export function animate() {
    const loop = () => {
        // Smooth transforms
        if (activeObject) {
            const s = activeObject.scale.x;
            const newS = lerp(s, baselineScale, 0.18);
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
            if (ensureInViewFn) ensureInViewFn(activeObject, 1.12);
        }
        if (featureFlags.hologram) {
            if (renderHologramFn) renderHologramFn();
        } else {
            renderer.setScissorTest(false);
            renderer.render(scene, camera);
        }

        updateFPS();
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

function lerp(a, b, t) { return a + (b - a) * t; }

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

// Mouse input handling
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

export function bindMouseInput() {
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
            if (setGestureFn) setGestureFn('Rotate (Mouse)');
        } else if (mouseState.mode === 'translate') {
            if (lockCenter) {
                const { wx, wy } = screenDeltaToWorld(dx, dy);
                targetPosition.x += wx;
                targetPosition.y -= wy;
                if (setGestureFn) setGestureFn('Pan Model (Mouse)');
            } else {
                if (camera && activeObject) {
                    const box = new THREE.Box3().setFromObject(activeObject);
                    const center = new THREE.Vector3();
                    box.getCenter(center);
                    
                    const cameraRight = new THREE.Vector3();
                    camera.getWorldDirection(cameraRight);
                    cameraRight.cross(camera.up).normalize();
                    
                    const cameraUp = new THREE.Vector3(0, 1, 0);
                    
                    const panRight = cameraRight.clone().multiplyScalar(-dx * 0.01);
                    const panUp = cameraUp.clone().multiplyScalar(dy * 0.01);
                    
                    camera.position.add(panRight).add(panUp);
                    camera.lookAt(center);
                }
                if (setGestureFn) setGestureFn('Pan Viewport (Mouse)');
            }
        } else if (mouseState.mode === 'scale') {
            const factor = Math.exp(-dy * 0.003);
            const newBase = THREE.MathUtils.clamp(baselineScale * factor, 0.05, 10);
            setBaselineScale(newBase);
            if (setGestureFn) setGestureFn('Scale (Mouse)');
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
        if (setGestureFn) setGestureFn(e.deltaY > 0 ? 'Zoom Out (Wheel)' : 'Zoom In (Wheel)');
    }, { passive: false });
}

// Camera manipulation functions
export function orbitDistance(multiplier) {
    if (!activeObject || !camera) return;
    const box = new THREE.Box3().setFromObject(activeObject);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const dir = new THREE.Vector3().subVectors(camera.position, center);
    const newPos = new THREE.Vector3().addVectors(center, dir.multiplyScalar(multiplier));
    camera.position.copy(newPos);
    camera.lookAt(center);
}

export function fitCameraToObject(object3d, margin = 1.8) {
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

    camera.near = Math.max(0.001, distance / 1000);
    camera.far = Math.max(distance * 1000, camera.near + 100);
    camera.updateProjectionMatrix();

    camera.position.set(center.x, center.y, center.z + distance);
    camera.lookAt(center);
    
    if (ensureInViewFn) ensureInViewFn(object3d, 1.4);
}

export function centerObject() {
    if (!activeObject) return;
    activeObject.position.set(0, 0, 0);
    activeObject.rotation.set(0, 0, 0);
    targetPosition = { x: 0, y: 0 };
    targetRotation = { x: 0, y: 0 };
    if (fitCameraToObjectFn) fitCameraToObjectFn(activeObject, 1.8);
}

export function resetCamera() {
    if (!activeObject) return;
    if (fitCameraToObjectFn) fitCameraToObjectFn(activeObject, 1.8);
}

export function zoomToSurface() {
    if (!activeObject || !camera) return;
    const box = new THREE.Box3().setFromObject(activeObject);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    
    const maxSize = Math.max(size.x, size.y, size.z);
    const closeDistance = maxSize * 0.001;
    
    const dir = new THREE.Vector3().subVectors(camera.position, center).normalize();
    const newPos = new THREE.Vector3().addVectors(center, dir.multiplyScalar(closeDistance));
    camera.position.copy(newPos);
    camera.lookAt(center);
}

export function ensureInView(object3d, margin = 1.1) {
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
    
    const minDistance = Math.max(0.001, required * 0.1);
    
    if (current < minDistance) {
        dir.setLength(lerp(current, minDistance, 0.3));
        camera.position.copy(center.clone().add(dir));
        camera.lookAt(center);
    } else if (current < required) {
        dir.setLength(lerp(current, required, 0.2));
        camera.position.copy(center.clone().add(dir));
        camera.lookAt(center);
    }
}

// Setters for external dependencies
export function setSetGestureFn(fn) { setGestureFn = fn; }
export function setUpdateTrackingStatusFn(fn) { updateTrackingStatusFn = fn; }
export function setEnsureInViewFn(fn) { ensureInViewFn = fn; }
export function setRenderHologramFn(fn) { renderHologramFn = fn; }
export function setFitCameraToObjectFn(fn) { fitCameraToObjectFn = fn; }
export function setLockCenter(value) { lockCenter = value; if (orbitControls) orbitControls.enablePan = !value; }
export function setFeatureFlags(flags) { featureFlags = flags; }
export function setBaselineScale(v) { baselineScale = v; }
export function setTargetRotation(r) { targetRotation = r; }
export function setTargetPosition(p) { targetPosition = p; }
export function setActiveObject(obj) { activeObject = obj; }
export function getActiveObject() { return activeObject; }
export function getCube() { return cube; }
export function getRenderer() { return renderer; }
export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getOrbitControls() { return orbitControls; }
export function getBaselineScale() { return baselineScale; }
export function getTargetRotation() { return targetRotation; }
export function getTargetPosition() { return targetPosition; }
export function getLockCenter() { return lockCenter; }