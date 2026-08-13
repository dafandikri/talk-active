import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancelQuestionSpeech,
  questionSpeechIsSupported,
  speakQuestionAloud,
} from '../apps/web/lib/rehearsal/question-speech.ts';

class FakeUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  voice = null;
  onend = null;
  onerror = null;

  constructor(text) {
    this.text = text;
  }
}

class FakeSynthesis {
  voices = [];
  spoken = [];
  cancelCount = 0;
  listeners = new Set();
  throwOnSpeak = false;
  speechOutcome = 'ended';

  constructor(voices = []) {
    this.voices = voices;
  }

  getVoices() {
    return this.voices;
  }

  cancel() {
    this.cancelCount += 1;
  }

  speak(utterance) {
    if (this.throwOnSpeak) throw new Error('synthetic speaker failure');
    this.spoken.push(utterance);
    if (this.speechOutcome === 'never') return;
    queueMicrotask(() => {
      if (this.speechOutcome === 'error') utterance.onerror?.();
      else utterance.onend?.();
    });
  }

  addEventListener(type, listener) {
    if (type === 'voiceschanged') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'voiceschanged') this.listeners.delete(listener);
  }

  emitVoicesChanged() {
    for (const listener of [...this.listeners]) listener();
  }
}

function voice(name, lang, options = {}) {
  return {
    name,
    lang,
    voiceURI: options.voiceURI ?? `${name}:${lang}`,
    default: options.default ?? false,
    localService: options.localService ?? false,
  };
}

function installSpeech(context, synthesis, Utterance = FakeUtterance) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousUtterance = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { speechSynthesis: synthesis },
  });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: Utterance,
  });
  context.after(() => {
    cancelQuestionSpeech();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousUtterance) Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', previousUtterance);
    else Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
  });
}

test('support detection requires the complete synthesis surface', async (context) => {
  installSpeech(context, { getVoices() { return []; } });

  assert.equal(questionSpeechIsSupported(), false);
  assert.equal(await speakQuestionAloud('Visible question', 'en-US'), 'unavailable');
  assert.doesNotThrow(() => cancelQuestionSpeech());
});

test('an exact canonical BCP-47 match outranks a polished prefix match', async (context) => {
  const polishedBritishVoice = voice('Premium Natural English', 'en-GB', {
    default: true,
    localService: true,
  });
  const exactAmericanVoice = voice('System voice', 'en_US');
  const synthesis = new FakeSynthesis([polishedBritishVoice, exactAmericanVoice]);
  installSpeech(context, synthesis);

  assert.equal(await speakQuestionAloud('How does your evidence support the claim?', 'en-US'), 'ended');
  assert.equal(synthesis.spoken.length, 1);
  assert.equal(synthesis.spoken[0].voice, exactAmericanVoice);
  assert.equal(synthesis.spoken[0].lang, 'en-US');
  assert.equal(synthesis.spoken[0].rate, 0.95);
  assert.equal(synthesis.spoken[0].pitch, 1);
  assert.equal(synthesis.spoken[0].onend, null);
  assert.equal(synthesis.spoken[0].onerror, null);
});

test('matching local quality-labelled voices are preferred without treating labels as guarantees', async (context) => {
  const genericDefault = voice('Suara Sistem', 'id-ID', { default: true });
  const preferred = voice('Damayanti Enhanced', 'id-ID', { localService: true });
  const wrongLanguage = voice('Samantha Premium', 'en-US', { default: true, localService: true });
  const synthesis = new FakeSynthesis([genericDefault, wrongLanguage, preferred]);
  installSpeech(context, synthesis);

  assert.equal(await speakQuestionAloud('Jelaskan bukti yang mendukung klaim ini.', 'id-ID'), 'ended');
  assert.equal(synthesis.spoken[0].voice, preferred);
  assert.equal(synthesis.spoken[0].lang, 'id-ID');
  assert.equal(synthesis.spoken[0].rate, 0.92);
});

