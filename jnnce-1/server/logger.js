// Logger Module
// Structured JSON logging with Pino

import pino from 'pino';
import fs from 'fs';
import path from 'path';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Create logger with pretty print for development, JSON for production
const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    formatters: {
        level: (label) => ({ level: label })
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    base: {
        pid: process.pid,
        hostname: process.env.HOSTNAME || 'unknown',
        service: 'tesseract-server'
    }
}, isProduction ? undefined : pino.destination({ sync: false }));

// Export base logger
export { logger };

// Create child loggers for different contexts
export const requestLogger = logger.child({ component: 'http' });
export const socketLogger = logger.child({ component: 'socket' });
export const aiLogger = logger.child({ component: 'ai' });
export const authLogger = logger.child({ component: 'auth' });
export const errorLogger = logger.child({ component: 'error' });

// HTTP request logging middleware
export function httpLoggingMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    
    res.on('finish', () => {
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationMs = durationNs / 1e6;
        
        requestLogger.info({
            method: req.method,
            url: req.url,
            status: res.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            contentLength: res.get('content-length')
        }, `${req.method} ${req.url} ${res.statusCode}`);
    });
    
    next();
}

// Socket.IO logging middleware
export function socketLoggingMiddleware(socket, next) {
    const { id, handshake } = socket;
    const ip = handshake.address;
    const room = handshake.auth?.room;
    
    socketLogger.info({ socketId: id, ip, room }, 'Socket connecting');
    
    socket.on('disconnect', (reason) => {
        socketLogger.info({ socketId: id, room, reason }, 'Socket disconnected');
    });
    
    socket.on('error', (err) => {
        socketLogger.error({ socketId: id, room, error: err.message }, 'Socket error');
    });
    
    next();
}

// AI request logging
export function logAIRequest(ip, promptLength, imageCount, durationMs, success, errorMessage = null) {
    aiLogger.info({
        ip,
        promptLength,
        imageCount,
        durationMs,
        success,
        error: errorMessage
    }, success ? 'AI request completed' : 'AI request failed');
}

// Auth logging
export function logAuthAttempt(ip, success, reason = null) {
    authLogger.info({ ip, success, reason }, success ? 'Auth successful' : 'Auth failed');
}

// Error logging with context
export function logError(context, error, extra = {}) {
    errorLogger.error({
        context,
        error: error?.message,
        stack: error?.stack,
        ...extra
    }, `Error in ${context}`);
}

// Export base logger for custom use
export default logger;