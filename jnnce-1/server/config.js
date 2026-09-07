// Config Module
// Zod schema validation for all environment variables

import { z } from 'zod';

// Server configuration schema
const ServerConfigSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

// AI configuration schema
const AIConfigSchema = z.object({
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-1.5-flash'),
    GEMINI_MAX_TOKENS: z.coerce.number().int().positive().default(400),
    GEMINI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
    AI_RATE_MAX: z.coerce.number().int().positive().default(10),
    AI_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60000)
});

// Multiplayer configuration schema
const MultiplayerConfigSchema = z.object({
    MULTIPLAYER_PASSPHRASE: z.string().optional(),
    STATE_RATE_MAX: z.coerce.number().int().positive().default(40),
    STATE_RATE_WINDOW_MS: z.coerce.number().int().positive().default(1000)
});

// CORS configuration schema
const CORSConfigSchema = z.object({
    CORS_ORIGIN: z.string().default('*')
});

// Combined schema
const ConfigSchema = z.object({
    server: ServerConfigSchema,
    ai: AIConfigSchema,
    multiplayer: MultiplayerConfigSchema,
    cors: CORSConfigSchema
});

// Parse and validate config
function parseConfig() {
    const rawConfig = {
        server: {
            PORT: process.env.PORT,
            NODE_ENV: process.env.NODE_ENV,
            LOG_LEVEL: process.env.LOG_LEVEL
        },
        ai: {
            GEMINI_API_KEY: process.env.GEMINI_API_KEY,
            GEMINI_MODEL: process.env.GEMINI_MODEL,
            GEMINI_MAX_TOKENS: process.env.GEMINI_MAX_TOKENS,
            GEMINI_TEMPERATURE: process.env.GEMINI_TEMPERATURE,
            AI_RATE_MAX: process.env.AI_RATE_MAX,
            AI_RATE_WINDOW_MS: process.env.AI_RATE_WINDOW_MS
        },
        multiplayer: {
            MULTIPLAYER_PASSPHRASE: process.env.MULTIPLAYER_PASSPHRASE,
            STATE_RATE_MAX: process.env.STATE_RATE_MAX,
            STATE_RATE_WINDOW_MS: process.env.STATE_RATE_WINDOW_MS
        },
        cors: {
            CORS_ORIGIN: process.env.CORS_ORIGIN
        }
    };
    
    const result = ConfigSchema.safeParse(rawConfig);
    
    if (!result.success) {
        const errors = result.error.flatten().fieldErrors;
        const messages = Object.entries(errors)
            .flatMap(([field, msgs]) => msgs.map(m => `${field}: ${m}`))
            .join('; ');
        throw new Error(`Configuration validation failed: ${messages}`);
    }
    
    return result.data;
}

// Validated config instance
let config = null;

export function getConfig() {
    if (!config) {
        config = parseConfig();
    }
    return config;
}

export function getServerConfig() {
    return getConfig().server;
}

export function getAIConfig() {
    return getConfig().ai;
}

export function getMultiplayerConfig() {
    return getConfig().multiplayer;
}

export function getCORSConfig() {
    return getConfig().cors;
}

// Validate required configs for features
export function validateFeatureConfig() {
    const cfg = getConfig();
    const warnings = [];
    
    if (!cfg.ai.GEMINI_API_KEY) {
        warnings.push('GEMINI_API_KEY not set - AI features disabled');
    }
    
    if (!cfg.multiplayer.MULTIPLAYER_PASSPHRASE && cfg.server.NODE_ENV === 'production') {
        warnings.push('MULTIPLAYER_PASSPHRASE not set - multiplayer rooms are open to anyone with the room ID');
    }
    
    if (cfg.server.NODE_ENV === 'production' && cfg.cors.CORS_ORIGIN === '*') {
        warnings.push('CORS_ORIGIN is * in production - consider restricting to your domain');
    }
    
    return { valid: true, warnings };
}

export { ConfigSchema };