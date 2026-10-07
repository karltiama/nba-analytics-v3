/**
 * Player-prop clock contract (mirrors lambda/player-props-snapshot/src/observation-clock.ts).
 *
 * CONTROLLER_ENQUEUED_AT  controller intent (raw.player_prop_game_runs.started_at)
 * OBSERVED_AT             response_received_at of the stored provider attempt (canonical)
 * PROVIDER_UPDATED_AT     provider row `updated_at`
 * DATABASE_WRITTEN_AT     Postgres write time
 *
 * Only OBSERVED_AT decides pre/post tip, actual T-minus, decision close, movement order and ledger leakage.
 * Rows written before the observation-clock migration are LEGACY_CONTROLLER_TIME.
 */

export const PROP_CLOCK_RESPONSE_RECEIVED = 'RESPONSE_RECEIVED' as const;
export const PROP_CLOCK_LEGACY_CONTROLLER_TIME = 'LEGACY_CONTROLLER_TIME' as const;
export type PropObservationClockLabel =
  | typeof PROP_CLOCK_RESPONSE_RECEIVED
  | typeof PROP_CLOCK_LEGACY_CONTROLLER_TIME;

type Instant = Date | string | null | undefined;

function ms(value: Instant): number | null {
  if (value == null || value === '') return null;
  const n = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

/** observed_at < tip. observed_at == tip, after tip, or either clock missing → not pre-tip. */
export function isPreTipObservation(observedAt: Instant, tip: Instant): boolean {
  const o = ms(observedAt);
  const t = ms(tip);
  return o != null && t != null && o < t;
}

/** ACTUAL_T_MINUS = tip − observed_at, in minutes. */
export function actualTMinusMinutes(observedAt: Instant, tip: Instant): number | null {
  const o = ms(observedAt);
  const t = ms(tip);
  return o == null || t == null ? null : (t - o) / 60_000;
}

/** INTENDED_T_MINUS = tip − controller_enqueued_at, in minutes. Descriptive only; never decides eligibility. */
export function intendedTMinusMinutes(controllerEnqueuedAt: Instant, tip: Instant): number | null {
  const c = ms(controllerEnqueuedAt);
  const t = ms(tip);
  return c == null || t == null ? null : (t - c) / 60_000;
}

export type PropObservationClocks = {
  controllerEnqueuedAt: Instant;
  observedAt: Instant;
  providerUpdatedAt: Instant;
};

export type PropObservationClassification = {
  clock: PropObservationClockLabel;
  preTip: boolean;
  actualTMinusMinutes: number | null;
  intendedTMinusMinutes: number | null;
};

/**
 * ISO observed_at for leakage checks, or '' when the row has no true observation
 * (legacy controller-time row, missing observed_at, unparseable value). '' is rejected downstream.
 */
export function marketObservedAtIso(row: { observed_at: Instant; observation_clock: string | null }): string {
  if (row.observation_clock !== PROP_CLOCK_RESPONSE_RECEIVED) return '';
  const o = ms(row.observed_at);
  return o == null ? '' : new Date(o).toISOString();
}

/** A row with a RESPONSE_RECEIVED clock but no observed_at fails closed (not pre-tip). */
export function classifyPropObservation(
  clocks: PropObservationClocks & { observationClock: string | null | undefined },
  tip: Instant
): PropObservationClassification {
  const intended = intendedTMinusMinutes(clocks.controllerEnqueuedAt, tip);
  if (clocks.observationClock !== PROP_CLOCK_RESPONSE_RECEIVED) {
    return {
      clock: PROP_CLOCK_LEGACY_CONTROLLER_TIME,
      preTip: false,
      actualTMinusMinutes: null,
      intendedTMinusMinutes: intended,
    };
  }
  return {
    clock: PROP_CLOCK_RESPONSE_RECEIVED,
    preTip: isPreTipObservation(clocks.observedAt, tip),
    actualTMinusMinutes: actualTMinusMinutes(clocks.observedAt, tip),
    intendedTMinusMinutes: intended,
  };
}
