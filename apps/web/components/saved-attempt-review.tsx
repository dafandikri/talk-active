'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { requestContract } from '@/lib/api/client';
import {
  AttemptRecordingDeleteResponseSchema,
  AttemptReviewResponseSchema,
  type AttemptDeliveryEvent,
  type AttemptReviewResponse,
} from '@/lib/contracts';

type LoadState = 'loading' | 'ready' | 'error';
type ReviewEvidence = AttemptReviewResponse['evidence'][number];

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sourceLabel(source: AttemptDeliveryEvent['source']): string {
  if (source === 'interim-transcript') return 'Live transcript';
  if (source === 'combined') return 'Speech cues';
  if (source === 'vision') return 'Camera';
  return 'Voice';
}

function verdictLabel(verdict: ReviewEvidence['verdict']): string {
  if (verdict === 'supported') return 'Evidence cited';
  if (verdict === 'partial') return 'Evidence still partial';
  return 'Evidence gap';
}

function languageLabel(language: AttemptReviewResponse['project']['language']): string {
  return language === 'id-ID' ? 'Bahasa Indonesia' : 'English';
}

function evidenceState(item: ReviewEvidence): 'found' | 'partial' | 'absent' {
  if (item.verdict === 'supported') return 'found';
  if (item.verdict === 'partial') return 'partial';
  return 'absent';
}

function recordingMessage(recording: AttemptReviewResponse['recording']): string {
  if (!recording) return 'No replay was saved. The transcript, rubric evidence, and delivery observations remain available.';
  if (recording.status === 'pending') return 'The private replay is still being prepared. The saved evidence is already available.';
  if (recording.status === 'failed') return 'The replay could not be stored. The transcript, rubric evidence, and delivery observations were kept.';
  return '';
}

function ReviewLoading() {
  return (
    <section className="view is-visible saved-review-state" aria-live="polite" aria-busy="true">
      <p className="overline">Saved attempt</p>
      <h1>Loading the evidence trail…</h1>
      <p>Checking access to this private review.</p>
    </section>
  );
}

function ReviewError({ message, onRetry }: Readonly<{ message: string; onRetry: () => void }>) {
  return (
    <section className="view is-visible saved-review-state" aria-labelledby="savedReviewErrorTitle">
      <p className="overline">Saved attempt</p>
      <h1 id="savedReviewErrorTitle">This review could not be opened.</h1>
      <p className="form-error" role="alert">{message}</p>
      <div className="saved-review-actions">
        <button className="button button-primary" type="button" onClick={onRetry}>Try again</button>
        <Link className="button button-secondary" href="/progress">Back to progress</Link>
      </div>
    </section>
  );
}

