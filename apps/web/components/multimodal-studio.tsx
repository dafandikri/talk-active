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
  durationSeconds: number;
  transcript: string;
  transcriptSource: CapturedTranscriptSource;
  visionSummary: VisionSessionSummary | null;
  audioSummary: AudioObservationSummary | null;
  speechDisruptions?: readonly SpeechDisruptionEvent[];
}

export interface MultimodalAttemptResult extends MultimodalCapture {
  metrics: DeliveryMetricsResult;
}

export interface MultimodalStudioHandle {
  stop: () => Promise<MultimodalCapture | null>;
}

interface MultimodalStudioProps {
  transcript: string;
  onTranscriptChange: (value: string) => void;
  onResult: (result: MultimodalAttemptResult | null) => void;
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
  function MultimodalStudio({ transcript, onTranscriptChange, onResult }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const visionRef = useRef<BrowserVisionSession | null>(null);
    const audioRef = useRef<AudioObserver | null>(null);
    const speechRef = useRef<SpeechRecognitionSession | null>(null);
    const startedAtRef = useRef(0);
    const transcriptRef = useRef(transcript);
    const pitchSamplesRef = useRef<number[]>([]);
    const energySamplesRef = useRef<number[]>([]);
    const acousticDisruptionsRef = useRef(new SpeechDisruptionDetector({ ignoreBeforeMs: 3_000 }));
    const interimFillersRef = useRef(new InterimFillerTracker(3_000));

    const [mode, setMode] = useState<VisionMode>('presentation');
    const [language, setLanguage] = useState('id-ID');
    const [active, setActive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [visionPhase, setVisionPhase] = useState<VisionPhase>('idle');
    const [speechState, setSpeechState] = useState<SpeechRecognitionState>('idle');
    const [frame, setFrame] = useState<VisionFrameSnapshot | null>(null);
    const [audioSample, setAudioSample] = useState<AudioObservationSample | null>(null);
    const [speechDisruptionCount, setSpeechDisruptionCount] = useState(0);
    const [status, setStatus] = useState('Choose a mode, then start a camera rehearsal.');
    const [lastCapture, setLastCapture] = useState<MultimodalCapture | null>(null);

    useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

    useEffect(() => {
      if (!active) return;
      const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAtRef.current), 250);
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
      if (!active && !loading) return lastCapture;
      setLoading(true);
      const durationSeconds = Math.max(1, (performance.now() - startedAtRef.current) / 1_000);
      const speech = speechRef.current;
      speech?.stop();
      const recognizedTranscript = speech?.snapshot().transcript.trim() ?? '';
      const finalTranscript = recognizedTranscript || transcriptRef.current.trim();
      const transcriptSource: CapturedTranscriptSource = recognizedTranscript ? 'web-speech' : 'typed';
      const audioObserver = audioRef.current;
      await audioObserver?.stop();
      const audioSummary = audioObserver?.summary() ?? null;
      acousticDisruptionsRef.current.finish(durationSeconds * 1_000);
      const speechDisruptions = mergeSpeechDisruptionEvents(
        acousticDisruptionsRef.current.events(),
        interimFillersRef.current.events(),
      );
      const visionSummary = visionRef.current?.stop() ?? null;
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
      setElapsedMs(durationSeconds * 1_000);
      setStatus(metrics ? 'Rehearsal captured. Review the three evidence layers below.' : 'No transcript was captured. You can type one and review again.');
      const capture: MultimodalCapture = {
        mode,
        durationSeconds,
        transcript: finalTranscript,
        transcriptSource,
        visionSummary,
        audioSummary,
        speechDisruptions,
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
      pitchSamplesRef.current = [];
      energySamplesRef.current = [];
      acousticDisruptionsRef.current = new SpeechDisruptionDetector({ ignoreBeforeMs: 3_000 });
      interimFillersRef.current = new InterimFillerTracker(3_000);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        mediaStreamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error('Camera preview is not ready.');

        const vision = createVisionSession({
          mode,
          maxFramesPerSecond: 8,
          onFrame: setFrame,
          onPhaseChange: setVisionPhase,
          onError: (error) => setStatus(`${error.message} Voice and transcript capture can continue.`),
        });
        visionRef.current = vision;

        const audio = createAudioObserver(stream, {
          sampleIntervalMs: 100,
          onSample: (sample) => {
            setAudioSample(sample);
            const emitted = acousticDisruptionsRef.current.addSample(sample);
            if (emitted.length > 0) updateSpeechDisruptionCount();
            if (sample.pitchHz !== null) pitchSamplesRef.current.push(sample.pitchHz);
            if (!sample.quiet) energySamplesRef.current.push(sample.rms);
          },
          onError: (failure) => setStatus(`${failure.message} The transcript and camera can continue.`),
        });
        audioRef.current = audio;

        const speech = createSpeechRecognitionSession({
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
            transcriptRef.current = next;
            onTranscriptChange(next);
          },
          onError: (failure) => setStatus(`${failure.message} You can keep rehearsing and edit the transcript manually.`),
        });
        speechRef.current = speech;
        onTranscriptChange('');
        transcriptRef.current = '';

        startedAtRef.current = performance.now();
        setActive(true);
        setStatus('Calibrating for 3 seconds. Face the camera in a neutral starting position.');
        await Promise.all([vision.start({ video, stream }), audio.start()]);
        if (speech.supported) speech.start({ resetTranscript: true });
        else setStatus('Live browser dictation is unavailable here. Visual and voice measurements are running; type the transcript afterward.');
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

    return <section className="multimodal-studio" aria-labelledby="studioTitle">
      <div className="studio-heading">
        <div><p className="overline">Experimental multimodal studio</p><h3 id="studioTitle">Rehearse the whole performance.</h3><p>Camera landmarks + acoustic observations + your active rubric, assembled into one review.</p></div>
        <span className={`studio-live${active ? ' is-live' : ''}`}><i />{active ? formatTime(elapsedMs) : 'ready'}</span>
      </div>

      <div className="studio-mode-tabs" role="group" aria-label="Rehearsal mode">
        <button aria-pressed={mode === 'interview'} className={mode === 'interview' ? 'is-active' : ''} type="button" disabled={active || loading} onClick={() => setMode('interview')}><strong>Interview</strong><span>Face framing + head direction</span></button>
        <button aria-pressed={mode === 'presentation'} className={mode === 'presentation' ? 'is-active' : ''} type="button" disabled={active || loading} onClick={() => setMode('presentation')}><strong>Presentation</strong><span>Full body + gesture activity</span></button>
      </div>

      <div className="studio-stage">
        <video ref={videoRef} aria-label="Live rehearsal camera" muted playsInline />
        <canvas ref={canvasRef} width="640" height="360" aria-hidden="true" />
        {!active && <div className="studio-camera-empty"><span aria-hidden="true">◉</span><strong>Video analysis runs on this device</strong><small>Talk-Active does not save frames or raw audio.</small></div>}
        <div className="studio-hud"><span><i className={frame?.tracked ? 'good' : ''} />{trackingLabel}</span><span>{mode === 'presentation' ? '33-point pose' : 'face landmarks'}</span></div>
        {active && <div className="voice-meter" aria-label="Live voice level"><span>VOICE</span><i><b style={{ width: `${liveVoice}%` }} /></i><small>{audioSample?.pitchHz ? `${Math.round(audioSample.pitchHz)} Hz` : audioSample?.quiet ? 'pause' : 'listening'}</small><em>{speechDisruptionCount} possible cues</em></div>}
      </div>

      <div className="studio-controls">
        <label>Dictation language<select value={language} disabled={active || loading} onChange={(event) => setLanguage(event.target.value)}><option value="id-ID">Bahasa Indonesia</option><option value="en-US">English</option></select></label>
        {!active
          ? <button className="button button-primary studio-record" type="button" disabled={loading} onClick={() => void startSession()}><span aria-hidden="true">●</span>{loading ? 'Loading local models…' : 'Start camera rehearsal'}</button>
          : <button className="button button-primary studio-stop" type="button" disabled={loading} onClick={() => void stopSession()}><span aria-hidden="true">■</span>Finish &amp; assemble review</button>}
      </div>
      <p className="studio-status" aria-live="polite">{status} {active && speechRecognitionIsSupported() ? `Dictation: ${speechState}. Browser dictation may use the browser vendor's speech service.` : ''}</p>
    </section>;
  },
);

export function MultimodalReview({ result, substanceScore }: Readonly<{ result: MultimodalAttemptResult; substanceScore: number }>) {
  const visual = result.visionSummary;
  const vocalScore = result.metrics.vocal.rehearsalScore;
  const reliableVisualTracking = (visual?.metrics.trackingCoveragePercent ?? 0) >= 80;
  const speechDisruptions = result.speechDisruptions ?? [];
  const visualScore = reliableVisualTracking ? (result.metrics.visual?.rehearsalScore ?? null) : null;
  const availableDelivery = [vocalScore, visualScore].filter((value): value is number => value !== null);
  const deliveryMean = availableDelivery.length > 0
    ? availableDelivery.reduce((sum, value) => sum + value, 0) / availableDelivery.length
    : substanceScore;
  const overallGrade = Math.round((substanceScore * 0.5) + (deliveryMean * 0.5));
  const metricCards = [
    { label: 'Substance', value: substanceScore, note: 'Rubric evidence with cited transcript spans' },
    { label: 'Vocal delivery', value: vocalScore, note: `${result.metrics.fillerCount} transcript fillers · ${result.metrics.repeatedWordCount} adjacent repeats` },
    { label: 'Visual delivery', value: visualScore, note: reliableVisualTracking ? `${result.metrics.visual?.measurementCoverage ?? 0}% measurement coverage` : 'Insufficient reliable tracking; excluded from the overall grade' },
  ];
  return <section className="surface multimodal-review">
    <div className="multimodal-review-heading"><div><p className="overline">Multimodal performance map</p><h2>How the attempt came across</h2><p>50% rubric substance · 25% vocal signals · 25% visual signals</p></div><div className="overall-grade"><span>Overall rehearsal</span><strong>{overallGrade}</strong><small>/ 100</small></div></div>
    <p className="delivery-boundary">Experimental rehearsal grades from configured, inspectable thresholds. Missing sensors are excluded from the delivery mean. These grades describe observable camera, transcript, and acoustic signals—not emotion, confidence, health, or hiring suitability.</p>
    <div className="performance-score-grid">{metricCards.map((card) => <article key={card.label}><span>{card.label}</span><strong className={card.value === null ? 'is-text' : undefined}>{card.value === null ? 'insufficient' : card.value}</strong><small>{card.note}</small>{card.value !== null && <i><b style={{ width: `${card.value}%` }} /></i>}</article>)}</div>
    <div className="performance-details">
      <div><h3>Voice evidence</h3><ul>{result.metrics.vocal.metrics.map((metric) => <li key={metric.id}><span><strong>{metric.label}</strong><small>{metric.explanation}</small></span><b>{metric.observedValue === null ? 'not measured' : `${metric.observedValue} ${metric.unit}`}</b></li>)}</ul>{(result.metrics.fillers.length > 0 || result.metrics.repeatedWordEvents.length > 0) && <div className="event-timeline transcript-cue-list"><span>Transcript cue evidence</span>{result.metrics.fillers.map((filler) => <p key={filler.label}><time>filler</time><q>{filler.label}</q> × {filler.count}</p>)}{result.metrics.repeatedWordEvents.slice(0, 6).map((event) => <p key={`${event.word}-${event.tokenIndex}`}><time>{event.timestampSeconds === null ? `word ${event.tokenIndex + 1}` : formatTime(event.timestampSeconds * 1_000)}</time><q>{event.word}</q> repeated {event.additionalOccurrences + 1} times in sequence</p>)}</div>}<div className="event-timeline speech-disruption-list"><h4>Possible hesitation cues</h4><ul>{speechDisruptions.length > 0 ? speechDisruptions.slice(0, 8).map((event, index) => <li key={`${event.kind}-${event.startMs}-${index}`}><time>{formatTime(event.startMs)}</time><span><strong>{event.label}</strong><small>{event.evidence}</small></span></li>) : <li><time>—</time><span><strong>No audio or interim-dictation candidate crossed the prototype thresholds.</strong><small>Short or unvoiced hesitations may still be missed.</small></span></li>}</ul></div></div>
      <div><h3>Camera evidence</h3>{visual ? <><ul>{visual.mode === 'interview' ? <>
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
    <p className="metrics-boundary">{result.metrics.boundary} These audio and interim-dictation cues are experimental candidates, not a diagnosis; emphasis, held vowels, noise suppression, microphone gating, or ordinary phrasing can produce similar patterns. They do not change the vocal grade.</p>
  </section>;
}
