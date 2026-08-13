'use client';

import { useEffect, useRef, useState } from 'react';

import { MetricBand, ReadingComposition } from './delivery-charts';
import type { MultimodalAttemptResult } from './multimodal-studio';
import type { DeliveryMetricResult } from '@/lib/delivery-metrics';
import { summarizeRehearsalReading } from '@/lib/rehearsal-reading';
import {
  entriesBeyondLimit,
  segmentTranscript,
  summarizeRubricCoverage,
  type RubricTimelineEntry,
} from '@/lib/rehearsal/rubric-moments';

export interface MultimodalReviewProps {
  result: MultimodalAttemptResult;
  substanceScore: number;
  recordingStatus?: string;
  savedAttemptId?: string | null;
  projectId?: string | null;
  /** One entry per rubric criterion with its located citation, when supplied. */
  rubricTimeline?: readonly RubricTimelineEntry[];
  /** The stated limit for this attempt, drawn across every lane. */
  targetDurationMs?: number | null;
  /** Offered per criterion so a gap can be answered without a fresh full take. */
  onRetakeCriterion?: (entry: RubricTimelineEntry) => void;
}

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function metricIsException(metric: DeliveryMetricResult): boolean {
  if (metric.observedValue === null) return true;
  return metric.observedValue < metric.band.targetFrom || metric.observedValue > metric.band.targetTo;
}

/**
 * Delivery context rendered after the primary rubric evidence and judge question.
 *
 * This component deliberately owns only the supporting review surface. The
 * caller keeps exact rubric verdicts, missing cues, and the judge question above
 * it; this surface then provides one shared clock, replay on demand, and raw
 * browser observations behind disclosure (AD-14).
 */
