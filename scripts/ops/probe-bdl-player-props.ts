/**
 * Read-only probe: does BALLDONTLIE currently expose a real player-prop board?
 * Does not write Postgres/S3 and does not thaw Lambda freeze flags.
 *
 *   npx tsx scripts/ops/probe-bdl-player-props.ts
 *   npx tsx scripts/ops/probe-bdl-player-props.ts --game-id 21717855
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { bdlAuthorizationHeader } from '../../lib/balldontlie/credential-fingerprint';

const BDL_BASE = 'https://api.balldontlie.io/v2';

function lambdaBdlKey(): string | null {
  try {
    const out = execFileSync(
      'aws',
      [
        'lambda',
        'get-function-configuration',
        '--function-name',
        'nba-player-props-ingestion-lambda',
        '--query',
        'Environment.Variables.BALLDONTLIE_API_KEY',
        '--output',
        'text',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const v = out.replace(/\r?\n$/, '').trim();
    if (!v || v === 'None' || v === 'null') return null;
    return v;
  } catch {
    return null;
  }
}

function argValue(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

async function probe(apiKey: string, gameId: number) {
  const url = new URL(`${BDL_BASE}/odds/player_props`);
  url.searchParams.set('game_id', String(gameId));
  const res = await fetch(url.toString(), { headers: bdlAuthorizationHeader(apiKey) });
  const text = await res.text();
  let rowCount = 0;
  let parseError: string | null = null;
  try {
    const json = JSON.parse(text) as { data?: unknown[] };
    rowCount = Array.isArray(json.data) ? json.data.length : 0;
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'parse_failed';
  }
  return {
    gameId,
    httpStatus: res.status,
    rowCount,
    parseError,
    bodyChars: text.length,
    samplePrefix: text.slice(0, 180).replace(/\s+/g, ' '),
  };
}

async function main() {
  const localKey = (
    process.env.BALLDONTLIE_API_KEY ||
    process.env.BALDONTLIE_API_KEY ||
    ''
  ).trim();
  const workerKey = lambdaBdlKey();
  const apiKey = workerKey || localKey;
  if (!apiKey) throw new Error('Missing BALLDONTLIE_API_KEY');
  const keySource = workerKey ? 'lambda-env' : 'local-env';
  const explicit = argValue('--game-id', process.argv);
  const gameIds = explicit
    ? [Number(explicit)]
    : [21717855, 21717856, 21717857];
  const results = [];
  for (const gameId of gameIds) {
    if (!Number.isFinite(gameId)) throw new Error(`Invalid game id ${gameId}`);
    results.push(await probe(apiKey, gameId));
  }
  const available = results.filter((r) => r.httpStatus === 200 && r.rowCount > 0);
  console.log(
    JSON.stringify(
      {
        availableBoard: available.length > 0,
        keySource,
        reason:
          available.length > 0
            ? 'At least one game returned player_props rows'
            : 'No legitimate BDL player-prop board for probed games; canary must wait',
        results,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
