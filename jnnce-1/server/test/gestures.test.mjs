// Tests for jnnce-1/gestures.js.
//
// These cannot prove the app feels good to use, which still needs a webcam and a
// person (issue #4). What they do prove is the two structural properties that
// were broken: classification must not depend on how far the hand is from the
// camera, and a pose sitting on a threshold must not flicker.
//
// Run with: npm test   (from jnnce-1/server)
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handSpan,
  palmCenter,
  fingerExtensions,
  pinchRatio,
  isFist,
  isOneFinger,
  isTwoFingers,
  isThreeFingers,
  THRESHOLDS,
} from '../../gestures.js';

import { makeHand, poses, SCALES, POSITIONS } from './hand-fixtures.mjs';

// ---------------------------------------------------------------- primitives

test('handSpan tracks apparent hand size', () => {
  const near = handSpan(poses.openPalm({ scale: 0.4 }));
  const far = handSpan(poses.openPalm({ scale: 0.1 }));
  assert.ok(near > far, 'a closer hand must measure a wider span');
  // Span is the knuckle line, which is 1 unit wide in fixture space.
  assert.ok(Math.abs(near / far - 4) < 0.01, 'span should scale linearly');
});

test('handSpan never returns zero', () => {
  // Every landmark collapsed onto one point, as a bad detection might report.
  const degenerate = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  assert.ok(handSpan(degenerate) > 0, 'must be floored to avoid dividing by zero');
  assert.ok(Number.isFinite(pinchRatio(degenerate)));
});

test('palmCenter sits inside the hand and ignores finger movement', () => {
  const open = poses.openPalm({ scale: 0.25 });
  const fist = poses.fist({ scale: 0.25 });
  const a = palmCenter(open);
  const b = palmCenter(fist);
  // Only the wrist and knuckles feed it, and those barely move between poses.
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.01, 'palm centre should be stable');
});

// ------------------------------------------------------- scale invariance (#5)

// This is the regression that mattered. Thresholds used to be compared against
// raw frame distances, so the same pose classified differently depending on how
// far away it was held.
const CASES = [
  ['fist', poses.fist, isFist],
  ['one finger', poses.oneFinger, isOneFinger],
  ['two fingers', poses.twoFingers, isTwoFingers],
  ['three fingers', poses.threeFingers, isThreeFingers],
];

for (const [name, pose, predicate] of CASES) {
  test(`${name} is recognised at every distance from the camera`, () => {
    for (const scale of SCALES) {
      assert.equal(
        predicate(pose({ scale }), false),
        true,
        `${name} should match at scale ${scale}`
      );
    }
  });

  test(`${name} is recognised anywhere in frame`, () => {
    for (const at of POSITIONS) {
      assert.equal(
        predicate(pose({ scale: 0.2, at }), false),
        true,
        `${name} should match at ${JSON.stringify(at)}`
      );
    }
  });
}

test('an open palm is never a fist, at any distance', () => {
  // The original bug: a hand far from the camera produced small raw distances,
  // so an open palm read as a fist, latched, and starved pinch and rotate.
  for (const scale of SCALES) {
    assert.equal(
      isFist(poses.openPalm({ scale }), false),
      false,
      `open palm misread as a fist at scale ${scale}`
    );
  }
});

test('a fist is not mistaken for a counted-finger gesture', () => {
  for (const scale of SCALES) {
    const hand = poses.fist({ scale });
    assert.equal(isOneFinger(hand, false), false, `at scale ${scale}`);
    assert.equal(isTwoFingers(hand, false), false, `at scale ${scale}`);
    assert.equal(isThreeFingers(hand, false), false, `at scale ${scale}`);
  }
});

test('counted-finger gestures do not overlap each other', () => {
  const one = poses.oneFinger({ scale: 0.22 });
  const two = poses.twoFingers({ scale: 0.22 });
  const three = poses.threeFingers({ scale: 0.22 });

  assert.equal(isTwoFingers(one, false), false, 'one finger must not read as two');
  assert.equal(isThreeFingers(one, false), false, 'one finger must not read as three');
  assert.equal(isOneFinger(two, false), false, 'two fingers must not read as one');
  assert.equal(isThreeFingers(two, false), false, 'two fingers must not read as three');
  assert.equal(isOneFinger(three, false), false, 'three fingers must not read as one');
  assert.equal(isTwoFingers(three, false), false, 'three fingers must not read as two');
});

test('a pinch is not a fist', () => {
  // A pinch curls nothing except bringing the thumb to the index tip. Reading it
  // as a fist would zoom the camera instead of scaling, and because fist latches
  // first the pinch could never recover.
  for (const scale of SCALES) {
    assert.equal(
      isFist(poses.pinch({ scale }), false),
      false,
      `pinch misread as a fist at scale ${scale}`
    );
  }
});

