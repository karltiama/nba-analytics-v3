/**
 * Shared BDL /v1/stats → player_game_logs field mapping.
 * Matches nightly-bdl-updater upsertAnalyticsPlayerGameLog semantics.
 * Does not create analytics.players.
 */

export type BdlBoxStatRow = {
  playerId: string;
  teamId: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  personalFouls: number | null;
  fieldGoalsMade: number | null;
  fieldGoalsAttempted: number | null;
  threePointersMade: number | null;
  threePointersAttempted: number | null;
  freeThrowsMade: number | null;
  freeThrowsAttempted: number | null;
  plusMinus: number | null;
};

export type PlayerGameLogWrite = BdlBoxStatRow & {
  gameId: string;
  season: string;
  opponentTeamId: string | null;
  isHome: boolean;
  pra: number;
};

function sid(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    return id == null ? null : String(id).trim() || null;
  }
  const s = String(value).trim();
  return s.length ? s : null;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Nested BDL /v1/stats row → compact fields. IDs only. */
export function mapBdlStatRow(row: Record<string, unknown>): BdlBoxStatRow | null {
  const playerId = sid(row.player) ?? sid(row.player_id);
  const teamId = sid(row.team) ?? sid(row.team_id);
  if (!playerId || !teamId) return null;
  return {
    playerId,
    teamId,
    minutes: row.min == null ? null : String(row.min),
    points: num(row.pts),
    rebounds: num(row.reb),
    offensiveRebounds: num(row.oreb),
    defensiveRebounds: num(row.dreb),
    assists: num(row.ast),
    steals: num(row.stl),
    blocks: num(row.blk),
    turnovers: num(row.turnover),
    personalFouls: num(row.pf),
    fieldGoalsMade: num(row.fgm),
    fieldGoalsAttempted: num(row.fga),
    threePointersMade: num(row.fg3m),
    threePointersAttempted: num(row.fg3a),
    freeThrowsMade: num(row.ftm),
    freeThrowsAttempted: num(row.fta),
    plusMinus: num(row.plus_minus),
  };
}

export function toPlayerGameLogWrite(input: {
  row: BdlBoxStatRow;
  gameId: string;
  season: string;
  homeTeamId: string;
  awayTeamId: string;
}): PlayerGameLogWrite {
  const isHome = input.row.teamId === input.homeTeamId;
  return {
    ...input.row,
    gameId: input.gameId,
    season: input.season,
    isHome,
    opponentTeamId: isHome ? input.awayTeamId : input.homeTeamId,
    pra: (input.row.points ?? 0) + (input.row.rebounds ?? 0) + (input.row.assists ?? 0),
  };
}

export function parseBdlStatsPayload(body: unknown): {
  rows: BdlBoxStatRow[];
  malformed: boolean;
} {
  if (!body || typeof body !== 'object') return { rows: [], malformed: true };
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return { rows: [], malformed: true };
  const rows: BdlBoxStatRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const mapped = mapBdlStatRow(item as Record<string, unknown>);
    if (mapped) rows.push(mapped);
  }
  return { rows, malformed: false };
}