export function MultimodalReview({
  result,
  substanceScore,
  recordingStatus,
  savedAttemptId,
  projectId,
  rubricTimeline,
  targetDurationMs,
  onRetakeCriterion,
}: Readonly<MultimodalReviewProps>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const replayDetailsRef = useRef<HTMLDetailsElement>(null);
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
  const timelineDurationMs = Math.max(1_000, result.sessionDurationSeconds * 1_000);
  const timelineLanes = [
    { id: 'voice' as const, label: 'Voice', events: replayEvents.filter((event) => event.lane === 'voice') },
    { id: 'camera' as const, label: 'Camera', events: replayEvents.filter((event) => event.lane === 'camera') },
  ];
  const rubricEntries = rubricTimeline ?? [];
  const coverage = summarizeRubricCoverage(rubricEntries);
  const limitMs = targetDurationMs != null && targetDurationMs > 0 ? targetDurationMs : null;
  const cutPercent = limitMs !== null && limitMs < timelineDurationMs
    ? (limitMs / timelineDurationMs) * 100
    : null;
  const beyondTheBell = limitMs === null ? [] : entriesBeyondLimit(rubricEntries, limitMs);
  const transcriptSegments = segmentTranscript(result.transcript, rubricEntries);
  const markedSegmentCount = transcriptSegments.filter((segment) => segment.labels.length > 0).length;
  const missingCriteria = rubricEntries.filter((entry) => entry.state === 'absent');
  const allMetrics = [
    ...result.metrics.vocal.metrics,
    ...(result.metrics.visual?.metrics ?? []),
  ];
  // "Outside its band" and "never measured" are different facts and were being
  // counted as one. A reading nothing observed is not an exception to practise
  // against; it is a hole in the evidence, and it belongs in its own sentence.
  const measuredMetrics = allMetrics.filter((metric) => metric.observedValue !== null);
  const outsideBandMetrics = measuredMetrics.filter(metricIsException);
  const unmeasuredMetrics = allMetrics.filter((metric) => metric.observedValue === null);

  function playFrom(startMs: number) {
    const player = videoRef.current;
    if (!player || !recordingUrl) return;
    if (replayDetailsRef.current) replayDetailsRef.current.open = true;
    player.currentTime = Math.max(0, startMs / 1_000 - 2);
    void player.play().catch(() => undefined);
  }

  return <section className="surface multimodal-review" aria-labelledby="deliveryReviewTitle">
    <div className="multimodal-review-heading">
      <div>
        <p className="overline">Supporting delivery context</p>
        <h2 id="deliveryReviewTitle">Inspect the moments that may need another look.</h2>
        <p>Rubric evidence and the next judge question stay above this panel. The observations here never change those verdicts.</p>
      </div>
    </div>
    <p className="review-delivery-boundary"><strong>Boundary:</strong> These deterministic readings describe one rehearsal attempt, not the speaker. They do not measure confidence, ability, truth, emotion, personality, intent, health, skill, or hiring suitability.</p>

    {onRetakeCriterion && missingCriteria.length > 0 && <section className="review-retake-strip" aria-labelledby="retakeTitle">
      <div><p className="overline">Fix one evidence gap</p><h3 id="retakeTitle">Add the missing claim without repeating the whole take.</h3></div>
      <ul>{missingCriteria.map((entry) => <li key={entry.criterionId}>
        <span>{entry.label}</span>
        <button className="button button-secondary" type="button" onClick={() => onRetakeCriterion(entry)}>Record an addition</button>
      </li>)}</ul>
    </section>}

    <section className="review-unified-timeline" aria-labelledby="timelineTitle">
      <div className="section-title-row">
        <div><p className="overline">One synchronized timeline</p><h3 id="timelineTitle">Rubric, voice, and camera on one clock</h3></div>
        <span className="timeline-duration">{formatTime(timelineDurationMs)} total{limitMs !== null ? ` · ${formatTime(limitMs)} limit` : ''}</span>
      </div>
      <p className="timeline-legend">
        <span data-evidence="found"><i aria-hidden="true" />evidence cited</span>
        <span data-evidence="reused"><i aria-hidden="true" />quote shared with another criterion</span>
        <span data-evidence="absent"><i aria-hidden="true" />nothing cited</span>
        <span className="timeline-legend-observation"><i aria-hidden="true" />browser observation</span>
        {cutPercent !== null && <span className="timeline-legend-cut"><i aria-hidden="true" />stated limit</span>}
      </p>
      {/* One lane per criterion, and never a lane that hides because it has
          nothing to say. Folding the whole rubric into a single "Rubric" track
          made every criterion look identical and made an uncited one vanish
          entirely — which is precisely the criterion the student needs to see.
          The empty lane IS the finding, so it stays on screen and says so. */}
      <div className="attempt-timeline review-attempt-timeline" aria-label={`Timeline lasting ${formatTime(timelineDurationMs)} with rubric, voice, and camera lanes`}>
        {rubricEntries.map((entry) => {
          const startMs = entry.evidence?.startMs ?? null;
          const endMs = entry.evidence?.endMs ?? startMs;
          return <div className="timeline-lane is-rubric" key={entry.criterionId}>
            <span className="timeline-lane-label" title={entry.label}>{entry.label}</span>
            <div
              className="timeline-track"
              data-evidence={entry.state}
              aria-label={`${entry.label}: ${entry.state === 'absent' ? 'no evidence cited' : entry.state === 'reused' ? 'cites a quote shared with another criterion' : 'evidence cited'}`}
            >
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
                  aria-label={`Around ${formatTime(startMs)}, cited evidence for ${entry.label}. ${recordingUrl ? 'Play from two seconds before this.' : 'No replay was recorded.'}`}
                  disabled={!recordingUrl}
                />
                : <span className="timeline-lane-note" data-evidence={entry.state}>
                  {entry.evidence
                    ? 'cited; this transcript has no clock position'
                    : 'no evidence cited'}
                </span>}
            </div>
          </div>;
        })}
        {timelineLanes.map((lane) => <div className="timeline-lane" key={lane.id}>
          <span className="timeline-lane-label">{lane.label}</span>
          <div className="timeline-track" aria-label={`${lane.label}: ${lane.events.length} timestamped ${lane.events.length === 1 ? 'cue' : 'cues'}`}>
            {cutPercent !== null && <i className="timeline-cutline" style={{ left: `${cutPercent}%` }} aria-hidden="true" />}
            {lane.events.length === 0 && <span className="timeline-lane-note">No timestamped cue</span>}
            {lane.events.map((event) => {
              const left = Math.min(99, (event.startMs / timelineDurationMs) * 100);
              const span = Math.max(0, (event.endMs - event.startMs) / timelineDurationMs) * 100;
              return <button
                key={event.key}
                className="timeline-mark"
                type="button"
                style={{ left: `${left}%`, width: `${Math.max(span, 1.5)}%` }}
                onClick={() => playFrom(event.startMs)}
                title={`${formatTime(event.startMs)} · ${event.label}`}
                aria-label={`${formatTime(event.startMs)}, ${event.label}. ${recordingUrl ? 'Play from two seconds before this.' : 'No replay was recorded.'}`}
                disabled={!recordingUrl}
              />;
            })}
          </div>
        </div>)}
        <p className="timeline-axis" aria-hidden="true"><span>0:00</span><span>{formatTime(timelineDurationMs / 2)}</span><span>{formatTime(timelineDurationMs)}</span></p>
      </div>
      <p className="timeline-rubric-summary">{coverage.found + coverage.reused} of {coverage.total} criteria cite a span. {coverage.timed > 0 ? `${coverage.timed} could be placed on the clock from coarse dictation timing; use it to find the moment, not to sync a word.` : 'No citation was assigned a clock position; none is invented.'}</p>
      {limitMs !== null && <p className="timeline-bell-note" role="note">
        {cutPercent === null
          ? <>This attempt finished {formatTime(limitMs - timelineDurationMs)} inside the {formatTime(limitMs)} limit.</>
          : beyondTheBell.length > 0
            ? <>An evaluator stopping at {formatTime(limitMs)} never hears the cited evidence for <strong>{beyondTheBell.map((entry) => entry.label).join(', ')}</strong>.</>
            : coverage.timed > 0
              ? <>Every timed citation landed before the limit, though the attempt ran {formatTime(timelineDurationMs - limitMs)} over.</>
              : <>This attempt ran {formatTime(timelineDurationMs - limitMs)} over the limit.</>}
      </p>}

      {/* Drawn, not tabulated. "178 words/min · band 105–165" made the reader
          do the comparison; the dot's distance from the shaded band answers
          "how far out, and which way" without arithmetic. Only the readings
          that left their band are drawn here — the complete set stays one
          disclosure below, so the summary is a summary. */}
      <div className="review-exception-summary" aria-labelledby="exceptionTitle">
        <div className="review-exception-head">
          <span>Delivery exceptions</span>
          <h4 id="exceptionTitle">{outsideBandMetrics.length > 0
            ? `${outsideBandMetrics.length} of ${measuredMetrics.length} measured readings left their practice band`
            : measuredMetrics.length > 0
              ? `All ${measuredMetrics.length} measured readings stayed inside their practice band`
              : 'Nothing measurable was observed in this attempt'}</h4>
          <p>The shaded zone is the configured practice band; the mark is this attempt. A threshold comparison, not a pass or a fail.</p>
          {unmeasuredMetrics.length > 0 && <p className="review-exception-unmeasured">
            <strong>Not measured:</strong> {unmeasuredMetrics.map((metric) => metric.label).join(', ')}. These are excluded from every reading rather than scored as zero.
          </p>}
        </div>
        {outsideBandMetrics.length > 0 && <ul className="metric-band-list">
          {outsideBandMetrics.map((metric) => <MetricBand metric={metric} key={metric.id} />)}
        </ul>}
      </div>

      <details className="review-disclosure review-timeline-disclosure">
        <summary><span>Read the timeline and cited transcript as text</span><strong>{rubricEntries.length + replayEvents.length} items</strong></summary>
        <div className="review-disclosure-body">
          <h4>Rubric evidence on this timeline</h4>
          {rubricEntries.length > 0
            ? <ul className="review-timeline-text">{rubricEntries.map((entry) => <li key={entry.criterionId} data-evidence={entry.state}>
              <time>{entry.evidence?.startMs == null ? 'Untimed' : formatTime(entry.evidence.startMs)}</time>
              <span><strong>{entry.label}</strong>{entry.evidence ? <q>{entry.evidence.span}</q> : <small>No evidence was cited for this criterion.</small>}</span>
            </li>)}</ul>
            : <p className="performance-empty">No rubric timeline was supplied for this attempt.</p>}
          <h4>Voice and camera observations</h4>
          {replayEvents.length > 0
            ? <ul className="review-timeline-text">{replayEvents.map((event) => <li key={event.key}>
              <time>{formatTime(event.startMs)}</time><span><strong>{event.label}</strong><small>{event.source} · {event.detail}</small></span>
            </li>)}</ul>
            : <p className="performance-empty">No timestamped voice or camera candidate crossed the prototype thresholds.</p>}
          {markedSegmentCount > 0 && <div className="review-transcript-evidence">
            <h4>Exact citations inside the transcript</h4>
            <p>{transcriptSegments.map((segment, index) => {
              if (segment.labels.length === 0) return <span key={index}>{segment.text}</span>;
              const labels = segment.labels.join(' · ');
              return segment.startMs !== null && recordingUrl
                ? <button key={index} type="button" onClick={() => playFrom(segment.startMs ?? 0)} title={`${labels} — play from ${formatTime(segment.startMs)}`}><mark>{segment.text}</mark><small>{labels}</small></button>
                : <mark key={index} title={labels}>{segment.text}<small>{labels}</small></mark>;
            })}</p>
            <small>Marked text is copied from the transcript as text nodes; nothing is rewritten or injected as markup.</small>
          </div>}
        </div>
      </details>
    </section>

    <details className="review-disclosure review-replay-disclosure" ref={replayDetailsRef}>
      <summary><span><small>Replay on demand</small>Review the surrounding moment</span><strong>{recordingUrl ? formatTime(result.recording?.durationMs ?? 0) : 'Not recorded'}</strong></summary>
      <div className="review-disclosure-body">
        {recordingUrl
          ? <>
            <video ref={videoRef} className="recording-player" src={recordingUrl} controls playsInline preload="metadata" aria-label="Recorded attempt replay" />
            <p className="recording-sync-status">Timeline controls start two seconds before an observation so you can judge its context yourself.</p>
            <div className="recording-review-actions">
              <a className="button button-secondary" href={recordingUrl} download={`talk-active-attempt.${result.recording?.mimeType.includes('mp4') ? 'mp4' : 'webm'}`}>Download this replay</a>
              {savedAttemptId && <a className="text-button" href={`/attempts/${savedAttemptId}${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`}>Open saved review</a>}
            </div>
          </>
          : <p className="performance-empty">No camera-and-microphone replay was kept. The rubric evidence and timestamped observations above remain usable.</p>}
        {recordingStatus && <p className="recording-sync-status" role="status">{recordingStatus}</p>}
      </div>
    </details>

    <details className="review-disclosure review-full-reading">
      <summary><span><small>Delivery details</small>Full readings, weighting, limitations, and raw counts</span><strong>Inspect</strong></summary>
      <div className="review-disclosure-body">
        <ReadingComposition reading={reading} headingId="rehearsalReadingLabel" />
        <p className="delivery-boundary"><strong>This number describes one rehearsal attempt, not your ability.</strong> The bar is the complete arithmetic: each block is as wide as the share it carried and as full as it scored. Unmeasured signals are excluded from the mean rather than counted as zero.</p>

        <dl className="review-raw-summary">
          <div><dt>Answer duration</dt><dd>{formatTime(result.durationSeconds * 1_000)}</dd></div>
          <div><dt>Session duration</dt><dd>{formatTime(result.sessionDurationSeconds * 1_000)}</dd></div>
          <div><dt>Transcript words</dt><dd>{result.metrics.wordCount}</dd></div>
          <div><dt>Speaking pace</dt><dd>{result.metrics.wordsPerMinute} words/min</dd></div>
          <div><dt>Measurement coverage</dt><dd>{Math.round(result.metrics.measurementCoverage)}%</dd></div>
          <div><dt>Transcript source</dt><dd>{result.transcriptSource === 'web-speech' ? 'Browser dictation' : 'Typed'}</dd></div>
        </dl>

        <div className="performance-details">
          <div>
            <h3>Voice readings</h3>
            <ul className="metric-band-list">{result.metrics.vocal.metrics.map((metric) => <MetricBand metric={metric} key={metric.id} />)}</ul>
            {(result.metrics.fillers.length > 0 || result.metrics.repeatedWordEvents.length > 0) && <div className="event-timeline transcript-cue-list"><span>Transcript cue evidence</span>
              {result.metrics.fillers.map((filler) => <p key={filler.label}><time>filler</time><span><q>{filler.label}</q> × {filler.count}</span></p>)}
              {result.metrics.repeatedWordEvents.map((event) => <p key={`${event.word}-${event.tokenIndex}`}><time>{event.timestampSeconds === null ? `word ${event.tokenIndex + 1}` : formatTime(event.timestampSeconds * 1_000)}</time><span><q>{event.word}</q> repeated {event.additionalOccurrences + 1} times in sequence</span></p>)}
            </div>}
            {result.audioSummary && <dl className="review-audio-summary">
              <div><dt>Observed audio</dt><dd>{result.audioSummary.observedSeconds.toFixed(1)}s</dd></div>
              <div><dt>Quiet time</dt><dd>{result.audioSummary.quietSeconds.toFixed(1)}s</dd></div>
              <div><dt>Pause time</dt><dd>{result.audioSummary.pauseSeconds.toFixed(1)}s</dd></div>
              <div><dt>Pause candidates</dt><dd>{result.audioSummary.pauseCount}</dd></div>
              <div><dt>Pitch samples</dt><dd>{result.audioSummary.pitchSampleCount}</dd></div>
            </dl>}
          </div>
          <div>
            <h3>Camera readings</h3>
            {visual ? <>
              {result.metrics.visual && <ul className="metric-band-list">{result.metrics.visual.metrics.map((metric) => <MetricBand metric={metric} key={metric.id} />)}</ul>}
              <ul className="raw-observation-list">{visual.mode === 'interview' ? <>
                <li><span><strong>Reliable face tracking</strong><small>Frames with usable landmarks</small></span><b>{visual.metrics.trackingCoveragePercent}%</b></li>
                <li><span><strong>Face framing</strong><small>Measured after calibration</small></span><b>{visual.metrics.framedPercent}%</b></li>
                <li><span><strong>Camera-facing head direction</strong><small>This is not eye contact</small></span><b>{visual.metrics.cameraFacingPercent ?? 'n/a'}{visual.metrics.cameraFacingPercent === null ? '' : '%'}</b></li>
              </> : <>
                <li><span><strong>Full-body visibility</strong><small>Complete pose inside the frame</small></span><b>{visual.metrics.fullBodyVisiblePercent}%</b></li>
                <li><span><strong>Hand visibility</strong><small>Both wrists tracked</small></span><b>{visual.metrics.handsVisiblePercent}%</b></li>
                <li><span><strong>Movement bursts</strong><small>Motion events, not gesture quality</small></span><b>{visual.metrics.gestureBurstCount}</b></li>
                <li><span><strong>Position changes</strong><small>Sustained lateral relocations</small></span><b>{visual.metrics.positionChangeCount}</b></li>
              </>}</ul>
            </> : <p className="performance-empty">Camera observations were unavailable for this attempt.</p>}
          </div>
        </div>

        <div className="review-limitations">
          <h3>What these observations cannot say</h3>
          <p>{result.metrics.boundary} Audio and interim-dictation events are experimental candidates, not diagnoses; emphasis, held vowels, noise suppression, microphone gating, or ordinary phrasing can produce similar patterns. They do not change the vocal or rubric reading.</p>
          {visual && visual.limitations.length > 0 && <ul>{visual.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>}
        </div>
      </div>
    </details>
  </section>;
}
