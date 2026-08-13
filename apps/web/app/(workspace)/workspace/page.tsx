'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import katoAlert from '../../../../../src/assets/mascot/kato-macaw-alert.svg';
import katoQuestioning from '../../../../../src/assets/mascot/kato-macaw-questioning.svg';
import katoReading from '../../../../../src/assets/mascot/kato-macaw-reading.svg';
import { DEFAULT_RUBRIC, parseRubric } from '@/lib/analyzer';
import type { SavedSession } from '@/lib/contracts';
import { parseSavedSessions, PRODUCTION_SESSIONS_KEY, summarizeRecurringWeaknesses } from '@/lib/progress';
import { readStoredRubricCriteria } from '@/lib/rubric-storage';

interface DashboardCriterion {
  id: string;
  name: string;
}

interface DashboardState {
  criteria: DashboardCriterion[];
  hasSavedRubric: boolean;
  sessions: SavedSession[];
}

const starterCriteria = parseRubric(DEFAULT_RUBRIC).map((criterion) => ({
  id: criterion.id,
  name: criterion.label,
}));

const initialDashboard: DashboardState = {
  criteria: starterCriteria,
  hasSavedRubric: false,
  sessions: [],
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

  useEffect(() => {
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

  const latestSession = dashboard.sessions[0] ?? null;
  const latestCoverage = latestSession?.evidenceScore ?? null;
  const latestIsComplete = latestCoverage === 100;
  const focusTitle = !latestSession
    ? 'Start with one complete attempt against your active rubric.'
    : latestIsComplete
      ? 'Your latest saved attempt recorded complete rubric evidence coverage.'
      : `Pick up from your latest saved focus: ${latestSession.weakest}.`;
  const focusDescription = !latestSession
    ? 'Save one reviewed attempt to make this dashboard follow your real rubric evidence.'
    : latestIsComplete
      ? 'That result describes one saved transcript, not confidence or speaking ability. Rehearse again to see whether the evidence holds.'
      : `The latest saved transcript recorded ${coverageLabel(latestSession.evidenceScore)} explicit rubric coverage. Open Progress to inspect its retained quote or missing cues before rehearsing again.`;

  // Both come from attempts already saved in this browser. Neither invents a
  // reading: a gap is only called recurring once it has survived more than one
  // attempt, and a run is only described once there are three of them.
  const trajectory = coverageTrajectory(dashboard.sessions);
  const recurringGap = summarizeRecurringWeaknesses(dashboard.sessions)
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

  return (
    <section className="view is-visible" aria-labelledby="homeTitle">
      <header className="page-header">
        <div><p className="overline">Your workspace</p><h1 id="homeTitle">Make your next answer harder to challenge.</h1></div>
      </header>

      <section className="focus-card" aria-labelledby="focusTitle">
        <div className="focus-main">
          <div className="project-kicker"><span className="project-avatar">TA</span><span><small>Current project</small><strong>Talk-Active · RISTEK Finals</strong></span></div>
          <h2 id="focusTitle">{focusTitle}</h2>
          <p>{focusDescription}</p>
          <div className="focus-actions">
            <Link className="button button-light" href="/practice">Continue practising</Link>
            <Link className="button button-ghost-light" href="/rubric">Review rubric</Link>
          </div>
        </div>
        <aside className="focus-coach" aria-label="Talk-Active rehearsal guide">
          <img className="focus-mascot" data-coach={coach.state} src={coach.art.src} alt="" width={coach.art.width} height={coach.art.height} />
          <p className="coach-bubble">{coach.bubble}</p>
        </aside>
        <div className="focus-stats">
          <div className="focus-stat"><span>Last evidence coverage</span><strong>{latestCoverage === null ? '—' : coverageLabel(latestCoverage)}</strong><small>{latestSession ? `Saved ${sessionDate(latestSession.createdAt).label}` : 'No reviewed attempt saved yet'}</small></div>
          <div className="focus-stat"><span>Latest focus</span><strong className="stat-word">{latestSession ? latestIsComplete ? 'No saved gap' : latestSession.weakest : '—'}</strong><small>{latestSession ? 'Recorded in the latest saved attempt' : 'Appears after the first review'}</small></div>
          <div className="focus-stat"><span>Saved sessions</span><strong>{dashboard.sessions.length}</strong><small>Valid attempts retained in this browser</small></div>
        </div>
      </section>

      {(recurringGap || trajectory) && <section className="insight-band" aria-labelledby="insightTitle">
        <div className="section-title-row">
          <div><p className="overline">Read from your saved attempts</p><h2 id="insightTitle">What to rehearse next</h2></div>
          <Link className="text-button" href="/progress">Open Progress</Link>
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
            <Link className="button button-secondary" href="/practice">Rehearse this criterion</Link>
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
        <section className="surface rubric-health" aria-labelledby="rubricHealthTitle">
          <div className="section-title-row"><div><p className="overline">Preparation</p><h2 id="rubricHealthTitle">Active rubric</h2></div><span className="health-ring" aria-label={`${dashboard.criteria.length} active criteria`}>{dashboard.criteria.length}</span></div>
          <p>{dashboard.hasSavedRubric
            ? `${dashboard.criteria.length} confirmed criteria are saved in this browser.`
            : `${dashboard.criteria.length} starter criteria are active until you save your evaluator rubric.`}</p>
          <div className="mini-criteria">{dashboard.criteria.map((criterion) => <div className="mini-criterion" key={criterion.id}><i /><span>{criterion.name}</span></div>)}</div>
          <Link className="text-button" href="/rubric">Edit evaluation criteria <span aria-hidden="true">→</span></Link>
        </section>
      </div>
      <section className="surface recent-section" aria-labelledby="recentTitle">
        <div className="section-title-row"><div><p className="overline">Practice log</p><h2 id="recentTitle">Recent sessions</h2></div><Link className="text-button" href="/progress">View all</Link></div>
        {dashboard.sessions.length === 0
          ? <p className="empty-list">No rehearsals saved yet. Complete one practice attempt and its traceable evidence will appear here.</p>
          : <div className="session-list">{dashboard.sessions.slice(0, 3).map((session) => {
            const date = sessionDate(session.createdAt);
            return <article className="session-row" key={session.id}>
              <span className="session-date" aria-label={date.label}>{date.day}<br />{date.month}</span>
              <span><strong>Talk-Active · RISTEK Finals</strong><small>Saved focus: {session.weakest}</small></span>
              <span className="session-score"><span className="score-track"><i style={{ width: coverageLabel(session.evidenceScore) }} /></span>{coverageLabel(session.evidenceScore)}</span>
              <span className="session-status">{session.defenseStatus ?? 'review only'}</span>
              <span aria-hidden="true">→</span>
            </article>;
          })}</div>}
      </section>
    </section>
  );
}
