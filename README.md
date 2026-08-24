# Tesseract — 3D Gesture Control Platform

[![CI](https://github.com/Pavankalyan32/76_Overgeared/actions/workflows/ci.yml/badge.svg)](https://github.com/Pavankalyan32/76_Overgeared/actions/workflows/ci.yml)

Control 3D models in the browser with webcam hand gestures. Three.js renders the
scene, MediaPipe Hands tracks the hand, and a small Express server serves the
frontend, relays shared state over Socket.IO, and proxies the AI assistant.

## Requirements

- Node.js 20.6 or newer (the server uses `--env-file-if-exists` and global `fetch`)
- A browser with WebGL support (Chrome, Edge, Firefox)
- A webcam, for gesture control only. Everything else works with mouse and keyboard.

## Setup

```bash
npm run setup     # installs server dependencies
npm start         # serves the app on http://localhost:3000
```

Then open <http://localhost:3000>.

Gesture tracking needs a secure context, which `localhost` counts as. If you serve
this from another host, use HTTPS or the browser will refuse camera access.

### Optional: enable the AI assistant

The assistant is off until you supply a Gemini API key. The key stays on the
server and is never sent to the browser.

```bash
cp jnnce-1/server/.env.example jnnce-1/server/.env
# then edit .env and set GEMINI_API_KEY=...
```

Get a key from [Google AI Studio](https://aistudio.google.com/app/apikey). Restart
the server afterwards. Without a key the app runs normally and the AI panel
reports that it is disabled.

`/api/ai` is rate limited to 10 requests per minute per IP, since each call can
upload two screenshots and spends upstream quota. Exceeding it returns `429` and
the chat panel shows how long to wait. Tune with `AI_RATE_MAX` and
`AI_RATE_WINDOW_MS` in `.env`. If you ever run this behind a reverse proxy, set
Express's `trust proxy` too, or every client will share a single bucket.

## Usage

`index.html` is the landing page; any card takes you to `app.html`, the actual
3D workspace. The home button in the navbar goes back.

### Gestures

| Gesture | Action |
| --- | --- |
| Pinch (thumb + index) | Scale the object |
| Open palm | Translate |
| Index finger movement | Rotate |
| Fist | Zoom in |
| Two fingers | Zoom out |
| Three fingers | Pan the viewport |
| Two hands | Distance scales, midpoint translates |

Two-hand gestures need the "Two-hand scale" box ticked, which asks MediaPipe to
track a second hand. It stays off by default because tracking two hands costs
frame rate. Translation, by hand or gesture, only moves the object when "Lock
center" is unticked; while it is on the object is held at the origin.

### Mouse and keyboard

Gestures are optional. The same controls are always available:

| Input | Action |
| --- | --- |
| Drag | Rotate |
| Shift-drag or right-drag | Move |
| Ctrl-drag | Scale |
| Scroll wheel | Zoom |

### Models

Pick a built-in primitive from the dropdown, load one of the bundled or remote
glTF samples, or import your own `.glb`, `.gltf`, `.obj` (with optional `.mtl`)
or `.stl` from disk or a URL. Imported models are recentred and normalised so
the scale control behaves consistently.

The "Globe" entry is a locally bundled glTF, so it works offline.

## Project layout

```
package.json              # convenience scripts that delegate to the server
LICENSE
jnnce-1/
  index.html              # landing page (self-contained styles and script)
  app.html                # the 3D workspace
  app.js                  # scene, gesture pipeline, model loading, AI client
  style.css               # styles for the workspace
  scene.gltf / scene.bin  # bundled "Globe" model
  textures/               # its texture
  server/
    index.js              # static hosting, Socket.IO relay, Gemini proxy
    test/api.test.js      # checks on the AI proxy and the state relay
    .env.example
```

## Tests

```bash
cd jnnce-1/server && npm test
```

These cover the `/api/ai` input validation, its rate limiter, and the multiplayer
state sanitiser, using Node's built-in test runner. No extra dependencies.

CI runs the same suite on Node 20, 22 and 24 for every push and pull request
against `main`, and separately parses `app.js` as an ES module. That last check
matters because the frontend has no build step, so nothing else would catch a
syntax error before it reaches a browser. See `.github/workflows/ci.yml`.

## Multiplayer

Ticking "Multiplayer" syncs object scale, rotation and position to every other
connected client.

**This relay is unauthenticated and has a single global room.** Anyone who can
reach the port can read and overwrite the shared state. It is fine on a trusted
local network; add authentication and per-room routing before exposing it to the
internet.

## Notes on AI features

The assistant captures the WebGL canvas plus the current webcam frame and sends
them, along with a snapshot of scene state, to Gemini for analysis. Nothing is
sent unless you explicitly ask a question or press one of the AI buttons. Voice
input uses the browser's Web Speech API, which in Chrome forwards audio to
Google for recognition.

## Technologies

Three.js 0.160 (via import map), MediaPipe Hands, Web Speech API, WebXR,
Express, Socket.IO, Google Gemini.

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">Made by Team Overgeared</p>
