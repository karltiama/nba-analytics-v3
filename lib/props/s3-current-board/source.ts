/**
 * Server-only switch for current player-prop reads.
 * Unset and every value other than "s3" keep the existing PostgreSQL readers.
 * Do not set this in Vercel or AWS during this phase.
 */
export type CurrentPropsSource = 'postgres' | 's3';

export function currentPropsSource(env: NodeJS.ProcessEnv = process.env): CurrentPropsSource {
  return env.CURRENT_PROPS_SOURCE === 's3' ? 's3' : 'postgres';
}
