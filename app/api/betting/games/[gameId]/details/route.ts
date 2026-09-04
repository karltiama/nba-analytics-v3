import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { 
  getGameOdds,
  getAllTeamRatings,
  getTeamRecentForm,
  getHistoricalMatchups,
  getLineMovement,
} from '@/lib/betting/queries';
import { query } from '@/lib/db';
import { getInjuryMatchupContext } from '@/lib/betting/injury-matchup-context';
import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import { normalizeGameStatus } from '@/lib/betting/normalize-game-status';
import { buildEnrichedTeamSide, toNullableGameOdds } from '@/lib/betting/enrich-games-response';

/** Normalize provider injury fields to UI-friendly status for injury badges. */
function normalizeInjuryStatus(
  status: string | null,
  description: string | null
): 'Out' | 'Questionable' | 'Probable' | 'Doubtful' | 'GTD' {
  const s = (status ?? '').toLowerCase();
  const d = (description ?? '').toLowerCase();
  const hay = `${s} ${d}`;

  // Description often carries the latest update ("ruled out", "downgraded to out")
  // even when the provider status field lags behind.
  if (
    hay.includes('ruled out') ||
    hay.includes('downgraded to out') ||
    hay.includes('out for') ||
    hay.includes('out with') ||
    hay.includes('out due to') ||
    hay.includes('season-ending') ||
    hay.includes('season ending') ||
    s.includes('out') ||
    s.includes('season')
  ) {
    return 'Out';
  }
  if (s.includes('doubtful') || d.includes('doubtful')) return 'Doubtful';
  if (
    s.includes('questionable') ||
    d.includes('questionable') ||
    d.includes('game-time decision') ||
    d.includes('game time decision')
  ) {
    return 'Questionable';
  }
  if (s.includes('probable') || d.includes('probable')) return 'Probable';
  if (s.includes('gtd') || d.includes('gtd') || d.includes('game-time')) return 'GTD';

  // Unknown/noisy statuses should not default to "Out".
  return 'Questionable';
}

