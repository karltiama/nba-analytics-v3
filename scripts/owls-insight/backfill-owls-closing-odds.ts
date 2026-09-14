/**
 * Owls historical closing-odds backfill.
 *
 * Reuses eventIds from the completed /history/player-props season checkpoints.
 * Calls only GET /api/v1/history/closing-odds.
 *
 *   npx tsx scripts/owls-insight/backfill-owls-closing-odds.ts --season=2023 --execute --yes --history-concurrency=2
 */
import 'dotenv/config';
import { FileCheckpointStore } from '@/lib/providers/owls-insight/checkpoint';
import { OwlsInsightClient, readOwlsApiKey } from '@/lib/providers/owls-insight/client';
import {
  assertRequestedSeasonScope,
  buildExecuteSummary,
  formatExecuteSummary,
  parseOwlsCliArgs,
  requireExecutePreconditions,
} from '@/lib/providers/owls-insight/cli';
import {
  loadEventIdsFromCheckpoint,
  runOwlsClosingOddsBackfill,
} from '@/lib/providers/owls-insight/closing-odds-backfill';
import { OWLS_CLOSING_ODDS_BACKFILL_CAPS, OWLS_ENTITY_CLOSING_ODDS } from '@/lib/providers/owls-insight/contract';
import { loadOwlsFixtures } from '@/lib/providers/owls-insight/fixtures';
import { InMemoryOwlsStore } from '@/lib/providers/owls-insight/archive';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import { reconcileOwlsClosingOddsBackfill } from '@/lib/providers/owls-insight/reconcile';
import { loadCourtContextGames, filterGames } from '@/lib/providers/owls-insight/universe';
import type { CourtContextGame } from '@/lib/providers/owls-insight/types';

const PROP_RUN: Record<string, string> = {
  '2023': 'owls-2026-09-14-season-2023',
  '2024': 'owls-2026-09-14-season-2024',
  '2025': 'owls-2026-09-14-season-2025',
};

function closingRunId(season: string): string {
  return `owls-2026-09-14-closing-${season}`;
}

async function loadGames(seasons: string[]): Promise<CourtContextGame[]> {
  const db = await import('@/lib/db');
  const games = await loadCourtContextGames(db.query, seasons);
  await db.default.end().catch(() => undefined);
  return games;
}

async function main() {
  const args = parseOwlsCliArgs(process.argv.slice(2));
  if (!args.season) throw new Error('Closing-odds backfill requires --season 2023|2024|2025.');
  const seasons = [args.season];
  const all = await loadGames(seasons);
  const selected = filterGames(all, { season: args.season, from: args.from, to: args.to, gameId: args.gameId });
  assertRequestedSeasonScope(args.season, selected);
  if (selected.length === 0) throw new Error(`No Final games for season ${args.season}.`);

  const checkpoints = new FileCheckpointStore('data/owls-insight/runs');
  const propState = await checkpoints.load(PROP_RUN[args.season]!);
  if (!propState) throw new Error(`Missing player-props checkpoint ${PROP_RUN[args.season]}. Needed for eventIds.`);
  const eventIds = loadEventIdsFromCheckpoint(propState);
  const mapped = selected.filter((g) => eventIds[g.courtContextGameId]?.eventId).length;
  const unmapped = selected.length - mapped;

  const runId = args.runId || closingRunId(args.season);
  const estimated = selected.length;
  if (estimated > OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxProjectedRequests) {
    throw new Error(`Refusing: estimated ${estimated} requests exceeds cap ${OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxProjectedRequests}.`);
  }

  console.log(
    [
      `Season: ${args.season}`,
      `Final games: ${selected.length}`,
      `eventIds from ${PROP_RUN[args.season]}: mapped=${mapped} unmapped=${unmapped}`,
      `Run id: ${runId}`,
      `Endpoint: GET /api/v1/history/closing-odds only`,
      `Estimated requests: ~${estimated} (1 page/game from probes)`,
      `Concurrency: ${args.historyConcurrency ?? OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxConcurrency}`,
      `Mode: ${args.mode}`,
    ].join('\n')
  );

  if (args.mode === 'dry-run') {
    console.log('[dry-run] no Owls requests.');
    return;
  }

  if (args.execute) {
    const summary = buildExecuteSummary({
      cli: args,
      games: selected,
      bucket: process.env.NBA_DATA_BUCKET?.trim() || '(missing)',
      rawPrefix: process.env.NBA_RAW_PREFIX,
      estimatedHistoryRequests: estimated,
    });
    summary.s3Prefix = summary.s3Prefix.replace(/entity=historical_player_props/, `entity=${OWLS_ENTITY_CLOSING_ODDS}`);
    console.log('\n' + formatExecuteSummary(summary));
  }

  const creds = args.execute ? requireExecutePreconditions(args) : null;
  const fixtures = args.fixture ? loadOwlsFixtures() : undefined;
  const client = new OwlsInsightClient({
    mode: args.mode,
    apiKey: creds?.apiKey ?? readOwlsApiKey(),
    fixtures,
    historyConcurrency: args.historyConcurrency ?? OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxConcurrency,
  });
  const store =
    args.mode === 'fixture'
      ? new InMemoryOwlsStore()
      : new OwlsS3Store(creds?.bucket ?? process.env.NBA_DATA_BUCKET?.trim() ?? '');

  const result = await runOwlsClosingOddsBackfill({
    runId,
    phase: args.phase,
    mode: args.mode,
    games: selected,
    eventIds,
    client,
    store,
    checkpoints,
    resume: args.resume,
    yes: args.yes || args.fixture,
    gameConcurrency: args.historyConcurrency ?? OWLS_CLOSING_ODDS_BACKFILL_CAPS.maxConcurrency,
    logger: (msg) => console.log(msg),
  });
  console.log(JSON.stringify({ ...result, clientMetrics: client.getMetrics() }, null, 2));

  const state = await checkpoints.load(runId);
  const recon = await reconcileOwlsClosingOddsBackfill({
    runId,
    state,
    store,
    universeGameIds: selected.map((g) => g.courtContextGameId),
  });
  console.log(JSON.stringify({ reconcile: recon }, null, 2));
  if (result.stopReason) process.exit(2);
  if (!recon.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
