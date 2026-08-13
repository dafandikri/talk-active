import type { InterviewLanguage } from '../interview-session.ts';

export type QuestionSpeechOutcome = 'ended' | 'unavailable' | 'error';

export function questionSpeechIsSupported(): boolean {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof SpeechSynthesisUtterance !== 'undefined';
}

function preferredVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: InterviewLanguage,
): SpeechSynthesisVoice | undefined {
  const exact = voices.find((voice) => voice.lang.toLocaleLowerCase() === language.toLocaleLowerCase());
  if (exact) return exact;
  const prefix = language.slice(0, 2).toLocaleLowerCase();
  return voices.find((voice) => voice.lang.toLocaleLowerCase().startsWith(prefix));
}

export function cancelQuestionSpeech(): void {
  if (!questionSpeechIsSupported()) return;
  window.speechSynthesis.cancel();
}

export function speakQuestionAloud(
  text: string,
  language: InterviewLanguage,
): Promise<QuestionSpeechOutcome> {
  if (!questionSpeechIsSupported()) return Promise.resolve('unavailable');
  const synthesis = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.voice = preferredVoice(synthesis.getVoices(), language) ?? null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: QuestionSpeechOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    utterance.onend = () => finish('ended');
    utterance.onerror = () => finish('error');
    synthesis.cancel();
    synthesis.speak(utterance);
  });
}
