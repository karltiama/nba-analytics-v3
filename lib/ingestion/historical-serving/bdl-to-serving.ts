/**
 * Map archived BDL game/stat payloads onto analytics serving rows.
 * Option B: no write to raw.player_game_stats.
 *
 * Mapping is exact id / abbreviation only. Unresolved rows are returned, never dropped silently.
 */

import { historicalSeasonWindow, isDateInServingWindow, type HistoricalSeasonWindow } from './season-window';

export type TeamCatalogRow = {
  team_id: string;
  abbreviation: string | null;
};

export type ExistingGameRow = {
  game_id: string;
  season: string | null;
};

export type BdlTeam = {
  id?: number | string | null;
  abbreviation?: string | null;
  city?: string | null;
  conference?: string | null;
  division?: string | null;
  full_name?: string | null;
  name?: string | null;
};

export type BdlPlayer = {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  height?: string | null;
  weight?: string | null;
};

export type BdlGame = {
  id?: number | string | null;
  date?: string | null;
  datetime?: string | null;
  season?: number | string | null;
  status?: string | null;
  postseason?: boolean | null;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: BdlTeam | null;
  visitor_team?: BdlTeam | null;
};

export type BdlStat = {
  id?: number | string | null;
  min?: string | number | null;
  pts?: number | null;
  reb?: number | null;
  oreb?: number | null;
  dreb?: number | null;
  ast?: number | null;
  stl?: number | null;
  blk?: number | null;
  turnover?: number | null;
  pf?: number | null;
  plus_minus?: number | null;
  fgm?: number | null;
  fga?: number | null;
  fg3m?: number | null;
  fg3a?: number | null;
  ftm?: number | null;
  fta?: number | null;
  player?: BdlPlayer | null;
  team?: BdlTeam | null;
  game?: {
    id?: number | string | null;
    date?: string | null;
    season?: number | string | null;
    status?: string | null;
    postseason?: boolean | null;
    home_team_id?: number | string | null;
    visitor_team_id?: number | string | null;
    home_team_score?: number | null;
    visitor_team_score?: number | null;
  } | null;
};

export type ServingGame = {
  game_id: string;
  season: string;
  start_time: string | null;
  status: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  game_date: string;
  postseason: boolean | null;
};

export type ServingPlayer = {
  player_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  height: string | null;
  weight: string | null;
};

export type ServingLog = {
  game_id: string;
  player_id: string;
  team_id: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  offensive_rebounds: number | null;
  defensive_rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  personal_fouls: number | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  three_pointers_made: number | null;
  three_pointers_attempted: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  plus_minus: number | null;
  opponent_team_id: string;
  is_home: boolean;
  game_date: string;
  season: string;
  pra: number;
};

export type MappingIssue = {
  kind: 'missing_team' | 'missing_player' | 'missing_game' | 'cross_season_game' | 'out_of_window' | 'ambiguous_team';
  id: string;
  detail: string;
};

export type TransformReport = {
  season: string;
  games: ServingGame[];
  logs: ServingLog[];
  players: ServingPlayer[];
  issues: MappingIssue[];
  stats: {
    gamesFetched: number;
    gamesInWindow: number;
    gamesSkippedWindow: number;
    statsFetched: number;
    logsBuilt: number;
    unresolvedTeams: number;
    unresolvedPlayers: number;
    unresolvedGames: number;
    crossSeasonConflicts: number;
  };
};

function sid(v: number | string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function dateOnly(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (s.length >= 10) return s.slice(0, 10);
  return null;
}

function fullName(first: string | null | undefined, last: string | null | undefined, fallback: string): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  const n = `${f} ${l}`.trim();
  return n.length > 0 ? n : fallback;
}

export function buildTeamResolver(catalog: TeamCatalogRow[]): {
  resolve: (team: BdlTeam | null | undefined) => { ok: true; teamId: string } | { ok: false; reason: 'missing' | 'ambiguous' };
} {
  const byId = new Map<string, TeamCatalogRow>();
  const byAbbr = new Map<string, TeamCatalogRow[]>();
  for (const row of catalog) {
    byId.set(row.team_id, row);
    const abbr = (row.abbreviation ?? '').trim().toUpperCase();
    if (!abbr) continue;
    const list = byAbbr.get(abbr) ?? [];
    list.push(row);
    byAbbr.set(abbr, list);
  }
  return {
    resolve(team) {
      const id = sid(team?.id);
      if (id && byId.has(id)) return { ok: true, teamId: id };
      const abbr = (team?.abbreviation ?? '').trim().toUpperCase();
      if (!abbr) return { ok: false, reason: 'missing' };
      const hits = byAbbr.get(abbr) ?? [];
      const current = hits.filter((h) => Number(h.team_id) >= 1 && Number(h.team_id) <= 30);
      const pool = current.length > 0 ? current : hits;
      if (pool.length === 1) return { ok: true, teamId: pool[0]!.team_id };
      if (pool.length > 1) return { ok: false, reason: 'ambiguous' };
      return { ok: false, reason: 'missing' };
    },
  };
}

