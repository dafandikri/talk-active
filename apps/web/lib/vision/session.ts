import type {
  FaceLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import {
  InterviewMetricsAccumulator,
  PresentationMetricsAccumulator,
} from "./metrics";
import {
  VisionEngineError,
  type VisionAssetPaths,
  type VisionFrameSnapshot,
  type VisionPhase,
  type VisionSessionOptions,
  type VisionSessionSummary,
  type VisionStartOptions,
} from "./types";

const DEFAULT_ASSETS: VisionAssetPaths = {
  wasmRoot: "/mediapipe/wasm",
  faceModel: "/mediapipe/models/face_landmarker.task",
  poseModel: "/mediapipe/models/pose_landmarker_lite.task",
};

const DEFAULT_CAMERA: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 15, max: 15 },
  facingMode: "user",
};

const MEDIAPIPE_UTILIZATION_LOG_URL = "https://odml.pa.googleapis.com/v1/log";
const MEDIAPIPE_CPU_INFO = "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.";

let telemetryGuardReferences = 0;
let telemetryGuardFetch: typeof globalThis.fetch | null = null;
let telemetryPreviousFetch: typeof globalThis.fetch | null = null;
let telemetryGuardConsoleError: typeof console.error | null = null;
let telemetryPreviousConsoleError: typeof console.error | null = null;

function mediaPipeUtilizationRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): boolean {
  const requestUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  try {
    const expected = new URL(MEDIAPIPE_UTILIZATION_LOG_URL);
    const actual = new URL(requestUrl, window.location.href);
    return method === "POST" && actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function acquireTelemetryGuard(): () => void {
  if (typeof globalThis.fetch !== "function") return () => undefined;

  if (telemetryGuardReferences === 0) {
    telemetryPreviousFetch = globalThis.fetch;
    const previousFetch = telemetryPreviousFetch;
    telemetryGuardFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (mediaPipeUtilizationRequest(input, init)) {
        return Promise.resolve(new Response("", { status: 200 }));
      }
      return previousFetch.call(globalThis, input, init);
    }) as typeof globalThis.fetch;
    globalThis.fetch = telemetryGuardFetch;

    telemetryPreviousConsoleError = console.error;
    const previousConsoleError = telemetryPreviousConsoleError;
    telemetryGuardConsoleError = (...arguments_: unknown[]) => {
      if (String(arguments_[0] ?? "").startsWith(MEDIAPIPE_CPU_INFO)) return;
      previousConsoleError.apply(console, arguments_);
    };
    console.error = telemetryGuardConsoleError;
  }

  telemetryGuardReferences += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    telemetryGuardReferences = Math.max(0, telemetryGuardReferences - 1);
    if (telemetryGuardReferences !== 0) return;
    if (telemetryGuardFetch && globalThis.fetch === telemetryGuardFetch && telemetryPreviousFetch) {
      globalThis.fetch = telemetryPreviousFetch;
    }
    if (telemetryGuardConsoleError && console.error === telemetryGuardConsoleError && telemetryPreviousConsoleError) {
      console.error = telemetryPreviousConsoleError;
    }
    telemetryGuardFetch = null;
    telemetryPreviousFetch = null;
    telemetryGuardConsoleError = null;
    telemetryPreviousConsoleError = null;
  };
}

type VisionLandmarker = FaceLandmarker | PoseLandmarker;
type MetricsAccumulator =
  | InterviewMetricsAccumulator
  | PresentationMetricsAccumulator;

/**
 * Owns one face-or-pose inference loop. It never records frames and only stops
 * streams that it requested itself.
 */
export class BrowserVisionSession {
  private phase: VisionPhase = "idle";
  private landmarker: VisionLandmarker | null = null;
  private accumulator: MetricsAccumulator | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private ownsStream = false;
  private animationFrameId: number | null = null;
  private sessionStartedAtMs = 0;
  private lastInferenceAtMs = Number.NEGATIVE_INFINITY;
  private summary: VisionSessionSummary | null = null;
  private inferenceActive = false;
  private disposed = false;
  private generation = 0;
  private restoreTelemetryGuard: (() => void) | null = null;

  private readonly assets: VisionAssetPaths;
  private readonly calibrationDurationMs: number;
  private readonly frameIntervalMs: number;

  constructor(private readonly options: VisionSessionOptions) {
    this.assets = { ...DEFAULT_ASSETS, ...options.assets };
    this.calibrationDurationMs = clamp(
      options.calibrationDurationMs ?? 3_000,
      1_000,
      10_000,
    );
    this.frameIntervalMs =
      1_000 / clamp(options.maxFramesPerSecond ?? 8, 2, 15);
  }

  get currentPhase(): VisionPhase {
    return this.phase;
  }

