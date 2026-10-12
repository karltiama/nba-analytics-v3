/**
 * Server-only loader. Reads one scoreboard game and the 2025–26 regular-season window.
 * Does not write, and does not call a provider.
 */

import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { isScoreboardMarketServingEnabled } from '@/lib/scoreboard/flags';
import { formatObservedAt, lifecycleLabel, seasonLabel } from '@/lib/scoreboard/present';
import { createPgScoreboardStore, type ScoreboardStore } from '@/lib/scoreboard/store';
import type { PlayerSumRow, TeamSumRow } from './aggregate';
import { buildPregameMatchup, type PregameMatchupModel } from './compose';
import { dashboardReturnHref, parseSlateDate } from './href';
import { historicalPlayerQuery, historicalTeamQuery, teamIdentityQuery } from './queries';
import { resolveMatchupQuote } from './quote';
import { presentRoster } from './roster';
import { loadRosterContinuity } from './roster-load';
import { historicalWindow } from './window';

type Sql = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

async function defaultPool() {
  const { default: pool } = await import('@/lib/db');
  return pool;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function requiredNum(value: unknown): number | null {
  return num(value);
}

function teamRow(row: Record<string, unknown>): TeamSumRow | null {
  const teamId = row.team_id == null ? '' : String(row.team_id);
  const fields = [
    'rows',
    'games',
    'points',
    'points_allowed',
    'possessions',
    'fgm',
    'fga',
    'fg3m',
    'fg3a',
    'fta',
    'turnovers',
    'offensive_rebounds',
    'defensive_rebounds',
    'opponent_offensive_rebounds',
    'opponent_defensive_rebounds',
    'bad_possessions',
    'bad_shot',
    'bad_rebounds',
    'bad_turnovers',
  ] as const;
  const values = fields.map((field) => requiredNum(row[field]));
  if (!teamId || values.some((value) => value == null)) return null;
  const [
    rows,
    games,
    points,
    pointsAllowed,
    possessions,
    fgm,
    fga,
    fg3m,
    fg3a,
    fta,
    turnovers,
    offensiveRebounds,
    defensiveRebounds,
    opponentOffensiveRebounds,
    opponentDefensiveRebounds,
    badPossessions,
    badShot,
    badRebounds,
    badTurnovers,
  ] = values as number[];
  return {
    teamId,
    rows,
    games,
    points,
    pointsAllowed,
    possessions,
    fgm,
    fga,
    fg3m,
    fg3a,
    fta,
    turnovers,
    offensiveRebounds,
    defensiveRebounds,
    opponentOffensiveRebounds,
    opponentDefensiveRebounds,
    badPossessions,
    badShot,
    badRebounds,
    badTurnovers,
  };
}

function playerRow(row: Record<string, unknown>): PlayerSumRow | null {
  const teamId = row.team_id == null ? '' : String(row.team_id);
  const playerId = row.player_id == null ? '' : String(row.player_id);
  const games = num(row.games);
  const minutes = num(row.minutes);
  const points = num(row.points);
  const fga = num(row.fga);
  const usageMass = num(row.usage_mass);
  const usagePossessions = num(row.usage_possessions);
  if (!teamId || !playerId || games == null || minutes == null || points == null || fga == null) return null;
  return {
    teamId,
    playerId,
    name: row.full_name == null ? null : String(row.full_name),
    games,
    minutes,
    points,
    fga,
    usageMass: usageMass ?? 0,
    usagePossessions: usagePossessions ?? 0,
  };
}

function sameAbbr(scoreboard: string | null, analytics: string | null | undefined): boolean {
  if (!scoreboard || !analytics) return false;
  return scoreboard.trim().toUpperCase() === analytics.trim().toUpperCase();
}

export async function loadPregameMatchup(input: {
  gameId: string;
  slateDate?: string | null;
  now?: Date;
  env?: Record<string, string | undefined>;
  store?: ScoreboardStore;
  query?: Sql;
}): Promise<PregameMatchupModel | null> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const store = input.store ?? createPgScoreboardStore(await defaultPool());
  const run = input.query ?? (async (text, params) => {
    const result = await (await defaultPool()).query(text, params);
    return result.rows as Record<string, unknown>[];
  });
  const game: StoredScoreboardGame | null = await store.loadGameById(input.gameId);
  if (!game) return null;

  const awayAbbr = game.visitorAbbr?.trim() || 'Away';
  const homeAbbr = game.homeAbbr?.trim() || 'Home';
  let quotes: Awaited<ReturnType<ScoreboardStore['loadCurrentOdds']>> = [];
  if (isScoreboardMarketServingEnabled(env)) {
    try {
      quotes = await store.loadCurrentOdds([game.gameId]);
    } catch {
      quotes = [];
    }
  }
  const quote = resolveMatchupQuote({ game, quotes, now, env, awayAbbr, homeAbbr });

  const window = historicalWindow();
  const teamQuery = historicalTeamQuery(window);
  const teamIds: [string, string] = [game.visitorTeamId, game.homeTeamId];
  const playerQuery = historicalPlayerQuery(window, teamIds);
  const identity = teamIdentityQuery(teamIds);
  const [teamResult, playerResult, identityResult] = await Promise.all([
    run(teamQuery.text, teamQuery.params),
    run(playerQuery.text, playerQuery.params),
    run(identity.text, identity.params),
  ]);
  const identities = new Map(
    identityResult.map((row) => [String(row.team_id), { abbreviation: row.abbreviation == null ? null : String(row.abbreviation), fullName: row.full_name == null ? null : String(row.full_name) }])
  );
  const awayIdentity = identities.get(game.visitorTeamId);
  const homeIdentity = identities.get(game.homeTeamId);
  const identityConfirmed = sameAbbr(game.visitorAbbr, awayIdentity?.abbreviation) && sameAbbr(game.homeAbbr, homeIdentity?.abbreviation);
  let roster = presentRoster({ gameDate: game.etDate, day: null, teams: [] });
  try {
    roster = await loadRosterContinuity(run, {
      gameDate: game.etDate,
      tipoffAt: game.scheduledTip,
      teamIds,
      awayAbbr,
      homeAbbr,
      window,
    });
  } catch {
    roster = presentRoster({ gameDate: game.etDate, day: null, teams: [] });
  }

  return buildPregameMatchup({
    gameId: game.gameId,
    awayTeamId: game.visitorTeamId,
    homeTeamId: game.homeTeamId,
    awayAbbr,
    homeAbbr,
    awayName: game.visitorName?.trim() || awayIdentity?.fullName || awayAbbr,
    homeName: game.homeName?.trim() || homeIdentity?.fullName || homeAbbr,
    tipLabel: formatTipoffEt(game.scheduledTip) || 'Tip time unavailable',
    seasonLabel: seasonLabel(game.seasonType),
    statusLabel: lifecycleLabel(game.lifecycle),
    updatedLabel: `Scoreboard ${formatObservedAt(game.lastObservedAt)}`,
    returnHref: dashboardReturnHref(parseSlateDate(input.slateDate) ?? game.etDate),
    identityConfirmed,
    teamRows: teamResult.map(teamRow).filter((row): row is TeamSumRow => row != null),
    playerRows: playerResult.map(playerRow).filter((row): row is PlayerSumRow => row != null),
    roster,
    quote,
  });
}
