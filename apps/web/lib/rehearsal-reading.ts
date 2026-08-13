/**
 * The composition behind the single rehearsal figure.
 *
 * INV-6 (amended 13 August 2026) allows a summary number over one attempt only
 * if it "names its own weighting, shows each component with its evidence, and
 * says what it could not measure, beside the number and not behind a link."
 *
 * The screen used to print "50% rubric substance · 25% vocal · 25% visual" as a
 * fixed sentence while the arithmetic renormalized whatever was missing. With
 * the camera excluded, the vocal reading actually carried half the figure and
 * the caption still said a quarter. The caption was not describing the number
 * beside it — which is the exact failure INV-6 exists to prevent.
 *
 * So the weighting is computed here, from the same inputs that produce the
 * total, and the sentence is generated from the result rather than written by
 * hand.
 */

export type ReadingComponentId = 'substance' | 'vocal' | 'visual';

export interface ReadingComponent {
  readonly id: ReadingComponentId;
  readonly label: string;
  /** 0–100, or null when the signal was not measurable this attempt. */
  readonly score: number | null;
  /** Share of the final figure this component actually carried, 0–1. */
  readonly weight: number;
  /** Share it would have carried had every signal been measurable, 0–1. */
  readonly nominalWeight: number;
  /** Why the component was left out, in the user's words. Null when included. */
  readonly excluded: string | null;
}

export interface RehearsalReading {
  /** The figure shown beside the components, 0–100. */
  readonly total: number;
  readonly components: readonly ReadingComponent[];
  /** The weighting actually applied, ready to print beside the total. */
  readonly weighting: string;
  /** What this attempt could not measure. Empty when everything was measured. */
  readonly unmeasured: readonly string[];
}

export interface RehearsalReadingInput {
  /** Rubric evidence coverage for this attempt, 0–100. */
  readonly substance: number;
  readonly vocal: number | null;
  readonly visual: number | null;
  /** Stated when `visual` is null, so the gap is explained rather than blank. */
  readonly visualExcludedReason?: string;
  readonly vocalExcludedReason?: string;
}

/** Substance is always half. The other half is shared by whatever was measured. */
const SUBSTANCE_WEIGHT = 0.5;
const DELIVERY_WEIGHT = 0.5;

function percentLabel(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

export function summarizeRehearsalReading(input: RehearsalReadingInput): RehearsalReading {
  const delivery = [
    {
      id: 'vocal' as const,
      label: 'vocal signals',
      score: input.vocal,
      excluded: input.vocal === null
        ? input.vocalExcludedReason ?? 'No acoustic or transcript timing was captured.'
        : null,
    },
    {
      id: 'visual' as const,
      label: 'visual signals',
      score: input.visual,
      excluded: input.visual === null
        ? input.visualExcludedReason ?? 'Camera landmarks were not reliable enough to read.'
        : null,
    },
  ];
  const measured = delivery.filter((part) => part.score !== null);

  // With nothing measurable on the delivery side the figure is the substance
  // reading alone. Saying "50% substance" there would be false: it is 100%.
  const substanceWeight = measured.length === 0 ? 1 : SUBSTANCE_WEIGHT;
  const perDeliveryWeight = measured.length === 0 ? 0 : DELIVERY_WEIGHT / measured.length;

  const components: ReadingComponent[] = [
    {
      id: 'substance',
      label: 'rubric substance',
      score: input.substance,
      weight: substanceWeight,
      nominalWeight: SUBSTANCE_WEIGHT,
      excluded: null,
    },
    ...delivery.map((part) => ({
      id: part.id,
      label: part.label,
      score: part.score,
      weight: part.score === null ? 0 : perDeliveryWeight,
      nominalWeight: DELIVERY_WEIGHT / delivery.length,
      excluded: part.excluded,
    })),
  ];

  const total = Math.round(components.reduce(
    (sum, component) => sum + (component.score ?? 0) * component.weight,
    0,
  ));

  const included = components.filter((component) => component.weight > 0);
  const weighting = included
    .map((component) => `${percentLabel(component.weight)} ${component.label}`)
    .join(' · ');
  const unmeasured = components
    .filter((component): component is ReadingComponent & { excluded: string } => component.excluded !== null)
    .map((component) => `${component.label}: ${component.excluded}`);

  return { total, components, weighting, unmeasured };
}
