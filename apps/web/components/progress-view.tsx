'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import { requestContract } from '@/lib/api/client';
import {
  ProgressResponseSchema,
  type AttemptComparison,
  type CriterionAttemptComparison,
  type ProgressResponse,
  type ProjectSummary,
  type RecurringWeakness,
  type SavedSession,
} from '@/lib/contracts';
import {
  parseSavedSessions,
  buildCriterionTrails,
  compareAttemptEvidence,
  latestCompatibleProgressHistory,
  latestCompatibleSavedSessions,
  mergeProgressHistory,
  PRODUCTION_SESSIONS_KEY,
  summarizeRecurringWeaknesses,
} from '@/lib/progress';
import { writeProjectToCurrentUrl } from '@/lib/project-route';
import { CoverageTrend, CriterionSparkline } from './progress-charts';
import { useOwnedProjects } from './use-owned-projects';

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

function trendHistoryLabel(
  state: SyncState,
  rehearsalFormat: SavedSession['rehearsalFormat'] | null,
): string {
  if (rehearsalFormat === 'interview') return 'Interview answer aggregates only';
  if (rehearsalFormat === 'presentation') return state === 'synced'
    ? 'Synced presentation attempts'
    : 'Presentation attempts only';
  return historyLabel(state);
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
  // Only criteria that actually moved get the full two-column evidence. The
  // rest used to render both sides of an identical quote, so a rubric where
  // nothing changed produced the longest page on the site and buried the one
  // criterion that did move. The unchanged ones are still named, because
  // "these held" is information — it just is not worth two quotes each.
  const moved = comparison.criteria.filter((criterion) => criterion.direction !== 'unchanged');
  const held = comparison.criteria.filter((criterion) => criterion.direction === 'unchanged');

  return <section className="surface attempt-diff-card" aria-labelledby="attemptDiffTitle">
    <div className="section-title-row"><div><p className="overline">Latest evidence change</p><h2 id="attemptDiffTitle">What changed between the last two reviewed attempts</h2></div><span className="session-status">{attemptDate(comparison.previousCreatedAt)} → {attemptDate(comparison.currentCreatedAt)}</span></div>
    <p className="attempt-diff-intro">Movement describes explicit coverage in these two attempts—not confidence or ability.</p>
    {moved.length === 0
      ? <p className="empty-list">Explicit coverage held steady on every criterion between these two attempts.</p>
      : <div className="attempt-diff-list">{moved.map((criterion) => <article className="attempt-diff-item" key={criterion.criterionId} data-direction={criterion.direction}>
        <div className="attempt-diff-heading"><h3>{criterion.criterionName}</h3><span>{movementLabel(criterion)}{criterion.direction === 'added' || criterion.direction === 'removed' ? '' : ` · ${criterion.coverageDelta >= 0 ? '+' : ''}${Math.round(criterion.coverageDelta * 100)} points`}</span></div>
        <div className="attempt-diff-evidence"><ComparisonEvidence label="Previous attempt" criterion={criterion.previous} /><ComparisonEvidence label="Current attempt" criterion={criterion.current} /></div>
      </article>)}</div>}
    {held.length > 0 && <p className="attempt-diff-held"><strong>Unchanged:</strong> {held.map((criterion) => criterion.criterionName).join(', ')}. Their retained evidence is on each saved attempt.</p>}
  </section>;
}

/** The one local workspace a signed-out visitor practises in. */
const LOCAL_WORKSPACE_LABEL = 'Local workspace';

