import { createHash } from 'crypto';
import {
  getGamesForDate,
  getAllTeamRatings,
  getGamesOdds,
  getTrendingPlayersFromAnalytics,
  getTeamPaceRankings,
  getTeamDefensiveRankings,
} from '@/lib/betting/queries';

export function hashSlatePayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Builds deterministic user content for the OpenAI slate summary (analytics + odds only).
 */
export async function buildAiSlateUserContent(dateEt: string): Promise<{
  userContent: string;
  payloadHash: string;
}> {
  const [games, ratings, paceRankings, defRankings, trending] = await Promise.all([
    getGamesForDate(dateEt),
    getAllTeamRatings(),
    getTeamPaceRankings(),
    getTeamDefensiveRankings(),
    getTrendingPlayersFromAnalytics(5),
  ]);

  const gameIds = games.map((g: { game_id: string }) => g.game_id);
  const oddsMap = gameIds.length > 0 ? await getGamesOdds(gameIds, 'draftkings') : {};

  const payloadForHash = {
    date: dateEt,
    games: games.map((g: Record<string, unknown>) => ({
      id: g.game_id,
      away: g.away_team_abbr,
      home: g.home_team_abbr,
      status: g.status,
    })),
    odds: gameIds.map((id) => ({
      game_id: id,
      home_spread: oddsMap[id]?.home?.spread ?? null,
      total: oddsMap[id]?.overUnder ?? null,
    })),
    fastestPace: paceRankings[0]
      ? { abbr: paceRankings[0].team_abbr, pace: paceRankings[0].pace }
      : null,
    bestDef: defRankings[0]
      ? {
          abbr: defRankings[0].team_abbr,
          drtg: defRankings[0].defensive_rating,
          pa: defRankings[0].points_allowed,
        }
      : null,
    trending: trending.map((t) => ({
      name: t.full_name,
      team: t.team_abbr,
      pct: Math.round(t.points_trend_pct * 10) / 10,
      dir: t.trend_direction,
    })),
  };

  const lines: string[] = [];
  lines.push(`Slate date (ET): ${dateEt}`);
  lines.push('');
  lines.push('League snapshots (season aggregates from our analytics database):');
  if (paceRankings[0]) {
    lines.push(
      `- Fastest pace: ${paceRankings[0].team_abbr} (${paceRankings[0].pace.toFixed(1)} possessions per game, season avg)`
    );
  }
  if (defRankings[0]) {
    lines.push(
      `- Best defensive rating: ${defRankings[0].team_abbr} (DRTG ${defRankings[0].defensive_rating.toFixed(1)}, ${defRankings[0].points_allowed.toFixed(1)} opponent PPG allowed)`
    );
  }
  lines.push('');

  if (games.length === 0) {
    lines.push('Games on this date: none scheduled.');
  } else {
    lines.push('Games on this date:');
    for (const g of games as Record<string, unknown>[]) {
      const gid = g.game_id as string;
      const o = oddsMap[gid];
      const homeR = ratings[g.home_team_id as string];
      const awayR = ratings[g.away_team_id as string];
      let row = `- ${g.away_team_abbr} @ ${g.home_team_abbr} (status: ${g.status ?? 'unknown'})`;
      if (o?.overUnder != null || o?.home?.spread != null) {
        const parts: string[] = [];
        if (o.home?.spread != null) parts.push(`home spread ${o.home.spread}`);
        if (o.overUnder != null) parts.push(`total ${o.overUnder}`);
        row += ` | ${parts.join(', ')}`;
      }
      lines.push(row);
      if (homeR && awayR) {
        lines.push(
          `  ${g.away_team_abbr}: ORTG ${awayR.offensive_rating.toFixed(1)}, DRTG ${awayR.defensive_rating.toFixed(1)}, pace ${awayR.pace.toFixed(1)}`
        );
        lines.push(
          `  ${g.home_team_abbr}: ORTG ${homeR.offensive_rating.toFixed(1)}, DRTG ${homeR.defensive_rating.toFixed(1)}, pace ${homeR.pace.toFixed(1)}`
        );
      }
    }
  }

  lines.push('');
  lines.push('Players trending (last 5 vs season, points):');
  if (trending.length === 0) {
    lines.push('- (none returned)');
  } else {
    for (const t of trending) {
      const sign = t.points_trend_pct >= 0 ? '+' : '';
      lines.push(
        `- ${t.full_name} (${t.team_abbr}): ${sign}${t.points_trend_pct.toFixed(0)}% vs season; L5 ${t.l5_avg_points.toFixed(1)} vs ${t.season_avg_points.toFixed(1)} PPG`
      );
    }
  }

  return {
    userContent: lines.join('\n'),
    payloadHash: hashSlatePayload(payloadForHash),
  };
}