test('pinchRatio is scale invariant and separates pinched from open', () => {
  const ratios = SCALES.map((scale) => pinchRatio(poses.pinch({ scale })));
  for (const r of ratios) {
    assert.ok(Math.abs(r - ratios[0]) < 1e-9, 'pinch ratio must not vary with distance');
  }
  const open = pinchRatio(poses.openPalm({ scale: 0.2 }));
  assert.ok(open > ratios[0] * 2, 'an open hand must read far looser than a pinch');
});

// ------------------------------------------------------------- hysteresis (#5)

test('thresholds are ordered so there is a hysteresis band', () => {
  assert.ok(THRESHOLDS.fist.exit > THRESHOLDS.fist.enter, 'fist needs a band');
  assert.ok(
    THRESHOLDS.extended.exit < THRESHOLDS.extended.enter,
    'an extended finger should be easier to keep than to acquire'
  );
  assert.ok(
    THRESHOLDS.curled.exit > THRESHOLDS.curled.enter,
    'a curled finger should be easier to keep than to acquire'
  );
  assert.ok(
    THRESHOLDS.thumbCurled.exit > THRESHOLDS.thumbCurled.enter,
    'the thumb needs a band too'
  );
  assert.ok(
    THRESHOLDS.thumbCurled.enter > THRESHOLDS.curled.enter,
    'a tucked thumb sits further from the palm centre than a curled finger'
  );
});

test('a held fist survives a pose that would not have engaged it', () => {
  const ext = (hand) => {
    const e = fingerExtensions(hand);
    return (e.thumb + e.index + e.middle + e.ring + e.pinky) / 5;
  };

  // Find a curl sitting inside the hysteresis band: too loose to engage a fist,
  // loose enough that a held fist should persist.
  let inBand = null;
  for (let curl = 0.25; curl <= 0.9; curl += 0.01) {
    const hand = makeHand({ extended: [], curl, scale: 0.2 });
    const mean = ext(hand);
    if (mean > THRESHOLDS.fist.enter && mean < THRESHOLDS.fist.exit) {
      inBand = hand;
      break;
    }
  }
  assert.ok(inBand, 'expected some curl to land inside the hysteresis band');

  assert.equal(isFist(inBand, false), false, 'should not engage from idle');
  assert.equal(isFist(inBand, true), true, 'should stay engaged once held');
});

test('a fully open hand releases a held fist', () => {
  // Hysteresis must not mean a gesture can never be let go of.
  assert.equal(
    isFist(poses.openPalm({ scale: 0.2 }), true),
    false,
    'opening the hand must release the fist'
  );
});

test('hysteresis suppresses flicker that a single threshold would produce', () => {
  // Hold a hand at a curl that sits right on the engage threshold and jitter it,
  // the way a real detection wobbles between frames. A single threshold flips on
  // roughly half of those frames; a hysteresis band should barely move.
  const mean = (hand) => {
    const e = fingerExtensions(hand);
    return (e.thumb + e.index + e.middle + e.ring + e.pinky) / 5;
  };

  // Locate the curl whose mean extension sits closest to the engage threshold.
  let onEdge = 0.25;
  let best = Infinity;
  for (let c = 0.2; c <= 0.95; c += 0.005) {
    const d = Math.abs(mean(makeHand({ extended: [], curl: c, scale: 0.2 })) - THRESHOLDS.fist.enter);
    if (d < best) {
      best = d;
      onEdge = c;
    }
  }

  // Deterministic pseudo-noise, so this test cannot flake.
  let seed = 12345;
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed / 0x7fffffff) - 0.5) * 0.06;
  };

  let withBand = false;
  let single = false;
  let bandFlips = 0;
  let singleFlips = 0;

  for (let i = 0; i < 300; i++) {
    const hand = makeHand({ extended: [], curl: onEdge + jitter(), scale: 0.2 });

    const next = isFist(hand, withBand);
    if (next !== withBand) bandFlips += 1;
    withBand = next;

    // Same measurement, one fixed threshold and no memory.
    const naive = mean(hand) < THRESHOLDS.fist.enter;
    if (naive !== single) singleFlips += 1;
    single = naive;
  }

  assert.ok(singleFlips > 20, `expected the naive threshold to be unstable, saw ${singleFlips}`);
  assert.ok(
    bandFlips * 5 < singleFlips,
    `hysteresis should cut flicker sharply: band ${bandFlips} vs single ${singleFlips}`
  );
});

// --------------------------------------------------------------------- shape

test('classifiers tolerate a hand at the edge of frame', () => {
  // Landmarks can fall outside 0..1 when a hand is partly out of shot. This must
  // not throw or produce a nonsense answer.
  const hand = poses.twoFingers({ scale: 0.3, at: { x: 0.02, y: 0.95 } });
  assert.equal(typeof isTwoFingers(hand, false), 'boolean');
  assert.ok(Number.isFinite(handSpan(hand)));
});
