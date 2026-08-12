import {
  AnalysisError,
  DEFAULT_RUBRIC,
  MAX_CRITERIA,
  STARTER_DRAFT,
  analyzeSpeech,
  evaluateDefense,
  parseRubric,
} from './analyzer.mjs';
import { analysisStages } from './analysis-progress.mjs';

const STORAGE_KEY = 'talkactive.workspace.v1';
// Kept out of the workspace blob: it is a property of this device's microphone
// habits, not of the project, and it should survive a workspace reset.
const DICTATION_LANGUAGE_KEY = 'talkactive.dictation.language';

const initialWorkspace = {
  version: 1,
  // A display name, not an identity. null means "never asked", '' means
  // "asked, chose guest", and a string is a name. The distinction is what lets
  // the booth handover prompt appear exactly once per visitor.
  rehearser: null,
  activeProjectId: 'project-talk-active',
  projects: [
    {
      id: 'project-talk-active',
      name: 'Talk-Active — RISTEK Hackathon',
      event: '7-minute final pitch · 3-minute Q&A',
      deadline: '2026-08-16',
      rubric: DEFAULT_RUBRIC,
      draft: STARTER_DRAFT,
      draftDuration: 90,
      createdAt: '2026-08-03T10:00:00.000Z',
    },
  ],
  sessions: [
    {
      id: 'session-1',
      projectId: 'project-talk-active',
      createdAt: '2026-08-04T14:30:00.000Z',
      evidenceScore: 34,
      weakest: 'Differentiation',
      defenseStatus: 'vulnerable',
      title: 'First full run-through',
    },
    {
      id: 'session-2',
      projectId: 'project-talk-active',
      createdAt: '2026-08-06T12:15:00.000Z',
      evidenceScore: 52,
      weakest: 'Differentiation',
      defenseStatus: 'developing',
      title: 'Revised problem and solution',
    },
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const LEGACY_STORAGE_KEY = 'lancar.workspace.v1';

// The product was renamed after this key shipped. Anyone who practised under
// the old name keeps their sessions instead of losing them to a rebrand.
function migrateLegacyWorkspace() {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return;
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private mode; the seed workspace covers it.
  }
}

function loadWorkspace() {
  migrateLegacyWorkspace();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.version === 1 && Array.isArray(stored.projects) && stored.projects.length > 0) {
      return stored;
    }
  } catch {
    // A malformed local snapshot should not prevent the workspace from opening.
  }
  return clone(initialWorkspace);
}

const state = {
  workspace: loadWorkspace(),
  route: 'home',
  practiceStage: 'setup',
  practiceProjectId: null,
  analysis: null,
  analysisRequestId: 0,
  analysisStartedAt: 0,
  analysisCriteriaCount: 0,
  analysisTicker: null,
  analysisSpoken: '',
  defense: null,
  recognition: null,
  recordingStartedAt: null,
  recordingBaseText: '',
  finalDictation: '',
  toastTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  views: $$('[data-view]'),
  routeButtons: $$('[data-route]'),
  startPracticeButtons: $$('[data-start-practice]'),
  sidebarProjectList: $('#sidebarProjectList'),
  currentProjectInitials: $('#currentProjectInitials'),
  currentProjectName: $('#currentProjectName'),
  focusTitle: $('#focusTitle'),
  focusCopy: $('#focusCopy'),
  coachPrompt: $('#coachPrompt'),
  lastCoverage: $('#lastCoverage'),
  coverageTrend: $('#coverageTrend'),
  lastWeakest: $('#lastWeakest'),
  eventCountdown: $('#eventCountdown'),
  eventDate: $('#eventDate'),
  rubricCount: $('#rubricCount'),
  homeCriteria: $('#homeCriteria'),
  recentSessions: $('#recentSessions'),
  todayLabel: $('#todayLabel'),
  practiceProject: $('#practiceProject'),
  setupProjectInitials: $('#setupProjectInitials'),
  setupProjectName: $('#setupProjectName'),
  setupProjectEvent: $('#setupProjectEvent'),
  setupRubricCount: $('#setupRubricCount'),
  setupCriteria: $('#setupCriteria'),
  practiceStages: $$('[data-practice-stage]'),
  practiceIndicators: $$('[data-step-indicator]'),
  beginAttempt: $('#beginAttempt'),
  attemptProjectName: $('#attemptProjectName'),
  attemptTranscript: $('#attemptTranscript'),
  attemptDuration: $('#attemptDuration'),
  attemptTimer: $('#attemptTimer'),
  attemptError: $('#attemptError'),
  draftStatus: $('#draftStatus'),
  dictateButton: $('#dictateButton'),
  dictateLabel: $('#dictateLabel'),
  dictateLanguage: $('#dictateLanguage'),
  analyzeAttempt: $('#analyzeAttempt'),
  analyzeSpinner: $('#analyzeSpinner'),
  analyzeLabel: $('#analyzeLabel'),
  analyzeArrow: $('#analyzeArrow'),
  exitPractice: $('#exitPractice'),
  reviewScore: $('#reviewScore'),
  reviewMode: $('#reviewMode'),
  reviewWeakest: $('#reviewWeakest'),
  reviewDrill: $('#reviewDrill'),
  reviewMissingSignals: $('#reviewMissingSignals'),
  reviewQuestion: $('#reviewQuestion'),
  reviewPace: $('#reviewPace'),
  reviewFillers: $('#reviewFillers'),
  deliveryPace: $('#deliveryPace'),
  deliveryPaceLabel: $('#deliveryPaceLabel'),
  deliveryWords: $('#deliveryWords'),
  deliveryFillerTotal: $('#deliveryFillerTotal'),
  deliveryFillers: $('#deliveryFillers'),
  reviewCriteria: $('#reviewCriteria'),
  coverageGauge: $('.coverage-gauge'),
  openDefense: $('#openDefense'),
  reviseAttempt: $('#reviseAttempt'),
  saveWithoutDefense: $('#saveWithoutDefense'),
  defenseCriterion: $('#defenseCriterion'),
  defenseQuestion: $('#defenseQuestion'),
  defenseAnswer: $('#defenseAnswer'),
  defenseError: $('#defenseError'),
  evaluateDefense: $('#evaluateDefense'),
  defenseEmpty: $('#defenseEmpty'),
  defenseResult: $('#defenseResult'),
  defenseStatus: $('#defenseStatus'),
  defenseScore: $('#defenseScore'),
  defenseCopy: $('#defenseCopy'),
  matchedSignals: $('#matchedSignals'),
  missingSignals: $('#missingSignals'),
  defenseFollowUp: $('#defenseFollowUp'),
  saveSession: $('#saveSession'),
  backToReview: $('#backToReview'),
  rubricProject: $('#rubricProject'),
  rubricProjectName: $('#rubricProjectName'),
  rubricImportInput: $('#rubricImportInput'),
  rubricImportButton: $('#rubricImportButton'),
  rubricImportStatus: $('#rubricImportStatus'),
  rubricEditor: $('#rubricEditor'),
  addCriterion: $('#addCriterion'),
  saveRubric: $('#saveRubric'),
  totalSessions: $('#totalSessions'),
  latestCoverage: $('#latestCoverage'),
  latestCoverageDelta: $('#latestCoverageDelta'),
  recurringGap: $('#recurringGap'),
  progressProject: $('#progressProject'),
  progressChart: $('#progressChart'),
  allSessions: $('#allSessions'),
  projectDialog: $('#projectDialog'),
  projectForm: $('#projectForm'),
  projectName: $('#projectName'),
  projectEvent: $('#projectEvent'),
  projectDeadline: $('#projectDeadline'),
  projectError: $('#projectError'),
  closeProjectDialog: $('#closeProjectDialog'),
  cancelProject: $('#cancelProject'),
  sidebarAddProject: $('#sidebarAddProject'),
  mobileAddProject: $('#mobileAddProject'),
  resetButtons: $$('[data-reset-workspace]'),
  resetDialog: $('#resetDialog'),
  closeResetDialog: $('#closeResetDialog'),
  cancelReset: $('#cancelReset'),
  confirmReset: $('#confirmReset'),
  analysisProgress: $('#analysisProgress'),
  analysisAnnounce: $('#analysisAnnounce'),
  rehearserChip: $('#rehearserChip'),
  rehearserInitials: $('#rehearserInitials'),
  rehearserName: $('#rehearserName'),
  rehearserHint: $('#rehearserHint'),
  rehearserDialog: $('#rehearserDialog'),
  rehearserInput: $('#rehearserInput'),
  closeRehearserDialog: $('#closeRehearserDialog'),
  continueAsGuest: $('#continueAsGuest'),
  saveRehearser: $('#saveRehearser'),
  toast: $('#toast'),
  toastCopy: $('#toastCopy'),
};

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.workspace));
}

