'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import katoAlert from '../../../../../src/assets/mascot/kato-macaw-alert.svg';
import katoQuestioning from '../../../../../src/assets/mascot/kato-macaw-questioning.svg';
import katoReading from '../../../../../src/assets/mascot/kato-macaw-reading.svg';
import { DEFAULT_RUBRIC, parseRubric } from '@/lib/analyzer';
import { requestContract } from '@/lib/api/client';
import {
  ProjectWorkspaceResponseSchema,
  type ProjectLanguage,
  type ProjectWorkspaceResponse,
  type SavedSession,
} from '@/lib/contracts';
import { parseSavedSessions, PRODUCTION_SESSIONS_KEY, summarizeRecurringWeaknesses } from '@/lib/progress';
import { writeProjectToCurrentUrl } from '@/lib/project-route';
import { readStoredRubricCriteria } from '@/lib/rubric-storage';
import { useOwnedProjects } from '@/components/use-owned-projects';

interface DashboardCriterion {
  id: string;
  name: string;
}

interface DashboardState {
  criteria: DashboardCriterion[];
  hasSavedRubric: boolean;
  sessions: SavedSession[];
}

type SelectedProjectState =
  | { status: 'idle'; projectId: null; workspace: null; error: null }
  | { status: 'loading'; projectId: string; workspace: null; error: null }
  | { status: 'ready'; projectId: string; workspace: ProjectWorkspaceResponse['workspace']; error: null }
  | { status: 'error'; projectId: string; workspace: null; error: string };

const starterCriteria = parseRubric(DEFAULT_RUBRIC).map((criterion) => ({
  id: criterion.id,
  name: criterion.label,
}));

const initialDashboard: DashboardState = {
  criteria: starterCriteria,
  hasSavedRubric: false,
  sessions: [],
};

const initialSelectedProject: SelectedProjectState = {
  status: 'idle',
  projectId: null,
  workspace: null,
  error: null,
};

function sessionDate(value: string): { day: number; month: string; label: string } {
  const date = new Date(value);
  return {
    day: date.getDate(),
    month: date.toLocaleString('en', { month: 'short' }),
    label: date.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }),
  };
}

