'use strict';

// Checks the /api/ai trust boundary: this route spends API quota, so bad input
// must be rejected before anything is forwarded to Gemini.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

// A fake key makes the route validate instead of short-circuiting on 503.
// It is never used, because every request here is expected to fail validation.
process.env.GEMINI_API_KEY = 'test-key-never-sent-upstream';
// Raise the rate limit so the validation tests below, which make many calls from
// one address, are not throttled. The limiter gets its own tests further down.
process.env.AI_RATE_MAX = '1000';

const { server, rateLimit, resetRateLimits, checkRateLimit } = require('../index.js');

let base;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

// Keep tests independent of each other's request counts.
test.beforeEach(() => resetRateLimits());

const post = (body) =>
  fetch(`${base}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('reports AI as enabled without exposing the key', async () => {
  const res = await fetch(`${base}/api/ai/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, true);
  assert.ok(!JSON.stringify(body).includes('test-key'), 'status must not leak the key');
});

test('serves the frontend from the parent directory', async () => {
  const res = await fetch(`${base}/app.html`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Gesture3D/);
});

test('rejects bad prompts', async () => {
  for (const body of [{}, { prompt: '' }, { prompt: '   ' }, { prompt: 123 }, { prompt: null }]) {
    const res = await post(body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.match((await res.json()).error, /prompt/);
  }
});

test('rejects an over-long prompt', async () => {
  const res = await post({ prompt: 'x'.repeat(20_001) });
  assert.equal(res.status, 413);
});

test('rejects malformed image lists', async () => {
  for (const images of ['nope', 42, { 0: 'a' }]) {
    assert.equal((await post({ prompt: 'hi', images })).status, 400);
  }
});

test('rejects too many images', async () => {
  const res = await post({ prompt: 'hi', images: ['a', 'b', 'c'] });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at most 2/);
});

test('rejects non-string and oversized images', async () => {
  assert.equal((await post({ prompt: 'hi', images: [42] })).status, 413);
  assert.equal((await post({ prompt: 'hi', images: ['x'.repeat(4_000_001)] })).status, 413);
});

test('accepts a missing images field', async () => {
  // No images key is valid, so this passes validation and reaches the fake-key
  // upstream call, which fails. Anything other than 400/413 means it got through.
  const res = await post({ prompt: 'hi' });
  assert.ok(res.status !== 400 && res.status !== 413, `validation wrongly rejected: ${res.status}`);
});

test('multiplayer relay accepts only five finite numbers', () => {
  const { sanitizeState } = require('../index.js');
  const valid = { s: 1, rx: 0.5, ry: -0.5, px: 0, py: 2 };

  assert.deepEqual(sanitizeState(valid), valid);
  // Extra keys are dropped rather than relayed on to other peers.
  assert.deepEqual(sanitizeState({ ...valid, evil: '<script>' }), valid);

  for (const bad of [
    null,
    undefined,
    'string',
    [1, 2, 3, 4, 5],
    { s: 1 },                  // incomplete
    { ...valid, s: NaN },
    { ...valid, rx: Infinity },
    { ...valid, py: '3' },     // numeric string is still not a number
    { ...valid, px: null },
  ]) {
    assert.equal(sanitizeState(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

// The limiter is exercised directly as well as over HTTP, because passing an
// explicit clock lets us prove the window expires without sleeping for a minute.
test('rate limiter allows up to max calls then blocks', () => {
  const original = rateLimit.max;
  rateLimit.max = 3;
  try {
    const t = 1_000_000;
    assert.equal(checkRateLimit('1.2.3.4', t).allowed, true);
    assert.equal(checkRateLimit('1.2.3.4', t + 1).allowed, true);
    assert.equal(checkRateLimit('1.2.3.4', t + 2).allowed, true);

    const blocked = checkRateLimit('1.2.3.4', t + 3);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter >= 1, 'retryAfter must be a positive number of seconds');
  } finally {
    rateLimit.max = original;
  }
});

test('rate limiter is per IP, so one caller cannot lock out another', () => {
  const original = rateLimit.max;
  rateLimit.max = 2;
  try {
    const t = 2_000_000;
    checkRateLimit('10.0.0.1', t);
    checkRateLimit('10.0.0.1', t + 1);
    assert.equal(checkRateLimit('10.0.0.1', t + 2).allowed, false, 'first IP exhausted');
    assert.equal(checkRateLimit('10.0.0.2', t + 2).allowed, true, 'second IP unaffected');
  } finally {
    rateLimit.max = original;
  }
});

test('rate limiter forgets calls once the window passes', () => {
  const original = rateLimit.max;
  rateLimit.max = 1;
  try {
    const t = 3_000_000;
    assert.equal(checkRateLimit('172.16.0.1', t).allowed, true);
    assert.equal(checkRateLimit('172.16.0.1', t + 1).allowed, false, 'blocked inside the window');

    // One millisecond past the window the earlier call no longer counts.
    const after = t + rateLimit.windowMs + 1;
    assert.equal(checkRateLimit('172.16.0.1', after).allowed, true, 'allowed after expiry');
  } finally {
    rateLimit.max = original;
  }
});

test('POST /api/ai returns 429 with Retry-After once the limit is hit', async () => {
  const original = rateLimit.max;
  rateLimit.max = 2;
  try {
    // Invalid bodies are enough: the limiter runs before validation, so these
    // still count and no upstream call is made.
    assert.equal((await post({})).status, 400);
    assert.equal((await post({})).status, 400);

    const res = await post({});
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) >= 1, 'Retry-After header must be set');
    assert.match((await res.json()).error, /Too many AI requests/);
  } finally {
    rateLimit.max = original;
  }
});
