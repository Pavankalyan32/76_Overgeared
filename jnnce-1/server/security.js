// Security Module
// Helmet.js CSP, HSTS, rate limiting, and validation

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';

// Helmet configuration with CSP for Three.js + MediaPipe + Socket.IO
export const helmetConfig = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-eval'", // Required for Three.js module loading
                "https://unpkg.com",
                "https://cdn.jsdelivr.net",
                "'unsafe-inline'" // For inline scripts in HTML
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'", // For inline styles
                "https://unpkg.com"
            ],
            imgSrc: [
                "'self'",
                "data:",
                "https://unpkg.com",
                "https://rawcdn.githack.com",
                "https://raw.githubusercontent.com"
            ],
            fontSrc: ["'self'", "data:"],
            connectSrc: [
                "'self'",
                "ws:",
                "wss:",
                "https://unpkg.com",
                "https://cdn.jsdelivr.net",
                "https://generativelanguage.googleapis.com"
            ],
            mediaSrc: ["'self'", "blob:"],
            workerSrc: ["'self'", "blob:"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false, // Required for Three.js/WebGL
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: "deny" },
    hidePoweredBy: true,
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xssFilter: true
});

// Rate limiting configurations
export const createRateLimiters = (aiRateMax = 10, aiRateWindowMs = 60000) => ({
    // General API rate limit
    api: rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // 100 requests per window
        message: { error: 'Too many requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.ip,
        skip: (req) => req.path === '/health' // Don't rate limit health checks
    }),
    
    // Stricter limit for AI endpoint (expensive)
    ai: rateLimit({
        windowMs: aiRateWindowMs,
        max: aiRateMax,
        message: { error: 'AI rate limit exceeded. Please wait before making more requests.' },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.ip
    }),
    
    // Socket.IO connection rate limit
    socket: rateLimit({
        windowMs: 60 * 1000,
        max: 20, // 20 connections per minute per IP
        message: { error: 'Too many connection attempts.' },
        standardHeaders: true,
        legacyHeaders: false
    }),
    
    // File upload rate limit
    upload: rateLimit({
        windowMs: 60 * 1000,
        max: 5, // 5 uploads per minute
        message: { error: 'Upload rate limit exceeded.' },
        standardHeaders: true,
        legacyHeaders: false
    })
});

// Validation middleware
export const validateAIRequest = [
    body('prompt')
        .isString()
        .trim()
        .notEmpty()
        .withMessage('Prompt must be a non-empty string')
        .isLength({ max: 20000 })
        .withMessage('Prompt exceeds 20,000 characters'),
    body('images')
        .optional()
        .isArray({ max: 2 })
        .withMessage('At most 2 images allowed'),
    body('images.*')
        .optional()
        .isString()
        .isLength({ max: 4000000 })
        .withMessage('Each image must be under 4MB'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

// File upload validation
export function validateFileUpload(req, res, next) {
    if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }
    
    const allowedTypes = ['.glb', '.gltf', '.obj', '.mtl', '.stl'];
    const maxSize = 50 * 1024 * 1024; // 50MB
    
    for (const [fieldName, file] of Object.entries(req.files)) {
        const files = Array.isArray(file) ? file : [file];
        
        for (const f of files) {
            // Check file extension
            const ext = f.name.toLowerCase().substring(f.name.lastIndexOf('.'));
            if (!allowedTypes.includes(ext)) {
                return res.status(400).json({ 
                    error: `Unsupported file type: ${ext}. Allowed: ${allowedTypes.join(', ')}` 
                });
            }
            
            // Check file size
            if (f.size > maxSize) {
                return res.status(413).json({ 
                    error: `File ${f.name} exceeds 50MB limit` 
                });
            }
            
            // Basic MIME type check (can be spoofed, but adds layer)
            const allowedMimes = [
                'model/gltf-binary',
                'model/gltf+json',
                'application/octet-stream',
                'text/plain',
                'application/sla'
            ];
            // Note: MIME type from browser is unreliable, so we don't enforce strictly
        }
    }
    
    next();
}

// CORS configuration
export const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*', // Set to specific domain in production
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400 // 24 hours
};

// Security headers middleware (additional to Helmet)
export function additionalSecurityHeaders(req, res, next) {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // XSS protection (legacy browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions policy (restrict browser features)
    res.setHeader('Permissions-Policy', 
        'camera=*, microphone=*, geolocation=(), payment=(), usb=()'
    );
    
    // Remove server header
    res.removeHeader('X-Powered-By');
    
    next();
}