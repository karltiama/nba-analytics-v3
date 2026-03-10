import { NextRequest, NextResponse } from 'next/server';
import { 
  getGameOdds,
  getAllTeamRatings,
  getTeamRecentForm,
  getHistoricalMatchups,
  getLineMovement,
} from '@/lib/betting/queries';
import { query } from '@/lib/db';

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

    // Transform recent form to match modal format
    const transformRecentForm = (form: any[]) => {
      return form.map((f) => ({
        opponent: f.opponent_abbr || 'OPP',
        result: f.result || 'L',
        score: `${f.team_score || 0}-${f.opponent_score || 0}`,
        spread: 0, // Spread data not available in recent form query
        covered: false, // Spread data not available
      })).filter((f) => f.score !== '0-0'); // Filter out games without scores
    };

    // Get historical matchups
    const historicalMatchups = await getHistoricalMatchups(game.home_team_id, game.away_team_id, 10);

    // Get line movement
    const lineMovement = await getLineMovement(resolvedGameId, 'draftkings');

    // Get current odds
    const odds = await getGameOdds(resolvedGameId, 'draftkings');

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

    // Build response (include game for page/modal header)
    const response = {
      game: {
        id: resolvedGameId,
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
        home: [], // Not available in MVP
        away: [], // Not available in MVP
      },
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

