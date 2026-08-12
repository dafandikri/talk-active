import type {
  InterviewFrameSnapshot,
  InterviewVisionSummary,
  PresentationFrameSnapshot,
  PresentationVisionSummary,
  VisionEvent,
  VisionEventKind,
  VisionLandmark,
} from "./types";

const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

const FACE = {
  noseTip: 1,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
} as const;

const TRACKING_VISIBILITY = 0.55;

interface ActiveInterval {
  startedAtMs: number;
  lastActiveAtMs: number;
}

class IntervalEvents {
  private active: ActiveInterval | null = null;
  private readonly events: VisionEvent[];
  private readonly kind: VisionEventKind;
  private readonly label: string;
  private readonly minimumDurationMs: number;

  constructor(
    events: VisionEvent[],
    kind: VisionEventKind,
    label: string,
    minimumDurationMs: number,
  ) {
    this.events = events;
    this.kind = kind;
    this.label = label;
    this.minimumDurationMs = minimumDurationMs;
  }

  update(active: boolean, timestampMs: number): void {
    if (active) {
      if (this.active === null) {
        this.active = { startedAtMs: timestampMs, lastActiveAtMs: timestampMs };
      } else {
        this.active.lastActiveAtMs = timestampMs;
      }
      return;
    }

    this.flush(timestampMs);
  }

  finish(): void {
    this.flush(this.active?.lastActiveAtMs ?? 0);
  }

  private flush(endMs: number): void {
    if (this.active === null) return;

    const durationMs = Math.max(0, endMs - this.active.startedAtMs);
    if (durationMs >= this.minimumDurationMs) {
      this.events.push({
        kind: this.kind,
        startMs: Math.round(this.active.startedAtMs),
        endMs: Math.round(endMs),
        durationMs: Math.round(durationMs),
        label: this.label,
      });
    }
    this.active = null;
  }
}

function valueAt(
  landmarks: readonly VisionLandmark[],
  index: number,
): VisionLandmark | undefined {
  return landmarks[index];
}

function isInFrame(point: VisionLandmark | undefined, margin = 0.02): boolean {
  return (
    point !== undefined &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= margin &&
    point.x <= 1 - margin &&
    point.y >= margin &&
    point.y <= 1 - margin
  );
}

function isVisible(point: VisionLandmark | undefined): boolean {
  return (
    isInFrame(point) &&
    (point?.visibility === undefined || point.visibility >= TRACKING_VISIBILITY)
  );
}

function midpoint(
  left: VisionLandmark,
  right: VisionLandmark,
): VisionLandmark {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    z:
      left.z === undefined || right.z === undefined
        ? undefined
        : (left.z + right.z) / 2,
  };
}

function distance(left: VisionLandmark, right: VisionLandmark): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) return null;
  if (sorted.length % 2 === 1) return middleValue;
  const priorValue = sorted[middle - 1];
  return priorValue === undefined ? middleValue : (priorValue + middleValue) / 2;
}

export interface FaceGeometry {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  directionOffset: number | null;
}

export function getFaceGeometry(
  landmarks: readonly VisionLandmark[],
): FaceGeometry | null {
  if (landmarks.length < 264) return null;
  const finite = landmarks.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (finite.length === 0) return null;

  const xValues = finite.map((point) => point.x);
  const yValues = finite.map((point) => point.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const nose = valueAt(landmarks, FACE.noseTip);
  const leftEye = valueAt(landmarks, FACE.leftEyeOuter);
  const rightEye = valueAt(landmarks, FACE.rightEyeOuter);
  let directionOffset: number | null = null;

  if (nose && leftEye && rightEye) {
    const eyeDistance = Math.abs(rightEye.x - leftEye.x);
    if (eyeDistance > 0.01) {
      directionOffset =
        (nose.x - (leftEye.x + rightEye.x) / 2) / eyeDistance;
    }
  }

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
    directionOffset,
  };
}

export function isFaceFramed(geometry: FaceGeometry): boolean {
  return (
    geometry.centerX >= 0.26 &&
    geometry.centerX <= 0.74 &&
    geometry.centerY >= 0.22 &&
    geometry.centerY <= 0.68 &&
    geometry.width >= 0.16 &&
    geometry.width <= 0.72 &&
    geometry.height >= 0.22 &&
    geometry.height <= 0.88
  );
}

function longestDuration(
  events: readonly VisionEvent[],
  kind: VisionEventKind,
): number {
  return events.reduce(
    (longest, event) =>
      event.kind === kind ? Math.max(longest, event.durationMs) : longest,
    0,
  );
}

