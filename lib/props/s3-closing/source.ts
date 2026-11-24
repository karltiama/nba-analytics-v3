/**
 * Server-only switch for past-date closing lines.
 * Unset and every value other than "s3_closing" keep the existing PostgreSQL historical reader.
 * This is not CURRENT_PROPS_SOURCE and it is not PROPS_PUBLICATION_MODE.
 */
export type HistoricalPropsSource = 'postgres' | 's3_closing';

export function historicalPropsSource(env: NodeJS.ProcessEnv = process.env): HistoricalPropsSource {
  return env.HISTORICAL_PROPS_SOURCE === 's3_closing' ? 's3_closing' : 'postgres';
}
