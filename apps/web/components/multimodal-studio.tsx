'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import type { ProjectLanguage } from '@/lib/contracts';
import {
  analyzeDeliveryMetrics,
  type DeliveryMetricsResult,
  type VisionObservations,
} from '@/lib/delivery-metrics';
import { useTranslations } from 'next-intl';

import { GuessedPassageNotice, InputQualityNotice } from '@/components/input-quality-notice';
import {
  assessInputQuality,
  type InputQualityVerdict,
} from '@/lib/rehearsal/input-quality';
import {
  createAudioObserver,
  type AudioObservationSample,
  type AudioObservationSummary,
  type AudioObserver,
} from '@/lib/rehearsal/audio-observer';
import {
  createSpeechRecognitionSession,
  speechRecognitionIsSupported,
  type SpeechRecognitionSession,
  type SpeechRecognitionState,
} from '@/lib/rehearsal/speech-recognition';
import {
  createRehearsalRecordingSession,
  type RehearsalRecording,
  type RehearsalRecordingSession,
} from '@/lib/rehearsal/recording';
import {
  InterimFillerTracker,
  SpeechDisruptionDetector,
  mergeSpeechDisruptionEvents,
  type SpeechDisruptionEvent,
} from '@/lib/rehearsal/speech-disruptions';
import {
  TranscriptTimingTracker,
  type TranscriptTimingPoint,
} from '@/lib/rehearsal/transcript-timing';
import {
  createVisionSession,
  type BrowserVisionSession,
  type VisionFrameSnapshot,
  type VisionMode,
  type VisionPhase,
  type VisionSessionSummary,
} from '@/lib/vision';

export type CapturedTranscriptSource = 'typed' | 'web-speech';

export interface MultimodalCapture {
  mode: VisionMode;
  /** Answer time used for transcript-derived delivery metrics. */
  durationSeconds: number;
  /** Full wall-clock capture time used to align camera events and an optional replay. */
  sessionDurationSeconds: number;
  transcript: string;
  transcriptSource: CapturedTranscriptSource;
  visionSummary: VisionSessionSummary | null;
  audioSummary: AudioObservationSummary | null;
  speechDisruptions?: readonly SpeechDisruptionEvent[];
  /**
   * Dictation growth samples pairing transcript length with capture time.
   * Present only when the transcript came from live dictation, so a typed
   * transcript is never given a clock position it does not have.
   */
  transcriptTimingPoints?: readonly TranscriptTimingPoint[];
  /** True when capture ended because the stated time limit ran out. */
  stoppedAtLimit?: boolean;
  recording: RehearsalRecording | null;
}

export interface MultimodalAttemptResult extends MultimodalCapture {
  metrics: DeliveryMetricsResult;
}

export interface MultimodalStudioStartOptions {
  /**
   * Starts the camera and optional replay while keeping dictation and acoustic
   * observations gated until `resumeAnswerCapture` is called.
   */
  answerCapturePaused?: boolean;
}

export interface MultimodalStudioStopOptions {
  /** Immutable answer-only text assembled by the interview coordinator. */
  transcriptOverride?: string;
  /** Sum of answer windows, excluding Kato narration and listening time. */
  answerDurationSeconds?: number;
}

export interface MultimodalAnswerCheckpoint {
  /** Milliseconds from the same monotonic origin used by replay and sensor events. */
  elapsedMs: number;
  /** Dictation captured since the most recent answer-capture resume. */
  transcript: string;
}

export interface MultimodalSessionState {
  active: boolean;
  transitionBusy: boolean;
  answerCapturePaused: boolean;
  /** `performance.now()` value at the session origin, never a wall-clock timestamp. */
  sessionStartedAtMs: number | null;
  elapsedMs: number;
}

export interface MultimodalAnswerResumeOptions {
  /** Clear the previous dictation segment before listening for the next answer. */
  resetTranscript?: boolean;
}

export class MultimodalStudioSessionError extends Error {
  readonly code: 'invalid-state' | 'transition-busy' | 'invalid-stop-options';

  constructor(
    code: 'invalid-state' | 'transition-busy' | 'invalid-stop-options',
    message: string,
  ) {
    super(message);
    this.name = 'MultimodalStudioSessionError';
    this.code = code;
  }
}

export interface MultimodalStudioHandle {
  start: (options?: MultimodalStudioStartOptions) => Promise<boolean>;
  stop: (options?: MultimodalStudioStopOptions) => Promise<MultimodalAttemptResult | null>;
  pauseAnswerCapture: () => Promise<MultimodalAnswerCheckpoint>;
  resumeAnswerCapture: (
    options?: MultimodalAnswerResumeOptions,
  ) => Promise<MultimodalAnswerCheckpoint>;
  getSessionState: () => MultimodalSessionState;
}

