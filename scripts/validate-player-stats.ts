import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Player Stats Validation Script
 *
 * Validates core player stats (minutes, points, FGA, FTA, 3PA, rebounds,
 * assists, turnovers) in bbref_player_game_stats against multiple checks.
 * Results are stored in game_validation_results for the admin UI.
 *
 * Checks:
 *   1. score_reconciliation   — player points sum matches game score
 *   2. cross_source_scores    — BDL vs BBRef game scores agree
 *   3. points_formula         — pts = 2*FGM + 3PM + FTM per player
 *   4. shooting_math          — FGA >= FGM, FTA >= FTM, 3PA >= 3PM, 3PM <= FGM
 *   5. minutes_sanity         — team total ~240 min, individual 0-60
 *   6. stat_bounds            — no negatives, reasonable maximums
 *   7. completeness           — 8-15 active players per team per game
 *
 * Usage:
 *   npx tsx scripts/validate-player-stats.ts
 *   npx tsx scripts/validate-player-stats.ts --start-date 2025-12-01
 *   npx tsx scripts/validate-player-stats.ts --end-date 2026-02-01
 *   npx tsx scripts/validate-player-stats.ts --team CLE
 *   npx tsx scripts/validate-player-stats.ts --game-id bbref_202512180CLE_DET_CLE
 *   npx tsx scripts/validate-player-stats.ts --unvalidated
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

