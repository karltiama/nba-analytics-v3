/**
 * Reject a box before any analytics write when a rating input is missing or
 * inconsistent. A stored 0 is valid. Null is not turned into 0.
 *
 * Player points must equal 2*(FGM-3PM)+3*3PM+FTM. Player rebounds must equal
 * OREB+DREB. There is no team-credit bucket in this payload. A correction that
 * is not on a player line fails closed.
 *
 * RECOVERY_MIN_PARTICIPATING_PLAYERS is a safety floor, not proof that the
 * provider sent every player. Minutes of 0, blank, or null do not count.
 * A forfeited or otherwise short official box is rejected rather than padded.
 * An omitted player with zero points and no effect on the returned shot chart
 * cannot be detected once eight participants already reconcile to the score.
 *
 * Possessions match the nightly team-stat SQL:
 * 0.5 * ((FGA + 0.44*FTA - OREB + TOV) + the opponent side).
 */

import type { ProviderGame } from './recovery-select';
import type { GameRejection } from './recovery-select';

/** Distinct players with a non-zero minutes value required on each team. */
export const RECOVERY_MIN_PARTICIPATING_PLAYERS = 8;

const REQUIRED_COUNTS = ['pts', 'reb', 'oreb', 'dreb', 'fgm', 'fga', 'fg3m', 'fg3a', 'ftm', 'fta', 'turnover'] as const;
type RequiredCount = (typeof REQUIRED_COUNTS)[number];

export type StatLine = {
  id?: unknown;
  min?: unknown;
  fgm?: unknown;
  fga?: unknown;
  fg3m?: unknown;
  fg3a?: unknown;
  ftm?: unknown;
  fta?: unknown;
  oreb?: unknown;
  dreb?: unknown;
  reb?: unknown;
  ast?: unknown;
  stl?: unknown;
  blk?: unknown;
  turnover?: unknown;
  pf?: unknown;
  pts?: unknown;
  plus_minus?: unknown;
  player?: { id?: unknown; first_name?: unknown; last_name?: unknown; position?: unknown } | null;
  team?: { id?: unknown } | null;
  game?: { id?: unknown } | null;
};

export type CountedLine = {
  id: number;
  playerId: number;
  teamId: number;
  min: string | null;
  participated: boolean;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  turnover: number;
  pts: number;
  ast: number | null;
  stl: number | null;
  blk: number | null;
  pf: number | null;
  plusMinus: number | null;
  player: NonNullable<StatLine['player']>;
};

export type TeamTotals = {
  teamId: number;
  points: number;
  rebounds: number;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
};

export type ValidatedBox = {
  game: ProviderGame;
  gameId: number;
  lines: CountedLine[];
  home: TeamTotals;
  away: TeamTotals;
  possessions: number;
  homeRating: TeamRating;
  awayRating: TeamRating;
};

export type TeamRating = {
  possessions: number;
  offensiveRating: number;
  defensiveRating: number;
  pace: number;
  efgPct: number;
  tovPct: number;
  orbPct: number;
  pointsAllowed: number;
  result: 'W' | 'L' | null;
};

export type BoxValidation = { ok: true; box: ValidatedBox } | { ok: false; rejection: GameRejection };

function rejection(gameId: number, reason: string, detail?: string): BoxValidation {
  return { ok: false, rejection: { gameId, reason, detail } };
}

function readCount(value: unknown): { ok: true; value: number } | { ok: false; kind: 'missing' | 'invalid' } {
  if (value == null || value === '') return { ok: false, kind: 'missing' };
  if (typeof value === 'boolean') return { ok: false, kind: 'invalid' };
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) return { ok: false, kind: 'invalid' };
  return { ok: true, value: parsed };
}

function optionalCount(value: unknown): number | null | 'invalid' {
  if (value == null || value === '') return null;
  const parsed = readCount(value);
  if (!parsed.ok) return 'invalid';
  return parsed.value;
}

function readSignedInteger(value: unknown): { ok: true; value: number } | { ok: false } {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return { ok: true, value };
  if (typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value)) return { ok: true, value: Number(value) };
  return { ok: false };
}

