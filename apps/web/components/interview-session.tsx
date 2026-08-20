'use client';

import { useTranslations } from 'next-intl';

import { useEffect, useRef, useState } from 'react';

import katoQuestioning from '../../../src/assets/mascot/kato-macaw-questioning.svg';
import { analyzeSpeech } from '@/lib/analyzer';
import { jsonRequest, requestContract } from '@/lib/api/client';
import {
  CONTRACT_VERSION,
  InterviewAnalysisResponseSchema,
  type InterviewAnalysisResponse,
} from '@/lib/contracts';
import {
  MAX_INTERVIEW_TURNS,
  aggregateInterviewAnswers,
  aggregateInterviewDuration,
  createInterviewPlan,
  nextInterviewQuestion,
  validateInterviewJudgment,
  validateInterviewTurnDraft,
  type InterviewJudgment,
  type InterviewLanguage,
  type InterviewQuestion,
  type InterviewTurn,
  type InterviewTurnDraft,
} from '@/lib/interview-session';
import {
  cancelQuestionSpeech,
  questionSpeechIsSupported,
  speakQuestionAloud,
} from '@/lib/rehearsal/question-speech';
import { rubricTextFromCriteria, type StoredRubricCriterion } from '@/lib/rubric-storage';
import {
  MultimodalStudio,
  type MultimodalAttemptResult,
  type MultimodalSessionState,
  type MultimodalStudioHandle,
} from './multimodal-studio';

export interface InterviewCompletion {
  readonly turns: readonly InterviewTurn[];
  readonly transcript: string;
  readonly durationSeconds: number;
  readonly multimodalResult: MultimodalAttemptResult | null;
  readonly hardestQuestion: InterviewAnalysisResponse['hardestQuestion'];
  readonly mode: InterviewAnalysisResponse['mode'];
}

interface InterviewSessionProps {
  readonly criteria: readonly StoredRubricCriterion[];
  readonly language: InterviewLanguage;
  readonly semanticAvailable: boolean;
  readonly finishing?: boolean;
  readonly durableRecordingAvailable?: boolean;
  readonly onCaptureBusyChange?: (busy: boolean) => void;
  readonly onComplete: (completion: InterviewCompletion) => void | Promise<void>;
}

const IDLE_SESSION: MultimodalSessionState = {
  active: false,
  transitionBusy: false,
  answerCapturePaused: false,
  sessionStartedAtMs: null,
  elapsedMs: 0,
};

type Translate = (key: string) => string;

// Module-level helpers cannot hold the hook, so they take the translator.
function verdictLabel(verdict: InterviewJudgment['verdict'], t: Translate): string {
  if (verdict === 'supported') return t('evidenceCovered');
  if (verdict === 'partial') return t('partialEvidence');
  return t('evidenceMissing');
}

