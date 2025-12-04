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

    // Get game info (check both bbref_games and bbref_schedule)
    const gameResult = await query(`
      SELECT 
        COALESCE(bs.canonical_game_id, bs.bbref_game_id, bg.bbref_game_id) as game_id,
        bs.bbref_game_id,
        bs.canonical_game_id,
        COALESCE(bs.start_time, bg.start_time, bs.game_date::timestamptz + interval '19 hours') as start_time,
        bs.game_date,
        bg.status,
        bg.home_score,
        bg.away_score,
        bs.home_team_id,
        bs.away_team_id,
        ht.full_name as home_team_name,
        ht.abbreviation as home_team_abbr,
        at.full_name as away_team_name,
        at.abbreviation as away_team_abbr
      FROM bbref_schedule bs
      JOIN teams ht ON bs.home_team_id = ht.team_id
      JOIN teams at ON bs.away_team_id = at.team_id
      LEFT JOIN bbref_games bg ON bs.bbref_game_id = bg.bbref_game_id
      WHERE bs.bbref_game_id = $1 
         OR bs.canonical_game_id = $1
         OR bg.bbref_game_id = $1
      LIMIT 1
    `, [gameId]);

    if (gameResult.length === 0) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    const game = gameResult[0];
    const resolvedGameId = game.game_id; // Use canonical_game_id if available, otherwise bbref_game_id

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

    // Build response
    const response = {
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

