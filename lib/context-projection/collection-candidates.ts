/**
 * Phase 19 — Load candidate players + PGL-derived Role/Form contexts for prospective collection.
 * Does not invent Availability COMPLETE; builds from injury tables when possible.
 */

import { computePlayerRoleContext } from '@/lib/context-center/role/player-role-context';
import type { RoleHistoryGame } from '@/lib/context-center/role-expectation';
import { computeRecentFormContext } from '@/lib/context-center/form/recent-form-context';
import {
  buildTeamGameAvailabilitySnapshot,
  type ClassifiedPlayerRow,
} from '@/lib/context-center/availability-snapshot';
import { classifyOfficialInjuryReason } from '@/lib/injuries/official/reason-policy';
import type { B0MinPriorGame } from '@/lib/context-projection/min/baseline';
import { classifyWowyAppearance } from '@/lib/wowy/appearance';
import type { SqlQueryable } from '@/lib/db/schema-capability';
import {
  isPrimaryProspectiveCompetitionGame,
} from '@/lib/context-projection/game-universe';

export interface ProspectiveGame {
  gameId: string;
  season: string;
  scheduledTipoff: string;
  homeTeamId: string;
  awayTeamId: string;
  status: string | null;
}

export interface ProspectiveCandidate {
  playerId: string;
  teamId: string;
  game: ProspectiveGame;
  roleRecentFga: number | null;
  roleSeasonFga: number | null;
  roleRecentMinutes: number | null;
  roleSeasonMinutes: number | null;
  formRecentPoints: number | null;
  formSeasonPoints: number | null;
  last10Avg: number;
  seasonAvg: number;
  last5Avg: number;
  b0Priors: B0MinPriorGame[];
  availCompleteness: string | null;
  expectedMissingMinutes: number | null;
  rotationPlayersOutCount: number | null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : String(value);
}

function toRoleHistory(row: Record<string, unknown>): RoleHistoryGame {
  return {
    gameId: String(row.game_id),
    teamId: String(row.team_id),
    season: String(row.season),
    gameStart: iso(row.start_time as string)!,
    minutes: row.minutes as string | number | null,
    points: row.points == null ? null : Number(row.points),
    rebounds: row.rebounds == null ? null : Number(row.rebounds),
    assists: row.assists == null ? null : Number(row.assists),
    field_goals_attempted: row.field_goals_attempted == null ? null : Number(row.field_goals_attempted),
    free_throws_attempted: row.free_throws_attempted == null ? null : Number(row.free_throws_attempted),
    three_pointers_attempted:
      row.three_pointers_attempted == null ? null : Number(row.three_pointers_attempted),
    three_pointers_made: row.three_pointers_made == null ? null : Number(row.three_pointers_made),
  };
}

function isPlayedHist(h: RoleHistoryGame): boolean {
  return (
    classifyWowyAppearance({
      minutes: h.minutes,
      points: h.points,
      rebounds: h.rebounds,
      assists: h.assists,
      three_pointers_made: h.three_pointers_made,
      field_goals_attempted: h.field_goals_attempted,
      free_throws_attempted: h.free_throws_attempted,
    }).class === 'played'
  );
}

export async function loadProspectiveUpcomingGames(
  client: SqlQueryable,
  nowIso: string,
  horizonHours = 48
): Promise<ProspectiveGame[]> {
  const res = await client.query(
    `
    SELECT game_id::text, season::text, start_time,
           home_team_id::text, away_team_id::text, status
      FROM analytics.games
     WHERE start_time IS NOT NULL
       AND start_time > $1::timestamptz
       AND start_time <= ($1::timestamptz + ($2::text || ' hours')::interval)
       AND (status IS NULL OR status NOT IN ('Final', 'Cancelled', 'Postponed'))
     ORDER BY start_time ASC
    `,
    [nowIso, String(horizonHours)]
  );
  return res.rows
    .map((r) => ({
      gameId: String(r.game_id),
      season: String(r.season),
      scheduledTipoff: iso(r.start_time as string)!,
      homeTeamId: String(r.home_team_id),
      awayTeamId: String(r.away_team_id),
      status: r.status == null ? null : String(r.status),
    }))
    .filter((g) =>
      isPrimaryProspectiveCompetitionGame({
        season: g.season,
        startTimeIso: g.scheduledTipoff,
        status: g.status,
      })
    );
}

