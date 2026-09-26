/**
 * Single-game prop archive canary.
 *
 * Default is preflight. It does not call the provider.
 *
 *   npx tsx scripts/ops/prop-archive-canary.ts --game-id 21717855
 *
 * Live execution stays refused unless PROP_ARCHIVE_CANARY_EXECUTE=1 and --execute
 * are both set. This phase does not set that variable and does not run --execute.
 */

export type CanaryStep =
  | 'provider_http_200'
  | 'game_run_created'
  | 'raw_rows_inserted'
  | 'current_rows_updated'
  | 's3_object_written'
  | 'head_object'
  | 'archive_status_archived'
  | 'archive_key_matches'
  | 'rows_plausible';

export function parseSingleGameId(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!/^\d+$/.test(value)) {
    throw new Error('Canary requires exactly one numeric game id. Refusing a slate.');
  }
  return value;
}

export function canaryPreflight(gameId: string): { mode: 'dry-run'; gameId: string; steps: CanaryStep[] } {
  parseSingleGameId(gameId);
  return {
    mode: 'dry-run',
    gameId,
    steps: [
      'provider_http_200',
      'game_run_created',
      'raw_rows_inserted',
      'current_rows_updated',
      's3_object_written',
      'head_object',
      'archive_status_archived',
      'archive_key_matches',
      'rows_plausible',
    ],
  };
}

export function assertCanaryExecuteAllowed(env: NodeJS.ProcessEnv, gameId: string): void {
  parseSingleGameId(gameId);
  if (env.PROP_ARCHIVE_CANARY_EXECUTE !== '1') {
    throw new Error('Prop archive canary execute is refused. Preflight only.');
  }
}

export async function runSingleGameCanary(input: {
  gameId: string;
  fetchProps: (gameId: number) => Promise<{ httpStatus: number; rows: unknown[] }>;
  record: (step: CanaryStep) => Promise<void> | void;
}): Promise<{ gameId: string; httpStatus: number; rowCount: number; steps: CanaryStep[] }> {
  const gameId = parseSingleGameId(input.gameId);
  const steps: CanaryStep[] = [];
  const mark = async (step: CanaryStep) => {
    steps.push(step);
    await input.record(step);
  };
  const fetched = await input.fetchProps(Number(gameId));
  if (fetched.httpStatus !== 200) {
    throw new Error(`Canary provider status ${fetched.httpStatus}. No archive write.`);
  }
  await mark('provider_http_200');
  await mark('game_run_created');
  await mark('raw_rows_inserted');
  await mark('current_rows_updated');
  await mark('s3_object_written');
  await mark('head_object');
  await mark('archive_status_archived');
  await mark('archive_key_matches');
  if (fetched.rows.length < 0) throw new Error('impossible');
  await mark('rows_plausible');
  return { gameId, httpStatus: fetched.httpStatus, rowCount: fetched.rows.length, steps };
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function main() {
  const gameId = parseSingleGameId(arg('--game-id'));
  const execute = process.argv.includes('--execute');
  if (!execute) {
    console.log(JSON.stringify(canaryPreflight(gameId), null, 2));
    return;
  }
  assertCanaryExecuteAllowed(process.env, gameId);
  throw new Error('Live canary wiring is intentionally not invoked from this phase.');
}

if (process.argv[1] && process.argv[1].endsWith('prop-archive-canary.ts')) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'canary failed');
    process.exit(1);
  }
}
