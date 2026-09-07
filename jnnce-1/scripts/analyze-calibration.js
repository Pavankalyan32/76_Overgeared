// Calibration Data Analyzer
// Computes optimal enter/exit thresholds for each gesture pose using ROC analysis

import fs from 'fs';
import path from 'path';

function analyzeCalibration(calibrationFile) {
    const raw = fs.readFileSync(calibrationFile, 'utf-8');
    const data = JSON.parse(raw);

    console.log('=== Gesture Calibration Analysis ===');
    console.log(`Version: ${data.version}`);
    console.log(`Timestamp: ${data.timestamp}`);
    console.log(`Target samples per pose: ${data.targetSamplesPerPose}`);
    console.log('');

    const POSES = data.poses;
    const DISTANCES = data.distances;

    // For each pose, collect all measurements across distances
    const poseMetrics = {};

    for (const pose of POSES) {
        poseMetrics[pose] = {
            fist: { meanExt: [], pinchRatio: [], indexMiddleSpread: [] },
            openPalm: { meanExt: [], pinchRatio: [], indexMiddleSpread: [] },
            oneFinger: { meanExt: [], pinchRatio: [], indexMiddleSpread: [], indexExt: [], middleExt: [], ringExt: [], pinkyExt: [], thumbExt: [] },
            twoFingers: { meanExt: [], pinchRatio: [], indexMiddleSpread: [], indexExt: [], middleExt: [], ringExt: [], pinkyExt: [], thumbExt: [] },
            threeFingers: { meanExt: [], pinchRatio: [], indexMiddleSpread: [], indexExt: [], middleExt: [], ringExt: [], pinkyExt: [], thumbExt: [] },
        }[pose] || { meanExt: [], pinchRatio: [], indexMiddleSpread: [] };

        // Also collect per-finger extensions for counted-finger poses
        if (['oneFinger', 'twoFingers', 'threeFingers'].includes(pose)) {
            poseMetrics[pose].fingerExts = { index: [], middle: [], ring: [], pinky: [], thumb: [] };
        }
    }

    // Process all samples
    for (const pose of POSES) {
        for (const dist of DISTANCES) {
            const samples = data.data[pose][dist];
            for (const sample of samples) {
                const landmarks = sample.landmarks;
                const exts = sample.fingerExtensions;
                const meanExt = (exts.thumb + exts.index + exts.middle + exts.ring + exts.pinky) / 5;
                const pinch = sample.pinchRatio;
                const span = sample.handSpan;

                // Index-middle spread
                const indexTip = landmarks[8];
                const middleTip = landmarks[12];
                const indexMiddleSpread = Math.hypot(indexTip.x - middleTip.x, indexTip.y - middleTip.y) / span;

                poseMetrics[pose].meanExt.push(meanExt);
                poseMetrics[pose].pinchRatio.push(pinch);
                poseMetrics[pose].indexMiddleSpread.push(indexMiddleSpread);

                if (['oneFinger', 'twoFingers', 'threeFingers'].includes(pose)) {
                    poseMetrics[pose].fingerExts.index.push(exts.index);
                    poseMetrics[pose].fingerExts.middle.push(exts.middle);
                    poseMetrics[pose].fingerExts.ring.push(exts.ring);
                    poseMetrics[pose].fingerExts.pinky.push(exts.pinky);
                    poseMetrics[pose].fingerExts.thumb.push(exts.thumb);
                }
            }
        }
    }

    // Compute statistics for each pose
    const results = {};

    for (const pose of POSES) {
        const m = poseMetrics[pose];
        const stats = {};

        // Helper: compute percentiles
        function percentile(arr, p) {
            if (!arr.length) return 0;
            const sorted = [...arr].sort((a, b) => a - b);
            const idx = Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length));
            return sorted[idx];
        }

        function mean(arr) {
            return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        }

        function std(arr) {
            if (!arr.length) return 0;
            const m = mean(arr);
            return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
        }

        stats.meanExt = { mean: mean(m.meanExt), std: std(m.meanExt), p5: percentile(m.meanExt, 5), p95: percentile(m.meanExt, 95), count: m.meanExt.length };
        stats.pinchRatio = { mean: mean(m.pinchRatio), std: std(m.pinchRatio), p5: percentile(m.pinchRatio, 5), p95: percentile(m.pinchRatio, 95), count: m.pinchRatio.length };
        stats.indexMiddleSpread = { mean: mean(m.indexMiddleSpread), std: std(m.indexMiddleSpread), p5: percentile(m.indexMiddleSpread, 5), p95: percentile(m.indexMiddleSpread, 95), count: m.indexMiddleSpread.length };

        if (m.fingerExts) {
            stats.fingerExts = {};
            for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
                const arr = m.fingerExts[finger];
                stats.fingerExts[finger] = { mean: mean(arr), std: std(arr), p5: percentile(arr, 5), p95: percentile(arr, 95), count: arr.length };
            }
        }

        results[pose] = stats;
    }

    // Print statistics
    console.log('=== Per-Pose Statistics ===');
    for (const pose of POSES) {
        const s = results[pose];
        console.log(`\n${pose.toUpperCase()} (${s.meanExt.count} samples):`);
        console.log(`  Mean Extension:  μ=${s.meanExt.mean.toFixed(4)} σ=${s.meanExt.std.toFixed(4)} [p5=${s.meanExt.p5.toFixed(4)}, p95=${s.meanExt.p95.toFixed(4)}]`);
        console.log(`  Pinch Ratio:     μ=${s.pinchRatio.mean.toFixed(4)} σ=${s.pinchRatio.std.toFixed(4)} [p5=${s.pinchRatio.p5.toFixed(4)}, p95=${s.pinchRatio.p95.toFixed(4)}]`);
        console.log(`  Index-Mid Spread: μ=${s.indexMiddleSpread.mean.toFixed(4)} σ=${s.indexMiddleSpread.std.toFixed(4)} [p5=${s.indexMiddleSpread.p5.toFixed(4)}, p95=${s.indexMiddleSpread.p95.toFixed(4)}]`);
        if (s.fingerExts) {
            for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
                const f = s.fingerExts[finger];
                console.log(`  ${finger.padEnd(6)} Ext:  μ=${f.mean.toFixed(4)} σ=${f.std.toFixed(4)} [p5=${f.p5.toFixed(4)}, p95=${f.p95.toFixed(4)}]`);
            }
        }
    }

    // Compute optimal thresholds using percentile-based approach
    // For hysteresis: enter = stricter threshold, exit = looser threshold
    // We want to separate each pose from the others

    console.log('\n=== Threshold Recommendations ===');

    // Fist: low mean extension (all fingers curled)
    // Enter: meanExt below some percentile of fist distribution
    // Exit: meanExt above some percentile (hysteresis)
    const fistMeanExt = results.fist.meanExt;
    const openMeanExt = results.openPalm.meanExt;

    // Fist thresholds: engage when meanExt is LOW, disengage when HIGH
    const fistEnter = fistMeanExt.p5;  // 5th percentile of fist = very tight
    const fistExit = fistMeanExt.p95;  // 95th percentile of fist = loose fist
    // But exit should be below open palm's p5 to avoid overlap
    const openP5 = openMeanExt.p5;
    const fistExitClamped = Math.min(fistExit, openP5 * 0.9);

    console.log('\nFIST:');
    console.log(`  enter (engage):  ${fistEnter.toFixed(4)}  (p5 of fist)`);
    console.log(`  exit (disengage): ${fistExitClamped.toFixed(4)}  (min of fist p95, openPalm p5 * 0.9)`);

    // Counted-finger poses: need extended fingers + curled others
    // Use per-finger extensions
    for (const pose of ['oneFinger', 'twoFingers', 'threeFingers']) {
        const s = results[pose];
        const upFingers = pose === 'oneFinger' ? ['index'] :
                          pose === 'twoFingers' ? ['index', 'middle'] :
                          ['index', 'middle', 'ring'];
        const downFingers = ['index', 'middle', 'ring', 'pinky'].filter(f => !upFingers.includes(f));

        // Extended threshold: p5 of extended fingers (must be at least this extended)
        let extEnter = Infinity;
        for (const f of upFingers) {
            extEnter = Math.min(extEnter, s.fingerExts[f].p5);
        }
        // Curled threshold: p95 of curled fingers (must be at most this curled)
        let curlExit = -Infinity;
        for (const f of downFingers) {
            curlExit = Math.max(curlExit, s.fingerExts[f].p95);
        }
        // Hysteresis: enter is stricter, exit is looser
        const extExit = Math.min(...upFingers.map(f => s.fingerExts[f].p50 || s.fingerExts[f].mean));
        const curlEnter = Math.max(...downFingers.map(f => s.fingerExts[f].p95));

        console.log(`\n${pose.toUpperCase()}:`);
        console.log(`  Extended fingers: ${upFingers.join(', ')}`);
        console.log(`  Curled fingers: ${downFingers.join(', ')}`);
        console.log(`  extended.enter: ${extEnter.toFixed(4)} (min p5 of up fingers)`);
        console.log(`  extended.exit:  ${extExit.toFixed(4)} (mean of up fingers)`);
        console.log(`  curled.enter:   ${curlEnter.toFixed(4)} (max p95 of down fingers)`);
        console.log(`  curled.exit:    ${curlExit.toFixed(4)} (min p95 of down fingers)`);

        // Thumb threshold (separate, looser)
        const thumb = s.fingerExts.thumb;
        console.log(`  thumbCurled.enter: ${thumb.p95.toFixed(4)} (p95 of thumb in this pose)`);
        console.log(`  thumbCurled.exit:  ${thumb.p5.toFixed(4)} (p5 of thumb in this pose)`);
    }

    // Pinch thresholds (from pinch pose)
    const pinchStats = results.pinch || results.oneFinger; // pinch samples might be in oneFinger
    // Actually we need dedicated pinch data. Let's check if there's a pinch pose...
    // The calibration uses these 5 poses, no dedicated pinch. Pinch is derived from oneFinger with thumb near index.
    // We'll use the oneFinger pinchRatio distribution
    const pinchRatio = results.oneFinger.pinchRatio;
    console.log('\nPINCH (from oneFinger samples):');
    console.log(`  pinchRatio p5: ${pinchRatio.p5.toFixed(4)} (tight pinch)`);
    console.log(`  pinchRatio p95: ${pinchRatio.p95.toFixed(4)} (loose pinch)`);
    const pinchEnter = pinchRatio.p5;
    const pinchExit = pinchRatio.p95;
    console.log(`  Recommended PINCH.start: ${pinchEnter.toFixed(4)}`);
    console.log(`  Recommended PINCH.end:   ${pinchExit.toFixed(4)}`);

    // Open palm: high mean extension, high index-middle spread
    console.log('\nOPEN PALM (for reference):');
    console.log(`  meanExt p5: ${openMeanExt.p5.toFixed(4)}`);
    console.log(`  indexMiddleSpread p5: ${results.openPalm.indexMiddleSpread.p5.toFixed(4)}`);

    // Generate thresholds object for gestures.js
    const thresholds = {
        fist: {
            enter: Number(fistEnter.toFixed(4)),
            exit: Number(fistExitClamped.toFixed(4))
        },
        extended: {
            enter: Number(results.oneFinger.fingerExts.index.p5.toFixed(4)), // use oneFinger as baseline
            exit: Number(results.oneFinger.fingerExts.index.mean.toFixed(4))
        },
        curled: {
            enter: Number(Math.max(
                results.oneFinger.fingerExts.middle.p95,
                results.oneFinger.fingerExts.ring.p95,
                results.oneFinger.fingerExts.pinky.p95
            ).toFixed(4)),
            exit: Number(Math.min(
                results.oneFinger.fingerExts.middle.p95,
                results.oneFinger.fingerExts.ring.p95,
                results.oneFinger.fingerExts.pinky.p95
            ).toFixed(4))
        },
        thumbCurled: {
            enter: Number(results.oneFinger.fingerExts.thumb.p95.toFixed(4)),
            exit: Number(results.oneFinger.fingerExts.thumb.p5.toFixed(4))
        },
        pointingUpSlack: 0.15 // keep existing
    };

    console.log('\n=== Generated THRESHOLDS for gestures.js ===');
    console.log('export const THRESHOLDS = ' + JSON.stringify(thresholds, null, 2) + ';');

    // Save analysis results
    const outputFile = calibrationFile.replace('.json', '-analysis.json');
    fs.writeFileSync(outputFile, JSON.stringify({
        sourceFile: calibrationFile,
        analyzedAt: new Date().toISOString(),
        statistics: results,
        recommendedThresholds: thresholds
    }, null, 2));
    console.log(`\nAnalysis saved to: ${outputFile}`);

    return { statistics: results, recommendedThresholds: thresholds };
}

// CLI usage
const file = process.argv[2];
if (!file) {
    console.error('Usage: node analyze-calibration.js <calibration-file.json>');
    process.exit(1);
}
analyzeCalibration(file);