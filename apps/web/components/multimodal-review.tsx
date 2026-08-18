'use client';

import { useTranslations } from 'next-intl';

import { useEffect, useRef, useState } from 'react';

import { MetricBand, ReadingComposition, useMetricLabel } from './delivery-charts';
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
  const t = useTranslations('multimodalReview');
  const metricLabel = useMetricLabel();
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
    vocalExcludedReason: t('noTimingAvailable'),
    visualExcludedReason: visual
      ? `Landmarks held for ${trackingPercent}% of sampled frames, below the 80% floor this reading requires.`
      : t('cameraNotPart'),
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
      detail: t('landmarkBoundary'),
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
  // {t('outsideBand')} and "never measured" are different facts and were being
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
        <p className="overline">{t('supportingContext')}</p>
        <h2 id="deliveryReviewTitle">{t('inspectMoments')}</h2>
        <p>{t('evidenceStaysAbove')}</p>
      </div>
    </div>
    <p className="review-delivery-boundary"><strong>{t('boundary')}</strong> These deterministic readings describe one rehearsal attempt, not the speaker. They do not measure confidence, ability, truth, emotion, personality, intent, health, skill, or hiring suitability.</p>

    {onRetakeCriterion && missingCriteria.length > 0 && <section className="review-retake-strip" aria-labelledby="retakeTitle">
      <div><p className="overline">{t('fixOneGap')}</p><h3 id="retakeTitle">{t('addMissingClaim')}</h3></div>
      <ul>{missingCriteria.map((entry) => <li key={entry.criterionId}>
        <span>{entry.label}</span>
        <button className="button button-secondary" type="button" onClick={() => onRetakeCriterion(entry)}>{t('recordAddition')}</button>
      </li>)}</ul>
    </section>}

    <section className="review-unified-timeline" aria-labelledby="timelineTitle">
      <div className="section-title-row">
        <div><p className="overline">{t('oneTimeline')}</p><h3 id="timelineTitle">{t('rubricVoiceCamera')}</h3></div>
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
                  aria-label={`Around ${formatTime(startMs)}, cited evidence for ${entry.label}. ${recordingUrl ? t('playFromBefore') : t('noReplayRecorded')}`}
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
            {lane.events.length === 0 && <span className="timeline-lane-note">{t('noTimestampedCue')}</span>}
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
                aria-label={`${formatTime(event.startMs)}, ${event.label}. ${recordingUrl ? t('playFromBefore') : t('noReplayRecorded')}`}
                disabled={!recordingUrl}
              />;
            })}
          </div>
        </div>)}
        <p className="timeline-axis" aria-hidden="true"><span>0:00</span><span>{formatTime(timelineDurationMs / 2)}</span><span>{formatTime(timelineDurationMs)}</span></p>
      </div>
      <p className="timeline-rubric-summary">{coverage.found + coverage.reused} of {coverage.total} criteria cite a span. {coverage.timed > 0 ? `${coverage.timed} could be placed on the clock from coarse dictation timing; use it to find the moment, not to sync a word.` : t('noClockPosition')}</p>
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
          <span>{t('deliveryExceptions')}</span>
          <h4 id="exceptionTitle">{outsideBandMetrics.length > 0
            ? `${outsideBandMetrics.length} of ${measuredMetrics.length} measured readings left their practice band`
            : measuredMetrics.length > 0
              ? `All ${measuredMetrics.length} measured readings stayed inside their practice band`
              : t('nothingMeasurable')}</h4>
          <p>{t('shadedZone')}</p>
          {unmeasuredMetrics.length > 0 && <p className="review-exception-unmeasured">
            <strong>{t('notMeasured')}</strong> {unmeasuredMetrics.map((metric) => metricLabel(metric.id)).join(', ')}. These are excluded from every reading rather than scored as zero.
          </p>}
        </div>
        {outsideBandMetrics.length > 0 && <ul className="metric-band-list">
          {outsideBandMetrics.map((metric) => <MetricBand metric={metric} key={metric.id} />)}
        </ul>}
      </div>

      <details className="review-disclosure review-timeline-disclosure">
        <summary><span>{t('readAsText')}</span><strong>{rubricEntries.length + replayEvents.length} items</strong></summary>
        <div className="review-disclosure-body">
          <h4>{t('rubricEvidenceOnTimeline')}</h4>
          {rubricEntries.length > 0
            ? <ul className="review-timeline-text">{rubricEntries.map((entry) => <li key={entry.criterionId} data-evidence={entry.state}>
              <time>{entry.evidence?.startMs == null ? t('untimed') : formatTime(entry.evidence.startMs)}</time>
              <span><strong>{entry.label}</strong>{entry.evidence ? <q>{entry.evidence.span}</q> : <small>{t('noEvidenceCited')}</small>}</span>
            </li>)}</ul>
            : <p className="performance-empty">{t('noRubricTimeline')}</p>}
          <h4>{t('voiceAndCamera')}</h4>
          {replayEvents.length > 0
            ? <ul className="review-timeline-text">{replayEvents.map((event) => <li key={event.key}>
              <time>{formatTime(event.startMs)}</time><span><strong>{event.label}</strong><small>{event.source} · {event.detail}</small></span>
            </li>)}</ul>
            : <p className="performance-empty">{t('noCandidateCrossed')}</p>}
          {markedSegmentCount > 0 && <div className="review-transcript-evidence">
            <h4>{t('exactCitations')}</h4>
            <p>{transcriptSegments.map((segment, index) => {
              if (segment.labels.length === 0) return <span key={index}>{segment.text}</span>;
              const labels = segment.labels.join(' · ');
              return segment.startMs !== null && recordingUrl
                ? <button key={index} type="button" onClick={() => playFrom(segment.startMs ?? 0)} title={`${labels} — play from ${formatTime(segment.startMs)}`}><mark>{segment.text}</mark><small>{labels}</small></button>
                : <mark key={index} title={labels}>{segment.text}<small>{labels}</small></mark>;
            })}</p>
            <small>{t('markedTextBoundary')}</small>
          </div>}
        </div>
      </details>
    </section>

    <details className="review-disclosure review-replay-disclosure" ref={replayDetailsRef}>
      <summary><span><small>{t('replayOnDemand')}</small>{t('reviewMoment')}</span><strong>{recordingUrl ? formatTime(result.recording?.durationMs ?? 0) : t('notRecorded')}</strong></summary>
      <div className="review-disclosure-body">
        {recordingUrl
          ? <>
            <video ref={videoRef} className="recording-player" src={recordingUrl} controls playsInline preload="metadata" aria-label={t('recordedReplay')} />
            <p className="recording-sync-status">{t('timelineControls')}</p>
            <div className="recording-review-actions">
              <a className="button button-secondary" href={recordingUrl} download={`talk-active-attempt.${result.recording?.mimeType.includes('mp4') ? 'mp4' : 'webm'}`}>{t('downloadReplay')}</a>
              {savedAttemptId && <a className="text-button" href={`/attempts/${savedAttemptId}${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`}>{t('openSavedReview')}</a>}
            </div>
          </>
          : <p className="performance-empty">{t('noReplayKept')}</p>}
        {recordingStatus && <p className="recording-sync-status" role="status">{recordingStatus}</p>}
      </div>
    </details>

    <details className="review-disclosure review-full-reading">
      <summary><span><small>{t('deliveryDetails')}</small>{t('fullReadings')}</span><strong>{t('inspect')}</strong></summary>
      <div className="review-disclosure-body">
        <ReadingComposition reading={reading} headingId="rehearsalReadingLabel" />
        <p className="delivery-boundary"><strong>{t('oneAttemptBoundary')}</strong> The bar is the complete arithmetic: each block is as wide as the share it carried and as full as it scored. Unmeasured signals are excluded from the mean rather than counted as zero.</p>

        <dl className="review-raw-summary">
          <div><dt>{t('answerDuration')}</dt><dd>{formatTime(result.durationSeconds * 1_000)}</dd></div>
          <div><dt>{t('sessionDuration')}</dt><dd>{formatTime(result.sessionDurationSeconds * 1_000)}</dd></div>
          <div><dt>{t('transcriptWords')}</dt><dd>{result.metrics.wordCount}</dd></div>
          <div><dt>{t('speakingPace')}</dt><dd>{result.metrics.wordsPerMinute} words/min</dd></div>
          <div><dt>{t('measurementCoverage')}</dt><dd>{Math.round(result.metrics.measurementCoverage)}%</dd></div>
          <div><dt>{t('transcriptSource')}</dt><dd>{result.transcriptSource === 'web-speech' ? t('browserDictation') : 'Typed'}</dd></div>
        </dl>

        <div className="performance-details">
          <div>
            <h3>{t('voiceReadings')}</h3>
            <ul className="metric-band-list">{result.metrics.vocal.metrics.map((metric) => <MetricBand metric={metric} key={metric.id} />)}</ul>
            {(result.metrics.fillers.length > 0 || result.metrics.repeatedWordEvents.length > 0) && <div className="event-timeline transcript-cue-list"><span>{t('transcriptCueEvidence')}</span>
              {result.metrics.fillers.map((filler) => <p key={filler.label}><time>filler</time><span><q>{filler.label}</q> × {filler.count}</span></p>)}
              {result.metrics.repeatedWordEvents.map((event) => <p key={`${event.word}-${event.tokenIndex}`}><time>{event.timestampSeconds === null ? `word ${event.tokenIndex + 1}` : formatTime(event.timestampSeconds * 1_000)}</time><span><q>{event.word}</q> repeated {event.additionalOccurrences + 1} times in sequence</span></p>)}
            </div>}
            {result.audioSummary && <dl className="review-audio-summary">
              <div><dt>{t('observedAudio')}</dt><dd>{result.audioSummary.observedSeconds.toFixed(1)}s</dd></div>
              <div><dt>{t('quietTime')}</dt><dd>{result.audioSummary.quietSeconds.toFixed(1)}s</dd></div>
              <div><dt>{t('pauseTime')}</dt><dd>{result.audioSummary.pauseSeconds.toFixed(1)}s</dd></div>
              <div><dt>{t('pauseCandidates')}</dt><dd>{result.audioSummary.pauseCount}</dd></div>
              <div><dt>{t('pitchSamples')}</dt><dd>{result.audioSummary.pitchSampleCount}</dd></div>
            </dl>}
          </div>
          <div>
            <h3>{t('cameraReadings')}</h3>
            {visual ? <>
              {result.metrics.visual && <ul className="metric-band-list">{result.metrics.visual.metrics.map((metric) => <MetricBand metric={metric} key={metric.id} />)}</ul>}
              <ul className="raw-observation-list">{visual.mode === 'interview' ? <>
                <li><span><strong>{t('reliableFaceTracking')}</strong><small>{t('framesWithLandmarks')}</small></span><b>{visual.metrics.trackingCoveragePercent}%</b></li>
                <li><span><strong>{t('faceFraming')}</strong><small>{t('measuredAfterCalibration')}</small></span><b>{visual.metrics.framedPercent}%</b></li>
                <li><span><strong>{t('cameraFacing')}</strong><small>{t('notEyeContact')}</small></span><b>{visual.metrics.cameraFacingPercent ?? 'n/a'}{visual.metrics.cameraFacingPercent === null ? '' : '%'}</b></li>
              </> : <>
                <li><span><strong>{t('fullBodyVisibility')}</strong><small>{t('completePose')}</small></span><b>{visual.metrics.fullBodyVisiblePercent}%</b></li>
                <li><span><strong>{t('handVisibility')}</strong><small>{t('bothWrists')}</small></span><b>{visual.metrics.handsVisiblePercent}%</b></li>
                <li><span><strong>{t('movementBursts')}</strong><small>{t('motionNotQuality')}</small></span><b>{visual.metrics.gestureBurstCount}</b></li>
                <li><span><strong>{t('positionChanges')}</strong><small>{t('lateralRelocations')}</small></span><b>{visual.metrics.positionChangeCount}</b></li>
              </>}</ul>
            </> : <p className="performance-empty">{t('cameraUnavailable')}</p>}
          </div>
        </div>

        <div className="review-limitations">
          <h3>{t('cannotSay')}</h3>
          <p>{result.metrics.boundary} Audio and interim-dictation events are experimental candidates, not diagnoses; emphasis, held vowels, noise suppression, microphone gating, or ordinary phrasing can produce similar patterns. They do not change the vocal or rubric reading.</p>
          {visual && visual.limitations.length > 0 && <ul>{visual.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>}
        </div>
      </div>
    </details>
  </section>;
}
