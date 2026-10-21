import type { Pool, PoolClient } from 'pg';

/**
 * Cumulative BDL HTTP attempts for one (pull_run_id, game_id) across SQS receives.
 * The counter lives on raw.player_prop_game_runs.provider_attempts.
 * An in-memory page count does not survive a redelivery.
 *
 * 10 matches PLAYER_PROPS_MAX_PAGES: one full pagination, then no further HTTP
 * on a redelivery. A 429 with BDL_RATE_LIMIT_MAX_RETRIES=0 consumes one counted
 * attempt and does not start another HTTP call in-process.
 */
export const PLAYER_PROPS_MAX_HTTP_ATTEMPTS = 10;

export class AttemptBudgetError extends Error {
  constructor(
    readonly pullRunId: number,
    readonly gameId: string,
    readonly cap: number
  ) {
    super(`player-props attempt budget exhausted for game ${gameId} pull ${pullRunId} (cap ${cap})`);
    this.name = 'AttemptBudgetError';
  }
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * Atomically consumes one attempt. A lost race or a full counter returns no row
 * and the caller must not open a provider request.
 */
export async function reserveProviderAttempt(
  pool: Queryable,
  pullRunId: number,
  gameId: string,
  cap: number = PLAYER_PROPS_MAX_HTTP_ATTEMPTS
): Promise<number> {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new AttemptBudgetError(pullRunId, gameId, cap);
  }
  const result = await pool.query<{ provider_attempts: number }>(
    `UPDATE raw.player_prop_game_runs
        SET provider_attempts = provider_attempts + 1,
            updated_at = now()
      WHERE pull_run_id = $1
        AND game_id = $2
        AND provider_attempts < $3
      RETURNING provider_attempts`,
    [pullRunId, gameId, cap]
  );
  const attempt = result.rows[0]?.provider_attempts;
  if (attempt == null) throw new AttemptBudgetError(pullRunId, gameId, cap);
  return Number(attempt);
}
