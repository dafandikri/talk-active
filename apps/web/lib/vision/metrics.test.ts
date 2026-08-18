import assert from "node:assert/strict";
import test from "node:test";
import {
  InterviewMetricsAccumulator,
  PresentationMetricsAccumulator,
  isPresentationFramed,
  median,
} from "./metrics.ts";
import type { VisionLandmark } from "./types.ts";

function faceLandmarks(noseX = 0.5): VisionLandmark[] {
  const landmarks = Array.from({ length: 478 }, (_, index) => ({
    x: 0.4 + (index % 20) * 0.01,
    y: 0.28 + (index % 25) * 0.012,
    z: 0,
  }));
  landmarks[1] = { x: noseX, y: 0.48, z: 0 };
  landmarks[33] = { x: 0.43, y: 0.42, z: 0 };
  landmarks[263] = { x: 0.57, y: 0.42, z: 0 };
  return landmarks;
}

function poseLandmarks(hipCenterX = 0.5): VisionLandmark[] {
  const points: VisionLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95,
  }));
  points[11] = { x: hipCenterX - 0.1, y: 0.3, visibility: 0.95 };
  points[12] = { x: hipCenterX + 0.1, y: 0.3, visibility: 0.95 };
  points[15] = { x: hipCenterX - 0.15, y: 0.48, visibility: 0.95 };
  points[16] = { x: hipCenterX + 0.15, y: 0.48, visibility: 0.95 };
  points[23] = { x: hipCenterX - 0.07, y: 0.56, visibility: 0.95 };
  points[24] = { x: hipCenterX + 0.07, y: 0.56, visibility: 0.95 };
  points[25] = { x: hipCenterX - 0.06, y: 0.72, visibility: 0.95 };
  points[26] = { x: hipCenterX + 0.06, y: 0.72, visibility: 0.95 };
  points[27] = { x: hipCenterX - 0.06, y: 0.92, visibility: 0.95 };
  points[28] = { x: hipCenterX + 0.06, y: 0.92, visibility: 0.95 };
  return points;
}

test("median handles odd and even sets", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("interview accumulator calibrates before reporting head direction", () => {
  const metrics = new InterviewMetricsAccumulator(1_000);
  assert.equal(metrics.addFrame(0, faceLandmarks()).cameraFacing, null);
  assert.equal(metrics.addFrame(500, faceLandmarks()).cameraFacing, null);
  assert.equal(metrics.addFrame(1_000, faceLandmarks()).cameraFacing, true);
  assert.equal(metrics.addFrame(1_500, faceLandmarks(0.58)).cameraFacing, false);
  assert.equal(metrics.addFrame(3_100, faceLandmarks(0.58)).cameraFacing, false);

  const summary = metrics.finish(3_100);
  assert.equal(summary.metrics.trackingCoveragePercent, 100);
  assert.equal(summary.metrics.cameraFacingPercent, 33);
  assert.equal(summary.events[0]?.kind, "head_turned_away");
});

test("presentation accumulator reports body coverage and position changes", () => {
  const metrics = new PresentationMetricsAccumulator(1_000);
  metrics.addFrame(0, poseLandmarks());
  metrics.addFrame(500, poseLandmarks());
  metrics.addFrame(1_000, poseLandmarks());
  metrics.addFrame(2_600, poseLandmarks(0.7));
  metrics.addFrame(4_200, poseLandmarks(0.5));

  const summary = metrics.finish(4_300);
  assert.equal(summary.metrics.trackingCoveragePercent, 100);
  assert.equal(summary.metrics.fullBodyVisiblePercent, 100);
  assert.equal(summary.metrics.positionChangeCount, 2);
  assert.ok(summary.metrics.lateralMovementRangeShoulderWidths >= 1);
});


// Presentation framing required BOTH knees and BOTH ankles in shot, because
// framedFrames was fed from fullBodyVisiblePercent. A presenter standing close
// enough to be read — head to waist — scored 0% framing coverage and lost
// visual score for it.
//
// Half body is the shot this product is actually used in: a laptop on a desk,
// a person standing behind it. Framing should mean "you are in shot and not
// at the edge", not "your feet are visible".
test("half-body framing counts as framed, without knees or ankles in shot", () => {
  assert.equal(isPresentationFramed({ hipCenterX: 0.5 }), true);
});

test("framing no longer consults full-body visibility at all", () => {
  // The signature is the assertion: the predicate cannot see fullBodyVisible,
  // so cropped feet cannot influence the framing score by construction rather
  // than by a threshold someone might later re-tune.
  assert.equal(isPresentationFramed({ hipCenterX: 0.5 }), true);
});

test("a presenter who has drifted to the edge of frame is not framed", () => {
  // Loosening the rule must not remove it: walking out of shot is the thing
  // framing coverage exists to notice.
  assert.equal(isPresentationFramed({ hipCenterX: 0.04 }), false);
  assert.equal(isPresentationFramed({ hipCenterX: 0.96 }), false);
});

test("full-body visibility remains its own observation, separate from framing", () => {
  // The two were the same number. Keeping them apart means the summary can
  // still say whether the whole body was in shot without that answer deciding
  // the framing score.
  const accumulator = new PresentationMetricsAccumulator(0);
  assert.ok("fullBodyVisiblePercent" in accumulator.finish(1_000).metrics);
  assert.ok("framedPercent" in accumulator.finish(1_000).metrics);
});
