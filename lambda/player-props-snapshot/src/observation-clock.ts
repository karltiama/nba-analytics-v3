import type { Pool } from 'pg';

/**
 * Player-prop clock contract. Each clock has one meaning and is never substituted for another.
 *
 * CONTROLLER_ENQUEUED_AT  raw.player_prop_game_runs.started_at (controller intent, shared by retries)
 * OBSERVED_AT             response_received_at of the provider attempt whose body was stored
 * PROVIDER_UPDATED_AT     provider row `updated_at`
 * DATABASE_WRITTEN_AT     Postgres write time
 *
 * Legacy columns keep their original meaning: raw.player_prop_snapshots_v2.fetched_at and
 * analytics.player_props_current.snapshot_at hold controller time (LEGACY_CONTROLLER_TIME).
 */
export const OBSERVATION_CLOCK_RESPONSE_RECEIVED = 'RESPONSE_RECEIVED' as const;

export type ProviderAttempt = {
  attempt: number;
  requestStartedAt: Date;
  responseReceivedAt: Date | null;
  status: number | null;
};

export type ProviderObservation = {
  requestStartedAt: Date;
  responseReceivedAt: Date;
  attempts: ProviderAttempt[];
};

export type PropObservationClocks = {
  controllerEnqueuedAt: Date | null;
  observedAt: Date;
};

/**
 * Wraps a fetch so every attempt records its own request/response clocks.
 * The observation is the last attempt that produced a Response, which is the one the limiter returns.
 */
export function createAttemptRecorder(
  baseFetch: typeof fetch,
  now: () => Date = () => new Date()
): { fetchImpl: typeof fetch; attempts: ProviderAttempt[]; observation(): ProviderObservation } {
  const attempts: ProviderAttempt[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const entry: ProviderAttempt = {
      attempt: attempts.length + 1,
      requestStartedAt: now(),
      responseReceivedAt: null,
      status: null,
    };
    attempts.push(entry);
    const res = await baseFetch(input, init);
    entry.responseReceivedAt = now();
    entry.status = res.status;
    return res;
  }) as typeof fetch;
  return {
    fetchImpl,
    attempts,
    observation() {
      const last = attempts[attempts.length - 1];
      if (!last || last.responseReceivedAt == null) {
        throw new Error('player-props observation missing response_received_at');
      }
      return {
        requestStartedAt: last.requestStartedAt,
        responseReceivedAt: last.responseReceivedAt,
        attempts: attempts.map((a) => ({ ...a })),
      };
    },
  };
}

/** Pre-tip only when observed_at < tip. Missing either clock is not pre-tip. */
export function isPreTipObservation(observedAt: Date | null | undefined, tip: Date | null | undefined): boolean {
  if (!observedAt || !tip) return false;
  const o = observedAt.getTime();
  const t = tip.getTime();
  return Number.isFinite(o) && Number.isFinite(t) && o < t;
}

/** Log-only summary. intended uses controller time; actual uses observed_at. */
export function describeObservation(args: {
  controllerEnqueuedAt: Date | null;
  observedAt: Date;
  tip: Date | null;
  attempts: number;
}): Record<string, unknown> {
  const seconds = (from: Date | null) =>
    from && args.tip ? Math.round((args.tip.getTime() - from.getTime()) / 1000) : null;
  return {
    observation_clock: OBSERVATION_CLOCK_RESPONSE_RECEIVED,
    controller_enqueued_at: args.controllerEnqueuedAt?.toISOString() ?? null,
    observed_at: args.observedAt.toISOString(),
    tip: args.tip?.toISOString() ?? null,
    intended_t_minus_seconds: seconds(args.controllerEnqueuedAt),
    actual_t_minus_seconds: seconds(args.observedAt),
    pre_tip: isPreTipObservation(args.observedAt, args.tip),
    attempts: args.attempts,
  };
}

export const REQUIRED_OBSERVATION_COLUMNS: ReadonlyArray<readonly [string, string, string]> = [
  ['raw', 'player_prop_snapshots_v2', 'observed_at'],
  ['raw', 'player_prop_snapshots_v2', 'controller_enqueued_at'],
  ['raw', 'player_prop_snapshots_v2', 'provider_updated_at'],
  ['raw', 'player_prop_snapshots_v2', 'observation_clock'],
  ['analytics', 'player_props_current', 'observed_at'],
  ['analytics', 'player_props_current', 'controller_enqueued_at'],
  ['analytics', 'player_props_current', 'provider_updated_at'],
  ['analytics', 'player_props_current', 'observation_clock'],
];

let schemaReady = false;

/** Throws before any provider call when the observation-clock migration is absent. */
export async function assertObservationClockSchema(pool: Pick<Pool, 'query'>): Promise<void> {
  if (schemaReady) return;
  const res = await pool.query<{ table_schema: string; table_name: string; column_name: string }>(
    `SELECT table_schema, table_name, column_name
       FROM information_schema.columns
      WHERE (table_schema, table_name) IN (('raw', 'player_prop_snapshots_v2'), ('analytics', 'player_props_current'))
        AND column_name IN ('observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock')`
  );
  const present = new Set(res.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
  const missing = REQUIRED_OBSERVATION_COLUMNS.map((c) => c.join('.')).filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(`player-props observation-clock schema missing: ${missing.join(', ')}`);
  }
  schemaReady = true;
}

export function resetObservationClockSchemaCacheForTests(): void {
  schemaReady = false;
}
