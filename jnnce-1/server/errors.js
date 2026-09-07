// Server Errors Module
// Centralized error handling, graceful shutdown, and error boundaries

import { logger, errorLogger } from './logger.js';

// Custom error classes
export class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message, details = {}) {
        super(message, 400, 'VALIDATION_ERROR', details);
    }
}

export class AuthenticationError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

export class AuthorizationError extends AppError {
    constructor(message = 'Insufficient permissions') {
        super(message, 403, 'AUTHORIZATION_ERROR');
    }
}

export class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
    }
}

export class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded', retryAfter = 60) {
        super(message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
    }
}

export class AIProxyError extends AppError {
    constructor(message, upstreamStatus = 502) {
        super(message, upstreamStatus, 'AI_PROXY_ERROR');
    }
}

// Global error handler for Express
export function errorHandler(err, req, res, next) {
    // Log error with context
    errorLogger.error({
        error: err.message,
        stack: err.stack,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        statusCode: err.statusCode || 500,
        code: err.code || 'INTERNAL_ERROR'
    }, 'Request error');
    
    // Handle known error types
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            error: err.message,
            code: err.code,
            details: err.details,
            ...(err instanceof RateLimitError && { retryAfter: err.details.retryAfter })
        });
    }
    
    // Handle validation errors (express-validator)
    if (err.name === 'ValidationError' && err.errors) {
        return res.status(400).json({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: err.errors
        });
    }
    
    // Handle Zod validation errors
    if (err.name === 'ZodError') {
        return res.status(400).json({
            error: 'Invalid request data',
            code: 'VALIDATION_ERROR',
            details: err.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message
            }))
        });
    }
    
    // Handle multer errors (file upload)
    if (err.name === 'MulterError') {
        let message = 'File upload error';
        if (err.code === 'LIMIT_FILE_SIZE') {
            message = 'File too large';
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            message = 'Too many files';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            message = 'Unexpected file field';
        }
        return res.status(400).json({ error: message, code: 'UPLOAD_ERROR' });
    }
    
    // Default: internal server error
    // Don't leak internal details in production
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({
        error: isProduction ? 'Internal server error' : err.message,
        code: 'INTERNAL_ERROR',
        ...(!isProduction && { stack: err.stack })
    });
}

// Async wrapper for route handlers
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// Graceful shutdown handler
export function setupGracefulShutdown(server, io, cleanupFns = []) {
    const shutdown = async (signal) => {
        logger.info({ signal }, 'Shutdown signal received, starting graceful shutdown');
        
        // Stop accepting new connections
        server.close(() => {
            logger.info('HTTP server closed');
        });
        
        // Close Socket.IO connections
        if (io) {
            io.close(() => {
                logger.info('Socket.IO server closed');
            });
            
            // Force close after timeout
            setTimeout(() => {
                logger.warn('Forcing Socket.IO close');
                io.engine.clientsCount = 0;
            }, 5000);
        }
        
        // Run custom cleanup functions
        for (const fn of cleanupFns) {
            try {
                await fn();
            } catch (error) {
                logger.error({ error: error.message }, 'Cleanup function failed');
            }
        }
        
        // Force exit after timeout
        setTimeout(() => {
            logger.error('Forced exit after timeout');
            process.exit(1);
        }, 10000);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
        logger.fatal({ error: err.message, stack: err.stack }, 'Uncaught exception');
        shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        logger.fatal({ reason: reason?.message || reason, stack: reason?.stack }, 'Unhandled rejection');
        // Don't shutdown immediately for unhandled rejections, just log
    });
    
    return shutdown;
}

// Request ID middleware (for tracing)
export function requestIdMiddleware(req, res, next) {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
}

// Timeout middleware
export function timeoutMiddleware(ms = 30000) {
    return (req, res, next) => {
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                res.status(504).json({ error: 'Request timeout', code: 'TIMEOUT' });
            }
        }, ms);
        
        res.on('finish', () => clearTimeout(timeout));
        res.on('close', () => clearTimeout(timeout));
        
        next();
    };
}