/**
 * GET /api/betting/games/[gameId]/details
 * 
 * Fetches detailed game information for the game details modal.
 * Auth required (private betting API).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const { gameId } = await params;

    const gameResult = await query(`
      SELECT
        g.game_id,
        g.start_time,
        g.start_time::date as game_date,
        g.status,
        g.home_score,
        g.away_score,
        g.home_team_id,
        g.away_team_id,
        ht.full_name as home_team_name,
        ht.abbreviation as home_team_abbr,
        at.full_name as away_team_name,
        at.abbreviation as away_team_abbr
      FROM analytics.games g
      JOIN analytics.teams ht ON g.home_team_id = ht.team_id
      JOIN analytics.teams at ON g.away_team_id = at.team_id
      WHERE g.game_id = $1
      LIMIT 1
    `, [gameId]);

    if (gameResult.length === 0) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    const game = gameResult[0];
    const resolvedGameId = game.game_id;

    // Get team ratings
    const teamRatings = await getAllTeamRatings();
    const homeRatings = teamRatings[game.home_team_id] || {};
    const awayRatings = teamRatings[game.away_team_id] || {};

    // Get recent form for both teams
    const [homeForm, awayForm] = await Promise.all([
      getTeamRecentForm(game.home_team_id, 5),
      getTeamRecentForm(game.away_team_id, 5),
    ]);

    // Transform recent form to match modal format (include game_date for B2B detection)
    const transformRecentForm = (form: any[]) => {
      return form.map((f) => ({
        opponent: f.opponent_abbr || 'OPP',
        result: f.result || 'L',
        score: `${f.team_score || 0}-${f.opponent_score || 0}`,
        spread: 0,
        covered: false,
        game_date: f.game_date ? String(f.game_date).slice(0, 10) : null,
      })).filter((f) => f.score !== '0-0');
    };

    // Get historical matchups
    const historicalMatchups = await getHistoricalMatchups(game.home_team_id, game.away_team_id, 10);

    // Get line movement
    const lineMovement = await getLineMovement(resolvedGameId, 'draftkings');

    // Get current odds
    const odds = await getGameOdds(resolvedGameId, 'draftkings');

    // Get injuries per team from analytics.player_injury_status_current
    const injuryRows = await query<{
      player_id: string;
      team_id: string;
      status: string | null;
      description: string | null;
      full_name: string;
    }>(
      `SELECT i.player_id, i.team_id, i.status, i.description, p.full_name
       FROM analytics.player_injury_status_current i
       JOIN analytics.players p ON p.player_id = i.player_id
       WHERE i.team_id IN ($1, $2)
       ORDER BY i.team_id, p.full_name`,
      [game.home_team_id, game.away_team_id]
    );
    const injuriesHome = injuryRows
      .filter((r) => r.team_id === game.home_team_id)
      .map((r) => ({
        player: r.full_name,
        status: normalizeInjuryStatus(r.status, r.description),
        injury: r.description ?? '',
      }));
    const injuriesAway = injuryRows
      .filter((r) => r.team_id === game.away_team_id)
      .map((r) => ({
        player: r.full_name,
        status: normalizeInjuryStatus(r.status, r.description),
        injury: r.description ?? '',
      }));

    let injuryMatchupContext: Awaited<ReturnType<typeof getInjuryMatchupContext>> = null;
    try {
      injuryMatchupContext = await getInjuryMatchupContext(resolvedGameId);
    } catch (ctxErr) {
      console.error('injury matchup context:', ctxErr);
    }

    // Helper: keep null when missing (do not invent 0.0)
    const formatStatOrNull = (value: number | null | undefined): number | null => {
      if (value == null) return null;
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return Math.round(num * 10) / 10;
    };

    const homeSide = buildEnrichedTeamSide({
      id: game.home_team_id,
      name: game.home_team_name,
      abbreviation: game.home_team_abbr,
      ratings: Object.keys(homeRatings).length ? (homeRatings as any) : undefined,
      defensiveRank: undefined,
      recentForm: [],
    });
    const awaySide = buildEnrichedTeamSide({
      id: game.away_team_id,
      name: game.away_team_name,
      abbreviation: game.away_team_abbr,
      ratings: Object.keys(awayRatings).length ? (awayRatings as any) : undefined,
      defensiveRank: undefined,
      recentForm: [],
    });

    const startTimeFormatted = formatTipoffEt(game.start_time);
    const status = normalizeGameStatus(game.status);

    const gameDateStr = game.start_time
      ? new Date(game.start_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      : '';

    const nullableOdds = toNullableGameOdds(odds);

    // Build response (include game for page/modal header)
    const response = {
      game: {
        id: resolvedGameId,
        gameDate: gameDateStr,
        status,
        statusRaw: game.status ?? null,
        homeTeam: {
          id: game.home_team_id,
          name: game.home_team_name,
          abbreviation: game.home_team_abbr,
          record: homeSide.record,
        },
        awayTeam: {
          id: game.away_team_id,
          name: game.away_team_name,
          abbreviation: game.away_team_abbr,
          record: awaySide.record,
        },
        startTime: startTimeFormatted,
      },
      homeTeamStats: {
        offensiveRating: formatStatOrNull(homeRatings.offensive_rating),
        defensiveRating: formatStatOrNull(homeRatings.defensive_rating),
        pace: formatStatOrNull(homeRatings.pace),
        hasSeasonAnalytics: homeSide.hasSeasonAnalytics,
        recentForm: transformRecentForm(homeForm),
      },
      awayTeamStats: {
        offensiveRating: formatStatOrNull(awayRatings.offensive_rating),
        defensiveRating: formatStatOrNull(awayRatings.defensive_rating),
        pace: formatStatOrNull(awayRatings.pace),
        hasSeasonAnalytics: awaySide.hasSeasonAnalytics,
        recentForm: transformRecentForm(awayForm),
      },
      spreadMovement: lineMovement.spreadMovement.length > 0 ? lineMovement.spreadMovement : [],
      totalMovement: lineMovement.totalMovement.length > 0 ? lineMovement.totalMovement : [],
      historicalMatchups: historicalMatchups.map((m: any) => ({
        date: m.date,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        totalPoints: m.totalPoints,
      })),
      currentOdds: {
        spread: nullableOdds.home.spread,
        spreadOddsHome: nullableOdds.home.spreadOdds,
        spreadOddsAway: nullableOdds.away.spreadOdds,
        moneylineHome: nullableOdds.home.moneyline,
        moneylineAway: nullableOdds.away.moneyline,
        overUnder: nullableOdds.overUnder,
        overOdds: nullableOdds.overOdds,
        underOdds: nullableOdds.underOdds,
        bookmaker: nullableOdds.bookmaker,
      },
      injuries: {
        home: injuriesHome,
        away: injuriesAway,
      },
      injuryMatchupContext: injuryMatchupContext ?? { season: '', entries: [] },
      aiSuggestions: [],
      aiConfidenceScores: {
        moneyline: 0,
        spread: 0,
        total: 0,
      },
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Error fetching game details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game details', message: error.message },
      { status: 500 }
    );
  }
}