function idFor(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function activeProject() {
  return state.workspace.projects.find((project) => project.id === state.workspace.activeProjectId)
    ?? state.workspace.projects[0];
}

function practiceProject() {
  return state.workspace.projects.find((project) => project.id === state.practiceProjectId)
    ?? activeProject();
}

function initials(value) {
  return String(value)
    .split(/\s+/u)
    .filter((part) => /[\p{L}\p{N}]/u.test(part))
    .slice(0, 2)
    .map((part) => part[0].toLocaleUpperCase('id-ID'))
    .join('') || 'LP';
}

function formatDate(value, options = { day: 'numeric', month: 'short' }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return new Intl.DateTimeFormat('en-ID', options).format(date);
}

function daysUntil(value) {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target - today) / 86_400_000);
}

function sessionsFor(projectId) {
  return state.workspace.sessions
    .filter((session) => session.projectId === projectId)
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function rubricFor(project) {
  try {
    return parseRubric(project.rubric);
  } catch {
    return [];
  }
}

function optionFor(project) {
  const option = document.createElement('option');
  option.value = project.id;
  option.textContent = project.name;
  return option;
}

function showToast(copy) {
  window.clearTimeout(state.toastTimer);
  elements.toastCopy.textContent = copy;
  elements.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2400);
}

function renderProjectSelectors() {
  for (const select of [elements.practiceProject, elements.rubricProject, elements.progressProject]) {
    const previous = select.value;
    select.replaceChildren(...state.workspace.projects.map(optionFor));
    const desired = state.workspace.projects.some((project) => project.id === previous)
      ? previous
      : state.workspace.activeProjectId;
    select.value = desired;
  }
}

function renderSidebar() {
  elements.sidebarProjectList.replaceChildren(...state.workspace.projects.map((project) => {
    const button = document.createElement('button');
    button.className = 'sidebar-project';
    button.classList.toggle('is-active', project.id === state.workspace.activeProjectId);
    button.type = 'button';
    button.dataset.projectId = project.id;
    const dot = document.createElement('i');
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = project.name;
    button.append(dot, label);
    button.addEventListener('click', () => {
      state.workspace.activeProjectId = project.id;
      state.practiceProjectId = project.id;
      persist();
      renderAll();
      setRoute('home');
    });
    return button;
  }));
}

function miniCriterion(criterion) {
  const row = document.createElement('div');
  row.className = 'mini-criterion';
  const dot = document.createElement('i');
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = criterion.label;
  row.append(dot, label);
  return row;
}

function sessionRow(session) {
  const row = document.createElement('article');
  row.className = 'session-row';

  const date = document.createElement('span');
  date.className = 'session-date';
  date.textContent = formatDate(session.createdAt);

  const description = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = session.title || 'Practice attempt';
  const meta = document.createElement('small');
  meta.textContent = `Focus: ${session.weakest}`;
  description.append(title, meta);

  const score = document.createElement('div');
  score.className = 'session-score';
  const scoreCopy = document.createElement('span');
  scoreCopy.textContent = `${session.evidenceScore}%`;
  const track = document.createElement('span');
  track.className = 'score-track';
  const fill = document.createElement('i');
  fill.style.width = `${Math.max(2, session.evidenceScore)}%`;
  track.append(fill);
  score.append(scoreCopy, track);

  const status = document.createElement('span');
  status.className = `session-status ${session.defenseStatus === 'defensible' ? 'defensible' : ''}`;
  status.textContent = session.defenseStatus === 'not practiced' ? 'No Q&A' : session.defenseStatus;

  const chevron = document.createElement('span');
  chevron.textContent = '›';
  chevron.setAttribute('aria-hidden', 'true');
  row.append(date, description, score, status, chevron);
  return row;
}