interface MultimodalStudioProps {
  transcript: string;
  /** Inherited from project setup; capture must never invent its own locale. */
  language: ProjectLanguage;
  durableRecordingAvailable?: boolean;
  /**
   * The stated time limit for this attempt. When set, the live chip counts
   * down to it and capture stops itself at zero, the way an evaluator stops a
   * pitch at the bell. Null leaves capture open-ended.
   */
  targetDurationMs?: number | null;
  fixedMode?: VisionMode;
  title?: string;
  description?: string;
  startLabel?: string;
  stopLabel?: string;
  startDisabled?: boolean;
  startDisabledReason?: string;
  resetToken?: string;
  allowReplay?: boolean;
  /** Keep the session running until an external coordinator calls `handle.stop()`. */
  hideStopControl?: boolean;
  /** The built-in Start button opens a session with answer sources gated. */
  startWithAnswerCapturePaused?: boolean;
  onTranscriptChange: (value: string) => void;
  onResult: (result: MultimodalAttemptResult | null) => void;
  /** Lets the surrounding step disable its own controls while capture holds the devices. */
  onBusyChange?: (busy: boolean) => void;
  /**
   * Separates a long-running active session from its short start/stop/pause
   * transitions, so an interview coordinator may advance while capture stays on.
   */
  onSessionStateChange?: (state: MultimodalSessionState) => void;
}

const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132,
  93, 234, 127, 162, 21, 54, 103, 67, 109];

/** Ten seconds at the observer's 100ms cadence — long enough to include the
 *  gaps between phrases, which is where a noisy floor shows up. */
const QUALITY_WINDOW_SAMPLES = 100;

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function observationFromVision(summary: VisionSessionSummary | null): VisionObservations | undefined {
  if (!summary) return undefined;
  if (summary.mode === 'interview') {
    const trackedFrames = Math.round(summary.measuredFrames * summary.metrics.trackingCoveragePercent / 100);
    return {
      mode: 'interview',
      sampledFrames: summary.measuredFrames,
      trackedFrames,
      framedFrames: Math.round(summary.measuredFrames * summary.metrics.framedPercent / 100),
      movementActiveFrames: summary.metrics.cameraFacingPercent === null
        ? 0
        : Math.round(trackedFrames * (100 - summary.metrics.cameraFacingPercent) / 100),
    };
  }
  const trackedFrames = Math.round(summary.measuredFrames * summary.metrics.trackingCoveragePercent / 100);
  return {
    mode: 'presentation',
    sampledFrames: summary.measuredFrames,
    trackedFrames,
    // This read fullBodyVisiblePercent, which required both knees and both
    // ankles to be tracked. A presenter standing behind a laptop — head to
    // waist, the ordinary case — scored 0% framing coverage for being close
    // enough to read. Framing now means in shot and not at the edge; whether
    // the whole body was visible remains a separate observation.
    framedFrames: Math.round(summary.measuredFrames * summary.metrics.framedPercent / 100),
    movementActiveFrames: Math.round(trackedFrames * summary.metrics.gestureActivePercent / 100),
  };
}

function alignVisionSummary(
  summary: VisionSessionSummary | null,
  offsetMs: number,
  recordingDurationMs: number,
): VisionSessionSummary | null {
  if (!summary) return null;
  const bounded = (value: number) => Math.max(0, Math.min(recordingDurationMs, value + offsetMs));
  return {
    ...summary,
    durationMs: recordingDurationMs,
    events: summary.events.map((event) => {
      const startMs = bounded(event.startMs);
      const endMs = Math.max(startMs, bounded(event.endMs));
      return { ...event, startMs, endMs, durationMs: endMs - startMs };
    }),
  };
}

function combineAudioSummaries(
  summaries: readonly AudioObservationSummary[],
): AudioObservationSummary | null {
  if (summaries.length === 0) return null;
  const pitchHzSamples = summaries.flatMap((summary) => [...summary.pitchHzSamples]);
  const energyRmsSamples = summaries.flatMap((summary) => [...summary.energyRmsSamples]);
  const meanPitchHz = pitchHzSamples.length > 0
    ? pitchHzSamples.reduce((total, value) => total + value, 0) / pitchHzSamples.length
    : null;
  const pitchStandardDeviationHz = meanPitchHz !== null && pitchHzSamples.length > 1
    ? Math.sqrt(
      pitchHzSamples.reduce((total, value) => total + (value - meanPitchHz) ** 2, 0)
        / (pitchHzSamples.length - 1),
    )
    : null;
  return {
    observedSeconds: summaries.reduce((total, summary) => total + summary.observedSeconds, 0),
    quietSeconds: summaries.reduce((total, summary) => total + summary.quietSeconds, 0),
    pauseSeconds: summaries.reduce((total, summary) => total + summary.pauseSeconds, 0),
    pauseCount: summaries.reduce((total, summary) => total + summary.pauseCount, 0),
    pitchSampleCount: pitchHzSamples.length,
    meanPitchHz,
    pitchStandardDeviationHz,
    pitchRangeHz: pitchHzSamples.length > 0
      ? Math.max(...pitchHzSamples) - Math.min(...pitchHzSamples)
      : null,
    pitchHzSamples,
    energyRmsSamples,
  };
}

function normalizedAnswerDuration(
  options: MultimodalStudioStopOptions | undefined,
  sessionDurationSeconds: number,
): number {
  const answerDurationSeconds = options?.answerDurationSeconds;
  if (answerDurationSeconds === undefined) return sessionDurationSeconds;
  if (!Number.isFinite(answerDurationSeconds) || answerDurationSeconds <= 0) {
    throw new MultimodalStudioSessionError(
      'invalid-stop-options',
      'Answer duration must be a positive finite number of seconds.',
    );
  }
  return answerDurationSeconds;
}