// The complaint that started this: Kato read its questions in the flattest
// voice on the machine. On the browsers this runs in, the noticeably more
// natural voices are the off-device ones, and a blanket `localService` bonus
// ranked every one of them below a compact system voice.
test('an off-device voice outranks a compact system voice of the same language', async (context) => {
  const compactSystemVoice = voice('Damayanti', 'id-ID', { default: true, localService: true });
  const naturalNetworkVoice = voice('Google Bahasa Indonesia', 'id-ID');
  const synthesis = new FakeSynthesis([compactSystemVoice, naturalNetworkVoice]);
  installSpeech(context, synthesis);

  assert.equal(await speakQuestionAloud('Apa bukti eksplisitnya?', 'id-ID'), 'ended');
  assert.equal(synthesis.spoken.length, 1);
  assert.equal(synthesis.spoken[0].voice, naturalNetworkVoice);
});

test('a failing off-device voice is spoken again with the best local voice', async (context) => {
  const localFallbackVoice = voice('Samantha', 'en-US', { localService: true });
  const naturalNetworkVoice = voice('Google US English', 'en-US');
  const synthesis = new FakeSynthesis([localFallbackVoice, naturalNetworkVoice]);
  synthesis.speechOutcome = 'error';
  installSpeech(context, synthesis);

  // The network voice fails the way it does with the booth Wi-Fi off, and the
  // question is still asked out loud rather than silently downgraded to text.
  const narration = speakQuestionAloud('What measurement would settle this?', 'en-US');
  await Promise.resolve();
  await Promise.resolve();
  synthesis.speechOutcome = 'ended';

  assert.equal(await narration, 'ended');
  assert.equal(synthesis.spoken.length, 2);
  assert.equal(synthesis.spoken[0].voice, naturalNetworkVoice);
  assert.equal(synthesis.spoken[1].voice, localFallbackVoice);
});

test('a skipped question is never spoken twice by the fallback voice', async (context) => {
  const localFallbackVoice = voice('Samantha', 'en-US', { localService: true });
  const naturalNetworkVoice = voice('Google US English', 'en-US');
  const synthesis = new FakeSynthesis([localFallbackVoice, naturalNetworkVoice]);
  synthesis.speechOutcome = 'never';
  installSpeech(context, synthesis);

  const narration = speakQuestionAloud('Skip me before the fallback runs.', 'en-US');
  await Promise.resolve();
  await Promise.resolve();
  cancelQuestionSpeech();

  assert.equal(await narration, 'error');
  assert.equal(synthesis.spoken.length, 1, 'Skip narration must not start a second utterance');
});

test('late browser voice loading waits for a non-empty voiceschanged result and removes its listener', async (context) => {
  const synthesis = new FakeSynthesis();
  installSpeech(context, synthesis);

  const narration = speakQuestionAloud('Pertanyaan tetap terlihat.', 'id-ID');
  await Promise.resolve();
  assert.equal(synthesis.spoken.length, 0);
  assert.equal(synthesis.listeners.size, 1);

  synthesis.emitVoicesChanged();
  await Promise.resolve();
  assert.equal(synthesis.spoken.length, 0, 'an empty change event must not force the browser default early');

  const loadedVoice = voice('Google Bahasa Indonesia', 'id-ID', { localService: true });
  synthesis.voices = [loadedVoice];
  synthesis.emitVoicesChanged();

  assert.equal(await narration, 'ended');
  assert.equal(synthesis.spoken[0].voice, loadedVoice);
  assert.equal(synthesis.listeners.size, 0);
});

test('cancelling while voices load prevents late narration from crossing the capture gate', async (context) => {
  const synthesis = new FakeSynthesis();
  installSpeech(context, synthesis);

  const narration = speakQuestionAloud('Do not speak after skip.', 'en-US');
  await Promise.resolve();
  cancelQuestionSpeech();
  assert.equal(await narration, 'error');
  assert.equal(synthesis.listeners.size, 0, 'cancellation removes the pending voiceschanged listener');

  synthesis.voices = [voice('Samantha', 'en-US', { localService: true })];
  synthesis.emitVoicesChanged();

  assert.equal(synthesis.spoken.length, 0);
  assert.ok(synthesis.cancelCount >= 2, 'starting and explicitly skipping both clear the synthesis queue');
});

