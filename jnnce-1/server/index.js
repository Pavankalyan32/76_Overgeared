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

// Proxies Gemini so the API key stays on the server and never reaches the browser.
app.post('/api/ai', async (req, res) => {
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

// Shared-object relay. ponytail: single global room, last write wins. Add a room
// id to the handshake and key this state by room when more than one session matters.
let latestState = null;
io.on('connection', (socket) => {
  if (latestState) socket.emit('state', latestState);
  socket.on('state', (state) => {
    const clean = sanitizeState(state);
    if (!clean) return;
    latestState = clean;
    socket.broadcast.emit('state', clean);
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

module.exports = { app, server, io, sanitizeState };