  get lastSummary(): VisionSessionSummary | null {
    return this.summary;
  }

  async start(startOptions: VisionStartOptions): Promise<void> {
    if (this.disposed) {
      throw new VisionEngineError(
        "invalid_state",
        "This visual session has already been disposed.",
      );
    }
    if (this.phase !== "idle" && this.phase !== "stopped") {
      throw new VisionEngineError(
        "invalid_state",
        `Cannot start a visual session while it is ${this.phase}.`,
      );
    }
    if (typeof window === "undefined" || !navigator.mediaDevices) {
      throw new VisionEngineError(
        "unsupported",
        "Camera-based rehearsal is unavailable in this browser.",
      );
    }

    const generation = ++this.generation;
    this.summary = null;
    this.video = startOptions.video;
    this.transition("loading");

    try {
      await this.ensureLandmarker(generation);
      this.assertCurrent(generation);
      const stream =
        startOptions.stream ??
        (await navigator.mediaDevices.getUserMedia({
          video: startOptions.camera ?? DEFAULT_CAMERA,
          audio: false,
        }));

      if (generation !== this.generation || this.disposed) {
        if (startOptions.stream === undefined) {
          for (const track of stream.getTracks()) track.stop();
        }
        throw new VisionEngineError('cancelled', 'The visual session was cancelled before capture began.');
      }

      if (stream.getVideoTracks().length === 0) {
        throw new VisionEngineError(
          "camera_unavailable",
          "The selected media stream does not contain a camera track.",
        );
      }

      this.stream = stream;
      this.ownsStream = startOptions.stream === undefined;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      this.assertCurrent(generation);

      this.accumulator =
        this.options.mode === "interview"
          ? new InterviewMetricsAccumulator(this.calibrationDurationMs)
          : new PresentationMetricsAccumulator(this.calibrationDurationMs);
      this.sessionStartedAtMs = performance.now();
      this.lastInferenceAtMs = Number.NEGATIVE_INFINITY;
      this.transition("calibrating");
      this.scheduleNextFrame();
    } catch (cause) {
      const error = this.toStartError(cause);
      if (error.code === 'cancelled') {
        this.releaseCamera();
        this.accumulator = null;
        this.sessionStartedAtMs = 0;
        if (!this.disposed) this.transition('stopped');
        throw error;
      }
      this.fail(error);
      throw error;
    }
  }

  stop(): VisionSessionSummary | null {
    this.generation += 1;
    this.cancelLoop();
    const durationMs =
      this.sessionStartedAtMs > 0
        ? Math.max(0, performance.now() - this.sessionStartedAtMs)
        : 0;
    this.summary = this.finishAccumulator(durationMs);
    this.releaseCamera();
    this.accumulator = null;
    this.sessionStartedAtMs = 0;
    if (this.phase !== "error") this.transition("stopped");
    return this.summary;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    try {
      this.landmarker?.close();
      this.landmarker = null;
    } finally {
      this.restoreTelemetryGuard?.();
      this.restoreTelemetryGuard = null;
    }
  }

  private async ensureLandmarker(generation: number): Promise<void> {
    if (this.landmarker !== null) return;
    this.installTelemetryGuard();
    try {
      const { FaceLandmarker, FilesetResolver, PoseLandmarker } = await import(
        "@mediapipe/tasks-vision"
      );
      const fileset = await FilesetResolver.forVisionTasks(this.assets.wasmRoot);
      const requestedDelegate = this.options.delegate ?? "GPU";

      const create = async (delegate: "CPU" | "GPU") => {
        if (this.options.mode === "interview") {
          return FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: this.assets.faceModel,
              delegate,
            },
            runningMode: "VIDEO",
            numFaces: 1,
            minFaceDetectionConfidence: 0.55,
            minFacePresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
          });
        }