/** True when the minutes string records time on the court. Zero and blank do not. */
export function minutesShowParticipation(min: unknown): boolean {
  if (min == null) return false;
  const text = String(min).trim();
  if (!text || text === '0' || text === '00' || text === '0:00' || text === '00:00') return false;
  const clock = text.match(/^(\d+):(\d{2})$/);
  if (clock) return Number(clock[1]) > 0 || Number(clock[2]) > 0;
  if (/^(0|[1-9]\d*)$/.test(text)) return Number(text) > 0;
  return false;
}

export function pointsFromShooting(line: { fgm: number; fg3m: number; ftm: number }): number {
  return 2 * (line.fgm - line.fg3m) + 3 * line.fg3m + line.ftm;
}

function sidePossessions(team: TeamTotals): number {
  return team.fga + 0.44 * team.fta - team.oreb + team.turnovers;
}

export function estimatedPossessions(home: TeamTotals, away: TeamTotals): number {
  return 0.5 * (sidePossessions(home) + sidePossessions(away));
}

function sumOptional(lines: CountedLine[], field: 'ast' | 'stl' | 'blk'): number | null {
  let total = 0;
  for (const line of lines) {
    const value = line[field];
    if (value == null) return null;
    total += value;
  }
  return total;
}

function totals(teamId: number, lines: CountedLine[]): TeamTotals {
  const sum = (field: RequiredCount) => lines.reduce((total, line) => total + line[field], 0);
  return {
    teamId,
    points: sum('pts'),
    rebounds: sum('reb'),
    assists: sumOptional(lines, 'ast'),
    steals: sumOptional(lines, 'stl'),
    blocks: sumOptional(lines, 'blk'),
    turnovers: sum('turnover'),
    fgm: sum('fgm'),
    fga: sum('fga'),
    fg3m: sum('fg3m'),
    fg3a: sum('fg3a'),
    ftm: sum('ftm'),
    fta: sum('fta'),
    oreb: sum('oreb'),
    dreb: sum('dreb'),
  };
}

function rate(team: TeamTotals, opponent: TeamTotals, pointsAllowed: number, possessions: number, scoreFor: number, scoreAgainst: number): TeamRating | string {
  if (!(team.fga > 0) || !(opponent.fga > 0)) return 'invalid_shot_denominator';
  const reboundDenominator = team.oreb + opponent.dreb;
  if (!(reboundDenominator > 0)) return 'invalid_rebound_denominator';
  const turnoverDenominator = team.fga + 0.44 * team.fta + team.turnovers;
  if (!(turnoverDenominator > 0) || !(possessions > 0)) return 'invalid_possessions';
  let result: 'W' | 'L' | null = null;
  if (scoreFor > scoreAgainst) result = 'W';
  else if (scoreFor < scoreAgainst) result = 'L';
  return {
    possessions,
    offensiveRating: (team.points / possessions) * 100,
    defensiveRating: (pointsAllowed / possessions) * 100,
    pace: possessions,
    efgPct: (team.fgm + 0.5 * team.fg3m) / team.fga,
    tovPct: team.turnovers / turnoverDenominator,
    orbPct: team.oreb / reboundDenominator,
    pointsAllowed,
    result,
  };
}

