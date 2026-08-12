'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import {
  analyzeSpeech,
  DEFAULT_RUBRIC,
  evaluateDefense,
  parseRubric,
  STARTER_DRAFT,
  type AnalysisResult,
  type DefenseResult,
} from '@/lib/analyzer';
import { jsonRequest, requestContract } from '@/lib/api/client';
import { detectReusedCitations } from '@/lib/citation-reuse';
import {
  CapabilitiesResponseSchema,
  ConfirmRubricResponseSchema,
  CreateAttemptResponseSchema,
  CreateProjectResponseSchema,
  DefenseResponseSchema,
  EvidenceConfirmationResponseSchema,
  EvidenceResponseSchema,
  QuestionResponseSchema,
  SourceDocumentDeleteResponseSchema,
  SourceDocumentUploadResponseSchema,
  type RubricSource,
  type Criterion,
  type ReusedCitation,
  type SourceDocument,
} from '@/lib/contracts';
import {
  appendLocalEvidenceConfirmation,
  rejudgeLocalEvidence,
} from '@/lib/evidence-confirmations';
import { parseSavedSessions, PRODUCTION_SESSIONS_KEY } from '@/lib/progress';
import { readRubricSourceType, RUBRIC_STORAGE_KEY } from '@/lib/rubric-storage';

type Stage = 'setup' | 'attempt' | 'review' | 'defend';

const stageOrder: Stage[] = ['setup', 'attempt', 'review', 'defend'];
const REMOTE_PROJECT_TITLE = 'Talk-Active · RISTEK Finals';

interface RemoteContext {
  projectId: string;
  criteria: Criterion[];
}

