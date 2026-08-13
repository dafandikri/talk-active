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
  ClaimCoachResponseSchema,
  ConfirmRubricResponseSchema,
  CreateAttemptResponseSchema,
  CreateProjectResponseSchema,
  CurrentProjectResponseSchema,
  DefenseResponseSchema,
  EvidenceConfirmationResponseSchema,
  EvidenceResponseSchema,
  QuestionResponseSchema,
  SaveAttemptDeliveryReviewResponseSchema,
  SourceDocumentDeleteResponseSchema,
  SourceDocumentUploadResponseSchema,
  StatelessAnalysisResponseSchema,
  StatelessDefenseResponseSchema,
  StatelessRejudgeResponseSchema,
  type RubricSource,
  type Criterion,
  type CriterionCoaching,
  type ReusedCitation,
  type SaveAttemptDeliveryReviewRequest,
  type SourceDocument,
} from '@/lib/contracts';
import {
  appendLocalEvidenceConfirmation,
  rejudgeLocalEvidence,
} from '@/lib/evidence-confirmations';
import { uploadAttemptRecording } from '@/lib/rehearsal/recording-upload';
import { buildRubricTimeline } from '@/lib/rehearsal/rubric-moments';
import { summarizeWordingCues } from '@/lib/rehearsal/wording-cues';
import {
  MultimodalReview,
  MultimodalStudio,
  type MultimodalAttemptResult,
} from '@/components/multimodal-studio';
import { parseSavedSessions, PRODUCTION_SESSIONS_KEY } from '@/lib/progress';
import {
  readRubricSourceType,
  readStoredRubricCriteria,
  RUBRIC_SOURCE_STORAGE_KEY,
  rubricTextFromCriteria,
  type StoredRubricCriterion,
  writeStoredRubricCriteria,
} from '@/lib/rubric-storage';

type Stage = 'setup' | 'attempt' | 'review' | 'defend';

const stageOrder: Stage[] = ['setup', 'attempt', 'review', 'defend'];
const REMOTE_PROJECT_TITLE = 'Talk-Active · RISTEK Finals';

interface RemoteContext {
  projectId: string;
  criteria: Criterion[];
}

function defaultRubricCriteria(): StoredRubricCriterion[] {
  return parseRubric(DEFAULT_RUBRIC).map((criterion, displayOrder) => ({
    id: criterion.id,
    name: criterion.label,
    description: '',
    requiredEvidence: criterion.signals,
    sourceExcerpt: null,
    displayOrder,
  }));
}

function storedRubric(): {
  criteria: StoredRubricCriterion[];
  rubricText: string;
  sourceType: RubricSource;
} {
  const criteria = readStoredRubricCriteria(localStorage) ?? defaultRubricCriteria();
  return {
    criteria,
    rubricText: rubricTextFromCriteria(criteria),
    sourceType: readRubricSourceType(localStorage),
  };
}

// Timestamped observations are saved separately from the replay they came from,
// so deleting the media later leaves the feedback intact.
function deliveryReviewPayload(result: MultimodalAttemptResult): SaveAttemptDeliveryReviewRequest {
  const visual = result.visionSummary;
  return {
    mode: result.mode,
    vocalScore: Math.round(result.metrics.vocal.rehearsalScore ?? 0),
    visualScore: result.metrics.visual?.rehearsalScore === null
      || result.metrics.visual?.rehearsalScore === undefined
      ? null
      : Math.round(result.metrics.visual.rehearsalScore),
    trackingCoveragePercent: visual
      ? Math.round(visual.metrics.trackingCoveragePercent)
      : null,
    fillerCount: result.metrics.fillerCount,
    repeatedWordCount: result.metrics.repeatedWordCount,
    boundary: result.metrics.boundary,
    events: [
      ...(result.speechDisruptions ?? []).map((event) => ({
        source: event.source,
        kind: event.kind,
        startMs: Math.max(0, Math.round(event.startMs)),
        endMs: Math.max(0, Math.round(event.endMs)),
        label: event.label,
        evidence: event.evidence,
      })),
      ...(visual?.events ?? []).map((event) => ({
        source: 'vision' as const,
        kind: event.kind,
        startMs: Math.max(0, Math.round(event.startMs)),
        endMs: Math.max(0, Math.round(event.endMs)),
        label: event.label,
        evidence: 'Derived from on-device camera landmarks; review the surrounding replay before interpreting it.',
      })),
    ],
  };
}

/** The avatar monogram, derived from the title rather than hardcoded to "TA". */
function projectInitials(title: string): string {
  const words = title.split(/[\s·—-]+/u).filter((word) => /^\p{L}/u.test(word));
  const letters = words.slice(0, 2).map((word) => word[0]?.toLocaleUpperCase() ?? '').join('');
  return letters || title.slice(0, 2).toLocaleUpperCase();
}

function SignalChips({ signals, empty }: Readonly<{ signals: string[]; empty: string }>) {
  return <>{signals.length > 0 ? signals.map((signal) => <span className="signal-chip" key={signal}>{signal}</span>) : <span className="signal-chip neutral">{empty}</span>}</>;
}

function defenseResultFromJudgment(
  criterion: AnalysisResult['weakest'],
  judgment: {
    verdict: 'supported' | 'partial' | 'unsupported';
    coverageScore: 0 | 0.5 | 1;
    citedSpan: string | null;
    missingEvidence: string[];
  },
): DefenseResult {
  const status = judgment.verdict === 'supported'
    ? 'defensible' as const
    : judgment.verdict === 'partial' ? 'developing' as const : 'vulnerable' as const;
  const feedback = judgment.verdict === 'supported'
    ? `This answer makes the required “${criterion.label}” evidence explicit.`
    : judgment.verdict === 'partial'
      ? `This answer contains relevant evidence, but ${judgment.missingEvidence.slice(0, 2).join(' and ')} still needs to be explicit.`
      : `This answer does not yet supply explicit evidence for “${criterion.label}”.`;
  const nextGap = judgment.missingEvidence.slice(0, 2).join(' and ')
    || 'the concrete proof behind this claim';
  return {
    score: judgment.coverageScore * 100,
    status,
    criterionId: criterion.id,
    criterionLabel: criterion.label,
    matchedSignals: judgment.citedSpan ? [judgment.citedSpan] : [],
    missingSignals: judgment.missingEvidence,
    feedback,
    followUp: `Can you answer once more and make ${nextGap} explicit?`,
  };
}

function strictLocalAnalysis(result: AnalysisResult): AnalysisResult {
  const criteria = result.criteria.map((criterion) => ({
    ...criterion,
    status: criterion.missingSignals.length === 0
      ? 'covered' as const
      : criterion.matchedSignals.length > 0 ? 'partial' as const : 'missing' as const,
  }));
  const weakest = criteria.find((criterion) => criterion.id === result.weakest.id);
  if (!weakest) throw new Error('The deterministic review returned no weakest criterion.');
  return {
    ...result,
    coveredCount: criteria.filter((criterion) => criterion.status === 'covered').length,
    criteria,
    weakest,
  };
}