export function SavedAttemptReview({ attemptId }: Readonly<{ attemptId: string }>) {
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
    }).catch((problem: unknown) => {
      if (abort.signal.aborted) return;
      setError(problem instanceof Error ? problem.message : 'The server did not return a readable attempt review.');
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
    { id: 'voice', label: 'Voice', events: events.filter((event) => event.source !== 'vision') },
    { id: 'camera', label: 'Camera', events: events.filter((event) => event.source === 'vision') },
  ];
  const recordingReady = review?.recording?.status === 'ready';

  function seekToEvent(event: AttemptDeliveryEvent) {
    const video = videoRef.current;
    if (!video || !recordingReady) return;
    if (replayDetailsRef.current) replayDetailsRef.current.open = true;
    video.currentTime = Math.max(0, event.startMs / 1_000 - 2);
    setPlaybackNote(`Replay moved to ${formatClock(event.startMs)}, with two seconds of context.`);
    void video.play().catch(() => {
      setPlaybackNote(`Replay is ready at ${formatClock(event.startMs)}. Press play to continue.`);
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
      setPlaybackNote('The replay was deleted. Delivery observations, transcript, and rubric evidence were kept.');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The recording could not be deleted.');
    } finally {
      setDeleting(false);
    }
  }

  if (loadState === 'loading') return <ReviewLoading />;
  if (loadState === 'error' || !review) {
    return <ReviewError message={error || 'The saved review was empty.'} onRetry={() => setRetryKey((value) => value + 1)} />;
  }

  const delivery = review.deliveryReview;
  const replayUnavailable = recordingMessage(review.recording);
  const citedCount = review.evidence.filter((item) => item.citedSpan).length;
  const progressHref = `/progress?project=${encodeURIComponent(review.project.id)}`;
  const nextGap = review.evidence.find((item) => item.verdict === 'unsupported')
    ?? review.evidence.find((item) => item.verdict === 'partial')
    ?? null;

  return (
    <section className="view is-visible saved-review" aria-labelledby="savedReviewTitle">
      <Link className="saved-review-back" href={progressHref}><span aria-hidden="true">←</span> Back to progress</Link>
      <header className="page-header compact-header saved-review-header">
        <div>
          <p className="overline">{review.project.title} · {languageLabel(review.project.language)}</p>
          <p className="saved-review-date">Saved attempt · {dateLabel(review.attempt.createdAt)}</p>
          <h1 id="savedReviewTitle">Start with the proof. Fix one gap.</h1>
          <p className="page-lede">The exact rubric evidence comes first. Delivery observations remain supporting context and never change a criterion verdict.</p>
        </div>
      </header>

      <section className="surface saved-rubric-card" aria-labelledby="rubricEvidenceTitle">
        <div className="saved-evidence-lead">
          <div>
            <p className="overline">Rubric evidence</p>
            <h2 id="rubricEvidenceTitle">{citedCount} of {review.evidence.length} criteria cite your exact words</h2>
            <p className="saved-boundary">This is evidence coverage in one transcript—not confidence, intelligence, or speaking ability.</p>
          </div>
          <aside className="saved-next-gap" aria-labelledby="savedNextGapTitle">
            <span>Focus next</span>
            <h3 id="savedNextGapTitle">{nextGap?.criterionName ?? 'Every criterion cites evidence'}</h3>
            {nextGap
              ? <>
                <p>Make this evidence explicit in the next rehearsal.</p>
                <ul>{nextGap.missingEvidence.map((cue) => <li key={cue}>{cue}</li>)}</ul>
              </>
              : <p>Keep the cited claims defensible and rehearse the hardest judge follow-up.</p>}
          </aside>
        </div>

        {review.evidence.length === 0
          ? <p className="empty-list">No rubric verdicts were retained for this attempt.</p>
          : <>
            <ol className="saved-evidence-map" aria-label="Every rubric criterion and its evidence state">
              {review.evidence.map((item) => <li key={item.criterionId}>
                <a href={`#saved-evidence-${item.criterionId}`} data-evidence={evidenceState(item)}>
                  <i aria-hidden="true" />
                  <span>{item.criterionName}</span>
                  <strong>{verdictLabel(item.verdict)}</strong>
                </a>
              </li>)}
            </ol>
            <div className="saved-rubric-list">{review.evidence.map((item) => <article id={`saved-evidence-${item.criterionId}`} data-evidence={evidenceState(item)} key={item.criterionId}>
              <div className="saved-rubric-heading"><h3>{item.criterionName}</h3><span>{verdictLabel(item.verdict)}</span></div>
              {item.citedSpan
                ? <blockquote><span>“{item.citedSpan}”</span><cite>Exact transcript span retained with this verdict</cite></blockquote>
                : <p className="saved-no-citation">No transcript span supports this verdict.</p>}
              {item.missingEvidence.length > 0 && <div className="saved-missing-evidence"><strong>{item.citedSpan ? 'Still make explicit' : 'Cues that were missing'}</strong><ul>{item.missingEvidence.map((cue) => <li key={cue}>{cue}</li>)}</ul></div>}
            </article>)}</div>
          </>}

        <details className="saved-disclosure saved-transcript-disclosure">
          <summary><span>Read the full transcript</span><strong>{review.attempt.transcriptSource}</strong></summary>
          <blockquote>{review.attempt.transcript}</blockquote>
        </details>
      </section>

      <section className="surface saved-timeline-card" aria-labelledby="timelineTitle">
        <div className="section-title-row">
          <div><p className="overline">One synchronized timeline</p><h2 id="timelineTitle">Rubric, voice, and camera on one clock</h2></div>
          <span className="session-status">{formatClock(timelineDurationMs)} · {events.length} {events.length === 1 ? 'cue' : 'cues'}</span>
        </div>
        <p className="saved-section-intro">The saved attempt retains clock positions for delivery cues. It does not retain word-level timing, so rubric citations stay visible above but are not given an invented timestamp here.</p>
        <div className="attempt-timeline saved-attempt-timeline" aria-label={`Timeline lasting ${formatClock(timelineDurationMs)} with rubric, voice, and camera lanes`}>
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
              aria-label={`${item.criterionName}: ${item.citedSpan ? 'evidence cited' : 'no evidence cited'}`}
            >
              <span className="timeline-lane-note" data-evidence={evidenceState(item)}>
                {item.citedSpan ? 'cited; clock position not retained' : 'no evidence cited'}
              </span>
            </div>
          </div>)}
          {timelineLanes.map((lane) => (
            <div className="timeline-lane" key={lane.id}>
              <span className="timeline-lane-label">{lane.label}</span>
              <div className="timeline-track" aria-label={`${lane.label}: ${lane.events.length} timestamped ${lane.events.length === 1 ? 'cue' : 'cues'}`}>
                {lane.events.length === 0 && <span className="timeline-lane-note">No timestamped cue</span>}
                {lane.events.map((event) => {
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
                      title={`${formatClock(event.startMs)} · ${event.label}`}
                      aria-label={`${formatClock(event.startMs)}, ${event.label}. ${recordingReady ? 'Play the replay from two seconds before this.' : 'The replay is not available, so this cue cannot be played.'}`}
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
        {!recordingReady && events.length > 0 && <p className="saved-timeline-boundary">The observations remain readable without a replay. Timeline marks become playable only when the private video is ready.</p>}
        <details className="saved-disclosure saved-timeline-disclosure">
          <summary><span>Read every timeline observation</span><strong>{events.length} {events.length === 1 ? 'item' : 'items'}</strong></summary>
          {events.length === 0
            ? <p className="empty-list">No timestamped delivery cue was retained for this attempt.</p>
            : <ul className="saved-timeline-list">{events.map((event) => <li key={event.id}>
              <button type="button" onClick={() => seekToEvent(event)} disabled={!recordingReady} aria-label={`${recordingReady ? 'Play' : 'Saved observation at'} ${formatClock(event.startMs)}: ${event.label}`}>
                <time dateTime={`PT${Math.floor(event.startMs / 1_000)}S`}>{formatClock(event.startMs)}</time>
                <span className="saved-timeline-copy"><strong>{event.label}</strong><small>{sourceLabel(event.source)} · {event.evidence}</small></span>
                <span aria-hidden="true">{recordingReady ? 'Play →' : 'Saved'}</span>
              </button>
            </li>)}</ul>}
        </details>
      </section>

      <details className="surface saved-disclosure saved-replay-card" ref={replayDetailsRef}>
        <summary><span><small>Private replay</small>Open the attempt video</span><strong>{recordingReady ? formatClock(review.recording?.durationMs ?? 0) : review.recording?.status ?? 'Not saved'}</strong></summary>
        <div className="saved-disclosure-body">
          {recordingReady
            ? <video
              className="saved-replay-video"
              controls
              playsInline
              preload="metadata"
              ref={videoRef}
              src={`/api/attempts/${encodeURIComponent(attemptId)}/recording/media`}
              aria-label="Private video replay of this rehearsal attempt"
            >Your browser cannot play this saved rehearsal video.</video>
            : <div className="saved-replay-empty"><p>{replayUnavailable}</p></div>}
          {review.recording && <p className="saved-replay-meta">Captured duration: {formatClock(review.recording.durationMs)}. Only the signed-in attempt owner can play this private replay.</p>}
          {playbackNote && <p className="saved-playback-note" aria-live="polite">{playbackNote}</p>}
          {review.recording && <div className="saved-recording-delete">
            {!confirmingDelete
              ? <button className="button button-danger" type="button" onClick={() => setConfirmingDelete(true)}>Delete replay</button>
              : <div className="saved-delete-confirm" role="group" aria-label="Confirm recording deletion">
                <p>Delete only the video? The transcript, delivery observations, and rubric evidence will remain.</p>
                <div className="saved-review-actions">
                  <button className="button button-danger" type="button" disabled={deleting} aria-busy={deleting} onClick={() => void deleteRecording()}>{deleting ? 'Deleting…' : 'Yes, delete replay'}</button>
                  <button className="button button-secondary" type="button" disabled={deleting} onClick={() => setConfirmingDelete(false)}>Keep replay</button>
                </div>
              </div>}
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>}
        </div>
      </details>

      <section className="saved-delivery-section" aria-labelledby="deliverySummaryTitle">
        <p className="saved-boundary"><strong>Delivery boundary:</strong> {delivery?.boundary ?? 'No delivery observation was saved.'} These observations support review; they do not change rubric evidence or measure the speaker.</p>
        <details className="surface saved-disclosure saved-delivery-summary">
          <summary><span><small>Delivery details</small><span id="deliverySummaryTitle">Inspect the raw browser observations</span></span><strong>{delivery ? `${events.length} timestamped` : 'Unavailable'}</strong></summary>
          <div className="saved-disclosure-body">
            {delivery
              ? <dl className="saved-delivery-metrics">
                <div><dt>Capture mode</dt><dd>{delivery.mode === 'interview' ? 'Face · interview' : 'Full body · presentation'}</dd></div>
                <div><dt>Usable tracking</dt><dd>{delivery.trackingCoveragePercent === null ? 'Not measured' : `${Math.round(delivery.trackingCoveragePercent)}%`}</dd></div>
                <div><dt>Filler cues</dt><dd>{delivery.fillerCount}</dd></div>
                <div><dt>Repeated-word cues</dt><dd>{delivery.repeatedWordCount}</dd></div>
              </dl>
              : <p className="empty-list">This attempt has rubric evidence but no saved delivery observation.</p>}
            <p className="saved-section-intro">This saved format retains inspectable counts, capture coverage, and timestamped cues. It does not retain the component bands needed to defend an aggregate delivery reading, so no vocal, visual, or overall score is shown. Camera, microphone, framing, and tracking quality affect what could be measured.</p>
          </div>
        </details>
      </section>
    </section>
  );
}
