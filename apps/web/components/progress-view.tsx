'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import logo from '../../../src/assets/LOGO-dashboard.png';
import { requestContract } from '@/lib/api/client';
import {
  ProgressResponseSchema,
  type AttemptComparison,
  type CriterionAttemptComparison,
  type ProgressResponse,
  type RecurringWeakness,
  type SavedSession,
} from '@/lib/contracts';
import {
  parseSavedSessions,
  compareAttemptEvidence,
  PRODUCTION_SESSIONS_KEY,
  summarizeRecurringWeaknesses,
} from '@/lib/progress';

type SyncState = 'local' | 'loading' | 'synced' | 'unavailable';

function latestRemoteProjectId(sessions: SavedSession[]): string | null {
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const projectId = sessions[index]?.projectId;
    if (projectId) return projectId;
  }
  return null;
}

function historyLabel(state: SyncState): string {
  if (state === 'synced') return 'Synced SQL history';
  if (state === 'loading') return 'Checking synced history…';
  if (state === 'unavailable') return 'Local history · sync unavailable';
  return 'Local browser history';
}

function WeaknessEvidence({ weakness }: Readonly<{ weakness: RecurringWeakness }>) {
  if (weakness.summaryOnly) {
    return <p className="recurring-boundary">Historical summary only. That session did not retain the original criterion quote or missing-cue list.</p>;
  }
  return <div className="recurring-evidence">
    {weakness.latestCitedSpan && <blockquote>{weakness.latestCitedSpan}</blockquote>}
    {weakness.latestMissingEvidence.length > 0 && <p><strong>Latest explicit gaps:</strong> {weakness.latestMissingEvidence.slice(0, 4).join(', ')}.</p>}
    <small>Latest saved evidence · {new Date(weakness.latestAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</small>
  </div>;
}

function attemptDate(value: string): string {
  return new Date(value).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

function movementLabel(comparison: CriterionAttemptComparison): string {
  if (comparison.direction === 'added') return 'criterion added';
  if (comparison.direction === 'removed') return 'criterion removed';
  if (comparison.direction === 'unchanged') return 'explicit coverage unchanged';
  return `explicit coverage ${comparison.direction}`;
}

function ComparisonEvidence({
  label,
  criterion,
}: Readonly<{
  label: string;
  criterion: CriterionAttemptComparison['previous'];
}>) {
  return <section className="attempt-diff-side">
    <p className="overline">{label}</p>
    {!criterion
      ? <p className="attempt-diff-absent">This criterion was not present in this rubric.</p>
      : <>
        <strong>{Math.round(criterion.coverage * 100)}% explicit coverage</strong>
        {criterion.citedSpan
          ? <blockquote>{criterion.citedSpan}</blockquote>
          : <p className="attempt-diff-absent">No cited transcript evidence.</p>}
        {criterion.missingEvidence.length > 0 && <p><b>Still missing:</b> {criterion.missingEvidence.slice(0, 4).join(', ')}.</p>}
      </>}
  </section>;
}

function AttemptDiff({ comparison }: Readonly<{ comparison: AttemptComparison }>) {
  return <section className="surface attempt-diff-card" aria-labelledby="attemptDiffTitle">
    <div className="section-title-row"><div><p className="overline">Latest evidence change</p><h2 id="attemptDiffTitle">What changed between the last two reviewed attempts</h2></div><span className="session-status">{attemptDate(comparison.previousCreatedAt)} → {attemptDate(comparison.currentCreatedAt)}</span></div>
    <p className="attempt-diff-intro">Each row compares retained transcript evidence for the same rubric criterion. Movement describes explicit coverage in these attempts—not confidence or ability.</p>
    <div className="attempt-diff-list">{comparison.criteria.map((criterion) => <article className="attempt-diff-item" key={criterion.criterionId} data-direction={criterion.direction}>
      <div className="attempt-diff-heading"><h3>{criterion.criterionName}</h3><span>{movementLabel(criterion)}{criterion.direction === 'added' || criterion.direction === 'removed' ? '' : ` · ${criterion.coverageDelta >= 0 ? '+' : ''}${Math.round(criterion.coverageDelta * 100)} points`}</span></div>
      <div className="attempt-diff-evidence"><ComparisonEvidence label="Previous attempt" criterion={criterion.previous} /><ComparisonEvidence label="Current attempt" criterion={criterion.current} /></div>
    </article>)}</div>
  </section>;
}

export function ProgressView() {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [synced, setSynced] = useState<ProgressResponse | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('local');

  useEffect(() => {
    const loaded = parseSavedSessions(localStorage.getItem(PRODUCTION_SESSIONS_KEY));
    setSessions(loaded);
    const projectId = latestRemoteProjectId(loaded);
    if (!projectId) return;
    const abort = new AbortController();
    setSyncState('loading');
    void requestContract(`/api/progress/${projectId}`, ProgressResponseSchema, { signal: abort.signal })
      .then((progress) => {
        setSynced(progress);
        setSyncState('synced');
      })
      .catch(() => {
        if (!abort.signal.aborted) setSyncState('unavailable');
      });
    return () => abort.abort();
  }, []);

  const progressProjectId = latestRemoteProjectId(sessions);
  const scopedSessions = useMemo(() => sessions.filter((session) =>
    progressProjectId ? session.projectId === progressProjectId : session.projectId === null),
  [sessions, progressProjectId]);
  const localWeaknesses = useMemo(() => summarizeRecurringWeaknesses(scopedSessions), [scopedSessions]);
  const localComparisons = useMemo(() => compareAttemptEvidence(scopedSessions), [scopedSessions]);
  const recurringWeaknesses = syncState === 'synced'
    ? synced?.recurringWeaknesses ?? []
    : localWeaknesses;
  const trendPoints = syncState === 'synced'
    ? (synced?.attempts ?? []).map((attempt) => ({
      id: attempt.attemptId,
      createdAt: attempt.createdAt,
      evidenceScore: Math.round(attempt.coverage * 100),
    }))
    : scopedSessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      evidenceScore: session.evidenceScore,
    }));
  const latest = trendPoints.at(-1);
  const previous = trendPoints.at(-2);
  const delta = latest && previous ? latest.evidenceScore - previous.evidenceScore : null;
  const primaryWeakness = recurringWeaknesses[0];
  const latestComparison = syncState === 'synced'
    ? synced?.attemptComparisons.at(-1)
    : localComparisons.at(-1);

  return <section className="view is-visible" aria-labelledby="progressTitle">
    <header className="page-header compact-header workflow-header"><div className="workflow-heading"><img className="workflow-mark" src={logo.src} alt="" /><div><p className="overline">Practice history</p><h1 id="progressTitle">See what changed between attempts.</h1><p className="page-lede">Track explicit evidence and recurring weak claims without inventing a universal speaking score.</p></div></div><Link className="button button-primary" href="/practice">New practice</Link></header>

    <div className="progress-stats">
      <article className="surface"><span>Sessions</span><strong>{trendPoints.length}</strong><small>{syncState === 'synced' ? 'saved to this project' : 'saved in this browser'}</small></article>
      <article className="surface"><span>Latest coverage</span><strong>{latest ? `${latest.evidenceScore}%` : '—'}</strong><small>{delta === null ? 'No comparison yet' : `${delta >= 0 ? '+' : ''}${delta} points from prior attempt`}</small></article>
      <article className="surface"><span>Most recurring gap</span><strong className="stat-word">{primaryWeakness?.criterionName ?? '—'}</strong><small>{primaryWeakness ? `${primaryWeakness.gapCount} incomplete ${primaryWeakness.gapCount === 1 ? 'attempt' : 'attempts'}` : 'No repeated criterion gap yet'}</small></article>
    </div>

    {latestComparison
      ? <AttemptDiff comparison={latestComparison} />
      : <section className="surface attempt-diff-card"><div className="section-title-row"><div><p className="overline">Latest evidence change</p><h2>What changed between attempts</h2></div></div><p className="empty-list">Save two reviewed attempts with criterion evidence to compare their exact quotes and gaps.</p></section>}

    <section className="surface recurring-card" aria-labelledby="recurringTitle">
      <div className="section-title-row"><div><p className="overline">Pattern across attempts</p><h2 id="recurringTitle">The criteria that keep returning</h2></div><span className="session-status">{historyLabel(syncState)}</span></div>
      <p className="recurring-intro">A criterion appears here only after at least two attempts left some required evidence implicit. Coverage describes this saved transcript history—not your ability.</p>
      {recurringWeaknesses.length === 0
        ? <p className="empty-list">Complete another reviewed attempt before Talk-Active calls any gap recurring.</p>
        : <div className="recurring-list">{recurringWeaknesses.map((weakness, index) => <article className="recurring-item" key={weakness.criterionId}>
          <div className="recurring-rank" aria-hidden="true">{index + 1}</div>
          <div className="recurring-copy">
            <div className="recurring-heading"><h3>{weakness.criterionName}</h3>{weakness.averageCoverage !== null && <span>{Math.round(weakness.averageCoverage * 100)}% average explicit coverage</span>}</div>
            <p>{weakness.summaryOnly
              ? `${weakness.gapCount} saved ${weakness.gapCount === 1 ? 'session named' : 'sessions named'} this as the weakest criterion.`
              : `${weakness.gapCount} of ${weakness.attemptCount} reviewed ${weakness.attemptCount === 1 ? 'attempt stayed' : 'attempts stayed'} below complete explicit coverage.`}</p>
            <WeaknessEvidence weakness={weakness} />
          </div>
        </article>)}</div>}
    </section>

    <section className="surface progress-chart-card"><div className="section-title-row"><div><p className="overline">Evidence trend</p><h2>Rubric coverage by attempt</h2></div><span className="session-status">{historyLabel(syncState)}</span></div><div className="chart" aria-label="Evidence coverage chart">{trendPoints.length === 0 ? <p className="chart-empty">Save a practice session to begin the evidence trend.</p> : trendPoints.map((session, index) => <div className="chart-column" key={session.id}><span className="chart-value">{session.evidenceScore}%</span><i className="chart-bar" style={{ height: `${Math.max(4, session.evidenceScore * 2)}px` }} /><span className="chart-label">Attempt {index + 1}</span></div>)}</div></section>

    <section className="surface history-card"><div className="section-title-row"><div><p className="overline">Session archive</p><h2>Every locally saved attempt</h2></div></div><div className="session-list full-session-list">{scopedSessions.length === 0 ? <p className="empty-list">No sessions saved in the production guest workspace yet.</p> : [...scopedSessions].reverse().map((session) => { const date = new Date(session.createdAt); return <article className="session-row" key={session.id}><span className="session-date">{date.getDate()}<br />{date.toLocaleString('en', { month: 'short' })}</span><span><strong>Talk-Active · RISTEK Finals</strong><small>Focus: {session.weakest}</small></span><span className="session-score"><span className="score-track"><i style={{ width: `${session.evidenceScore}%` }} /></span>{session.evidenceScore}%</span><span className="session-status">{session.defenseStatus ?? 'review only'}</span><span aria-hidden="true">→</span></article>; })}</div></section>
    <p className="production-boundary-note">Synced progress is aggregated from saved verdict rows with zero model calls. Older local summaries remain labelled when their original criterion evidence was never retained.</p>
  </section>;
}
