/**
 * Server-only research overview. Reads analytics.games and the existing 2025–26
 * historical queries. It does not read the scoreboard, write, or call a provider.
 */

import { CURRENT_NBA_ABBREVIATIONS } from '@/lib/roster/bdl-active-roster';
import { resolveGameLifecycle } from '@/lib/betting/normalize-game-status';
import { buildPregameMatchup } from './compose';
import { playerRow, teamRow } from './rows';
import { historicalPlayerQuery, historicalTeamQuery, teamIdentityQuery } from './queries';
import { presentRoster } from './roster';
import { loadRosterContinuity } from './roster-load';
import {
  etCalendarDate,
  researchOverviewAllowsLifecycle,
  researchOverviewFromModel,
  researchOverviewTemporalDecision,
  type ResearchHistoricalOverview,
} from './research-overview';
import { historicalWindow } from './window';

type Sql = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const CURRENT_ABBREVIATIONS = new Set<string>(CURRENT_NBA_ABBREVIATIONS);

async function defaultPool() {
  const { default: pool } = await import('@/lib/db');
  return pool;
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function instant(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function currentFranchise(abbreviation: string, conference: string): boolean {
  const abbr = abbreviation.trim().toUpperCase();
  const side = conference.trim().toLowerCase();
  return CURRENT_ABBREVIATIONS.has(abbr) && (side === 'east' || side === 'west');
}

function sameAbbr(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

type IdentityRow = { teamId: string; abbreviation: string; conference: string };

function identityRows(rows: Record<string, unknown>[]): IdentityRow[] {
  return rows.flatMap((row) => {
    const teamId = text(row.team_id);
    const abbreviation = text(row.abbreviation);
    const conference = text(row.conference);
    if (!teamId || !abbreviation) return [];
    return [{ teamId, abbreviation, conference }];
  });
}

function confirmedIdentity(input: {
  awayTeamId: string;
  homeTeamId: string;
  awayAbbr: string;
  homeAbbr: string;
  awayConference: string;
  homeConference: string;
  rows: IdentityRow[];
}): boolean {
  if (input.awayTeamId === input.homeTeamId) return false;
  if (!currentFranchise(input.awayAbbr, input.awayConference)) return false;
  if (!currentFranchise(input.homeAbbr, input.homeConference)) return false;
  if (sameAbbr(input.awayAbbr, input.homeAbbr)) return false;
  const matches = (teamId: string, abbreviation: string, conference: string) =>
    input.rows.filter(
      (row) =>
        row.teamId === teamId &&
        sameAbbr(row.abbreviation, abbreviation) &&
        currentFranchise(row.abbreviation, row.conference) &&
        sameAbbr(row.conference, conference)
    );
  return matches(input.awayTeamId, input.awayAbbr, input.awayConference).length === 1
    && matches(input.homeTeamId, input.homeAbbr, input.homeConference).length === 1;
}

const GAME_SQL = `SELECT g.game_id,
       g.start_time,
       g.status,
       g.home_score,
       g.away_score,
       g.home_team_id,
       g.away_team_id,
       ht.full_name AS home_team_name,
       ht.abbreviation AS home_team_abbr,
       ht.conference AS home_conference,
       at.full_name AS away_team_name,
       at.abbreviation AS away_team_abbr,
       at.conference AS away_conference
FROM analytics.games g
JOIN analytics.teams ht ON g.home_team_id = ht.team_id
JOIN analytics.teams at ON g.away_team_id = at.team_id
WHERE g.game_id = $1
LIMIT 1`;

export async function loadResearchOverview(input: {
  gameId: string;
  now?: Date;
  query?: Sql;
}): Promise<ResearchHistoricalOverview | null> {
  const gameId = input.gameId.trim();
  if (!gameId) return null;
  const now = input.now ?? new Date();
  const run = input.query ?? (async (textSql, params) => {
    const result = await (await defaultPool()).query(textSql, params);
    return result.rows as Record<string, unknown>[];
  });

  try {
    const gameRows = await run(GAME_SQL, [gameId]);
    const game = gameRows[0];
    if (!game || gameRows.length !== 1) return null;

    const tipoff = instant(game.start_time);
    const gameEtDate = tipoff ? etCalendarDate(tipoff) : null;
    const temporal = researchOverviewTemporalDecision(gameEtDate);
    if (!temporal.eligible || !tipoff) return null;

    const lifecycle = resolveGameLifecycle({
      statusRaw: game.status == null ? null : String(game.status),
      startTime: tipoff,
      homeScore: num(game.home_score),
      awayScore: num(game.away_score),
      now,
    });
    if (!researchOverviewAllowsLifecycle(lifecycle)) return null;

    const awayTeamId = text(game.away_team_id);
    const homeTeamId = text(game.home_team_id);
    const awayAbbr = text(game.away_team_abbr);
    const homeAbbr = text(game.home_team_abbr);
    const awayName = text(game.away_team_name) || awayAbbr;
    const homeName = text(game.home_team_name) || homeAbbr;
    const awayConference = text(game.away_conference);
    const homeConference = text(game.home_conference);
    if (!awayTeamId || !homeTeamId || !awayAbbr || !homeAbbr) return null;

    const window = historicalWindow();
    const teamIds: [string, string] = [awayTeamId, homeTeamId];
    const teamQuery = historicalTeamQuery(window);
    const playerQuery = historicalPlayerQuery(window, teamIds);
    const identity = teamIdentityQuery(teamIds);
    const rosterGameDate = temporal.gameEtDate;
    const tipoffAt = tipoff.toISOString();

    const [teamResult, playerResult, identityResult, roster] = await Promise.all([
      run(teamQuery.text, teamQuery.params),
      run(playerQuery.text, playerQuery.params),
      run(identity.text, identity.params),
      loadRosterContinuity(run, {
        gameDate: rosterGameDate,
        tipoffAt,
        teamIds,
        awayAbbr,
        homeAbbr,
        window,
      }).catch((error: unknown) => {
        console.error('[research-overview] roster read failed', {
          gameId,
          error: error instanceof Error ? error.name : 'unknown',
        });
        return presentRoster({ gameDate: rosterGameDate, day: null, teams: [] });
      }),
    ]);

    if (!confirmedIdentity({
      awayTeamId,
      homeTeamId,
      awayAbbr,
      homeAbbr,
      awayConference,
      homeConference,
      rows: identityRows(identityResult),
    })) {
      return null;
    }

    const model = buildPregameMatchup({
      gameId,
      awayTeamId,
      homeTeamId,
      awayAbbr,
      awayName,
      homeAbbr,
      homeName,
      tipLabel: '',
      seasonLabel: '',
      statusLabel: '',
      updatedLabel: '',
      returnHref: '',
      identityConfirmed: true,
      teamRows: teamResult.map(teamRow).filter((row) => row != null),
      playerRows: playerResult.map(playerRow).filter((row) => row != null),
      roster,
      quote: { quote: null, note: null },
    });
    return researchOverviewFromModel(model);
  } catch (error: unknown) {
    console.error('[research-overview] load failed', {
      gameId,
      error: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}