function strictLocalDefense(result: DefenseResult): DefenseResult {
  if (result.missingSignals.length === 0) return result;
  if (result.matchedSignals.length === 0) {
    return {
      ...result,
      status: 'vulnerable',
      feedback: `This answer does not yet supply explicit evidence for “${result.criterionLabel}”.`,
      followUp: `Can you answer once more and make ${result.missingSignals.slice(0, 2).join(' and ')} explicit?`,
    };
  }
  return {
    ...result,
    status: 'developing',
    feedback: `This answer contains relevant evidence, but ${result.missingSignals.slice(0, 2).join(' and ')} still needs to be explicit.`,
    followUp: `Can you answer once more and make ${result.missingSignals.slice(0, 2).join(' and ')} explicit?`,
  };
}

export function PracticeRoom() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('setup');
  const [transcript, setTranscript] = useState(STARTER_DRAFT);
  const [duration, setDuration] = useState(90);
  // The limit a presenter rehearses against, which is a different fact from
  // `duration` above — that one is how long the take actually ran, and it is
  // what the pace reading divides by. Zero means no limit.
  const [targetMinutes, setTargetMinutes] = useState(7);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [answer, setAnswer] = useState('');
  const [defense, setDefense] = useState<DefenseResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [persistence, setPersistence] = useState<'local' | 'neon'>('local');
  const [sourceDocumentsAvailable, setSourceDocumentsAvailable] = useState(false);
  const [statelessSemanticAvailable, setStatelessSemanticAvailable] = useState(false);
  const [semanticDefenseAvailable, setSemanticDefenseAvailable] = useState(false);
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocument[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceStatus, setSourceStatus] = useState('');
  const [questionSourceFilename, setQuestionSourceFilename] = useState<string | null>(null);
  const [rubricCriteria, setRubricCriteria] = useState<StoredRubricCriterion[]>(defaultRubricCriteria);
  const [rubricText, setRubricText] = useState(DEFAULT_RUBRIC);
  const [rubricSourceType, setRubricSourceType] = useState<RubricSource>('manual');
  const [remoteContext, setRemoteContext] = useState<RemoteContext | null>(null);
  // The project's own name, once the workspace tells us what it is. Three
  // places on this screen used to print a title that was compiled into the
  // page, so a user practising against their own rubric was told they were
  // rehearsing for somebody else's competition.
  const [projectTitle, setProjectTitle] = useState(REMOTE_PROJECT_TITLE);
  const [remoteAttemptId, setRemoteAttemptId] = useState<string | null>(null);
  const [engineNote, setEngineNote] = useState('Evidence mapped by deterministic cue matching on this device.');
  const [defenseEngineNote, setDefenseEngineNote] = useState('');
  const [criterionEngines, setCriterionEngines] = useState<Record<string, 'semantic' | 'deterministic'>>({});
  const [reusedCitations, setReusedCitations] = useState<ReusedCitation[]>([]);
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});
  const [confirmationBusy, setConfirmationBusy] = useState<Record<string, boolean>>({});
  const [confirmationNotes, setConfirmationNotes] = useState<Record<string, string>>({});
  const [reviewId, setReviewId] = useState('');
  const [inputMethod, setInputMethod] = useState<'transcript' | 'observations'>('transcript');
  const [studioBusy, setStudioBusy] = useState(false);
  const [multimodalResult, setMultimodalResult] = useState<MultimodalAttemptResult | null>(null);
  const [recordingsAvailable, setRecordingsAvailable] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('');
  const [observationNote, setObservationNote] = useState('');
  const [retakeCriterion, setRetakeCriterion] = useState<{ criterionId: string; label: string } | null>(null);
  const [retakeDraft, setRetakeDraft] = useState('');
  const [retakeBusy, setRetakeBusy] = useState(false);
  const [coachings, setCoachings] = useState<Record<string, CriterionCoaching>>({});
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachNote, setCoachNote] = useState('');
  const rubric = useMemo(() => parseRubric(rubricText), [rubricText]);
  const targetDurationMs = targetMinutes > 0 ? targetMinutes * 60_000 : null;
  // Where each criterion's cited span sits in the attempt. The verdicts were
  // grounded against this same transcript, and a capture is detached the
  // moment the transcript is edited, so these offsets cannot drift.
  const rubricTimeline = useMemo(() => {
    if (!analysis || !multimodalResult) return undefined;
    return buildRubricTimeline(
      analysis.criteria.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        citedSpan: criterion.excerpt || null,
        reused: reusedCitations.some((item) => item.criterionIds.includes(criterion.id)),
      })),
      multimodalResult.transcript,
      multimodalResult.transcriptTimingPoints,
    );
  }, [analysis, multimodalResult, reusedCitations]);
  // Words that invite a follow-up, counted on this device from the student's
  // own transcript. No model is involved, so this cannot fail on stage.
  const wordingCues = useMemo(() => summarizeWordingCues(transcript), [transcript]);

  useEffect(() => {
    let cancelled = false;
    const stored = storedRubric();
    setRubricCriteria(stored.criteria);
    setRubricText(stored.rubricText);
    setRubricSourceType(stored.sourceType);
    void requestContract('/api/capabilities', CapabilitiesResponseSchema)
      .then(async (capabilities) => {
        if (cancelled) return;
        setPersistence(capabilities.persistence);
        setSourceDocumentsAvailable(capabilities.sourceDocuments);
        setRecordingsAvailable(capabilities.recordings);
        setStatelessSemanticAvailable(
          capabilities.semantic.evidence || capabilities.semantic.question,
        );
        setSemanticDefenseAvailable(capabilities.semantic.defense);
        if (capabilities.persistence !== 'neon') return;

        // Recovering a saved project is optional and must not revoke what the
        // server just reported it can do. Sharing one catch with the capability
        // probe meant a single failed recovery silently downgraded the session
        // to local and hid source attachments, with nothing said about why.
        try {
          const recovered = await requestContract(
            '/api/projects/current',
            CurrentProjectResponseSchema,
          );
          if (cancelled || !recovered.current?.rubric?.confirmedAt) return;
          const criteria = recovered.current.criteria.map((criterion) => ({
            id: criterion.id,
            name: criterion.name,
            description: criterion.description,
            requiredEvidence: criterion.requiredEvidence,
            sourceExcerpt: null,
            displayOrder: criterion.displayOrder,
          }));
          if (criteria.length === 0) return;
          setRemoteContext({
            projectId: recovered.current.project.id,
            criteria: recovered.current.criteria,
          });
          setProjectTitle(recovered.current.project.title);
          setSourceDocuments(recovered.current.sourceDocuments);
          const recoveredRubricText = rubricTextFromCriteria(criteria);
          const localRubricText = rubricTextFromCriteria(stored.criteria);
          setRubricCriteria(criteria);
          setRubricText(recoveredRubricText);
          setRubricSourceType(recovered.current.rubric.sourceType);
          writeStoredRubricCriteria(localStorage, criteria);
          localStorage.setItem(
            RUBRIC_SOURCE_STORAGE_KEY,
            recovered.current.rubric.sourceType,
          );
          if (localRubricText !== recoveredRubricText) {
            setSourceStatus(
              'This signed-in project already has a confirmed rubric. Its saved criteria were restored; browser-only rubric edits do not replace a synced project rubric.',
            );
          }
        } catch {
          if (cancelled) return;
          setSourceStatus(
            'Your saved project could not be restored just now, so this attempt uses the rubric stored in this browser. Nothing saved on the server has been changed.',
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPersistence('local');
        setSourceDocumentsAvailable(false);
        setRecordingsAvailable(false);
        setStatelessSemanticAvailable(false);
        setSemanticDefenseAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Observations save first and separately, so a replay upload that fails does
  // not take the timestamped feedback down with it. Neither step can change a
  // rubric verdict; both report what happened rather than failing silently.
  async function syncMultimodalAttempt(attemptId: string, result: MultimodalAttemptResult) {
    setRecordingStatus('Saving timestamped delivery observations…');
    try {
      await requestContract(
        `/api/attempts/${attemptId}/review`,
        SaveAttemptDeliveryReviewResponseSchema,
        jsonRequest('POST', deliveryReviewPayload(result)),
      );
    } catch (caught) {
      setRecordingStatus(result.recording
        ? `Replay is available in this page but was not synced. Download it before leaving. ${caught instanceof Error ? caught.message : ''}`.trim()
        : `Delivery observations were not synced. ${caught instanceof Error ? caught.message : ''}`.trim());
      return;
    }

    if (!result.recording) {
      setRecordingStatus('Timestamped delivery observations were saved with this attempt. No replay was recorded.');
      return;
    }
    if (!recordingsAvailable) {
      setRecordingStatus('Timestamped observations were saved. This replay stays in this page only; download it before leaving.');
      return;
    }

    setRecordingStatus('Uploading the private replay… Keep this review open until it finishes.');
    try {
      await uploadAttemptRecording(attemptId, result.recording, {
        onProgress: (percentage) => setRecordingStatus(`Uploading the private replay… ${Math.round(percentage)}%`),
      });
      setRecordingStatus('Private replay saved. It is now available from attempt history and can be deleted without deleting feedback.');
    } catch (caught) {
      setRecordingStatus(`The timestamped observations were saved, but the replay upload failed. Download this page copy before leaving. ${caught instanceof Error ? caught.message : ''}`.trim());
    }
  }

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
        criteria: rubricCriteria.map((criterion) => ({
          name: criterion.name,
          description: criterion.description,
          requiredEvidence: criterion.requiredEvidence,
          displayOrder: criterion.displayOrder,
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
    setDefense(null);
    setDefenseEngineNote('');
    // Coaching describes the transcript that produced it; a fresh review has
    // a fresh transcript, so keeping the old reading would attribute claims to
    // words that are no longer there.
    setCoachings({});
    setCoachNote('');
    setReviewId(crypto.randomUUID());
    setQuestionSourceFilename(null);
    try {
      const localResult = strictLocalAnalysis(
        analyzeSpeech({ transcript, rubricText, durationSeconds: duration }),
      );
      const localReusedCitations = detectReusedCitations(localResult.criteria.map((criterion) => ({
        criterionId: criterion.id,
        citedSpan: criterion.excerpt || null,
      })));
      const localEngines = Object.fromEntries(
        localResult.criteria.map((criterion) => [criterion.id, 'deterministic' as const]),
      );
      if (persistence === 'local') {
        if (statelessSemanticAvailable) {
          try {
            const response = await requestContract(
              '/api/analyze',
              StatelessAnalysisResponseSchema,
              jsonRequest('POST', {
                transcript,
                criteria: rubricCriteria.map((criterion) => ({
                  id: criterion.id,
                  name: criterion.name,
                  description: criterion.description,
                  requiredEvidence: criterion.requiredEvidence,
                  displayOrder: criterion.displayOrder,
                })),
                durationSeconds: duration,
              }),
            );
            setAnalysis(response.analysis);
            setCriterionEngines(Object.fromEntries(
              response.criterionEngines.map((item) => [item.criterionId, item.engine]),
            ));
            setReusedCitations(response.reusedCitations);
            const semanticCount = response.criterionEngines.filter(
              (item) => item.engine === 'semantic',
            ).length;
            const deterministicCount = response.criterionEngines.length - semanticCount;
            const cacheNote = response.cached ? ' This grounded result came from the 24-hour replay cache.' : '';
            setEngineNote(`${semanticCount} of ${response.criterionEngines.length} criteria used semantic mapping; ${deterministicCount} used deterministic fallback. The judge question used ${response.questionEngine} generation. Every displayed citation passed the exact-span check.${cacheNote}`);
          } catch (semanticError) {
            setAnalysis(localResult);
            setCriterionEngines(localEngines);
            setReusedCitations(localReusedCitations);
            setEngineNote(`0 of ${localResult.criteria.length} criteria used semantic mapping. The hosted review was unavailable, so this visible review uses deterministic cue matching on this device. ${semanticError instanceof Error ? semanticError.message : ''}`.trim());
          }
        } else {
          setAnalysis(localResult);
          setCriterionEngines(localEngines);
          setReusedCitations(localReusedCitations);
          setEngineNote(`0 of ${localResult.criteria.length} criteria used semantic mapping. All ${localResult.criteria.length} used deterministic cue matching on this device.`);
        }
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
          const weakest = mappedCriteria.find(
            (criterion) => criterion.id === question.question.targetCriterionId,
          );
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
          if (multimodalResult) {
            void syncMultimodalAttempt(created.attempt.id, multimodalResult);
          }
          const semanticCount = evidence.verdicts.filter((verdict) => verdict.engine === 'semantic').length;
          const deterministicCount = evidence.verdicts.length - semanticCount;
          setEngineNote(`${semanticCount} of ${evidence.verdicts.length} criteria used semantic mapping; ${deterministicCount} used deterministic fallback. Every displayed citation passed the exact-span check.`);
        } catch (remoteError) {
          setAnalysis(localResult);
          setCriterionEngines(localEngines);
          setReusedCitations(localReusedCitations);
          setEngineNote(`0 of ${localResult.criteria.length} criteria used semantic mapping. Hosted persistence was unavailable, so this visible review uses deterministic cue matching locally and was not synced. ${remoteError instanceof Error ? remoteError.message : ''}`.trim());
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
    questionTargetCriterionId?: string,
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
    const refreshedQuestionTargetsWeakest = questionText !== undefined
      && questionTargetCriterionId === weakest.id;
    setAnalysis({
      ...analysis,
      evidenceScore: Math.round(
        mappedCriteria.reduce((sum, criterion) => sum + criterion.score, 0) / mappedCriteria.length,
      ),
      coveredCount: mappedCriteria.filter((criterion) => criterion.status === 'covered').length,
      criteria: mappedCriteria,
      weakest,
      judgeQuestion: refreshedQuestionTargetsWeakest ? questionText : analysis.judgeQuestion,
      drill: refreshedQuestionTargetsWeakest && drillText ? drillText : analysis.drill,
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
            if (question.question.targetCriterionId === criterionId) {
              questionText = question.question.questionText;
            }
            setQuestionSourceFilename(question.sourceDocument?.filename ?? null);
          } catch {
            // The label and replacement verdict are already durable. A stale
            // preview question must not invite a second confirmation/re-judge.
          }
          applyRejudgedCriterion(
            criterionId,
            saved.verdict,
            questionText,
            undefined,
            questionText ? criterionId : undefined,
          );
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
        const originalEngine = criterionEngines[criterionId] ?? 'deterministic';
        let replacement: {
          verdict: 'supported' | 'partial' | 'unsupported';
          coverageScore: 0 | 0.5 | 1;
          citedSpan: string | null;
          missingEvidence: string[];
          engine: 'semantic' | 'deterministic';
        } | null = null;
        let replacementQuestion: string | undefined;
        let replacementQuestionTargetCriterionId: string | undefined;
        let replacementDrill: string | undefined;
        let rejudgeMode: 'semantic' | 'mixed' | 'deterministic' | 'local-fallback' | null = null;

        if (!accepted && statelessSemanticAvailable) {
          const typedCriterion = rubricCriteria.find((item) => item.id === criterionId);
          try {
            const response = await requestContract(
              '/api/rejudge',
              StatelessRejudgeResponseSchema,
              jsonRequest('POST', {
                transcript,
                criterion: {
                  id: criterion.id,
                  rubricId: 'stateless-analysis',
                  name: criterion.label,
                  description: typedCriterion?.description ?? criterion.requirementText,
                  requiredEvidence: typedCriterion?.requiredEvidence ?? criterion.signals,
                  displayOrder: typedCriterion?.displayOrder
                    ?? analysis.criteria.findIndex((item) => item.id === criterionId),
                },
                rejected: {
                  verdict: criterion.status === 'covered'
                    ? 'supported'
                    : criterion.status === 'partial' ? 'partial' : 'unsupported',
                  coverageScore: criterion.status === 'covered'
                    ? 1
                    : criterion.status === 'partial' ? 0.5 : 0,
                  citedSpan: criterion.excerpt || null,
                  missingEvidence: criterion.missingSignals,
                  engine: originalEngine,
                },
              }),
            );
            replacement = response.judgment;
            replacementQuestion = response.questionText;
            replacementQuestionTargetCriterionId = response.questionTargetCriterionId;
            rejudgeMode = response.mode;
          } catch {
            rejudgeMode = 'local-fallback';
          }
        }

        if (!accepted && !replacement) {
          const localRejudge = rejudgeLocalEvidence(transcript, criterion, duration);
          const localVerdict = localRejudge.criterion.missingSignals.length === 0
            ? 'supported' as const
            : localRejudge.criterion.matchedSignals.length > 0
              ? 'partial' as const
              : 'unsupported' as const;
          replacement = {
            verdict: localVerdict,
            coverageScore: localVerdict === 'supported' ? 1 : localVerdict === 'partial' ? 0.5 : 0,
            citedSpan: localVerdict === 'unsupported' ? null : localRejudge.criterion.excerpt || null,
            missingEvidence: localRejudge.criterion.missingSignals,
            engine: 'deterministic',
          };
          replacementQuestion = localRejudge.judgeQuestion;
          replacementQuestionTargetCriterionId = criterionId;
          replacementDrill = localRejudge.drill;
          rejudgeMode ??= 'deterministic';
        }

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
          judgedEngine: originalEngine,
          createdAt,
          rejudgedAt: accepted ? null : createdAt,
        });
        if (replacement) {
          applyRejudgedCriterion(
            criterionId,
            replacement,
            replacementQuestion,
            replacementDrill,
            replacementQuestionTargetCriterionId,
          );
        } else if (accepted && criterion.status !== 'missing') {
          applyRejudgedCriterion(criterionId, {
            verdict: 'supported',
            coverageScore: 1,
            citedSpan: criterion.excerpt || null,
            missingEvidence: [],
            engine: originalEngine,
          });
        }
        setConfirmationNotes((current) => ({
          ...current,
          [criterionId]: accepted
            ? `Saved in this browser as a human evaluation label; the original ${originalEngine} provenance is preserved.`
            : rejudgeMode === 'semantic'
              ? 'Saved in this browser. A one-time semantic re-judge used different grounded evidence and refreshed the question.'
              : rejudgeMode === 'mixed'
                ? 'Saved in this browser. The one-time re-judge used mixed semantic and deterministic units, shown in provenance.'
                : rejudgeMode === 'local-fallback'
                  ? 'Saved in this browser. The hosted re-judge was unavailable, so one visible deterministic fallback ran locally.'
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

  // One pass over every criterion, so each evidence card can say what was
  // asserted for it rather than the review saying one thing about the whole
  // take. A criterion whose coaching fails degrades alone.
  async function runCoach() {
    if (!analysis) return;
    setCoachBusy(true);
    setCoachNote('');
    try {
      const response = await requestContract(
        '/api/coach',
        ClaimCoachResponseSchema,
        jsonRequest('POST', {
          transcript,
          criteria: rubricCriteria.map((criterion) => ({
            id: criterion.id,
            name: criterion.name,
            description: criterion.description,
            requiredEvidence: criterion.requiredEvidence,
            displayOrder: criterion.displayOrder,
          })),
        }),
      );
      setCoachings(Object.fromEntries(
        response.coachings.map((coaching) => [coaching.criterionId, coaching]),
      ));
      const degraded = response.coachings.filter((coaching) => coaching.degradedReason).length;
      setCoachNote(degraded > 0
        ? `${response.coachings.length - degraded} of ${response.coachings.length} criteria were coached in full. The rest say below what was rejected.`
        : `All ${response.coachings.length} criteria were coached. Every quote shown passed the exact-span check.`);
    } catch (caught) {
      setCoachNote(caught instanceof Error
        ? `${caught.message} The rubric verdicts above are unaffected.`
        : 'Claim coaching is unavailable right now. The rubric verdicts above are unaffected.');
    } finally {
      setCoachBusy(false);
    }
  }

  // A criterion with nothing cited does not need another seven minutes. The
  // addition is appended and labelled rather than spliced into the original
  // take: splicing would claim the words were said at a moment they were not,
  // and every timestamp downstream would inherit that claim.
  function beginCriterionRetake(entry: { criterionId: string; label: string }) {
    setRetakeCriterion(entry);
    setInputMethod('transcript');
    setStage('attempt');
    setObservationNote(
      `Recording an addition for “${entry.label}”. It is appended to this attempt and marked as an addition; only that criterion is judged again.`,
    );
  }

  /**
   * Appends the addition, then re-judges only the criterion it was recorded
   * for. Every other verdict keeps the reading it already earned — nobody
   * should have to risk four settled criteria to fix a fifth.
   */
  async function appendRetakeAddition(text: string) {
    const addition = text.trim();
    if (!retakeCriterion || !addition || !analysis) return;
    const target = retakeCriterion;
    const marked = `${transcript.trim()}\n\n[Addition · ${target.label}] ${addition}`;
    setTranscript(marked);
    // The prior capture measured the original take; the transcript is no
    // longer the one it observed, so its sensor summary is detached rather
    // than left to describe words it never heard.
    setMultimodalResult(null);
    setRetakeCriterion(null);
    setRetakeDraft('');
    setRetakeBusy(true);
    setObservationNote(`Re-judging “${target.label}” against the addition. Every other criterion keeps its current verdict.`);

    const criterion = analysis.criteria.find((item) => item.id === target.criterionId);
    const typedCriterion = rubricCriteria.find((item) => item.id === target.criterionId);
    try {
      if (!criterion) throw new Error('That criterion is no longer part of this review.');
      const response = await requestContract(
        '/api/rejudge',
        StatelessRejudgeResponseSchema,
        jsonRequest('POST', {
          transcript: marked,
          criterion: {
            id: criterion.id,
            rubricId: 'stateless-analysis',
            name: criterion.label,
            description: typedCriterion?.description ?? criterion.requirementText,
            requiredEvidence: typedCriterion?.requiredEvidence ?? criterion.signals,
            displayOrder: typedCriterion?.displayOrder
              ?? analysis.criteria.findIndex((item) => item.id === target.criterionId),
          },
          rejected: {
            verdict: criterion.status === 'covered'
              ? 'supported' as const
              : criterion.status === 'partial' ? 'partial' as const : 'unsupported' as const,
            coverageScore: criterion.status === 'covered' ? 1 : criterion.status === 'partial' ? 0.5 : 0,
            citedSpan: criterion.excerpt || null,
            missingEvidence: criterion.missingSignals,
            engine: criterionEngines[target.criterionId] ?? 'deterministic',
          },
        }),
      );
      applyRejudgedCriterion(
        target.criterionId,
        response.judgment,
        response.questionText,
        undefined,
        response.questionTargetCriterionId,
      );
      setObservationNote(
        `“${target.label}” was re-judged against the addition, which stays marked in the transcript. No other criterion was touched.`,
      );
      // Back to the review, because the point of the addition is the verdict
      // it changes — leaving the user on the capture screen hides the result
      // they just worked for.
      setStage('review');
    } catch (caught) {
      // The addition is already in the transcript, so the honest recovery is
      // the full review — not a silent failure that leaves a stale verdict.
      setObservationNote(
        `The addition was appended and marked, but re-judging that criterion alone failed. Use “Review this attempt” to re-judge everything. ${caught instanceof Error ? caught.message : ''}`.trim(),
      );
    } finally {
      setRetakeBusy(false);
    }
  }

  async function runDefense() {
    setBusy(true);
    try {
      if (!analysis) throw new Error('Review an attempt before entering the judge room.');
      const localDefense = strictLocalDefense(
        evaluateDefense({ answer, criterion: analysis.weakest }),
      );
      const typedCriterion = rubricCriteria.find((item) => item.id === analysis.weakest.id);
      const criterion = {
        id: analysis.weakest.id,
        rubricId: 'stateless-analysis',
        name: analysis.weakest.label,
        description: typedCriterion?.description ?? analysis.weakest.requirementText,
        requiredEvidence: typedCriterion?.requiredEvidence ?? analysis.weakest.signals,
        displayOrder: typedCriterion?.displayOrder
          ?? analysis.criteria.findIndex((item) => item.id === analysis.weakest.id),
      };
      if (remoteAttemptId) {
        try {
          const saved = await requestContract(
            `/api/attempts/${remoteAttemptId}/defense`,
            DefenseResponseSchema,
            jsonRequest('POST', { answerText: answer }),
          );
          setDefense(defenseResultFromJudgment(analysis.weakest, saved.verdict));
          setDefenseEngineNote(saved.degraded
            ? 'Saved with a labelled deterministic fallback. Only this answer was evaluated.'
            : 'Saved with semantic evidence mapping. The cited text comes only from this answer.');
        } catch (remoteError) {
          setDefense(localDefense);
          setDefenseEngineNote('Hosted defense evaluation was unavailable. This visible deterministic fallback was not synced.');
          setError(remoteError instanceof Error ? remoteError.message : 'The defense could not be synced.');
          return;
        }
      } else if (semanticDefenseAvailable) {
        try {
          const response = await requestContract(
            '/api/defend',
            StatelessDefenseResponseSchema,
            jsonRequest('POST', { answerText: answer, criterion }),
          );
          setDefense(defenseResultFromJudgment(analysis.weakest, response.judgment));
          setDefenseEngineNote(response.judgment.engine === 'semantic'
            ? 'Mapped semantically against this answer, then grounded to the exact cited span.'
            : `The model path did not return grounded evidence, so this answer uses a labelled deterministic fallback. ${response.judgment.degradedReason ?? ''}`.trim());
        } catch (semanticError) {
          setDefense(localDefense);
          setDefenseEngineNote(`Hosted defense evaluation was unavailable, so this answer uses a visible deterministic fallback. ${semanticError instanceof Error ? semanticError.message : ''}`.trim());
        }
      } else {
        setDefense(localDefense);
        setDefenseEngineNote('Checked by deterministic cue matching because semantic defense evaluation is not configured.');
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
      <header className="page-header compact-header">
        <div className="workflow-heading"><img className="workflow-mark" src={logo.src} alt="" /><div><p className="overline">Practice room</p><h1 id="practiceTitle">Rehearse one attempt at a time.</h1></div></div>
      </header>

      <ol className="practice-steps" aria-label="Practice progress">
        {stageOrder.map((item, index) => {
          const current = stageOrder.indexOf(stage);
          const state = index === current ? ' is-active' : index < current ? ' is-complete' : '';
          // The active step was signalled by a CSS class alone, so which step
          // you were on was visible and not announced. aria-current is how a
          // progress indicator reports status to everyone (Nielsen 1).
          return <li aria-current={index === current ? 'step' : undefined} className={state} key={item}><span>{index + 1}</span>{item === 'setup' ? 'Set up' : item[0]?.toUpperCase() + item.slice(1)}</li>;
        })}
      </ol>

      {stage === 'setup' && <section className="practice-stage is-visible">
        <div className="stage-intro"><p className="overline">Before you begin</p><h2>What are you preparing for?</h2><p>Confirm the project and evaluator rubric. Both stay attached to this session.</p></div>
        <div className="setup-grid">
          <div className="surface setup-form">
            <p className="overline" id="practiceProjectLabel">Project</p>
            <div className="setup-project-summary" aria-labelledby="practiceProjectLabel"><span className="project-avatar" aria-hidden="true">{projectInitials(projectTitle)}</span><div><strong>{projectTitle}</strong><small>7-minute pitch · 3-minute Q&amp;A</small></div></div>
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
            <div className="capture-header"><div><p className="overline">Current attempt</p><h2>{projectTitle}</h2></div><div className="timer">typed</div></div>
            <div className="capture-tabs" role="tablist" aria-label="Practice input method"><button className={inputMethod === 'transcript' ? 'is-active' : ''} type="button" role="tab" aria-selected={inputMethod === 'transcript'} disabled={studioBusy} onClick={() => setInputMethod('transcript')}>Transcript</button><button className={inputMethod === 'observations' ? 'is-active' : ''} type="button" role="tab" aria-selected={inputMethod === 'observations'} disabled={studioBusy} onClick={() => setInputMethod('observations')}><span className="record-dot" />Camera + voice · experimental</button></div>
            {inputMethod === 'observations' && <MultimodalStudio
              transcript={transcript}
              durableRecordingAvailable={recordingsAvailable}
              targetDurationMs={targetDurationMs}
              onTranscriptChange={(value) => {
                setTranscript(value);
                if (multimodalResult && value.trim() !== multimodalResult.transcript.trim()) {
                  setMultimodalResult(null);
                  setObservationNote('The transcript changed, so the prior sensor summary was detached. Capture again to include fresh observations.');
                }
              }}
              onResult={(result) => {
                setMultimodalResult(result);
                if (result) setDuration(Math.max(1, Math.round(result.durationSeconds)));
                setObservationNote(result ? 'Derived sensor summaries are available for this review only.' : '');
              }}
              onBusyChange={setStudioBusy}
            />}
            {retakeCriterion && <section className="criterion-retake-panel" aria-labelledby="retakeDraftTitle">
              <div className="section-title-row">
                <div><p className="overline">Addition in progress</p><h3 id="retakeDraftTitle">{retakeCriterion.label}</h3></div>
                <button className="text-button" type="button" onClick={() => { setRetakeCriterion(null); setRetakeDraft(''); setObservationNote(''); }}>Cancel this addition</button>
              </div>
              <p>Say or type only the passage that proves this criterion. It is appended to the attempt and labelled as an addition — the original take is never rewritten — and only this criterion is judged again.</p>
              <p className="production-field-note">Switch to <strong>Camera + voice</strong> above to dictate it instead of typing; whatever the dictation captures lands in the box below.</p>
              <label className="sr-only" htmlFor="retakeDraft">Addition for {retakeCriterion.label}</label>
              <textarea id="retakeDraft" rows={4} maxLength={2_000} value={retakeDraft} placeholder="Name the number, method, or mechanism this criterion asks for." onChange={(event) => setRetakeDraft(event.target.value)} />
              <button className="button button-primary" type="button" disabled={!retakeDraft.trim() || retakeBusy} aria-busy={retakeBusy} onClick={() => void appendRetakeAddition(retakeDraft)}>{retakeBusy ? 'Re-judging this criterion…' : 'Append and re-judge this criterion'}</button>
            </section>}
            <label className="sr-only" htmlFor="attemptTranscript">Practice transcript</label>
            <textarea id="attemptTranscript" rows={15} maxLength={12_000} value={transcript} onChange={(event) => {
              const value = event.target.value;
              setTranscript(value);
              if (multimodalResult && value.trim() !== multimodalResult.transcript.trim()) {
                setMultimodalResult(null);
                setObservationNote('The transcript changed, so the prior sensor summary was detached. Capture again to include fresh observations.');
              }
            }} />
            {observationNote && <p className="production-field-note" role="status">{observationNote}</p>}
            {sourceDocumentsAvailable && <section className="production-source-attachment" aria-labelledby="sourceAttachmentTitle">
              <div><strong id="sourceAttachmentTitle">Ground the judge question in your material</strong><p>Optional: attach up to three UTF-8 text, Markdown, or JSON files, 40 KB each. Files stay in private project storage.</p></div>
              <div className="production-source-controls"><label className="button button-secondary" htmlFor="practiceSourceFile">Choose source</label><input key={sourceDocuments.length} id="practiceSourceFile" type="file" accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json" onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)} /><span>{sourceFile?.name ?? 'No file chosen'}</span><button className="button button-secondary" type="button" disabled={!sourceFile || sourceBusy || sourceDocuments.length >= 3} onClick={() => void uploadSourceDocument()}>{sourceBusy ? 'Saving…' : 'Attach privately'}</button></div>
              {sourceDocuments.length > 0 && <ul className="production-source-list">{sourceDocuments.map((document) => <li key={document.id}><span><strong>{document.filename}</strong><small>{Math.ceil(document.sizeBytes / 1000)} KB · private</small></span><button className="text-button" type="button" disabled={sourceBusy} onClick={() => void deleteSourceDocument(document)}>Remove</button></li>)}</ul>}
              <p className="production-field-note">When semantic question generation is configured, the weakest criterion and attached text are processed by the configured model provider. Otherwise, Talk-Active selects an exact source sentence deterministically.</p>
              {sourceStatus && <p className="rubric-import-status" role="status">{sourceStatus}</p>}
            </section>}
            <div className="capture-footer">
              <div className="duration-control"><label htmlFor="attemptLimit">Time limit</label><input id="attemptLimit" type="number" min="0" max="60" value={targetMinutes} onChange={(event) => setTargetMinutes(Math.max(0, Math.min(60, Math.round(Number(event.target.value)))))} /><span>minutes — capture stops itself at the bell. 0 removes the limit.</span></div>
              {/* Only meaningful when nothing measured the take for you: a
                  camera capture overwrites this with what it actually ran. */}
              {inputMethod === 'transcript' && <div className="duration-control"><label htmlFor="attemptDuration">Spoken length</label><input id="attemptDuration" type="number" min="1" max="3600" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><span>seconds — used for the pace reading</span></div>}
              <span className="save-state"><span aria-hidden="true">●</span> Local guest draft</span>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary button-full" type="button" disabled={busy || studioBusy} aria-busy={busy || studioBusy} onClick={() => void runAnalysis()}>{studioBusy ? 'Finish local capture first' : busy ? 'Reviewing each criterion…' : 'Review this attempt'} <span aria-hidden="true">→</span></button>
          </div>
          <aside className="session-sidebar">
            {/* The rubric is the target, so it is on screen while the attempt
                runs rather than only in the review that follows. Knowing what
                has to be covered is the difference between rehearsing and
                talking (Nielsen: recognition rather than recall). */}
            <section className="surface attempt-target-card">
              <p className="overline">Cover these before the bell</p>
              <h3>{rubric.length} criteria{targetMinutes > 0 ? ` · ${targetMinutes} min` : ''}</h3>
              <ol className="attempt-target-list">{rubric.map((criterion) => <li key={criterion.id}><i aria-hidden="true" />{criterion.label}</li>)}</ol>
              <p className="trust-note"><span aria-hidden="true">◆</span> {targetMinutes > 0 ? 'The review marks which of these you reached, and when.' : 'Set a time limit to see what an evaluator stopping on time would miss.'}</p>
            </section>
            <section className="surface session-goal"><p className="overline">Session goal</p><h3>Make every important claim defensible.</h3><p>Complete the attempt naturally. The review isolates only the next weakness worth fixing.</p></section><section className="surface privacy-card"><span className="privacy-icon" aria-hidden="true">⌾</span><div><strong>{persistence === 'local' ? 'Session history stays in this browser' : 'Project sync is active on this deployment'}</strong><p>{persistence === 'local' ? (statelessSemanticAvailable ? 'Semantic review sends this transcript and the typed rubric criteria to the configured model provider. Grounded review results may be cached for up to 24 hours. Raw audio is never saved.' : 'Semantic review is off, so this attempt is checked on-device. Raw audio is never saved.') : 'Attempts and private source files are saved to the configured project services. Raw audio is never saved.'}</p></div></section></aside>
        </div>
      </section>}

      {stage === 'review' && analysis && <section className="practice-stage is-visible">
        <div className="review-hero"><div><p className="overline overline-light">Attempt review</p><h2>One claim needs your attention before the judges find it.</h2><p>This result measures explicit rubric evidence in this transcript—not confidence or speaking ability.</p><p className="evidence-analysis-mode"><strong>Analysis provenance</strong><span>{engineNote}</span></p></div><div className="coverage-gauge" style={{ '--gauge': `${analysis.evidenceScore * 3.6}deg` } as React.CSSProperties}><strong>{analysis.evidenceScore}%</strong><span>rubric evidence</span></div></div>
        <div className="review-grid">
          <section className="surface weakness-card"><div className="weakness-heading"><span className="attention-icon" aria-hidden="true">!</span><div><p className="overline">Focus next</p><h3>{analysis.weakest.label}</h3></div></div><p>{analysis.drill}</p><div className="missing-cues"><span>Still implicit</span><div><SignalChips signals={analysis.weakest.missingSignals.slice(0, 5)} empty="No declared cues missing" /></div></div></section>
          <section className="surface judge-preview"><p className="overline">Likely judge question</p><blockquote>{analysis.judgeQuestion}</blockquote>{questionSourceFilename && <p className="question-source-evidence">Grounded in your private source: <strong>{questionSourceFilename}</strong></p>}<button className="button button-primary button-full" type="button" onClick={() => setStage('defend')}>Practise my answer <span aria-hidden="true">→</span></button></section>
        </div>
        <section className="surface evidence-section">
          <div className="section-title-row"><div><p className="overline">Rubric evidence map</p><h2>What your transcript actually supports</h2></div><div className="delivery-context"><span>{analysis.delivery.wordsPerMinute} WPM · {analysis.delivery.pace}</span><span>{analysis.delivery.fillerCount} potential fillers</span></div></div>
          {/* The whole rubric on one line, before the detail.
              With six criteria the list below runs several screens — the quote
              is deliberately the largest text on the page, and that is not
              negotiable — so "how am I doing overall" used to cost a scroll in
              each direction. The map answers it in place, and each cell jumps
              to its own criterion (Nielsen: user control, and recognition over
              recall). Nothing here replaces the evidence; it indexes it. */}
          <ol className="evidence-map" aria-label="Every rubric criterion and whether this attempt cites a transcript span for it">
            {analysis.criteria.map((criterion) => {
              const reuse = reusedCitations.find((item) => item.criterionIds.includes(criterion.id));
              const state = reuse ? 'reused' : criterion.excerpt ? 'found' : 'absent';
              const stateWord = reuse ? 'citation reused' : criterion.excerpt ? 'evidence cited' : 'no evidence cited';
              return <li key={criterion.id}>
                <a href={`#evidence-${criterion.id}`} data-evidence={state} title={`${criterion.label} — ${stateWord}`}>
                  <span className="evidence-map-mark" aria-hidden="true" />
                  <span className="evidence-map-label">{criterion.label}</span>
                  <span className="sr-only">{stateWord}</span>
                </a>
              </li>;
            })}
          </ol>
          {/* "4 of 4 cite a span" is true and still misleading when two of them
              cite the SAME span. The per-criterion cards already disclose reuse;
              a summary line that hides it would undo that at a glance, which is
              the one place a judge actually looks first. */}
          <p className="evidence-map-count">{analysis.criteria.filter((criterion) => criterion.excerpt).length} of {analysis.criteria.length} criteria cite a span from this transcript{reusedCitations.length > 0 ? `, though ${reusedCitations.reduce((total, item) => total + item.criterionIds.length, 0)} of them share a quote` : ''}. Coverage counts cited spans, not quality.</p>
          {/* Said once, before the buttons, rather than after the click. Each
              Yes/No writes a human evaluation label and then locks — an
              irreversible action with no warning is the classic version of this
              mistake, and stating the limit costs one line (Nielsen 5). */}
          {statelessSemanticAvailable && <div className="coach-trigger">
            <div>
              <strong>Break this down criterion by criterion</strong>
              <p>Every criterion gets its own reading: what you asserted for it, which of those assertions you backed with your own words, and a stronger form built only from what you already said.</p>
            </div>
            <button className="button button-secondary" type="button" disabled={coachBusy} aria-busy={coachBusy} onClick={() => void runCoach()}>
              {coachBusy ? 'Reading each criterion…' : Object.keys(coachings).length > 0 ? 'Read them again' : 'Break down each criterion'}
            </button>
          </div>}
          {coachNote && <p className="rubric-import-status" role="status">{coachNote}</p>}
          <p className="evidence-confirm-boundary">Your Yes or No on a criterion is recorded once as your own evaluation label, and cannot be changed afterwards.</p>
          <div className="evidence-list">{analysis.criteria.map((criterion) => {
            const found = Boolean(criterion.excerpt);
            const criterionEngine = criterionEngines[criterion.id] ?? 'deterministic';
            const reuse = reusedCitations.find((item) => item.criterionIds.includes(criterion.id));
            const reusedWith = reuse
              ? analysis.criteria.filter((item) => item.id !== criterion.id && reuse.criterionIds.includes(item.id)).map((item) => item.label)
              : [];
            const evidenceState = reuse ? 'reused' : found ? 'found' : 'absent';
            return <article className="evidence-item" data-evidence={evidenceState} id={`evidence-${criterion.id}`} key={criterion.id}>
              {/* Provenance moved onto the topline as a chip. It was a full
                  sentence on its own line under every criterion — six copies of
                  a fact that does not change between them, each costing a line
                  of the scroll the user complained about.
                  It stays VISIBLE text rather than a tooltip: this is a
                  boundary disclosure, and INV-4 says boundaries are stated, not
                  hidden. A hover title is hidden on every touch screen, which
                  is most of the room. So the wording shortens and the word that
                  carries the limit — "deterministic" — survives verbatim. */}
              <div className="evidence-topline"><strong>{criterion.label}</strong><span className="evidence-meta"><span className="evidence-state">{reuse ? 'citation reused' : found ? criterionEngine === 'semantic' ? 'grounded evidence' : 'cue match' : criterionEngine === 'semantic' ? 'evidence gap' : 'no cue matched'}</span><span className="evidence-provenance">{criterionEngine === 'semantic' ? 'semantic, checked against your transcript' : 'deterministic cue matching, not semantic analysis'}</span></span></div>
              {found ? <blockquote className="evidence-quote"><span className="evidence-quote-text">{criterion.excerpt}</span><cite className="evidence-source">your words, from this attempt</cite></blockquote> : criterionEngine === 'semantic' ? <p className="evidence-absent">The semantic review found no exact passage that supplies this criterion&apos;s required evidence. <span>Still needed: {criterion.missingSignals.slice(0, 4).join(', ')}.</span></p> : <p className="evidence-absent">Nothing in this attempt matched the declared cues for this criterion. <span>Looked for: {criterion.missingSignals.slice(0, 4).join(', ')}.</span></p>}
              {reuse && <p className="citation-reuse-note"><strong>One quote is doing more than one job.</strong> This exact span was also cited for {reusedWith.join(', ')}. Both readings stay visible, but this is not independent evidence for each criterion.</p>}
              {/* Per-criterion coaching. The verdict above says whether this
                  requirement was met; this says what you actually asserted for
                  it, which of those assertions you backed, and what a stronger
                  answer would sound like using only what you already said. */}
              {(() => {
                const coaching = coachings[criterion.id];
                const criterionWording = criterion.excerpt ? summarizeWordingCues(criterion.excerpt) : [];
                if (!coaching && criterionWording.length === 0) return null;
                return <div className="criterion-coaching">
                  {coaching && coaching.claims.length > 0 && <ul className="claim-citation-list">
                    {coaching.claims.map((claim, index) => <li key={index} data-supported={claim.supported}>
                      <q className="claim-quote">{claim.citedSpan}</q>
                      {claim.supported && claim.supportSpan
                        ? <p className="claim-support"><strong>Backed in your own words:</strong> “{claim.supportSpan}”</p>
                        : <p className="claim-gap"><strong>Nothing in this attempt backs it.</strong> An evaluator asks: “{claim.invitedQuestion}”</p>}
                    </li>)}
                  </ul>}
                  {coaching && coaching.claims.length === 0 && !coaching.degradedReason && <p className="criterion-coaching-empty">This attempt asserts nothing about this criterion — there is no claim to back or challenge yet.</p>}
                  {criterionWording.length > 0 && <p className="criterion-wording">
                    <strong>Wording an evaluator will probe:</strong>
                    {criterionWording.slice(0, 3).map((cue) => <span key={cue.label}>“{cue.label}” — {cue.invites}</span>)}
                  </p>}
                  {coaching?.discardedClaims ? <p className="citation-reuse-note"><strong>{coaching.discardedClaims} model reading{coaching.discardedClaims > 1 ? 's were' : ' was'} rejected</strong> because the quote was not a verbatim span of your transcript. Rejected readings are discarded, never repaired.</p> : null}
                  {coaching?.strongerForm && <div className="stronger-form">
                    <p className="overline">A stronger form of this answer</p>
                    <blockquote>{coaching.strongerForm}</blockquote>
                    {coaching.blanks.length > 0 && <div className="stronger-form-blanks"><span>Each blank is data this attempt never stated. Fill it with a number you have — or say the measurement has not been done, which is also an answer.</span><ol>{coaching.blanks.map((blank, index) => <li key={index}>{blank}</li>)}</ol></div>}
                    <p className="evidence-provenance">Rearranged from your own words only. A number absent from your transcript is rejected before this is shown.</p>
                  </div>}
                  {coaching?.degradedReason && <p className="criterion-coaching-note" role="status">{coaching.degradedReason}</p>}
                </div>;
              })()}
              <div className="production-confirm"><span>{found ? 'Would an evaluator accept this?' : 'Is this gap accurate?'}</span><button aria-label={found ? `Confirm that the cited span covers ${criterion.label}` : `Confirm the evidence gap for ${criterion.label}`} className={`button button-secondary${confirmations[criterion.id] === true ? ' is-selected' : ''}`} type="button" disabled={confirmationBusy[criterion.id] || confirmations[criterion.id] !== undefined} onClick={() => void confirmEvidence(criterion.id, true)}>Yes</button><button aria-label={found ? `Reject the cited span for ${criterion.label}` : `Reject the evidence gap for ${criterion.label}`} className={`button button-secondary${confirmations[criterion.id] === false ? ' is-selected' : ''}`} type="button" disabled={confirmationBusy[criterion.id] || confirmations[criterion.id] !== undefined} onClick={() => void confirmEvidence(criterion.id, false)}>No</button>{confirmationNotes[criterion.id] && <small role="status">{confirmationNotes[criterion.id]}</small>}</div>
            </article>;
          })}</div>
        </section>
        <section className="surface delivery-section"><div className="section-title-row"><div><p className="overline">Delivery notes</p><h2>Supporting context</h2></div></div><p className="delivery-boundary">Word-pattern counts from this transcript, and not a measure of speaking ability. This does not change the rubric evidence above.</p><div className="delivery-metrics"><div className="delivery-metric"><strong>{analysis.delivery.wordsPerMinute}</strong><span>words per minute</span></div><div className="delivery-metric"><strong>{analysis.delivery.wordCount}</strong><span>words spoken</span></div><div className="delivery-metric"><strong>{analysis.delivery.fillerCount}</strong><span>potential fillers</span></div></div>
          {/* "7 fillers" is a number nobody can practise against. The words
              themselves are the actionable part, so they are written out. */}
          {analysis.delivery.fillers.length > 0 ? (
            <ul className="delivery-filler-list">
              {analysis.delivery.fillers.map((filler) => (
                <li key={filler.label}><strong>{filler.label}</strong><span>×{filler.count}</span></li>
              ))}
            </ul>
          ) : null}
          {/* Each of these words opens a follow-up question, so the question is
              written out beside it. "3 hedges" is not something anyone can
              practise against; knowing what an evaluator asks next is. */}
          {wordingCues.length > 0 && <div className="wording-cue-block">
            <div className="section-title-row"><div><p className="overline">Wording an evaluator will probe</p><h3>Words that invite the next question</h3></div></div>
            <ul className="wording-cue-list">
              {wordingCues.slice(0, 8).map((cue) => (
                <li key={cue.label} data-cue-kind={cue.kind}>
                  <strong>{cue.label}</strong>
                  <span>×{cue.count}</span>
                  <small>{cue.kind === 'vague-quantity' ? 'an amount nobody can check' : 'a claim weakened before it is challenged'} — invites “{cue.invites}”</small>
                </li>
              ))}
            </ul>
            <p className="metrics-boundary">Counted by exact word matching in this transcript, on this device. Ordinary phrasing can be perfectly fine — the point is knowing which follow-up each word invites before an evaluator asks it.</p>
          </div>}
        </section>
        {multimodalResult && <MultimodalReview
          result={multimodalResult}
          substanceScore={analysis.evidenceScore}
          recordingStatus={recordingStatus}
          savedAttemptId={remoteAttemptId}
          rubricTimeline={rubricTimeline}
          targetDurationMs={targetDurationMs}
          onRetakeCriterion={beginCriterionRetake}
        />}
        <div className="review-actions"><button className="button button-secondary" type="button" onClick={() => setStage('attempt')}>Revise transcript</button><button className="button button-secondary" type="button" onClick={saveSession}>Save without Q&amp;A</button></div>
      </section>}

      {stage === 'defend' && analysis && <section className="practice-stage is-visible"><div className="defense-layout">
        <section className="judge-room"><div className="judge-room-topline"><div className="judge-profile"><span className="judge-avatar" aria-hidden="true">J</span><span><strong>Competition evaluator</strong><small>Questioning <b>{analysis.weakest.label}</b></small></span></div><span className="live-chip"><i /> Q&amp;A drill</span></div><blockquote>{analysis.judgeQuestion}</blockquote>{questionSourceFilename && <p className="question-source-evidence">Grounded in your private source: <strong>{questionSourceFilename}</strong></p>}<p>Answer directly. Name the mechanism, comparison, or proof the rubric expects.</p></section>
        <div className="defense-workspace"><section className="surface answer-panel"><label htmlFor="defenseAnswer">Your answer</label><textarea id="defenseAnswer" rows={10} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Start with a direct answer..." />{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary button-full" type="button" disabled={busy} onClick={() => void runDefense()}>{busy ? 'Checking only this answer…' : 'Check this answer'} <span aria-hidden="true">→</span></button></section>
          <section className="surface defense-feedback" aria-live="polite">{defense ? <div><div className="verdict-row"><div><p className="overline">Answer evidence coverage</p><h3>{defense.status}</h3></div><strong>{defense.score}%</strong></div><p>{defense.feedback}</p>{defenseEngineNote && <p className="evidence-provenance"><strong>Defense provenance:</strong> {defenseEngineNote}</p>}<div className="signal-review"><div><span>Grounded answer evidence</span><div><SignalChips signals={defense.matchedSignals} empty="No grounded answer span yet" /></div></div><div><span>Still missing</span><div><SignalChips signals={defense.missingSignals} empty="No declared cues missing" /></div></div></div><div className="follow-up"><span>The judge pushes once more</span><p>{defense.followUp}</p></div><button className="button button-primary button-full" type="button" onClick={saveSession}>Save this session <span aria-hidden="true">✓</span></button></div> : <div className="feedback-empty"><img className="mascot-guide" src={logo.src} alt="" /><h3>Say it in your own words.</h3><p>This check uses only the answer above, never the original pitch.</p></div>}</section>
        </div><button className="text-button back-review" type="button" onClick={() => setStage('review')}>← Back to attempt review</button>
      </div></section>}
    </section>
  );
}
