// Three.js Models Module
// Handles all model loading: primitives, GLTF samples, custom files (GLB, GLTF, OBJ, STL)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Module state
let currentModel = null;
let cube = null;
let activeObject = null;
let scene = null;
let ui = null;

// External function references (set by main.js)
let fitCameraToObjectFn = null;
let showLoadingIndicatorFn = null;
let hideLoadingIndicatorFn = null;
let setActiveObjectFn = null;
let getActiveObjectFn = null;
let setBaselineScaleFn = null;
let setTargetRotationFn = null;
let setTargetPositionFn = null;
let resetGestureStatesFn = null;

// Sample model URLs
const SAMPLE_MODELS = {
    globe: './scene.gltf',
    helmet: 'https://rawcdn.githack.com/mrdoob/three.js/r160/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf',
    duck: 'https://rawcdn.githack.com/mrdoob/three.js/r160/examples/models/gltf/Duck/glTF/Duck.gltf',
    fox: 'https://rawcdn.githack.com/mrdoob/three.js/r160/examples/models/gltf/Fox/glTF/Fox.gltf',
    robot: 'https://rawcdn.githack.com/mrdoob/three.js/r160/examples/models/gltf/RobotExpressive/glTF/RobotExpressive.gltf',
};

// Initialize module with dependencies
export function initModels(dependencies) {
    cube = dependencies.cube;
    activeObject = dependencies.activeObject;
    scene = dependencies.scene;
    ui = dependencies.ui;
    
    fitCameraToObjectFn = dependencies.fitCameraToObject;
    showLoadingIndicatorFn = dependencies.showLoadingIndicator;
    hideLoadingIndicatorFn = dependencies.hideLoadingIndicator;
    setActiveObjectFn = dependencies.setActiveObject;
    getActiveObjectFn = dependencies.getActiveObject;
    setBaselineScaleFn = dependencies.setBaselineScale;
    setTargetRotationFn = dependencies.setTargetRotation;
    setTargetPositionFn = dependencies.setTargetPosition;
    resetGestureStatesFn = dependencies.resetGestureStates;
}

// Set cube reference (called after scene init)
export function setCube(c) { cube = c; }

// Center and scale an object to fit nicely in view
export function centerAndScale(object3d) {
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

// Clear all models from scene
export function clearAllModels() {
    if (currentModel) {
        scene.remove(currentModel);
        currentModel.traverse((child) => {
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => { if (mat) mat.dispose(); });
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
    
    objectsToRemove.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(mat => { if (mat) mat.dispose(); });
            } else {
                obj.material.dispose();
            }
        }
    });
    
    if (cube) cube.visible = false;
}