export function refreshMultimodalTranscript(
  result: MultimodalCapture,
  transcript: string,
): MultimodalAttemptResult {
  const nextTranscript = transcript.trim();
  const audio = result.audioSummary;
  return {
    ...result,
    transcript: nextTranscript,
    metrics: analyzeDeliveryMetrics({
      durationSeconds: result.durationSeconds,
      transcript: nextTranscript,
      audio: audio ? {
        pauseSeconds: audio.pauseSeconds,
        pitchHzSamples: audio.pitchHzSamples,
        energyRmsSamples: audio.energyRmsSamples,
      } : undefined,
      vision: observationFromVision(result.visionSummary),
    }),
  };
}

function drawOverlay(canvas: HTMLCanvasElement, frame: VisionFrameSnapshot): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = frame.tracked ? '#b6f23a' : '#ffcf47';
  context.fillStyle = '#b6f23a';
  context.lineWidth = 3;
  context.lineCap = 'round';

  const point = (index: number) => frame.landmarks[index];
  const line = (from: number, to: number) => {
    const left = point(from);
    const right = point(to);
    if (!left || !right) return;
    context.beginPath();
    context.moveTo(left.x * width, left.y * height);
    context.lineTo(right.x * width, right.y * height);
    context.stroke();
  };

  if (frame.mode === 'presentation') {
    for (const [from, to] of POSE_CONNECTIONS) line(from, to);
    for (const landmark of frame.landmarks) {
      if ((landmark.visibility ?? 1) < 0.5) continue;
      context.beginPath();
      context.arc(landmark.x * width, landmark.y * height, 3.5, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    for (let index = 1; index < FACE_OVAL.length; index += 1) {
      const from = FACE_OVAL[index - 1];
      const to = FACE_OVAL[index];
      if (from !== undefined && to !== undefined) line(from, to);
    }
    const last = FACE_OVAL[FACE_OVAL.length - 1];
    const first = FACE_OVAL[0];
    if (last !== undefined && first !== undefined) line(last, first);
    for (const index of [1, 33, 263, 61, 291]) {
      const landmark = point(index);
      if (!landmark) continue;
      context.beginPath();
      context.arc(landmark.x * width, landmark.y * height, 5, 0, Math.PI * 2);
      context.fill();
    }
  }
}

export const MultimodalStudio = forwardRef<MultimodalStudioHandle, MultimodalStudioProps>(
  function MultimodalStudio({
    transcript,
    language,
    durableRecordingAvailable = false,
    targetDurationMs = null,
    fixedMode,
    title: titleProp,
    description: descriptionProp,
    startLabel: startLabelProp,
    stopLabel: stopLabelProp,
    startDisabled = false,
    startDisabledReason: startDisabledReasonProp,
    resetToken,
    allowReplay = true,
    hideStopControl = false,
    startWithAnswerCapturePaused = false,
    onTranscriptChange,
    onResult,
    onBusyChange,
    onSessionStateChange,
  }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const visionRef = useRef<BrowserVisionSession | null>(null);
    const audioRef = useRef<AudioObserver | null>(null);
    const speechRef = useRef<SpeechRecognitionSession | null>(null);
    const recordingRef = useRef<RehearsalRecordingSession | null>(null);
    const startedAtRef = useRef(0);
    const activeRef = useRef(false);
    const loadingRef = useRef(false);
    const answerCapturePausedRef = useRef(false);
    const answerPausedAtElapsedMsRef = useRef<number | null>(null);
    const visionOffsetRef = useRef(0);
    const transcriptRef = useRef(transcript);
    const elapsedMsRef = useRef(0);
    const lastCaptureRef = useRef<MultimodalAttemptResult | null>(null);
    const audioSegmentsRef = useRef<AudioObservationSummary[]>([]);
    const audioSegmentOpenRef = useRef(false);
    const pitchSamplesRef = useRef<number[]>([]);
    const energySamplesRef = useRef<number[]>([]);
    const acousticDisruptionsRef = useRef(new SpeechDisruptionDetector({ ignoreBeforeMs: 3_000 }));
    const interimFillersRef = useRef(new InterimFillerTracker(3_000));
    const transcriptTimingRef = useRef(new TranscriptTimingTracker());
    // stopSession awaits the recorder before it clears `active`, so the bell
    // timer and the Finish button can both enter it. This latch closes the
    // door on the first caller; without it the second release runs against
    // already-released media.
    const stoppingRef = useRef(false);
    const stoppedAtLimitRef = useRef(false);

    // Four independent choices. None of them turns on another, and nothing is
    // requested from the browser until Start.
    const [captureCamera, setCaptureCamera] = useState(false);
    const [captureAcoustic, setCaptureAcoustic] = useState(false);
    const [captureDictation, setCaptureDictation] = useState(false);
    const [active, setActive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [answerCapturePaused, setAnswerCapturePaused] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [visionPhase, setVisionPhase] = useState<VisionPhase>('idle');
    const [speechState, setSpeechState] = useState<SpeechRecognitionState>('idle');
    const [frame, setFrame] = useState<VisionFrameSnapshot | null>(null);
    const t = useTranslations('studio');
    // Defaults resolved in the body, not in the parameter list: a default
    // value is evaluated before the hook exists, and a caller-supplied label
    // must still win over the translated one.
    const title = titleProp ?? t('rehearseWhole');
    const description = descriptionProp ?? t('subtitle');
    const startLabel = startLabelProp ?? t('startRehearsal');
    const stopLabel = stopLabelProp ?? t('finishAssemble');
    const startDisabledReason = startDisabledReasonProp ?? t('waitNarration');
    const [audioSample, setAudioSample] = useState<AudioObservationSample | null>(null);
    const [inputQuality, setInputQuality] = useState<InputQualityVerdict | null>(null);
    const [guessedPassages, setGuessedPassages] = useState(0);
    const qualityWindowRef = useRef<{ rms: number }[]>([]);
    const [speechDisruptionCount, setSpeechDisruptionCount] = useState(0);
    const [saveReplay, setSaveReplay] = useState(false);
    const [recordingState, setRecordingState] = useState<'off' | 'recording' | 'failed'>('off');
    const [status, setStatus] = useState(t('enableThenStart'));
    const [, setLastCapture] = useState<MultimodalAttemptResult | null>(null);
    const lastResetTokenRef = useRef(resetToken);
    const effectiveMode = fixedMode ?? 'presentation';

    function updateActive(next: boolean): void {
      activeRef.current = next;
      setActive(next);
    }

    function updateLoading(next: boolean): void {
      loadingRef.current = next;
      setLoading(next);
    }

    function updateAnswerCapturePaused(next: boolean): void {
      answerCapturePausedRef.current = next;
      setAnswerCapturePaused(next);
    }

    function sessionState(): MultimodalSessionState {
      const sessionStartedAtMs = startedAtRef.current > 0 ? startedAtRef.current : null;
      return {
        active: activeRef.current,
        transitionBusy: loadingRef.current,
        answerCapturePaused: answerCapturePausedRef.current,
        sessionStartedAtMs,
        elapsedMs: sessionStartedAtMs !== null && activeRef.current
          ? Math.max(0, performance.now() - sessionStartedAtMs)
          : elapsedMsRef.current,
      };
    }

    useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

    useEffect(() => {
      if (resetToken === undefined || resetToken === lastResetTokenRef.current) return;
      lastResetTokenRef.current = resetToken;
      if (active || loading) return;
      transcriptRef.current = transcript;
      setLastCapture(null);
      lastCaptureRef.current = null;
      elapsedMsRef.current = 0;
      setElapsedMs(0);
      setFrame(null);
      setAudioSample(null);
      setSpeechDisruptionCount(0);
      setStatus(t('enableThenStart'));
    }, [active, loading, resetToken, transcript]);

    useEffect(() => {
      if (!allowReplay) setSaveReplay(false);
    }, [allowReplay]);

    useEffect(() => { onBusyChange?.(active || loading); }, [active, loading, onBusyChange]);

    useEffect(() => {
      onSessionStateChange?.(sessionState());
      // Elapsed time is available synchronously through `getSessionState`; this
      // callback intentionally reports transitions rather than firing 4x/second.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, answerCapturePaused, loading, onSessionStateChange]);

    useEffect(() => {
      if (!active) return;
      const timer = window.setInterval(() => {
        const nextElapsedMs = performance.now() - startedAtRef.current;
        elapsedMsRef.current = nextElapsedMs;
        setElapsedMs(nextElapsedMs);
        // The bell. A presentation that runs past its limit is not a longer
        // presentation — it is a presentation the evaluator stopped, so the
        // capture stops itself the same way.
        if (
          targetDurationMs !== null
          && targetDurationMs > 0
          && nextElapsedMs >= targetDurationMs
          && !loadingRef.current
          && !stoppingRef.current
        ) {
          stoppedAtLimitRef.current = true;
          void stopSession();
        }
      }, 250);
      return () => window.clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, targetDurationMs]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (canvas && frame) drawOverlay(canvas, frame);
    }, [frame]);

    async function releaseMedia(): Promise<void> {
      speechRef.current?.dispose();
      speechRef.current = null;
      if (audioRef.current) await audioRef.current.dispose();
      audioRef.current = null;
      visionRef.current?.dispose();
      visionRef.current = null;
      await recordingRef.current?.dispose();
      recordingRef.current = null;
      for (const track of mediaStreamRef.current?.getTracks() ?? []) track.stop();
      mediaStreamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    function updateSpeechDisruptionCount(): void {
      setSpeechDisruptionCount(mergeSpeechDisruptionEvents(
        acousticDisruptionsRef.current.events(),
        interimFillersRef.current.events(),
      ).length);
    }

    async function finishAudioSegment(): Promise<void> {
      const audioObserver = audioRef.current;
      if (!audioObserver || !audioSegmentOpenRef.current) return;
      audioSegmentOpenRef.current = false;
      await audioObserver.stop();
      audioSegmentsRef.current.push(audioObserver.summary());
    }

    async function pauseAnswerCapture(): Promise<MultimodalAnswerCheckpoint> {
      if (!activeRef.current) {
        throw new MultimodalStudioSessionError(
          'invalid-state',
          'Start the multimodal session before pausing answer capture.',
        );
      }
      if (loadingRef.current) {
        throw new MultimodalStudioSessionError(
          'transition-busy',
          t('waitTransition'),
        );
      }
      if (answerCapturePausedRef.current) {
        return {
          elapsedMs: answerPausedAtElapsedMsRef.current ?? sessionState().elapsedMs,
          transcript: speechRef.current?.snapshot().transcript.trim() ?? transcriptRef.current.trim(),
        };
      }

      const answerEndedAtElapsedMs = sessionState().elapsedMs;
      answerPausedAtElapsedMsRef.current = answerEndedAtElapsedMs;
      updateLoading(true);
      // Gate callbacks before awaiting the native recognizer. Its final `onend`
      // event may arrive while Kato narration is already being prepared.
      updateAnswerCapturePaused(true);
      try {
        const speech = speechRef.current;
        const [snapshot] = await Promise.all([
          speech?.stop() ?? Promise.resolve(null),
          finishAudioSegment(),
        ]);
        const capturedTranscript = snapshot?.transcript.trim()
          || speech?.snapshot().transcript.trim()
          || transcriptRef.current.trim();
        if (capturedTranscript) {
          transcriptRef.current = capturedTranscript;
          onTranscriptChange(capturedTranscript);
        }
        setStatus(t('stillRunning'));
        return { elapsedMs: answerEndedAtElapsedMs, transcript: capturedTranscript };
      } finally {
        updateLoading(false);
      }
    }

    async function resumeAnswerCapture(
      options: MultimodalAnswerResumeOptions = {},
    ): Promise<MultimodalAnswerCheckpoint> {
      if (!activeRef.current) {
        throw new MultimodalStudioSessionError(
          'invalid-state',
          'Start the multimodal session before resuming answer capture.',
        );
      }
      if (loadingRef.current) {
        throw new MultimodalStudioSessionError(
          'transition-busy',
          t('waitTransition'),
        );
      }
      if (!answerCapturePausedRef.current) {
        return {
          elapsedMs: sessionState().elapsedMs,
          transcript: speechRef.current?.snapshot().transcript.trim() ?? transcriptRef.current.trim(),
        };
      }

      updateLoading(true);
      const resetTranscript = options.resetTranscript ?? true;
      try {
        if (resetTranscript) {
          transcriptRef.current = '';
          interimFillersRef.current.beginUtterance();
          speechRef.current?.clearTranscript();
          onTranscriptChange('');
        }
        // The caller resumes only after narration has ended. Flip this gate
        // immediately before the sources start so their first samples count.
        updateAnswerCapturePaused(false);
        const audioStarted = captureAcoustic && audioRef.current
          ? await audioRef.current.start()
          : false;
        audioSegmentOpenRef.current = audioStarted;
        if (captureDictation && speechRef.current?.supported) {
          speechRef.current.start({ resetTranscript });
        }
        answerPausedAtElapsedMsRef.current = null;
        setStatus(t('answerActive'));
        return {
          elapsedMs: sessionState().elapsedMs,
          transcript: speechRef.current?.snapshot().transcript.trim() ?? transcriptRef.current.trim(),
        };
      } catch (error) {
        updateAnswerCapturePaused(true);
        throw error;
      } finally {
        updateLoading(false);
      }
    }

    async function stopSession(
      options?: MultimodalStudioStopOptions,
    ): Promise<MultimodalAttemptResult | null> {
      if (!activeRef.current || stoppingRef.current) return lastCaptureRef.current;
      if (loadingRef.current) {
        throw new MultimodalStudioSessionError(
          'transition-busy',
          t('waitTransitionStop'),
        );
      }
      // Validate before stopping any native source. A bad coordinator payload
      // must not strand a live session half-closed.
      const requestedAnswerDuration = options?.answerDurationSeconds === undefined
        ? null
        : normalizedAnswerDuration(options, 1);
      stoppingRef.current = true;
      updateLoading(true);
      updateAnswerCapturePaused(true);
      const stoppedAtMs = performance.now();
      const elapsedDurationMs = Math.max(1_000, stoppedAtMs - startedAtRef.current);
      const recordingSession = recordingRef.current;
      const recordingPromise = recordingSession?.state === 'recording'
        ? recordingSession.stop().catch(() => null)
        : Promise.resolve(recordingSession?.lastRecording ?? null);
      const speech = speechRef.current;
      const speechSnapshot = await speech?.stop();
      const recognizedTranscript = speechSnapshot?.transcript.trim()
        || speech?.snapshot().transcript.trim()
        || '';
      const finalTranscript = options?.transcriptOverride !== undefined
        ? options.transcriptOverride.trim()
        : recognizedTranscript || transcriptRef.current.trim();
      const transcriptSource: CapturedTranscriptSource = recognizedTranscript ? 'web-speech' : 'typed';
      await finishAudioSegment();
      const audioSummary = combineAudioSummaries(audioSegmentsRef.current);
      acousticDisruptionsRef.current.finish(elapsedDurationMs);
      const speechDisruptions = mergeSpeechDisruptionEvents(
        acousticDisruptionsRef.current.events(),
        interimFillersRef.current.events(),
      );
      const rawVisionSummary = visionRef.current?.stop() ?? null;
      const recording = await recordingPromise;
      const sessionDurationMs = Math.max(1_000, recording?.durationMs ?? elapsedDurationMs);
      const sessionDurationSeconds = sessionDurationMs / 1_000;
      const durationSeconds = requestedAnswerDuration ?? sessionDurationSeconds;
      const visionSummary = alignVisionSummary(rawVisionSummary, visionOffsetRef.current, sessionDurationMs);
      const metrics = finalTranscript
        ? analyzeDeliveryMetrics({
          durationSeconds,
          transcript: finalTranscript,
          audio: audioSummary ? {
            pauseSeconds: audioSummary.pauseSeconds,
            pitchHzSamples: pitchSamplesRef.current,
            energyRmsSamples: energySamplesRef.current,
          } : undefined,
          vision: observationFromVision(visionSummary),
        })
        : null;
      await releaseMedia();
      updateActive(false);
      updateLoading(false);
      stoppingRef.current = false;
      elapsedMsRef.current = sessionDurationMs;
      setElapsedMs(sessionDurationMs);
      const stoppedAtLimit = stoppedAtLimitRef.current;
      setStatus(metrics
        ? stoppedAtLimit
          ? t('timeRanOut')
          : fixedMode === 'interview'
          ? t('interviewComplete')
          : t('captured')
        : t('noTranscript'));
      const capture: MultimodalCapture = {
        mode: effectiveMode,
        durationSeconds,
        sessionDurationSeconds,
        transcript: finalTranscript,
        transcriptSource,
        visionSummary,
        audioSummary,
        speechDisruptions,
        // Timing describes dictated text only. A typed draft shares no clock
        // with the recording, and guessing one would put marks at invented
        // moments.
        // A coordinator override (the interview flow) assembles several
        // answer-local transcripts. The recognizer points describe only its
        // current segment, so attaching them to that aggregate would invent
        // word positions. Keep presentation dictation timing, but withhold it
        // from an overridden transcript.
        transcriptTimingPoints: transcriptSource === 'web-speech'
          && options?.transcriptOverride === undefined
          ? transcriptTimingRef.current.points()
          : undefined,
        stoppedAtLimit,
        recording,
      };
      if (finalTranscript) {
        transcriptRef.current = finalTranscript;
        onTranscriptChange(finalTranscript);
      }
      const result = metrics ? { ...capture, metrics } : null;
      setLastCapture(result);
      lastCaptureRef.current = result;
      onResult(result);
      return result;
    }

    useImperativeHandle(ref, () => ({
      start: startSession,
      stop: stopSession,
      pauseAnswerCapture,
      resumeAnswerCapture,
      getSessionState: sessionState,
    }));

    useEffect(() => () => { void releaseMedia(); }, []);

    async function startSession(
      options: MultimodalStudioStartOptions = {},
    ): Promise<boolean> {
      if (activeRef.current || loadingRef.current) return false;
      if (!captureCamera && !captureAcoustic && !captureDictation && !saveReplay) {
        setStatus(t('enableOne'));
        return false;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus(t('mediaUnavailable'));
        return false;
      }
      const initiallyPaused = options.answerCapturePaused ?? false;
      updateLoading(true);
      updateAnswerCapturePaused(initiallyPaused);
      answerPausedAtElapsedMsRef.current = initiallyPaused ? 0 : null;
      setLastCapture(null);
      lastCaptureRef.current = null;
      elapsedMsRef.current = 0;
      onResult(null);
      setElapsedMs(0);
      setFrame(null);
      setAudioSample(null);
      setSpeechDisruptionCount(0);
      setRecordingState('off');
      visionOffsetRef.current = 0;
      pitchSamplesRef.current = [];
      energySamplesRef.current = [];
      audioSegmentsRef.current = [];
      audioSegmentOpenRef.current = false;
      acousticDisruptionsRef.current = new SpeechDisruptionDetector({ ignoreBeforeMs: 3_000 });
      interimFillersRef.current = new InterimFillerTracker(3_000);
      transcriptTimingRef.current = new TranscriptTimingTracker();
      stoppedAtLimitRef.current = false;
      stoppingRef.current = false;
      try {
        // A saved replay is camera plus microphone by definition, which is what
        // its own control says. Every other track is requested only because a
        // box next to it is ticked.
        const wantsVideo = captureCamera || saveReplay;
        const wantsAudio = captureAcoustic || captureDictation || saveReplay;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: wantsVideo
            ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 }, facingMode: 'user' }
            : false,
          audio: wantsAudio
            ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            : false,
        });
        mediaStreamRef.current = stream;
        const video = videoRef.current;
        if (wantsVideo && !video) throw new Error(t('previewNotReady'));

        const vision = captureCamera ? createVisionSession({
          mode: effectiveMode,
          maxFramesPerSecond: 8,
          onFrame: (nextFrame) => setFrame({
            ...nextFrame,
            timestampMs: Math.max(0, nextFrame.timestampMs + visionOffsetRef.current),
          }),
          onPhaseChange: setVisionPhase,
          onError: (error) => setStatus(`${error.message} Voice and transcript capture can continue.`),
        }) : null;
        visionRef.current = vision;

        const audio = captureAcoustic ? createAudioObserver(stream, {
          sampleIntervalMs: 100,
          onSample: (sample) => {
            if (answerCapturePausedRef.current) return;
            const alignedSample = {
              ...sample,
              timestampMs: Math.max(0, performance.now() - startedAtRef.current),
            };
            setAudioSample(alignedSample);
            const emitted = acousticDisruptionsRef.current.addSample(alignedSample);
            if (emitted.length > 0) updateSpeechDisruptionCount();
            if (sample.pitchHz !== null) pitchSamplesRef.current.push(sample.pitchHz);
            if (!sample.quiet) energySamplesRef.current.push(sample.rms);
            // Quality needs the quiet samples too — a floor that never drops
            // is the whole signal for a handled or vibrating mic — so this
            // keeps its own window rather than reusing energySamplesRef, which
            // filters silence out for the energy metric.
            qualityWindowRef.current.push({ rms: sample.rms });
            if (qualityWindowRef.current.length > QUALITY_WINDOW_SAMPLES) {
              qualityWindowRef.current.shift();
            }
            setInputQuality(assessInputQuality(qualityWindowRef.current));
          },
          onError: (failure) => setStatus(`${failure.message} The transcript and camera can continue.`),
        }) : null;
        audioRef.current = audio;

        const speech = captureDictation ? createSpeechRecognitionSession({
          language,
          onStateChange: setSpeechState,
          onTranscript: (snapshot) => {
            if (answerCapturePausedRef.current) return;
            const emitted = interimFillersRef.current.addInterimTranscript(
              snapshot.interimTranscript,
              Math.max(0, snapshot.observedAtMs - startedAtRef.current),
            );
            if (emitted.length > 0) updateSpeechDisruptionCount();
            // The recognizer reports how sure it was, per settled result. This
            // used to be discarded, so a guessed passage looked exactly like a
            // heard one — and INV-3 then quotes it back as the speaker's words.
            setGuessedPassages(snapshot.lowConfidenceRanges.length);
            const next = snapshot.transcript.trim();
            if (!next) return;
            transcriptTimingRef.current.addSnapshot(
              next,
              Math.max(0, snapshot.observedAtMs - startedAtRef.current),
            );
            transcriptRef.current = next;
            onTranscriptChange(next);
          },
          onError: (failure) => setStatus(`${failure.message} You can keep rehearsing and edit the transcript manually.`),
        }) : null;
        speechRef.current = speech;
        // Only dictation replaces the draft. Without it, whatever the student
        // already typed is the transcript and must survive the capture.
        if (speech) {
          onTranscriptChange('');
          transcriptRef.current = '';
        }

        if (vision && video) {
          setStatus(t('calibrating'));
          await vision.start({ video, stream });
        }

        let originMs = performance.now();
        if (saveReplay) {
          try {
            const recording = createRehearsalRecordingSession(stream, {
              onStateChange: (next) => {
                if (next === 'recording') setRecordingState('recording');
                if (next === 'error' || next === 'unsupported') setRecordingState('failed');
              },
              onError: (failure) => setStatus(`${failure.message} Camera observations and transcript capture can continue.`),
            });
            recordingRef.current = recording;
            recording.start();
            originMs = recording.startedAtMs ?? originMs;
          } catch {
            setRecordingState('failed');
          }
        }
        startedAtRef.current = originMs;
        visionOffsetRef.current = (vision?.startedAtMs ?? originMs) - originMs;
        updateActive(true);
        if (!initiallyPaused) {
          const audioStarted = audio ? await audio.start() : false;
          audioSegmentOpenRef.current = audioStarted;
        }
        if (!initiallyPaused && speech?.supported) speech.start({ resetTranscript: true });
        else if (captureDictation) setStatus(t('dictationUnsupported'));
        if (initiallyPaused) {
          setStatus(t('sessionPaused'));
        }
        return true;
      } catch (error) {
        await releaseMedia();
        updateActive(false);
        updateAnswerCapturePaused(false);
        answerPausedAtElapsedMsRef.current = null;
        startedAtRef.current = 0;
        setStatus(error instanceof Error ? error.message : t('startFailed'));
        return false;
      } finally {
        updateLoading(false);
      }
    }

    const liveVoice = audioSample ? Math.min(100, Math.max(4, audioSample.rms * 650)) : 4;
    const trackingLabel = frame?.tracked
      ? (frame.calibrated ? 'tracking locked' : 'calibrating')
      : visionPhase === 'loading' ? 'loading model' : 'find the camera frame';
    // With a limit set, the chip shows what is left rather than what is spent:
    // a presenter needs to know how much room remains, not how long they have
    // been talking. The last thirty seconds are called out because that is
    // when a closing has to start.
    const limitMs = targetDurationMs !== null && targetDurationMs > 0 ? targetDurationMs : null;
    const remainingMs = limitMs === null ? null : Math.max(0, limitMs - elapsedMs);
    const liveClock = remainingMs === null ? formatTime(elapsedMs) : formatTime(remainingMs);
    const closingSoon = remainingMs !== null && remainingMs <= 30_000;

    return <section className="multimodal-studio" aria-labelledby="studioTitle">
      <div className="studio-heading">
        {/* Not the stage heading: capture is one of two ways to fill the
            transcript, so focus after a step change belongs on the step's own
            title rather than on whichever sub-panel happens to be open. */}
        <div><p className="overline">{t('title')}</p><h3 id="studioTitle">{title}</h3><p>{description}</p></div>
        <span className={`studio-live${active ? ' is-live' : ''}${active && closingSoon ? ' is-closing' : ''}`}>
          <i />
          {active ? liveClock : 'ready'}
          {active && limitMs !== null && <small>{closingSoon ? 'left — start closing' : 'left'}</small>}
        </span>
      </div>
      {active && limitMs !== null && <p className="studio-limit-note" role="status">
        Capture stops itself at {formatTime(limitMs)}, the way an evaluator stops a pitch on time. Finish earlier whenever you are done.
      </p>}

      {!active && <fieldset className="studio-consent" disabled={loading}>
        <legend>{t('chooseObserve')}<small>every signal starts off</small></legend>
        {/* These concise, just-in-time choices are still four independent
            consents. Replay never inherits camera or microphone consent. */}
        <div className="studio-permission-strip">
          <label className="studio-permission-chip" title={t('localLandmarks')}><input type="checkbox" checked={captureCamera} onChange={(event) => setCaptureCamera(event.target.checked)} /><span><strong>{t('camera')}</strong><small>{t('cameraChip')}</small></span></label>
          <label className="studio-permission-chip" title={t('localPauses')}><input type="checkbox" checked={captureAcoustic} onChange={(event) => setCaptureAcoustic(event.target.checked)} /><span><strong>{t('voice')}</strong><small>{t('voiceChip')}</small></span></label>
          <label className="studio-permission-chip" title={speechRecognitionIsSupported() ? `Your browser vendor may process ${language === 'id-ID' ? t('indonesian') : t('english')} speech.` : t('dictationUnavailable')}><input type="checkbox" checked={captureDictation} disabled={!speechRecognitionIsSupported()} onChange={(event) => setCaptureDictation(event.target.checked)} /><span><strong>{t('liveTranscript')}</strong><small>{language === 'id-ID' ? t('indonesian') : t('english')}</small></span></label>
          {allowReplay && <label className="studio-recording-consent studio-permission-chip" title={durableRecordingAvailable ? t('uploadsPrivately') : t('keptInPage')}>
            <input type="checkbox" checked={saveReplay} onChange={(event) => setSaveReplay(event.target.checked)} />
            <span><strong>{t('saveReplay')}</strong><small>{t('replayChip')}</small></span>
          </label>}
        </div>
        <p className="studio-permission-boundary">{t('consentBoundary')}</p>
      </fieldset>}

      <div className="studio-stage">
        <video ref={videoRef} aria-label={t('liveCamera')} muted playsInline />
        <canvas ref={canvasRef} width="640" height="360" aria-hidden="true" />
        {!active && <div className="studio-camera-empty"><span aria-hidden="true">◉</span><strong>{t('noMediaBeforeStart')}</strong><small>{allowReplay ? t('localBoundary') : t('interviewBoundary')}</small></div>}
        {captureCamera && <div className="studio-hud"><span><i className={frame?.tracked ? 'good' : ''} />{trackingLabel}</span><span>{effectiveMode === 'presentation' ? '33-point pose' : 'face landmarks'}</span></div>}
        <InputQualityNotice verdict={inputQuality} />
        <GuessedPassageNotice count={guessedPassages} />
        {active && !answerCapturePaused && captureAcoustic && <div className="voice-meter" aria-label={t('liveVoiceLevel')}><span>{t('voiceLabel')}</span><i><b style={{ width: `${liveVoice}%` }} /></i><small>{audioSample?.pitchHz ? `${Math.round(audioSample.pitchHz)} Hz` : audioSample?.quiet ? 'pause' : 'listening'}</small><em>{speechDisruptionCount} possible cues</em></div>}
      </div>

      <div className="studio-controls">
        <span className="save-state">Project language: {language === 'id-ID' ? 'Bahasa Indonesia' : t('english')}</span>
        {!active
          ? <button className="button button-primary studio-record" type="button" disabled={startDisabled || loading || (!captureCamera && !captureAcoustic && !captureDictation && !saveReplay)} onClick={() => void startSession({ answerCapturePaused: startWithAnswerCapturePaused })}><span aria-hidden="true">●</span>{startDisabled ? startDisabledReason : loading ? t('loadingModels') : startLabel}</button>
          : hideStopControl
            ? <span className="studio-live"><i />{t('captureContinues')}</span>
            : <button className="button button-primary studio-stop" type="button" disabled={loading} onClick={() => void stopSession()}><span aria-hidden="true">■</span>{stopLabel === 'Finish & assemble review' ? <>{t('finishAssemble')}</> : stopLabel}</button>}
      </div>
      {active && saveReplay && <p className="recording-sync-status"><span aria-hidden="true">●</span>{recordingState === 'recording' ? ' Camera and microphone replay recording is active.' : ' Replay recording was unavailable; analysis is continuing.'}</p>}
      <p className="studio-status" aria-live="polite">{status} {active && !answerCapturePaused && captureDictation && speechRecognitionIsSupported() ? t('dictationStatus', { state: speechState }) : ''}</p>
    </section>;
  },
);

/* Legacy inline review removed: the evidence-first review lives in
 * `multimodal-review.tsx`, where it can stay small without coupling capture
 * permissions to review presentation. */
export { MultimodalReview } from './multimodal-review';
