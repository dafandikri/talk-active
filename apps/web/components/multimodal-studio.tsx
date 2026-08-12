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
import {
  createAudioObserver,
  type AudioObservationSample,
  type AudioObserver,
} from '@/lib/rehearsal/audio-observer';
import {
  createSpeechRecognitionSession,
  speechRecognitionIsSupported,
  type SpeechRecognitionSession,
  type SpeechRecognitionState,
} from '@/lib/rehearsal/speech-recognition';
import {
  clampObservedSeconds,
  clearRawObservationRetention,
  deriveCaptureResultWithCleanup,
} from '@/lib/rehearsal/raw-observation-retention';
import {
  createVisionSession,
  type BrowserVisionSession,
  type VisionFrameSnapshot,
  type VisionMode,
  type VisionPhase,
  type VisionSessionSummary,
} from '@/lib/vision';

export interface MultimodalAttemptResult {
  captureId: string;
  mode: VisionMode;
  durationSeconds: number;
  transcript: string;
  transcriptSource: 'typed' | 'browser-dictation';
  metrics: DeliveryMetricsResult;
  visionSummary: VisionSessionSummary | null;
}

export interface MultimodalStudioHandle {
  stop: () => Promise<MultimodalAttemptResult | null>;
}

interface MultimodalStudioProps {
  transcript: string;
  onTranscriptChange: (value: string) => void;
  onResult: (result: MultimodalAttemptResult | null) => void;
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
  function MultimodalStudio({ transcript, onTranscriptChange, onResult, onBusyChange }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const visionRef = useRef<BrowserVisionSession | null>(null);
    const audioRef = useRef<AudioObserver | null>(null);
    const speechRef = useRef<SpeechRecognitionSession | null>(null);
    const startedAtRef = useRef(0);
    const transcriptRef = useRef(transcript);
    const dictationBaseRef = useRef('');
    const pitchSamplesRef = useRef<number[]>([]);
    const energySamplesRef = useRef<number[]>([]);
    const operationRef = useRef(0);
    const mountedRef = useRef(true);

    const [mode, setMode] = useState<VisionMode>('presentation');
    const [language, setLanguage] = useState('id-ID');
    const [captureCamera, setCaptureCamera] = useState(false);
    const [captureAcoustic, setCaptureAcoustic] = useState(false);
    const [captureDictation, setCaptureDictation] = useState(false);
    const [active, setActive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [visionPhase, setVisionPhase] = useState<VisionPhase>('idle');
    const [speechState, setSpeechState] = useState<SpeechRecognitionState>('idle');
    const [frame, setFrame] = useState<VisionFrameSnapshot | null>(null);
    const [audioSample, setAudioSample] = useState<AudioObservationSample | null>(null);
    const [status, setStatus] = useState('Choose a mode, then start a camera rehearsal.');

    useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
    useEffect(() => { onBusyChange?.(active || loading); }, [active, loading, onBusyChange]);

    useEffect(() => {
      if (!active) return;
      const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAtRef.current), 250);
      return () => window.clearInterval(timer);
    }, [active]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (canvas && frame) drawOverlay(canvas, frame);
    }, [frame]);

    function clearRawObservations(): void {
      clearRawObservationRetention({
        pitchSamples: pitchSamplesRef,
        energySamples: energySamplesRef,
        canvas: canvasRef.current,
        clearReactState: mountedRef.current,
        setFrame,
        setAudioSample,
      });
    }

    async function releaseMedia(): Promise<void> {
      const speech = speechRef.current;
      speechRef.current = null;
      const audio = audioRef.current;
      audioRef.current = null;
      const vision = visionRef.current;
      visionRef.current = null;
      const stream = mediaStreamRef.current;
      mediaStreamRef.current = null;
      try {
        speech?.dispose();
        if (audio) await audio.dispose();
        vision?.dispose();
      } finally {
        for (const track of stream?.getTracks() ?? []) track.stop();
        if (videoRef.current) videoRef.current.srcObject = null;
        startedAtRef.current = 0;
        clearRawObservations();
      }
    }

    async function stopSession(): Promise<MultimodalAttemptResult | null> {
      if (!active || loading || startedAtRef.current <= 0) return null;
      operationRef.current += 1;
      setLoading(true);
      let durationSeconds = Math.max(1, (performance.now() - startedAtRef.current) / 1_000);
      let derived: {
        dictated: string;
        finalTranscript: string;
        visionSummary: VisionSessionSummary | null;
        metrics: DeliveryMetricsResult | null;
      };
      try {
        derived = await deriveCaptureResultWithCleanup({
          derive: async () => {
            const speech = speechRef.current;
            const speechSnapshot = speech ? await speech.stop() : null;
            const dictated = speechSnapshot?.finalTranscript.trim() ?? '';
            const finalTranscript = dictated
              ? [dictationBaseRef.current.trim(), dictated].filter(Boolean).join('\n')
              : transcriptRef.current.trim();
            const audioObserver = audioRef.current;
            await audioObserver?.stop();
            durationSeconds = Math.max(1, (performance.now() - startedAtRef.current) / 1_000);
            const audioSummary = audioObserver?.summary() ?? null;
            const visionSummary = visionRef.current?.stop() ?? null;
            const metrics = finalTranscript
              ? analyzeDeliveryMetrics({
                durationSeconds,
                transcript: finalTranscript,
                audio: audioSummary ? {
                  pauseSeconds: clampObservedSeconds(audioSummary.pauseSeconds, durationSeconds),
                  pitchHzSamples: pitchSamplesRef.current,
                  energyRmsSamples: energySamplesRef.current,
                } : undefined,
                vision: observationFromVision(visionSummary),
              })
              : null;
            return { dictated, finalTranscript, visionSummary, metrics };
          },
          release: releaseMedia,
          reset: () => {
            if (mountedRef.current) {
              setActive(false);
              setLoading(false);
              setElapsedMs(durationSeconds * 1_000);
            }
          },
        });
      } catch (error) {
        if (mountedRef.current) {
          setStatus(error instanceof Error
            ? `The optional rehearsal capture could not stop cleanly: ${error.message}`
            : 'The optional rehearsal capture could not stop cleanly. Manual transcript review still works.');
          onResult(null);
        }
        return null;
      }
      const { dictated, finalTranscript, visionSummary, metrics } = derived;
      setStatus(metrics ? 'Local observations captured. They will appear as supporting context after rubric review.' : 'No transcript was captured. Type one to continue with rubric review.');
      if (!metrics) {
        onResult(null);
        return null;
      }
      const result: MultimodalAttemptResult = {
        captureId: crypto.randomUUID(),
        mode,
        durationSeconds,
        transcript: finalTranscript,
        transcriptSource: dictated ? 'browser-dictation' : 'typed',
        metrics,
        visionSummary,
      };
      transcriptRef.current = finalTranscript;
      onTranscriptChange(finalTranscript);
      onResult(result);
      return result;
    }

    useImperativeHandle(ref, () => ({ stop: stopSession }));

    useEffect(() => () => {
      mountedRef.current = false;
      operationRef.current += 1;
      void releaseMedia();
    }, []);

    async function startSession(): Promise<void> {
      if (active || loading) return;
      if (!captureCamera && !captureAcoustic && !captureDictation) {
        setStatus('Choose at least one local observation or browser dictation option first.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('Camera and microphone capture are unavailable in this browser. Manual transcript review still works.');
        return;
      }
      const operation = ++operationRef.current;
      setLoading(true);
      onResult(null);
      setElapsedMs(0);
      clearRawObservations();
      dictationBaseRef.current = transcriptRef.current;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: captureCamera
            ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 }, facingMode: 'user' }
            : false,
          audio: captureAcoustic || captureDictation
            ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            : false,
        });
        if (!mountedRef.current || operation !== operationRef.current) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        mediaStreamRef.current = stream;
        const video = videoRef.current;
        const starts: Promise<unknown>[] = [];
        startedAtRef.current = performance.now();

        if (captureCamera) {
          if (!video) throw new Error('Camera preview is not ready.');
          const vision = createVisionSession({
            mode,
            maxFramesPerSecond: 8,
            onFrame: (nextFrame) => {
              if (mountedRef.current && operation === operationRef.current) setFrame(nextFrame);
            },
            onPhaseChange: (nextPhase) => {
              if (mountedRef.current && operation === operationRef.current) setVisionPhase(nextPhase);
            },
            onError: (error) => {
              if (mountedRef.current && operation === operationRef.current) {
                setStatus(`${error.message} Other selected observations can continue.`);
              }
            },
          });
          visionRef.current = vision;
          starts.push(vision.start({ video, stream }));
        }

        if (captureAcoustic) {
          const audio = createAudioObserver(stream, {
            onSample: (sample) => {
              if (!mountedRef.current || operation !== operationRef.current) return;
              setAudioSample(sample);
              if (sample.pitchHz !== null) pitchSamplesRef.current.push(sample.pitchHz);
              if (!sample.quiet) energySamplesRef.current.push(sample.rms);
            },
            onError: (failure) => {
              if (mountedRef.current && operation === operationRef.current) {
                setStatus(`${failure.message} Other selected observations can continue.`);
              }
            },
          });
          audioRef.current = audio;
          starts.push(audio.start());
        }

        if (captureDictation) {
          const speech = createSpeechRecognitionSession({
            language,
            onStateChange: (nextState) => {
              if (mountedRef.current && operation === operationRef.current) setSpeechState(nextState);
            },
            onTranscript: (snapshot) => {
              const dictated = snapshot.transcript.trim();
              if (!dictated || !mountedRef.current || operation !== operationRef.current) return;
              const next = [dictationBaseRef.current.trim(), dictated].filter(Boolean).join('\n');
              transcriptRef.current = next;
              onTranscriptChange(next);
            },
            onError: (failure) => {
              if (mountedRef.current && operation === operationRef.current) {
                setStatus(`${failure.message} You can keep rehearsing and edit the transcript manually.`);
              }
            },
          });
          speechRef.current = speech;
        }

        await Promise.all(starts);
        if (!mountedRef.current || operation !== operationRef.current) {
          await releaseMedia();
          return;
        }
        if (captureDictation && speechRef.current?.supported) {
          speechRef.current.start({ resetTranscript: true });
        }
        setActive(true);
        setStatus(captureCamera
          ? 'Capturing. The first 3 seconds calibrate framing and movement thresholds.'
          : 'Capturing the selected microphone observations.');
      } catch (error) {
        await releaseMedia();
        if (mountedRef.current && operation === operationRef.current) {
          setActive(false);
          setStatus(error instanceof Error ? error.message : 'The optional rehearsal capture could not start. Manual transcript review still works.');
        }
      } finally {
        if (mountedRef.current && operation === operationRef.current) setLoading(false);
      }
    }

    const liveVoice = audioSample ? Math.min(100, Math.max(4, audioSample.rms * 650)) : 4;
    const trackingLabel = frame?.tracked
      ? (frame.calibrated ? 'tracking locked' : 'calibrating')
      : visionPhase === 'loading' ? 'loading model' : 'find the camera frame';

    return <section className="multimodal-studio" aria-labelledby="studioTitle">
      <div className="studio-heading">
        <div><p className="overline">Experimental local observations</p><h3 id="studioTitle">Add camera or voice context.</h3><p>Optional sensor observations stay separate from rubric evidence and never change its verdict.</p></div>
        <span className={`studio-live${active ? ' is-live' : ''}`}><i />{active ? formatTime(elapsedMs) : 'ready'}</span>
      </div>

      <div className="studio-mode-tabs" role="group" aria-label="Rehearsal mode">
        <button aria-pressed={mode === 'interview'} className={mode === 'interview' ? 'is-active' : ''} type="button" disabled={active || loading || !captureCamera} onClick={() => setMode('interview')}><strong>Interview</strong><span>Face framing + camera-facing head direction</span></button>
        <button aria-pressed={mode === 'presentation'} className={mode === 'presentation' ? 'is-active' : ''} type="button" disabled={active || loading || !captureCamera} onClick={() => setMode('presentation')}><strong>Presentation</strong><span>Body visibility + movement events</span></button>
      </div>

      {!active && <fieldset className="studio-consent" disabled={loading}>
        <legend>Choose each modality before permission is requested</legend>
        <label><input type="checkbox" checked={captureCamera} onChange={(event) => setCaptureCamera(event.target.checked)} /><span><strong>Local camera landmarks</strong><small>Loads a self-hosted MediaPipe model. Frames and landmarks are discarded when capture stops.</small></span></label>
        <label><input type="checkbox" checked={captureAcoustic} onChange={(event) => setCaptureAcoustic(event.target.checked)} /><span><strong>Local acoustic observations</strong><small>Measures pauses, pitch range, and energy variation. Raw microphone audio is never recorded or saved.</small></span></label>
        <label><input type="checkbox" checked={captureDictation} disabled={!speechRecognitionIsSupported()} onChange={(event) => setCaptureDictation(event.target.checked)} /><span><strong>Browser dictation</strong><small>{speechRecognitionIsSupported() ? 'May send speech to your browser vendor. Recognized text is appended to your draft and may later go to the configured semantic provider.' : 'Unavailable in this browser. Type or paste the transcript instead.'}</small></span></label>
      </fieldset>}

      <div className="studio-stage">
        <video ref={videoRef} aria-label="Live rehearsal camera" muted playsInline />
        <canvas ref={canvasRef} width="640" height="360" aria-hidden="true" />
        {!active && <div className="studio-camera-empty"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h4l2-2h4l2 2h4v12H4Z" /><circle cx="12" cy="13" r="4" /></svg></span><strong>No media access before Start</strong><small>Select modalities above. Typed transcript review remains available without them.</small></div>}
        {captureCamera && <div className="studio-hud"><span><i className={frame?.tracked ? 'good' : ''} />{trackingLabel}</span><span>{mode === 'presentation' ? '33-point pose' : 'face landmarks'}</span></div>}
        {active && captureAcoustic && <div className="voice-meter" role="progressbar" aria-label="Live microphone energy" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(liveVoice)}><span>MIC</span><i><b style={{ width: `${liveVoice}%` }} /></i><small>{audioSample?.pitchHz ? `${Math.round(audioSample.pitchHz)} Hz` : audioSample?.quiet ? 'pause' : 'listening'}</small></div>}
      </div>

      <div className="studio-controls">
        <label>Dictation language<select value={language} disabled={active || loading || !captureDictation} onChange={(event) => setLanguage(event.target.value)}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English</option></select></label>
        {!active
          ? <button className="button button-primary studio-record" type="button" disabled={loading || (!captureCamera && !captureAcoustic && !captureDictation)} onClick={() => void startSession()}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" /></svg>{loading ? 'Requesting access and loading…' : 'Start selected capture'}</button>
          : <button className="button button-primary studio-stop" type="button" disabled={loading} onClick={() => void stopSession()}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg>Finish local capture</button>}
      </div>
      <p className="studio-status" aria-live="polite">{status} {active && captureDictation ? `Browser dictation: ${speechState}.` : ''}</p>
    </section>;
  },
);

