// Error Boundary Module
// Handles client-side error catching and display

// Initialize error handling
export function initErrorHandling() {
    // Global error handler
    window.addEventListener('error', (event) => {
        console.error('Global error:', event.error);
        showErrorOverlay(event.error?.message || 'An unexpected error occurred');
    });

    // Unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled rejection:', event.reason);
        showErrorOverlay(event.reason?.message || 'An unexpected error occurred');
    });
}

// Show error overlay to user
function showErrorOverlay(message) {
    // Remove any existing error overlay
    const existing = document.getElementById('error-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'error-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(12, 14, 18, 0.95);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        color: #ffce99;
        font-family: Inter, system-ui, sans-serif;
        padding: 20px;
    `;

    overlay.innerHTML = `
        <div style="max-width: 500px; text-align: center;">
            <h2 style="color: #f44336; margin-bottom: 16px;">⚠️ Error</h2>
            <p style="margin-bottom: 24px; line-height: 1.6;">${message}</p>
            <button id="error-dismiss" style="
                background: #ffce99;
                color: #241b12;
                border: none;
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                font-size: 14px;
            ">Dismiss</button>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('error-dismiss').addEventListener('click', () => {
        overlay.remove();
    });
}

// Three.js specific error boundary
export function setupThreeJSErrorBoundary(renderer) {
    if (!renderer) return;
    
    const originalRender = renderer.render.bind(renderer);
    renderer.render = function(scene, camera) {
        try {
            originalRender(scene, camera);
        } catch (error) {
            console.error('Three.js render error:', error);
            showErrorOverlay(`Rendering error: ${error.message}`);
        }
    };
}