function renderSessionList(container, sessions, limit = sessions.length) {
  if (sessions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-list';
    empty.textContent = 'No sessions saved yet. Your first attempt will appear here.';
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...sessions.slice(0, limit).map(sessionRow));
}

function renderDashboard() {
  const project = activeProject();
  const rubric = rubricFor(project);
  const sessions = sessionsFor(project.id);
  const latest = sessions[0];
  const previous = sessions[1];
  const dayCount = daysUntil(project.deadline);

  elements.todayLabel.textContent = new Intl.DateTimeFormat('en-ID', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());
  elements.currentProjectInitials.textContent = initials(project.name);
  elements.currentProjectName.textContent = project.name;
  elements.lastCoverage.textContent = latest ? `${latest.evidenceScore}%` : '—';
  elements.lastWeakest.textContent = latest?.weakest ?? 'No attempt yet';

  if (latest && previous) {
    const delta = latest.evidenceScore - previous.evidenceScore;
    elements.coverageTrend.textContent = `${delta >= 0 ? '+' : ''}${delta} points from previous attempt`;
  } else {
    elements.coverageTrend.textContent = latest ? 'First baseline saved' : 'No attempt saved yet';
  }

  if (latest) {
    elements.focusTitle.textContent = `${latest.weakest} is still the claim most likely to be challenged.`;
    elements.focusCopy.textContent = 'Continue from your saved draft and practice the question grounded in that exact rubric gap.';
    elements.coachPrompt.textContent = `Let's rehearse ${latest.weakest} next.`;
  } else {
    elements.focusTitle.textContent = 'Build your first evidence baseline.';
    elements.focusCopy.textContent = 'Complete one attempt to find the claim most worth rehearsing next.';
    elements.coachPrompt.textContent = 'Start with one complete attempt. I’ll point to the claim worth rehearsing.';
  }

  if (dayCount === null) {
    elements.eventCountdown.textContent = 'Not set';
    elements.eventDate.textContent = 'Add a deadline';
  } else if (dayCount < 0) {
    elements.eventCountdown.textContent = 'Completed';
    elements.eventDate.textContent = formatDate(project.deadline, { day: 'numeric', month: 'long', year: 'numeric' });
  } else {
    elements.eventCountdown.textContent = dayCount === 0 ? 'Today' : `${dayCount} days`;
    elements.eventDate.textContent = formatDate(project.deadline, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  elements.rubricCount.textContent = String(rubric.length);
  elements.homeCriteria.replaceChildren(...rubric.slice(0, 5).map(miniCriterion));
  renderSessionList(elements.recentSessions, sessions, 3);
}

function renderSetup() {
  const project = practiceProject();
  const rubric = rubricFor(project);
  elements.practiceProject.value = project.id;
  elements.setupProjectInitials.textContent = initials(project.name);
  elements.setupProjectName.textContent = project.name;
  elements.setupProjectEvent.textContent = project.event;
  elements.setupRubricCount.textContent = String(rubric.length);
  elements.setupCriteria.replaceChildren(...rubric.map((criterion, index) => {
    const row = document.createElement('div');
    row.className = 'setup-criterion';
    const number = document.createElement('span');
    number.textContent = String(index + 1);
    const label = document.createElement('strong');
    label.textContent = criterion.label;
    row.append(number, label);
    return row;
  }));
}

const stages = ['setup', 'attempt', 'review', 'defend'];

function showPracticeStage(stage) {
  state.practiceStage = stage;
  const index = stages.indexOf(stage);
  elements.practiceStages.forEach((panel) => panel.classList.toggle('is-visible', panel.dataset.practiceStage === stage));
  elements.practiceIndicators.forEach((indicator, indicatorIndex) => {
    indicator.classList.toggle('is-active', indicatorIndex === index);
    indicator.classList.toggle('is-complete', indicatorIndex < index);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function timerCopy(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function beginAttempt() {
  const project = practiceProject();
  state.analysis = null;
  state.defense = null;
  elements.attemptProjectName.textContent = project.name;
  elements.attemptTranscript.value = project.draft || '';
  elements.attemptDuration.value = String(project.draftDuration || 90);
  elements.attemptTimer.textContent = timerCopy(Number(elements.attemptDuration.value));
  elements.attemptError.hidden = true;
  showPracticeStage('attempt');
  elements.attemptTranscript.focus();
}

function signalChip(signal, variant = '') {
  const chip = document.createElement('span');
  chip.className = `signal-chip ${variant}`.trim();
  chip.textContent = signal;
  return chip;
}

// Delivery is real coaching, but it is deliberately the second thing on this
// screen. Writing the filler words out is what makes it actionable — "7
// fillers" tells a student nothing they can practise, "kayak ×4" does.
function renderDelivery(delivery) {
  elements.deliveryPace.textContent = String(delivery.wordsPerMinute);
  elements.deliveryPaceLabel.textContent = `words per minute · ${delivery.pace}`;
  elements.deliveryWords.textContent = String(delivery.wordCount);
  elements.deliveryFillerTotal.textContent = String(delivery.fillerCount);

  if (delivery.fillers.length === 0) {
    const clear = document.createElement('p');
    clear.className = 'filler-empty';
    clear.textContent = 'No filler patterns matched in this attempt.';
    elements.deliveryFillers.replaceChildren(clear);
    return;
  }

  elements.deliveryFillers.replaceChildren(...[...delivery.fillers]
    .sort((left, right) => right.count - left.count)
    .map((filler) => {
      const chip = document.createElement('span');
      chip.className = 'filler-chip';
      const word = document.createElement('strong');
      word.textContent = filler.label;
      const count = document.createElement('span');
      count.textContent = `×${filler.count}`;
      chip.append(word, count);
      return chip;
    }));
}

function renderReview(result) {
  elements.reviewScore.textContent = `${result.evidenceScore}%`;
  elements.coverageGauge.style.setProperty('--gauge', `${result.evidenceScore * 3.6}deg`);
  elements.reviewWeakest.textContent = result.weakest.label;
  elements.reviewDrill.textContent = result.drill;
  elements.reviewMissingSignals.replaceChildren(
    ...(result.weakest.missingSignals.length
      ? result.weakest.missingSignals.slice(0, 5).map((signal) => signalChip(signal))
      : [signalChip('No declared cues missing', 'neutral')]),
  );
  elements.reviewQuestion.textContent = result.judgeQuestion;
  elements.reviewPace.textContent = `${result.delivery.wordsPerMinute} WPM · ${result.delivery.pace}`;
  elements.reviewFillers.textContent = `${result.delivery.fillerCount} potential fillers`;
  renderDelivery(result.delivery);
  elements.reviewCriteria.replaceChildren(...result.criteria.map(evidenceCard));
}

// INV-3: no criterion verdict reaches a user without either the transcript span
// that supports it, or the explicit list of cues that are missing.
//
// The quote is a <blockquote> and the largest thing on the card because it is
// the reason the card exists. It previously rendered as a 9px <p> underneath a
// percentage and a progress bar — the evidence was literally the smallest text
// on the screen, which turned "rubric-grounded" into a slogan.
//
// The per-criterion percentage is gone on purpose. A number out of 100 implies
// a measurement of how good the speaker is, which is not something cue matching
// can produce and not something we may imply (INV-2). "evidence found" is a
// checkable fact about the transcript instead. Absence is stated neutrally,
// because a criterion with nothing behind it yet is the next thing to
// rehearse, not a mark against the speaker.
function evidenceCard(criterion) {
  const found = Boolean(criterion.excerpt);
  const card = document.createElement('article');
  card.className = 'evidence-item';
  card.dataset.evidence = found ? 'found' : 'absent';

  const topline = document.createElement('div');
  topline.className = 'evidence-topline';
  const label = document.createElement('strong');
  label.textContent = criterion.label;
  const state = document.createElement('span');
  state.className = 'evidence-state';
  state.textContent = found ? 'evidence found' : 'no cue matched';
  topline.append(label, state);
  card.append(topline);

  if (found) {
    // textContent, never innerHTML: the transcript is user input (INV-5).
    const quote = document.createElement('blockquote');
    quote.className = 'evidence-quote';
    quote.textContent = criterion.excerpt;
    const source = document.createElement('p');
    source.className = 'evidence-source';
    source.textContent = 'your words, from this attempt';
    card.append(quote, source);
  } else {
    const absent = document.createElement('p');
    absent.className = 'evidence-absent';
    const cues = criterion.missingSignals.slice(0, 4).join(', ');
    absent.textContent = 'Nothing in this attempt matched the cues for this criterion.';
    if (cues) {
      const looked = document.createElement('span');
      looked.textContent = ` Looked for: ${cues}.`;
      absent.append(looked);
    }
    card.append(absent);
  }

  // INV-4: the overall mode badge cannot speak for a criterion that fell back.
  // textContent, never innerHTML: this sits beside user input (INV-5).
  if (criterion.engine === 'deterministic') {
    const provenance = document.createElement('p');
    provenance.className = 'evidence-provenance';
    provenance.textContent = 'Matched by cue matching, not semantic analysis.';
    card.append(provenance);
  }

  return card;
}

// Two sentences the user is entitled to, and the only two we can prove.
const MODE_LABEL = {
  semantic: 'Evidence mapped by a language model, then checked against your transcript.',
  deterministic: 'Evidence mapped by cue matching on this device.',
};

// The local server and Vercel expose the same API paths. Only a directly opened
// file has no server to answer, so every HTTP origin may attempt the semantic
// upgrade and fall back cleanly when credentials or connectivity are absent.
function apiIsReachable() {
  return window.location.protocol !== 'file:';
}

// A response we cannot trust is a response we do not use. Anything short of the
// full analyzer shape falls back rather than rendering a half-built review.
function looksLikeAnalysis(value) {
  return Boolean(value)
    && Array.isArray(value.criteria)
    && value.criteria.length > 0
    && value.criteria.every((criterion) => criterion && typeof criterion.label === 'string')
    && Boolean(value.weakest)
    && typeof value.judgeQuestion === 'string';
}

async function upgradeWithSemantics(payload) {
  if (!apiIsReachable()) return null;
  const abort = new AbortController();
  // Must exceed DEFAULT_TOTAL_BUDGET_MS in src/semantic.mjs (22s). The server
  // may try three vendors in sequence; aborting sooner throws away a
  // successful failover and silently downgrades the demo to deterministic.
  // test/semantic.test.mjs enforces this relationship.
  const timer = setTimeout(() => abort.abort(), 25_000);
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.mode !== 'semantic' || !looksLikeAnalysis(result)) return null;
    return result;
  } catch {
    // Offline, blocked, slow, or malformed: the deterministic result already
    // computed below is a complete answer, so degrade quietly rather than fail.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function renderAnalysisStages(stages) {
  // INV-5: every string here is ours, but the list is rebuilt through the DOM
  // rather than markup so it stays consistent with the rest of the interface.
  elements.analysisProgress.replaceChildren(...stages.map((stage) => {
    const item = document.createElement('li');
    item.className = `analysis-stage is-${stage.state}`;
    item.dataset.stage = stage.id;

    const icon = document.createElement('span');
    icon.className = 'analysis-stage-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = { done: '✓', active: '◐', skipped: '–' }[stage.state] ?? '·';

    const body = document.createElement('span');
    const label = document.createElement('strong');
    label.textContent = stage.label;
    const detail = document.createElement('small');
    detail.textContent = stage.detail;
    body.append(label, detail);

    item.append(icon, body);
    return item;
  }));
}

function paintAnalysisProgress(outcome = null) {
  const stages = analysisStages({
    criteriaCount: state.analysisCriteriaCount,
    elapsedMs: Date.now() - state.analysisStartedAt,
    outcome,
  });
  renderAnalysisStages(stages);

  // Announce the stage the user is waiting on, but only when it changes —
  // a per-second counter in a live region is unusable with a screen reader.
  const spoken = stages.map((stage) => `${stage.label}.`).join(' ');
  if (spoken !== state.analysisSpoken) {
    state.analysisSpoken = spoken;
    elements.analysisAnnounce.textContent = spoken;
  }
}

/**
 * @param {boolean} isLoading
 * @param {{criteriaCount?: number, outcome?: 'semantic'|'deterministic'|null}} options
 *   `outcome` leaves the finished stages on screen, so a user who returns via
 *   "Revise transcript" can still see whether the last review fell back.
 *   Omitting it clears the panel outright, which is what a reset wants.
 */
function setAnalysisLoading(isLoading, { criteriaCount = 0, outcome = null } = {}) {
  elements.analyzeAttempt.disabled = isLoading;
  elements.analyzeAttempt.setAttribute('aria-busy', String(isLoading));
  elements.analyzeSpinner.hidden = !isLoading;
  elements.analyzeArrow.hidden = isLoading;
  elements.analyzeLabel.textContent = isLoading ? 'Mapping evidence…' : 'Review this attempt';

  clearInterval(state.analysisTicker);
  state.analysisTicker = null;

  if (isLoading) {
    state.analysisStartedAt = Date.now();
    state.analysisCriteriaCount = criteriaCount;
    state.analysisSpoken = '';
    elements.analysisProgress.hidden = false;
    paintAnalysisProgress();
    state.analysisTicker = setInterval(paintAnalysisProgress, 1000);
    return;
  }

  if (outcome) {
    paintAnalysisProgress(outcome);
    return;
  }

  elements.analysisProgress.hidden = true;
  elements.analysisProgress.replaceChildren();
  elements.analysisAnnounce.textContent = '';
  state.analysisSpoken = '';
}

async function analyzeAttempt() {
  elements.attemptError.hidden = true;
  const project = practiceProject();
  const payload = {
    transcript: elements.attemptTranscript.value,
    rubricText: project.rubric,
    durationSeconds: elements.attemptDuration.value,
  };

  // Deterministic first. It validates the input loudly (INV-7) and always
  // produces a complete review, so a failed or slow gateway costs richness
  // rather than the demo.
  let analysis;
  try {
    analysis = analyzeSpeech(payload);
    analysis.criteria = analysis.criteria.map((criterion) => ({
      ...criterion,
      engine: 'deterministic',
    }));
    analysis.weakest = analysis.criteria.find((criterion) => criterion.id === analysis.weakest.id);
    analysis.semanticCriteria = 0;
    analysis.totalCriteria = analysis.criteria.length;
  } catch (error) {
    elements.attemptError.textContent = error instanceof AnalysisError
      ? error.message
      : 'This attempt could not be reviewed. Check the transcript and try again.';
    elements.attemptError.hidden = false;
    return;
  }

  setAnalysisLoading(true, { criteriaCount: analysis.criteria.length });
  const requestId = ++state.analysisRequestId;
  const semantic = await upgradeWithSemantics(payload);
  if (requestId !== state.analysisRequestId) return;
  setAnalysisLoading(false, { outcome: semantic ? 'semantic' : 'deterministic' });

  state.analysis = semantic ?? analysis;
  elements.reviewMode.textContent = MODE_LABEL[semantic ? 'semantic' : 'deterministic'];
  project.draft = elements.attemptTranscript.value.trim();
  project.draftDuration = Number(elements.attemptDuration.value);
  persist();
  renderReview(state.analysis);
  showPracticeStage('review');
}

function openDefense() {
  if (!state.analysis) return;
  state.defense = null;
  elements.defenseCriterion.textContent = state.analysis.weakest.label;
  elements.defenseQuestion.textContent = state.analysis.judgeQuestion;
  elements.defenseAnswer.value = '';
  elements.defenseError.hidden = true;
  elements.defenseEmpty.hidden = false;
  elements.defenseResult.hidden = true;
  showPracticeStage('defend');
  elements.defenseAnswer.focus();
}

function renderDefense(result) {
  state.defense = result;
  elements.defenseEmpty.hidden = true;
  elements.defenseResult.hidden = false;
  elements.defenseStatus.textContent = result.status;
  elements.defenseScore.textContent = `${result.score}%`;
  elements.defenseCopy.textContent = result.feedback;
  elements.matchedSignals.replaceChildren(
    ...(result.matchedSignals.length
      ? result.matchedSignals.map((signal) => signalChip(signal, 'matched'))
      : [signalChip('None yet', 'neutral')]),
  );
  elements.missingSignals.replaceChildren(
    ...(result.missingSignals.length
      ? result.missingSignals.map((signal) => signalChip(signal))
      : [signalChip('Nothing missing', 'matched')]),
  );
  elements.defenseFollowUp.textContent = result.followUp;
}

function checkDefense() {
  elements.defenseError.hidden = true;
  try {
    renderDefense(evaluateDefense({ answer: elements.defenseAnswer.value, criterion: state.analysis?.weakest }));
  } catch (error) {
    elements.defenseError.textContent = error instanceof AnalysisError
      ? error.message
      : 'This answer could not be reviewed. Check the text and try again.';
    elements.defenseError.hidden = false;
  }
}

function savePracticeSession(defenseStatus = state.defense?.status ?? 'not practiced') {
  if (!state.analysis) return;
  const project = practiceProject();
  const projectSessions = sessionsFor(project.id);
  state.workspace.sessions.push({
    id: idFor('session'),
    projectId: project.id,
    createdAt: new Date().toISOString(),
    evidenceScore: state.analysis.evidenceScore,
    weakest: state.analysis.weakest.label,
    defenseStatus,
    defenseScore: state.defense?.score ?? null,
    title: `Practice attempt ${projectSessions.length + 1}`,
  });
  state.workspace.activeProjectId = project.id;
  persist();
  renderAll();
  setRoute('progress');
  showToast('Practice session saved');
}

function rubricRow(criterion = { label: '', signals: [] }, index = 0) {
  const row = document.createElement('div');
  row.className = 'rubric-row';
  const number = document.createElement('span');
  number.className = 'rubric-number';
  number.textContent = String(index + 1);

  const labelField = document.createElement('div');
  labelField.className = 'rubric-field';
  const labelLabel = document.createElement('label');
  labelLabel.textContent = 'Criterion';
  const labelInput = document.createElement('input');
  labelInput.className = 'criterion-label-input';
  labelInput.value = criterion.label;
  labelInput.placeholder = 'e.g. Problem urgency';
  labelInput.maxLength = 120;
  labelInput.setAttribute('aria-label', `Criterion ${index + 1} name`);
  labelField.append(labelLabel, labelInput);

  const cuesField = document.createElement('div');
  cuesField.className = 'rubric-field';
  const cuesLabel = document.createElement('label');
  cuesLabel.textContent = 'Evidence cues, separated by commas';
  const cuesInput = document.createElement('input');
  cuesInput.className = 'criterion-signals-input';
  cuesInput.value = criterion.signals.join(', ');
  cuesInput.placeholder = 'users, frequency, evidence';
  cuesInput.maxLength = 240;
  cuesInput.setAttribute('aria-label', `Criterion ${index + 1} evidence cues`);
  cuesField.append(cuesLabel, cuesInput);

  const remove = document.createElement('button');
  remove.className = 'remove-criterion';
  remove.type = 'button';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Remove criterion ${index + 1}`);
  remove.addEventListener('click', () => {
    row.remove();
    renumberRubricRows();
  });
  row.append(number, labelField, cuesField, remove);
  return row;
}

function renumberRubricRows() {
  $$('.rubric-row', elements.rubricEditor).forEach((row, index) => {
    $('.rubric-number', row).textContent = String(index + 1);
  });
}

function renderRubricEditor() {
  const projectId = elements.rubricProject.value || state.workspace.activeProjectId;
  const project = state.workspace.projects.find((item) => item.id === projectId) ?? activeProject();
  elements.rubricProject.value = project.id;
  elements.rubricProjectName.textContent = project.name;
  elements.rubricEditor.replaceChildren(...rubricFor(project).map(rubricRow));
}

async function importRubricFromMatrix() {
  const source = elements.rubricImportInput.value.trim();
  if (!source) return;

  elements.rubricImportStatus.textContent = 'Structuring…';
  elements.rubricImportButton.disabled = true;
  try {
    const response = await fetch('/api/import-rubric', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rubricText: source }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? 'Import failed.');

    // Render into the editor UNSAVED. The student confirms before it persists:
    // the system never silently guesses what an evaluator meant.
    const criteria = parseRubric(result.rubricText);
    elements.rubricEditor.replaceChildren(...criteria.map((criterion, index) => rubricRow(
      { label: criterion.label, signals: criterion.signals },
      index,
    )));
    elements.rubricImportStatus.textContent = `${criteria.length} criteria ready — review them, then save.`;
  } catch (error) {
    // INV-8: import failing must never block the manual path.
    elements.rubricImportStatus.textContent = `${error.message} Edit the criteria manually below.`;
  } finally {
    elements.rubricImportButton.disabled = false;
  }
}

function saveRubric() {
  const project = state.workspace.projects.find((item) => item.id === elements.rubricProject.value);
  if (!project) return;
  const criteria = $$('.rubric-row', elements.rubricEditor).map((row) => ({
    label: $('.criterion-label-input', row).value.trim(),
    cues: $('.criterion-signals-input', row).value.trim(),
  })).filter((criterion) => criterion.label);
  if (criteria.length === 0) {
    showToast('Add at least one named criterion');
    return;
  }
  const rubricText = criteria.map((criterion) => `${criterion.label} | ${criterion.cues}`).join('\n');
  try {
    parseRubric(rubricText);
  } catch (error) {
    showToast(error instanceof AnalysisError ? error.message : 'This rubric could not be saved.');
    return;
  }
  project.rubric = rubricText;
  persist();
  renderAll();
  elements.rubricProject.value = project.id;
  renderRubricEditor();
  showToast('Rubric saved');
}

function renderProgress() {
  const projectId = elements.progressProject.value || state.workspace.activeProjectId;
  const project = state.workspace.projects.find((item) => item.id === projectId) ?? activeProject();
  elements.progressProject.value = project.id;
  const sessions = sessionsFor(project.id);
  const latest = sessions[0];
  const previous = sessions[1];
  elements.totalSessions.textContent = String(sessions.length);
  elements.latestCoverage.textContent = latest ? `${latest.evidenceScore}%` : '—';
  if (latest && previous) {
    const delta = latest.evidenceScore - previous.evidenceScore;
    elements.latestCoverageDelta.textContent = `${delta >= 0 ? '+' : ''}${delta} points from previous`;
  } else {
    elements.latestCoverageDelta.textContent = latest ? 'First baseline' : 'No change yet';
  }

  const gaps = sessions.reduce((counts, session) => {
    counts[session.weakest] = (counts[session.weakest] ?? 0) + 1;
    return counts;
  }, {});
  const recurring = Object.entries(gaps).sort((left, right) => right[1] - left[1])[0]?.[0];
  elements.recurringGap.textContent = recurring ?? 'No data yet';

  const chartSessions = [...sessions].reverse().slice(-8);
  // One bar is not a trend. Wait for a second attempt before implying change.
  if (chartSessions.length < 2) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Practise twice to see what changed between attempts.';
    elements.progressChart.replaceChildren(empty);
  } else {
    elements.progressChart.replaceChildren(...chartSessions.map((session, index) => {
      const column = document.createElement('div');
      column.className = 'chart-column';
      const value = document.createElement('span');
      value.className = 'chart-value';
      value.textContent = `${session.evidenceScore}%`;
      const bar = document.createElement('div');
      bar.className = 'chart-bar';
      bar.style.height = `${Math.max(8, session.evidenceScore * 1.8)}px`;
      const label = document.createElement('span');
      label.className = 'chart-label';
      label.textContent = `Attempt ${index + 1}`;
      column.append(value, bar, label);
      return column;
    }));
  }
  renderSessionList(elements.allSessions, sessions);
}

function renderAll() {
  renderSidebar();
  renderProjectSelectors();
  state.practiceProjectId ??= state.workspace.activeProjectId;
  renderDashboard();
  renderSetup();
  renderRubricEditor();
  renderProgress();
  renderRehearser();
}

function setRoute(route) {
  const allowed = ['home', 'practice', 'rubric', 'progress'];
  state.route = allowed.includes(route) ? route : 'home';
  elements.views.forEach((view) => view.classList.toggle('is-visible', view.dataset.view === state.route));
  elements.routeButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.route === state.route));
  history.replaceState(null, '', `#${state.route}`);
  if (state.route === 'practice') renderSetup();
  if (state.route === 'rubric') renderRubricEditor();
  if (state.route === 'progress') renderProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startPractice() {
  state.practiceProjectId = state.workspace.activeProjectId;
  state.analysis = null;
  state.defense = null;
  showPracticeStage('setup');
  setRoute('practice');
}

function openProjectDialog() {
  elements.projectForm.reset();
  elements.projectError.hidden = true;
  elements.projectDialog.showModal();
  elements.projectName.focus();
}

function closeProjectDialog() {
  elements.projectDialog.close();
}

function openResetDialog() {
  elements.resetDialog.showModal();
  elements.cancelReset.focus();
}

function closeResetDialog() {
  if (elements.resetDialog.open) elements.resetDialog.close();
}

// ---------------------------------------------------------------------------
//  Who is rehearsing.
//
//  This is a label on a workspace, not an account: no server, no credential,
//  no session. It earns its place at the booth, where one laptop is handed
//  between visitors and the previous visitor's name on the screen is simply
//  wrong. INV-2 is why none of the copy borrows the vocabulary of an account:
//  test/invariants.test.mjs fails the build if it does.
// ---------------------------------------------------------------------------
const GUEST_LABEL = 'Guest';

function rehearserName() {
  return String(state.workspace.rehearser ?? '').trim();
}

function renderRehearser() {
  const name = rehearserName();
  // INV-5: user-supplied text, so textContent only.
  elements.rehearserName.textContent = name || GUEST_LABEL;
  elements.rehearserInitials.textContent = name ? initials(name) : 'G';
  // "Stored on this device" already sits directly above, so this line earns
  // its space by saying what the chip does rather than repeating that.
  elements.rehearserHint.textContent = name ? 'Change name' : 'Add your name';
  elements.rehearserChip.setAttribute(
    'aria-label',
    name ? `Rehearsing as ${name}. Change the name on this workspace.` : 'Rehearsing as a guest. Put your name on this workspace.',
  );
}

function openRehearserDialog() {
  elements.rehearserInput.value = rehearserName();
  if (!elements.rehearserDialog.open) elements.rehearserDialog.showModal();
  elements.rehearserInput.focus();
  elements.rehearserInput.select();
}

function closeRehearserDialog() {
  if (elements.rehearserDialog.open) elements.rehearserDialog.close();
}

function setRehearser(name) {
  state.workspace.rehearser = String(name ?? '').trim().slice(0, 40);
  persist();
  renderRehearser();
  closeRehearserDialog();
}

function resetWorkspace() {
  if (state.recordingStartedAt && state.recognition) state.recognition.stop();
  state.analysisRequestId += 1;

  state.workspace = clone(initialWorkspace);
  state.route = 'home';
  state.practiceStage = 'setup';
  state.practiceProjectId = initialWorkspace.activeProjectId;
  state.analysis = null;
  state.defense = null;
  state.recordingStartedAt = null;
  state.recordingBaseText = '';
  state.finalDictation = '';

  elements.dictateButton.classList.remove('is-recording');
  elements.dictateLabel.textContent = state.recognition ? 'Dictate' : 'Dictation unavailable';
  setAnalysisLoading(false);
  persist();
  closeResetDialog();
  renderAll();
  showPracticeStage('setup');
  setRoute('home');
  // Do NOT open the name dialog here. It was tried, and a modal makes every
  // other control inert: after a reset the sidebar "+" was covered by the
  // dialog's top layer, so a booth attendant could not create a project until
  // they dealt with a prompt they never asked for. The chip already reads
  // "Guest · Add your name", which is the affordance without the roadblock.
  showToast('Demo workspace reset — add your name in the sidebar');
}

function createProject(event) {
  event.preventDefault();
  const name = elements.projectName.value.trim();
  const context = elements.projectEvent.value.trim();
  if (!name || !context) {
    elements.projectError.textContent = 'Add a project name and event context.';
    elements.projectError.hidden = false;
    return;
  }
  const project = {
    id: idFor('project'),
    name,
    event: context,
    deadline: elements.projectDeadline.value,
    rubric: DEFAULT_RUBRIC,
    draft: '',
    draftDuration: 90,
    createdAt: new Date().toISOString(),
  };
  state.workspace.projects.push(project);
  state.workspace.activeProjectId = project.id;
  state.practiceProjectId = project.id;
  persist();
  closeProjectDialog();
  renderAll();
  elements.rubricProject.value = project.id;
  setRoute('rubric');
  showToast('Project created — customize its rubric');
}

function setupDictation() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    elements.dictateButton.disabled = true;
    elements.dictateLabel.textContent = 'Dictation unavailable';
    elements.dictateButton.title = 'Paste a transcript instead.';
    return;
  }
  const recognition = new SpeechRecognition();
  // Indonesian is the default because that is who this is for, but a pitch to
  // these judges is routinely mixed, and a rehearsal tool that mistranscribes
  // half of it is worse than one that asks which language you are about to use.
  try {
    const saved = localStorage.getItem(DICTATION_LANGUAGE_KEY);
    if (saved && [...elements.dictateLanguage.options].some((option) => option.value === saved)) {
      elements.dictateLanguage.value = saved;
    }
  } catch {
    // Private mode; the markup default (Bahasa Indonesia) stands.
  }
  recognition.lang = elements.dictateLanguage.value;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.addEventListener('start', () => {
    state.recordingStartedAt = Date.now();
    state.recordingBaseText = elements.attemptTranscript.value.trim();
    state.finalDictation = '';
    elements.dictateButton.classList.add('is-recording');
    elements.dictateLabel.textContent = 'Stop dictating';
  });
  recognition.addEventListener('result', (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) state.finalDictation += `${text} `;
      else interim += text;
    }
    elements.attemptTranscript.value = [state.recordingBaseText, state.finalDictation.trim(), interim.trim()].filter(Boolean).join(' ');
  });
  recognition.addEventListener('end', () => {
    if (state.recordingStartedAt) {
      elements.attemptDuration.value = String(Math.max(1, Math.round((Date.now() - state.recordingStartedAt) / 1000)));
      elements.attemptTimer.textContent = timerCopy(Number(elements.attemptDuration.value));
    }
    state.recordingStartedAt = null;
    elements.dictateButton.classList.remove('is-recording');
    elements.dictateLabel.textContent = 'Dictate';
  });
  recognition.addEventListener('error', () => {
    elements.attemptError.textContent = 'Dictation stopped. Keep the captured text or paste a transcript.';
    elements.attemptError.hidden = false;
  });
  elements.dictateButton.addEventListener('click', () => {
    if (state.recordingStartedAt) recognition.stop();
    // The Web Speech API recognises one language per session — it cannot detect
    // a switch mid-sentence — so the choice has to be the speaker's, read at
    // the moment they start rather than fixed when the page loaded.
    else {
      recognition.lang = elements.dictateLanguage.value;
      recognition.start();
    }
  });
  // Changing language mid-recording would silently keep the old one, so restart
  // rather than leave the control lying about what is being transcribed.
  elements.dictateLanguage.addEventListener('change', () => {
    try {
      localStorage.setItem(DICTATION_LANGUAGE_KEY, elements.dictateLanguage.value);
    } catch {
      // Private mode. The choice still applies to this session.
    }
    if (!state.recordingStartedAt) return;
    recognition.stop();
  });
  state.recognition = recognition;
}

elements.routeButtons.forEach((button) => button.addEventListener('click', (event) => {
  event.preventDefault();
  setRoute(button.dataset.route);
}));
elements.startPracticeButtons.forEach((button) => button.addEventListener('click', startPractice));
elements.practiceProject.addEventListener('change', () => {
  state.practiceProjectId = elements.practiceProject.value;
  state.workspace.activeProjectId = state.practiceProjectId;
  persist();
  renderSidebar();
  renderSetup();
});
elements.beginAttempt.addEventListener('click', beginAttempt);
elements.analyzeAttempt.addEventListener('click', analyzeAttempt);
elements.attemptTranscript.addEventListener('input', () => {
  const project = practiceProject();
  project.draft = elements.attemptTranscript.value;
  persist();
  elements.draftStatus.textContent = 'Draft saved locally';
});
elements.attemptDuration.addEventListener('input', () => {
  elements.attemptTimer.textContent = timerCopy(Number(elements.attemptDuration.value));
  const project = practiceProject();
  project.draftDuration = Number(elements.attemptDuration.value);
  persist();
});
elements.openDefense.addEventListener('click', openDefense);
elements.reviseAttempt.addEventListener('click', () => showPracticeStage('attempt'));
elements.saveWithoutDefense.addEventListener('click', () => savePracticeSession('not practiced'));
elements.evaluateDefense.addEventListener('click', checkDefense);
elements.saveSession.addEventListener('click', () => savePracticeSession());
elements.backToReview.addEventListener('click', () => showPracticeStage('review'));
elements.exitPractice.addEventListener('click', () => setRoute('home'));
elements.rubricProject.addEventListener('change', renderRubricEditor);
elements.rubricImportButton.addEventListener('click', importRubricFromMatrix);
elements.addCriterion.addEventListener('click', () => {
  const rows = $$('.rubric-row', elements.rubricEditor).length;
  if (rows >= MAX_CRITERIA) {
    showToast(`Use at most ${MAX_CRITERIA} criteria in one rehearsal`);
    return;
  }
  elements.rubricEditor.append(rubricRow(undefined, rows));
});
elements.saveRubric.addEventListener('click', saveRubric);
elements.progressProject.addEventListener('change', renderProgress);
elements.projectForm.addEventListener('submit', createProject);
elements.closeProjectDialog.addEventListener('click', closeProjectDialog);
elements.cancelProject.addEventListener('click', closeProjectDialog);
elements.sidebarAddProject.addEventListener('click', openProjectDialog);
elements.mobileAddProject.addEventListener('click', openProjectDialog);
elements.resetButtons.forEach((button) => button.addEventListener('click', openResetDialog));
elements.closeResetDialog.addEventListener('click', closeResetDialog);
elements.cancelReset.addEventListener('click', closeResetDialog);
elements.confirmReset.addEventListener('click', resetWorkspace);
elements.rehearserChip.addEventListener('click', openRehearserDialog);
elements.closeRehearserDialog.addEventListener('click', closeRehearserDialog);
elements.continueAsGuest.addEventListener('click', () => setRehearser(''));
elements.saveRehearser.addEventListener('click', () => setRehearser(elements.rehearserInput.value));
elements.rehearserInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  setRehearser(elements.rehearserInput.value);
});

state.practiceProjectId = state.workspace.activeProjectId;
persist();
renderAll();
showPracticeStage('setup');
setRoute(location.hash.slice(1) || 'home');
setupDictation();
