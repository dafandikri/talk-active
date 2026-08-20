'use client';

import { useLocale, useTranslations } from 'next-intl';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import katoAlert from '../../../../../src/assets/mascot/kato-macaw-alert.svg';
import katoQuestioning from '../../../../../src/assets/mascot/kato-macaw-questioning.svg';
import katoReading from '../../../../../src/assets/mascot/kato-macaw-reading.svg';
import { defaultRubricFor, parseRubric } from '@/lib/analyzer';
import { requestContract } from '@/lib/api/client';
import {
  ProjectWorkspaceResponseSchema,
  type ProjectLanguage,
  type ProjectWorkspaceResponse,
  type SavedSession,
} from '@/lib/contracts';
import { parseSavedSessions, PRODUCTION_SESSIONS_KEY, summarizeRecurringWeaknesses } from '@/lib/progress';
import { readLocalProjectLanguage } from '@/lib/project-preferences';
import { writeProjectToCurrentUrl } from '@/lib/project-route';
import { readStoredRubricCriteria } from '@/lib/rubric-storage';
import { useOwnedProjects } from '@/components/use-owned-projects';
import { HTML_LANG, interfaceLocaleFrom } from '@/i18n/locales';

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

function starterCriteriaFor(language: ProjectLanguage): DashboardCriterion[] {
  return parseRubric(defaultRubricFor(language)).map((criterion) => ({
    id: criterion.id,
    name: criterion.label,
  }));
}

const initialDashboard: DashboardState = {
  criteria: starterCriteriaFor('id-ID'),
  hasSavedRubric: false,
  sessions: [],
};

const initialSelectedProject: SelectedProjectState = {
  status: 'idle',
  projectId: null,
  workspace: null,
  error: null,
};

