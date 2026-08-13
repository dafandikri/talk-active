'use client';

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
  readonly onComplete: (completion: InterviewCompletion) => void | Promise<void>;
}

const IDLE_SESSION: MultimodalSessionState = {
  active: false,
  transitionBusy: false,
  answerCapturePaused: false,
  sessionStartedAtMs: null,
  elapsedMs: 0,
};

function verdictLabel(verdict: InterviewJudgment['verdict']): string {
  if (verdict === 'supported') return 'Evidence covered';
  if (verdict === 'partial') return 'Partial evidence';
  return 'Evidence missing';
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
): InterviewTurn[] {
  const byId = new Map(response.turns.map((result) => [result.turnId, result]));
  return drafts.map((draft) => {
    const reviewed = byId.get(draft.id);
    if (!reviewed || reviewed.criterionId !== draft.question.criterion.id) {
      throw new Error('The final interview review did not map every answer back to its rubric criterion.');
    }
    return {
      ...draft,
      judgment: validateInterviewJudgment(reviewed.judgment),
    };
  });
}

function localInterviewAnalysis(drafts: readonly InterviewTurnDraft[]): InterviewAnalysisResponse {
  const reviewed = drafts.map((draft) => {
    const analysis = analyzeSpeech({
      transcript: draft.answer,
      durationSeconds: draft.durationSeconds,
      rubricText: rubricTextFromCriteria([draft.question.criterion]),
    });
    const evidence = analysis.criteria[0];
    if (!evidence) throw new Error('The deterministic interview review returned no criterion evidence.');
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
        degradedReason: 'Semantic interview analysis was unavailable.',
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
  onComplete,
}: InterviewSessionProps) {
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

  useEffect(() => {
    setNarrationAvailable(questionSpeechIsSupported());
    return () => cancelQuestionSpeech();
  }, []);

  function stopNarration(): void {
    narrationTokenRef.current += 1;
    cancelQuestionSpeech();
    setNarrating(false);
  }

  async function readQuestion(): Promise<void> {
    if (session.active && !session.answerCapturePaused) {
      setError('Pause the current answer before asking Kato to read the question.');
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
      setError('Question narration stopped unexpectedly. The complete question remains visible as text.');
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Answer capture could not begin.');
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
      if (!normalizedAnswer) throw new Error('Answer this question before continuing.');

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This answer could not be saved.');
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
          response = localInterviewAnalysis(completedDrafts);
        }
      } else {
        response = localInterviewAnalysis(completedDrafts);
      }
      const turns = joinReviewedTurns(completedDrafts, response);
      await onComplete({
        turns,
        transcript,
        durationSeconds,
        multimodalResult,
        hardestQuestion: response.hardestQuestion,
        mode: response.mode,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The final interview review could not be completed.');
    } finally {
      setSubmitting(false);
    }
  }

  const answerActive = session.active && !session.answerCapturePaused;
  const finalQuestion = currentQuestion.primaryIndex === plan.length - 1;

  return <section className="interview-session" aria-labelledby="interviewQuestionTitle">
    <div className="interview-session-head">
      <div><p className="overline">Kato interview · fixed rubric Q&amp;A</p><h2>Answer one rubric question at a time.</h2><p>Each answer is saved locally and the next question appears immediately. One final submit reviews all {plan.length} answers without mixing their evidence.</p></div>
      <span>{drafts.length} of {plan.length} saved</span>
    </div>

    <ol className="interview-progress" aria-label="Interview progress">
      {plan.map((question, index) => {
        const passed = currentQuestion.primaryIndex > index;
        return <li aria-current={!passed && currentQuestion.primaryIndex === index ? 'step' : undefined} className={passed ? 'is-complete' : currentQuestion.primaryIndex === index ? 'is-active' : ''} key={question.id}><i /> <span>{question.criterion.name}</span></li>;
      })}
    </ol>

    <div className="interview-workspace">
      <section className="surface kato-question-card">
        <img src={katoQuestioning.src} alt="" />
        <div className="kato-question-copy">
          <p className="overline">Question {currentQuestion.primaryIndex + 1} · rubric area {currentQuestion.primaryIndex + 1} of {plan.length}</p>
          <h3 id="interviewQuestionTitle">Kato asks</h3>
          <blockquote>{currentQuestion.text}</blockquote>
          <div className="kato-speech-controls">
            {narrationAvailable ? narrating
              ? <button className="button button-secondary" type="button" onClick={stopNarration}>Skip narration</button>
              : <button className="button button-secondary" type="button" disabled={answerActive || session.transitionBusy} onClick={() => void readQuestion()}>Read question aloud</button>
              : <span>Audio narration is unavailable here; the complete question remains visible.</span>}
          </div>
        </div>
      </section>

      <section className="surface interview-answer-panel">
        <div className="interview-capture-state">
          <strong>{session.active ? 'One continuous capture' : 'Manual answers'}</strong>
          <span>{session.active ? `${formatTimeline(session.elapsedMs)} · ${answerActive ? 'answer window active' : 'between answers'}` : 'Start optional capture below, or type without media.'}</span>
        </div>
        {session.active && !answerActive && <button className="button button-secondary button-full" type="button" disabled={narrating || session.transitionBusy} onClick={() => void beginAnswer()}>Begin this answer</button>}
        <label htmlFor="interviewAnswer">Your answer</label>
        <textarea id="interviewAnswer" rows={8} maxLength={12_000} value={answer} disabled={session.active && !answerActive} onChange={(event) => setAnswer(event.target.value)} placeholder={session.active && !answerActive ? 'Begin this answer after Kato finishes speaking…' : 'Start with a direct answer, then give the evidence and why it matters…'} />
        {!session.active && <div className="interview-answer-meta"><label htmlFor="interviewAnswerDuration">Answer duration</label><input id="interviewAnswerDuration" type="number" min="1" max="600" value={answerDuration} onChange={(event) => setAnswerDuration(Number(event.target.value))} /><span>seconds</span></div>}
        <details className="interview-observation-panel">
          <summary>Camera + voice observations <span>optional · experimental</span></summary>
          <MultimodalStudio
            ref={studioRef}
            transcript={answer}
            durableRecordingAvailable={durableRecordingAvailable}
            fixedMode="interview"
            title="Capture the complete interview once."
            description="Camera and an optional replay share one timeline. Dictation and acoustic observations run only inside answer windows, never while Kato narrates."
            startLabel="Start continuous interview capture"
            startDisabled={narrating || drafts.length > 0 || Boolean(answer.trim())}
            startDisabledReason={narrating
              ? 'Wait for Kato to finish'
              : 'Continuous capture must start before the first answer'}
            startWithAnswerCapturePaused
            hideStopControl
            onTranscriptChange={setAnswer}
            onResult={() => { /* The immutable final stop result is returned through the handle. */ }}
            onSessionStateChange={setSession}
          />
        </details>
        {session.active && <p className="interview-capture-note" role="status">Camera and the optional replay remain active between questions. Answer text and voice observations are paused while Kato speaks.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-full" type="button" disabled={submitting || finishing || session.transitionBusy || narrating || !answer.trim()} aria-busy={submitting || finishing} onClick={() => void checkpointAnswer()}>{submitting || finishing ? 'Reviewing all answers…' : finalQuestion ? 'Submit interview for review' : 'Save answer & next question'} <span aria-hidden="true">→</span></button>
        <p className="interview-live-boundary">No model request runs between questions. Final submit sends each answer only with its paired rubric criterion; Kato&apos;s question text is excluded. Separated turn transcripts and an optional replay remain page-local in this experimental flow; saved progress keeps the aggregate rubric summary.</p>
        {!semanticAvailable && <p className="interview-live-boundary">Semantic evidence mapping is unavailable, so the final batch will use labelled deterministic cue matching.</p>}
      </section>
    </div>
    <span className="sr-only">The interview is capped at {MAX_INTERVIEW_TURNS} fixed questions.</span>
  </section>;
}