export class InterviewMetricsAccumulator {
  private readonly calibrationDurationMs: number;
  private sampledFrames = 0;
  private measuredFrames = 0;
  private trackedFrames = 0;
  private framedFrames = 0;
  private directionFrames = 0;
  private cameraFacingFrames = 0;
  private lastTimestampMs = 0;
  private readonly calibrationOffsets: number[] = [];
  private readonly events: VisionEvent[] = [];
  private readonly outOfFrame = new IntervalEvents(
    this.events,
    "face_out_of_frame",
    "Face was outside the recommended frame",
    1_200,
  );
  private readonly headTurned = new IntervalEvents(
    this.events,
    "head_turned_away",
    "Head direction differed from the calibrated camera-facing position",
    1_500,
  );

  constructor(calibrationDurationMs = 3_000) {
    this.calibrationDurationMs = calibrationDurationMs;
  }

  addFrame(
    timestampMs: number,
    landmarks: readonly VisionLandmark[] | undefined,
  ): InterviewFrameSnapshot {
    this.sampledFrames += 1;
    this.lastTimestampMs = Math.max(this.lastTimestampMs, timestampMs);
    const calibrated = timestampMs >= this.calibrationDurationMs;
    const geometry = landmarks ? getFaceGeometry(landmarks) : null;
    const tracked = geometry !== null;
    const framed = geometry !== null && isFaceFramed(geometry);
    const directionOffset = geometry?.directionOffset;

    if (!calibrated && directionOffset !== null && directionOffset !== undefined) {
      this.calibrationOffsets.push(directionOffset);
    }

    let cameraFacing: boolean | null = null;
    const baseline = median(this.calibrationOffsets);
    if (
      calibrated &&
      directionOffset !== null &&
      directionOffset !== undefined &&
      baseline !== null
    ) {
      cameraFacing = Math.abs(directionOffset - baseline) <= 0.22;
    }

    if (calibrated) {
      this.measuredFrames += 1;
      if (tracked) this.trackedFrames += 1;
      if (framed) this.framedFrames += 1;
      if (cameraFacing !== null) {
        this.directionFrames += 1;
        if (cameraFacing) this.cameraFacingFrames += 1;
      }
      this.outOfFrame.update(!framed, timestampMs);
      this.headTurned.update(cameraFacing === false, timestampMs);
    }

    return {
      mode: "interview",
      timestampMs,
      calibrated,
      tracked,
      framed,
      cameraFacing,
      landmarks: landmarks ?? [],
    };
  }

  finish(durationMs = this.lastTimestampMs): InterviewVisionSummary {
    this.outOfFrame.finish();
    this.headTurned.finish();
    const frozenEvents = [...this.events].sort(
      (left, right) => left.startMs - right.startMs,
    );

    return {
      mode: "interview",
      durationMs: Math.max(0, Math.round(durationMs)),
      calibrationDurationMs: Math.min(
        this.calibrationDurationMs,
        Math.max(0, Math.round(durationMs)),
      ),
      sampledFrames: this.sampledFrames,
      measuredFrames: this.measuredFrames,
      metrics: {
        trackingCoveragePercent: percent(this.trackedFrames, this.measuredFrames),
        framedPercent: percent(this.framedFrames, this.measuredFrames),
        cameraFacingPercent:
          this.directionFrames === 0
            ? null
            : percent(this.cameraFacingFrames, this.directionFrames),
        longestOutOfFrameMs: longestDuration(frozenEvents, "face_out_of_frame"),
        longestHeadTurnMs: longestDuration(frozenEvents, "head_turned_away"),
      },
      events: frozenEvents,
      limitations: [
        "Camera-facing head direction is not eye contact or attention.",
        "These are camera-measured cues, not confidence, emotion, or interview ability.",
      ],
    };
  }
}

interface PoseGeometry {
  fullBodyVisible: boolean;
  handsVisible: boolean;
  shoulderWidth: number;
  hipCenterX: number;
  torsoAngleDegrees: number;
  leftWrist: VisionLandmark;
  rightWrist: VisionLandmark;
}

