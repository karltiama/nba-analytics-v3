/**
 * Dry-run planner. Never calls Owls.
 *
 *   npm run plan:owls-prop-backfill -- --season 2024
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { parseOwlsCliArgs, assertRequestedSeasonScope } from '@/lib/providers/owls-insight/cli';
import { FIRST_PROBE_GAMES, FROZEN_GAME_UNIVERSE } from '@/lib/providers/owls-insight/contract';
import { formatPlannerStdout, planOwlsPropBackfill } from '@/lib/providers/owls-insight/planner';
import { loadCourtContextGames } from '@/lib/providers/owls-insight/universe';
import type { CourtContextGame } from '@/lib/providers/owls-insight/types';

async function loadGames(seasons: string[]): Promise<CourtContextGame[]> {
  try {
    const db = await import('@/lib/db');
    const games = await loadCourtContextGames(db.query, seasons);
    await db.default.end().catch(() => undefined);
    return games;
  } catch (err) {
    console.warn('[plan:owls-prop-backfill] analytics.games unavailable; using frozen counts + probe rows only.');
    console.warn(err instanceof Error ? err.message : String(err));
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
  if (args.execute) {
    throw new Error('plan:owls-prop-backfill never calls Owls. Remove --execute.');
  }
  const seasons = args.season ? [args.season] : ['2023', '2024', '2025'];
  const games = await loadGames(seasons);
  assertRequestedSeasonScope(args.season, games);
  const plan = planOwlsPropBackfill({
    season: args.season,
    from: args.from,
    to: args.to,
    gameId: args.gameId,
    games,
  });
  console.log(formatPlannerStdout(plan));
  console.log('\nFrozen analytics.games snapshot (2026-09-14):');
  console.log(JSON.stringify(FROZEN_GAME_UNIVERSE, null, 2));
  if (args.out) {
    const body = {
      generatedAt: new Date().toISOString(),
      networkCalls: 0,
      frozenUniverse: FROZEN_GAME_UNIVERSE,
      plan: { ...plan, manifest: plan.manifest },
    };
    await writeFile(args.out, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${args.out}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