test('never-callback narration has a text-aware watchdog capped at twenty seconds', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const synthesis = new FakeSynthesis([voice('Aria Natural', 'en-US')]);
  synthesis.speechOutcome = 'never';
  installSpeech(context, synthesis);

  const shortNarration = speakQuestionAloud('Why now?', 'en-US');
  await Promise.resolve();
  const shortUtterance = synthesis.spoken[0];
  assert.ok(shortUtterance);

  let shortOutcome;
  void shortNarration.then((outcome) => { shortOutcome = outcome; });
  context.mock.timers.tick(5_999);
  await Promise.resolve();
  assert.equal(shortOutcome, undefined);
  context.mock.timers.tick(1);
  assert.equal(await shortNarration, 'error');
  assert.equal(shortUtterance.onend, null);
  assert.equal(shortUtterance.onerror, null);

  const veryLongQuestion = Array.from(
    { length: 120 },
    (_, index) => `evidence-${index}`,
  ).join(' ');
  const longNarration = speakQuestionAloud(veryLongQuestion, 'en-US');
  await Promise.resolve();
  const longUtterance = synthesis.spoken[1];
  assert.ok(longUtterance);

  let longOutcome;
  void longNarration.then((outcome) => { longOutcome = outcome; });
  context.mock.timers.tick(19_999);
  await Promise.resolve();
  assert.equal(longOutcome, undefined, 'long narration keeps its larger bounded allowance');
  context.mock.timers.tick(1);
  assert.equal(await longNarration, 'error');
  assert.equal(longUtterance.onend, null);
  assert.equal(longUtterance.onerror, null);
  assert.ok(synthesis.cancelCount >= 4, 'each timeout also clears any browser speech still queued');
});

test('explicit cancellation settles never-callback narration and clears its watchdog', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const synthesis = new FakeSynthesis([voice('Damayanti Enhanced', 'id-ID')]);
  synthesis.speechOutcome = 'never';
  installSpeech(context, synthesis);

  const narration = speakQuestionAloud('Pertanyaan ini dibatalkan oleh pengguna.', 'id-ID');
  await Promise.resolve();
  const utterance = synthesis.spoken[0];
  assert.ok(utterance);
  const staleEndListener = utterance.onend;

  cancelQuestionSpeech();
  assert.equal(await narration, 'error');
  assert.equal(utterance.onend, null);
  assert.equal(utterance.onerror, null);
  const cancelCountAfterUserAction = synthesis.cancelCount;

  context.mock.timers.tick(20_000);
  await Promise.resolve();
  assert.equal(
    synthesis.cancelCount,
    cancelCountAfterUserAction,
    'a cleared watchdog cannot cancel synthesis again later',
  );
  staleEndListener?.();
  assert.equal(await narration, 'error', 'a stale browser callback cannot change the outcome');
});

test('browser error callbacks clear narration handlers and the watchdog', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const synthesis = new FakeSynthesis([voice('Aria Natural', 'en-US')]);
  synthesis.speechOutcome = 'error';
  installSpeech(context, synthesis);

  assert.equal(await speakQuestionAloud('Question text', 'en-US'), 'error');
  const utterance = synthesis.spoken[0];
  assert.ok(utterance);
  assert.equal(utterance.onend, null);
  assert.equal(utterance.onerror, null);
  const cancelCountAfterError = synthesis.cancelCount;

  context.mock.timers.tick(20_000);
  await Promise.resolve();
  assert.equal(synthesis.cancelCount, cancelCountAfterError);
});

test('browser synthesis failures stay inside the declared error outcome', async (context) => {
  const synthesis = new FakeSynthesis([voice('Aria Natural', 'en-US')]);
  synthesis.throwOnSpeak = true;
  installSpeech(context, synthesis);

  assert.equal(await speakQuestionAloud('Question text', 'en-US'), 'error');
});
