export type SpeechRecognitionState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'stopping'
  | 'error'
  | 'unsupported'
  | 'disposed';

export interface SpeechTranscriptSnapshot {
  finalTranscript: string;
  interimTranscript: string;
  transcript: string;
}

export interface SpeechRecognitionFailure {
  code: string;
  message: string;
  fatal: boolean;
}

export interface SpeechRecognitionSessionOptions {
  language?: string;
  autoRestart?: boolean;
  restartDelayMs?: number;
  onTranscript?: (snapshot: SpeechTranscriptSnapshot) => void;
  onStateChange?: (state: SpeechRecognitionState) => void;
  onError?: (failure: SpeechRecognitionFailure) => void;
}

export interface SpeechRecognitionSession {
  readonly supported: boolean;
  readonly state: SpeechRecognitionState;
  readonly language: string;
  start(options?: { resetTranscript?: boolean }): boolean;
  stop(): Promise<SpeechTranscriptSnapshot>;
  abort(): void;
  clearTranscript(): void;
  setLanguage(language: string): void;
  snapshot(): SpeechTranscriptSnapshot;
  dispose(): void;
}

interface RecognitionAlternativeLike {
  readonly transcript: string;
}

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternativeLike;
}

interface RecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: RecognitionResultLike;
}

interface RecognitionEventLike extends Event {
  readonly results: RecognitionResultListLike;
}