/** Inclusive T−60 due window: [cutoff − lookahead, cutoff]. */
export function classifyContextProspectiveDue(opts: {
  tipIso: string;
  nowIso: string;
  cutoffIso: string;
  lookaheadMinutes?: number;
}): 'too_early' | 'due' | 'late_open' | 'after_tip' {
  const tip = Date.parse(opts.tipIso);
  const now = Date.parse(opts.nowIso);
  const cutoff = Date.parse(opts.cutoffIso);
  const lookahead = (opts.lookaheadMinutes ?? 5) * 60_000;
  if (![tip, now, cutoff].every(Number.isFinite)) return 'after_tip';
  if (now >= tip) return 'after_tip';
  if (now <= cutoff) {
    return now >= cutoff - lookahead ? 'due' : 'too_early';
  }
  return 'late_open';
}

async function loadTeamPglHistory(
  client: SqlQueryable,
  teamIds: string[],
  beforeIso: string
): Promise<Map<string, RoleHistoryGame[]>> {
  if (teamIds.length === 0) return new Map();
  const res = await client.query(
    `
    SELECT l.player_id::text AS player_id,
           l.game_id::text AS game_id,
           l.team_id::text AS team_id,
           g.season::text AS season,
           COALESCE(g.start_time, l.game_date::timestamptz) AS start_time,
           l.minutes, l.points, l.rebounds, l.assists,
           l.field_goals_attempted, l.free_throws_attempted,
           l.three_pointers_attempted, l.three_pointers_made
      FROM analytics.player_game_logs l
      JOIN analytics.games g ON g.game_id = l.game_id
     WHERE l.team_id = ANY($1::text[])
       AND COALESCE(g.start_time, l.game_date::timestamptz) < $2::timestamptz
    `,
    [teamIds, beforeIso]
  );
  const byPlayer = new Map<string, RoleHistoryGame[]>();
  for (const row of res.rows) {
    const pid = String(row.player_id);
    const hist = toRoleHistory(row);
    const arr = byPlayer.get(pid) ?? [];
    arr.push(hist);
    byPlayer.set(pid, arr);
  }
  for (const [, arr] of byPlayer) {
    arr.sort((a, b) => (a.gameStart < b.gameStart ? -1 : a.gameStart > b.gameStart ? 1 : 0));
  }
  return byPlayer;
}

function observedRoster(
  teamId: string,
  beforeIso: string,
  byPlayer: Map<string, RoleHistoryGame[]>
): string[] {
  const before = Date.parse(beforeIso);
  const out: string[] = [];
  for (const [pid, hist] of byPlayer) {
    const onTeam = hist.filter(
      (h) => h.teamId === teamId && Date.parse(h.gameStart) < before && isPlayedHist(h)
    );
    if (onTeam.length === 0) continue;
    const last = onTeam[onTeam.length - 1]!;
    if (before - Date.parse(last.gameStart) > 30 * 86_400_000) continue;
    out.push(pid);
  }
  return out.sort();
}

async function loadTeamAvailability(
  client: SqlQueryable,
  opts: {
    gameId: string;
    teamId: string;
    season: string;
    tipIso: string;
    asOfIso: string;
    pglByEntity: Map<string, RoleHistoryGame[]>;
  }
): Promise<{
  completeness: string;
  expectedMissingMinutes: number | null;
  rotationPlayersOutCount: number | null;
}> {
  // Prefer history rows linked to this game at/before asOf; else current snapshot.
  const hist = await client.query(
    `
    SELECT player_id::text, status, description, snapshot_at
      FROM analytics.player_injury_status_history
     WHERE team_id = $1
       AND (game_id = $2 OR game_id IS NULL)
       AND snapshot_at <= $3::timestamptz
     ORDER BY snapshot_at DESC
     LIMIT 500
    `,
    [opts.teamId, opts.gameId, opts.asOfIso]
  );

  let rows = hist.rows;
  if (rows.length === 0) {
    const cur = await client.query(
      `
      SELECT player_id::text, status, description, snapshot_at
        FROM analytics.player_injury_status_current
       WHERE team_id = $1
      `,
      [opts.teamId]
    );
    rows = cur.rows;
  }

  if (rows.length === 0) {
    return {
      completeness: 'SOURCE_UNKNOWN',
      expectedMissingMinutes: null,
      rotationPlayersOutCount: null,
    };
  }

  // Dedupe to latest per player
  const latest = new Map<string, (typeof rows)[0]>();
  for (const r of rows) {
    const pid = String(r.player_id);
    if (!latest.has(pid)) latest.set(pid, r);
  }

  const playerRows: ClassifiedPlayerRow[] = [];
  for (const r of latest.values()) {
    const statusRaw = String(r.status ?? '').trim() || 'Available';
    const desc = r.description == null ? '' : String(r.description);
    const classified = classifyOfficialInjuryReason(desc);
    playerRows.push({
      sourceKey: `${r.player_id}|${statusRaw}`,
      statusRaw,
      healthRelation: classified.health_relation,
      playerEntityId: String(r.player_id),
      canonicalModelEligible: true,
    });
  }

  const snap = buildTeamGameAvailabilitySnapshot({
    gameId: opts.gameId,
    teamId: opts.teamId,
    season: opts.season,
    gameStart: opts.tipIso,
    asOf: opts.asOfIso,
    injuryReportPublishedAt: opts.asOfIso,
    teamState: 'OK',
    playerRows,
    pglByEntity: opts.pglByEntity,
  });

  return {
    completeness: snap.completeness.status,
    expectedMissingMinutes: snap.injuryBurden.expectedMissingMinutes,
    rotationPlayersOutCount: snap.injuryBurden.rotationPlayersOutCount,
  };
}

