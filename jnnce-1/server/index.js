'use strict';

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// New modules
import { helmetConfig, createRateLimiters, additionalSecurityHeaders, corsOptions } from './security.js';
import { logger, httpLoggingMiddleware, socketLoggingMiddleware, logAIRequest, logAuthAttempt } from './logger.js';
import { getConfig, getServerConfig, getAIConfig, getMultiplayerConfig, getCORSConfig, validateFeatureConfig } from './config.js';
import { createHealthMiddleware, getHealth } from './health.js';
import { metricsHandler, httpMetricsMiddleware, trackAIRequest, trackSocketConnection, setActiveRooms, trackRateLimitHit, trackFileUpload, trackModelLoaded } from './metrics.js';
import { errorHandler, asyncHandler, setupGracefulShutdown, requestIdMiddleware, timeoutMiddleware } from './errors.js';
import { sanitizeState, isValidRoom, roomState, STATE_RATE, MULTIPLAYER_PASSPHRASE, checkRateLimit, resetRateLimits, rateLimit, getMultiplayerPassphrase } from './shared.js';

// Load and validate configuration
const config = getConfig();
const serverConfig = getServerConfig();
const aiConfig = getAIConfig();
const multiplayerConfig = getMultiplayerConfig();
const corsConfig = getCORSConfig();

// Validate feature configuration
const { warnings } = validateFeatureConfig();
for (const warning of warnings) {
    logger.warn({ warning }, 'Configuration warning');
}

// Create Express app
const app = express();
const server = http.createServer(app);

// Socket.IO server
const io = new Server(server, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmetConfig);
app.use(additionalSecurityHeaders);
app.use(cors(corsOptions));

// Request ID for tracing
app.use(requestIdMiddleware);

// Request timeout
app.use(timeoutMiddleware(30000));

// Body parsing
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

// Logging middleware
app.use(httpLoggingMiddleware);

// Metrics middleware
app.use(httpMetricsMiddleware);

// Rate limiters
const { api: apiLimiter, ai: aiLimiter } = createRateLimiters(aiConfig.AI_RATE_MAX, aiConfig.AI_RATE_WINDOW_MS);
app.use('/api/', apiLimiter);
app.use('/api/ai', aiLimiter);

// Serve static frontend
app.use('/', express.static(path.join(__dirname, '..')));

// Health check endpoint (no rate limit, no auth)
app.get('/health', createHealthMiddleware());

// Prometheus metrics endpoint
app.get('/metrics', metricsHandler);

// AI status endpoint
app.get('/api/ai/status', (_req, res) => {
    res.json({ 
        enabled: Boolean(aiConfig.GEMINI_API_KEY), 
        model: aiConfig.GEMINI_MODEL 
    });
});

