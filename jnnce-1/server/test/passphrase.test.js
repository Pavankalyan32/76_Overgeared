'use strict';

// The passphrase gate is installed at module load, so it needs its own file:
// `node --test` runs each file in a separate process, which lets this one import
// the server with MULTIPLAYER_PASSPHRASE set while the other suites see it unset.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');

const PHRASE = 'open-sesame';
process.env.MULTIPLAYER_PASSPHRASE = PHRASE;

const { server } = require('../index.js');

let url;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const open = (auth) =>
  connect(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });

const next = (socket, event, ms = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

test('a correct passphrase is admitted', async () => {
  const a = open({ room: 'secure', passphrase: PHRASE });
  try {
    assert.deepEqual(await next(a, 'joined'), { room: 'secure' });
  } finally {
    a.close();
  }
});

test('a missing passphrase is refused with a code the client can act on', async () => {
  const a = open({ room: 'secure' });
  try {
    const err = await next(a, 'connect_error');
    assert.match(err.message, /passphrase/i);
    // The client watches for this exact code before prompting the user.
    assert.equal(err.data && err.data.code, 'PASSPHRASE_REQUIRED');
  } finally {
    a.close();
  }
});

test('a wrong passphrase is refused', async () => {
  const a = open({ room: 'secure', passphrase: 'guess' });
  try {
    const err = await next(a, 'connect_error');
    assert.equal(err.data && err.data.code, 'PASSPHRASE_REQUIRED');
  } finally {
    a.close();
  }
});

test('the passphrase is checked before the room id', async () => {
  // Otherwise an unauthenticated caller could probe which room ids are valid.
  const a = open({ room: 'not a valid room' });
  try {
    const err = await next(a, 'connect_error');
    assert.equal(err.data && err.data.code, 'PASSPHRASE_REQUIRED');
  } finally {
    a.close();
  }
});
