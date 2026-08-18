'use client';

import { useTranslations } from 'next-intl';

import type { InputQualityVerdict } from '@/lib/rehearsal/input-quality';

/**
 * Owns the `micQuality` namespace so multimodal-studio does not have to adopt
 * one before its own turn to be translated. Same reason useMetricLabel lives
 * in delivery-charts.
 */
const TITLES: Record<string, string> = {
  silent: 'silentTitle',
  clipping: 'clippingTitle',
  'noisy-floor': 'noisyFloorTitle',
  'too-quiet': 'tooQuietTitle',
};

const BODIES: Record<string, string> = {
  silent: 'silentBody',
  clipping: 'clippingBody',
  'noisy-floor': 'noisyFloorBody',
  'too-quiet': 'tooQuietBody',
};

/**
 * Warns; never blocks. A booth operator mid-demo must not be stopped by a
 * threshold, and the honest limit of the measurement is stated with it (INV-4):
 * this reads levels, so it cannot see echo.
 */
export function InputQualityNotice({
  verdict,
}: Readonly<{ verdict: InputQualityVerdict | null }>) {
  const t = useTranslations('micQuality');
  if (!verdict?.actionable) return null;
  const title = TITLES[verdict.code];
  const body = BODIES[verdict.code];
  if (!title || !body) return null;

  return <div className="input-quality-notice" role="status" data-quality={verdict.code}>
    <strong>{t(title)}</strong>
    <p>{t(body)}</p>
    <small>{t('boundary')} {t('typedFallback')}</small>
  </div>;
}

/**
 * Shown after capture, not during: a count of passages the recognizer guessed
 * at. The text is kept — the student may well have said it — but they are told
 * to look before it can become a cited span, because INV-3 renders a citation
 * as their own words in a blockquote.
 */
export function GuessedPassageNotice({ count }: Readonly<{ count: number }>) {
  const t = useTranslations('micQuality');
  if (count <= 0) return null;
  return <div className="input-quality-notice" role="status" data-quality="guessed">
    <strong>{t('guessedTitle')}</strong>
    <p>{t('guessedBody', { count })}</p>
  </div>;
}