function coverageLabel(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/u, '')}%`;
}

function projectInitials(title: string): string {
  const letters = title.split(/\s+/u).filter(Boolean).slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase() ?? '').join('');
  return letters || 'TA';
}

function projectLanguageLabel(language: ProjectLanguage): string {
  return language === 'id-ID' ? 'Bahasa Indonesia' : 'English';
}

const mismatchedProjectMessage = 'The server returned a different project. Nothing from it was shown.';

function projectLoadErrorMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message.trim() : '';
  if (message === mismatchedProjectMessage || /not found|took too long/iu.test(message)) {
    return message;
  }
  return 'The saved project could not be verified. Check your connection and try again.';
}

const TRAJECTORY_LIMIT = 6;

/**
 * Coverage across the last few saved attempts, oldest first. Only the shape of
 * the run is interesting here; the numbers themselves live on Progress, and
 * repeating them would make two screens responsible for the same claim.
 */
function coverageTrajectory(sessions: readonly SavedSession[]) {
  const ordered = [...sessions]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-TRAJECTORY_LIMIT);
  if (ordered.length < 2) return null;

  const points = ordered.map((session) => session.evidenceScore);
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  return {
    points,
    first,
    last,
    delta: Math.round(last - first),
    // A run of two is a pair, not a trend, and saying otherwise would be a
    // claim the data cannot carry.
    describable: ordered.length >= 3,
  };
}

export default function WorkspaceHomePage() {
  const [dashboard, setDashboard] = useState<DashboardState>(initialDashboard);
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<SelectedProjectState>(initialSelectedProject);
  const [projectRequestVersion, setProjectRequestVersion] = useState(0);
  const { projects, loading: projectsLoading } = useOwnedProjects();

  useEffect(() => {
    const requestedProject = new URLSearchParams(window.location.search).get('project');
    if (requestedProject) setChosenProjectId(requestedProject);
    setSelectionHydrated(true);
    const savedCriteria = readStoredRubricCriteria(localStorage);
    const sessions = parseSavedSessions(localStorage.getItem(PRODUCTION_SESSIONS_KEY))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || right.id.localeCompare(left.id));
    setDashboard({
      criteria: (savedCriteria ?? starterCriteria).map((criterion) => ({
        id: criterion.id,
        name: criterion.name,
      })),
      hasSavedRubric: savedCriteria !== null,
      sessions,
    });
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
    function restoreProjectFromHistory(): void {
      setSelectionNotice(null);
      setChosenProjectId(new URLSearchParams(window.location.search).get('project'));
    }
    window.addEventListener('popstate', restoreProjectFromHistory);
    return () => window.removeEventListener('popstate', restoreProjectFromHistory);
  }, []);

  useEffect(() => {
    if (!selectionHydrated || projectsLoading) return;
    if (projects.length === 0) {
      if (chosenProjectId) {
        setSelectionNotice('That synced project is not available in this session. Your local workspace is shown instead.');
        setChosenProjectId(null);
        writeProjectToUrl(null, 'replace');
      }
      return;
    }
    if (chosenProjectId && projects.some((summary) => summary.project.id === chosenProjectId)) return;

    const fallbackProject = projects[0]!.project;
    if (chosenProjectId) {
      setSelectionNotice(`That project is not available. ${fallbackProject.title} is shown instead.`);
    }
    setChosenProjectId(fallbackProject.id);
    writeProjectToUrl(fallbackProject.id, 'replace');
  }, [chosenProjectId, projects, projectsLoading, selectionHydrated]);

  const activeProject = projects.find((summary) => summary.project.id === chosenProjectId)
    ?? null;
  const activeProjectId = activeProject?.project.id ?? null;

  useEffect(() => {
    if (!activeProjectId) {
      setSelectedProject(initialSelectedProject);
      return;
    }
    const abort = new AbortController();
    setSelectedProject({ status: 'loading', projectId: activeProjectId, workspace: null, error: null });
    void (async () => {
      try {
        const response = await requestContract(
          `/api/projects/${encodeURIComponent(activeProjectId)}`,
          ProjectWorkspaceResponseSchema,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        if (response.workspace.project.id !== activeProjectId) {
          throw new Error(mismatchedProjectMessage);
        }
        setSelectedProject({
          status: 'ready',
          projectId: activeProjectId,
          workspace: response.workspace,
          error: null,
        });
      } catch (caught) {
        if (abort.signal.aborted) return;
        setSelectedProject({
          status: 'error',
          projectId: activeProjectId,
          workspace: null,
          error: projectLoadErrorMessage(caught),
        });
      }
    })();
    return () => abort.abort();
  }, [activeProjectId, projectRequestVersion]);

  const selectedWorkspace = selectedProject.status === 'ready'
    && selectedProject.projectId === activeProjectId
    ? selectedProject.workspace
    : null;
  const projectDetailStatus = activeProjectId && selectedProject.projectId !== activeProjectId
    ? 'loading'
    : selectedProject.status;
  const activeProjectTitle = selectedWorkspace?.project.title
    ?? activeProject?.project.title
    ?? dashboard.sessions.find((session) => session.projectId === null)?.projectTitle
    ?? 'Local workspace';
  const activeProjectLanguage = selectedWorkspace?.project.language
    ?? activeProject?.project.language
    ?? 'id-ID';
  const practiceHref = activeProjectId
    ? `/practice?project=${encodeURIComponent(activeProjectId)}`
    : '/practice';
  const rubricHref = activeProjectId
    ? `/rubric?project=${encodeURIComponent(activeProjectId)}`
    : '/rubric';
  const progressHref = activeProjectId
    ? `/progress?project=${encodeURIComponent(activeProjectId)}`
    : '/progress';
  const projectSessions = dashboard.sessions.filter((session) => activeProjectId
    ? session.projectId === activeProjectId
    : session.projectId === null);
  const latestSession = projectSessions[0] ?? null;
  // Presentation mirrors already have a durable attempt behind the server
  // count. Interviews do not yet have a SQL attempt row, so only those
  // explicitly browser-only summaries are added here.
  const savedSessionCount = activeProject
    ? activeProject.attemptCount
      + projectSessions.filter((session) => session.rehearsalFormat === 'interview').length
    : projectSessions.length;
  const latestCoverage = latestSession?.evidenceScore ?? null;
  const latestIsComplete = latestCoverage === 100;
  const focusTitle = !latestSession
    ? savedSessionCount > 0
      ? `Continue this project with ${savedSessionCount} saved ${savedSessionCount === 1 ? 'attempt' : 'attempts'}.`
      : 'Start with one complete attempt against your active rubric.'
    : latestIsComplete
      ? 'Your latest saved attempt recorded complete rubric evidence coverage.'
      : `Pick up from your latest saved focus: ${latestSession.weakest}.`;
  const focusDescription = !latestSession
    ? savedSessionCount > 0
      ? 'Open Progress for the synced evidence history, or rehearse again against this project’s rubric and language.'
      : 'Save one reviewed attempt to make this dashboard follow your real rubric evidence.'
    : latestIsComplete
      ? 'That result describes one saved transcript, not confidence or speaking ability. Rehearse again to see whether the evidence holds.'
      : `The latest saved transcript recorded ${coverageLabel(latestSession.evidenceScore)} explicit rubric coverage. Open Progress to inspect its retained quote or missing cues before rehearsing again.`;

  // Both come from attempts already saved in this browser. Neither invents a
  // reading: a gap is only called recurring once it has survived more than one
  // attempt, and a run is only described once there are three of them.
  const trajectory = coverageTrajectory(projectSessions);
  const recurringGap = summarizeRecurringWeaknesses(projectSessions)
    .sort((left, right) => right.gapCount - left.gapCount
      || (left.averageCoverage ?? 1) - (right.averageCoverage ?? 1))[0] ?? null;

  // Kato's pose reports the state of the work rather than decorating it, so the
  // dashboard is readable from across a booth before anyone reads a word. Each
  // pose is a different drawing with its own dimensions; carrying them through
  // keeps the swap from shifting the layout.
  const coach = !latestSession
    ? { art: katoQuestioning, state: 'waiting', bubble: 'Ready for the hard question?' }
    : latestIsComplete
      ? { art: katoReading, state: 'supported', bubble: 'Every criterion is supported. Raise the bar?' }
      : { art: katoAlert, state: 'gap', bubble: `One gap is still open: ${latestSession.weakest}.` };
  const selectionResolving = activeProject === null
    && (chosenProjectId !== null || projects.length > 0);

  if (!selectionHydrated || projectsLoading || selectionResolving) {
    return (
      <section className="view is-visible" aria-labelledby="homeTitle">
        <header className="page-header">
          <div><p className="overline">Your workspace</p><h1 id="homeTitle">Make your next answer harder to challenge.</h1></div>
        </header>
        <section className="surface" role="status" aria-live="polite" aria-busy="true">
          <p className="empty-list">Checking which project belongs here…</p>
        </section>
      </section>
    );
  }

  const syncedRubricConfirmed = Boolean(selectedWorkspace?.rubric?.confirmedAt);
  const activeCriteria = activeProjectId
    ? syncedRubricConfirmed ? selectedWorkspace!.criteria : []
    : dashboard.criteria;
  const rubricCount = activeCriteria.length;

  return (
    <section className="view is-visible" aria-labelledby="homeTitle">
      <header className="page-header">
        <div><p className="overline">Your workspace</p><h1 id="homeTitle">Make your next answer harder to challenge.</h1></div>
      </header>

      {projects.length > 1 && <div className="project-switcher">
        <label htmlFor="workspaceProject">Project</label>
        <select id="workspaceProject" value={activeProjectId ?? ''} onChange={(event) => chooseProject(event.target.value)}>
          {projects.map((summary) => <option key={summary.project.id} value={summary.project.id}>{summary.project.title}</option>)}
        </select>
        <span className="project-switcher-meta">The project, rubric, language, practice, and saved progress stay together.</span>
      </div>}

      {selectionNotice && <p className="empty-list" role="status">{selectionNotice}</p>}

      <section className="focus-card" aria-labelledby="focusTitle">
        <div className="focus-main">
          <div className="project-kicker"><span className="project-avatar">{projectInitials(activeProjectTitle)}</span><span><small>Current project · {projectLanguageLabel(activeProjectLanguage)}</small><strong>{activeProjectTitle}</strong></span></div>
          <h2 id="focusTitle">{focusTitle}</h2>
          <p>{focusDescription}</p>
          <div className="focus-actions">
            <Link className="button button-light" href={practiceHref}>Continue practising</Link>
            <Link className="button button-ghost-light" href={rubricHref}>Review rubric</Link>
          </div>
        </div>
        <aside className="focus-coach" aria-label="Talk-Active rehearsal guide">
          <img className="focus-mascot" data-coach={coach.state} src={coach.art.src} alt="" width={coach.art.width} height={coach.art.height} />
          <p className="coach-bubble">{coach.bubble}</p>
        </aside>
        <div className="focus-stats">
          <div className="focus-stat"><span>Last evidence coverage</span><strong>{latestCoverage === null ? '—' : coverageLabel(latestCoverage)}</strong><small>{latestSession ? `Saved ${sessionDate(latestSession.createdAt).label}` : 'No reviewed attempt saved yet'}</small></div>
          <div className="focus-stat"><span>Latest focus</span><strong className="stat-word">{latestSession ? latestIsComplete ? 'No saved gap' : latestSession.weakest : '—'}</strong><small>{latestSession ? 'Recorded in the latest saved attempt' : 'Appears after the first review'}</small></div>
          <div className="focus-stat"><span>Saved sessions</span><strong>{savedSessionCount}</strong><small>{activeProject ? 'Synced attempts plus unmatched browser-only summaries' : 'Valid attempts retained in this browser'}</small></div>
        </div>
      </section>

      {(recurringGap || trajectory) && <section className="insight-band" aria-labelledby="insightTitle">
        <div className="section-title-row">
          <div><p className="overline">Read from your saved attempts</p><h2 id="insightTitle">What to rehearse next</h2></div>
          <Link className="text-button" href={progressHref}>Open Progress</Link>
        </div>
        <div className="insight-grid">
          {recurringGap && <article className="insight-card is-gap">
            <p className="overline">The gap that keeps returning</p>
            <strong className="insight-headline">{recurringGap.criterionName}</strong>
            <p className="insight-detail">
              Unsupported in {recurringGap.gapCount} of {recurringGap.attemptCount} saved {recurringGap.attemptCount === 1 ? 'attempt' : 'attempts'}.
            </p>
            {recurringGap.latestMissingEvidence.length > 0 && <p className="insight-cues">
              <span>Still missing</span>
              {recurringGap.latestMissingEvidence.slice(0, 3).map((cue) => <span className="signal-chip" key={cue}>{cue}</span>)}
            </p>}
            <Link className="button button-secondary" href={practiceHref}>Rehearse this criterion</Link>
          </article>}

          {trajectory && <article className="insight-card">
            <p className="overline">Coverage across attempts</p>
            <strong className="insight-headline">
              {coverageLabel(trajectory.first)} <span aria-hidden="true">→</span> {coverageLabel(trajectory.last)}
            </strong>
            {/* The bars carry the shape; the sentence under them carries the
                claim. A chart nobody can read aloud is not evidence. */}
            <svg
              className="insight-spark"
              viewBox={`0 0 ${trajectory.points.length * 12} 32`}
              role="img"
              aria-label={`Evidence coverage across the last ${trajectory.points.length} saved attempts: ${trajectory.points.map((point) => coverageLabel(point)).join(', ')}.`}
              preserveAspectRatio="none"
            >
              {trajectory.points.map((point, index) => (
                <rect
                  key={`${index}-${point}`}
                  x={index * 12}
                  y={32 - Math.max(2, (point / 100) * 32)}
                  width="8"
                  height={Math.max(2, (point / 100) * 32)}
                  rx="1"
                />
              ))}
            </svg>
            <p className="insight-detail">
              {trajectory.describable
                ? `${trajectory.delta === 0 ? 'Level' : trajectory.delta > 0 ? `Up ${trajectory.delta} points` : `Down ${Math.abs(trajectory.delta)} points`} across the last ${trajectory.points.length} saved attempts.`
                : 'Two saved attempts is a pair, not yet a trend. Save one more to see a direction.'}
            </p>
            <p className="insight-boundary">Coverage counts explicit rubric evidence in a transcript. It is not a score for you.</p>
          </article>}
        </div>
      </section>}

      <div className="dashboard-grid">
        <section className="surface next-session" aria-labelledby="nextSessionTitle">
          <div className="section-title-row"><div><p className="overline">Recommended session</p><h2 id="nextSessionTitle">Your next grounded drill</h2></div><span className="time-pill">3 steps</span></div>
          <ol className="session-plan">
            <li><span>1</span><div><strong>Deliver your current pitch</strong><small>Paste one complete attempt.</small></div></li>
            <li><span>2</span><div><strong>Inspect one unsupported claim</strong><small>Trace it to the active rubric.</small></div></li>
            <li><span>3</span><div><strong>Defend it under pressure</strong><small>Answer one grounded follow-up.</small></div></li>
          </ol>
        </section>
        <section
          className="surface rubric-health"
          aria-labelledby="rubricHealthTitle"
          aria-busy={activeProjectId ? projectDetailStatus === 'loading' : false}
        >
          <div className="section-title-row">
            <div><p className="overline">Preparation</p><h2 id="rubricHealthTitle">Active rubric</h2></div>
            <span className="health-ring" aria-label={projectDetailStatus === 'loading' ? 'Loading active criteria' : `${rubricCount} active criteria`}>
              {projectDetailStatus === 'loading' ? '…' : rubricCount}
            </span>
          </div>
          {activeProjectId && projectDetailStatus === 'loading' && (
            <p role="status" aria-live="polite">Loading {activeProjectTitle}&rsquo;s confirmed rubric…</p>
          )}
          {activeProjectId && projectDetailStatus === 'error' && selectedProject.status === 'error' && (
            <div role="alert">
              <p>{activeProjectTitle}&rsquo;s rubric could not be loaded. {selectedProject.error}</p>
              <button className="button button-secondary" type="button" onClick={() => setProjectRequestVersion((version) => version + 1)}>Try again</button>
            </div>
          )}
          {activeProjectId && projectDetailStatus === 'ready' && syncedRubricConfirmed && (
            <p>{rubricCount} confirmed {rubricCount === 1 ? 'criterion belongs' : 'criteria belong'} to {activeProjectTitle}.</p>
          )}
          {activeProjectId && projectDetailStatus === 'ready' && !syncedRubricConfirmed && (
            <p>No confirmed rubric belongs to {activeProjectTitle} yet. Confirm its evaluator criteria before relying on a rehearsal review.</p>
          )}
          {!activeProjectId && (
            <p>{dashboard.hasSavedRubric
              ? `${dashboard.criteria.length} confirmed criteria are saved in this browser.`
              : `${dashboard.criteria.length} starter criteria are active until you save your evaluator rubric.`}</p>
          )}
          {rubricCount > 0 && <div className="mini-criteria">{activeCriteria.map((criterion) => <div className="mini-criterion" key={criterion.id}><i /><span>{criterion.name}</span></div>)}</div>}
          <Link className="text-button" href={rubricHref}>{syncedRubricConfirmed || !activeProjectId ? 'Edit evaluation criteria' : 'Set up evaluation criteria'} <span aria-hidden="true">→</span></Link>
        </section>
      </div>
      <section className="surface recent-section" aria-labelledby="recentTitle">
        <div className="section-title-row"><div><p className="overline">Practice log</p><h2 id="recentTitle">Recent sessions</h2></div><Link className="text-button" href={progressHref}>View all</Link></div>
        {projectSessions.length === 0
          ? <p className="empty-list">No rehearsals saved yet. Complete one practice attempt and its traceable evidence will appear here.</p>
          : <div className="session-list">{projectSessions.slice(0, 3).map((session) => {
            const date = sessionDate(session.createdAt);
            return <article className="session-row" key={session.id}>
              <span className="session-date" aria-label={date.label}>{date.day}<br />{date.month}</span>
              <span><strong>{activeProjectTitle}</strong><small>Saved focus: {session.weakest}</small></span>
              <span className="session-score"><span className="score-track"><i style={{ width: coverageLabel(session.evidenceScore) }} /></span>{coverageLabel(session.evidenceScore)}</span>
              <span className="session-status">{session.defenseStatus ?? 'review only'}</span>
              <span aria-hidden="true">→</span>
            </article>;
          })}</div>}
      </section>
    </section>
  );
}