export function ProgressView() {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [synced, setSynced] = useState<ProgressResponse | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('local');
  const { projects, loading: projectsLoading } = useOwnedProjects();
  // Null means "whatever the newest saved attempt belongs to". Set once the
  // user picks, so switching projects does not fight the default.
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  useEffect(() => {
    setSessions(parseSavedSessions(localStorage.getItem(PRODUCTION_SESSIONS_KEY)));
    setChosenProjectId(new URLSearchParams(window.location.search).get('project'));
    setSelectionHydrated(true);

    function restoreProjectFromHistory(): void {
      setSelectionNotice(null);
      setChosenProjectId(new URLSearchParams(window.location.search).get('project'));
    }
    window.addEventListener('popstate', restoreProjectFromHistory);
    return () => window.removeEventListener('popstate', restoreProjectFromHistory);
  }, []);

  function writeProjectToUrl(projectId: string | null, mode: 'push' | 'replace'): void {
    writeProjectToCurrentUrl(projectId, mode);
  }

  function chooseProject(projectId: string): void {
    if (projectId === chosenProjectId) return;
    setSelectionNotice(null);
    setChosenProjectId(projectId);
    writeProjectToUrl(projectId, 'push');
  }

  useEffect(() => {
    if (!selectionHydrated || projectsLoading) return;
    if (projects.length === 0) {
      if (chosenProjectId) {
        setChosenProjectId(null);
        setSelectionNotice('That synced project is not available in this session. Local history is shown instead.');
        writeProjectToUrl(null, 'replace');
      }
      return;
    }
    if (chosenProjectId && projects.some((summary) => summary.project.id === chosenProjectId)) return;

    const savedProjectId = latestRemoteProjectId(sessions);
    const fallback = projects.find((summary) => summary.project.id === savedProjectId)
      ?? projects[0]!;
    if (chosenProjectId) {
      setSelectionNotice(`That project is not available. ${fallback.project.title} is shown instead.`);
    }
    setChosenProjectId(fallback.project.id);
    writeProjectToUrl(fallback.project.id, 'replace');
  }, [chosenProjectId, projects, projectsLoading, selectionHydrated, sessions]);

  const progressProjectId = projects.some((summary) => summary.project.id === chosenProjectId)
    ? chosenProjectId
    : null;

  useEffect(() => {
    if (!progressProjectId) {
      setSynced(null);
      setSyncState('local');
      return;
    }
    const abort = new AbortController();
    setSyncState('loading');
    void requestContract(`/api/progress/${progressProjectId}`, ProgressResponseSchema, { signal: abort.signal })
      .then((progress) => {
        setSynced(progress);
        setSyncState('synced');
      })
      .catch(() => {
        if (!abort.signal.aborted) setSyncState('unavailable');
      });
    return () => abort.abort();
  }, [progressProjectId]);

  // Every archive row used to be stamped "Talk-Active · RISTEK Finals" — a
  // title compiled into the page rather than read from the project it names.
  // With more than one project that label is simply wrong, and it was already
  // wrong for anyone practising against a rubric of their own.
  const activeProjectTitle = projects.find((summary) => summary.project.id === progressProjectId)
    ?.project.title
    ?? sessions.find((session) => session.projectId === progressProjectId)?.projectTitle
    ?? LOCAL_WORKSPACE_LABEL;

  const scopedSessions = useMemo(() => sessions.filter((session) =>
    progressProjectId ? session.projectId === progressProjectId : session.projectId === null),
  [sessions, progressProjectId]);
  const compatibleScopedSessions = useMemo(
    () => latestCompatibleSavedSessions(scopedSessions),
    [scopedSessions],
  );
  const localWeaknesses = useMemo(
    () => summarizeRecurringWeaknesses(compatibleScopedSessions),
    [compatibleScopedSessions],
  );
  const localComparisons = useMemo(
    () => compareAttemptEvidence(compatibleScopedSessions),
    [compatibleScopedSessions],
  );
  const recurringWeaknesses = syncState === 'synced'
    ? synced?.recurringWeaknesses ?? []
    : localWeaknesses;
  const historyEntries = useMemo(() => mergeProgressHistory(
    syncState === 'synced' ? synced?.attempts ?? [] : [],
    scopedSessions,
  ), [scopedSessions, syncState, synced?.attempts]);
  const browserOnlyCount = syncState === 'synced'
    ? historyEntries.filter((entry) => entry.source === 'browser').length
    : 0;
  const compatibleHistoryEntries = useMemo(
    () => latestCompatibleProgressHistory(historyEntries),
    [historyEntries],
  );
  const trendPoints = compatibleHistoryEntries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    evidenceScore: entry.evidenceScore,
  }));
  const latest = trendPoints.at(-1);
  const previous = trendPoints.at(-2);
  const delta = latest && previous ? latest.evidenceScore - previous.evidenceScore : null;
  const latestTrendFormat = compatibleHistoryEntries.at(-1)?.rehearsalFormat ?? null;
  const primaryWeakness = recurringWeaknesses[0];
  const comparisons = syncState === 'synced' ? synced?.attemptComparisons ?? [] : localComparisons;
  const latestComparison = comparisons.at(-1);
  // Rebuilt from the same comparisons already on the page, so a recurring gap
  // can show its direction without another request.
  const trails = useMemo(
    () => new Map(buildCriterionTrails(comparisons).map((trail) => [trail.criterionId, trail])),
    [comparisons],
  );
  return <section className="view is-visible" aria-labelledby="progressTitle">
    <header className="page-header compact-header"><div className="workflow-heading"><img className="workflow-mark" src={logo.src} alt="" /><div><p className="overline">Practice history</p><h1 id="progressTitle">See what changed between attempts.</h1><p className="page-lede">Track explicit evidence and recurring weak claims without inventing a universal speaking score.</p></div></div></header>

    {/* The workspace has always held more than one project; the interface only
        ever admitted to one. This switcher appears once there is a second
        project to switch to, so a single-project account is not asked to
        operate a control with one option in it. */}
    {projects.length > 1 && <div className="project-switcher">
      <label htmlFor="progressProject">Project</label>
      <select id="progressProject" value={progressProjectId ?? ''} onChange={(event) => chooseProject(event.target.value)}>
        {projects.map((summary) => <option key={summary.project.id} value={summary.project.id}>{summary.project.title}</option>)}
      </select>
      <span className="project-switcher-meta">{(() => {
        const active = projects.find((summary) => summary.project.id === progressProjectId);
        if (!active) return 'Showing locally saved history.';
        if (browserOnlyCount > 0) {
          return `${active.attemptCount} synced ${active.attemptCount === 1 ? 'attempt' : 'attempts'} · ${browserOnlyCount} browser-only ${browserOnlyCount === 1 ? 'summary' : 'summaries'}`;
        }
        if (active.attemptCount === 0) return 'No attempts saved to this project yet.';
        return `${active.attemptCount} saved ${active.attemptCount === 1 ? 'attempt' : 'attempts'} · last on ${attemptDate(active.lastAttemptAt ?? active.project.updatedAt)}`;
      })()}</span>
    </div>}
    {selectionNotice && <p className="empty-list" role="status">{selectionNotice}</p>}

    <div className="progress-stats">
      <article className="surface"><span>Sessions</span><strong>{historyEntries.length}</strong><small>{syncState === 'synced' ? browserOnlyCount > 0 ? 'synced attempts + browser-only summaries' : 'saved to this project' : 'saved in this browser'}</small></article>
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
            <div className="recurring-heading"><h3>{weakness.criterionName}</h3><span>{weakness.summaryOnly
              ? `${weakness.gapCount} saved ${weakness.gapCount === 1 ? 'session' : 'sessions'}`
              : `${weakness.gapCount} of ${weakness.attemptCount} attempts`}{weakness.averageCoverage !== null ? ` · ${Math.round(weakness.averageCoverage * 100)}% average coverage` : ''}</span></div>
            {/* The count says a criterion is a problem. The line says whether it
                is becoming less of one — the part that decides whether to change
                tactics or keep going. */}
            {(() => {
              const trail = trails.get(weakness.criterionId);
              return trail ? <CriterionSparkline trail={trail} /> : null;
            })()}
            <WeaknessEvidence weakness={weakness} />
          </div>
        </article>)}</div>}
    </section>

    <section className="surface progress-chart-card"><div className="section-title-row"><div><p className="overline">Evidence trend</p><h2 id="coverageTrendTitle">Rubric coverage by attempt</h2></div><span className="session-status">{trendHistoryLabel(syncState, latestTrendFormat)}</span></div><CoverageTrend points={trendPoints} labelledBy="coverageTrendTitle" /></section>

    <section className="surface history-card">
      <div className="section-title-row"><div><p className="overline">Session archive</p><h2>{syncState === 'synced' ? 'Saved attempts and browser summaries' : 'Every locally saved attempt'}</h2></div></div>
      <div className="session-list full-session-list">{historyEntries.length === 0
        ? <p className="empty-list">{syncState === 'synced' ? 'No attempts or browser summaries have been saved to this project yet.' : 'No sessions saved in the production guest workspace yet.'}</p>
        : [...historyEntries].reverse().map((entry) => {
          const date = new Date(entry.createdAt);
          if (entry.source === 'browser') {
            const session = entry.session;
            return <article className="session-row browser-only-session" key={entry.id}>
              <span className="session-date">{date.getDate()}<br />{date.toLocaleString('en', { month: 'short' })}</span>
              <span><strong>{activeProjectTitle}</strong><small>{session.rehearsalFormat === 'interview' ? 'Interview answer aggregate' : syncState === 'synced' ? 'Browser-only presentation' : 'Presentation'} · Focus: {session.weakest}</small></span>
              <span className="session-score"><span className="score-track"><i style={{ width: `${entry.evidenceScore}%` }} /></span>{entry.evidenceScore}%</span>
              <span className="session-status">{syncState === 'synced' ? 'browser only' : session.defenseStatus ?? 'review only'}</span>
              <span aria-hidden="true">·</span>
            </article>;
          }
          const attempt = entry.attempt;
          const reviewable = attempt.hasDeliveryReview || attempt.recordingStatus !== null;
          const row = <>
            <span className="session-date">{date.getDate()}<br />{date.toLocaleString('en', { month: 'short' })}</span>
            <span><strong>{activeProjectTitle}</strong><small>{attempt.hasDeliveryReview ? 'Delivery observations and rubric evidence saved' : 'Rubric evidence saved'}</small></span>
            <span className="session-score"><span className="score-track"><i style={{ width: `${entry.evidenceScore}%` }} /></span>{entry.evidenceScore}%</span>
            <span className="session-status">{attempt.recordingStatus ? `replay ${attempt.recordingStatus}` : attempt.hasDeliveryReview ? 'review saved' : 'rubric only'}</span>
            <span aria-hidden="true">{reviewable ? '→' : '·'}</span>
          </>;
          return reviewable
            ? <Link className="session-row saved-attempt-link" href={`/attempts/${encodeURIComponent(attempt.attemptId)}${progressProjectId ? `?project=${encodeURIComponent(progressProjectId)}` : ''}`} key={entry.id} aria-label={`Review saved attempt from ${attemptDate(attempt.createdAt)}`}>{row}</Link>
            : <article className="session-row" key={entry.id}>{row}</article>;
        })}</div>
    </section>
    <p className="production-boundary-note">{syncState === 'synced'
      ? 'Recurring gaps and exact attempt comparisons use synced verdict rows only, with zero model calls. Project-scoped browser summaries appear only in the session count, coverage trend, and archive; separate interview answers remain page-local.'
      : 'Local recurring gaps and comparisons use only criterion evidence retained in this browser. Older summaries stay labelled when their original quote or missing-cue list was never retained.'}</p>
  </section>;
}
