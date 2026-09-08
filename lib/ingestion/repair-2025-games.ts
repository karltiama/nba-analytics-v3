/**
 * Games-only 2025 repair from cached BDL /games. No /stats calls.
 */

import {
  DO_NOT_TOUCH_LOCAL_ONLY_ID,
  GAMES_ONLY_MISSING_IDS,
  GAMES_ONLY_REPAIR_IDS,
  GAMES_ONLY_SCORE_CORRECTION_ID,
  GAMES_ONLY_STALE_IDS,
} from './goat-stats-repair-queue';

export type CachedBdlGame = {
  id: number;
  date?: string | null;
  datetime?: string | null;
  season?: number | null;
  status?: string | null;
  postseason?: boolean | null;
  home_team_score?: number | null;
  visitor_team_score?: number | null;
  home_team?: { id?: number | null } | null;
  visitor_team?: { id?: number | null } | null;
};

export type LocalGameSnapshot = {
  game_id: string;
  season: string | null;
  status: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  start_time: string | null;
};

export type GamesOnlyMutation = {
  op: 'insert' | 'update';
  gameId: string;
  reason: 'missing_analytics_game' | 'stale_lifecycle' | 'score_correction';
  from: LocalGameSnapshot | null;
  to: {
    game_id: string;
    season: string;
    start_time: string | null;
    status: string | null;
    home_team_id: string;
    away_team_id: string;
    home_score: number | null;
    away_score: number | null;
  };
};

export type GamesOnlyPlan = {
  mutations: GamesOnlyMutation[];
  skipped: Array<{ gameId: string; reason: string }>;
  forbiddenTouched: boolean;
  statsCalls: 0;
};

const ALLOW = new Set(GAMES_ONLY_REPAIR_IDS.map(String));
const MISSING = new Set(GAMES_ONLY_MISSING_IDS.map(String));
const STALE = new Set(GAMES_ONLY_STALE_IDS.map(String));

export function planGamesOnlyRepair(args: {
  bdlGames: CachedBdlGame[];
  localGames: LocalGameSnapshot[];
}): GamesOnlyPlan {
  const byBdl = new Map(args.bdlGames.map((g) => [String(g.id), g]));
  const byLocal = new Map(args.localGames.map((g) => [g.game_id, g]));
  const mutations: GamesOnlyMutation[] = [];
  const skipped: Array<{ gameId: string; reason: string }> = [];
  let forbiddenTouched = false;

  const candidateIds = [...GAMES_ONLY_REPAIR_IDS.map(String)];
  if (byLocal.has(String(DO_NOT_TOUCH_LOCAL_ONLY_ID))) {
    skipped.push({
      gameId: String(DO_NOT_TOUCH_LOCAL_ONLY_ID),
      reason: 'unexpected local-only identity; unresolved; do not touch',
    });
  }

  for (const id of candidateIds) {
    if (id === String(DO_NOT_TOUCH_LOCAL_ONLY_ID)) {
      forbiddenTouched = true;
      continue;
    }
    if (!ALLOW.has(id)) {
      skipped.push({ gameId: id, reason: 'not in games-only allowlist' });
      continue;
    }
    const bdl = byBdl.get(id);
    if (!bdl) {
      skipped.push({ gameId: id, reason: 'missing from cached BDL /games payload' });
      continue;
    }
    const homeId = bdl.home_team?.id;
    const awayId = bdl.visitor_team?.id;
    if (homeId == null || awayId == null) {
      skipped.push({ gameId: id, reason: 'BDL payload missing team ids' });
      continue;
    }
    const next = {
      game_id: id,
      season: String(bdl.season ?? 2025),
      start_time: bdl.datetime ?? null,
      status: bdl.status ?? 'Final',
      home_team_id: String(homeId),
      away_team_id: String(awayId),
      home_score: bdl.home_team_score ?? null,
      away_score: bdl.visitor_team_score ?? null,
    };
    const local = byLocal.get(id) ?? null;
    if (MISSING.has(id)) {
      mutations.push({
        op: 'insert',
        gameId: id,
        reason: 'missing_analytics_game',
        from: local,
        to: next,
      });
      continue;
    }
    if (STALE.has(id)) {
      mutations.push({
        op: 'update',
        gameId: id,
        reason: 'stale_lifecycle',
        from: local,
        to: next,
      });
      continue;
    }
    if (id === String(GAMES_ONLY_SCORE_CORRECTION_ID)) {
      mutations.push({
        op: 'update',
        gameId: id,
        reason: 'score_correction',
        from: local,
        to: next,
      });
    }
  }

  return { mutations, skipped, forbiddenTouched, statsCalls: 0 };
}

export const UPSERT_GAMES_ONLY_SQL = `
  insert into analytics.games (game_id, season, start_time, status, home_team_id, away_team_id, home_score, away_score)
  values ($1, $2, $3, $4, $5, $6, $7, $8)
  on conflict (game_id) do update set
    start_time = excluded.start_time,
    status = excluded.status,
    home_team_id = excluded.home_team_id,
    away_team_id = excluded.away_team_id,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    updated_at = now()
  where analytics.games.game_id = excluded.game_id
    and analytics.games.game_id <> $9
`;

export function assertGamesOnlyExecuteScope(mutations: GamesOnlyMutation[]): void {
  for (const m of mutations) {
    if (!ALLOW.has(m.gameId)) {
      throw new Error(`Refusing games-only write for unlisted id ${m.gameId}`);
    }
    if (m.gameId === String(DO_NOT_TOUCH_LOCAL_ONLY_ID)) {
      throw new Error(`Refusing to touch unresolved local-only game ${DO_NOT_TOUCH_LOCAL_ONLY_ID}`);
    }
  }
}