function getPoseGeometry(
  landmarks: readonly VisionLandmark[],
): PoseGeometry | null {
  const leftShoulder = valueAt(landmarks, POSE.leftShoulder);
  const rightShoulder = valueAt(landmarks, POSE.rightShoulder);
  const leftHip = valueAt(landmarks, POSE.leftHip);
  const rightHip = valueAt(landmarks, POSE.rightHip);
  const leftWrist = valueAt(landmarks, POSE.leftWrist);
  const rightWrist = valueAt(landmarks, POSE.rightWrist);

  if (
    !isVisible(leftShoulder) ||
    !isVisible(rightShoulder) ||
    !isVisible(leftHip) ||
    !isVisible(rightHip) ||
    !leftShoulder ||
    !rightShoulder ||
    !leftHip ||
    !rightHip ||
    !leftWrist ||
    !rightWrist
  ) {
    return null;
  }

  const shoulderWidth = distance(leftShoulder, rightShoulder);
  if (shoulderWidth < 0.025) return null;
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const lowerBodyIndices = [
    POSE.leftKnee,
    POSE.rightKnee,
    POSE.leftAnkle,
    POSE.rightAnkle,
  ];

  return {
    fullBodyVisible: lowerBodyIndices.every((index) =>
      isVisible(valueAt(landmarks, index)),
    ),
    handsVisible: isVisible(leftWrist) && isVisible(rightWrist),
    shoulderWidth,
    hipCenterX: hipCenter.x,
    torsoAngleDegrees:
      (Math.atan2(shoulderCenter.x - hipCenter.x, hipCenter.y - shoulderCenter.y) *
        180) /
      Math.PI,
    leftWrist,
    rightWrist,
  };
}

interface TimedPoint {
  point: VisionLandmark;
  timestampMs: number;
}

export class PresentationMetricsAccumulator {
  private readonly calibrationDurationMs: number;
  private sampledFrames = 0;
  private measuredFrames = 0;
  private trackedFrames = 0;
  private fullBodyFrames = 0;
  private handsVisibleFrames = 0;
  private gestureFrames = 0;
  private lastTimestampMs = 0;
  private previousLeftWrist: TimedPoint | null = null;
  private previousRightWrist: TimedPoint | null = null;
  private lastPositionAnchor: number | null = null;
  private lastPositionEventMs = Number.NEGATIVE_INFINITY;
  private minimumHipX = Number.POSITIVE_INFINITY;
  private maximumHipX = Number.NEGATIVE_INFINITY;
  private readonly shoulderWidths: number[] = [];
  private readonly calibrationTorsoAngles: number[] = [];
  private readonly events: VisionEvent[] = [];
  private readonly bodyOutOfFrame = new IntervalEvents(
    this.events,
    "body_out_of_frame",
    "Full body was outside the camera frame",
    1_200,
  );
  private readonly gestureBurst = new IntervalEvents(
    this.events,
    "gesture_burst",
    "Sustained hand movement was detected",
    450,
  );
  private readonly torsoAngleChange = new IntervalEvents(
    this.events,
    "torso_angle_change",
    "Torso angle differed from the calibrated starting position",
    1_200,
  );

  constructor(calibrationDurationMs = 3_000) {
    this.calibrationDurationMs = calibrationDurationMs;
  }

  addFrame(
    timestampMs: number,
    landmarks: readonly VisionLandmark[] | undefined,
  ): PresentationFrameSnapshot {
    this.sampledFrames += 1;
    this.lastTimestampMs = Math.max(this.lastTimestampMs, timestampMs);
    const calibrated = timestampMs >= this.calibrationDurationMs;
    const geometry = landmarks ? getPoseGeometry(landmarks) : null;
    const tracked = geometry !== null;

    if (!calibrated && geometry) {
      this.calibrationTorsoAngles.push(geometry.torsoAngleDegrees);
    }

    let gestureActive = false;
    let torsoAngleDeltaDegrees: number | null = null;
    if (geometry) {
      gestureActive = this.isGestureActive(geometry, timestampMs);
      const torsoBaseline = median(this.calibrationTorsoAngles);
      if (torsoBaseline !== null) {
        torsoAngleDeltaDegrees = geometry.torsoAngleDegrees - torsoBaseline;
      }
      this.previousLeftWrist = { point: geometry.leftWrist, timestampMs };
      this.previousRightWrist = { point: geometry.rightWrist, timestampMs };
    } else {
      this.previousLeftWrist = null;
      this.previousRightWrist = null;
    }

    if (calibrated) {
      this.measuredFrames += 1;
      if (geometry) {
        this.trackedFrames += 1;
        this.shoulderWidths.push(geometry.shoulderWidth);
        this.minimumHipX = Math.min(this.minimumHipX, geometry.hipCenterX);
        this.maximumHipX = Math.max(this.maximumHipX, geometry.hipCenterX);
        this.trackPositionChange(geometry, timestampMs);
      }
      if (geometry?.fullBodyVisible) this.fullBodyFrames += 1;
      if (geometry?.handsVisible) this.handsVisibleFrames += 1;
      if (gestureActive) this.gestureFrames += 1;
      this.bodyOutOfFrame.update(!geometry?.fullBodyVisible, timestampMs);
      this.gestureBurst.update(gestureActive, timestampMs);
      this.torsoAngleChange.update(
        torsoAngleDeltaDegrees !== null && Math.abs(torsoAngleDeltaDegrees) >= 10,
        timestampMs,
      );
    }

    return {
      mode: "presentation",
      timestampMs,
      calibrated,
      tracked,
      fullBodyVisible: geometry?.fullBodyVisible ?? false,
      handsVisible: geometry?.handsVisible ?? false,
      gestureActive,
      torsoAngleDeltaDegrees,
      landmarks: landmarks ?? [],
    };
  }

