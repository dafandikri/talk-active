import type { ProjectLanguage } from '../contracts.ts';

export type QuestionSpeechOutcome = 'ended' | 'unavailable' | 'error';

const VOICE_LOAD_WAIT_MS = 400;
const MIN_SPEECH_WATCHDOG_MS = 6_000;
const MAX_SPEECH_WATCHDOG_MS = 20_000;
const SPEECH_WATCHDOG_PADDING_MS = 3_000;
const SPEECH_WATCHDOG_MS_PER_WORD = 500;
const SPEECH_WATCHDOG_MS_PER_CHARACTER = 45;
const QUALITY_LABEL = /\b(?:enhanced|natural|neural|premium|studio)\b/iu;
const RECOGNIZED_VOICE_NAME = /\b(?:alex|allison|andi(?:ka)?|ardi|aria|ava|damayanti|daniel|gadis|google bahasa indonesia|google us english|guy|jenny|karen|moira|samantha|siri|tessa|tom|zira)\b/iu;

let speechRequest = 0;
let activeSpeechCancellation: (() => void) | undefined;

function cancelActiveSpeech(): void {
  const cancel = activeSpeechCancellation;
  activeSpeechCancellation = undefined;
  cancel?.();
}

function registerActiveSpeechCancellation(cancel: () => void): void {
  activeSpeechCancellation = cancel;
}

function clearActiveSpeechCancellation(cancel: () => void): void {
  if (activeSpeechCancellation === cancel) activeSpeechCancellation = undefined;
}

function safelyCancelSynthesis(synthesis: SpeechSynthesis): boolean {
  try {
    synthesis.cancel();
    return true;
  } catch {
    return false;
  }
}

export function questionSpeechIsSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis?.getVoices === 'function'
    && typeof window.speechSynthesis.cancel === 'function'
    && typeof window.speechSynthesis.speak === 'function'
    && typeof SpeechSynthesisUtterance !== 'undefined';
}

function normalizeLanguageTag(tag: string): string {
  const candidate = tag.trim().replaceAll('_', '-');
  if (!candidate) return '';
  try {
    return Intl.getCanonicalLocales(candidate)[0]?.toLocaleLowerCase() ?? '';
  } catch {
    return candidate.toLocaleLowerCase();
  }
}

function languageMatchScore(voiceLanguage: string, requestedLanguage: ProjectLanguage): number {
  const voice = normalizeLanguageTag(voiceLanguage);
  const requested = normalizeLanguageTag(requestedLanguage);
  if (!voice || !requested) return 0;
  if (voice === requested) return 3;
  if (voice.startsWith(`${requested}-`) || requested.startsWith(`${voice}-`)) return 2;
  return voice.split('-')[0] === requested.split('-')[0] ? 1 : 0;
}

/**
 * Voice names and flags are browser/OS metadata, not a guarantee of audio quality.
 * They are only stable hints for choosing among voices that match the question language.
 *
 * `localService` used to add 200 points, and that quietly picked the worst voice
 * on the machines this runs on: a browser's synthesised voices are the ones that
 * sound synthesised, and the noticeably more natural ones — "Google Bahasa
 * Indonesia", "Google US English" — report `localService === false`. Ranking
 * them below a compact system voice is how Kato ended up sounding like a train
 * announcement. Off-device delivery is now the mild preference and an explicitly
 * quality-labelled voice still outranks it, so a genuinely better local voice
 * keeps its place. Losing the network is handled where it belongs: by speaking
 * again with the best local voice, not by refusing the better one up front.
 */
function voicePreferenceScore(voice: SpeechSynthesisVoice, language: ProjectLanguage): number {
  const languageScore = languageMatchScore(voice.lang, language);
  if (languageScore === 0) return Number.NEGATIVE_INFINITY;

  return languageScore * 10_000
    + (QUALITY_LABEL.test(voice.name) ? 800 : 0)
    + (voice.localService ? 0 : 500)
    + (RECOGNIZED_VOICE_NAME.test(voice.name) ? 400 : 0)
    + (voice.default ? 100 : 0);
}

/** Every voice that can speak this language, best first. */
function rankedVoices(
  voices: readonly SpeechSynthesisVoice[],
  language: ProjectLanguage,
): SpeechSynthesisVoice[] {
  return voices
    .map((voice, index) => ({ voice, index, score: voicePreferenceScore(voice, language) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ voice }) => voice);
}

function availableVoices(synthesis: SpeechSynthesis): readonly SpeechSynthesisVoice[] {
  try {
    return synthesis.getVoices();
  } catch {
    return [];
  }
}

