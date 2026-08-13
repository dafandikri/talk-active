'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import {
  analyzeDeliveryMetrics,
  type DeliveryMetricsResult,
  type VisionObservations,
} from '@/lib/delivery-metrics';
import { summarizeRehearsalReading } from '@/lib/rehearsal-reading';
import { MetricBand, ReadingComposition } from './delivery-charts';
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
  durableRecordingAvailable?: boolean;
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
    framedFrames: Math.round(summary.measuredFrames * summary.metrics.fullBodyVisiblePercent / 100),
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
    durableRecordingAvailable = false,
    fixedMode,
    title = 'Rehearse the whole performance.',
    description = 'Camera landmarks + acoustic observations + your active rubric, assembled into one review.',
    startLabel = 'Start selected capture',
    stopLabel = 'Finish & assemble review',
    startDisabled = false,
    startDisabledReason = 'Wait for narration to finish',
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

    const [mode, setMode] = useState<VisionMode>('presentation');
    // Four independent choices. None of them turns on another, and nothing is
    // requested from the browser until Start.
    const [captureCamera, setCaptureCamera] = useState(false);
    const [captureAcoustic, setCaptureAcoustic] = useState(false);
    const [captureDictation, setCaptureDictation] = useState(false);
    const [language, setLanguage] = useState('id-ID');
    const [active, setActive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [answerCapturePaused, setAnswerCapturePaused] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [visionPhase, setVisionPhase] = useState<VisionPhase>('idle');
    const [speechState, setSpeechState] = useState<SpeechRecognitionState>('idle');
    const [frame, setFrame] = useState<VisionFrameSnapshot | null>(null);
    const [audioSample, setAudioSample] = useState<AudioObservationSample | null>(null);
    const [speechDisruptionCount, setSpeechDisruptionCount] = useState(0);
    const [saveReplay, setSaveReplay] = useState(false);
    const [recordingState, setRecordingState] = useState<'off' | 'recording' | 'failed'>('off');
    const [status, setStatus] = useState('Pick the signals you want observed. Nothing is requested until you press Start.');
    const [, setLastCapture] = useState<MultimodalAttemptResult | null>(null);
    const lastResetTokenRef = useRef(resetToken);
    const effectiveMode = fixedMode ?? mode;

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
      setStatus('Pick the signals you want observed. Nothing is requested until you press Start.');
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
      }, 250);
      return () => window.clearInterval(timer);
    }, [active]);

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
          'Wait for the current capture transition to finish.',
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
        setStatus('Session is still running. Answer dictation and acoustic observations are paused; camera tracking and an optional replay continue.');
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
          'Wait for the current capture transition to finish.',
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
          interimFillersRef.current.reset();
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
        setStatus('Answer capture is active. Camera tracking and an optional replay continue across the whole session.');
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
      if (!activeRef.current) return lastCaptureRef.current;
      if (loadingRef.current) {
        throw new MultimodalStudioSessionError(
          'transition-busy',
          'Wait for the current capture transition to finish before stopping.',
        );
      }
      // Validate before stopping any native source. A bad coordinator payload
      // must not strand a live session half-closed.
      const requestedAnswerDuration = options?.answerDurationSeconds === undefined
        ? null
        : normalizedAnswerDuration(options, 1);
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
      elapsedMsRef.current = sessionDurationMs;
      setElapsedMs(sessionDurationMs);
      setStatus(metrics
        ? fixedMode === 'interview'
          ? 'Interview capture complete. Delivery observations stay hidden until the interview ends.'
          : 'Rehearsal captured. Review the three evidence layers below.'
        : 'No transcript was captured. You can type one and review again.');
      const capture: MultimodalCapture = {
        mode: effectiveMode,
        durationSeconds,
        sessionDurationSeconds,
        transcript: finalTranscript,
        transcriptSource,
        visionSummary,
        audioSummary,
        speechDisruptions,
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
        setStatus('Choose at least one observation, dictation, or replay option before starting.');
        return false;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('Camera and microphone capture are unavailable in this browser. Manual transcript review still works.');
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
        if (wantsVideo && !video) throw new Error('Camera preview is not ready.');

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
            const next = snapshot.transcript.trim();
            if (!next) return;
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
          setStatus('Calibrating for 3 seconds. Face the camera in a neutral starting position.');
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
        else if (captureDictation) setStatus('Live browser dictation is unavailable here. The observations you selected are running; type the transcript afterward.');
        if (initiallyPaused) {
          setStatus('Session is running. Answer dictation and acoustic observations are paused until the first answer begins.');
        }
        return true;
      } catch (error) {
        await releaseMedia();
        updateActive(false);
        updateAnswerCapturePaused(false);
        answerPausedAtElapsedMsRef.current = null;
        startedAtRef.current = 0;
        setStatus(error instanceof Error ? error.message : 'The multimodal rehearsal could not start.');
        return false;
      } finally {
        updateLoading(false);
      }
    }

    const liveVoice = audioSample ? Math.min(100, Math.max(4, audioSample.rms * 650)) : 4;
    const trackingLabel = frame?.tracked
      ? (frame.calibrated ? 'tracking locked' : 'calibrating')
      : visionPhase === 'loading' ? 'loading model' : 'find the camera frame';

    return <section className="multimodal-studio" aria-labelledby="studioTitle">
      <div className="studio-heading">
        <div><p className="overline">Experimental multimodal studio</p><h3 id="studioTitle">{title}</h3><p>{description}</p></div>
        <span className={`studio-live${active ? ' is-live' : ''}`}><i />{active ? formatTime(elapsedMs) : 'ready'}</span>
      </div>

      {!active && <fieldset className="studio-consent" disabled={loading}>
        <legend>Choose what this rehearsal may observe</legend>
        {/* The split is the privacy boundary, not styling. Three signals are
            measured here and thrown away; one is kept. Saying which is which
            beside the checkbox beats burying it in four descriptions. */}
        <p className="studio-consent-band">Measured on this device, then discarded</p>
        <label><input type="checkbox" checked={captureCamera} onChange={(event) => setCaptureCamera(event.target.checked)} /><span><strong>Local camera landmarks</strong><small>Loads a self-hosted MediaPipe model. Frames and landmarks are discarded when capture stops.</small></span></label>
        {captureCamera && !fixedMode && <div className="studio-mode-tabs" role="group" aria-label="Camera rehearsal mode">
          <button aria-pressed={mode === 'interview'} className={mode === 'interview' ? 'is-active' : ''} type="button" disabled={loading} onClick={() => setMode('interview')}><strong>Interview</strong><span>Face framing + head direction</span></button>
          <button aria-pressed={mode === 'presentation'} className={mode === 'presentation' ? 'is-active' : ''} type="button" disabled={loading} onClick={() => setMode('presentation')}><strong>Presentation</strong><span>Full body + gesture activity</span></button>
        </div>}
        <label><input type="checkbox" checked={captureAcoustic} onChange={(event) => setCaptureAcoustic(event.target.checked)} /><span><strong>Local acoustic observations</strong><small>Measures pauses, pitch range, and energy variation. Raw microphone audio is never recorded by this option.</small></span></label>
        <label><input type="checkbox" checked={captureDictation} disabled={!speechRecognitionIsSupported()} onChange={(event) => setCaptureDictation(event.target.checked)} /><span><strong>Browser dictation</strong><small>{speechRecognitionIsSupported() ? 'May send speech to your browser vendor. Recognized text is appended to your draft and may later go to the configured semantic provider.' : 'Unavailable in this browser. Type or paste the transcript instead.'}</small></span></label>

        {allowReplay && <><p className="studio-consent-band is-kept">Kept after this attempt</p>
        <label className="studio-recording-consent">
          <input type="checkbox" checked={saveReplay} onChange={(event) => setSaveReplay(event.target.checked)} />
          <span><strong>Keep a replay of this attempt</strong><small>{durableRecordingAvailable ? 'Records camera and microphone. A signed-in attempt uploads it to private storage; deleting a replay keeps its feedback.' : 'Records camera and microphone. This deployment keeps it in this page only, for review or download.'}</small></span>
        </label></>}
      </fieldset>}

      <div className="studio-stage">
        <video ref={videoRef} aria-label="Live rehearsal camera" muted playsInline />
        <canvas ref={canvasRef} width="640" height="360" aria-hidden="true" />
        {!active && <div className="studio-camera-empty"><span aria-hidden="true">◉</span><strong>No media access before Start</strong><small>{allowReplay ? 'Analysis runs on this device. A replay is created only when you explicitly ask for one above.' : 'Analysis runs on this device. This interview does not retain a camera or microphone replay.'}</small></div>}
        {captureCamera && <div className="studio-hud"><span><i className={frame?.tracked ? 'good' : ''} />{trackingLabel}</span><span>{effectiveMode === 'presentation' ? '33-point pose' : 'face landmarks'}</span></div>}
        {active && !answerCapturePaused && captureAcoustic && <div className="voice-meter" aria-label="Live voice level"><span>VOICE</span><i><b style={{ width: `${liveVoice}%` }} /></i><small>{audioSample?.pitchHz ? `${Math.round(audioSample.pitchHz)} Hz` : audioSample?.quiet ? 'pause' : 'listening'}</small><em>{speechDisruptionCount} possible cues</em></div>}
      </div>

      <div className="studio-controls">
        <label>Dictation language<select value={language} disabled={active || loading || !captureDictation} onChange={(event) => setLanguage(event.target.value)}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English</option></select></label>
        {!active
          ? <button className="button button-primary studio-record" type="button" disabled={startDisabled || loading || (!captureCamera && !captureAcoustic && !captureDictation && !saveReplay)} onClick={() => void startSession({ answerCapturePaused: startWithAnswerCapturePaused })}><span aria-hidden="true">●</span>{startDisabled ? startDisabledReason : loading ? 'Loading local models…' : startLabel}</button>
          : hideStopControl
            ? <span className="studio-live"><i />Capture continues until the interview ends</span>
            : <button className="button button-primary studio-stop" type="button" disabled={loading} onClick={() => void stopSession()}><span aria-hidden="true">■</span>{stopLabel === 'Finish & assemble review' ? <>Finish &amp; assemble review</> : stopLabel}</button>}
      </div>
      {active && saveReplay && <p className="recording-sync-status"><span aria-hidden="true">●</span>{recordingState === 'recording' ? ' Camera and microphone replay recording is active.' : ' Replay recording was unavailable; analysis is continuing.'}</p>}
      <p className="studio-status" aria-live="polite">{status} {active && !answerCapturePaused && captureDictation && speechRecognitionIsSupported() ? `Dictation: ${speechState}. Browser dictation may use the browser vendor's speech service.` : ''}</p>
    </section>;
  },
);

