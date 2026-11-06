/**
 * Server-side context for Parlay Workspace analysis of today's props (snapshotKind `live_current`).
 * Builds the same replay context + deps shape as the certified X3F fixture, from the DB as of now.
 *
 * - Box scores: analytics.player_game_logs (BDL), strictly before min(now, tip), never the target game.
 * - Team pace / points: analytics.team_game_stats, same cutoff.
 * - Availability: the served injury report (same freshness / freeze rules as the scoreboard card).
 * - No model projections: backtests found the props model has no edge over the no-vig market.
 * - No market-movement rows: 3-Hour Pre-Tip / Decision Close do not exist before tip.
 */

import { loadTargetGame, loadXrayContextSources, type SqlQuery, type TargetGameContextRow } from '@/lib/parlay-xray/context/load';
import type { XRayContextSources, XrayCurrentAvailabilitySource } from '@/lib/parlay-xray/context/types';
import type { HistoricalXrayReplayContext, HistoricalXrayReplayDeps } from '@/lib/parlay-xray/e2e/types';
import { classifyTeammateStatus, etDate } from '@/lib/betting/teammates-out';
import type { TeammatesOutResponse } from '@/lib/betting/teammates-out-display';
import { isInjuryAuthoritativeForServing, parseInjurySnapshotAt } from '@/lib/injuries/freshness';

export const WORKSPACE_CURRENT_MAX_PLAYERS = 12;

/** Serializable deps: everything the client needs to run the shared analysis. */
export type WorkspaceCurrentReplayDeps = Omit<HistoricalXrayReplayDeps, 'nowMs'>;

export type WorkspaceCurrentReplay = {
  context: HistoricalXrayReplayContext;
  deps: WorkspaceCurrentReplayDeps;
};

export type WorkspaceCurrentReplayResult =
  | { ok: true; replay: WorkspaceCurrentReplay }
  | { ok: false; code: 'GAME_NOT_FOUND' | 'GAME_TIME_UNKNOWN' };

export type PlayerInjuryRow = { status: string | null; snapshotAt: string | Date | null };

export type WorkspaceCurrentContextDeps = {
  query: SqlQuery;
  loadTeammatesOut: (args: { playerId: string; gameId: string; now: Date }) => Promise<TeammatesOutResponse>;
  loadPlayerInjury: (playerId: string) => Promise<PlayerInjuryRow | null>;
  env: Record<string, string | undefined>;
  now: Date;
};

/** The leg's own status: served, Out/Doubtful, or Questionable on a same-day report. */
export function ownInjuryStatus(
  row: PlayerInjuryRow | null,
  args: { gameEtDate: string; env: Record<string, string | undefined>; now: Date }
): 'Out' | 'Doubtful' | 'Q' | null {
  if (!row) return null;
  const status = classifyTeammateStatus(row.status);
  if (!status) return null;
  if (!isInjuryAuthoritativeForServing({ snapshotAt: row.snapshotAt, status: row.status }, args.env, args.now)) {
    return null;
  }
  const at = parseInjurySnapshotAt(row.snapshotAt);
  if (status === 'Q' && (!at || etDate(at) !== args.gameEtDate)) return null;
  return status;
}

export function currentAvailabilitySource(
  teammates: TeammatesOutResponse,
  playerStatus: 'Out' | 'Doubtful' | 'Q' | null
): XrayCurrentAvailabilitySource {
  if (teammates.status !== 'ok') return { status: 'unavailable', reason: teammates.reason };
  return {
    status: 'ok',
    asOfLabel: teammates.asOfLabel,
    playerStatus,
    teammatesOut: teammates.teammates.map((row) => ({
      name: row.name,
      status: row.status,
      avgMinutes: Math.round(row.avgMinutes * 10) / 10,
    })),
  };
}

function cutoffFor(target: TargetGameContextRow, now: Date): string {
  const tip = Date.parse(target.startTime);
  return new Date(Math.min(now.getTime(), tip)).toISOString();
}

function asOfClock(instant: Date): string {
  return instant.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

function dateLabel(instant: Date): string {
  return instant.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export async function buildWorkspaceCurrentReplay(
  input: { gameId: string; playerIds: string[] },
  deps: WorkspaceCurrentContextDeps
): Promise<WorkspaceCurrentReplayResult> {
  const target = await loadTargetGame(deps.query, input.gameId);
  if (!target) return { ok: false, code: 'GAME_NOT_FOUND' };
  const tip = new Date(target.startTime);
  const gameEtDate = etDate(tip);
  if (!gameEtDate) return { ok: false, code: 'GAME_TIME_UNKNOWN' };

  const cutoffAt = cutoffFor(target, deps.now);
  const playerIds = [...new Set(input.playerIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    WORKSPACE_CURRENT_MAX_PLAYERS
  );

  const sourcesByPlayerId: Record<string, XRayContextSources> = {};
  // Sequential per player keeps the Postgres pool footprint small (EMAXCONNSESSION).
  for (const playerId of playerIds) {
    const [sources, teammates, ownRow] = await Promise.all([
      loadXrayContextSources(deps.query, {
        playerId,
        gameId: target.gameId,
        cutoffAt,
        season: target.season,
        teamIds: [target.homeTeamId, target.awayTeamId],
        includeProjections: false,
      }),
      deps.loadTeammatesOut({ playerId, gameId: target.gameId, now: deps.now }),
      deps.loadPlayerInjury(playerId),
    ]);
    sourcesByPlayerId[playerId] = {
      ...sources,
      projectionSnapshots: [],
      availability: currentAvailabilitySource(
        teammates,
        ownInjuryStatus(ownRow, { gameEtDate, env: deps.env, now: deps.now })
      ),
    };
  }

  const slateLabel = `${target.awayAbbr} @ ${target.homeAbbr}`;
  return {
    ok: true,
    replay: {
      context: {
        historicalDate: gameEtDate,
        cutoffAt,
        gameId: target.gameId,
        dateLabel: `${dateLabel(tip)} · context as of ${asOfClock(new Date(cutoffAt))} ET`,
        season: target.season ?? '',
        slateLabel,
        analysisMode: 'current',
      },
      deps: {
        catalog: {
          players: [],
          teams: [],
          games: [
            {
              gameId: target.gameId,
              startTime: target.startTime,
              homeTeamAbbr: target.homeAbbr,
              awayTeamAbbr: target.awayAbbr,
            },
          ],
        },
        movementRows: [],
        targetGame: target,
        sourcesByPlayerId,
      },
    },
  };
}

export type WorkspaceCurrentGamesRequest = { games: { gameId: string; playerIds: string[] }[] };

export type WorkspaceCurrentReplaysResult =
  | { ok: true; replays: WorkspaceCurrentReplay[] }
  | { ok: false; code: 'GAME_NOT_FOUND' | 'GAME_TIME_UNKNOWN' };

/**
 * One replay per game for a multi-game parlay. Games are built one after another, and players
 * within a game sequentially, so a parlay never opens more than one game's queries at a time
 * (EMAXCONNSESSION). Fails closed if any game is unknown.
 */
export async function buildWorkspaceCurrentReplays(
  input: WorkspaceCurrentGamesRequest,
  deps: WorkspaceCurrentContextDeps
): Promise<WorkspaceCurrentReplaysResult> {
  const replays: WorkspaceCurrentReplay[] = [];
  for (const game of input.games) {
    const built = await buildWorkspaceCurrentReplay(game, deps);
    if (!built.ok) return built;
    replays.push(built.replay);
  }
  return { ok: true, replays };
}
