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
  entriesBeyondLimit,
  segmentTranscript,
  summarizeRubricCoverage,
  type RubricTimelineEntry,
} from '@/lib/rehearsal/rubric-moments';
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
  durationSeconds: number;
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

export interface MultimodalStudioHandle {
  stop: () => Promise<MultimodalCapture | null>;
}

interface MultimodalStudioProps {
  transcript: string;
  durableRecordingAvailable?: boolean;
  /**
   * The stated time limit for this attempt. When set, the live chip counts
   * down to it and capture stops itself at zero, the way an evaluator stops a
   * pitch at the bell. Null leaves capture open-ended.
   */
  targetDurationMs?: number | null;
  onTranscriptChange: (value: string) => void;
  onResult: (result: MultimodalAttemptResult | null) => void;
  /** Lets the surrounding step disable its own controls while capture holds the devices. */
  onBusyChange?: (busy: boolean) => void;
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
  function MultimodalStudio({ transcript, durableRecordingAvailable = false, targetDurationMs = null, onTranscriptChange, onResult, onBusyChange }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const visionRef = useRef<BrowserVisionSession | null>(null);
    const audioRef = useRef<AudioObserver | null>(null);
    const speechRef = useRef<SpeechRecognitionSession | null>(null);
    const recordingRef = useRef<RehearsalRecordingSession | null>(null);
    const startedAtRef = useRef(0);
    const visionOffsetRef = useRef(0);
    const transcriptRef = useRef(transcript);
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

    const [mode, setMode] = useState<VisionMode>('presentation');
    // Four independent choices. None of them turns on another, and nothing is
    // requested from the browser until Start.
    const [captureCamera, setCaptureCamera] = useState(false);
    const [captureAcoustic, setCaptureAcoustic] = useState(false);
    const [captureDictation, setCaptureDictation] = useState(false);
    const [language, setLanguage] = useState('id-ID');
    const [active, setActive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [visionPhase, setVisionPhase] = useState<VisionPhase>('idle');
    const [speechState, setSpeechState] = useState<SpeechRecognitionState>('idle');
    const [frame, setFrame] = useState<VisionFrameSnapshot | null>(null);
    const [audioSample, setAudioSample] = useState<AudioObservationSample | null>(null);
    const [speechDisruptionCount, setSpeechDisruptionCount] = useState(0);
    const [saveReplay, setSaveReplay] = useState(false);
    const [recordingState, setRecordingState] = useState<'off' | 'recording' | 'failed'>('off');
    const [status, setStatus] = useState('Pick the signals you want observed. Nothing is requested until you press Start.');
    const [lastCapture, setLastCapture] = useState<MultimodalCapture | null>(null);

    useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

    useEffect(() => { onBusyChange?.(active || loading); }, [active, loading, onBusyChange]);

    useEffect(() => {
      if (!active) return;
      const timer = window.setInterval(() => {
        const elapsed = performance.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        // The bell. A presentation that runs past its limit is not a longer
        // presentation — it is a presentation the evaluator stopped, so the
        // capture stops itself the same way.
        if (targetDurationMs !== null && targetDurationMs > 0 && elapsed >= targetDurationMs) {
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

    async function stopSession(): Promise<MultimodalCapture | null> {
      if (!active || stoppingRef.current) return lastCapture;
      stoppingRef.current = true;
      setLoading(true);
      const stoppedAtMs = performance.now();
      const elapsedDurationMs = Math.max(1_000, stoppedAtMs - startedAtRef.current);
      const recordingSession = recordingRef.current;
      const recordingPromise = recordingSession?.state === 'recording'
        ? recordingSession.stop().catch(() => null)
        : Promise.resolve(recordingSession?.lastRecording ?? null);
      const speech = speechRef.current;
      speech?.stop();
      const recognizedTranscript = speech?.snapshot().transcript.trim() ?? '';
      const finalTranscript = recognizedTranscript || transcriptRef.current.trim();
      const transcriptSource: CapturedTranscriptSource = recognizedTranscript ? 'web-speech' : 'typed';
      const audioObserver = audioRef.current;
      await audioObserver?.stop();
      const audioSummary = audioObserver?.summary() ?? null;
      acousticDisruptionsRef.current.finish(elapsedDurationMs);
      const speechDisruptions = mergeSpeechDisruptionEvents(
        acousticDisruptionsRef.current.events(),
        interimFillersRef.current.events(),
      );
      const rawVisionSummary = visionRef.current?.stop() ?? null;
      const recording = await recordingPromise;
      const durationMs = Math.max(1_000, recording?.durationMs ?? elapsedDurationMs);
      const durationSeconds = durationMs / 1_000;
      const visionSummary = alignVisionSummary(rawVisionSummary, visionOffsetRef.current, durationMs);
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
      setActive(false);
      setLoading(false);
      stoppingRef.current = false;
      setElapsedMs(durationSeconds * 1_000);
      const stoppedAtLimit = stoppedAtLimitRef.current;
      setStatus(metrics
        ? stoppedAtLimit
          ? 'Time ran out and capture stopped itself, exactly as an evaluator would. Review the three evidence layers below.'
          : 'Rehearsal captured. Review the three evidence layers below.'
        : 'No transcript was captured. You can type one and review again.');
      const capture: MultimodalCapture = {
        mode,
        durationSeconds,
        transcript: finalTranscript,
        transcriptSource,
        visionSummary,
        audioSummary,
        speechDisruptions,
        // Timing describes dictated text only. A typed draft shares no clock
        // with the recording, and guessing one would put marks at invented
        // moments.
        transcriptTimingPoints: transcriptSource === 'web-speech'
          ? transcriptTimingRef.current.points()
          : undefined,
        stoppedAtLimit,
        recording,
      };
      if (finalTranscript) {
        transcriptRef.current = finalTranscript;
        onTranscriptChange(finalTranscript);
      }
      setLastCapture(capture);
      onResult(metrics ? { ...capture, metrics } : null);
      return capture;
    }

    useImperativeHandle(ref, () => ({ stop: stopSession }));

    useEffect(() => () => { void releaseMedia(); }, []);

    async function startSession(): Promise<void> {
      if (active || loading) return;
      if (!captureCamera && !captureAcoustic && !captureDictation && !saveReplay) {
        setStatus('Choose at least one observation, dictation, or replay option before starting.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('Camera and microphone capture are unavailable in this browser. Manual transcript review still works.');
        return;
      }
      setLoading(true);
      setLastCapture(null);
      onResult(null);
      setElapsedMs(0);
      setFrame(null);
      setAudioSample(null);
      setSpeechDisruptionCount(0);
      setRecordingState('off');
      visionOffsetRef.current = 0;
      pitchSamplesRef.current = [];
      energySamplesRef.current = [];
      acousticDisruptionsRef.current = new SpeechDisruptionDetector({ ignoreBeforeMs: 3_000 });
      interimFillersRef.current = new InterimFillerTracker(3_000);
      transcriptTimingRef.current = new TranscriptTimingTracker();
      stoppedAtLimitRef.current = false;
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
          mode,
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
            const emitted = interimFillersRef.current.addInterimTranscript(
              snapshot.interimTranscript,
              Math.max(0, snapshot.observedAtMs - startedAtRef.current),
            );
            if (emitted.length > 0) updateSpeechDisruptionCount();
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
        setActive(true);
        if (audio) await audio.start();
        if (speech?.supported) speech.start({ resetTranscript: true });
        else if (captureDictation) setStatus('Live browser dictation is unavailable here. The observations you selected are running; type the transcript afterward.');
      } catch (error) {
        await releaseMedia();
        setActive(false);
        setStatus(error instanceof Error ? error.message : 'The multimodal rehearsal could not start.');
      } finally {
        setLoading(false);
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
        <div><p className="overline">Experimental multimodal studio</p><h3 id="studioTitle">Rehearse the whole performance.</h3><p>Camera landmarks + acoustic observations + your active rubric, assembled into one review.</p></div>
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
        <legend>Choose what this rehearsal may observe</legend>
        {/* The split is the privacy boundary, not styling. Three signals are
            measured here and thrown away; one is kept. Saying which is which
            beside the checkbox beats burying it in four descriptions. */}
        <p className="studio-consent-band">Measured on this device, then discarded</p>
        <label><input type="checkbox" checked={captureCamera} onChange={(event) => setCaptureCamera(event.target.checked)} /><span><strong>Local camera landmarks</strong><small>Loads a self-hosted MediaPipe model. Frames and landmarks are discarded when capture stops.</small></span></label>
        {captureCamera && <div className="studio-mode-tabs" role="group" aria-label="Camera rehearsal mode">
          <button aria-pressed={mode === 'interview'} className={mode === 'interview' ? 'is-active' : ''} type="button" disabled={loading} onClick={() => setMode('interview')}><strong>Interview</strong><span>Face framing + head direction</span></button>
          <button aria-pressed={mode === 'presentation'} className={mode === 'presentation' ? 'is-active' : ''} type="button" disabled={loading} onClick={() => setMode('presentation')}><strong>Presentation</strong><span>Full body + gesture activity</span></button>
        </div>}
        <label><input type="checkbox" checked={captureAcoustic} onChange={(event) => setCaptureAcoustic(event.target.checked)} /><span><strong>Local acoustic observations</strong><small>Measures pauses, pitch range, and energy variation. Raw microphone audio is never recorded by this option.</small></span></label>
        <label><input type="checkbox" checked={captureDictation} disabled={!speechRecognitionIsSupported()} onChange={(event) => setCaptureDictation(event.target.checked)} /><span><strong>Browser dictation</strong><small>{speechRecognitionIsSupported() ? 'May send speech to your browser vendor. Recognized text is appended to your draft and may later go to the configured semantic provider.' : 'Unavailable in this browser. Type or paste the transcript instead.'}</small></span></label>

        <p className="studio-consent-band is-kept">Kept after this attempt</p>
        <label className="studio-recording-consent">
          <input type="checkbox" checked={saveReplay} onChange={(event) => setSaveReplay(event.target.checked)} />
          <span><strong>Keep a replay of this attempt</strong><small>{durableRecordingAvailable ? 'Records camera and microphone. A signed-in attempt uploads it to private storage; deleting a replay keeps its feedback.' : 'Records camera and microphone. This deployment keeps it in this page only, for review or download.'}</small></span>
        </label>
      </fieldset>}

      <div className="studio-stage">
        <video ref={videoRef} aria-label="Live rehearsal camera" muted playsInline />
        <canvas ref={canvasRef} width="640" height="360" aria-hidden="true" />
        {!active && <div className="studio-camera-empty"><span aria-hidden="true">◉</span><strong>No media access before Start</strong><small>Analysis runs on this device. A replay is created only when you explicitly ask for one above.</small></div>}
        {captureCamera && <div className="studio-hud"><span><i className={frame?.tracked ? 'good' : ''} />{trackingLabel}</span><span>{mode === 'presentation' ? '33-point pose' : 'face landmarks'}</span></div>}
        {active && captureAcoustic && <div className="voice-meter" aria-label="Live voice level"><span>VOICE</span><i><b style={{ width: `${liveVoice}%` }} /></i><small>{audioSample?.pitchHz ? `${Math.round(audioSample.pitchHz)} Hz` : audioSample?.quiet ? 'pause' : 'listening'}</small><em>{speechDisruptionCount} possible cues</em></div>}
      </div>

      <div className="studio-controls">
        <label>Dictation language<select value={language} disabled={active || loading || !captureDictation} onChange={(event) => setLanguage(event.target.value)}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English</option></select></label>
        {!active
          ? <button className="button button-primary studio-record" type="button" disabled={loading || (!captureCamera && !captureAcoustic && !captureDictation && !saveReplay)} onClick={() => void startSession()}><span aria-hidden="true">●</span>{loading ? 'Loading local models…' : 'Start selected capture'}</button>
          : <button className="button button-primary studio-stop" type="button" disabled={loading} onClick={() => void stopSession()}><span aria-hidden="true">■</span>Finish &amp; assemble review</button>}
      </div>
      {active && saveReplay && <p className="recording-sync-status"><span aria-hidden="true">●</span>{recordingState === 'recording' ? ' Camera and microphone replay recording is active.' : ' Replay recording was unavailable; analysis is continuing.'}</p>}
      <p className="studio-status" aria-live="polite">{status} {active && captureDictation && speechRecognitionIsSupported() ? `Dictation: ${speechState}. Browser dictation may use the browser vendor's speech service.` : ''}</p>
    </section>;
  },
);

export function MultimodalReview({
  result,
  substanceScore,
  recordingStatus,
  savedAttemptId,
  rubricTimeline,
  targetDurationMs,
  onRetakeCriterion,
}: Readonly<{
  result: MultimodalAttemptResult;
  substanceScore: number;
  recordingStatus?: string;
  savedAttemptId?: string | null;
  /** One entry per rubric criterion with its located citation, when supplied. */
  rubricTimeline?: readonly RubricTimelineEntry[];
  /** The stated limit for this attempt, drawn across every lane. */
  targetDurationMs?: number | null;
  /** Offered per criterion so a gap can be answered without a fresh 7 minutes. */
  onRetakeCriterion?: (entry: RubricTimelineEntry) => void;
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
  const timelineDurationMs = Math.max(1_000, result.durationSeconds * 1_000);
  const timelineLanes = [
    { id: 'voice' as const, label: 'Voice', events: replayEvents.filter((event) => event.lane === 'voice') },
    { id: 'camera' as const, label: 'Camera', events: replayEvents.filter((event) => event.lane === 'camera') },
  ].filter((lane) => lane.events.length > 0);

  // The rubric lanes sit above the delivery lanes on one clock, which is the
  // only way to see that the steadiest forty seconds proved nothing. Unlike
  // voice and camera, an empty rubric lane is never filtered out: the gap is
  // the finding, and a lane that disappears when it has nothing to say hides
  // exactly the criterion the student needs to see.
  const rubricEntries = rubricTimeline ?? [];
  const coverage = summarizeRubricCoverage(rubricEntries);
  const limitMs = targetDurationMs != null && targetDurationMs > 0 ? targetDurationMs : null;
  const cutPercent = limitMs !== null && limitMs < timelineDurationMs
    ? (limitMs / timelineDurationMs) * 100
    : null;
  const beyondTheBell = limitMs === null ? [] : entriesBeyondLimit(rubricEntries, limitMs);
  const transcriptSegments = segmentTranscript(result.transcript, rubricEntries);
  const markedSegmentCount = transcriptSegments.filter((segment) => segment.labels.length > 0).length;

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
    {(timelineLanes.length > 0 || rubricEntries.length > 0) && <section className="attempt-timeline" aria-labelledby="timelineTitle">
      <div className="section-title-row">
        <div><p className="overline">When the cues happened</p><h3 id="timelineTitle">Across the attempt</h3></div>
        <span className="timeline-duration">{formatTime(timelineDurationMs)} total{limitMs !== null ? ` · ${formatTime(limitMs)} limit` : ''}</span>
      </div>
      {rubricEntries.length > 0 && <>
        {/* The legend belongs beside the chart it explains, not in a caption
            further down: a reader meeting a filled block has to be told what
            filled means at the moment they meet it. */}
        <p className="timeline-legend">
          <span data-evidence="found"><i aria-hidden="true" />evidence cited</span>
          <span data-evidence="reused"><i aria-hidden="true" />quote shared with another criterion</span>
          <span data-evidence="absent"><i aria-hidden="true" />nothing cited</span>
          {cutPercent !== null && <span className="timeline-legend-cut"><i aria-hidden="true" />the limit</span>}
        </p>
        {rubricEntries.map((entry) => {
          const startMs = entry.evidence?.startMs ?? null;
          const endMs = entry.evidence?.endMs ?? startMs;
          return <div className="timeline-lane is-rubric" key={entry.criterionId}>
            <span className="timeline-lane-label" title={entry.label}>{entry.label}</span>
            <div className="timeline-track" data-evidence={entry.state}>
              {cutPercent !== null && <i className="timeline-cutline" style={{ left: `${cutPercent}%` }} aria-hidden="true" />}
              {startMs !== null
                ? <button
                  className="timeline-mark is-evidence"
                  type="button"
                  style={{
                    left: `${Math.min(99, (startMs / timelineDurationMs) * 100)}%`,
                    width: `${Math.max(((endMs ?? startMs) - startMs) / timelineDurationMs * 100, 1.5)}%`,
                  }}
                  onClick={() => playFrom(startMs)}
                  title={`${formatTime(startMs)} · ${entry.label}`}
                  aria-label={`Around ${formatTime(startMs)}, the cited evidence for ${entry.label}. ${recordingUrl ? 'Play the replay from two seconds before this.' : 'No replay was recorded for this attempt.'}`}
                  disabled={!recordingUrl}
                />
                : <span className="timeline-lane-note" data-evidence={entry.state}>
                  {entry.evidence
                    ? 'cited, but a typed transcript has no position on this clock'
                    : 'no evidence cited anywhere in this attempt'}
                </span>}
            </div>
          </div>;
        })}
        <p className="timeline-rubric-summary">
          {coverage.found + coverage.reused} of {coverage.total} criteria cite a span
          {coverage.absent > 0 ? `, and ${coverage.absent} cite nothing at all` : ''}.
          {coverage.timed > 0
            ? ` ${coverage.timed} could be placed on the clock from dictation timing, which is accurate to a second or two — enough to find the moment, not to sync a word.`
            : ' None could be placed on the clock, because this transcript was typed rather than dictated.'}
        </p>
      </>}
      {timelineLanes.map((lane) => (
        <div className="timeline-lane" key={lane.id}>
          <span className="timeline-lane-label">{lane.label}</span>
          <div className="timeline-track">
            {cutPercent !== null && <i className="timeline-cutline" style={{ left: `${cutPercent}%` }} aria-hidden="true" />}
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
      {limitMs !== null && <p className="timeline-bell-note" role="note">
        {cutPercent === null
          ? <>This attempt finished {formatTime(limitMs - timelineDurationMs)} inside the {formatTime(limitMs)} limit.</>
          : beyondTheBell.length > 0
            ? <>An evaluator who stops this attempt at {formatTime(limitMs)} never hears the cited evidence for <strong>{beyondTheBell.map((entry) => entry.label).join(', ')}</strong>.</>
            : coverage.timed > 0
              ? <>Every cited moment landed before the {formatTime(limitMs)} limit, though the attempt ran {formatTime(timelineDurationMs - limitMs)} past it.</>
              : <>This attempt ran {formatTime(timelineDurationMs - limitMs)} past the {formatTime(limitMs)} limit.</>}
      </p>}
      <p className="metrics-boundary">
        Each mark is a candidate the prototype thresholds flagged, placed where it occurred. The list below carries the same events as text.
      </p>
    </section>}

    {markedSegmentCount > 0 && <section className="transcript-evidence" aria-labelledby="transcriptEvidenceTitle">
      <div className="section-title-row">
        <div><p className="overline">Your exact words</p><h3 id="transcriptEvidenceTitle">Where each criterion was earned</h3></div>
        <span className="timeline-duration">{markedSegmentCount} marked {markedSegmentCount === 1 ? 'passage' : 'passages'}</span>
      </div>
      {/* Rendered as text nodes, never injected markup: the transcript is user
          input and INV-5 does not bend for a highlight. */}
      <p className="transcript-evidence-body">
        {transcriptSegments.map((segment, index) => {
          if (segment.labels.length === 0) return <span key={index}>{segment.text}</span>;
          const labels = segment.labels.join(' · ');
          return segment.startMs !== null && recordingUrl
            ? <button
              key={index}
              className="transcript-evidence-mark"
              type="button"
              onClick={() => playFrom(segment.startMs ?? 0)}
              title={`${labels} — play from ${formatTime(segment.startMs)}`}
            ><mark>{segment.text}</mark><small>{labels}</small></button>
            : <mark key={index} className="transcript-evidence-static" title={labels}>{segment.text}<small>{labels}</small></mark>;
        })}
      </p>
      <p className="metrics-boundary">
        Marked passages are the exact spans cited in the rubric evidence map, shown inside your own transcript. Nothing here is rewritten or corrected.
      </p>
    </section>}

    {onRetakeCriterion && rubricEntries.some((entry) => entry.state === 'absent') && <section className="criterion-retake" aria-labelledby="retakeTitle">
      <div className="section-title-row">
        <div><p className="overline">Fix the gap, not the whole take</p><h3 id="retakeTitle">Answer one criterion again</h3></div>
      </div>
      <p>A criterion with nothing cited does not need another full rehearsal. Record a short passage for it; the addition is kept separate from the original take and only that criterion is judged again.</p>
      <ul className="criterion-retake-list">
        {rubricEntries.filter((entry) => entry.state === 'absent').map((entry) => (
          <li key={entry.criterionId}>
            <span>{entry.label}</span>
            <button className="button button-secondary" type="button" onClick={() => onRetakeCriterion(entry)}>Record an addition</button>
          </li>
        ))}
      </ul>
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