interface RecognitionErrorEventLike extends Event {
  readonly error?: string;
  readonly message?: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface BrowserSpeechRecognitionConstructor {
  new(): BrowserSpeechRecognition;
}

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

const FATAL_ERRORS = new Set([
  'audio-capture',
  'language-not-supported',
  'not-allowed',
  'service-not-allowed',
]);

function constructorFromBrowser(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function cleanTranscript(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(' ').replace(/\s+/gu, ' ');
}

function failureFor(event: RecognitionErrorEventLike): SpeechRecognitionFailure {
  const code = event.error?.trim() || 'recognition-error';
  const fatal = FATAL_ERRORS.has(code);
  const fallbacks: Record<string, string> = {
    'aborted': 'Speech recognition was stopped.',
    'audio-capture': 'No working microphone was available for speech recognition.',
    'language-not-supported': 'This browser does not support the selected dictation language.',
    'network': 'Speech recognition lost its network service.',
    'no-speech': 'No speech was detected. You can keep trying or type the transcript.',
    'not-allowed': 'Microphone access was not allowed.',
    'service-not-allowed': 'This browser blocked its speech-recognition service.',
  };
  return {
    code,
    message: event.message?.trim() || fallbacks[code] || 'Speech recognition stopped unexpectedly.',
    fatal,
  };
}

export function speechRecognitionIsSupported(): boolean {
  return constructorFromBrowser() !== null;
}

export function createSpeechRecognitionSession(
  options: SpeechRecognitionSessionOptions = {},
): SpeechRecognitionSession {
  const Constructor = constructorFromBrowser();
  const recognition = Constructor ? new Constructor() : null;
  let currentState: SpeechRecognitionState = recognition ? 'idle' : 'unsupported';
  let language = options.language?.trim() || 'id-ID';
  let wanted = false;
  let restartAfterEnd = false;
  let nativeActive = false;
  let startRequested = false;
  let disposed = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let settledTranscript = '';
  let runFinalTranscript = '';
  let interimTranscript = '';
  let stopWaiters: Array<{
    resolve: (snapshot: SpeechTranscriptSnapshot) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  const autoRestart = options.autoRestart ?? true;
  const restartDelayMs = Math.max(0, options.restartDelayMs ?? 250);

  function setState(next: SpeechRecognitionState) {
    if (currentState === next) return;
    currentState = next;
    options.onStateChange?.(next);
  }

  function snapshot(): SpeechTranscriptSnapshot {
    const finalTranscript = cleanTranscript(settledTranscript, runFinalTranscript);
    return {
      finalTranscript,
      interimTranscript,
      transcript: cleanTranscript(finalTranscript, interimTranscript),
    };
  }

  function emitTranscript() {
    options.onTranscript?.(snapshot());
  }

  function clearRestartTimer() {
    if (restartTimer === null) return;
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  function resolveStopWaiters() {
    const completed = snapshot();
    for (const waiter of stopWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(completed);
    }
    stopWaiters = [];
  }

  function startNative(): boolean {
    if (!recognition || disposed || !wanted || nativeActive || startRequested) return false;
    clearRestartTimer();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    startRequested = true;
    setState('starting');
    try {
      recognition.start();
      return true;
    } catch (error) {
      startRequested = false;
      wanted = false;
      const message = error instanceof Error ? error.message : 'Speech recognition could not start.';
      setState('error');
      options.onError?.({ code: 'start-failed', message, fatal: true });
      return false;
    }
  }

  if (recognition) {
    recognition.onstart = () => {
      if (disposed) return;
      startRequested = false;
      nativeActive = true;
      if (!wanted) {
        setState('stopping');
        try { recognition.stop(); } catch { /* onend will settle local state. */ }
        return;
      }
      setState('listening');
    };

    recognition.onresult = (event) => {
      if (disposed) return;
      const finalParts: string[] = [];
      const interimParts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim();
        if (!transcript) continue;
        if (result?.isFinal) finalParts.push(transcript);
        else interimParts.push(transcript);
      }
      runFinalTranscript = cleanTranscript(...finalParts);
      interimTranscript = cleanTranscript(...interimParts);
      emitTranscript();
    };

    recognition.onerror = (event) => {
      if (disposed) return;
      if (event.error === 'aborted' && !wanted) return;
      const failure = failureFor(event);
      if (failure.fatal) {
        wanted = false;
        restartAfterEnd = false;
      }
      setState('error');
      options.onError?.(failure);
    };

    recognition.onend = () => {
      startRequested = false;
      nativeActive = false;
      settledTranscript = cleanTranscript(settledTranscript, runFinalTranscript);
      runFinalTranscript = '';
      interimTranscript = '';
      emitTranscript();
      resolveStopWaiters();

      if (disposed) return;
      if (wanted && (autoRestart || restartAfterEnd)) {
        restartAfterEnd = false;
        restartTimer = setTimeout(() => {
          restartTimer = null;
          startNative();
        }, restartDelayMs);
      } else {
        wanted = false;
        setState('idle');
      }
    };
  }

  return {
    supported: recognition !== null,
    get state() { return currentState; },
    get language() { return language; },
    start({ resetTranscript = true } = {}) {
      if (!recognition || disposed) {
        if (!disposed) setState('unsupported');
        return false;
      }
      if (wanted || nativeActive || startRequested) return true;
      if (resetTranscript) {
        settledTranscript = '';
        runFinalTranscript = '';
        interimTranscript = '';
        emitTranscript();
      }
      wanted = true;
      restartAfterEnd = false;
      return startNative();
    },
    async stop() {
      if (!recognition || disposed) return snapshot();
      wanted = false;
      restartAfterEnd = false;
      clearRestartTimer();
      if (!nativeActive && !startRequested) {
        setState('idle');
        return snapshot();
      }
      setState('stopping');
      const completion = new Promise<SpeechTranscriptSnapshot>((resolve) => {
        const timer = setTimeout(() => {
          stopWaiters = stopWaiters.filter((waiter) => waiter.resolve !== resolve);
          try { recognition.abort(); } catch { /* Native capture is already inactive. */ }
          nativeActive = false;
          startRequested = false;
          setState('idle');
          resolve(snapshot());
        }, 1_200);
        stopWaiters.push({ resolve, timer });
      });
      try {
        recognition.stop();
      } catch {
        nativeActive = false;
        startRequested = false;
        setState('idle');
        resolveStopWaiters();
      }
      return completion;
    },
    abort() {
      if (!recognition || disposed) return;
      wanted = false;
      restartAfterEnd = false;
      clearRestartTimer();
      interimTranscript = '';
      try {
        recognition.abort();
      } catch {
        // It is already inactive; local state is still cleaned up below.
      }
      nativeActive = false;
      startRequested = false;
      emitTranscript();
      setState('idle');
      resolveStopWaiters();
    },
    clearTranscript() {
      settledTranscript = '';
      runFinalTranscript = '';
      interimTranscript = '';
      emitTranscript();
    },
    setLanguage(nextLanguage) {
      const normalized = nextLanguage.trim();
      if (!normalized || normalized === language || disposed) return;
      language = normalized;
      if (!recognition) return;
      recognition.lang = language;
      if (nativeActive || startRequested) {
        restartAfterEnd = true;
        setState('stopping');
        try {
          // Keep `wanted` true: onend restarts with the new language.
          recognition.stop();
        } catch {
          nativeActive = false;
          startRequested = false;
          startNative();
        }
      }
    },
    snapshot,
    dispose() {
      if (disposed) return;
      wanted = false;
      restartAfterEnd = false;
      clearRestartTimer();
      disposed = true;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // A disposed recognizer may already be inactive.
        }
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
      }
      nativeActive = false;
      startRequested = false;
      resolveStopWaiters();
      setState('disposed');
    },
  };
}