function sessionDate(value: string, locale: string): { day: number; month: string; label: string } {
  const date = new Date(value);
  return {
    day: date.getDate(),
    month: date.toLocaleString(locale, { month: 'short' }),
    label: date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
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

type Translate = (key: string) => string;

function projectLanguageLabel(language: ProjectLanguage): string {
  return language === 'id-ID' ? 'Bahasa Indonesia' : 'English';
}

function projectLoadErrorMessage(caught: unknown, t: Translate): string {
  const message = caught instanceof Error ? caught.message.trim() : '';
  // Resolved here rather than at module scope: a constant evaluated at import
  // is fixed to whichever locale happened to load first, which is how a
  // translated string quietly stops following the reader.
  if (message === t('wrongProject')) return message;
  return t('verifyFailed');
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
  const t = useTranslations('workspace');
  const dateLocale = HTML_LANG[interfaceLocaleFrom(useLocale())];
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
      criteria: (savedCriteria ?? starterCriteriaFor(readLocalProjectLanguage(localStorage))).map((criterion) => ({
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
        setSelectionNotice(t('projectUnavailable'));
        setChosenProjectId(null);
        writeProjectToUrl(null, 'replace');
      }
      return;
    }
    if (chosenProjectId && projects.some((summary) => summary.project.id === chosenProjectId)) return;

    const fallbackProject = projects[0]!.project;
    if (chosenProjectId) {
      setSelectionNotice(t('projectUnavailableFallback', { project: fallbackProject.title }));
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
          throw new Error(t('wrongProject'));
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
          error: projectLoadErrorMessage(caught, t),
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
    ?? t('localWorkspace');
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
      ? t('continueWithSavedAttempts', { count: savedSessionCount })
      : t('startWithAttempt')
    : latestIsComplete
      ? t('completeCoverage')
      : t('pickUpLatestFocus', { focus: latestSession.weakest });
  const focusDescription = !latestSession
    ? savedSessionCount > 0
      ? t('openProgressHint')
      : t('saveOneAttempt')
    : latestIsComplete
      ? t('oneTranscriptBoundary')
      : t('latestTranscriptCoverage', { coverage: coverageLabel(latestSession.evidenceScore) });

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
    ? { art: katoQuestioning, state: 'waiting', bubble: t('readyForHard') }
    : latestIsComplete
      ? { art: katoReading, state: 'supported', bubble: t('everySupported') }
      : { art: katoAlert, state: 'gap', bubble: t('oneGapStillOpen', { focus: latestSession.weakest }) };
  const selectionResolving = activeProject === null
    && (chosenProjectId !== null || projects.length > 0);

  if (!selectionHydrated || projectsLoading || selectionResolving) {
    return (
      <section className="view is-visible" aria-labelledby="homeTitle">
        <header className="page-header">
          <div><p className="overline">{t('yourWorkspace')}</p><h1 id="homeTitle">{t('makeHarder')}</h1></div>
        </header>
        <section className="surface" role="status" aria-live="polite" aria-busy="true">
          <p className="empty-list">{t('checkingProject')}</p>
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
        <div><p className="overline">{t('yourWorkspace')}</p><h1 id="homeTitle">{t('makeHarder')}</h1></div>
      </header>

      {projects.length > 1 && <div className="project-switcher">
        <label htmlFor="workspaceProject">{t('project')}</label>
        <select id="workspaceProject" value={activeProjectId ?? ''} onChange={(event) => chooseProject(event.target.value)}>
          {projects.map((summary) => <option key={summary.project.id} value={summary.project.id}>{summary.project.title}</option>)}
        </select>
        <span className="project-switcher-meta">{t('staysTogether')}</span>
      </div>}

      {selectionNotice && <p className="empty-list" role="status">{selectionNotice}</p>}

      <section className="focus-card" aria-labelledby="focusTitle">
        <div className="focus-main">
          <div className="project-kicker"><span className="project-avatar">{projectInitials(activeProjectTitle)}</span><span><small>{t('currentProjectLanguage', { language: projectLanguageLabel(activeProjectLanguage) })}</small><strong>{activeProjectTitle}</strong></span></div>
          <h2 id="focusTitle">{focusTitle}</h2>
          <p>{focusDescription}</p>
          <div className="focus-actions">
            <Link className="button button-light" href={practiceHref}>{t('continuePractising')}</Link>
            <Link className="button button-ghost-light" href={rubricHref}>{t('reviewRubric')}</Link>
          </div>
        </div>
        <aside className="focus-coach" aria-label={t('guide')}>
          <img className="focus-mascot" data-coach={coach.state} src={coach.art.src} alt="" width={coach.art.width} height={coach.art.height} />
          <p className="coach-bubble">{coach.bubble}</p>
        </aside>
        <div className="focus-stats">
          <div className="focus-stat"><span>{t('lastCoverage')}</span><strong>{latestCoverage === null ? '—' : coverageLabel(latestCoverage)}</strong><small>{latestSession ? t('savedOnDate', { date: sessionDate(latestSession.createdAt, dateLocale).label }) : t('noReviewedAttempt')}</small></div>
          <div className="focus-stat"><span>{t('latestFocus')}</span><strong className="stat-word">{latestSession ? latestIsComplete ? t('noSavedGap') : latestSession.weakest : '—'}</strong><small>{latestSession ? t('recordedInLatest') : t('appearsAfterReview')}</small></div>
          <div className="focus-stat"><span>{t('savedSessions')}</span><strong>{savedSessionCount}</strong><small>{activeProject ? t('syncedPlusBrowser') : t('validRetained')}</small></div>
        </div>
      </section>

      {(recurringGap || trajectory) && <section className="insight-band" aria-labelledby="insightTitle">
        <div className="section-title-row">
          <div><p className="overline">{t('readFromSaved')}</p><h2 id="insightTitle">{t('whatNext')}</h2></div>
          <Link className="text-button" href={progressHref}>{t('openProgress')}</Link>
        </div>
        <div className="insight-grid">
          {recurringGap && <article className="insight-card is-gap">
            <p className="overline">{t('recurringGap')}</p>
            <strong className="insight-headline">{recurringGap.criterionName}</strong>
            <p className="insight-detail">
              {t('unsupportedAttemptCount', { gaps: recurringGap.gapCount, attempts: recurringGap.attemptCount })}
            </p>
            {recurringGap.latestMissingEvidence.length > 0 && <p className="insight-cues">
              <span>{t('stillMissing')}</span>
              {recurringGap.latestMissingEvidence.slice(0, 3).map((cue) => <span className="signal-chip" key={cue}>{cue}</span>)}
            </p>}
            <Link className="button button-secondary" href={practiceHref}>{t('rehearseCriterion')}</Link>
          </article>}

          {trajectory && <article className="insight-card">
            <p className="overline">{t('coverageAcross')}</p>
            <strong className="insight-headline">
              {coverageLabel(trajectory.first)} <span aria-hidden="true">→</span> {coverageLabel(trajectory.last)}
            </strong>
            {/* The bars carry the shape; the sentence under them carries the
                claim. A chart nobody can read aloud is not evidence. */}
            <svg
              className="insight-spark"
              viewBox={`0 0 ${trajectory.points.length * 12} 32`}
              role="img"
              aria-label={t('coverageTrajectoryLabel', { count: trajectory.points.length, points: trajectory.points.map((point) => coverageLabel(point)).join(', ') })}
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
                ? t('trajectoryChange', {
                  change: trajectory.delta === 0 ? t('level') : trajectory.delta > 0 ? t('upPoints', { points: trajectory.delta }) : t('downPoints', { points: Math.abs(trajectory.delta) }),
                  count: trajectory.points.length,
                })
                : t('pairNotTrend')}
            </p>
            <p className="insight-boundary">{t('coverageBoundary')}</p>
          </article>}
        </div>
      </section>}

      <div className="dashboard-grid">
        <section className="surface next-session" aria-labelledby="nextSessionTitle">
          <div className="section-title-row"><div><p className="overline">{t('recommended')}</p><h2 id="nextSessionTitle">{t('nextDrill')}</h2></div><span className="time-pill">{t('threeSteps')}</span></div>
          <ol className="session-plan">
            <li><span>1</span><div><strong>{t('deliverPitch')}</strong><small>{t('pasteAttempt')}</small></div></li>
            <li><span>2</span><div><strong>{t('inspectClaim')}</strong><small>{t('traceToRubric')}</small></div></li>
            <li><span>3</span><div><strong>{t('defendPressure')}</strong><small>{t('answerFollowUp')}</small></div></li>
          </ol>
        </section>
        <section
          className="surface rubric-health"
          aria-labelledby="rubricHealthTitle"
          aria-busy={activeProjectId ? projectDetailStatus === 'loading' : false}
        >
          <div className="section-title-row">
            <div><p className="overline">{t('preparation')}</p><h2 id="rubricHealthTitle">{t('activeRubric')}</h2></div>
            <span className="health-ring" aria-label={projectDetailStatus === 'loading' ? t('loadingCriteria') : t('activeCriteriaCount', { count: rubricCount })}>
              {projectDetailStatus === 'loading' ? '…' : rubricCount}
            </span>
          </div>
          {activeProjectId && projectDetailStatus === 'loading' && (
            <p role="status" aria-live="polite">{t('loadingConfirmedRubric', { project: activeProjectTitle })}</p>
          )}
          {activeProjectId && projectDetailStatus === 'error' && selectedProject.status === 'error' && (
            <div role="alert">
              <p>{t('rubricCouldNotLoad', { project: activeProjectTitle })} {selectedProject.error}</p>
              <button className="button button-secondary" type="button" onClick={() => setProjectRequestVersion((version) => version + 1)}>{t('tryAgain')}</button>
            </div>
          )}
          {activeProjectId && projectDetailStatus === 'ready' && syncedRubricConfirmed && (
            <p>{t('confirmedCriteriaBelong', { count: rubricCount, project: activeProjectTitle })}</p>
          )}
          {activeProjectId && projectDetailStatus === 'ready' && !syncedRubricConfirmed && (
            <p>{t('noConfirmedRubric', { project: activeProjectTitle })}</p>
          )}
          {!activeProjectId && (
            <p>{dashboard.hasSavedRubric
              ? t('confirmedCriteriaInBrowser', { count: dashboard.criteria.length })
              : t('starterCriteriaActive', { count: dashboard.criteria.length })}</p>
          )}
          {rubricCount > 0 && <div className="mini-criteria">{activeCriteria.map((criterion) => <div className="mini-criterion" key={criterion.id}><i /><span>{criterion.name}</span></div>)}</div>}
          <Link className="text-button" href={rubricHref}>{syncedRubricConfirmed || !activeProjectId ? t('editCriteria') : t('setupCriteria')} <span aria-hidden="true">→</span></Link>
        </section>
      </div>
      <section className="surface recent-section" aria-labelledby="recentTitle">
        <div className="section-title-row"><div><p className="overline">{t('practiceLog')}</p><h2 id="recentTitle">{t('recentSessions')}</h2></div><Link className="text-button" href={progressHref}>{t('viewAll')}</Link></div>
        {projectSessions.length === 0
          ? <p className="empty-list">{t('noRehearsals')}</p>
          : <div className="session-list">{projectSessions.slice(0, 3).map((session) => {
            const date = sessionDate(session.createdAt, dateLocale);
            return <article className="session-row" key={session.id}>
              <span className="session-date" aria-label={date.label}>{date.day}<br />{date.month}</span>
              <span><strong>{activeProjectTitle}</strong><small>{t('savedFocus', { focus: session.weakest })}</small></span>
              <span className="session-score"><span className="score-track"><i style={{ width: coverageLabel(session.evidenceScore) }} /></span>{coverageLabel(session.evidenceScore)}</span>
              <span className="session-status">{session.defenseStatus ? t(`defenseStatus.${session.defenseStatus}`) : t('reviewOnly')}</span>
              <span aria-hidden="true">→</span>
            </article>;
          })}</div>}
      </section>
    </section>
  );
}