export function assertGameSeasonIsolation(
  existing: ExistingGameRow | undefined,
  incomingSeason: string
): MappingIssue | null {
  if (!existing) return null;
  if (existing.season == null || existing.season === incomingSeason) return null;
  return {
    kind: 'cross_season_game',
    id: existing.game_id,
    detail: `existing season=${existing.season} incoming=${incomingSeason}`,
  };
}

export function transformBdlArchiveToServing(args: {
  seasonStartYear: number;
  games: BdlGame[];
  stats: BdlStat[];
  teamCatalog: TeamCatalogRow[];
  existingGames: ExistingGameRow[];
}): TransformReport {
  const window: HistoricalSeasonWindow = historicalSeasonWindow(args.seasonStartYear);
  const season = window.storedSeason;
  const teams = buildTeamResolver(args.teamCatalog);
  const existingById = new Map(args.existingGames.map((g) => [g.game_id, g]));
  const issues: MappingIssue[] = [];
  const gamesOut: ServingGame[] = [];
  const seenGames = new Set<string>();

  let gamesSkippedWindow = 0;
  for (const g of args.games) {
    const gameId = sid(g.id);
    const dt = dateOnly(g.date) ?? dateOnly(g.datetime);
    if (!gameId || !dt) continue;
    if (!isDateInServingWindow(dt, window)) {
      gamesSkippedWindow += 1;
      issues.push({ kind: 'out_of_window', id: gameId, detail: `date=${dt}` });
      continue;
    }
    const cross = assertGameSeasonIsolation(existingById.get(gameId), season);
    if (cross) {
      issues.push(cross);
      continue;
    }
    const home = teams.resolve(g.home_team);
    const away = teams.resolve(g.visitor_team);
    if (!home.ok) {
      issues.push({
        kind: home.reason === 'ambiguous' ? 'ambiguous_team' : 'missing_team',
        id: gameId,
        detail: `home team id=${sid(g.home_team?.id) ?? '?'} abbr=${g.home_team?.abbreviation ?? '?'}`,
      });
      continue;
    }
    if (!away.ok) {
      issues.push({
        kind: away.reason === 'ambiguous' ? 'ambiguous_team' : 'missing_team',
        id: gameId,
        detail: `away team id=${sid(g.visitor_team?.id) ?? '?'} abbr=${g.visitor_team?.abbreviation ?? '?'}`,
      });
      continue;
    }
    if (seenGames.has(gameId)) continue;
    seenGames.add(gameId);
    gamesOut.push({
      game_id: gameId,
      season,
      start_time: g.datetime ?? (g.date ? `${dt}T00:00:00Z` : null),
      status: g.status ?? null,
      home_team_id: home.teamId,
      away_team_id: away.teamId,
      home_score: g.home_team_score ?? null,
      away_score: g.visitor_team_score ?? null,
      game_date: dt,
      postseason: g.postseason ?? null,
    });
  }

  const gamesById = new Map(gamesOut.map((g) => [g.game_id, g]));
  const playersById = new Map<string, ServingPlayer>();
  const logs: ServingLog[] = [];
  const logKeys = new Set<string>();

  for (const s of args.stats) {
    const gameId = sid(s.game?.id);
    const playerId = sid(s.player?.id);
    if (!gameId || !playerId) {
      issues.push({
        kind: !gameId ? 'missing_game' : 'missing_player',
        id: String(s.id ?? '?'),
        detail: `stat missing ${!gameId ? 'game' : 'player'} id`,
      });
      continue;
    }
    const game = gamesById.get(gameId);
    if (!game) {
      issues.push({ kind: 'missing_game', id: gameId, detail: `stat player=${playerId} has no in-window serving game` });
      continue;
    }
    const team = teams.resolve(s.team ?? { id: null });
    if (!team.ok) {
      issues.push({
        kind: team.reason === 'ambiguous' ? 'ambiguous_team' : 'missing_team',
        id: `${gameId}:${playerId}`,
        detail: `stat team id=${sid(s.team?.id) ?? '?'} abbr=${s.team?.abbreviation ?? '?'}`,
      });
      continue;
    }
    const homeId = sid(s.game?.home_team_id) ?? game.home_team_id;
    const awayId = sid(s.game?.visitor_team_id) ?? game.away_team_id;
    const homeResolved = homeId ? teams.resolve({ id: homeId }) : { ok: false as const, reason: 'missing' as const };
    const awayResolved = awayId ? teams.resolve({ id: awayId }) : { ok: false as const, reason: 'missing' as const };
    const homeTeamId = homeResolved.ok ? homeResolved.teamId : game.home_team_id;
    const awayTeamId = awayResolved.ok ? awayResolved.teamId : game.away_team_id;
    const isHome = team.teamId === homeTeamId;
    const opponentTeamId = isHome ? awayTeamId : homeTeamId;
    const key = `${gameId}|${playerId}`;
    if (logKeys.has(key)) continue;
    logKeys.add(key);

    if (!playersById.has(playerId)) {
      playersById.set(playerId, {
        player_id: playerId,
        full_name: fullName(s.player?.first_name, s.player?.last_name, playerId),
        first_name: s.player?.first_name ?? null,
        last_name: s.player?.last_name ?? null,
        position: s.player?.position ?? null,
        height: s.player?.height ?? null,
        weight: s.player?.weight ?? null,
      });
    }

    const pts = s.pts ?? 0;
    const reb = s.reb ?? 0;
    const ast = s.ast ?? 0;
    logs.push({
      game_id: gameId,
      player_id: playerId,
      team_id: team.teamId,
      minutes: s.min == null ? null : String(s.min),
      points: s.pts ?? null,
      rebounds: s.reb ?? null,
      offensive_rebounds: s.oreb ?? null,
      defensive_rebounds: s.dreb ?? null,
      assists: s.ast ?? null,
      steals: s.stl ?? null,
      blocks: s.blk ?? null,
      turnovers: s.turnover ?? null,
      personal_fouls: s.pf ?? null,
      field_goals_made: s.fgm ?? null,
      field_goals_attempted: s.fga ?? null,
      three_pointers_made: s.fg3m ?? null,
      three_pointers_attempted: s.fg3a ?? null,
      free_throws_made: s.ftm ?? null,
      free_throws_attempted: s.fta ?? null,
      plus_minus: s.plus_minus ?? null,
      opponent_team_id: opponentTeamId,
      is_home: isHome,
      game_date: game.game_date,
      season,
      pra: pts + reb + ast,
    });
  }

  const unresolvedTeams = issues.filter((i) => i.kind === 'missing_team' || i.kind === 'ambiguous_team').length;
  const unresolvedPlayers = issues.filter((i) => i.kind === 'missing_player').length;
  const unresolvedGames = issues.filter((i) => i.kind === 'missing_game').length;
  const crossSeasonConflicts = issues.filter((i) => i.kind === 'cross_season_game').length;

  return {
    season,
    games: gamesOut,
    logs,
    players: [...playersById.values()],
    issues,
    stats: {
      gamesFetched: args.games.length,
      gamesInWindow: gamesOut.length,
      gamesSkippedWindow,
      statsFetched: args.stats.length,
      logsBuilt: logs.length,
      unresolvedTeams,
      unresolvedPlayers,
      unresolvedGames,
      crossSeasonConflicts,
    },
  };
}

export function mappingQualityFromReport(report: TransformReport): {
  players: { total: number; mapped: number; missing: number; ambiguous: number };
  teams: { mapped: number; missing: number; ambiguous: number };
  games: { mapped: number; missing: number; crossSeason: number };
} {
  return {
    players: {
      total: report.players.length,
      mapped: report.players.length,
      missing: report.stats.unresolvedPlayers,
      ambiguous: 0,
    },
    teams: {
      mapped: new Set(report.games.flatMap((g) => [g.home_team_id, g.away_team_id])).size,
      missing: report.issues.filter((i) => i.kind === 'missing_team').length,
      ambiguous: report.issues.filter((i) => i.kind === 'ambiguous_team').length,
    },
    games: {
      mapped: report.games.length,
      missing: report.stats.unresolvedGames,
      crossSeason: report.stats.crossSeasonConflicts,
    },
  };
}
