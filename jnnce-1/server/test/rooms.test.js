'use strict';

// Integration tests for the multiplayer relay (#8).
//
// The unit tests in api.test.js cover sanitizeState and room-id validation. These
// drive real Socket.IO clients, because the property that matters, that two rooms
// cannot see each other, only exists once the adapter and the join calls are
// involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');

const { server, roomState } = require('../index.js');

let url;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const open = (room) =>
  connect(url, { auth: { room }, transports: ['websocket'], forceNew: true });

// Resolves on the next `event`, or rejects if it does not arrive in time.
const next = (socket, event, ms = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

// Resolves true if `event` does NOT arrive within the window.
const silentFor = (socket, event, ms = 400) =>
  new Promise((resolve) => {
    let seen = false;
    const onEvent = () => { seen = true; };
    socket.once(event, onEvent);
    setTimeout(() => {
      socket.off(event, onEvent);
      resolve(!seen);
    }, ms);
  });

const SAMPLE = { s: 2, rx: 0.25, ry: -0.5, px: 1, py: -1 };

test('a client is told which room it joined', async () => {
  const a = open('alpha');
  try {
    assert.deepEqual(await next(a, 'joined'), { room: 'alpha' });
  } finally {
    a.close();
  }
});

test('peers in the same room receive each other state', async () => {
  const a = open('shared');
  const b = open('shared');
  try {
    await Promise.all([next(a, 'joined'), next(b, 'joined')]);

    const incoming = next(b, 'state');
    a.emit('state', SAMPLE);
    assert.deepEqual(await incoming, SAMPLE);
  } finally {
    a.close();
    b.close();
  }
});

test('a sender does not receive its own state back', async () => {
  const a = open('echo');
  try {
    await next(a, 'joined');
    a.emit('state', SAMPLE);
    assert.equal(await silentFor(a, 'state'), true, 'state must not echo to the sender');
  } finally {
    a.close();
  }
});

test('rooms are isolated from each other', async () => {
  // The headline fix: before this, every client shared one global object.
  const a = open('room-one');
  const b = open('room-two');
  try {
    await Promise.all([next(a, 'joined'), next(b, 'joined')]);

    a.emit('state', SAMPLE);
    assert.equal(
      await silentFor(b, 'state'),
      true,
      'a client in another room must not receive this state'
    );
  } finally {
    a.close();
    b.close();
  }
});

test('joining a room in progress catches you up to its current state', async () => {
  const a = open('catchup');
  try {
    await next(a, 'joined');
    a.emit('state', SAMPLE);
    // Give the server a moment to record it.
    await new Promise((r) => setTimeout(r, 100));

    const b = open('catchup');
    try {
      // The server sends `joined` and the catch-up `state` back to back, so both
      // listeners must be attached before either can arrive.
      const joined = next(b, 'joined');
      const caughtUp = next(b, 'state');
      await joined;
      assert.deepEqual(await caughtUp, SAMPLE);
    } finally {
      b.close();
    }
  } finally {
    a.close();
  }
});

test('malformed state is not relayed', async () => {
  const a = open('garbage');
  const b = open('garbage');
  try {
    await Promise.all([next(a, 'joined'), next(b, 'joined')]);

    for (const bad of [
      null,
      'string',
      { s: 1 },
      { ...SAMPLE, s: 'big' },
      { ...SAMPLE, rx: null },
      [1, 2, 3, 4, 5],
    ]) {
      a.emit('state', bad);
    }
    assert.equal(await silentFor(b, 'state'), true, 'nothing malformed should reach a peer');
  } finally {
    a.close();
    b.close();
  }
});

test('extra keys are stripped rather than relayed', async () => {
  const a = open('extras');
  const b = open('extras');
  try {
    await Promise.all([next(a, 'joined'), next(b, 'joined')]);

    const incoming = next(b, 'state');
    a.emit('state', { ...SAMPLE, evil: '<script>', nested: { a: 1 } });
    const got = await incoming;
    assert.deepEqual(got, SAMPLE);
    assert.equal(got.evil, undefined);
    assert.equal(got.nested, undefined);
  } finally {
    a.close();
    b.close();
  }
});

test('an invalid room id is rejected and the socket closed', async () => {
  const a = open('not a valid room');
  try {
    const err = await next(a, 'room_error');
    assert.match(err.error, /Invalid room id/);
    // The server disconnects rather than leaving a socket in limbo.
    if (a.connected) await next(a, 'disconnect');
    assert.equal(a.connected, false);
  } finally {
    a.close();
  }
});

test('room state is discarded once the last member leaves', async () => {
  const a = open('ephemeral');
  await next(a, 'joined');
  a.emit('state', SAMPLE);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(roomState.get('ephemeral'), SAMPLE, 'state should be held while occupied');

  a.close();
  // Otherwise every room ever visited would be retained for the process lifetime.
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(roomState.has('ephemeral'), false, 'state should be released when empty');
});

test('a flood of updates is throttled rather than relayed in full', async () => {
  const a = open('flood');
  const b = open('flood');
  try {
    await Promise.all([next(a, 'joined'), next(b, 'joined')]);

    let received = 0;
    b.on('state', () => { received += 1; });

    // Far above the 20Hz a well behaved client sends.
    for (let i = 0; i < 400; i++) a.emit('state', { ...SAMPLE, rx: i / 400 });
    await new Promise((r) => setTimeout(r, 600));

    assert.ok(received > 0, 'some updates should get through');
    assert.ok(received < 400, `expected throttling, relayed all ${received}`);
  } finally {
    a.close();
    b.close();
  }
});
