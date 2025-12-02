import 'dotenv/config';
import { Pool } from 'pg';

/**
 * List Roster Issues
 * 
 * Identifies players who appear in box scores but aren't on the team's active roster
 * 
 * Usage:
 *   tsx scripts/list-roster-issues.ts
 *   tsx scripts/list-roster-issues.ts --team CLE  # Check specific team
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

interface RosterIssue {
  team_id: string;
  team_abbr: string;
  team_name: string;
  player_id: string;
  player_name: string;
  games_played: number;
  season: string;
}

async function getRosterIssues(teamAbbr?: string): Promise<RosterIssue[]> {
  // Get the most common season per team from their games
  const query = `
    WITH team_seasons AS (
      SELECT DISTINCT
        bpgs.team_id,
        COALESCE(
          (SELECT season 
           FROM bbref_games bg2 
           JOIN bbref_player_game_stats bpgs2 ON bg2.bbref_game_id = bpgs2.game_id
           WHERE bpgs2.team_id = bpgs.team_id 
             AND bg2.status = 'Final'
           GROUP BY season 
           ORDER BY COUNT(*) DESC 
           LIMIT 1),
          '2025'
        ) as current_season
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final'
      GROUP BY bpgs.team_id
    ),
    players_not_on_roster AS (
      SELECT 
        bpgs.team_id,
        t.abbreviation as team_abbr,
        t.full_name as team_name,
        bpgs.player_id,
        p.full_name as player_name,
        COUNT(DISTINCT bpgs.game_id) as games_played,
        ts.current_season as season
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      JOIN players p ON bpgs.player_id = p.player_id
      JOIN teams t ON bpgs.team_id = t.team_id
      JOIN team_seasons ts ON bpgs.team_id = ts.team_id
      WHERE bg.status = 'Final'
        AND NOT EXISTS (
          SELECT 1 
          FROM player_team_rosters ptr
          WHERE ptr.player_id = bpgs.player_id
            AND ptr.team_id = bpgs.team_id
            AND ptr.active = true
            AND ptr.season = ts.current_season
        )
        ${teamAbbr ? `AND t.abbreviation = $1` : ''}
      GROUP BY bpgs.team_id, t.abbreviation, t.full_name, bpgs.player_id, p.full_name, ts.current_season
    )
    SELECT * FROM players_not_on_roster
    ORDER BY team_abbr, games_played DESC, player_name
  `;

  const result = await pool.query(query, teamAbbr ? [teamAbbr] : []);
  return result.rows;
}

async function main() {
  const args = process.argv.slice(2);
  const teamIndex = args.indexOf('--team');
  const teamAbbr = teamIndex >= 0 && args[teamIndex + 1] ? args[teamIndex + 1] : undefined;

  console.log('\n🔍 Finding Roster Issues...\n');
  
  if (teamAbbr) {
    console.log(`Filtering to team: ${teamAbbr}\n`);
  }

  const issues = await getRosterIssues(teamAbbr);

  if (issues.length === 0) {
    console.log('✅ No roster issues found! All players in box scores are on active rosters.\n');
    await pool.end();
    return;
  }

  // Group by team
  const byTeam = new Map<string, RosterIssue[]>();
  issues.forEach(issue => {
    if (!byTeam.has(issue.team_abbr)) {
      byTeam.set(issue.team_abbr, []);
    }
    byTeam.get(issue.team_abbr)!.push(issue);
  });

  console.log(`Found ${issues.length} roster issues across ${byTeam.size} teams:\n`);

  for (const [teamAbbr, teamIssues] of Array.from(byTeam.entries()).sort()) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${teamAbbr} (${teamIssues.length} issues)`);
    console.log(`${'='.repeat(80)}`);
    
    teamIssues.forEach((issue, idx) => {
      console.log(`\n${idx + 1}. ${issue.player_name} [${issue.player_id}]`);
      console.log(`   Games played: ${issue.games_played}`);
      console.log(`   Season: ${issue.season}`);
      console.log(`   Status: Not on active roster for ${teamAbbr}`);
    });
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`\n📊 Summary:`);
  console.log(`   Total issues: ${issues.length}`);
  console.log(`   Teams affected: ${byTeam.size}`);
  
  console.log(`\n💡 To fix these issues, run:`);
  console.log(`   tsx scripts/fix-roster-issues.ts${teamAbbr ? ` --team ${teamAbbr}` : ''}`);
  console.log(`\n   Or fix manually using:`);
  console.log(`   tsx scripts/add-unresolved-players.ts\n`);

  await pool.end();
}

main().catch(console.error);


