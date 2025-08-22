'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*'} });

// Serve static files for demo (frontend lives one level up)
app.use('/', express.static(path.join(__dirname, '..')));

let latestState = null;
io.on('connection', (socket) => {
  socket.emit('state', latestState);
  socket.on('state', (state) => {
    latestState = state;
    socket.broadcast.emit('state', state);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Gesture3D server listening on http://localhost:${PORT}`));



