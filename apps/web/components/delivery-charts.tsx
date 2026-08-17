'use client';

import { useTranslations } from 'next-intl';

import type { DeliveryMetricId, DeliveryMetricResult } from '@/lib/delivery-metrics';
import type { ReadingComponent, RehearsalReading } from '@/lib/rehearsal-reading';

/**
 * Two charts, and a rule they both follow.
 *
 * The rubric evidence hue is reserved (see src/tokens.css). Delivery is
 * supporting context by product invariant, so it never competes with evidence
 * for the eye: substance keeps the one saturated hue and both delivery signals
 * share a single quieter one, separated by label and position rather than by a
 * third colour. Checked with the palette validator — the pair separates at
 * ΔE 18.8 under protanopia, well clear of the 8.0 target.
 */

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Where a value sits on its own axis, as a percentage of the track. */
function axisPosition(value: number, axisMin: number, axisMax: number): number {
  const span = axisMax - axisMin;
  if (span <= 0) return 0;
  return clampPercent(((value - axisMin) / span) * 100);
}

/**
 * Metric ids are kebab-case because they are a stable wire identity; catalogue
 * namespaces are camelCase like every other one. One place converts.
 */
function metricKey(id: DeliveryMetricId): string {
  return id.replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

/**
 * Metric names for callers that show them outside a chart. Exported as a hook
 * rather than a raw string map so the `deliveryMetrics` namespace stays owned
 * by this file — the caller does not adopt it, and can still take a namespace
 * of its own when its turn to be translated comes.
 */
export function useMetricLabel(): (id: DeliveryMetricId) => string {
  const t = useTranslations('deliveryMetrics');
  return (id) => t(`${metricKey(id)}.label`);
}

/**
 * A bullet chart: the configured practice band as a shaded zone, and the
 * observed value as a marker on the same axis.
 *
 * The list this replaces read "Speaking pace … 178 words/min" beside
 * "105–165 words/min practice band". Both numbers were present and the reader
 * still had to do the comparison. Here the answer is the position of the dot,
 * and "how far outside" — the part that tells you whether to slow down a little
 * or a lot — is legible without arithmetic.
 */
export function MetricBand({ metric }: Readonly<{ metric: DeliveryMetricResult }>) {
  const t = useTranslations('deliveryMetrics');
  const key = metricKey(metric.id);
  const { band, observedValue } = metric;
  const label = t(`${key}.label`);
  const unit = t(`${key}.unit`);
  // Units like "% of sampled frames" already begin with their symbol, so the
  // usual separating space produced "0 % of sampled frames".
  const value = observedValue === null
    ? t('notMeasured')
    : `${observedValue}${unit.startsWith('%') ? '' : ' '}${unit}`;
  const target = t(`${key}.${metric.target.variant ?? 'target'}`, metric.target.values);
  const explanation = t(`${key}.${metric.explanation.variant}`, metric.explanation.values);
  const zoneStart = axisPosition(band.targetFrom, band.axisMin, band.axisMax);
  const zoneEnd = axisPosition(band.targetTo, band.axisMin, band.axisMax);
  const inBand = observedValue !== null
    && observedValue >= band.targetFrom
    && observedValue <= band.targetTo;

  const description = observedValue === null
    ? t('absentDescription', { label, explanation })
    : t('bandDescription', {
      label,
      value,
      position: inBand ? t('inside') : t('outside'),
      target,
    });

  return (
    <li className="metric-band" data-measured={observedValue === null ? 'no' : 'yes'}>
      <div className="metric-band-topline">
        <strong>{label}</strong>
        <b className={observedValue === null ? 'is-absent' : undefined}>{value}</b>
      </div>
      {observedValue === null
        ? <p className="metric-band-absent">{explanation}</p>
        : <>
          <div className="metric-band-track" role="img" aria-label={description}>
            <span
              className="metric-band-zone"
              style={{ left: `${zoneStart}%`, width: `${Math.max(zoneEnd - zoneStart, 1)}%` }}
            />
            <span
              className="metric-band-marker"
              data-inside={inBand ? 'yes' : 'no'}
              style={{ left: `${axisPosition(observedValue, band.axisMin, band.axisMax)}%` }}
            />
          </div>
          <p className="metric-band-axis" aria-hidden="true">
            <span>{band.axisMin}</span>
            <span className="metric-band-target">{target}</span>
            <span>{band.axisMax}</span>
          </p>
        </>}
      <small className="metric-band-note">{explanation}</small>
    </li>
  );
}

function ReadingSegment({ component }: Readonly<{ component: ReadingComponent }>) {
  const score = component.score ?? 0;
  // The class names carry the channel, not just the part, because the reserved
  // evidence hue is enforced by matching the selector (test/design-system).
  // Naming the substance block "evidence" is what makes the colour legal — and
  // it is legal because that block genuinely is the rubric evidence reading.
  const channel = component.id === 'substance'
    ? 'reading-segment-evidence'
    : 'reading-segment-delivery';
  return (
    <div
      className={`reading-segment ${channel}`}
      data-part={component.id}
      style={{ width: `${component.weight * 100}%` }}
    >
      <span className="reading-segment-track">
        <span className="reading-segment-fill" style={{ height: `${clampPercent(score)}%` }} />
      </span>
      <span className="reading-segment-label">
        <b>{Math.round(score)}</b>
        <small>{Math.round(component.weight * 100)}% {component.label}</small>
      </span>
    </div>
  );
}

/**
 * The composite figure with its arithmetic drawn instead of asserted.
 *
 * Segment width is the weight each component actually carried; fill height is
 * what it scored. So "the number is low because half of it is rubric substance
 * and the substance reading is thin" is something you see rather than something
 * you work out — and when a signal drops out, the widths visibly change.
 */
export function ReadingComposition({
  reading,
  headingId,
}: Readonly<{ reading: RehearsalReading; headingId: string }>) {
  const included = reading.components.filter((component) => component.weight > 0);
  const summary = included
    .map((component) => `${Math.round(component.weight * 100)} percent ${component.label} scoring ${Math.round(component.score ?? 0)}`)
    .join('; ');

  return (
    <div className="reading-composition">
      <div className="reading-total">
        <strong>{reading.total}</strong>
        <span>/ 100</span>
        <small id={headingId}>this attempt</small>
      </div>
      <div className="reading-bar-wrap">
        <div
          className="reading-bar"
          role="img"
          aria-label={`Composition of the ${reading.total} out of 100 reading: ${summary}.`}
        >
          {included.map((component) => <ReadingSegment component={component} key={component.id} />)}
          {/* Where the composite lands against the blocks it came from. The
              filled area of the bar IS the reading — each block is as wide as
              its weight and as full as its score — so this line is the level
              that area would sit at if it were spread flat. */}
          <span
            className="reading-average"
            aria-hidden="true"
            style={{ top: `calc(var(--reading-track-height) * ${(100 - reading.total) / 100})` }}
          />
        </div>
        <p className="reading-weighting">{reading.weighting}</p>
        {/* An unlabelled reference line is a puzzle. Naming it in place beats
            making the reader infer it (Nielsen: recognition, not recall). */}
        <p className="reading-legend">
          <span className="reading-legend-rule" aria-hidden="true" />
          The dashed line marks {reading.total}, where these blocks average out.
        </p>
        {reading.unmeasured.length > 0 && <ul className="reading-unmeasured">
          {reading.unmeasured.map((entry) => <li key={entry}>Not measured — {entry}</li>)}
        </ul>}
      </div>
    </div>
  );
}
