/**
 * Owls historical player-prop backfill.
 *
 * Default: dry-run / refuse network.
 * Fixture: --fixture (no API key, local JSON only, never writes production prefix).
 * Live:    --execute --yes  (requires OWLS_API_KEY). DO NOT run until the trial is activated.
 */
import 'dotenv/config';
import { FileCheckpointStore } from '@/lib/providers/owls-insight/checkpoint';
import { OwlsInsightClient, readOwlsApiKey } from '@/lib/providers/owls-insight/client';
import {
  assertRequestedSeasonScope,
  buildExecuteSummary,
  defaultRunId,
  formatExecuteSummary,
  parseOwlsCliArgs,
  requireExecutePreconditions,
} from '@/lib/providers/owls-insight/cli';
import { FIRST_PROBE_GAMES } from '@/lib/providers/owls-insight/contract';
import { runOwlsPropBackfill } from '@/lib/providers/owls-insight/backfill';
import { loadOwlsFixtures } from '@/lib/providers/owls-insight/fixtures';
import { InMemoryOwlsStore } from '@/lib/providers/owls-insight/archive';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import { formatPlannerStdout, planOwlsPropBackfill } from '@/lib/providers/owls-insight/planner';
import { probeGamesFromUniverse } from '@/lib/providers/owls-insight/probe';
import { loadCourtContextGames, filterGames } from '@/lib/providers/owls-insight/universe';
import type { CourtContextGame } from '@/lib/providers/owls-insight/types';

async function loadGames(seasons: string[]): Promise<CourtContextGame[]> {
  try {
    const db = await import('@/lib/db');
    const games = await loadCourtContextGames(db.query, seasons);
    await db.default.end().catch(() => undefined);
    return games;
  } catch {
    return FIRST_PROBE_GAMES.filter((g) => seasons.includes(g.season)).map((g) => ({
      courtContextGameId: g.courtContextGameId,
      season: g.season,
      startTime: g.startTime,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeTeamName: g.homeTeamName,
      awayTeamName: g.awayTeamName,
    }));
  }
}

async function main() {
  const args = parseOwlsCliArgs(process.argv.slice(2));
  const seasons = args.season ? [args.season] : ['2023', '2024', '2025'];
  const all = await loadGames(seasons);
  const selected =
    args.phase === 1 && !args.gameId && !args.from && !args.to && !args.season
      ? probeGamesFromUniverse(all)
      : filterGames(all, { season: args.season, from: args.from, to: args.to, gameId: args.gameId });
  assertRequestedSeasonScope(args.season, selected);

  const plan = planOwlsPropBackfill({
    season: args.season,
    from: args.from,
    to: args.to,
    gameId: args.gameId,
    games: selected,
  });
  console.log(formatPlannerStdout(plan));
  console.log(`Phase: ${args.phase}`);
  console.log(`Mode: ${args.mode}`);
  console.log(`Games in this invocation: ${selected.length}`);

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
      estimatedHistoryRequests: plan.estimatedHistoryRequests,
    });
    console.log('\n' + formatExecuteSummary(summary));
  }

  const creds = args.execute ? requireExecutePreconditions(args) : null;
  const runId = defaultRunId(args);
  const fixtures = args.fixture ? loadOwlsFixtures() : undefined;
  const client = new OwlsInsightClient({
    mode: args.mode,
    apiKey: creds?.apiKey ?? readOwlsApiKey(),
    fixtures,
    historyConcurrency: args.historyConcurrency,
  });

  const store =
    args.mode === 'fixture'
      ? new InMemoryOwlsStore()
      : new OwlsS3Store(creds?.bucket ?? process.env.NBA_DATA_BUCKET?.trim() ?? '');

  const result = await runOwlsPropBackfill({
    runId,
    phase: args.phase,
    mode: args.mode,
    games: selected,
    client,
    store,
    checkpoints: new FileCheckpointStore('data/owls-insight/runs'),
    resume: args.resume,
    yes: args.yes || args.fixture,
    logger: (msg) => console.log(msg),
    normalize: args.mode === 'fixture',
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
