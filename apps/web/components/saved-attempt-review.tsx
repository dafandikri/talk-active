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
  if (source === 'vision') return 'Visual cues';
  return 'Audio cues';
}

function recordingMessage(recording: AttemptReviewResponse['recording']): string {
  if (!recording) return 'No replay was saved for this attempt. The observations and rubric evidence are still available below.';
  if (recording.status === 'pending') return 'The private replay is still being prepared. Reload this page in a moment; the saved observations are already available.';
  if (recording.status === 'failed') return 'The replay could not be stored. The saved observations and rubric evidence were kept.';
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
  // The list below says a cue happened; the timeline says when, and next to
  // what. Four fillers spread across six minutes and four in the closing thirty
  // seconds are the same list and completely different advice.
  //
  // Voice and camera are separate labelled lanes, so the marks share one hue.
  // Colouring the lanes instead would repeat what position already says, and the
  // obvious warm/green pair for them separates at only ΔE 4.2 under protanopia.
  const timelineDurationMs = Math.max(
    1_000,
    review?.recording?.durationMs ?? Math.round((review?.attempt.durationSeconds ?? 0) * 1_000),
  );
  const timelineLanes = [
    { id: 'voice', label: 'Voice', events: events.filter((event) => event.source !== 'vision') },
    { id: 'camera', label: 'Camera', events: events.filter((event) => event.source === 'vision') },
  ].filter((lane) => lane.events.length > 0);

  const recordingReady = review?.recording?.status === 'ready';

  function seekToEvent(event: AttemptDeliveryEvent) {
    const video = videoRef.current;
    if (!video || !recordingReady) return;
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

  return (
    <section className="view is-visible" aria-labelledby="savedReviewTitle">
      <header className="page-header compact-header workflow-header saved-review-header">
        <div>
          <p className="overline">Saved attempt · {dateLabel(review.attempt.createdAt)}</p>
          <h1 id="savedReviewTitle">Replay the moment behind the feedback.</h1>
          <p className="page-lede">Use each timestamp to inspect the surrounding delivery, then compare it with the exact rubric evidence retained from this attempt.</p>
        </div>
        <Link className="button button-secondary" href="/progress">Back to progress</Link>
      </header>

      <div className="saved-review-layout">
        <section className="surface saved-replay-card" aria-labelledby="replayTitle">
          <div className="section-title-row">
            <div><p className="overline">Private replay</p><h2 id="replayTitle">Attempt video</h2></div>
            {review.recording && <span className="session-status">{review.recording.status}</span>}
          </div>

          {recordingReady
            ? <video
              className="saved-replay-video"
              controls
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
        </section>

        <aside className="surface saved-delivery-summary" aria-labelledby="deliverySummaryTitle">
          <p className="overline">Delivery context</p>
          <h2 id="deliverySummaryTitle">What the browser observed</h2>
          {delivery
            ? <>
              <dl className="saved-delivery-metrics">
                <div><dt>Capture mode</dt><dd>{delivery.mode === 'interview' ? 'Face · interview' : 'Full body · presentation'}</dd></div>
                <div><dt>Vocal rehearsal reading</dt><dd>{delivery.vocalScore}/100</dd></div>
                <div><dt>Visual rehearsal reading</dt><dd>{delivery.visualScore === null ? 'Not measured' : `${delivery.visualScore}/100`}</dd></div>
                <div><dt>Usable tracking</dt><dd>{delivery.trackingCoveragePercent === null ? 'Not measured' : `${Math.round(delivery.trackingCoveragePercent)}%`}</dd></div>
                <div><dt>Filler cues</dt><dd>{delivery.fillerCount}</dd></div>
                <div><dt>Repeated-word cues</dt><dd>{delivery.repeatedWordCount}</dd></div>
              </dl>
              <p className="saved-boundary"><strong>Boundary:</strong> {delivery.boundary}</p>
            </>
            : <p className="empty-list">This attempt has rubric evidence but no saved delivery observation.</p>}
        </aside>
      </div>

      <section className="surface saved-timeline-card" aria-labelledby="timelineTitle">
        <div className="section-title-row">
          <div><p className="overline">Synchronized observations</p><h2 id="timelineTitle">Jump to what needs review</h2></div>
          <span className="session-status">{events.length} {events.length === 1 ? 'moment' : 'moments'}</span>
        </div>
        <p className="saved-section-intro">Timestamps point to detected cues, not diagnoses or objective judgments. Each replay jump starts two seconds earlier so you can review the context.</p>
        {timelineLanes.length > 0 && <div className="attempt-timeline saved-attempt-timeline">
          {timelineLanes.map((lane) => (
            <div className="timeline-lane" key={lane.id}>
              <span className="timeline-lane-label">{lane.label}</span>
              <div className="timeline-track">
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
        </div>}
        {events.length === 0
          ? <p className="empty-list">No timestamped delivery cues were retained for this attempt.</p>
          : <ul className="saved-timeline-list">{events.map((event) => <li key={event.id}>
            <button type="button" onClick={() => seekToEvent(event)} disabled={!recordingReady} aria-label={`${recordingReady ? 'Play' : 'Saved observation at'} ${formatClock(event.startMs)}: ${event.label}`}>
              <time dateTime={`PT${Math.floor(event.startMs / 1_000)}S`}>{formatClock(event.startMs)}</time>
              <span className="saved-timeline-copy"><strong>{event.label}</strong><small>{sourceLabel(event.source)} · {event.evidence}</small></span>
              <span aria-hidden="true">{recordingReady ? '▶' : '·'}</span>
            </button>
          </li>)}</ul>}
        {!recordingReady && events.length > 0 && <p className="saved-timeline-boundary">These observations remain readable without a replay. Timestamp buttons become playable only when the private video is ready.</p>}
      </section>

      <section className="surface saved-transcript-card" aria-labelledby="transcriptTitle">
        <div className="section-title-row"><div><p className="overline">What was said</p><h2 id="transcriptTitle">Attempt transcript</h2></div><span className="session-status">{review.attempt.transcriptSource}</span></div>
        <blockquote>{review.attempt.transcript}</blockquote>
      </section>

      <section className="surface saved-rubric-card" aria-labelledby="rubricEvidenceTitle">
        <div className="section-title-row"><div><p className="overline">Traceable substance review</p><h2 id="rubricEvidenceTitle">Rubric evidence retained with this attempt</h2></div><span className="session-status">{review.evidence.length} {review.evidence.length === 1 ? 'criterion' : 'criteria'}</span></div>
        <p className="saved-section-intro">Coverage below describes explicit evidence in this transcript. It does not evaluate confidence, intelligence, or general speaking skill.</p>
        {review.evidence.length === 0
          ? <p className="empty-list">No rubric verdicts were retained for this attempt.</p>
          : <div className="saved-rubric-list">{review.evidence.map((item) => <article key={item.criterionId}>
            <div className="saved-rubric-heading"><h3>{item.criterionName}</h3><span>{Math.round(item.coverageScore * 100)}% explicit coverage · {item.verdict}</span></div>
            {item.citedSpan
              ? <blockquote>{item.citedSpan}</blockquote>
              : <p className="saved-no-citation">No transcript span matched this criterion.</p>}
            {item.missingEvidence.length > 0 && <div className="saved-missing-evidence"><strong>Evidence to make explicit next time</strong><ul>{item.missingEvidence.map((cue) => <li key={cue}>{cue}</li>)}</ul></div>}
          </article>)}</div>}
      </section>

      <p className="production-boundary-note">Delivery indices summarize deterministic browser cues and depend on camera, microphone, framing, and tracking quality. They support review; they do not measure confidence, truth, or presentation ability.</p>
    </section>
  );
}
