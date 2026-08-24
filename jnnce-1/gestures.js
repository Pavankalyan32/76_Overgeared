// Hand pose classification, as pure functions of MediaPipe landmarks.
//
// Deliberately free of three.js and DOM references so it can be unit tested in
// Node. app.js owns everything stateful: camera moves, latched gesture state,
// rendering. This file only answers "what shape is this hand".
//
// Two properties matter here and neither held before:
//
// 1. Scale invariance. MediaPipe normalises landmarks to the image frame, not to
//    the hand, so a hand far from the camera produces smaller distances between
//    landmarks than the same pose held close. Comparing raw distances against
//    fixed thresholds therefore classified by distance-to-camera as much as by
//    pose: a distant open hand read as a fist. Everything below divides by hand
//    span first, the same reference the pinch path already used.
//
// 2. Hysteresis. A single threshold flickers when a measurement sits on the
//    boundary, and because app.js latches these gestures and returns early, a
//    flickering fist starved pinch and rotate of any chance to run. Each
//    predicate takes the caller's current latched state and applies a stricter
//    threshold to engage than to stay engaged.

// MediaPipe hand landmark indices.
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
};

// Distances are expressed as multiples of hand span, so these are ratios rather
// than image-frame units. `enter` is required to engage a gesture, `exit` to keep
// it: the gap between them is the hysteresis band.
//
// NOTE: these values are converted from the previous raw thresholds (0.08, 0.15,
// 0.12) assuming a mid-distance hand span of roughly 0.18, so the geometry is
// right but the exact numbers still want calibrating against real hands. See
// issue #4.
export const THRESHOLDS = {
  // Mean fingertip distance from palm centre, across all five digits.
  fist: { enter: 0.58, exit: 0.70 },
  // Per finger, for the four fingers.
  extended: { enter: 0.85, exit: 0.72 },
  curled: { enter: 0.68, exit: 0.80 },
  // The thumb needs its own, looser bound. It opposes the palm rather than
  // folding onto it, so even a fully tucked thumb tip stays laterally displaced
  // from the palm centre and reads much further out than a curled finger does.
  // Sharing one threshold with the fingers, as the original code did, made every
  // counted-finger gesture impossible to trigger.
  thumbCurled: { enter: 0.85, exit: 0.97 },
  // Vertical slack allowed on "pointing up" once a gesture is already held.
  pointingUpSlack: 0.15,
};

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Mean of the wrist and the four knuckles. Stable under finger movement, which
// is what makes it a usable origin for measuring finger extension.
export function palmCenter(landmarks) {
  const pts = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0;
  let y = 0;
  for (const i of pts) {
    x += landmarks[i].x;
    y += landmarks[i].y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

// Width of the knuckle line, used as the unit for every other measurement.
// Floored so a degenerate detection cannot divide by zero.
export function handSpan(landmarks) {
  return Math.max(0.001, distance(landmarks[LM.INDEX_MCP], landmarks[LM.PINKY_MCP]));
}

// How far each fingertip sits from the palm centre, in hand spans.
export function fingerExtensions(landmarks) {
  const palm = palmCenter(landmarks);
  const span = handSpan(landmarks);
  return {
    thumb: distance(landmarks[LM.THUMB_TIP], palm) / span,
    index: distance(landmarks[LM.INDEX_TIP], palm) / span,
    middle: distance(landmarks[LM.MIDDLE_TIP], palm) / span,
    ring: distance(landmarks[LM.RING_TIP], palm) / span,
    pinky: distance(landmarks[LM.PINKY_TIP], palm) / span,
  };
}

// Thumb-to-index distance in hand spans. Small means pinching.
export function pinchRatio(landmarks) {
  return distance(landmarks[LM.THUMB_TIP], landmarks[LM.INDEX_TIP]) / handSpan(landmarks);
}

function limits(wasActive) {
  const k = wasActive ? 'exit' : 'enter';
  return {
    fist: THRESHOLDS.fist[k],
    extended: THRESHOLDS.extended[k],
    curled: THRESHOLDS.curled[k],
    thumbCurled: THRESHOLDS.thumbCurled[k],
  };
}

// y grows downward in image coordinates, so "up" means a smaller y than the
// knuckle. Held gestures get a little slack to stop borderline poses flickering.
function pointingUp(landmarks, tipIndex, mcpIndex, wasActive) {
  const slack = wasActive ? THRESHOLDS.pointingUpSlack * handSpan(landmarks) : 0;
  return landmarks[tipIndex].y < landmarks[mcpIndex].y + slack;
}

const FINGERS = {
  index: { tip: LM.INDEX_TIP, mcp: LM.INDEX_MCP },
  middle: { tip: LM.MIDDLE_TIP, mcp: LM.MIDDLE_MCP },
  ring: { tip: LM.RING_TIP, mcp: LM.RING_MCP },
  pinky: { tip: LM.PINKY_TIP, mcp: LM.PINKY_MCP },
};

// All five digits drawn in toward the palm.
export function isFist(landmarks, wasActive = false) {
  const ext = fingerExtensions(landmarks);
  const mean = (ext.thumb + ext.index + ext.middle + ext.ring + ext.pinky) / 5;
  return mean < limits(wasActive).fist;
}

// Shared shape for the counted-finger gestures: the named fingers extended and
// pointing up, every other digit curled.
function countedFingers(landmarks, wasActive, upNames) {
  const ext = fingerExtensions(landmarks);
  const lim = limits(wasActive);
  const up = new Set(upNames);

  if (ext.thumb >= lim.thumbCurled) return false;

  for (const name of Object.keys(FINGERS)) {
    if (up.has(name)) {
      if (ext[name] <= lim.extended) return false;
      if (!pointingUp(landmarks, FINGERS[name].tip, FINGERS[name].mcp, wasActive)) return false;
    } else if (ext[name] >= lim.curled) {
      return false;
    }
  }
  return true;
}

// Index only.
export function isOneFinger(landmarks, wasActive = false) {
  return countedFingers(landmarks, wasActive, ['index']);
}

// Index and middle.
export function isTwoFingers(landmarks, wasActive = false) {
  return countedFingers(landmarks, wasActive, ['index', 'middle']);
}

// Index, middle and ring.
export function isThreeFingers(landmarks, wasActive = false) {
  return countedFingers(landmarks, wasActive, ['index', 'middle', 'ring']);
}

// Everything the debug overlay wants, without it needing to know the maths.
export function describeHand(landmarks, wasActive = false) {
  const ext = fingerExtensions(landmarks);
  return {
    span: Number(handSpan(landmarks).toFixed(4)),
    extensions: Object.fromEntries(
      Object.entries(ext).map(([k, v]) => [k, Number(v.toFixed(3))])
    ),
    meanExtension: Number(
      ((ext.thumb + ext.index + ext.middle + ext.ring + ext.pinky) / 5).toFixed(3)
    ),
    pinchRatio: Number(pinchRatio(landmarks).toFixed(3)),
    thresholds: limits(wasActive),
    fist: isFist(landmarks, wasActive),
    oneFinger: isOneFinger(landmarks, wasActive),
    twoFingers: isTwoFingers(landmarks, wasActive),
    threeFingers: isThreeFingers(landmarks, wasActive),
  };
}