function formatTimeline(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function criterionPayload(criterion: StoredRubricCriterion) {
  return {
    id: criterion.id,
    rubricId: 'interview-analysis',
    name: criterion.name,
    description: criterion.description,
    requiredEvidence: criterion.requiredEvidence,
    displayOrder: criterion.displayOrder,
  };
}

function joinReviewedTurns(
  drafts: readonly InterviewTurnDraft[],
  response: InterviewAnalysisResponse,
  t: Translate,
): InterviewTurn[] {
  const byId = new Map(response.turns.map((result) => [result.turnId, result]));
  return drafts.map((draft) => {
    const reviewed = byId.get(draft.id);
    if (!reviewed || reviewed.criterionId !== draft.question.criterion.id) {
      throw new Error(t('reviewIncomplete'));
    }
    return {
      ...draft,
      judgment: validateInterviewJudgment(reviewed.judgment),
    };
  });
}

function localInterviewAnalysis(
  drafts: readonly InterviewTurnDraft[],
  language: InterviewLanguage,
  t: Translate,
): InterviewAnalysisResponse {
  const reviewed = drafts.map((draft) => {
    const analysis = analyzeSpeech({
      transcript: draft.answer,
      durationSeconds: draft.durationSeconds,
      rubricText: rubricTextFromCriteria([draft.question.criterion]),
      language,
    });
    const evidence = analysis.criteria[0];
    if (!evidence) throw new Error(t('noCriterionEvidence'));
    const hasCitation = Boolean(evidence.excerpt.trim());
    const verdict = evidence.missingSignals.length === 0 && hasCitation
      ? 'supported' as const
      : evidence.matchedSignals.length > 0 && hasCitation ? 'partial' as const : 'unsupported' as const;
    const missingEvidence = verdict === 'supported'
      ? []
      : evidence.missingSignals.length > 0
        ? evidence.missingSignals
        : draft.question.criterion.requiredEvidence.length > 0
          ? draft.question.criterion.requiredEvidence
          : [draft.question.criterion.description || draft.question.criterion.name];
    return {
      turnId: draft.id,
      criterionId: draft.question.criterion.id,
      judgment: {
        verdict,
        coverageScore: verdict === 'supported' ? 1 as const : verdict === 'partial' ? 0.5 as const : 0 as const,
        citedSpan: verdict === 'unsupported' ? null : evidence.excerpt,
        missingEvidence,
        engine: 'deterministic' as const,
        degradedReason: t('semanticFailed'),
      },
      questionText: analysis.judgeQuestion,
    };
  });
  const weakest = reviewed.reduce((selected, item) => (
    item.judgment.coverageScore < selected.judgment.coverageScore ? item : selected
  ));
  return {
    contractVersion: CONTRACT_VERSION,
    turns: reviewed.map(({ questionText: _questionText, ...item }) => item),
    hardestQuestion: {
      criterionId: weakest.criterionId,
      questionText: weakest.questionText,
      engine: 'deterministic',
    },
    mode: 'deterministic',
  };
}

export function InterviewSession({
  criteria,
  language,
  semanticAvailable,
  finishing = false,
  durableRecordingAvailable = false,
  onCaptureBusyChange,
  onComplete,
}: InterviewSessionProps) {
  const t = useTranslations('interviewSession');
  // Freeze rubric order and language at the start. A late project-recovery
  // response must not replace the question under an answer already in flight.
  const [plan] = useState(() => createInterviewPlan(criteria, language));
  const [currentQuestion, setCurrentQuestion] = useState<InterviewQuestion>(() => plan[0]!);
  const [drafts, setDrafts] = useState<InterviewTurnDraft[]>([]);
  const [answer, setAnswer] = useState('');
  const [answerDuration, setAnswerDuration] = useState(45);
  const [answerStartMs, setAnswerStartMs] = useState<number | null>(null);
  const [session, setSession] = useState<MultimodalSessionState>(IDLE_SESSION);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [narrating, setNarrating] = useState(false);
  const [narrationAvailable, setNarrationAvailable] = useState(false);
  const studioRef = useRef<MultimodalStudioHandle>(null);
  const narrationTokenRef = useRef(0);
  const questionRef = useRef<HTMLQuoteElement>(null);
  const previousQuestionIdRef = useRef(currentQuestion.id);

  useEffect(() => {
    setNarrationAvailable(questionSpeechIsSupported());
    return () => cancelQuestionSpeech();
  }, []);

  useEffect(() => {
    if (previousQuestionIdRef.current === currentQuestion.id) return;
    previousQuestionIdRef.current = currentQuestion.id;
    // The answer controls can sit several screens below the next question.
    // Bring the changed prompt back into view before focusing it so both
    // sighted and screen-reader users arrive at the same announced content.
    const frame = window.requestAnimationFrame(() => {
      questionRef.current?.scrollIntoView({ block: 'center' });
      questionRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentQuestion.id]);

  function stopNarration(): void {
    narrationTokenRef.current += 1;
    cancelQuestionSpeech();
    setNarrating(false);
  }

  async function readQuestion(): Promise<void> {
    if (session.active && !session.answerCapturePaused) {
      setError(t('pauseFirst'));
      return;
    }
    cancelQuestionSpeech();
    const token = narrationTokenRef.current + 1;
    narrationTokenRef.current = token;
    setNarrating(true);
    const outcome = await speakQuestionAloud(currentQuestion.text, language);
    if (narrationTokenRef.current !== token) return;
    setNarrating(false);
    if (outcome === 'error') {
      setError(t('narrationStopped'));
    }
  }

  async function beginAnswer(): Promise<void> {
    if (!studioRef.current || !session.active || session.transitionBusy) return;
    stopNarration();
    setError('');
    try {
      const checkpoint = await studioRef.current.resumeAnswerCapture({ resetTranscript: true });
      setAnswer('');
      setAnswerStartMs(checkpoint.elapsedMs);
    } catch {
      setError(t('captureFailed'));
    }
  }

  function buildDraft(normalizedAnswer: string, answerEndMs: number): InterviewTurnDraft {
    const durationSeconds = Math.max(1, Math.min(600, Math.round(
      session.active && answerStartMs !== null
        ? (answerEndMs - answerStartMs) / 1_000
        : Number.isFinite(answerDuration) ? answerDuration : 45,
    )));
    const endMs = Math.max(1, Math.round(answerEndMs));
    const startMs = Math.min(
      endMs - 1,
      Math.max(0, Math.round(answerStartMs ?? drafts.at(-1)?.answerEndMs ?? 0)),
    );
    return validateInterviewTurnDraft({
      id: `${currentQuestion.id}:${drafts.length + 1}`,
      question: currentQuestion,
      answer: normalizedAnswer,
      durationSeconds,
      answerStartMs: startMs,
      answerEndMs: endMs,
    });
  }

  async function checkpointAnswer(): Promise<void> {
    if (submitting || session.transitionBusy || narrating) return;
    setError('');
    try {
      let answerEndMs = session.active
        ? studioRef.current?.getSessionState().elapsedMs ?? session.elapsedMs
        : (drafts.at(-1)?.answerEndMs ?? 0) + Math.max(1, answerDuration) * 1_000;
      let normalizedAnswer = answer.trim();
      if (session.active && !session.answerCapturePaused) {
        const checkpoint = await studioRef.current?.pauseAnswerCapture();
        if (checkpoint) {
          answerEndMs = checkpoint.elapsedMs;
          normalizedAnswer = checkpoint.transcript.trim() || normalizedAnswer;
        }
      }
      if (!normalizedAnswer) throw new Error(t('emptyAnswer'));

      const draft = buildDraft(normalizedAnswer, answerEndMs);
      const completedDrafts = [...drafts, draft];
      const next = nextInterviewQuestion(plan, currentQuestion);
      if (next) {
        setDrafts(completedDrafts);
        setCurrentQuestion(next);
        setAnswer('');
        setAnswerDuration(45);
        setAnswerStartMs(null);
        return;
      }
      await finishInterview(completedDrafts);
    } catch {
      setError(t('answerNotSaved'));
    }
  }

  async function finishInterview(completedDrafts: readonly InterviewTurnDraft[]): Promise<void> {
    setSubmitting(true);
    setError('');
    try {
      const transcript = aggregateInterviewAnswers(completedDrafts);
      const durationSeconds = aggregateInterviewDuration(completedDrafts);
      let multimodalResult: MultimodalAttemptResult | null = null;
      if (session.active) {
        try {
          multimodalResult = await studioRef.current?.stop({
            transcriptOverride: transcript,
            answerDurationSeconds: durationSeconds,
          }) ?? null;
        } catch {
          // Media is supporting context. A recorder or local-model failure must
          // never prevent the answer-only rubric review from completing.
          multimodalResult = null;
        }
      }
      const payload = {
        turns: completedDrafts.map((turn) => ({
          turnId: turn.id,
          criterion: criterionPayload(turn.question.criterion),
          answer: turn.answer,
          durationSeconds: turn.durationSeconds,
          answerStartMs: turn.answerStartMs,
          answerEndMs: turn.answerEndMs,
        })),
        // Kato asked in this language; the review has to answer in it too.
        language,
      };
      let response: InterviewAnalysisResponse;
      if (semanticAvailable) {
        try {
          response = await requestContract(
            '/api/interview/analyze',
            InterviewAnalysisResponseSchema,
            jsonRequest('POST', payload),
          );
        } catch {
          response = localInterviewAnalysis(completedDrafts, language, t);
        }
      } else {
        response = localInterviewAnalysis(completedDrafts, language, t);
      }
      const turns = joinReviewedTurns(completedDrafts, response, t);
      await onComplete({
        turns,
        transcript,
        durationSeconds,
        multimodalResult,
        hardestQuestion: response.hardestQuestion,
        mode: response.mode,
      });
    } catch {
      setError(t('reviewFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const answerActive = session.active && !session.answerCapturePaused;
  const finalQuestion = currentQuestion.primaryIndex === plan.length - 1;

  return <section className="interview-session" aria-labelledby="interviewQuestionTitle">
    <div className="interview-session-head">
      <div><p className="overline">{t('format')}</p><h2 data-stage-heading tabIndex={-1}>{t('heading')}</h2><p>{t('answersSavedLocally', { count: plan.length })}</p></div>
      <span>{t('savedProgress', { saved: drafts.length, total: plan.length })}</span>
    </div>

    <ol className="interview-progress" aria-label={t('progress')}>
      {plan.map((question, index) => {
        const passed = currentQuestion.primaryIndex > index;
        return <li aria-current={!passed && currentQuestion.primaryIndex === index ? 'step' : undefined} className={passed ? 'is-complete' : currentQuestion.primaryIndex === index ? 'is-active' : ''} key={question.id}><i /> <span>{question.criterion.name}</span></li>;
      })}
    </ol>

    <div className="interview-workspace">
      <section className="surface kato-question-card">
        <img src={katoQuestioning.src} alt="" />
        <div className="kato-question-copy">
          <p className="overline">{t('questionPosition', { current: currentQuestion.primaryIndex + 1, total: plan.length })}</p>
          <h3 id="interviewQuestionTitle">{t('katoAsks')}</h3>
          <blockquote
            ref={questionRef}
            tabIndex={-1}
            lang={language}
            aria-label={t('questionLabel', { current: currentQuestion.primaryIndex + 1, total: plan.length, question: currentQuestion.text })}
          >{currentQuestion.text}</blockquote>
          <div className="kato-speech-controls">
            {narrationAvailable ? narrating
              ? <button className="button button-secondary" type="button" onClick={stopNarration}>{t('skipNarration')}</button>
              : <button className="button button-secondary" type="button" disabled={answerActive || session.transitionBusy} onClick={() => void readQuestion()}>{t('readAloud')}</button>
              : <span>{t('narrationUnavailable')}</span>}
          </div>
        </div>
      </section>

      <section className="surface interview-answer-panel">
        <div className="interview-capture-state">
          <strong>{session.active ? t('oneContinuous') : t('manualAnswers')}</strong>
          <span>{session.active ? t('capturePosition', { time: formatTimeline(session.elapsedMs), state: answerActive ? t('answerWindowActive') : t('betweenAnswers') }) : t('startOrType')}</span>
        </div>
        {session.active && !answerActive && <button className="button button-secondary button-full" type="button" disabled={narrating || session.transitionBusy} onClick={() => void beginAnswer()}>{t('beginAnswer')}</button>}
        <label htmlFor="interviewAnswer">{t('yourAnswer')}</label>
        <textarea id="interviewAnswer" rows={8} maxLength={12_000} value={answer} disabled={session.active && !answerActive} onChange={(event) => setAnswer(event.target.value)} placeholder={session.active && !answerActive ? t('waitPlaceholder') : t('answerPlaceholder')} />
        {!session.active && <div className="interview-answer-meta"><label htmlFor="interviewAnswerDuration">{t('answerDuration')}</label><input id="interviewAnswerDuration" type="number" min="1" max="600" value={answerDuration} onChange={(event) => setAnswerDuration(Number(event.target.value))} /><span>{t('seconds')}</span></div>}
        <section className="interview-observation-panel" aria-label={t('optionalCapture')}>
          <MultimodalStudio
            ref={studioRef}
            transcript={answer}
            language={language}
            durableRecordingAvailable={durableRecordingAvailable}
            fixedMode="interview"
            title={t('captureOnce')}
            description={t('captureBoundary')}
            startLabel={t('startCapture')}
            startDisabled={narrating || drafts.length > 0 || Boolean(answer.trim())}
            startDisabledReason={narrating
              ? t('waitForKato')
              : t('captureRequired')}
            startWithAnswerCapturePaused
            hideStopControl
            onTranscriptChange={setAnswer}
            onResult={() => { /* The immutable final stop result is returned through the handle. */ }}
            onBusyChange={onCaptureBusyChange}
            onSessionStateChange={setSession}
          />
        </section>
        {session.active && <p className="interview-capture-note" role="status">{t('pausedBoundary')}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-full" type="button" disabled={submitting || finishing || session.transitionBusy || narrating || !answer.trim()} aria-busy={submitting || finishing} onClick={() => void checkpointAnswer()}>{submitting || finishing ? t('reviewing') : finalQuestion ? t('submit') : t('saveNext')} <span aria-hidden="true">→</span></button>
        <p className="interview-live-boundary">{t('modelBoundary')}</p>
        {!semanticAvailable && <p className="interview-live-boundary">{t('semanticUnavailable')}</p>}
      </section>
    </div>
    <span className="sr-only">{t('cappedAtFixedQuestions', { max: MAX_INTERVIEW_TURNS })}</span>
  </section>;
}
