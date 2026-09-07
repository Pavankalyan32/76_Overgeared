// Health Check Module
// Provides /health endpoint with system status

import { roomState } from './index.js';

let startTime = Date.now();

export function getHealth() {
    const now = Date.now();
    const uptime = now - startTime;
    
    let totalClients = 0;
    const rooms = [];
    
    // roomState is a Map<roomId, state>
    for (const [roomId, state] of roomState.entries()) {
        rooms.push({
            id: roomId,
            hasState: !!state,
            scale: state?.s ?? null,
            updated: state ? 'recent' : 'none'
        });
        // Note: actual connected client count would require Socket.IO adapter access
        // For now we report room count
    }
    
    const mem = process.memoryUsage();
    
    return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime / 1000), // seconds
        uptimeHuman: formatUptime(uptime),
        version: process.env.npm_package_version || '1.0.0',
        node: process.version,
        platform: process.platform,
        memory: {
            rss: Math.round(mem.rss / 1024 / 1024), // MB
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            external: Math.round(mem.external / 1024 / 1024)
        },
        rooms: {
            count: rooms.length,
            list: rooms
        },
        ai: {
            enabled: Boolean(process.env.GEMINI_API_KEY),
            model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
        },
        multiplayer: {
            passphraseEnabled: Boolean(process.env.MULTIPLAYER_PASSPHRASE)
        }
    };
}

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

export function createHealthMiddleware() {
    return (req, res) => {
        const health = getHealth();
        // Always return 200 for health checks, details in body
        res.json(health);
    };
}