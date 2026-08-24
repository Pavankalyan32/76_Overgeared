'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Client is served from this same origin, so no cross-origin allowance is needed.
const io = new Server(server);

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Screenshots arrive as base64 PNGs, so the JSON body is large by nature.
app.use(express.json({ limit: '12mb' }));

// Serve the frontend, which lives one level up.
app.use('/', express.static(path.join(__dirname, '..')));

// Tells the client whether AI features are usable, without exposing the key.
app.get('/api/ai/status', (_req, res) => {
  res.json({ enabled: Boolean(GEMINI_API_KEY), model: GEMINI_MODEL });
});

const MAX_IMAGES = 2;
const MAX_IMAGE_CHARS = 4_000_000; // ~3MB per decoded PNG
const MAX_PROMPT_CHARS = 20_000;

// Every /api/ai call spends upstream quota, so cap how often one client may ask.
// Mutable rather than const so tests can tighten the window without restarting.
const rateLimit = {
  windowMs: Number(process.env.AI_RATE_WINDOW_MS || 60_000),
  max: Number(process.env.AI_RATE_MAX || 10),
};

// ip -> ascending timestamps of calls still inside the window
const rateLimitHits = new Map();

// Sliding window. Counts requests before validation, so malformed payloads cannot
// be used to probe the endpoint for free.
// NOTE: keys on req.ip, which is the socket address unless `trust proxy` is set.
// Behind a reverse proxy, configure that or every client shares one bucket.
function checkRateLimit(ip, now = Date.now()) {
  const cutoff = now - rateLimit.windowMs;

  // ponytail: O(distinct recent IPs) sweep on every request keeps the map from
  // growing without bound. Fine at this scale; swap for a periodic timer or an
  // LRU if this ever fronts real traffic.
  for (const [key, times] of rateLimitHits) {
    if (times[times.length - 1] <= cutoff) rateLimitHits.delete(key);
  }

  const times = (rateLimitHits.get(ip) || []).filter((t) => t > cutoff);
  if (times.length >= rateLimit.max) {
    // Seconds until the oldest call in the window ages out.
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((times[0] - cutoff) / 1000)) };
  }
  times.push(now);
  rateLimitHits.set(ip, times);
  return { allowed: true, remaining: rateLimit.max - times.length };
}

function resetRateLimits() {
  rateLimitHits.clear();
}

// Proxies Gemini so the API key stays on the server and never reaches the browser.
app.post('/api/ai', async (req, res) => {
  const limit = checkRateLimit(req.ip);
  if (!limit.allowed) {
    res.set('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: `Too many AI requests. Try again in ${limit.retryAfter}s.`,
    });
  }

  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'AI is not configured. Set GEMINI_API_KEY in server/.env and restart the server.',
    });
  }

  // Validate at the trust boundary: this route spends money and quota.
  const { prompt, images } = req.body || {};
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'prompt must be a non-empty string.' });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(413).json({ error: `prompt exceeds ${MAX_PROMPT_CHARS} characters.` });
  }
  const imageList = images === undefined ? [] : images;
  if (!Array.isArray(imageList)) {
    return res.status(400).json({ error: 'images must be an array of base64 PNG strings.' });
  }
  if (imageList.length > MAX_IMAGES) {
    return res.status(400).json({ error: `at most ${MAX_IMAGES} images are allowed.` });
  }
  for (const img of imageList) {
    if (typeof img !== 'string' || img.length > MAX_IMAGE_CHARS) {
      return res.status(413).json({ error: 'each image must be a base64 string under 4MB.' });
    }
  }

  const parts = [{ text: prompt }];
  for (const data of imageList) {
    parts.push({ inlineData: { mimeType: 'image/png', data } });
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            maxOutputTokens: Number(process.env.GEMINI_MAX_TOKENS || 400),
            temperature: Number(process.env.GEMINI_TEMPERATURE || 0.3),
          },
        }),
        signal: AbortSignal.timeout(60_000),
      }
    );

    if (!upstream.ok) {
      // Log details server-side; return a generic message so upstream errors
      // can't leak key or account details to the browser.
      console.error('Gemini error', upstream.status, await upstream.text());
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
      return res.status(502).json({
        error: reason ? `Gemini returned no text (${reason}).` : 'Gemini returned no text.',
      });
    }
    return res.json({ text });
  } catch (err) {
    console.error('Gemini proxy error:', err);
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return res.status(504).json({ error: timedOut ? 'Gemini request timed out.' : 'Gemini request failed.' });
  }
});

const STATE_KEYS = ['s', 'rx', 'ry', 'px', 'py'];

// Accepts only the five finite numbers the client is allowed to sync, so a
// peer cannot broadcast arbitrary objects, NaN or Infinity to everyone else.
// Returns null when the payload is not usable.
function sanitizeState(state) {
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

function isValidRoom(room) {
  return typeof room === 'string' && ROOM_PATTERN.test(room);
}

// Optional shared secret. Unset by default so local development needs no setup;
// set it before exposing the port to anyone you would not hand the object to.
const MULTIPLAYER_PASSPHRASE = process.env.MULTIPLAYER_PASSPHRASE || '';

// Clients emit at 20Hz. This is the server-side ceiling, because the client
// self-limiting is a courtesy a modified client can simply ignore.
const STATE_RATE = {
  windowMs: Number(process.env.STATE_RATE_WINDOW_MS || 1000),
  max: Number(process.env.STATE_RATE_MAX || 40),
};

// One current state per room, rather than one for everybody. Rooms are deleted
// when the last member leaves so this cannot grow without bound.
const roomState = new Map();

if (MULTIPLAYER_PASSPHRASE) {
  io.use((socket, next) => {
    const given = socket.handshake.auth && socket.handshake.auth.passphrase;
    if (given === MULTIPLAYER_PASSPHRASE) return next();
    // The client checks for this exact code to know it should ask for the phrase.
    const err = new Error('passphrase required');
    err.data = { code: 'PASSPHRASE_REQUIRED' };
    next(err);
  });
}

io.on('connection', (socket) => {
  const requested = socket.handshake.auth && socket.handshake.auth.room;
  if (!isValidRoom(requested)) {
    socket.emit('room_error', { error: 'Invalid room id. Use 1-64 characters: A-Z a-z 0-9 _ -' });
    socket.disconnect(true);
    return;
  }
  const room = requested;
  socket.join(room);
  socket.emit('joined', { room });

  // Bring the newcomer in line with whatever the room is already showing.
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
    // Scoped to the room, so unrelated sessions no longer fight over one object.
    socket.to(room).emit('state', clean);
  });

  socket.on('disconnect', () => {
    // adapter room entry is gone by now if this was the last member
    if (!io.sockets.adapter.rooms.get(room)) roomState.delete(room);
  });
});

// Only listen when started directly, so tests can bind an ephemeral port.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Gesture3D server listening on http://localhost:${PORT}`);
    if (!GEMINI_API_KEY) {
      console.log('AI assistant disabled: no GEMINI_API_KEY found (see server/.env.example).');
    }
  });
}

module.exports = {
  app,
  server,
  io,
  sanitizeState,
  checkRateLimit,
  resetRateLimits,
  rateLimit,
  isValidRoom,
  roomState,
  STATE_RATE,
};
