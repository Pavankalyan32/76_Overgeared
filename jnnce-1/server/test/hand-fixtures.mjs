// Synthetic MediaPipe hand landmarks, for testing pose classification without a
// camera. Lives under server/test because that is where `npm test` runs; the code
// under test is the frontend module ../../gestures.js.
//
// MediaPipe emits 21 points per hand, normalised to the image frame:
//   0        wrist
//   1-4      thumb   (cmc, mcp, ip, tip)
//   5-8      index   (mcp, pip, dip, tip)
//   9-12     middle
//   13-16    ring
//   17-20    pinky
//
// A hand is built in a local space where the knuckle line is 1 unit wide and the
// palm sits at the origin, then scaled and translated into frame coordinates.
// `scale` stands in for distance from the camera: a small scale is a hand far
// away, which is exactly the condition that used to be misclassified.

const FINGER_ORDER = ['index', 'middle', 'ring', 'pinky'];

// x offsets of the four knuckles across a hand of unit width.
const MCP_X = { index: -0.5, middle: -0.17, ring: 0.17, pinky: 0.5 };
// Fingers differ in length; these are multiples of hand width.
const LENGTH = { index: 1.0, middle: 1.08, ring: 1.0, pinky: 0.8 };

/**
 * Build one hand.
 *
 * @param {object} opts
 * @param {string[]} opts.extended  fingers held straight up, e.g. ['index']
 * @param {boolean}  opts.thumbOut  thumb away from the palm rather than tucked
 * @param {number}   opts.pinch     0 tucks the thumb onto the index tip, 1 leaves
 *                                  it in its normal place. Values in between
 *                                  interpolate, which is how the hysteresis tests
 *                                  walk across a threshold.
 * @param {number}   opts.scale     apparent hand width in frame units
 * @param {object}   opts.at        centre of the hand in frame coordinates
 * @param {number}   opts.curl      how far curled fingers fold toward the palm
 */
export function makeHand({
  extended = [],
  thumbOut = false,
  pinch = 1,
  scale = 0.2,
  at = { x: 0.5, y: 0.5 },
  curl = 0.35,
} = {}) {
  const pts = new Array(21);
  const put = (i, x, y) => {
    // y is negated so that "up" in local space becomes a smaller y in frame
    // coordinates, matching how MediaPipe reports them.
    pts[i] = { x: at.x + x * scale, y: at.y - y * scale, z: 0 };
  };

  // Wrist sits below the knuckle line.
  put(0, 0, -0.9);

  for (const name of FINGER_ORDER) {
    const base = { index: 5, middle: 9, ring: 13, pinky: 17 }[name];
    const x = MCP_X[name];
    const len = LENGTH[name];
    const isUp = extended.includes(name);

    put(base, x, 0);
    if (isUp) {
      // Straight finger: joints march up from the knuckle.
      put(base + 1, x, len * 0.38);
      put(base + 2, x, len * 0.68);
      put(base + 3, x, len);
    } else {
      // Curled finger: the tip folds back down toward the palm centre, ending
      // `curl` above it, and pulls inward in x as a real finger does.
      put(base + 1, x, len * 0.3);
      put(base + 2, x * 0.6, len * 0.28);
      put(base + 3, x * 0.3, curl);
    }
  }

  // Thumb runs off the side of the hand rather than up it.
  const indexTip = { x: MCP_X.index * 0.3, y: curl };
  if (extended.includes('index')) {
    indexTip.x = MCP_X.index;
    indexTip.y = LENGTH.index;
  }

  const restThumb = thumbOut
    ? { x: -1.25, y: 0.35 }
    : { x: -0.62, y: 0.12 }; // tucked against the palm

  // pinch=0 puts the thumb tip on the index tip; pinch=1 leaves it at rest.
  const t = Math.min(1, Math.max(0, pinch));
  const thumbTip = {
    x: indexTip.x + (restThumb.x - indexTip.x) * t,
    y: indexTip.y + (restThumb.y - indexTip.y) * t,
  };

  put(1, -0.6, -0.55);
  put(2, -0.85, -0.2);
  put(3, (thumbTip.x + restThumb.x) / 2 * 0.9, (thumbTip.y - 0.1));
  put(4, thumbTip.x, thumbTip.y);

  return pts;
}

// Named poses, so tests read as intent rather than geometry.
export const poses = {
  fist: (o = {}) => makeHand({ extended: [], pinch: 1, curl: 0.25, ...o }),
  openPalm: (o = {}) =>
    makeHand({ extended: FINGER_ORDER, thumbOut: true, pinch: 1, ...o }),
  oneFinger: (o = {}) => makeHand({ extended: ['index'], pinch: 1, ...o }),
  twoFingers: (o = {}) => makeHand({ extended: ['index', 'middle'], pinch: 1, ...o }),
  threeFingers: (o = {}) =>
    makeHand({ extended: ['index', 'middle', 'ring'], pinch: 1, ...o }),
  // Thumb and index touching, other fingers relaxed but not fully curled.
  pinch: (o = {}) => makeHand({ extended: ['index'], pinch: 0, ...o }),
};

// Distances from the camera worth checking, as apparent hand widths in frame
// units. 0.10 is a hand well back from the camera, 0.45 is one filling the frame.
export const SCALES = [0.1, 0.15, 0.2, 0.3, 0.45];

// A few positions, to confirm classification does not depend on where in frame
// the hand happens to be.
export const POSITIONS = [
  { x: 0.5, y: 0.5 },
  { x: 0.25, y: 0.4 },
  { x: 0.75, y: 0.6 },
];