// Load a built-in model by kind
export async function loadModel(kind) {
    if (kind === 'custom') return;
    
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
            if (setActiveObjectFn) setActiveObjectFn(earth);
        } catch (e) {
            const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.8, metalness: 0.0 });
            const earth = new THREE.Mesh(geometry, fallbackMat);
            scene.add(earth);
            if (setActiveObjectFn) setActiveObjectFn(earth);
            console.warn('Earth texture failed to load, using fallback sphere:', e);
        }
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
        return;
    }
    
    if (kind === 'cube') { 
        if (cube) { cube.visible = true; if (setActiveObjectFn) setActiveObjectFn(cube); }
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
        return; 
    }
    
    if (kind === 'sphere') {
        const geometry = new THREE.SphereGeometry(0.8, 32, 32);
        const material = new THREE.MeshStandardMaterial({ color: 0x54a0ff, roughness: 0.3, metalness: 0.2 });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);
        if (setActiveObjectFn) setActiveObjectFn(sphere);
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
        return;
    }
    
    if (kind === 'torus') {
        const geometry = new THREE.TorusGeometry(0.6, 0.2, 16, 100);
        const material = new THREE.MeshStandardMaterial({ color: 0xff6b6b, roughness: 0.4, metalness: 0.1 });
        const torus = new THREE.Mesh(geometry, material);
        scene.add(torus);
        if (setActiveObjectFn) setActiveObjectFn(torus);
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
        return;
    }
    
    if (kind === 'cylinder') {
        const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
        const material = new THREE.MeshStandardMaterial({ color: 0x51cf66, roughness: 0.5, metalness: 0.1 });
        const cylinder = new THREE.Mesh(geometry, material);
        scene.add(cylinder);
        if (setActiveObjectFn) setActiveObjectFn(cylinder);
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
        return;
    }
    
    if (kind === 'cone') {
        const geometry = new THREE.ConeGeometry(0.6, 1.2, 32);
        const material = new THREE.MeshStandardMaterial({ color: 0xffd43b, roughness: 0.6, metalness: 0.05 });
        const cone = new THREE.Mesh(geometry, material);
        scene.add(cone);
        if (setActiveObjectFn) setActiveObjectFn(cone);
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
        return;
    }
    
    // Complex geometric shapes
    if (['octahedron', 'dodecahedron', 'icosahedron', 'ring', 'plane'].includes(kind)) {
        const complexShape = createComplexShape(kind);
        if (complexShape) {
            scene.add(complexShape);
            if (setActiveObjectFn) setActiveObjectFn(complexShape);
            if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
            return;
        }
    }
    
    // GLTF models
    const url = SAMPLE_MODELS[kind];
    if (!url) {
        console.error('Unknown model type:', kind, '- falling back to cube');
        if (cube) { cube.visible = true; if (setActiveObjectFn) setActiveObjectFn(cube); }
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
        return;
    }
    
    if (cube) cube.visible = false;
    if (showLoadingIndicatorFn) showLoadingIndicatorFn();
    try {
        const gltf = await new GLTFLoader().loadAsync(url);
        currentModel = gltf.scene;
        currentModel.position.set(0, 0, 0);
        currentModel.scale.setScalar(1);
        scene.add(currentModel);
        if (setActiveObjectFn) setActiveObjectFn(currentModel);
        centerAndScale(currentModel);
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
    } catch (err) {
        console.error(`Failed to load model "${kind}":`, err);
        if (cube) { cube.visible = true; if (setActiveObjectFn) setActiveObjectFn(cube); }
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.15);
        alert(`Could not load the "${kind}" model. Check your internet connection.`);
    } finally {
        if (hideLoadingIndicatorFn) hideLoadingIndicatorFn();
    }
}