        return PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: this.assets.poseModel,
            delegate,
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.55,
          minPosePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
          outputSegmentationMasks: false,
        });
      };

      let created: VisionLandmarker;
      try {
        created = await create(requestedDelegate);
      } catch (gpuCause) {
        if (requestedDelegate === "CPU" || this.options.delegate === "GPU") {
          throw gpuCause;
        }
        created = await create("CPU");
      }
      if (generation !== this.generation || this.disposed) {
        created.close();
        throw new VisionEngineError('cancelled', 'The visual model finished loading after the session was cancelled.');
      }
      this.landmarker = created;
    } catch (cause) {
      if (cause instanceof VisionEngineError && cause.code === 'cancelled') throw cause;
      throw new VisionEngineError(
        "model_load_failed",
        "The on-device visual model could not be loaded.",
        cause,
      );
    }
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation || this.disposed) {
      throw new VisionEngineError('cancelled', 'The visual session was cancelled.');
    }
  }

  /**
   * MediaPipe Tasks 1.0.1 emits optional utilization logs even when all model
   * assets are self-hosted and labels one harmless CPU-delegate info line as a
   * console error. Keep the demo same-origin and quiet by suppressing only
   * those exact vendor side effects while a model is alive, then restore both
   * browser functions on dispose.
   */
  private installTelemetryGuard(): void {
    if (!this.restoreTelemetryGuard) {
      this.restoreTelemetryGuard = acquireTelemetryGuard();
    }
  }

  private scheduleNextFrame(): void {
    this.animationFrameId = requestAnimationFrame((nowMs) => {
      this.animationFrameId = null;
      this.processFrame(nowMs);
      if (this.phase === "calibrating" || this.phase === "tracking") {
        this.scheduleNextFrame();
      }
    });
  }

  private processFrame(nowMs: number): void {
    if (
      this.inferenceActive ||
      nowMs - this.lastInferenceAtMs < this.frameIntervalMs ||
      this.video === null ||
      this.landmarker === null ||
      this.accumulator === null ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return;
    }

    this.inferenceActive = true;
    this.lastInferenceAtMs = nowMs;
    const elapsedMs = Math.max(0, nowMs - this.sessionStartedAtMs);

    try {
      let snapshot: VisionFrameSnapshot;
      if (
        this.options.mode === "interview" &&
        this.accumulator instanceof InterviewMetricsAccumulator
      ) {
        const result = (this.landmarker as FaceLandmarker).detectForVideo(
          this.video,
          nowMs,
        );
        snapshot = this.accumulator.addFrame(
          elapsedMs,
          result.faceLandmarks[0],
        );
      } else if (this.accumulator instanceof PresentationMetricsAccumulator) {
        const result = (this.landmarker as PoseLandmarker).detectForVideo(
          this.video,
          nowMs,
        );
        snapshot = this.accumulator.addFrame(elapsedMs, result.landmarks[0]);
      } else {
        throw new VisionEngineError(
          "inference_failed",
          "The visual mode and its measurement pipeline do not match.",
        );
      }

      if (snapshot.calibrated && this.phase === "calibrating") {
        this.transition("tracking");
      }
      this.options.onFrame?.(snapshot);
    } catch (cause) {
      this.fail(
        cause instanceof VisionEngineError
          ? cause
          : new VisionEngineError(
              "inference_failed",
              "Visual tracking stopped because a frame could not be analysed.",
              cause,
            ),
      );
    } finally {
      this.inferenceActive = false;
    }
  }

  private finishAccumulator(durationMs: number): VisionSessionSummary | null {
    if (this.accumulator instanceof InterviewMetricsAccumulator) {
      return this.accumulator.finish(durationMs);
    }
    if (this.accumulator instanceof PresentationMetricsAccumulator) {
      return this.accumulator.finish(durationMs);
    }
    return this.summary;
  }

  private cancelLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private releaseCamera(): void {
    if (this.ownsStream) {
      for (const track of this.stream?.getTracks() ?? []) track.stop();
    }
    if (this.video?.srcObject === this.stream) this.video.srcObject = null;
    this.stream = null;
    this.video = null;
    this.ownsStream = false;
  }

  private transition(next: VisionPhase): void {
    if (this.phase === next) return;
    this.phase = next;
    this.options.onPhaseChange?.(next);
  }

  private fail(error: VisionEngineError): void {
    this.cancelLoop();
    const durationMs =
      this.sessionStartedAtMs > 0
        ? Math.max(0, performance.now() - this.sessionStartedAtMs)
        : 0;
    this.summary = this.finishAccumulator(durationMs);
    this.releaseCamera();
    this.accumulator = null;
    this.sessionStartedAtMs = 0;
    this.transition("error");
    this.options.onError?.(error);
  }

  private toStartError(cause: unknown): VisionEngineError {
    if (cause instanceof VisionEngineError) return cause;
    if (cause instanceof DOMException && cause.name === "NotAllowedError") {
      return new VisionEngineError(
        "camera_denied",
        "Camera permission was not granted.",
        cause,
      );
    }
    if (
      cause instanceof DOMException &&
      ["NotFoundError", "NotReadableError", "OverconstrainedError"].includes(
        cause.name,
      )
    ) {
      return new VisionEngineError(
        "camera_unavailable",
        "No usable camera is available.",
        cause,
      );
    }
    return new VisionEngineError(
      "camera_unavailable",
      "The camera preview could not be started.",
      cause,
    );
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createVisionSession(
  options: VisionSessionOptions,
): BrowserVisionSession {
  return new BrowserVisionSession(options);
}