function dnpInclusiveAvgs(hist: RoleHistoryGame[]): {
  seasonAvg: number;
  last10Avg: number;
  last5Avg: number;
} {
  const pts = hist.map((h) => {
    const played = isPlayedHist(h);
    if (!played) {
      const dnp =
        classifyWowyAppearance({
          minutes: h.minutes,
          points: h.points,
          rebounds: h.rebounds,
          assists: h.assists,
        }).class === 'dnp';
      return dnp ? 0 : Number(h.points ?? 0);
    }
    return Number(h.points ?? 0);
  });
  if (pts.length === 0) return { seasonAvg: 0, last10Avg: 0, last5Avg: 0 };
  const seasonAvg = pts.reduce((a, b) => a + b, 0) / pts.length;
  const last10 = pts.slice(-10);
  const last5 = pts.slice(-5);
  return {
    seasonAvg,
    last10Avg: last10.reduce((a, b) => a + b, 0) / last10.length,
    last5Avg: last5.reduce((a, b) => a + b, 0) / last5.length,
  };
}

export async function buildCandidatesForGame(
  client: SqlQueryable,
  game: ProspectiveGame,
  asOfIso: string
): Promise<ProspectiveCandidate[]> {
  const teamIds = [game.homeTeamId, game.awayTeamId];
  const byPlayer = await loadTeamPglHistory(client, teamIds, game.scheduledTipoff);
  const availByTeam = new Map<
    string,
    Awaited<ReturnType<typeof loadTeamAvailability>>
  >();
  for (const tid of teamIds) {
    availByTeam.set(
      tid,
      await loadTeamAvailability(client, {
        gameId: game.gameId,
        teamId: tid,
        season: game.season,
        tipIso: game.scheduledTipoff,
        asOfIso,
        pglByEntity: byPlayer,
      })
    );
  }

  const out: ProspectiveCandidate[] = [];
  for (const teamId of teamIds) {
    const roster = observedRoster(teamId, game.scheduledTipoff, byPlayer);
    const avail = availByTeam.get(teamId)!;
    for (const playerId of roster) {
      const hist = byPlayer.get(playerId) ?? [];
      const role = computePlayerRoleContext({
        gameId: game.gameId,
        playerEntityId: playerId,
        teamId,
        season: game.season,
        targetGameStart: game.scheduledTipoff,
        history: hist,
      });
      const form = computeRecentFormContext({
        gameId: game.gameId,
        playerEntityId: playerId,
        teamId,
        season: game.season,
        targetGameStart: game.scheduledTipoff,
        history: hist,
      });
      const avgs = dnpInclusiveAvgs(
        hist.filter((h) => h.season === game.season && h.gameStart < game.scheduledTipoff)
      );
      const b0Priors: B0MinPriorGame[] = hist.map((h) => {
        const appearance = classifyWowyAppearance({
          minutes: h.minutes,
          points: h.points,
          rebounds: h.rebounds,
          assists: h.assists,
          three_pointers_made: h.three_pointers_made,
          field_goals_attempted: h.field_goals_attempted,
          free_throws_attempted: h.free_throws_attempted,
        });
        return {
          teamId: h.teamId,
          season: h.season,
          startTime: h.gameStart,
          played: appearance.class === 'played',
          minutes: appearance.minutes ?? 0,
        };
      });

      out.push({
        playerId,
        teamId,
        game,
        roleRecentFga: role.recentRole.fga,
        roleSeasonFga: role.seasonRole.fga,
        roleRecentMinutes: role.recentRole.minutes,
        roleSeasonMinutes: role.seasonRole.minutes,
        formRecentPoints: form.recentForm.points,
        formSeasonPoints: form.seasonForm.points,
        last10Avg: avgs.last10Avg,
        seasonAvg: avgs.seasonAvg,
        last5Avg: avgs.last5Avg,
        b0Priors,
        availCompleteness: avail.completeness,
        expectedMissingMinutes: avail.expectedMissingMinutes,
        rotationPlayersOutCount: avail.rotationPlayersOutCount,
      });
    }
  }
  return out;
}