  finish(durationMs = this.lastTimestampMs): PresentationVisionSummary {
    this.bodyOutOfFrame.finish();
    this.gestureBurst.finish();
    this.torsoAngleChange.finish();
    const frozenEvents = [...this.events].sort(
      (left, right) => left.startMs - right.startMs,
    );
    const typicalShoulderWidth = median(this.shoulderWidths);
    const hasRange =
      Number.isFinite(this.minimumHipX) && Number.isFinite(this.maximumHipX);
    const movementRange =
      hasRange && typicalShoulderWidth !== null && typicalShoulderWidth > 0
        ? (this.maximumHipX - this.minimumHipX) / typicalShoulderWidth
        : 0;

    return {
      mode: "presentation",
      durationMs: Math.max(0, Math.round(durationMs)),
      calibrationDurationMs: Math.min(
        this.calibrationDurationMs,
        Math.max(0, Math.round(durationMs)),
      ),
      sampledFrames: this.sampledFrames,
      measuredFrames: this.measuredFrames,
      metrics: {
        trackingCoveragePercent: percent(this.trackedFrames, this.measuredFrames),
        fullBodyVisiblePercent: percent(this.fullBodyFrames, this.measuredFrames),
        handsVisiblePercent: percent(this.handsVisibleFrames, this.measuredFrames),
        gestureActivePercent: percent(this.gestureFrames, this.measuredFrames),
        gestureBurstCount: frozenEvents.filter(
          (event) => event.kind === "gesture_burst",
        ).length,
        positionChangeCount: frozenEvents.filter(
          (event) => event.kind === "position_change",
        ).length,
        lateralMovementRangeShoulderWidths: Math.round(movementRange * 10) / 10,
        longestBodyOutOfFrameMs: longestDuration(
          frozenEvents,
          "body_out_of_frame",
        ),
      },
      events: frozenEvents,
      limitations: [
        "Hand motion is movement, not proof that a gesture was purposeful or effective.",
        "These are camera-measured cues, not confidence or presentation ability.",
      ],
    };
  }

  private isGestureActive(geometry: PoseGeometry, timestampMs: number): boolean {
    if (!geometry.handsVisible) return false;
    const leftSpeed = this.normalizedSpeed(
      this.previousLeftWrist,
      geometry.leftWrist,
      geometry.shoulderWidth,
      timestampMs,
    );
    const rightSpeed = this.normalizedSpeed(
      this.previousRightWrist,
      geometry.rightWrist,
      geometry.shoulderWidth,
      timestampMs,
    );
    return Math.max(leftSpeed, rightSpeed) >= 0.85;
  }

  private normalizedSpeed(
    previous: TimedPoint | null,
    current: VisionLandmark,
    shoulderWidth: number,
    timestampMs: number,
  ): number {
    if (previous === null) return 0;
    const elapsedSeconds = (timestampMs - previous.timestampMs) / 1_000;
    if (elapsedSeconds <= 0 || elapsedSeconds > 0.75) return 0;
    return distance(previous.point, current) / shoulderWidth / elapsedSeconds;
  }

  private trackPositionChange(geometry: PoseGeometry, timestampMs: number): void {
    if (this.lastPositionAnchor === null) {
      this.lastPositionAnchor = geometry.hipCenterX;
      return;
    }
    const distanceFromAnchor =
      Math.abs(geometry.hipCenterX - this.lastPositionAnchor) /
      geometry.shoulderWidth;
    if (
      distanceFromAnchor >= 0.65 &&
      timestampMs - this.lastPositionEventMs >= 1_500
    ) {
      this.events.push({
        kind: "position_change",
        startMs: Math.round(timestampMs),
        endMs: Math.round(timestampMs),
        durationMs: 0,
        label: "Presenter position changed across the camera frame",
      });
      this.lastPositionAnchor = geometry.hipCenterX;
      this.lastPositionEventMs = timestampMs;
    }
  }
}
