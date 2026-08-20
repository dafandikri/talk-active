'use client';

import { useLocale, useTranslations } from 'next-intl';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { requestContract } from '@/lib/api/client';
import { HTML_LANG, interfaceLocaleFrom } from '@/i18n/locales';
import {
  AttemptRecordingDeleteResponseSchema,
  AttemptReviewResponseSchema,
  type AttemptDeliveryEvent,
  type AttemptReviewResponse,
} from '@/lib/contracts';

type LoadState = 'loading' | 'ready' | 'error';
type ReviewEvidence = AttemptReviewResponse['evidence'][number];

type Translate = (key: string, values?: Record<string, string | number>) => string;

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function dateLabel(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sourceLabel(source: AttemptDeliveryEvent['source'], t: Translate): string {
  if (source === 'interim-transcript') return t('liveTranscript');
  if (source === 'combined') return t('speechCues');
  if (source === 'vision') return t('camera');
  return t('voice');
}

function eventCopy(event: AttemptDeliveryEvent, t: Translate): { label: string; detail: string } {
  if (event.source === 'vision') {
    const known = new Set([
      'face_out_of_frame',
      'head_turned_away',
      'body_out_of_frame',
      'gesture_burst',
      'position_change',
      'torso_angle_change',
    ]);
    return {
      label: known.has(event.kind) ? t(`visionEvent.${event.kind}`) : t('cameraObservation'),
      detail: t('cameraEventDetail'),
    };
  }
  if (event.kind === 'prolonged-voicing') {
    return {
      label: t('prolongedVoicing'),
      detail: t('prolongedVoicingDetail', { seconds: (Math.max(0, event.endMs - event.startMs) / 1_000).toFixed(1) }),
    };
  }
  if (event.kind === 'repeated-start') {
    return { label: t('repeatedStart'), detail: t('repeatedStartDetail') };
  }
  if (event.kind === 'interim-filler') {
    const filler = event.label.match(/[“"]([^”"]+)[”"]/u)?.[1] ?? t('unknownFiller');
    return { label: t('possibleFiller', { filler }), detail: t('interimFillerDetail') };
  }
  return { label: t('voiceObservation'), detail: t('voiceObservationDetail') };
}

function verdictLabel(verdict: ReviewEvidence['verdict'], t: Translate): string {
  if (verdict === 'supported') return t('evidenceCited');
  if (verdict === 'partial') return t('evidenceStillPartial');
  return t('evidenceGap');
}

function languageLabel(language: AttemptReviewResponse['project']['language'], t: Translate): string {
  return language === 'id-ID' ? 'Bahasa Indonesia' : 'English';
}

function evidenceState(item: ReviewEvidence): 'found' | 'partial' | 'absent' {
  if (item.verdict === 'supported') return 'found';
  if (item.verdict === 'partial') return 'partial';
  return 'absent';
}

function recordingMessage(recording: AttemptReviewResponse['recording'], t: Translate): string {
  if (!recording) return t('replayNotSaved');
  if (recording.status === 'pending') return t('replayPreparing');
  if (recording.status === 'failed') return t('replayStoreFailed');
  return '';
}

function ReviewLoading() {
  const t = useTranslations('savedReview');
  return (
    <section className="view is-visible saved-review-state" aria-live="polite" aria-busy="true">
      <p className="overline">{t('savedAttempt')}</p>
      <h1>{t('loading')}</h1>
      <p>{t('checkingAccess')}</p>
    </section>
  );
}

function ReviewError({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) {
  const t = useTranslations('savedReview');
  return (
    <section className="view is-visible saved-review-state" aria-labelledby="savedReviewErrorTitle">
      <p className="overline">{t('savedAttempt')}</p>
      <h1 id="savedReviewErrorTitle">{t('couldNotOpen')}</h1>
      <p className="form-error" role="alert">{message}</p>
      <div className="saved-review-actions">
        <button className="button button-primary" type="button" onClick={onRetry}>{t('tryAgain')}</button>
        <Link className="button button-secondary" href="/progress">{t('backToProgress')}</Link>
      </div>
    </section>
  );
}

export function SavedAttemptReview({ attemptId }: Readonly<{ attemptId: string }>) {
  const t = useTranslations('savedReview');
  const dateLocale = HTML_LANG[interfaceLocaleFrom(useLocale())];
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [review, setReview] = useState<AttemptReviewResponse | null>(null);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [playbackNote, setPlaybackNote] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const replayDetailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoadState('loading');
    setError('');
    void requestContract(`/api/attempts/${encodeURIComponent(attemptId)}/review`, AttemptReviewResponseSchema, {
      signal: abort.signal,
    }).then((response) => {
      setReview(response);
      setLoadState('ready');
    }).catch(() => {
      if (abort.signal.aborted) return;
      setError(t('unreadable'));
      setLoadState('error');
    });
    return () => abort.abort();
  }, [attemptId, retryKey]);

  const events = useMemo(
    () => [...(review?.deliveryEvents ?? [])].sort((left, right) => left.startMs - right.startMs),
    [review?.deliveryEvents],
  );
  const timelineDurationMs = Math.max(
    1_000,
    review?.recording?.durationMs ?? Math.round((review?.attempt.durationSeconds ?? 0) * 1_000),
  );
  const timelineLanes = [
    { id: 'voice', label: t('voice'), events: events.filter((event) => event.source !== 'vision') },
    { id: 'camera', label: t('camera'), events: events.filter((event) => event.source === 'vision') },
  ];
  const recordingReady = review?.recording?.status === 'ready';

  function seekToEvent(event: AttemptDeliveryEvent) {
    const video = videoRef.current;
    if (!video || !recordingReady) return;
    if (replayDetailsRef.current) replayDetailsRef.current.open = true;
    video.currentTime = Math.max(0, event.startMs / 1_000 - 2);
    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setPlaybackNote(t('replayMoved', { time: formatClock(event.startMs) }));
    void video.play().catch(() => {
      setPlaybackNote(t('replayReadyAt', { time: formatClock(event.startMs) }));
    });
  }

  async function deleteRecording() {
    if (!review?.recording) return;
    setDeleting(true);
    setError('');
    try {
      await requestContract(
        `/api/attempts/${encodeURIComponent(attemptId)}/recording`,
        AttemptRecordingDeleteResponseSchema,
        { method: 'DELETE' },
      );
      setReview({ ...review, recording: null });
      setConfirmingDelete(false);
      setPlaybackNote(t('deleted'));
    } catch {
      setError(t('deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  if (loadState === 'loading') return <ReviewLoading />;
  if (loadState === 'error' || !review) {
    return <ReviewError message={error || t('emptyReview')} onRetry={() => setRetryKey((value) => value + 1)} />;
  }

  const delivery = review.deliveryReview;
  const replayUnavailable = recordingMessage(review.recording, t);
  const citedCount = review.evidence.filter((item) => item.citedSpan).length;
  const progressHref = `/progress?project=${encodeURIComponent(review.project.id)}`;
  const nextGap = review.evidence.find((item) => item.verdict === 'unsupported')
    ?? review.evidence.find((item) => item.verdict === 'partial')
    ?? null;

  return (
    <section className="view is-visible saved-review" aria-labelledby="savedReviewTitle">
      <Link className="saved-review-back" href={progressHref}><span aria-hidden="true">←</span> {t('backToProgress')}</Link>
      <header className="page-header compact-header saved-review-header">
        <div>
          <p className="overline">{review.project.title} · {languageLabel(review.project.language, t)}</p>
          <p className="saved-review-date">{t('savedAttemptDate', { date: dateLabel(review.attempt.createdAt, dateLocale) })}</p>
          <h1 id="savedReviewTitle">{t('startWithProof')}</h1>
          <p className="page-lede">{t('evidenceFirst')}</p>
        </div>
      </header>

      <section className="surface saved-rubric-card" aria-labelledby="rubricEvidenceTitle">
        <div className="saved-evidence-lead">
          <div>
            <p className="overline">{t('rubricEvidence')}</p>
            <h2 id="rubricEvidenceTitle">{t('criteriaCiteExactWords', { cited: citedCount, total: review.evidence.length })}</h2>
            <p className="saved-boundary">{t('coverageBoundary')}</p>
          </div>
          <aside className="saved-next-gap" aria-labelledby="savedNextGapTitle">
            <span>{t('focusNext')}</span>
            <h3 id="savedNextGapTitle">{nextGap?.criterionName ?? t('everyCriterionCites')}</h3>
            {nextGap
              ? <>
                <p>{t('makeExplicitNext')}</p>
                <ul>{nextGap.missingEvidence.map((cue) => <li key={cue}>{cue}</li>)}</ul>
              </>
              : <p>{t('keepDefensible')}</p>}
          </aside>
        </div>

        {review.evidence.length === 0
          ? <p className="empty-list">{t('noVerdicts')}</p>
          : <>
            <ol className="saved-evidence-map" aria-label={t('everyCriterionAndState')}>
              {review.evidence.map((item) => <li key={item.criterionId}>
                <a href={`#saved-evidence-${item.criterionId}`} data-evidence={evidenceState(item)}>
                  <i aria-hidden="true" />
                  <span>{item.criterionName}</span>
                  <strong>{verdictLabel(item.verdict, t)}</strong>
                </a>
              </li>)}
            </ol>
            <div className="saved-rubric-list">{review.evidence.map((item) => <article id={`saved-evidence-${item.criterionId}`} data-evidence={evidenceState(item)} key={item.criterionId}>
              <div className="saved-rubric-heading"><h3>{item.criterionName}</h3><span>{verdictLabel(item.verdict, t)}</span></div>
              {item.citedSpan
                ? <blockquote><span>“{item.citedSpan}”</span><cite>{t('exactSpanRetained')}</cite></blockquote>
                : <p className="saved-no-citation">{t('noSpanSupports')}</p>}
              {item.missingEvidence.length > 0 && <div className="saved-missing-evidence"><strong>{item.citedSpan ? t('stillMakeExplicit') : t('cuesMissing')}</strong><ul>{item.missingEvidence.map((cue) => <li key={cue}>{cue}</li>)}</ul></div>}
            </article>)}</div>
          </>}

        <details className="saved-disclosure saved-transcript-disclosure">
          <summary><span>{t('readFullTranscript')}</span><strong>{review.attempt.transcriptSource === 'web-speech' ? t('browserDictation') : t('typedTranscript')}</strong></summary>
          <blockquote>{review.attempt.transcript}</blockquote>
        </details>
      </section>

      <section className="surface saved-timeline-card" aria-labelledby="timelineTitle">
        <div className="section-title-row">
          <div><p className="overline">{t('oneTimeline')}</p><h2 id="timelineTitle">{t('rubricVoiceCamera')}</h2></div>
          <span className="session-status">{t('timelineCueCount', { duration: formatClock(timelineDurationMs), count: events.length })}</span>
        </div>
        <p className="saved-section-intro">{t('timelineBoundary')}</p>
        <div className="attempt-timeline saved-attempt-timeline" aria-label={t('timelineLabel', { duration: formatClock(timelineDurationMs) })}>
          {/* One lane per retained criterion. A single aggregate "Rubric" lane
              told the reader how many criteria were cited but never which, and
              an uncited criterion disappeared into the count — the one fact
              worth carrying forward to the next rehearsal. Word timing is not
              retained on a saved attempt, so each lane says that plainly rather
              than being given an invented position. */}
          {review.evidence.map((item) => <div className="timeline-lane is-rubric" key={item.criterionId}>
            <span className="timeline-lane-label" title={item.criterionName}>{item.criterionName}</span>
            <div
              className="timeline-track"
              data-evidence={evidenceState(item)}
              aria-label={t('criterionLaneLabel', { criterion: item.criterionName, state: item.citedSpan ? t('evidenceCited') : t('noEvidenceCited') })}
            >
              <span className="timeline-lane-note" data-evidence={evidenceState(item)}>
                {item.citedSpan ? t('citedClockNotRetained') : t('noEvidenceCited')}
              </span>
            </div>
          </div>)}
          {timelineLanes.map((lane) => (
            <div className="timeline-lane" key={lane.id}>
              <span className="timeline-lane-label">{lane.label}</span>
              <div className="timeline-track" aria-label={t('observationLaneLabel', { lane: lane.label, count: lane.events.length })}>
                {lane.events.length === 0 && <span className="timeline-lane-note">{t('noTimestampedCue')}</span>}
                {lane.events.map((event) => {
                  const copy = eventCopy(event, t);
                  const left = Math.min(99, (event.startMs / timelineDurationMs) * 100);
                  const span = Math.max(0, (event.endMs - event.startMs) / timelineDurationMs) * 100;
                  return (
                    <button
                      key={event.id}
                      className="timeline-mark"
                      type="button"
                      style={{ left: `${left}%`, width: `${Math.max(span, 1.5)}%` }}
                      onClick={() => seekToEvent(event)}
                      disabled={!recordingReady}
                      title={t('observationMarkTitle', { time: formatClock(event.startMs), label: copy.label })}
                      aria-label={t('observationMarkLabel', { time: formatClock(event.startMs), label: copy.label, action: recordingReady ? t('playFromBefore') : t('replayUnavailableCue') })}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <p className="timeline-axis" aria-hidden="true">
            <span>0:00</span><span>{formatClock(timelineDurationMs / 2)}</span><span>{formatClock(timelineDurationMs)}</span>
          </p>
        </div>
        {!recordingReady && events.length > 0 && <p className="saved-timeline-boundary">{t('observationsWithoutReplay')}</p>}
        <details className="saved-disclosure saved-timeline-disclosure">
          <summary><span>{t('readEveryObservation')}</span><strong>{t('itemCount', { count: events.length })}</strong></summary>
          {events.length === 0
            ? <p className="empty-list">{t('noTimestampedRetained')}</p>
            : <ul className="saved-timeline-list">{events.map((event) => {
              const copy = eventCopy(event, t);
              return <li key={event.id}>
              <button type="button" onClick={() => seekToEvent(event)} disabled={!recordingReady} aria-label={t('observationButtonLabel', { action: recordingReady ? t('play') : t('savedObservationAt'), time: formatClock(event.startMs), label: copy.label })}>
                <time dateTime={`PT${Math.floor(event.startMs / 1_000)}S`}>{formatClock(event.startMs)}</time>
                <span className="saved-timeline-copy"><strong>{copy.label}</strong><small>{sourceLabel(event.source, t)} · {copy.detail}</small></span>
                <span aria-hidden="true">{recordingReady ? t('playArrow') : t('saved')}</span>
              </button>
            </li>})}</ul>}
        </details>
      </section>

      <details className="surface saved-disclosure saved-replay-card" ref={replayDetailsRef}>
        <summary><span><small>{t('privateReplay')}</small>{t('openVideo')}</span><strong>{recordingReady ? formatClock(review.recording?.durationMs ?? 0) : review.recording ? t(`recordingStatus.${review.recording.status}`) : t('notSaved')}</strong></summary>
        <div className="saved-disclosure-body">
          {recordingReady
            ? <video
              className="saved-replay-video"
              controls
              playsInline
              preload="metadata"
              ref={videoRef}
              src={`/api/attempts/${encodeURIComponent(attemptId)}/recording/media`}
              aria-label={t('privateReplayLabel')}
            >{t('cannotPlay')}</video>
            : <div className="saved-replay-empty"><p>{replayUnavailable}</p></div>}
          {review.recording && <p className="saved-replay-meta">{t('capturedDurationOwnerOnly', { duration: formatClock(review.recording.durationMs) })}</p>}
          {playbackNote && <p className="saved-playback-note" aria-live="polite">{playbackNote}</p>}
          {review.recording && <div className="saved-recording-delete">
            {!confirmingDelete
              ? <button className="button button-danger" type="button" onClick={() => setConfirmingDelete(true)}>{t('deleteReplay')}</button>
              : <div className="saved-delete-confirm" role="group" aria-label={t('confirmDeletion')}>
                <p>{t('deleteOnlyVideo')}</p>
                <div className="saved-review-actions">
                  <button className="button button-danger" type="button" disabled={deleting} aria-busy={deleting} onClick={() => void deleteRecording()}>{deleting ? t('deleting') : t('yesDelete')}</button>
                  <button className="button button-secondary" type="button" disabled={deleting} onClick={() => setConfirmingDelete(false)}>{t('keepReplay')}</button>
                </div>
              </div>}
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>}
        </div>
      </details>

      <section className="saved-delivery-section" aria-labelledby="deliverySummaryTitle">
        <p className="saved-boundary"><strong>{t('deliveryBoundary')}</strong> {delivery ? t('metricsBoundary') : t('noDeliveryObservation')} {t('observationsSupportReview')}</p>
        <details className="surface saved-disclosure saved-delivery-summary">
          <summary><span><small>{t('deliveryDetails')}</small><span id="deliverySummaryTitle">{t('rawObservations')}</span></span><strong>{delivery ? t('timestampedCount', { count: events.length }) : t('unavailable')}</strong></summary>
          <div className="saved-disclosure-body">
            {delivery
              ? <dl className="saved-delivery-metrics">
                <div><dt>{t('captureMode')}</dt><dd>{delivery.mode === 'interview' ? t('faceInterview') : t('fullBodyPresentation')}</dd></div>
                <div><dt>{t('usableTracking')}</dt><dd>{delivery.trackingCoveragePercent === null ? t('notMeasured') : `${Math.round(delivery.trackingCoveragePercent)}%`}</dd></div>
                <div><dt>{t('fillerCues')}</dt><dd>{delivery.fillerCount}</dd></div>
                <div><dt>{t('repeatedWordCues')}</dt><dd>{delivery.repeatedWordCount}</dd></div>
              </dl>
              : <p className="empty-list">{t('evidenceButNoDelivery')}</p>}
            <p className="saved-section-intro">{t('savedFormatBoundary')}</p>
          </div>
        </details>
      </section>
    </section>
  );
}