// AI proxy endpoint with validation
app.post('/api/ai', asyncHandler(async (req, res) => {
    const startTime = process.hrtime.bigint();
    const { prompt, images } = req.body || {};
    
    // Validation
    if (typeof prompt !== 'string' || prompt.trim() === '') {
        return res.status(400).json({ error: 'prompt must be a non-empty string.' });
    }
    if (prompt.length > 20000) {
        return res.status(413).json({ error: 'prompt exceeds 20000 characters.' });
    }
    if (!Array.isArray(images) && images !== undefined) {
        return res.status(400).json({ error: 'images must be an array of base64 PNG strings.' });
    }
    const imageList = images || [];
    if (imageList.length > 2) {
        return res.status(400).json({ error: 'at most 2 images are allowed.' });
    }
    for (const img of images) {
        if (typeof img !== 'string' || img.length > 4000000) {
            return res.status(413).json({ error: 'each image must be a base64 string under 4MB.' });
        }
    }
    
    const hasImages = images.length > 0;
    
    if (!aiConfig.GEMINI_API_KEY) {
        return res.status(503).json({ 
            error: 'AI is not configured. Set GEMINI_API_KEY in server/.env and restart the server.' 
        });
    }
    
    const parts = [{ text: prompt }];
    for (const data of imageList) {
        parts.push({ inlineData: { mimeType: 'image/png', data } });
    }
    
    try {
        const upstream = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(aiConfig.GEMINI_MODEL)}:generateContent`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': aiConfig.GEMINI_API_KEY,
                },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        maxOutputTokens: aiConfig.GEMINI_MAX_TOKENS,
                        temperature: aiConfig.GEMINI_TEMPERATURE,
                    },
                }),
                signal: AbortSignal.timeout(60_000),
            }
        );
        
        const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
        
        if (!upstream.ok) {
            const errorText = await upstream.text();
            logger.error({ status: upstream.status, error: errorText }, 'Gemini API error');
            trackAIRequest(hasImages, false, durationSec);
            return res.status(502).json({ error: `Gemini request failed (${upstream.status}).` });
        }
        
        const data = await upstream.json();
        const text = data?.candidates?.[0]?.content?.parts
            ?.map((p) => p.text)
            .filter(Boolean)
            .join('\n')
            .trim();
        
        if (!text) {
            const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
            trackAIRequest(hasImages, false, durationSec);
            return res.status(502).json({
                error: reason ? `Gemini returned no text (${reason}).` : 'Gemini returned no text.',
            });
        }
        
        trackAIRequest(hasImages, true, durationSec);
        return res.json({ text });
        
    } catch (err) {
        const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
        trackAIRequest(hasImages, false, durationSec);
        
        const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
        logger.error({ error: err.message, timedOut }, 'Gemini proxy error');
        return res.status(timedOut ? 504 : 502).json({ 
            error: timedOut ? 'Gemini request timed out.' : 'Gemini request failed.' 
        });
    }
}));
    
    // Socket.IO connection handling with logging
io.use(socketLoggingMiddleware);

// Passphrase validation middleware (runs before connection)
if (multiplayerConfig.MULTIPLAYER_PASSPHRASE) {
    io.use((socket, next) => {
        const passphrase = socket.handshake.auth && socket.handshake.auth.passphrase;
        const requested = socket.handshake.auth && socket.handshake.auth.room;
        
        if (passphrase !== multiplayerConfig.MULTIPLAYER_PASSPHRASE) {
            const err = new Error('passphrase required');
            err.data = { code: 'PASSPHRASE_REQUIRED' };
            logAuthAttempt(socket.handshake.address, false, 'invalid_passphrase');
            return next(err);
        }
        
        // Also validate room early to prevent probing
        if (!isValidRoom(requested)) {
            const err = new Error('Invalid room id. Use 1-64 characters: A-Z a-z 0-9 _ -');
            return next(err);
        }
        
        logAuthAttempt(socket.handshake.address, true);
        next();
    });
}

io.on('connection', (socket) => {
    const requested = socket.handshake.auth && socket.handshake.auth.room;
    
    // Room already validated in middleware, but double-check
    if (!isValidRoom(requested)) {
        socket.emit('room_error', { error: 'Invalid room id. Use 1-64 characters: A-Z a-z 0-9 _ -' });
        socket.disconnect(true);
        return;
    }
    
    const room = requested;
    socket.join(room);
    socket.emit('joined', { room });
    trackSocketConnection(room, 1);
    setActiveRooms(roomState.size);
    
    // Send current state to newcomer
    const current = roomState.get(room);
    if (current) socket.emit('state', current);
    
    let times = [];
    socket.on('state', (state) => {
        const now = Date.now();
        const cutoff = now - STATE_RATE.windowMs;
        times = times.filter((t) => t > cutoff);
        if (times.length >= STATE_RATE.max) return; // drop, do not disconnect
        times.push(now);
        
        const clean = sanitizeState(state);
        if (!clean) return;
        roomState.set(room, clean);
        socket.to(room).emit('state', clean);
    });
    
    socket.on('disconnect', () => {
        trackSocketConnection(room, -1);
        // Clean up room state if last member left
        if (!io.sockets.adapter.rooms.get(room)) {
            roomState.delete(room);
            setActiveRooms(roomState.size);
        }
    });
});

// Global error handler (must be last)
app.use(errorHandler);

// Start server
if (import.meta.url === `file://${process.argv[1]}`) {
    const PORT = serverConfig.PORT;
    
    server.listen(PORT, () => {
        logger.info({ port: PORT, env: serverConfig.NODE_ENV }, 'Gesture3D server listening');
        if (!aiConfig.GEMINI_API_KEY) {
            logger.warn('AI assistant disabled: no GEMINI_API_KEY found');
        }
        if (!multiplayerConfig.MULTIPLAYER_PASSPHRASE && serverConfig.NODE_ENV === 'production') {
            logger.warn('Multiplayer passphrase not set - rooms are open');
        }
    });
    
    // Setup graceful shutdown
    setupGracefulShutdown(server, io, [
        () => logger.info('Graceful shutdown complete')
    ]);
}

export {
    app,
    server,
    io,
    sanitizeState,
    isValidRoom,
    roomState,
    STATE_RATE,
    MULTIPLAYER_PASSPHRASE,
    checkRateLimit,
    resetRateLimits,
    rateLimit,
    getHealth
};