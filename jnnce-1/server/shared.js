// Shared State Module
// Common utilities and state shared across the server

// Room state keys that clients are allowed to sync
export const STATE_KEYS = ['s', 'rx', 'ry', 'px', 'py'];

// Accepts only the five finite numbers the client is allowed to sync, so a
// peer cannot broadcast arbitrary objects, NaN or Infinity to everyone else.
// Returns null when the payload is not usable.
export function sanitizeState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
    const clean = {};
    for (const key of STATE_KEYS) {
        const value = state[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        clean[key] = value;
    }
    return clean;
}

// Room ids come from clients, so they are used as Map keys and Socket.IO room
// names only after passing this. Conservative charset, bounded length.
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidRoom(room) {
    return typeof room === 'string' && ROOM_PATTERN.test(room);
}

// Optional shared secret. Unset by default so local development needs no setup;
// set it before exposing the port to anyone you would not hand the object to.
export function getMultiplayerPassphrase() {
    return process.env.MULTIPLAYER_PASSPHRASE || '';
}

// Legacy export for backwards compatibility
export const MULTIPLAYER_PASSPHRASE = process.env.MULTIPLAYER_PASSPHRASE || '';

// Clients emit at 20Hz. This is the server-side ceiling, because the client
// self-limiting is a courtesy a modified client can simply ignore.
export const STATE_RATE = {
    windowMs: Number(process.env.STATE_RATE_WINDOW_MS || 1000),
    max: Number(process.env.STATE_RATE_MAX || 40),
};

// One current state per room, rather than one for everybody. Rooms are deleted
// when the last member leaves so this cannot grow without bound.
export const roomState = new Map();

// Rate limiting for AI endpoint
const rateLimit = {
    windowMs: Number(process.env.AI_RATE_WINDOW_MS || 60_000),
    max: Number(process.env.AI_RATE_MAX || 10),
};

// ip -> ascending timestamps of calls still inside the window
const rateLimitHits = new Map();

// Sliding window rate limit check
export function checkRateLimit(ip, now = Date.now()) {
    const cutoff = now - rateLimit.windowMs;

    for (const [key, times] of rateLimitHits) {
        if (times[times.length - 1] <= cutoff) rateLimitHits.delete(key);
    }

    const times = (rateLimitHits.get(ip) || []).filter((t) => t > cutoff);
    if (times.length >= rateLimit.max) {
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((times[0] - cutoff) / 1000)) };
    }
    times.push(now);
    rateLimitHits.set(ip, times);
    return { allowed: true, remaining: rateLimit.max - times.length };
}

export function resetRateLimits() {
    rateLimitHits.clear();
}

export { rateLimit };