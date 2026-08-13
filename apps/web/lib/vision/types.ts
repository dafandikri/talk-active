export type VisionMode = "interview" | "presentation";

export type VisionPhase =
  | "idle"
  | "loading"
  | "calibrating"
  | "tracking"
  | "stopped"
  | "error";

export type VisionEventKind =
  | "face_out_of_frame"
  | "head_turned_away"
  | "body_out_of_frame"
  | "gesture_burst"
  | "position_change"
  | "torso_angle_change";

/** Coordinates are normalized to the source frame. */
export interface VisionLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface VisionEvent {
  kind: VisionEventKind;
  startMs: number;
  endMs: number;
  durationMs: number;
  label: string;
}

export interface InterviewFrameSnapshot {
  mode: "interview";
  timestampMs: number;
  calibrated: boolean;
  tracked: boolean;
  framed: boolean;
  cameraFacing: boolean | null;
  landmarks: readonly VisionLandmark[];
}

export interface PresentationFrameSnapshot {
  mode: "presentation";
  timestampMs: number;
  calibrated: boolean;
  tracked: boolean;
  fullBodyVisible: boolean;
  handsVisible: boolean;
  gestureActive: boolean;
  torsoAngleDeltaDegrees: number | null;
  landmarks: readonly VisionLandmark[];
}

export type VisionFrameSnapshot =
  | InterviewFrameSnapshot
  | PresentationFrameSnapshot;

export interface InterviewVisionMetrics {
  trackingCoveragePercent: number;
  framedPercent: number;
  cameraFacingPercent: number | null;
  longestOutOfFrameMs: number;
  longestHeadTurnMs: number;
}

export interface PresentationVisionMetrics {
  trackingCoveragePercent: number;
  fullBodyVisiblePercent: number;
  handsVisiblePercent: number;
  gestureActivePercent: number;
  gestureBurstCount: number;
  positionChangeCount: number;
  lateralMovementRangeShoulderWidths: number;
  longestBodyOutOfFrameMs: number;
}

interface VisionSummaryBase {
  durationMs: number;
  calibrationDurationMs: number;
  sampledFrames: number;
  measuredFrames: number;
  events: readonly VisionEvent[];
  /** Reminds consumers not to turn observable cues into personality claims. */
  limitations: readonly string[];
}

export interface InterviewVisionSummary extends VisionSummaryBase {
  mode: "interview";
  metrics: InterviewVisionMetrics;
}

export interface PresentationVisionSummary extends VisionSummaryBase {
  mode: "presentation";
  metrics: PresentationVisionMetrics;
}

export type VisionSessionSummary =
  | InterviewVisionSummary
  | PresentationVisionSummary;

export interface VisionAssetPaths {
  /** Directory containing the unrenamed MediaPipe vision WASM files. */
  wasmRoot: string;
  faceModel: string;
  poseModel: string;
}

export interface VisionSessionOptions {
  mode: VisionMode;
  assets?: Partial<VisionAssetPaths>;
  calibrationDurationMs?: number;
  maxFramesPerSecond?: number;
  delegate?: "CPU" | "GPU";
  onFrame?: (frame: VisionFrameSnapshot) => void;
  onPhaseChange?: (phase: VisionPhase) => void;
  onError?: (error: VisionEngineError) => void;
}

export interface VisionStartOptions {
  video: HTMLVideoElement;
  /**
   * Reuse a caller-owned stream when audio and vision share one permission.
   * Caller-owned tracks are never stopped by this engine.
   */
  stream?: MediaStream;
  camera?: MediaTrackConstraints;
}

export type VisionEngineErrorCode =
  | "unsupported"
  | "cancelled"
  | "invalid_state"
  | "camera_denied"
  | "camera_unavailable"
  | "model_load_failed"
  | "inference_failed";

export class VisionEngineError extends Error {
  readonly code: VisionEngineErrorCode;
  override readonly cause?: unknown;

  constructor(code: VisionEngineErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "VisionEngineError";
    this.code = code;
    this.cause = cause;
  }
}
