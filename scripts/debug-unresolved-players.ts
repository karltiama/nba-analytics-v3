/**
 * Debug Unresolved Players
 * 
 * Helps identify which players from Odds API are failing to resolve.
 * Shows potential matches and suggests fixes.
 * 
 * Usage:
 *   npx tsx scripts/debug-unresolved-players.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

if (!ODDS_API_KEY) {
  console.error('Missing ODDS_API_KEY. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// Team name to abbreviation mapping
const ODDS_API_TEAM_TO_ABBR: Record<string, string> = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BRK',
  'Charlotte Hornets': 'CHO',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC',
  'LA Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Phoenix Suns': 'PHO',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA',
  'Washington Wizards': 'WAS',
};

function getTeamAbbr(teamName: string): string | null {
  return ODDS_API_TEAM_TO_ABBR[teamName] || null;
}

async function getTodaysGamesFromSchedule() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  
  const result = await pool.query(`
    SELECT 
      COALESCE(canonical_game_id, bbref_game_id) as game_id,
      home_team_abbr,
      away_team_abbr,
      game_date::text as game_date
    FROM bbref_schedule
    WHERE game_date = $1::date
    ORDER BY COALESCE(start_time, game_date::timestamptz) ASC
  `, [today]);

  return result.rows;
}

async function fetchPlayerProps(eventId: string) {
  const PLAYER_PROP_MARKETS = [
    'player_points',
    'player_rebounds',
    'player_assists',
    'player_threes',
    'player_blocks',
    'player_double_double',
    'player_triple_double',
    'player_first_basket',
  ];

  try {
    const url = new URL(`${ODDS_API_BASE}/sports/basketball_nba/events/${eventId}/odds`);
    url.searchParams.set('apiKey', ODDS_API_KEY);
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', PLAYER_PROP_MARKETS.join(','));
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('dateFormat', 'iso');

    const response = await fetch(url.toString());

    if (!response.ok) {
      if (response.status === 404 || response.status === 422) {
        return null;
      }
      throw new Error(`Player props API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn(`  ⚠️  Error fetching player props: ${error.message}`);
    return null;
  }
}

async function findPotentialMatches(playerName: string, homeTeamAbbr: string, awayTeamAbbr: string) {
  const nameParts = playerName.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts[nameParts.length - 1] || '';
  
  const matches: Array<{ player_id: string; full_name: string; team: string; match_type: string }> = [];
  
  // Check both teams
  for (const teamAbbr of [homeTeamAbbr, awayTeamAbbr]) {
    // Exact match
    const exact = await pool.query(`
      SELECT p.player_id, p.full_name, t.abbreviation as team
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.full_name) = LOWER($1)
        AND t.abbreviation = $2
    `, [playerName, teamAbbr]);
    
    exact.rows.forEach((row: any) => {
      matches.push({ ...row, match_type: 'exact' });
    });
    
    // Last name match
    if (lastName) {
      const last = await pool.query(`
        SELECT p.player_id, p.full_name, t.abbreviation as team
        FROM players p
        JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
        JOIN teams t ON ptr.team_id = t.team_id
        WHERE LOWER(p.last_name) = LOWER($1)
          AND t.abbreviation = $2
      `, [lastName, teamAbbr]);
      
      last.rows.forEach((row: any) => {
        if (!matches.find(m => m.player_id === row.player_id)) {
          matches.push({ ...row, match_type: 'last_name' });
        }
      });
    }
    
    // Partial match
    const partial = await pool.query(`
      SELECT p.player_id, p.full_name, t.abbreviation as team
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.full_name) LIKE LOWER($1)
        AND t.abbreviation = $2
    `, [`%${playerName}%`, teamAbbr]);
    
    partial.rows.forEach((row: any) => {
      if (!matches.find(m => m.player_id === row.player_id)) {
        matches.push({ ...row, match_type: 'partial' });
      }
    });
  }
  
  // Check without team filter
  const noTeam = await pool.query(`
    SELECT p.player_id, p.full_name
    FROM players p
    WHERE LOWER(p.full_name) LIKE LOWER($1)
    LIMIT 5
  `, [`%${playerName}%`]);
  
  noTeam.rows.forEach((row: any) => {
    if (!matches.find(m => m.player_id === row.player_id)) {
      matches.push({ ...row, team: 'unknown', match_type: 'no_team' });
    }
  });
  
  return matches;
}

async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG UNRESOLVED PLAYERS');
  console.log('='.repeat(80));
  
  // Get today's games
  const scheduledGames = await getTodaysGamesFromSchedule();
  console.log(`\n📅 Found ${scheduledGames.length} games scheduled for today\n`);
  
  if (scheduledGames.length === 0) {
    console.log('⚠️  No games scheduled for today. Exiting.');
    return;
  }
  
  // Fetch team odds to get event IDs
  const url = new URL(`${ODDS_API_BASE}/sports/basketball_nba/odds`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('dateFormat', 'iso');
  
  const teamOddsResponse = await fetch(url.toString());
  if (!teamOddsResponse.ok) {
    throw new Error(`Team odds API error: ${teamOddsResponse.status}`);
  }
  const teamOddsEvents = await teamOddsResponse.json();
  
  // Match events to scheduled games
  const matchedEvents: Array<{ event: any; scheduledGame: any }> = [];
  for (const scheduledGame of scheduledGames) {
    const homeAbbr = scheduledGame.home_team_abbr;
    const awayAbbr = scheduledGame.away_team_abbr;
    
    const matchingEvent = teamOddsEvents.find((event: any) => {
      const eventHomeAbbr = getTeamAbbr(event.home_team);
      const eventAwayAbbr = getTeamAbbr(event.away_team);
      return eventHomeAbbr === homeAbbr && eventAwayAbbr === awayAbbr;
    });
    
    if (matchingEvent) {
      matchedEvents.push({ event: matchingEvent, scheduledGame });
    }
  }
  
  console.log(`✅ Matched ${matchedEvents.length} events to scheduled games\n`);
  
  // Collect all unique player names from player props
  const allPlayerNames = new Set<string>();
  const playerNameToGame = new Map<string, { matchup: string; homeAbbr: string; awayAbbr: string }>();
  
  for (const { event, scheduledGame } of matchedEvents) {
    const homeAbbr = scheduledGame.home_team_abbr;
    const awayAbbr = scheduledGame.away_team_abbr;
    const matchup = `${awayAbbr} @ ${homeAbbr}`;
    
    console.log(`📥 Fetching player props for: ${matchup}`);
    const playerPropsData = await fetchPlayerProps(event.id);
    
    if (playerPropsData && playerPropsData.bookmakers) {
      for (const bookmaker of playerPropsData.bookmakers) {
            for (const market of bookmaker.markets || []) {
              if (market.key.startsWith('player_')) {
                for (const outcome of market.outcomes || []) {
                  // For player props, player name is in description, not name
                  const playerName = outcome.description || outcome.name;
                  allPlayerNames.add(playerName);
                  if (!playerNameToGame.has(playerName)) {
                    playerNameToGame.set(playerName, { matchup, homeAbbr, awayAbbr });
                  }
                }
              }
            }
      }
    }
  }
  
  console.log(`\n📊 Found ${allPlayerNames.size} unique player names in player props\n`);
  
  // Try to resolve each player and show failures
  const unresolved: Array<{ name: string; game: string; potentialMatches: any[] }> = [];
  
  for (const playerName of allPlayerNames) {
    const gameInfo = playerNameToGame.get(playerName)!;
    const potentialMatches = await findPotentialMatches(playerName, gameInfo.homeAbbr, gameInfo.awayAbbr);
    
    if (potentialMatches.length === 0) {
      unresolved.push({
        name: playerName,
        game: gameInfo.matchup,
        potentialMatches: [],
      });
    } else if (potentialMatches.length > 0 && potentialMatches[0].match_type !== 'exact') {
      // Has matches but not exact - might be a resolution issue
      unresolved.push({
        name: playerName,
        game: gameInfo.matchup,
        potentialMatches,
      });
    }
  }
  
  // Report results
  console.log('='.repeat(80));
  console.log('UNRESOLVED PLAYERS REPORT');
  console.log('='.repeat(80));
  console.log(`\nTotal Players: ${allPlayerNames.size}`);
  console.log(`Unresolved: ${unresolved.length}`);
  console.log(`Resolved: ${allPlayerNames.size - unresolved.length}`);
  
  if (unresolved.length > 0) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log('UNRESOLVED PLAYERS:');
    console.log('─'.repeat(80));
    
    for (const { name, game, potentialMatches } of unresolved) {
      console.log(`\n❌ ${name} (${game})`);
      if (potentialMatches.length === 0) {
        console.log(`   No matches found in database`);
      } else {
        console.log(`   Potential matches:`);
        potentialMatches.forEach(match => {
          console.log(`     - ${match.full_name} (${match.team || 'unknown'}) [${match.match_type}]`);
        });
      }
    }
  } else {
    console.log(`\n✅ All players resolved!`);
  }
  
  await pool.end();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