// Create complex geometric shapes
function createComplexShape(type) {
    let geometry, material;
    
    switch(type) {
        case 'octahedron':
            geometry = new THREE.OctahedronGeometry(0.8);
            material = new THREE.MeshStandardMaterial({ color: 0x845ef7, roughness: 0.2, metalness: 0.3 });
            break;
        case 'dodecahedron':
            geometry = new THREE.DodecahedronGeometry(0.7);
            material = new THREE.MeshStandardMaterial({ color: 0xfd7e14, roughness: 0.4, metalness: 0.1 });
            break;
        case 'icosahedron':
            geometry = new THREE.IcosahedronGeometry(0.8);
            material = new THREE.MeshStandardMaterial({ color: 0x20c997, roughness: 0.3, metalness: 0.2 });
            break;
        case 'ring':
            geometry = new THREE.RingGeometry(0.3, 0.8, 32);
            material = new THREE.MeshStandardMaterial({ color: 0xe83e8c, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
            break;
        case 'plane':
            geometry = new THREE.PlaneGeometry(2, 2);
            material = new THREE.MeshStandardMaterial({ color: 0x6c757d, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide });
            break;
        default:
            return null;
    }
    
    return new THREE.Mesh(geometry, material);
}

// Load custom model from URL
export async function loadCustomFromURL(url) {
    const u = String(url || '').trim();
    const lower = u.toLowerCase();
    if (showLoadingIndicatorFn) showLoadingIndicatorFn();
    try {
        clearAllModels();
        if (cube) cube.visible = false;
        
        if (lower.endsWith('.gltf') || lower.endsWith('.glb')) {
            const loader = new GLTFLoader();
            try {
                const base = u.substring(0, u.lastIndexOf('/') + 1);
                if (base.startsWith('http')) loader.setResourcePath(base);
            } catch {}
            const gltf = await loader.loadAsync(u);
            currentModel = gltf.scene;
        } else if (lower.endsWith('.obj')) {
            try {
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
                console.log('No MTL file found, loading OBJ with default materials');
                const loader = new OBJLoader();
                currentModel = await loader.loadAsync(u);
            }
            
            currentModel.traverse(child => {
                if (child.isMesh) {
                    if (child.geometry && !child.geometry.attributes.normal) {
                        child.geometry.computeVertexNormals();
                    }
                    if (!child.material) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0xcccccc,
                            roughness: 0.5,
                            metalness: 0.1
                        });
                    }
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
            if (cube) { cube.visible = true; if (setActiveObjectFn) setActiveObjectFn(cube); }
            return;
        }
        
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
        if (setActiveObjectFn) setActiveObjectFn(currentModel);
        if (ui?.modelSelect) ui.modelSelect.value = 'custom';
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.8);
    } catch (err) {
        console.error('Failed to load model:', err);
        alert('Failed to load model. If loading from a URL, ensure it allows CORS. For file uploads, prefer .glb (binary GLTF).');
        if (cube) { cube.visible = true; if (setActiveObjectFn) setActiveObjectFn(cube); }
    } finally {
        if (hideLoadingIndicatorFn) hideLoadingIndicatorFn();
    }
}

// Load OBJ file with optional MTL
export async function loadOBJFile(objFile, mtlFile = null) {
    const objURL = URL.createObjectURL(objFile);
    const urlsToRevoke = [objURL];
    
    try {
        clearAllModels();
        if (cube) cube.visible = false;
        
        let materials = null;
        
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
        
        const loader = new OBJLoader();
        if (materials) loader.setMaterials(materials);
        
        const model = await loader.loadAsync(objURL);
        
        model.traverse(child => {
            if (child.isMesh) {
                if (child.geometry && !child.geometry.attributes.normal) {
                    child.geometry.computeVertexNormals();
                }
                if (!child.material) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xcccccc,
                        roughness: 0.5,
                        metalness: 0.1
                    });
                }
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        centerAndScale(model);
        scene.add(model);
        if (setActiveObjectFn) setActiveObjectFn(model);
        if (fitCameraToObjectFn) fitCameraToObjectFn(getActiveObjectFn(), 1.8);
        
        console.log('OBJ file loaded successfully:', objFile.name);
        return model;
        
    } catch (error) {
        console.error('Error loading OBJ file:', error);
        throw new Error(`Failed to load OBJ file: ${error.message}`);
    } finally {
        setTimeout(() => {
            urlsToRevoke.forEach(url => URL.revokeObjectURL(url));
        }, 5000);
    }
}

// Load custom model from file
export async function loadCustomFromFile(file) {
    const name = (file?.name || '').toLowerCase();
    if (name.endsWith('.gltf')) {
        alert('Note: .gltf may reference external files. Prefer .glb for a single-file upload.');
    }
    
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

// Reset all models to default cube
export function resetModels() {
    clearAllModels();
    
    if (cube) {
        cube.visible = true;
        if (setActiveObjectFn) setActiveObjectFn(cube);
    }
    
    if (cube) {
        cube.position.set(0, 0, 0);
        cube.rotation.set(0, 0, 0);
        cube.scale.setScalar(1);
    }
    
    if (setTargetRotationFn) setTargetRotationFn({ x: 0, y: 0 });
    if (setTargetPositionFn) setTargetPositionFn({ x: 0, y: 0 });
    if (setBaselineScaleFn) setBaselineScaleFn(1.0);
    
    if (resetGestureStatesFn) resetGestureStatesFn();
    
    if (ui) {
        if (ui.scaleSlider) ui.scaleSlider.value = '1';
        if (ui.scaleNumber) ui.scaleNumber.value = '1';
        if (ui.scaleValue) ui.scaleValue.textContent = '1.0';
        if (ui.modelSelect) ui.modelSelect.value = 'cube';
    }
    
    if (fitCameraToObjectFn && cube) fitCameraToObjectFn(cube, 1.15);
    
    console.log('Models reset to default cube');
}