function waitForVoices(synthesis: SpeechSynthesis): Promise<readonly SpeechSynthesisVoice[]> {
  const immediate = availableVoices(synthesis);
  if (immediate.length > 0 || typeof synthesis.addEventListener !== 'function') {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    let settled = false;
    let listening = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (voices: readonly SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      if (listening) {
        try {
          synthesis.removeEventListener('voiceschanged', onVoicesChanged);
        } catch {
          // The voice wait is already complete; a browser cleanup failure must not strand it.
        }
      }
      clearActiveSpeechCancellation(cancelWait);
      resolve(voices);
    };
    const cancelWait = () => finish([]);
    const onVoicesChanged = () => {
      const voices = availableVoices(synthesis);
      if (voices.length > 0) finish(voices);
    };
    timeout = setTimeout(() => finish(availableVoices(synthesis)), VOICE_LOAD_WAIT_MS);
    registerActiveSpeechCancellation(cancelWait);
    listening = true;
    try {
      synthesis.addEventListener('voiceschanged', onVoicesChanged);
    } catch {
      finish(availableVoices(synthesis));
      return;
    }

    // Close the small race where the list loads between the first read and listener setup.
    onVoicesChanged();
  });
}

function speechWatchdogDuration(text: string): number {
  const normalized = text.trim();
  const words = normalized ? normalized.split(/\s+/u).length : 0;
  const characters = [...normalized].length;
  const estimatedSpeechMs = Math.max(
    words * SPEECH_WATCHDOG_MS_PER_WORD,
    characters * SPEECH_WATCHDOG_MS_PER_CHARACTER,
  );

  return Math.min(
    MAX_SPEECH_WATCHDOG_MS,
    Math.max(MIN_SPEECH_WATCHDOG_MS, estimatedSpeechMs + SPEECH_WATCHDOG_PADDING_MS),
  );
}

export function cancelQuestionSpeech(): void {
  speechRequest += 1;
  cancelActiveSpeech();
  if (!questionSpeechIsSupported()) return;
  safelyCancelSynthesis(window.speechSynthesis);
}

/**
 * Why the outcome is finer-grained inside than outside: only a voice that
 * *reported* a failure earns a second attempt. A watchdog expiry and a user
 * skip both look like "error" to the caller, and retrying either one would
 * either double the wait a stuck engine already cost, or speak over somebody
 * who asked for silence.
 */
type SpeechAttemptOutcome = 'ended' | 'failed' | 'stalled' | 'cancelled';

function speakOnce(
  synthesis: SpeechSynthesis,
  text: string,
  language: ProjectLanguage,
  voice: SpeechSynthesisVoice | null,
  request: number,
): Promise<SpeechAttemptOutcome> {
  let utterance: SpeechSynthesisUtterance;
  try {
    utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = language === 'id-ID' ? 0.92 : 0.95;
    utterance.pitch = 1;
    utterance.voice = voice;
  } catch {
    return Promise.resolve('failed');
  }

  return new Promise((resolve) => {
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: SpeechAttemptOutcome) => {
      if (settled) return;
      settled = true;
      if (watchdog !== undefined) clearTimeout(watchdog);
      utterance.onend = null;
      utterance.onerror = null;
      clearActiveSpeechCancellation(cancelCurrent);
      resolve(outcome);
    };
    const cancelCurrent = () => finish('cancelled');
    utterance.onend = () => finish(request === speechRequest ? 'ended' : 'cancelled');
    utterance.onerror = () => finish('failed');
    registerActiveSpeechCancellation(cancelCurrent);
    watchdog = setTimeout(() => {
      finish('stalled');
      safelyCancelSynthesis(synthesis);
    }, speechWatchdogDuration(text));
    try {
      synthesis.speak(utterance);
    } catch {
      finish('failed');
    }
  });
}

export async function speakQuestionAloud(
  text: string,
  language: ProjectLanguage,
): Promise<QuestionSpeechOutcome> {
  if (!questionSpeechIsSupported()) return 'unavailable';
  const synthesis = window.speechSynthesis;
  const request = speechRequest + 1;
  speechRequest = request;
  cancelActiveSpeech();
  if (!safelyCancelSynthesis(synthesis)) return 'error';

  const voices = await waitForVoices(synthesis);
  if (request !== speechRequest) return 'error';

  const ranked = rankedVoices(voices, language);
  const preferred = ranked[0] ?? null;
  const outcome = await speakOnce(synthesis, text, language, preferred, request);
  if (outcome === 'ended') return 'ended';

  // The better voice is usually the one that needs a network, and the booth
  // rehearses with the Wi-Fi off on purpose. When that voice reports a failure
  // — and only then — say the same question again with the best voice that
  // lives on the machine, so losing the network costs quality and not the
  // question.
  const offlineFallback = outcome === 'failed' && preferred && !preferred.localService
    ? ranked.find((candidate) => candidate.localService)
    : undefined;
  if (!offlineFallback || request !== speechRequest) return 'error';

  return await speakOnce(synthesis, text, language, offlineFallback, request) === 'ended'
    ? 'ended'
    : 'error';
}
