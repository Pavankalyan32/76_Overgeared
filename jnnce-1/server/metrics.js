// Metrics Module
// Prometheus metrics exposition

import promClient from 'prom-client';

// Create registry
const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register, prefix: 'tesseract_' });

// Custom metrics
const httpRequestsTotal = new promClient.Counter({
    name: 'tesseract_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status'],
    registers: [register]
});

const httpRequestDuration = new promClient.Histogram({
    name: 'tesseract_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'path'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [register]
});

const aiRequestsTotal = new promClient.Counter({
    name: 'tesseract_ai_requests_total',
    help: 'Total number of AI requests',
    labelNames: ['status', 'has_images'],
    registers: [register]
});

const aiRequestDuration = new promClient.Histogram({
    name: 'tesseract_ai_request_duration_seconds',
    help: 'AI request duration in seconds',
    labelNames: ['status'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60],
    registers: [register]
});

const socketConnections = new promClient.Gauge({
    name: 'tesseract_socket_connections',
    help: 'Current number of WebSocket connections',
    labelNames: ['room'],
    registers: [register]
});

const activeRooms = new promClient.Gauge({
    name: 'tesseract_active_rooms',
    help: 'Number of active multiplayer rooms',
    registers: [register]
});

const rateLimitHits = new promClient.Counter({
    name: 'tesseract_rate_limit_hits_total',
    help: 'Total number of rate limit hits',
    labelNames: ['endpoint', 'ip'],
    registers: [register]
});

const fileUploads = new promClient.Counter({
    name: 'tesseract_file_uploads_total',
    help: 'Total number of file uploads',
    labelNames: ['type', 'status'],
    registers: [register]
});

const modelsLoaded = new promClient.Counter({
    name: 'tesseract_models_loaded_total',
    help: 'Total number of models loaded',
    labelNames: ['type', 'status'],
    registers: [register]
});

// Middleware to track HTTP metrics
export function httpMetricsMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    const path = req.route?.path || req.path;
    
    res.on('finish', () => {
        const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
        
        httpRequestsTotal.inc({ method: req.method, path, status: res.statusCode });
        httpRequestDuration.observe({ method: req.method, path }, durationSec);
    });
    
    next();
}

// Track AI request
export function trackAIRequest(hasImages, success, durationSec) {
    aiRequestsTotal.inc({ status: success ? 'success' : 'error', has_images: String(hasImages) });
    aiRequestDuration.observe({ status: success ? 'success' : 'error' }, durationSec);
}

// Track socket connection
export function trackSocketConnection(room, delta) {
    socketConnections.inc({ room }, delta);
}

// Track active rooms
export function setActiveRooms(count) {
    activeRooms.set(count);
}

// Track rate limit hit
export function trackRateLimitHit(endpoint, ip) {
    rateLimitHits.inc({ endpoint, ip });
}

// Track file upload
export function trackFileUpload(type, success) {
    fileUploads.inc({ type, status: success ? 'success' : 'error' });
}

// Track model loaded
export function trackModelLoaded(type, success) {
    modelsLoaded.inc({ type, status: success ? 'success' : 'error' });
}

// Metrics endpoint handler
export async function metricsHandler(req, res) {
    try {
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.send(metrics);
    } catch (error) {
        res.status(500).send('Error generating metrics');
    }
}

// Get metrics as JSON (for debugging)
export async function getMetricsAsJSON() {
    return register.getMetricsAsJSON();
}

export { register };