export function validateGameBox(game: ProviderGame, lines: readonly StatLine[]): BoxValidation {
  const gameId = typeof game.id === 'number' ? game.id : 0;
  const homeId = game.home_team?.id;
  const awayId = game.visitor_team?.id;
  if (typeof homeId !== 'number' || typeof awayId !== 'number') {
    return rejection(gameId, 'team_missing');
  }
  const homeScore = readCount(game.home_team_score);
  const awayScore = readCount(game.visitor_team_score);
  if (!homeScore.ok || !awayScore.ok) return rejection(gameId, 'missing_score');
  if (homeScore.value + awayScore.value <= 0) return rejection(gameId, 'invalid_final_score');

  if (lines.length === 0) return rejection(gameId, 'empty_box');
  const counted: CountedLine[] = [];
  const players = new Set<number>();
  for (const line of lines) {
    const statId = readCount(line.id);
    const playerId = readCount(line.player?.id);
    const teamId = readCount(line.team?.id);
    if (!statId.ok || statId.value <= 0) return rejection(gameId, 'missing_stat', 'id');
    if (!playerId.ok || playerId.value <= 0) return rejection(gameId, 'missing_stat', 'player_id');
    if (!teamId.ok) return rejection(gameId, 'missing_stat', 'team_id');
    if (line.game?.id != null && line.game.id !== gameId) {
      return rejection(gameId, 'unexpected_stat_game', String(line.game.id));
    }
    if (players.has(playerId.value)) return rejection(gameId, 'duplicate_player', String(playerId.value));
    players.add(playerId.value);
    if (teamId.value !== homeId && teamId.value !== awayId) {
      return rejection(gameId, 'unexpected_team', String(teamId.value));
    }

    const counts = {} as Record<RequiredCount, number>;
    for (const field of REQUIRED_COUNTS) {
      const parsed = readCount(line[field]);
      if (!parsed.ok) return rejection(gameId, parsed.kind === 'missing' ? 'missing_stat' : 'invalid_stat', field);
      counts[field] = parsed.value;
    }
    if (counts.fgm > counts.fga || counts.fg3m > counts.fg3a || counts.fg3a > counts.fga || counts.ftm > counts.fta || counts.fg3m > counts.fgm) {
      return rejection(gameId, 'invalid_shot_split', String(playerId.value));
    }
    if (counts.reb !== counts.oreb + counts.dreb) {
      return rejection(gameId, 'rebound_identity', String(playerId.value));
    }
    if (counts.pts !== pointsFromShooting(counts)) {
      return rejection(gameId, 'scoring_identity', String(playerId.value));
    }
    const minutesText = line.min == null ? '' : String(line.min).trim();
    const knownMinutes = minutesText === '' || minutesShowParticipation(line.min) || /^(0|00|0:00|00:00)$/.test(minutesText);
    if (!knownMinutes) return rejection(gameId, 'invalid_minutes', String(playerId.value));
    const ast = optionalCount(line.ast);
    const stl = optionalCount(line.stl);
    const blk = optionalCount(line.blk);
    const pf = optionalCount(line.pf);
    const plusMinus = line.plus_minus == null || line.plus_minus === '' ? null : readSignedInteger(line.plus_minus);
    if (ast === 'invalid' || stl === 'invalid' || blk === 'invalid' || pf === 'invalid') {
      return rejection(gameId, 'invalid_stat', 'optional_count');
    }
    if (plusMinus != null && !plusMinus.ok) return rejection(gameId, 'invalid_stat', 'plus_minus');

    counted.push({
      id: statId.value,
      playerId: playerId.value,
      teamId: teamId.value,
      min: line.min == null ? null : String(line.min),
      participated: minutesShowParticipation(line.min),
      ...counts,
      ast,
      stl,
      blk,
      pf,
      plusMinus: plusMinus == null ? null : plusMinus.value,
      player: line.player ?? { id: playerId.value },
    });
  }

  const homeLines = counted.filter((line) => line.teamId === homeId);
  const awayLines = counted.filter((line) => line.teamId === awayId);
  if (homeLines.length === 0 || awayLines.length === 0) return rejection(gameId, 'team_missing');

  const home = totals(homeId, homeLines);
  const away = totals(awayId, awayLines);
  if (home.points !== homeScore.value) return rejection(gameId, 'score_mismatch', 'home');
  if (away.points !== awayScore.value) return rejection(gameId, 'score_mismatch', 'away');
  const homeParticipants = homeLines.filter((line) => line.participated).length;
  const awayParticipants = awayLines.filter((line) => line.participated).length;
  if (homeParticipants < RECOVERY_MIN_PARTICIPATING_PLAYERS || awayParticipants < RECOVERY_MIN_PARTICIPATING_PLAYERS) {
    return rejection(gameId, 'short_box', `${homeParticipants},${awayParticipants}`);
  }

  const possessions = estimatedPossessions(home, away);
  if (!(possessions > 0)) return rejection(gameId, 'invalid_possessions');
  const homeRating = rate(home, away, away.points, possessions, homeScore.value, awayScore.value);
  const awayRating = rate(away, home, home.points, possessions, awayScore.value, homeScore.value);
  if (typeof homeRating === 'string') return rejection(gameId, homeRating);
  if (typeof awayRating === 'string') return rejection(gameId, awayRating);

  return {
    ok: true,
    box: { game, gameId, lines: counted, home, away, possessions, homeRating, awayRating },
  };
}
