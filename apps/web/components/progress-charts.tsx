'use client';

import { useLocale, useTranslations } from 'next-intl';

import { HTML_LANG, interfaceLocaleFrom } from '@/i18n/locales';
import type { CriterionTrail } from '@/lib/progress';

/**
 * Progress is a shape, not a list of numbers.
 *
 * Both charts here are SVG with a text equivalent, because the page they live
 * on has to survive a projector, a print stylesheet, and a screen reader. They
 * use `currentColor` throughout so the stylesheet decides the hue in one place
 * and the booth theme inherits it for free.
 */

export interface TrendPoint {
  readonly id: string;
  readonly createdAt: string;
  /** Rubric evidence coverage, 0–100. */
  readonly evidenceScore: number;
}

/** Viewbox units. The chart scales with its container; these set the aspect. */
const TREND_WIDTH = 100;
const TREND_HEIGHT = 34;

function pointsToPath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : index * step;
      const y = height - (Math.min(100, Math.max(0, value)) / 100) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

// Hardcoded 'en' produced "5 Sep" for every reader. The month abbreviation
// differs between the two locales ("Agu" not "Aug"), and a chart axis is
// exactly where an untranslated fragment is easiest to miss.
function dateLabel(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/**
 * Rubric coverage across every saved attempt.
 *
 * The bar chart this replaces set each column's height in raw pixels
 * (`height: score * 2px`), so it had no axis, no baseline, and no way to read a
 * value except by the printed number above it — which made the drawing
 * decorative. A line against a 0–100 axis makes the trend the thing you see.
 */
export function CoverageTrend({
  points,
  labelledBy,
}: Readonly<{ points: readonly TrendPoint[]; labelledBy: string }>) {
  const t = useTranslations('progressCharts');
  const locale = HTML_LANG[interfaceLocaleFrom(useLocale())];
  if (points.length === 0) {
    return <p className="chart-empty">{t('trendEmpty')}</p>;
  }

  const values = points.map((point) => point.evidenceScore);
  const line = pointsToPath(values, TREND_WIDTH, TREND_HEIGHT);
  const area = `${line} L${TREND_WIDTH},${TREND_HEIGHT} L0,${TREND_HEIGHT} Z`;
  const latest = points[points.length - 1];

  return (
    <figure className="coverage-trend">
      <div className="coverage-trend-frame">
        {/* The plot stretches to fill its box, which is right for a path and
            wrong for a dot: a non-uniform viewBox turns every circle into an
            ellipse. So the line lives in SVG and the points are positioned
            over it in percentages, where a circle stays a circle at any width.
            The dots resolve their percentages against this wrapper, which is
            exactly the box the SVG fills — the scale sits in its own grid
            column so it can never shift the two out of alignment. */}
        <div className="coverage-trend-plotwrap">
        <svg
          className="coverage-trend-plot"
          viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={labelledBy}
        >
          {[0, 0.5, 1].map((fraction) => (
            <line
              key={fraction}
              className="coverage-trend-guide"
              x1="0"
              x2={TREND_WIDTH}
              y1={TREND_HEIGHT * fraction}
              y2={TREND_HEIGHT * fraction}
            />
          ))}
          {values.length > 1 && <path className="coverage-trend-area" d={area} />}
          <path className="coverage-trend-line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((point, index) => (
          <span
            key={point.id}
            className="coverage-trend-dot"
            data-cy={(TREND_HEIGHT - (Math.min(100, Math.max(0, point.evidenceScore)) / 100) * TREND_HEIGHT).toFixed(2)}
            title={`${dateLabel(point.createdAt, locale)} · ${point.evidenceScore}%`}
            style={{
              left: points.length === 1 ? '50%' : `${(index / (points.length - 1)) * 100}%`,
              bottom: `${Math.min(100, Math.max(0, point.evidenceScore))}%`,
            }}
          />
        ))}
        </div>
        {/* Without a labelled scale the guides are decoration. */}
        <span className="coverage-trend-scale" aria-hidden="true"><b>100%</b><b>50%</b><b>0</b></span>
      </div>
      <figcaption className="coverage-trend-axis">
        <span>{dateLabel(points[0]?.createdAt ?? '', locale)}</span>
        <span className="coverage-trend-latest">
          <strong>{latest?.evidenceScore ?? 0}%</strong> {t('trendLatest')}
        </span>
        <span>{points.length > 1 ? dateLabel(latest?.createdAt ?? '', locale) : t('trendFirstAttempt')}</span>
      </figcaption>
      <p className="sr-only">
        {t('trendSeries', {
          series: points.map((point, index) => t('trendSeriesItem', {
            index: index + 1,
            date: dateLabel(point.createdAt, locale),
            score: point.evidenceScore,
          })).join('; '),
        })}
      </p>
    </figure>
  );
}

/**
 * A recurring gap, with its direction.
 *
 * "3 of 4 attempts left this implicit" says a criterion is a problem. The line
 * says whether it is becoming less of one, which is the part that tells you
 * whether to change tactics or keep going.
 */
export function CriterionSparkline({ trail }: Readonly<{ trail: CriterionTrail }>) {
  const t = useTranslations('progressCharts');
  const values = trail.points.map((point) => Math.round(point.coverage * 100));
  if (values.length < 2) return null;

  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const movement = last - first;
  const direction = movement > 0 ? 'rising' : movement < 0 ? 'falling' : 'flat';

  return (
    <div className="criterion-spark" data-direction={direction}>
      <span className="criterion-spark-plotwrap">
        <svg
          className="criterion-spark-plot"
          viewBox="0 0 100 22"
          preserveAspectRatio="none"
          role="img"
          aria-label={t('sparkLabel', {
            criterion: trail.criterionName,
            count: values.length,
            values: values.map((value) => `${value}%`).join(', '),
          })}
        >
          <path
            className="criterion-spark-line"
            d={pointsToPath(values, 100, 22)}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Positioned rather than drawn, for the same reason as the trend dots:
            this viewBox is stretched almost four times wider than tall, which
            turns an SVG circle into a lozenge. */}
        <span
          className="criterion-spark-head"
          style={{ bottom: `${Math.min(100, Math.max(0, last))}%` }}
        />
      </span>
      <span className="criterion-spark-read">
        {first}% → {last}%
        <small>
          {direction === 'flat'
            ? t('sparkFlat')
            : t('sparkMoved', {
              movement: `${movement > 0 ? '+' : ''}${movement}`,
              count: values.length,
            })}
        </small>
      </span>
    </div>
  );
}
