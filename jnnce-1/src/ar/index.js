// AR Module
// Handles WebXR AR button setup

import { ARButton } from 'three/addons/webxr/ARButton.js';

// Module state
let renderer = null;
let suppressHands = false;

// External function references (set by main.js)
let setSuppressHandsFn = null;

// Initialize AR with dependencies
export function initAR(dependencies) {
    renderer = dependencies.renderer;
    setSuppressHandsFn = dependencies.setSuppressHands;
    setupARButton();
}

function setupARButton() {
    try {
        const btn = ARButton.createButton(renderer, { requiredFeatures: [] });
        const container = document.getElementById('ar_container');
        if (container && btn) {
            container.innerHTML = '';
            container.appendChild(btn);
            btn.addEventListener('click', () => {
                const isPresenting = renderer.xr.isPresenting;
                if (setSuppressHandsFn) setSuppressHandsFn(isPresenting);
            });
        }
    } catch (e) {
        console.info('AR unavailable:', e.message);
    }
}