if (!process.env.SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────

interface PlayerRow {
  game_id: string;
  player_id: string;
  team_id: string;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  turnovers: number | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  three_pointers_made: number | null;
  three_pointers_attempted: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  dnp_reason: string | null;
  player_name: string;
}

interface GameRow {
  bbref_game_id: string;
  game_date: string;
  home_team_id: string;
  away_team_id: string;
  home_team_abbr: string;
  away_team_abbr: string;
  home_score: number | null;
  away_score: number | null;
}

interface ValidationResult {
  game_id: string;
  check_name: string;
  status: 'pass' | 'fail' | 'warn';
  severity: 'error' | 'warning' | 'info';
  details: Record<string, any> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function n(v: any): number {
  return typeof v === 'number' ? v : (parseFloat(v) || 0);
}

// ─── Checks ───────────────────────────────────────────────────────────

function checkScoreReconciliation(game: GameRow, players: PlayerRow[]): ValidationResult {
  const active = players.filter(p => !p.dnp_reason);
  const teamPoints: Record<string, number> = {};

  for (const p of active) {
    teamPoints[p.team_id] = (teamPoints[p.team_id] || 0) + n(p.points);
  }

  const failures: Array<{ team_id: string; expected: number; actual: number }> = [];

  if (game.home_score !== null && teamPoints[game.home_team_id] !== undefined) {
    if (teamPoints[game.home_team_id] !== game.home_score) {
      failures.push({
        team_id: game.home_team_id,
        expected: game.home_score,
        actual: teamPoints[game.home_team_id],
      });
    }
  }
  if (game.away_score !== null && teamPoints[game.away_team_id] !== undefined) {
    if (teamPoints[game.away_team_id] !== game.away_score) {
      failures.push({
        team_id: game.away_team_id,
        expected: game.away_score,
        actual: teamPoints[game.away_team_id],
      });
    }
  }

  if (failures.length > 0) {
    return {
      game_id: game.bbref_game_id,
      check_name: 'score_reconciliation',
      status: 'fail',
      severity: 'error',
      details: { message: 'Player points sum does not match game score', failures },
    };
  }

  return {
    game_id: game.bbref_game_id,
    check_name: 'score_reconciliation',
    status: 'pass',
    severity: 'info',
    details: null,
  };
}

async function checkCrossSourceScores(game: GameRow): Promise<ValidationResult> {
  const result = await pool.query(`
    SELECT g.home_score as bdl_home, g.away_score as bdl_away
    FROM bbref_schedule bs
    JOIN games g ON bs.canonical_game_id = g.game_id
    WHERE bs.bbref_game_id = $1
      AND g.home_score IS NOT NULL
      AND g.away_score IS NOT NULL
    LIMIT 1
  `, [game.bbref_game_id]);

  if (result.rows.length === 0) {
    return {
      game_id: game.bbref_game_id,
      check_name: 'cross_source_scores',
      status: 'pass',
      severity: 'info',
      details: { message: 'No BDL game linked — skipped' },
    };
  }

  const bdl = result.rows[0];
  const mismatches: string[] = [];

  if (game.home_score !== null && n(bdl.bdl_home) !== game.home_score) {
    mismatches.push(`home: BDL=${bdl.bdl_home} BBRef=${game.home_score}`);
  }
  if (game.away_score !== null && n(bdl.bdl_away) !== game.away_score) {
    mismatches.push(`away: BDL=${bdl.bdl_away} BBRef=${game.away_score}`);
  }

  if (mismatches.length > 0) {
    return {
      game_id: game.bbref_game_id,
      check_name: 'cross_source_scores',
      status: 'fail',
      severity: 'error',
      details: { message: 'BDL and BBRef scores disagree', mismatches },
    };
  }

  return {
    game_id: game.bbref_game_id,
    check_name: 'cross_source_scores',
    status: 'pass',
    severity: 'info',
    details: null,
  };
}

function checkPointsFormula(game: GameRow, players: PlayerRow[]): ValidationResult {
  const active = players.filter(p => !p.dnp_reason && p.points !== null);
  const failures: Array<{ player_id: string; player_name: string; points: number; expected: number }> = [];

  for (const p of active) {
    const fgm = n(p.field_goals_made);
    const tpm = n(p.three_pointers_made);
    const ftm = n(p.free_throws_made);
    const expected = 2 * fgm + tpm + ftm;
    const actual = n(p.points);

    if (actual !== expected) {
      failures.push({
        player_id: p.player_id,
        player_name: p.player_name,
        points: actual,
        expected,
      });
    }
  }

  if (failures.length > 0) {
    return {
      game_id: game.bbref_game_id,
      check_name: 'points_formula',
      status: 'fail',
      severity: 'error',
      details: {
        message: `${failures.length} player(s) have points != 2*FGM + 3PM + FTM`,
        failures: failures.slice(0, 10),
      },
    };
  }

  return {
    game_id: game.bbref_game_id,
    check_name: 'points_formula',
    status: 'pass',
    severity: 'info',
    details: null,
  };
}

function checkShootingMath(game: GameRow, players: PlayerRow[]): ValidationResult {
  const active = players.filter(p => !p.dnp_reason);
  const failures: Array<{ player_id: string; player_name: string; violation: string }> = [];

  for (const p of active) {
    const fga = n(p.field_goals_attempted);
    const fgm = n(p.field_goals_made);
    const fta = n(p.free_throws_attempted);
    const ftm = n(p.free_throws_made);
    const tpa = n(p.three_pointers_attempted);
    const tpm = n(p.three_pointers_made);

    if (fga < fgm) failures.push({ player_id: p.player_id, player_name: p.player_name, violation: `FGA(${fga}) < FGM(${fgm})` });
    if (fta < ftm) failures.push({ player_id: p.player_id, player_name: p.player_name, violation: `FTA(${fta}) < FTM(${ftm})` });
    if (tpa < tpm) failures.push({ player_id: p.player_id, player_name: p.player_name, violation: `3PA(${tpa}) < 3PM(${tpm})` });
    if (tpm > fgm) failures.push({ player_id: p.player_id, player_name: p.player_name, violation: `3PM(${tpm}) > FGM(${fgm})` });
  }

  if (failures.length > 0) {
    return {
      game_id: game.bbref_game_id,
      check_name: 'shooting_math',
      status: 'fail',
      severity: 'error',
      details: {
        message: `${failures.length} shooting stat violation(s)`,
        failures: failures.slice(0, 10),
      },
    };
  }

  return {
    game_id: game.bbref_game_id,
    check_name: 'shooting_math',
    status: 'pass',
    severity: 'info',
    details: null,
  };
}

function checkMinutesSanity(game: GameRow, players: PlayerRow[]): ValidationResult {
  const active = players.filter(p => !p.dnp_reason && p.minutes !== null);
  const failures: Array<{ context: string; value: number; issue: string }> = [];

  // Per-team totals
  const teamMinutes: Record<string, number> = {};
  for (const p of active) {
    const min = n(p.minutes);
    teamMinutes[p.team_id] = (teamMinutes[p.team_id] || 0) + min;

    if (min < 0 || min > 60) {
      failures.push({
        context: `${p.player_name} (${p.player_id})`,
        value: min,
        issue: `Individual minutes out of range (0-60)`,
      });
    }
  }

  for (const [teamId, total] of Object.entries(teamMinutes)) {
    if (total < 235 || total > 295) {
      failures.push({
        context: `team ${teamId}`,
        value: Math.round(total * 10) / 10,
        issue: total < 235
          ? 'Team total minutes too low (expected ~240+)'
          : 'Team total minutes too high (possible double-count or bad data)',
      });
    }
  }

  if (failures.length > 0) {
    const hasError = failures.some(f => f.issue.includes('too low') || f.issue.includes('too high'));
    return {
      game_id: game.bbref_game_id,
      check_name: 'minutes_sanity',
      status: hasError ? 'warn' : 'fail',
      severity: hasError ? 'warning' : 'error',
      details: { message: `${failures.length} minutes issue(s)`, failures },
    };
  }

  return {
    game_id: game.bbref_game_id,
    check_name: 'minutes_sanity',
    status: 'pass',
    severity: 'info',
    details: null,
  };
}

function checkStatBounds(game: GameRow, players: PlayerRow[]): ValidationResult {
  const active = players.filter(p => !p.dnp_reason);
  const failures: Array<{ player_id: string; player_name: string; violation: string }> = [];

  const limits: Record<string, number> = {
    points: 80,
    rebounds: 35,
    assists: 30,
    turnovers: 15,
    field_goals_attempted: 50,
    free_throws_attempted: 35,
    three_pointers_attempted: 30,
  };

  const statKeys = [
    'points', 'rebounds', 'assists', 'turnovers',
    'field_goals_made', 'field_goals_attempted',
    'three_pointers_made', 'three_pointers_attempted',
    'free_throws_made', 'free_throws_attempted',
  ] as const;

  for (const p of active) {
    for (const key of statKeys) {
      const val = (p as any)[key];
      if (val === null || val === undefined) continue;

      if (n(val) < 0) {
        failures.push({ player_id: p.player_id, player_name: p.player_name, violation: `${key} is negative (${val})` });
      }

      if (key in limits && n(val) > limits[key]) {
        failures.push({ player_id: p.player_id, player_name: p.player_name, violation: `${key}=${val} exceeds max ${limits[key]}` });
      }
    }

    // Minutes > 0 when stats exist
    const hasStats = n(p.points) > 0 || n(p.rebounds) > 0 || n(p.assists) > 0;
    if (hasStats && (p.minutes === null || n(p.minutes) <= 0)) {
      failures.push({ player_id: p.player_id, player_name: p.player_name, violation: 'Has stats but minutes is 0 or null' });
    }
  }

  if (failures.length > 0) {
    return {
      game_id: game.bbref_game_id,
      check_name: 'stat_bounds',
      status: 'fail',
      severity: 'error',
      details: {
        message: `${failures.length} stat bound violation(s)`,
        failures: failures.slice(0, 10),
      },
    };
  }

  return {
    game_id: game.bbref_game_id,
    check_name: 'stat_bounds',
    status: 'pass',
    severity: 'info',
    details: null,
  };
}

function checkCompleteness(game: GameRow, players: PlayerRow[]): ValidationResult {
  const active = players.filter(p => !p.dnp_reason);
  const teamCounts: Record<string, number> = {};

  for (const p of active) {
    teamCounts[p.team_id] = (teamCounts[p.team_id] || 0) + 1;
  }

  const failures: Array<{ team_id: string; count: number; issue: string }> = [];

  for (const [teamId, count] of Object.entries(teamCounts)) {
    if (count < 8) {
      failures.push({ team_id: teamId, count, issue: `Only ${count} active players (expected 8-15)` });
    }
  }

  // Also check if a team has zero players at all
  for (const teamId of [game.home_team_id, game.away_team_id]) {
    if (!teamCounts[teamId]) {
      failures.push({ team_id: teamId, count: 0, issue: 'No player stats found for team' });
    }
  }

  if (failures.length > 0) {
    return {
      game_id: game.bbref_game_id,
      check_name: 'completeness',
      status: 'fail',
      severity: 'error',
      details: { message: `${failures.length} completeness issue(s)`, failures },
    };
  }

  return {
    game_id: game.bbref_game_id,
    check_name: 'completeness',
    status: 'pass',
    severity: 'info',
    details: null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────

async function upsertResult(r: ValidationResult): Promise<void> {
  await pool.query(`
    INSERT INTO game_validation_results (game_id, check_name, status, severity, details, validated_at)
    VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (game_id, check_name)
    DO UPDATE SET status = $3, severity = $4, details = $5, validated_at = now()
  `, [r.game_id, r.check_name, r.status, r.severity, r.details ? JSON.stringify(r.details) : null]);
}

async function main() {
  const args = process.argv.slice(2);
  const startDateIdx = args.indexOf('--start-date');
  const endDateIdx = args.indexOf('--end-date');
  const teamIdx = args.indexOf('--team');
  const gameIdIdx = args.indexOf('--game-id');
  const unvalidated = args.includes('--unvalidated');

  const startDate = startDateIdx !== -1 ? args[startDateIdx + 1] : undefined;
  const endDate = endDateIdx !== -1 ? args[endDateIdx + 1] : undefined;
  const team = teamIdx !== -1 ? args[teamIdx + 1]?.toUpperCase() : undefined;
  const gameId = gameIdIdx !== -1 ? args[gameIdIdx + 1] : undefined;

  console.log('\nPlayer Stats Validation');
  console.log('='.repeat(60));
  if (startDate || endDate) console.log(`Date range: ${startDate || 'start'} to ${endDate || 'now'}`);
  if (team) console.log(`Team filter: ${team}`);
  if (gameId) console.log(`Single game: ${gameId}`);
  if (unvalidated) console.log('Mode: unvalidated games only');
  console.log('');

  // Build game query
  let gamesSql = `
    SELECT bg.bbref_game_id, bg.game_date, bg.home_team_id, bg.away_team_id,
           bg.home_team_abbr, bg.away_team_abbr, bg.home_score, bg.away_score
    FROM bbref_games bg
    WHERE bg.status = 'Final'
  `;
  const params: any[] = [];
  let paramCount = 1;

  if (gameId) {
    gamesSql += ` AND bg.bbref_game_id = $${paramCount}`;
    params.push(gameId);
    paramCount++;
  }

  if (startDate) {
    gamesSql += ` AND bg.game_date >= $${paramCount}::date`;
    params.push(startDate);
    paramCount++;
  }

  if (endDate) {
    gamesSql += ` AND bg.game_date <= $${paramCount}::date`;
    params.push(endDate);
    paramCount++;
  }

  if (team) {
    gamesSql += ` AND (bg.home_team_abbr = $${paramCount} OR bg.away_team_abbr = $${paramCount})`;
    params.push(team);
    paramCount++;
  }

  if (unvalidated) {
    gamesSql += `
      AND NOT EXISTS (
        SELECT 1 FROM game_validation_results gvr
        WHERE gvr.game_id = bg.bbref_game_id
      )
    `;
  }

  gamesSql += ' ORDER BY bg.game_date ASC';

  const gamesResult = await pool.query(gamesSql, params);
  const games: GameRow[] = gamesResult.rows;

  if (games.length === 0) {
    console.log('No games found matching filters.');
    await pool.end();
    return;
  }

  console.log(`Found ${games.length} game(s) to validate\n`);

  let totals = { pass: 0, fail: 0, warn: 0 };
  let gamesWithIssues = 0;

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const dateStr = new Date(game.game_date).toISOString().split('T')[0];

    // Fetch player stats for this game (join players for name)
    const playersResult = await pool.query(`
      SELECT bpgs.*, p.full_name as player_name
      FROM bbref_player_game_stats bpgs
      JOIN players p ON bpgs.player_id = p.player_id
      WHERE bpgs.game_id = $1
    `, [game.bbref_game_id]);
    const players: PlayerRow[] = playersResult.rows;

    // Run all checks
    const results: ValidationResult[] = [
      checkScoreReconciliation(game, players),
      await checkCrossSourceScores(game),
      checkPointsFormula(game, players),
      checkShootingMath(game, players),
      checkMinutesSanity(game, players),
      checkStatBounds(game, players),
      checkCompleteness(game, players),
    ];

    // Upsert results
    for (const r of results) {
      await upsertResult(r);
      totals[r.status]++;
    }

    const fails = results.filter(r => r.status === 'fail');
    const warns = results.filter(r => r.status === 'warn');
    const hasIssues = fails.length > 0 || warns.length > 0;
    if (hasIssues) gamesWithIssues++;

    // Progress line
    const icon = fails.length > 0 ? 'X' : warns.length > 0 ? '!' : '+';
    const issueStr = hasIssues
      ? ` -- ${fails.map(f => f.check_name).concat(warns.map(w => `~${w.check_name}`)).join(', ')}`
      : '';
    process.stdout.write(`  [${icon}] ${dateStr} ${game.away_team_abbr}@${game.home_team_abbr}${issueStr}\n`);

    // Print every 100 games
    if ((i + 1) % 100 === 0) {
      console.log(`  ... ${i + 1}/${games.length} validated`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Games validated:  ${games.length}`);
  console.log(`Games with issues: ${gamesWithIssues}`);
  console.log(`Checks passed:    ${totals.pass}`);
  console.log(`Checks warned:    ${totals.warn}`);
  console.log(`Checks failed:    ${totals.fail}`);
  console.log(`Total checks run: ${totals.pass + totals.warn + totals.fail}`);
  console.log('='.repeat(60) + '\n');

  if (totals.fail > 0) {
    console.log('Failed checks breakdown:');
    const breakdown = await pool.query(`
      SELECT check_name, COUNT(*) as count
      FROM game_validation_results
      WHERE status = 'fail'
      GROUP BY check_name
      ORDER BY count DESC
    `);
    for (const row of breakdown.rows) {
      console.log(`  ${row.check_name}: ${row.count} game(s)`);
    }
    console.log('');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
