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

/**
 * Eastern-day cap for every props HTTP attempt: all games, all four schedules,
 * SQS redelivery, and concurrent workers. 300 is the 225-request planning
 * estimate plus 75 requests of headroom. The 750 product of the per-pull cap
 * is not this budget. Tonight's 11-game wave used 11 requests.
 */
export const PROPS_DAILY_HTTP_ATTEMPT_CAP = 300;

export class DailyAttemptBudgetError extends Error {
  constructor(readonly cap: number) {
    super(`player-props daily attempt budget exhausted (cap ${cap})`);
    this.name = 'DailyAttemptBudgetError';
  }
}

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
const DAILY_ATTEMPT_SQL = `
INSERT INTO raw.player_prop_daily_attempts (et_day, attempts)
VALUES ((clock_timestamp() AT TIME ZONE 'America/New_York')::date, 1)
ON CONFLICT (et_day) DO UPDATE
   SET attempts = raw.player_prop_daily_attempts.attempts + 1,
       updated_at = clock_timestamp()
 WHERE raw.player_prop_daily_attempts.attempts < $1
RETURNING attempts`;

const GAME_ATTEMPT_SQL = `
UPDATE raw.player_prop_game_runs
   SET provider_attempts = provider_attempts + 1,
       updated_at = now()
 WHERE pull_run_id = $1
   AND game_id = $2
   AND provider_attempts < $3
RETURNING provider_attempts`;

/**
 * Reserves one Eastern-day attempt and one per-run attempt in a single transaction.
 * Either refusal rolls both back, so a full daily cap does not consume a game-run attempt
 * and a full game-run cap does not consume a daily attempt. No provider call follows a refusal.
 */
export async function reserveProviderAttempt(
  pool: Queryable,
  pullRunId: number,
  gameId: string,
  cap: number = PLAYER_PROPS_MAX_HTTP_ATTEMPTS,
  dailyCap: number = PROPS_DAILY_HTTP_ATTEMPT_CAP
): Promise<number> {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new AttemptBudgetError(pullRunId, gameId, cap);
  }
  if (!Number.isInteger(dailyCap) || dailyCap < 1) {
    throw new DailyAttemptBudgetError(dailyCap);
  }
  const ownsTransaction = typeof (pool as Pool).connect === 'function';
  const connected: PoolClient | null = ownsTransaction ? await (pool as Pool).connect() : null;
  const client: Queryable = connected ?? pool;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    const daily = await client.query<{ attempts: number }>(DAILY_ATTEMPT_SQL, [dailyCap]);
    if (daily.rows[0]?.attempts == null) {
      if (ownsTransaction) await client.query('ROLLBACK');
      throw new DailyAttemptBudgetError(dailyCap);
    }
    const result = await client.query<{ provider_attempts: number }>(GAME_ATTEMPT_SQL, [pullRunId, gameId, cap]);
    const attempt = result.rows[0]?.provider_attempts;
    if (attempt == null) {
      if (ownsTransaction) await client.query('ROLLBACK');
      throw new AttemptBudgetError(pullRunId, gameId, cap);
    }
    if (ownsTransaction) await client.query('COMMIT');
    return Number(attempt);
  } catch (error) {
    if (ownsTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* the original refusal is the error to surface */
      }
    }
    throw error;
  } finally {
    connected?.release();
  }
}