export function MultimodalReview({ result }: Readonly<{ result: MultimodalAttemptResult }>) {
  const visual = result.visionSummary;
  return <section className="surface multimodal-review">
    <div className="multimodal-review-heading"><div><p className="overline">Supporting delivery observations</p><h2>What the local sensors observed</h2><p>Kept separate from the rubric evidence verdict above.</p></div><span className="review-mode-chip">{result.mode}</span></div>
    <p className="delivery-boundary">These are raw, device-dependent observations—not a performance rating or a measure of confidence, personality, emotion, health, or speaking ability. They never change a rubric verdict.</p>
    <dl className="observation-summary-grid">
      <div><dt>Capture duration</dt><dd>{Math.round(result.durationSeconds)} seconds</dd></div>
      <div><dt>Available measurements</dt><dd>{result.metrics.measurementCoverage}%</dd></div>
      <div><dt>Storage</dt><dd>This review only</dd></div>
    </dl>
    <div className="observation-details">
      <div><h3>Voice observations</h3><ul>{result.metrics.vocal.metrics.map((metric) => <li key={metric.id}><span><strong>{metric.label}</strong><small>{metric.explanation}</small></span><b>{metric.observedValue === null ? 'not measured' : `${metric.observedValue} ${metric.unit}`}</b></li>)}</ul>{(result.metrics.fillers.length > 0 || result.metrics.repeatedWordEvents.length > 0) && <div className="event-timeline transcript-cue-list"><span>Transcript pattern timestamps</span>{result.metrics.fillers.map((filler) => <p key={filler.label}><time>filler</time><q>{filler.label}</q> × {filler.count}</p>)}{result.metrics.repeatedWordEvents.slice(0, 6).map((event) => <p key={`${event.word}-${event.tokenIndex}`}><time>{event.timestampSeconds === null ? `word ${event.tokenIndex + 1}` : formatTime(event.timestampSeconds * 1_000)}</time><q>{event.word}</q> repeated {event.additionalOccurrences + 1} times in sequence</p>)}</div>}</div>
      <div><h3>Camera observations</h3>{visual ? <><ul>{visual.mode === 'interview' ? <>
        <li><span><strong>Reliable face tracking</strong><small>Frames with usable landmarks</small></span><b>{visual.metrics.trackingCoveragePercent}%</b></li>
        <li><span><strong>Face framing</strong><small>Measured after calibration</small></span><b>{visual.metrics.framedPercent}%</b></li>
        <li><span><strong>Camera-facing head direction</strong><small>This is not eye contact</small></span><b>{visual.metrics.cameraFacingPercent ?? 'n/a'}{visual.metrics.cameraFacingPercent === null ? '' : '%'}</b></li>
      </> : <>
        <li><span><strong>Full-body visibility</strong><small>Complete pose inside the frame</small></span><b>{visual.metrics.fullBodyVisiblePercent}%</b></li>
        <li><span><strong>Hand visibility</strong><small>Both wrists tracked</small></span><b>{visual.metrics.handsVisiblePercent}%</b></li>
        <li><span><strong>Movement bursts</strong><small>Motion events, not gesture quality</small></span><b>{visual.metrics.gestureBurstCount}</b></li>
        <li><span><strong>Position changes</strong><small>Sustained lateral relocations</small></span><b>{visual.metrics.positionChangeCount}</b></li>
      </>}</ul>{visual.events.length > 0 && <div className="event-timeline"><span>Timestamp observations</span>{visual.events.slice(0, 6).map((event, index) => <p key={`${event.kind}-${event.startMs}-${index}`}><time>{formatTime(event.startMs)}</time>{event.label}</p>)}</div>}</> : <p className="observation-empty">Camera observations were unavailable for this attempt.</p>}</div>
    </div>
    <p className="metrics-boundary">{result.metrics.boundary} Only derived summaries remain in memory for this review; frames, landmark arrays, pitch samples, and raw audio are discarded when capture stops.</p>
  </section>;
}