export function MultimodalReview({
  result,
  substanceScore,
  recordingStatus,
  savedAttemptId,
}: Readonly<{
  result: MultimodalAttemptResult;
  substanceScore: number;
  recordingStatus?: string;
  savedAttemptId?: string | null;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!result.recording) {
      setRecordingUrl(null);
      return;
    }
    const url = URL.createObjectURL(result.recording.blob);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result.recording]);
  const visual = result.visionSummary;
  const vocalScore = result.metrics.vocal.rehearsalScore;
  const trackingPercent = visual?.metrics.trackingCoveragePercent ?? 0;
  const reliableVisualTracking = trackingPercent >= 80;
  const speechDisruptions = result.speechDisruptions ?? [];
  const visualScore = reliableVisualTracking ? (result.metrics.visual?.rehearsalScore ?? null) : null;
  // The weighting is computed from what was actually measurable, not asserted.
  // This screen used to print a fixed "50 / 25 / 25" while the arithmetic
  // renormalized around a missing camera — so an attempt with no usable
  // landmarks showed a caption claiming a quarter of the figure came from a
  // signal that contributed nothing.
  const reading = summarizeRehearsalReading({
    substance: substanceScore,
    vocal: vocalScore,
    visual: visualScore,
    vocalExcludedReason: 'No transcript or acoustic timing was available to read.',
    visualExcludedReason: visual
      ? `Landmarks held for ${trackingPercent}% of sampled frames, below the 80% floor this reading requires.`
      : 'The camera was not part of this attempt.',
  });
  const replayEvents = [
    ...speechDisruptions.map((event, index) => ({
      key: `speech-${event.startMs}-${index}`,
      startMs: event.startMs,
      endMs: event.endMs,
      lane: 'voice' as const,
      label: event.label,
      detail: event.evidence,
      source: event.source === 'interim-transcript' ? 'dictation cue' : 'voice cue',
    })),
    ...(visual?.events ?? []).map((event, index) => ({
      key: `vision-${event.startMs}-${index}`,
      startMs: event.startMs,
      endMs: event.endMs,
      lane: 'camera' as const,
      label: event.label,
      detail: 'Camera-landmark observation. Review the surrounding context before interpreting it.',
      source: 'camera cue',
    })),
  ].sort((left, right) => left.startMs - right.startMs);
  // Where the cues fell across the attempt. Position is the whole point: a list
  // says a filler happened, a timeline says it happened four times in the last
  // thirty seconds, which is a different piece of advice.
  //
  // The lane carries the identity, so the marks are one hue. Two hues here would
  // be redundant with the lane label, and the obvious warm/green pair separates
  // at ΔE 4.2 under protanopia — invisible to a red-green colourblind reader.
  // Replay and sensor events span the whole conversation. Transcript-derived
  // delivery metrics may intentionally use only summed answer windows.
  const timelineDurationMs = Math.max(1_000, result.sessionDurationSeconds * 1_000);
  const timelineLanes = [
    { id: 'voice' as const, label: 'Voice', events: replayEvents.filter((event) => event.lane === 'voice') },
    { id: 'camera' as const, label: 'Camera', events: replayEvents.filter((event) => event.lane === 'camera') },
  ].filter((lane) => lane.events.length > 0);

  function playFrom(startMs: number) {
    const player = videoRef.current;
    if (!player) return;
    player.currentTime = Math.max(0, startMs / 1_000 - 2);
    void player.play();
  }
  return <section className="surface multimodal-review">
    <div className="multimodal-review-heading"><div><p className="overline">Multimodal performance map</p><h2>How the attempt came across</h2></div></div>
    <ReadingComposition reading={reading} headingId="rehearsalReadingLabel" />
    <p className="delivery-boundary"><strong>This number describes one rehearsal attempt, not your ability.</strong> The bar above is its whole arithmetic: each block is as wide as the share it carried and as full as it scored. Readings come from configured, inspectable thresholds, and every component below shows the evidence behind it. Signals that were not measured are excluded from the mean rather than counted as zero. These readings describe observable camera, transcript, and acoustic signals—not emotion, confidence, health, skill, or hiring suitability.</p>
    {recordingUrl && <section className="recording-review" aria-labelledby="replayTitle">
      <div><p className="overline">Attempt replay</p><h3 id="replayTitle">Review the moment, not just the number.</h3><p>Timestamp buttons start two seconds before each observation so you can judge the surrounding context yourself.</p></div>
      <video ref={videoRef} className="recording-player" src={recordingUrl} controls playsInline preload="metadata" aria-label="Recorded attempt replay" />
      <div className="recording-review-actions"><a className="button button-secondary" href={recordingUrl} download={`talk-active-attempt.${result.recording?.mimeType.includes('mp4') ? 'mp4' : 'webm'}`}>Download this replay</a>{savedAttemptId && <a className="text-button" href={`/attempts/${savedAttemptId}`}>Open saved review</a>}</div>
      {recordingStatus && <p className="recording-sync-status" role="status">{recordingStatus}</p>}
      <ol className="replay-timeline">{replayEvents.length > 0 ? replayEvents.map((event) => <li key={event.key}><button className="replay-event-button" type="button" onClick={() => playFrom(event.startMs)}><time>{formatTime(event.startMs)}</time><span><strong>{event.label}</strong><small>{event.source} · {event.detail}</small></span><b aria-hidden="true">Play →</b></button></li>) : <li><p>No timestamp observation crossed the prototype thresholds. You can still scrub the complete replay.</p></li>}</ol>
    </section>}
    {!recordingUrl && recordingStatus && <p className="recording-sync-status" role="status">{recordingStatus}</p>}
    {timelineLanes.length > 0 && <section className="attempt-timeline" aria-labelledby="timelineTitle">
      <div className="section-title-row">
        <div><p className="overline">When the cues happened</p><h3 id="timelineTitle">Across the attempt</h3></div>
        <span className="timeline-duration">{formatTime(timelineDurationMs)} total</span>
      </div>
      {timelineLanes.map((lane) => (
        <div className="timeline-lane" key={lane.id}>
          <span className="timeline-lane-label">{lane.label}</span>
          <div className="timeline-track">
            {lane.events.map((event) => {
              const left = Math.min(99, (event.startMs / timelineDurationMs) * 100);
              const span = Math.max(0, (event.endMs - event.startMs) / timelineDurationMs) * 100;
              return (
                <button
                  key={event.key}
                  className="timeline-mark"
                  type="button"
                  style={{ left: `${left}%`, width: `${Math.max(span, 1.5)}%` }}
                  onClick={() => playFrom(event.startMs)}
                  title={`${formatTime(event.startMs)} · ${event.label}`}
                  aria-label={`${formatTime(event.startMs)}, ${event.label}. ${recordingUrl ? 'Play the replay from two seconds before this.' : 'No replay was recorded for this attempt.'}`}
                  disabled={!recordingUrl}
                />
              );
            })}
          </div>
        </div>
      ))}
      <p className="timeline-axis" aria-hidden="true">
        <span>0:00</span><span>{formatTime(timelineDurationMs / 2)}</span><span>{formatTime(timelineDurationMs)}</span>
      </p>
      <p className="metrics-boundary">
        Each mark is a candidate the prototype thresholds flagged, placed where it occurred. The list below carries the same events as text.
      </p>
    </section>}

    <div className="performance-details">
      <div><h3>Voice evidence</h3><ul className="metric-band-list">{result.metrics.vocal.metrics.map((metric) => <MetricBand metric={metric} key={metric.id} />)}</ul>{(result.metrics.fillers.length > 0 || result.metrics.repeatedWordEvents.length > 0) && <div className="event-timeline transcript-cue-list"><span>Transcript cue evidence</span>{/* The quote and its count are one grid cell. Left as siblings they were a
    third child in a two-column grid, so every count wrapped onto its own
    row under the timestamp. */}
{result.metrics.fillers.map((filler) => <p key={filler.label}><time>filler</time><span><q>{filler.label}</q> × {filler.count}</span></p>)}{result.metrics.repeatedWordEvents.slice(0, 6).map((event) => <p key={`${event.word}-${event.tokenIndex}`}><time>{event.timestampSeconds === null ? `word ${event.tokenIndex + 1}` : formatTime(event.timestampSeconds * 1_000)}</time><span><q>{event.word}</q> repeated {event.additionalOccurrences + 1} times in sequence</span></p>)}</div>}<div className="event-timeline speech-disruption-list"><h4>Possible hesitation cues</h4><ul>{speechDisruptions.length > 0 ? speechDisruptions.slice(0, 8).map((event, index) => <li key={`${event.kind}-${event.startMs}-${index}`}><time>{formatTime(event.startMs)}</time><span><strong>{event.label}</strong><small>{event.evidence}</small></span></li>) : <li><time>—</time><span><strong>No audio or interim-dictation candidate crossed the prototype thresholds.</strong><small>Short or unvoiced hesitations may still be missed.</small></span></li>}</ul></div></div>
      <div><h3>Camera evidence</h3>{visual ? <>{result.metrics.visual && <ul className="metric-band-list">{result.metrics.visual.metrics.map((metric) => <MetricBand metric={metric} key={metric.id} />)}</ul>}<ul className="raw-observation-list">{visual.mode === 'interview' ? <>
        <li><span><strong>Reliable face tracking</strong><small>Frames with usable landmarks</small></span><b>{visual.metrics.trackingCoveragePercent}%</b></li>
        <li><span><strong>Face framing</strong><small>Measured after calibration</small></span><b>{visual.metrics.framedPercent}%</b></li>
        <li><span><strong>Camera-facing head direction</strong><small>This is not eye contact</small></span><b>{visual.metrics.cameraFacingPercent ?? 'n/a'}{visual.metrics.cameraFacingPercent === null ? '' : '%'}</b></li>
      </> : <>
        <li><span><strong>Full-body visibility</strong><small>Complete pose inside the frame</small></span><b>{visual.metrics.fullBodyVisiblePercent}%</b></li>
        <li><span><strong>Hand visibility</strong><small>Both wrists tracked</small></span><b>{visual.metrics.handsVisiblePercent}%</b></li>
        <li><span><strong>Movement bursts</strong><small>Motion events, not gesture quality</small></span><b>{visual.metrics.gestureBurstCount}</b></li>
        <li><span><strong>Position changes</strong><small>Sustained lateral relocations</small></span><b>{visual.metrics.positionChangeCount}</b></li>
      </>}</ul>{visual.events.length > 0 && <div className="event-timeline"><span>Timestamp evidence</span>{visual.events.slice(0, 6).map((event, index) => <p key={`${event.kind}-${event.startMs}-${index}`}><time>{formatTime(event.startMs)}</time>{event.label}</p>)}</div>}</> : <p className="performance-empty">Camera observations were unavailable for this attempt.</p>}</div>
    </div>
    <p className="metrics-boundary">{result.metrics.boundary} These audio and interim-dictation cues are experimental candidates, not a diagnosis; emphasis, held vowels, noise suppression, microphone gating, or ordinary phrasing can produce similar patterns. They do not change the vocal reading.</p>
  </section>;
}