function storedRubric(): { rubricText: string; sourceType: RubricSource } {
  try {
    const saved = JSON.parse(localStorage.getItem(RUBRIC_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(saved) || saved.length === 0) return { rubricText: DEFAULT_RUBRIC, sourceType: 'manual' };
    const lines = saved.flatMap((item) => {
      if (!item || typeof item !== 'object' || !('name' in item) || !('evidence' in item)) return [];
      return [`${String(item.name)} | ${String(item.evidence)}`];
    });
    return {
      rubricText: lines.length > 0 ? lines.join('\n') : DEFAULT_RUBRIC,
      sourceType: readRubricSourceType(localStorage),
    };
  } catch {
    return { rubricText: DEFAULT_RUBRIC, sourceType: 'manual' };
  }
}

function SignalChips({ signals, empty }: Readonly<{ signals: string[]; empty: string }>) {
  return <>{signals.length > 0 ? signals.map((signal) => <span className="signal-chip" key={signal}>{signal}</span>) : <span className="signal-chip neutral">{empty}</span>}</>;
}

export function PracticeRoom() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('setup');
  const [transcript, setTranscript] = useState(STARTER_DRAFT);
  const [duration, setDuration] = useState(90);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [answer, setAnswer] = useState('');
  const [defense, setDefense] = useState<DefenseResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [persistence, setPersistence] = useState<'local' | 'neon'>('local');
  const [sourceDocumentsAvailable, setSourceDocumentsAvailable] = useState(false);
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocument[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceStatus, setSourceStatus] = useState('');
  const [questionSourceFilename, setQuestionSourceFilename] = useState<string | null>(null);
  const [rubricText, setRubricText] = useState(DEFAULT_RUBRIC);
  const [rubricSourceType, setRubricSourceType] = useState<RubricSource>('manual');
  const [remoteContext, setRemoteContext] = useState<RemoteContext | null>(null);
  const [remoteAttemptId, setRemoteAttemptId] = useState<string | null>(null);
  const [engineNote, setEngineNote] = useState('Evidence mapped by deterministic cue matching on this device.');
  const [criterionEngines, setCriterionEngines] = useState<Record<string, 'semantic' | 'deterministic'>>({});
  const [reusedCitations, setReusedCitations] = useState<ReusedCitation[]>([]);
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});
  const [confirmationBusy, setConfirmationBusy] = useState<Record<string, boolean>>({});
  const [confirmationNotes, setConfirmationNotes] = useState<Record<string, string>>({});
  const [reviewId, setReviewId] = useState('');
  const rubric = useMemo(() => parseRubric(rubricText), [rubricText]);

  useEffect(() => {
    const stored = storedRubric();
    setRubricText(stored.rubricText);
    setRubricSourceType(stored.sourceType);
    void requestContract('/api/capabilities', CapabilitiesResponseSchema)
      .then((capabilities) => {
        setPersistence(capabilities.persistence);
        setSourceDocumentsAvailable(capabilities.sourceDocuments);
      })
      .catch(() => {
        setPersistence('local');
        setSourceDocumentsAvailable(false);
      });
  }, []);

  async function ensureRemoteContext(): Promise<RemoteContext> {
    if (remoteContext) return remoteContext;
    const project = await requestContract('/api/projects', CreateProjectResponseSchema, jsonRequest('POST', {
      title: REMOTE_PROJECT_TITLE,
      eventContext: '7-minute pitch · 3-minute Q&A',
      deadline: '2026-08-14',
    }));
    const confirmed = await requestContract(
      `/api/projects/${project.project.id}/rubric`,
      ConfirmRubricResponseSchema,
      jsonRequest('PUT', {
        sourceType: rubricSourceType,
        criteria: rubric.map((criterion, displayOrder) => ({
          name: criterion.label,
          description: criterion.requirementText,
          requiredEvidence: criterion.signals,
          displayOrder,
        })),
      }),
    );
    const context = { projectId: project.project.id, criteria: confirmed.criteria };
    setRemoteContext(context);
    return context;
  }

  async function runAnalysis() {
    setBusy(true);
    setRemoteAttemptId(null);
    setReusedCitations([]);
    setConfirmations({});
    setConfirmationNotes({});
    setReviewId(crypto.randomUUID());
    setQuestionSourceFilename(null);
    try {
      const localResult = analyzeSpeech({ transcript, rubricText, durationSeconds: duration });
      const localReusedCitations = detectReusedCitations(localResult.criteria.map((criterion) => ({
        criterionId: criterion.id,
        citedSpan: criterion.excerpt || null,
      })));
      const localEngines = Object.fromEntries(
        localResult.criteria.map((criterion) => [criterion.id, 'deterministic' as const]),
      );
      if (persistence === 'local') {
        setAnalysis(localResult);
        setCriterionEngines(localEngines);
        setReusedCitations(localReusedCitations);
        setEngineNote('Evidence mapped by deterministic cue matching on this device.');
      } else {
        try {
          const context = await ensureRemoteContext();
          const created = await requestContract('/api/attempts', CreateAttemptResponseSchema, jsonRequest('POST', {
            projectId: context.projectId,
            mode: 'typed',
            transcript,
            transcriptSource: 'typed',
            durationSeconds: duration,
          }));
          const evidence = await requestContract(
            `/api/attempts/${created.attempt.id}/evidence`,
            EvidenceResponseSchema,
            jsonRequest('POST'),
          );
          const question = await requestContract(
            `/api/attempts/${created.attempt.id}/question`,
            QuestionResponseSchema,
            jsonRequest('POST'),
          );
          setQuestionSourceFilename(question.sourceDocument?.filename ?? null);
          const byCriterion = new Map(evidence.verdicts.map((verdict) => [verdict.criterionId, verdict]));
          const mappedCriteria = context.criteria.map((criterion, index) => {
            const verdict = byCriterion.get(criterion.id);
            const local = localResult.criteria[index];
            if (!verdict || !local) throw new Error('A persisted verdict did not map to its confirmed criterion.');
            return {
              id: criterion.id,
              label: criterion.name,
              requirementText: criterion.description,
              signals: criterion.requiredEvidence,
              score: verdict.coverageScore * 100,
              status: verdict.verdict === 'supported' ? 'covered' as const : verdict.verdict === 'partial' ? 'partial' as const : 'missing' as const,
              matchedSignals: local.matchedSignals,
              missingSignals: verdict.missingEvidence,
              excerpt: verdict.citedSpan ?? '',
            };
          });
          const weakest = [...mappedCriteria].sort((left, right) => left.score - right.score)[0];
          if (!weakest) throw new Error('The persisted review contained no criteria.');
          setAnalysis({
            ...localResult,
            evidenceScore: Math.round(mappedCriteria.reduce((sum, criterion) => sum + criterion.score, 0) / mappedCriteria.length),
            coveredCount: mappedCriteria.filter((criterion) => criterion.status === 'covered').length,
            criterionCount: mappedCriteria.length,
            criteria: mappedCriteria,
            weakest,
            judgeQuestion: question.question.questionText,
          });
          setCriterionEngines(Object.fromEntries(
            evidence.verdicts.map((verdict) => [verdict.criterionId, verdict.engine]),
          ));
          setReusedCitations(evidence.reusedCitations);
          setRemoteAttemptId(created.attempt.id);
          setEngineNote(evidence.degraded
            ? 'The hosted review was saved, with one or more criteria explicitly evaluated by deterministic fallback.'
            : 'The hosted review was evaluated semantically and every citation was grounded before display.');
        } catch (remoteError) {
          setAnalysis(localResult);
          setCriterionEngines(localEngines);
          setReusedCitations(localReusedCitations);
          setEngineNote(`Hosted persistence was unavailable. This visible review uses deterministic cue matching locally; it was not synced. ${remoteError instanceof Error ? remoteError.message : ''}`.trim());
        }
      }
      setError('');
      setStage('review');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The attempt could not be analysed.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadSourceDocument() {
    if (!sourceFile) return;
    setSourceBusy(true);
    setSourceStatus('');
    try {
      const context = await ensureRemoteContext();
      const form = new FormData();
      form.set('file', sourceFile);
      const saved = await requestContract(
        `/api/projects/${context.projectId}/sources`,
        SourceDocumentUploadResponseSchema,
        { method: 'POST', body: form },
      );
      setSourceDocuments((current) => [...current, saved.sourceDocument]);
      setSourceFile(null);
      setSourceStatus(`${saved.sourceDocument.filename} attached privately to this project.`);
    } catch (caught) {
      setSourceStatus(caught instanceof Error ? caught.message : 'The source document could not be attached.');
    } finally {
      setSourceBusy(false);
    }
  }

  async function deleteSourceDocument(sourceDocument: SourceDocument) {
    if (!remoteContext) return;
    setSourceBusy(true);
    setSourceStatus('');
    try {
      await requestContract(
        `/api/projects/${remoteContext.projectId}/sources/${sourceDocument.id}`,
        SourceDocumentDeleteResponseSchema,
        jsonRequest('DELETE'),
      );
      setSourceDocuments((current) => current.filter((item) => item.id !== sourceDocument.id));
      setSourceStatus(`${sourceDocument.filename} was permanently removed from private storage.`);
    } catch (caught) {
      setSourceStatus(caught instanceof Error ? caught.message : 'The source document could not be removed.');
    } finally {
      setSourceBusy(false);
    }
  }

  function applyRejudgedCriterion(
    criterionId: string,
    next: {
      verdict: 'supported' | 'partial' | 'unsupported';
      coverageScore: 0 | 0.5 | 1;
      citedSpan: string | null;
      missingEvidence: string[];
      engine: 'semantic' | 'deterministic';
    },
    questionText?: string,
    drillText?: string,
  ) {
    if (!analysis) return;
    const mappedCriteria = analysis.criteria.map((criterion) => criterion.id === criterionId
      ? {
          ...criterion,
          score: next.coverageScore * 100,
          status: next.verdict === 'supported'
            ? 'covered' as const
            : next.verdict === 'partial' ? 'partial' as const : 'missing' as const,
          missingSignals: next.missingEvidence,
          excerpt: next.citedSpan ?? '',
        }
      : criterion);
    const weakest = [...mappedCriteria].sort((left, right) => left.score - right.score)[0];
    if (!weakest) return;
    setAnalysis({
      ...analysis,
      evidenceScore: Math.round(
        mappedCriteria.reduce((sum, criterion) => sum + criterion.score, 0) / mappedCriteria.length,
      ),
      coveredCount: mappedCriteria.filter((criterion) => criterion.status === 'covered').length,
      criteria: mappedCriteria,
      weakest,
      judgeQuestion: questionText ?? analysis.judgeQuestion,
      drill: drillText ?? analysis.drill,
    });
    setCriterionEngines((current) => ({ ...current, [criterionId]: next.engine }));
    setReusedCitations(detectReusedCitations(mappedCriteria.map((criterion) => ({
      criterionId: criterion.id,
      citedSpan: criterion.excerpt || null,
    }))));
  }

  async function confirmEvidence(criterionId: string, accepted: boolean) {
    if (!analysis || confirmations[criterionId] !== undefined) return;
    const criterion = analysis.criteria.find((item) => item.id === criterionId);
    if (!criterion) return;
    setConfirmationBusy((current) => ({ ...current, [criterionId]: true }));
    setConfirmationNotes((current) => ({ ...current, [criterionId]: '' }));
    try {
      if (remoteAttemptId) {
        const saved = await requestContract(
          `/api/attempts/${remoteAttemptId}/evidence/${criterionId}/confirmation`,
          EvidenceConfirmationResponseSchema,
          jsonRequest('POST', { accepted }),
        );
        setConfirmations((current) => ({ ...current, [criterionId]: accepted }));
        if (accepted && saved.verdict.coverageScore !== criterion.score / 100) {
          applyRejudgedCriterion(criterionId, saved.verdict);
        }
        let questionText: string | undefined;
        if (saved.rejudged) {
          try {
            const question = await requestContract(
              `/api/attempts/${remoteAttemptId}/question`,
              QuestionResponseSchema,
              jsonRequest('POST'),
            );
            questionText = question.question.questionText;
            setQuestionSourceFilename(question.sourceDocument?.filename ?? null);
          } catch {
            // The label and replacement verdict are already durable. A stale
            // preview question must not invite a second confirmation/re-judge.
          }
          applyRejudgedCriterion(criterionId, saved.verdict, questionText);
        }
        setConfirmationNotes((current) => ({
          ...current,
          [criterionId]: saved.rejudged
            ? saved.degraded
              ? 'Saved. No different grounded evidence was found, so this criterion is now unsupported.'
              : 'Saved. This criterion was re-judged once without the rejected evidence.'
            : 'Saved as a human-confirmed evaluation label. No model call was made.',
        }));
      } else {
        const createdAt = new Date().toISOString();
        const localRejudge = accepted ? null : rejudgeLocalEvidence(transcript, criterion, duration);
        appendLocalEvidenceConfirmation(localStorage, {
          id: crypto.randomUUID(),
          reviewId,
          criterionId,
          criterionName: criterion.label,
          accepted,
          judgedVerdict: criterion.status === 'covered'
            ? 'supported'
            : criterion.status === 'partial' ? 'partial' : 'unsupported',
          judgedCoverageScore: criterion.status === 'covered' ? 1 : criterion.status === 'partial' ? 0.5 : 0,
          judgedCitedSpan: criterion.excerpt || null,
          judgedMissingEvidence: criterion.missingSignals,
          judgedEngine: 'deterministic',
          createdAt,
          rejudgedAt: accepted ? null : createdAt,
        });
        if (localRejudge) {
          applyRejudgedCriterion(criterionId, {
            verdict: localRejudge.criterion.status === 'covered'
              ? 'supported'
              : localRejudge.criterion.status === 'partial' ? 'partial' : 'unsupported',
            coverageScore: localRejudge.criterion.status === 'covered'
              ? 1
              : localRejudge.criterion.status === 'partial' ? 0.5 : 0,
            citedSpan: localRejudge.criterion.excerpt || null,
            missingEvidence: localRejudge.criterion.missingSignals,
            engine: 'deterministic',
          }, localRejudge.judgeQuestion, localRejudge.drill);
        } else if (accepted && criterion.status !== 'missing') {
          applyRejudgedCriterion(criterionId, {
            verdict: 'supported',
            coverageScore: 1,
            citedSpan: criterion.excerpt || null,
            missingEvidence: criterion.missingSignals,
            engine: 'deterministic',
          });
        }
        setConfirmationNotes((current) => ({
          ...current,
          [criterionId]: accepted
            ? 'Saved in this browser as a human evaluation label.'
            : 'Saved in this browser. This criterion was re-checked once with the rejected sentence excluded.',
        }));
      }
      setConfirmations((current) => ({ ...current, [criterionId]: accepted }));
    } catch (caught) {
      setConfirmationNotes((current) => ({
        ...current,
        [criterionId]: caught instanceof Error ? caught.message : 'This evaluation label could not be saved.',
      }));
    } finally {
      setConfirmationBusy((current) => ({ ...current, [criterionId]: false }));
    }
  }

  async function runDefense() {
    setBusy(true);
    try {
      if (!analysis) throw new Error('Review an attempt before entering the judge room.');
      const localDefense = evaluateDefense({ answer, criterion: analysis.weakest });
      setDefense(localDefense);
      if (remoteAttemptId) {
        const saved = await requestContract(
          `/api/attempts/${remoteAttemptId}/defense`,
          DefenseResponseSchema,
          jsonRequest('POST', { answerText: answer }),
        );
        setEngineNote(saved.degraded
          ? 'The defense was saved with an explicitly labelled deterministic evaluation.'
          : 'The defense was saved and evaluated only against this answer.');
      }
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The defense could not be evaluated.');
    } finally {
      setBusy(false);
    }
  }

  function saveSession() {
    if (!analysis) return;
    const existing = parseSavedSessions(localStorage.getItem(PRODUCTION_SESSIONS_KEY));
    existing.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      evidenceScore: analysis.evidenceScore,
      weakest: analysis.weakest.label,
      defenseStatus: defense?.status ?? null,
      projectId: remoteAttemptId ? remoteContext?.projectId ?? null : null,
      criteria: analysis.criteria.map((criterion) => ({
        criterionId: criterion.id,
        criterionName: criterion.label,
        verdict: criterion.status === 'covered'
          ? 'supported' as const
          : criterion.status === 'partial' ? 'partial' as const : 'unsupported' as const,
        coverage: criterion.score / 100,
        citedSpan: criterion.excerpt || null,
        missingEvidence: criterion.missingSignals,
      })),
    });
    localStorage.setItem(PRODUCTION_SESSIONS_KEY, JSON.stringify(existing.slice(-12)));
    router.push('/progress');
  }

  return (
    <section className="view is-visible" aria-labelledby="practiceTitle">
      <header className="page-header compact-header workflow-header">
        <div className="workflow-heading"><img className="workflow-mark" src={logo.src} alt="" /><div><p className="overline">Practice room</p><h1 id="practiceTitle">Rehearse one attempt at a time.</h1></div></div>
        <Link className="button button-secondary" href="/workspace">Exit session</Link>
      </header>

      <ol className="practice-steps" aria-label="Practice progress">
        {stageOrder.map((item, index) => {
          const current = stageOrder.indexOf(stage);
          const state = index === current ? ' is-active' : index < current ? ' is-complete' : '';
          return <li className={state} key={item}><span>{index + 1}</span>{item === 'setup' ? 'Set up' : item[0]?.toUpperCase() + item.slice(1)}</li>;
        })}
      </ol>

      {stage === 'setup' && <section className="practice-stage is-visible">
        <div className="stage-intro"><p className="overline">Before you begin</p><h2>What are you preparing for?</h2><p>Confirm the project and evaluator rubric. Both stay attached to this session.</p></div>
        <div className="setup-grid">
          <div className="surface setup-form">
            <label htmlFor="practiceProject">Project</label><select id="practiceProject"><option>Talk-Active · RISTEK Finals</option></select>
            <div className="setup-project-summary"><span className="project-avatar">TA</span><div><strong>Talk-Active · RISTEK Finals</strong><small>7-minute pitch · 3-minute Q&amp;A</small></div></div>
            <button className="button button-primary button-full" type="button" onClick={() => setStage('attempt')}>Begin this attempt <span aria-hidden="true">→</span></button>
          </div>
          <aside className="surface setup-rubric">
            <div className="section-title-row"><div><p className="overline">Active rubric</p><h3>{rubric.length} criteria</h3></div><Link className="text-button" href="/rubric">Edit</Link></div>
            <div className="setup-criteria-list">{rubric.map((criterion) => <div className="mini-criterion" key={criterion.id}><i /><span>{criterion.label}</span></div>)}</div>
            <p className="trust-note"><span aria-hidden="true">◆</span> Every critique must map back to one of these criteria.</p>
          </aside>
        </div>
      </section>}

      {stage === 'attempt' && <section className="practice-stage is-visible">
        <div className="attempt-layout">
          <div className="surface capture-panel">
            <div className="capture-header"><div><p className="overline">Current attempt</p><h2>Talk-Active · RISTEK Finals</h2></div><div className="timer">typed</div></div>
            <div className="capture-tabs" role="tablist" aria-label="Input method"><button className="is-active" type="button" role="tab" aria-selected="true">Transcript</button><button type="button" role="tab" aria-selected="false" disabled><span className="record-dot" />Dictation follows after browser parity</button></div>
            <label className="sr-only" htmlFor="attemptTranscript">Practice transcript</label>
            <textarea id="attemptTranscript" rows={15} maxLength={12_000} value={transcript} onChange={(event) => setTranscript(event.target.value)} />
            {sourceDocumentsAvailable && <section className="production-source-attachment" aria-labelledby="sourceAttachmentTitle">
              <div><strong id="sourceAttachmentTitle">Ground the judge question in your material</strong><p>Optional: attach up to three UTF-8 text, Markdown, or JSON files, 40 KB each. Files stay in private project storage.</p></div>
              <div className="production-source-controls"><label className="button button-secondary" htmlFor="practiceSourceFile">Choose source</label><input key={sourceDocuments.length} id="practiceSourceFile" type="file" accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json" onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)} /><span>{sourceFile?.name ?? 'No file chosen'}</span><button className="button button-secondary" type="button" disabled={!sourceFile || sourceBusy || sourceDocuments.length >= 3} onClick={() => void uploadSourceDocument()}>{sourceBusy ? 'Saving…' : 'Attach privately'}</button></div>
              {sourceDocuments.length > 0 && <ul className="production-source-list">{sourceDocuments.map((document) => <li key={document.id}><span><strong>{document.filename}</strong><small>{Math.ceil(document.sizeBytes / 1000)} KB · private</small></span><button className="text-button" type="button" disabled={sourceBusy} onClick={() => void deleteSourceDocument(document)}>Remove</button></li>)}</ul>}
              <p className="production-field-note">When semantic question generation is configured, attached text is sent with the weakest criterion under zero-data-retention routing. Otherwise, Talk-Active selects an exact source sentence deterministically.</p>
              {sourceStatus && <p className="rubric-import-status" role="status">{sourceStatus}</p>}
            </section>}
            <div className="capture-footer"><div className="duration-control"><label htmlFor="attemptDuration">Duration</label><input id="attemptDuration" type="number" min="1" max="3600" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><span>seconds</span></div><span className="save-state"><span aria-hidden="true">●</span> Local guest draft</span></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary button-full" type="button" disabled={busy} aria-busy={busy} onClick={() => void runAnalysis()}>{busy ? 'Reviewing each criterion…' : 'Review this attempt'} <span aria-hidden="true">→</span></button>
          </div>
          <aside className="session-sidebar"><section className="surface session-goal"><p className="overline">Session goal</p><h3>Make every important claim defensible.</h3><p>Complete the attempt naturally. The review isolates only the next weakness worth fixing.</p></section><section className="surface privacy-card"><span className="privacy-icon" aria-hidden="true">⌾</span><div><strong>{persistence === 'local' ? 'Your work stays local in this iteration' : 'Project sync is active on this deployment'}</strong><p>{persistence === 'local' ? 'Text session history is stored in this browser. Raw audio is never saved.' : 'Attempts and private source files are saved to the configured project services. Raw audio is never saved.'}</p></div></section></aside>
        </div>
      </section>}

      {stage === 'review' && analysis && <section className="practice-stage is-visible">
        <div className="review-hero"><div><p className="overline overline-light">Attempt review</p><h2>One claim needs your attention before the judges find it.</h2><p>This result measures explicit rubric evidence in this transcript—not confidence or speaking ability.</p><p className="analysis-mode">{engineNote}</p></div><div className="coverage-gauge" style={{ '--gauge': `${analysis.evidenceScore * 3.6}deg` } as React.CSSProperties}><strong>{analysis.evidenceScore}%</strong><span>rubric evidence</span></div></div>
        <div className="review-grid">
          <section className="surface weakness-card"><div className="weakness-heading"><span className="attention-icon" aria-hidden="true">!</span><div><p className="overline">Focus next</p><h3>{analysis.weakest.label}</h3></div></div><p>{analysis.drill}</p><div className="missing-cues"><span>Still implicit</span><div><SignalChips signals={analysis.weakest.missingSignals.slice(0, 5)} empty="No declared cues missing" /></div></div></section>
          <section className="surface judge-preview"><p className="overline">Likely judge question</p><blockquote>{analysis.judgeQuestion}</blockquote>{questionSourceFilename && <p className="question-source-evidence">Grounded in your private source: <strong>{questionSourceFilename}</strong></p>}<button className="button button-primary button-full" type="button" onClick={() => setStage('defend')}>Practise my answer <span aria-hidden="true">→</span></button></section>
        </div>
        <section className="surface evidence-section">
          <div className="section-title-row"><div><p className="overline">Rubric evidence map</p><h2>What your transcript actually supports</h2></div><div className="delivery-context"><span>{analysis.delivery.wordsPerMinute} WPM · {analysis.delivery.pace}</span><span>{analysis.delivery.fillerCount} potential fillers</span></div></div>
          <div className="evidence-list">{analysis.criteria.map((criterion) => {
            const found = Boolean(criterion.excerpt);
            const reuse = reusedCitations.find((item) => item.criterionIds.includes(criterion.id));
            const reusedWith = reuse
              ? analysis.criteria.filter((item) => item.id !== criterion.id && reuse.criterionIds.includes(item.id)).map((item) => item.label)
              : [];
            const evidenceState = reuse ? 'reused' : found ? 'found' : 'absent';
            return <article className="evidence-item" data-evidence={evidenceState} key={criterion.id}>
              <div className="evidence-topline"><strong>{criterion.label}</strong><span className="evidence-state">{reuse ? 'citation reused' : found ? 'evidence found' : 'no cue matched'}</span></div>
              {found ? <><blockquote className="evidence-quote">{criterion.excerpt}</blockquote><p className="evidence-source">your words, from this attempt</p></> : <p className="evidence-absent">Nothing in this attempt matched the cues for this criterion. <span>Looked for: {criterion.missingSignals.slice(0, 4).join(', ')}.</span></p>}
              {reuse && <p className="citation-reuse-note"><strong>One quote is doing more than one job.</strong> This exact span was also cited for {reusedWith.join(', ')}. Both readings stay visible, but this is not independent evidence for each criterion.</p>}
              <p className="evidence-provenance">{criterionEngines[criterion.id] === 'semantic' ? 'Mapped semantically, then checked against your exact transcript.' : 'Matched by deterministic cue matching, not semantic analysis.'}</p>
              <div className="production-confirm"><span>{found ? `Would an evaluator accept this as covering ${criterion.label}?` : 'Is this evidence gap accurate?'}</span><button aria-label={`Confirm ${criterion.label}`} className={`button button-secondary${confirmations[criterion.id] === true ? ' is-selected' : ''}`} type="button" disabled={confirmationBusy[criterion.id] || confirmations[criterion.id] !== undefined} onClick={() => void confirmEvidence(criterion.id, true)}>Yes</button><button aria-label={`Reject ${criterion.label}`} className={`button button-secondary${confirmations[criterion.id] === false ? ' is-selected' : ''}`} type="button" disabled={confirmationBusy[criterion.id] || confirmations[criterion.id] !== undefined} onClick={() => void confirmEvidence(criterion.id, false)}>No</button>{confirmationNotes[criterion.id] && <small role="status">{confirmationNotes[criterion.id]}</small>}</div>
            </article>;
          })}</div>
        </section>
        <section className="surface delivery-section"><div className="section-title-row"><div><p className="overline">Delivery notes</p><h2>Supporting context</h2></div></div><p className="delivery-boundary">Word-pattern counts from this transcript. This does not change the rubric evidence above.</p><div className="delivery-metrics"><div className="delivery-metric"><strong>{analysis.delivery.wordsPerMinute}</strong><span>words per minute</span></div><div className="delivery-metric"><strong>{analysis.delivery.wordCount}</strong><span>words spoken</span></div><div className="delivery-metric"><strong>{analysis.delivery.fillerCount}</strong><span>potential fillers</span></div></div></section>
        <div className="review-actions"><button className="button button-secondary" type="button" onClick={() => setStage('attempt')}>Revise transcript</button><button className="button button-secondary" type="button" onClick={saveSession}>Save without Q&amp;A</button></div>
      </section>}

      {stage === 'defend' && analysis && <section className="practice-stage is-visible"><div className="defense-layout">
        <section className="judge-room"><div className="judge-room-topline"><div className="judge-profile"><span className="judge-avatar" aria-hidden="true">J</span><span><strong>Competition evaluator</strong><small>Questioning <b>{analysis.weakest.label}</b></small></span></div><span className="live-chip"><i /> Q&amp;A drill</span></div><blockquote>{analysis.judgeQuestion}</blockquote>{questionSourceFilename && <p className="question-source-evidence">Grounded in your private source: <strong>{questionSourceFilename}</strong></p>}<p>Answer directly. Name the mechanism, comparison, or proof the rubric expects.</p></section>
        <div className="defense-workspace"><section className="surface answer-panel"><label htmlFor="defenseAnswer">Your answer</label><textarea id="defenseAnswer" rows={10} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Start with a direct answer..." />{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary button-full" type="button" disabled={busy} onClick={() => void runDefense()}>{busy ? 'Checking only this answer…' : 'Check this answer'} <span aria-hidden="true">→</span></button></section>
          <section className="surface defense-feedback" aria-live="polite">{defense ? <div><div className="verdict-row"><div><p className="overline">Answer coverage</p><h3>{defense.status}</h3></div><strong>{defense.score}%</strong></div><p>{defense.feedback}</p><div className="signal-review"><div><span>Made explicit</span><div><SignalChips signals={defense.matchedSignals} empty="No declared cues yet" /></div></div><div><span>Still missing</span><div><SignalChips signals={defense.missingSignals} empty="No declared cues missing" /></div></div></div><div className="follow-up"><span>The judge pushes once more</span><p>{defense.followUp}</p></div><button className="button button-primary button-full" type="button" onClick={saveSession}>Save this session <span aria-hidden="true">✓</span></button></div> : <div className="feedback-empty"><img className="mascot-guide" src={logo.src} alt="" /><h3>Say it in your own words.</h3><p>This check uses only the answer above, never the original pitch.</p></div>}</section>
        </div><button className="text-button back-review" type="button" onClick={() => setStage('review')}>← Back to attempt review</button>
      </div></section>}
    </section>
  );
}
