import { NextRequest, NextResponse } from 'next/server';
import { 
  getGameOdds,
  getAllTeamRatings,
  getTeamRecentForm,
  getHistoricalMatchups,
  getLineMovement,
} from '@/lib/betting/queries';
import { query } from '@/lib/db';
import { getInjuryMatchupContext } from '@/lib/betting/injury-matchup-context';

/** Normalize provider status to UI-friendly status for injury badges */
function normalizeInjuryStatus(status: string | null): 'Out' | 'Questionable' | 'Probable' | 'Doubtful' | 'GTD' {
  if (!status) return 'Out';
  const s = status.toLowerCase();
  if (s.includes('out') || s.includes('season')) return 'Out';
  if (s.includes('questionable')) return 'Questionable';
  if (s.includes('probable')) return 'Probable';
  if (s.includes('doubtful')) return 'Doubtful';
  if (s.includes('game time') || s.includes('gtd') || s.includes('decision')) return 'GTD';
  return 'Out';
}

/**
 * GET /api/betting/games/[gameId]/details
 * 
 * Fetches detailed game information for the game details modal
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
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
        status: normalizeInjuryStatus(r.status),
        injury: r.description ?? '',
      }));
    const injuriesAway = injuryRows
      .filter((r) => r.team_id === game.away_team_id)
      .map((r) => ({
        player: r.full_name,
        status: normalizeInjuryStatus(r.status),
        injury: r.description ?? '',
      }));

    let injuryMatchupContext: Awaited<ReturnType<typeof getInjuryMatchupContext>> = null;
    try {
      injuryMatchupContext = await getInjuryMatchupContext(resolvedGameId);
    } catch (ctxErr) {
      console.error('injury matchup context:', ctxErr);
    }

    // Helper function to format stats to 1 decimal place
    const formatStat = (value: number | null | undefined): number => {
      const num = parseFloat(value?.toString() || '0') || 0;
      return Math.round(num * 10) / 10; // Round to 1 decimal place
    };

    const startTimeFormatted = game.start_time
      ? new Date(game.start_time).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : '';

    const gameDateStr = game.start_time
      ? new Date(game.start_time).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      : '';

    // Build response (include game for page/modal header)
    const response = {
      game: {
        id: resolvedGameId,
        gameDate: gameDateStr,
        homeTeam: {
          id: game.home_team_id,
          name: game.home_team_name,
          abbreviation: game.home_team_abbr,
          record: `${homeRatings.wins ?? 0}-${homeRatings.losses ?? 0}`,
        },
        awayTeam: {
          id: game.away_team_id,
          name: game.away_team_name,
          abbreviation: game.away_team_abbr,
          record: `${awayRatings.wins ?? 0}-${awayRatings.losses ?? 0}`,
        },
        startTime: startTimeFormatted,
      },
      homeTeamStats: {
        offensiveRating: formatStat(homeRatings.offensive_rating),
        defensiveRating: formatStat(homeRatings.defensive_rating),
        pace: formatStat(homeRatings.pace),
        recentForm: transformRecentForm(homeForm),
      },
      awayTeamStats: {
        offensiveRating: formatStat(awayRatings.offensive_rating),
        defensiveRating: formatStat(awayRatings.defensive_rating),
        pace: formatStat(awayRatings.pace),
        recentForm: transformRecentForm(awayForm),
      },
      spreadMovement: lineMovement.spreadMovement.length > 0 
        ? lineMovement.spreadMovement 
        : [
            { time: 'Open', value: odds.home.spread || 0 },
            { time: 'Now', value: odds.home.spread || 0 },
          ],
      totalMovement: lineMovement.totalMovement.length > 0
        ? lineMovement.totalMovement
        : [
            { time: 'Open', value: odds.overUnder || 220 },
            { time: 'Now', value: odds.overUnder || 220 },
          ],
      historicalMatchups: historicalMatchups.map((m: any) => ({
        date: m.date,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        totalPoints: m.totalPoints,
      })),
      currentOdds: {
        spread: odds.home.spread != null ? odds.home.spread : null,
        spreadOddsHome: odds.home.spreadOdds != null ? odds.home.spreadOdds : null,
        spreadOddsAway: odds.away.spreadOdds != null ? odds.away.spreadOdds : null,
        moneylineHome: odds.home.moneyline != null ? odds.home.moneyline : null,
        moneylineAway: odds.away.moneyline != null ? odds.away.moneyline : null,
        overUnder: odds.overUnder != null ? odds.overUnder : null,
        overOdds: odds.overOdds != null ? odds.overOdds : null,
        underOdds: odds.underOdds != null ? odds.underOdds : null,
        bookmaker: odds.bookmaker ?? null,
      },
      injuries: {
        home: injuriesHome,
        away: injuriesAway,
      },
      injuryMatchupContext: injuryMatchupContext ?? { season: '', entries: [] },
      aiSuggestions: [], // Not available in MVP - can add simple calculations later
      aiConfidenceScores: {
        moneyline: 0, // Not available in MVP
        spread: 0, // Not available in MVP
        total: 0, // Not available in MVP
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

