/**
 * Deterministic preseason context signals (V1.1 — research/editorial only).
 */

import {
  HIGH_MINUTE_MPG,
  HIGH_USAGE_AVG,
  MEANINGFUL_MINUTE_MPG,
  MIN_SEASON_GP_FOR_ROLE_SIGNAL,
  MIN_USAGE_GAMES,
  MIN_USAGE_TOTAL_MINUTES,
  PRESEASON_SIGNAL_POLICY_ID,
  RECENT_COMPETITIVE_MINUTES_RATIO,
  RECENT_COMPETITIVE_MIN_BASELINE_MPG,
  RECENT_COMPETITIVE_MIN_SEASON_GP,
  RECENT_COMPETITIVE_MIN_WINDOW_GP,
  USAGE_AGGREGATION_METHOD,
} from './policy';
import type {
  PacketPlayerRoleStats,
  PreseasonContextSignal,
  PreseasonTeamPacket,
} from './types';

function statsByEntity(
  packet: PreseasonTeamPacket
): Map<string, PacketPlayerRoleStats> {
  return new Map(packet.playerSeasonStats.map((s) => [s.playerEntityId, s]));
}

function gpOk(stats: PacketPlayerRoleStats | undefined): boolean {
  return (
    stats != null &&
    stats.gamesPlayed != null &&
    stats.gamesPlayed >= MIN_SEASON_GP_FOR_ROLE_SIGNAL
  );
}

export function derivePreseasonContextSignals(
  packet: PreseasonTeamPacket
): PreseasonContextSignal[] {
  const byEntity = statsByEntity(packet);
  const signals: PreseasonContextSignal[] = [];
  const priorSeason = packet.previousSeason;

  for (const p of packet.departures) {
    const s = byEntity.get(p.playerEntityId);
    if (!gpOk(s) || s?.mpg == null || s.mpg < MEANINGFUL_MINUTE_MPG) continue;
    signals.push({
      type: 'VACATED_MINUTES',
      playerEntityId: p.playerEntityId,
      playerId: p.playerId,
      displayName: p.displayName,
      magnitude: s.mpg,
      evidence: {
        previousSeasonMinutesPerGame: round1(s.mpg),
        gamesPlayed: s.gamesPlayed,
      },
      provenance: {
        method: PRESEASON_SIGNAL_POLICY_ID,
        tables: [
          'analytics.team_roster_current',
          'analytics.player_game_logs',
          'analytics.player_season_averages',
        ],
        season: priorSeason,
        note: `Vacated when prior MPG >= ${MEANINGFUL_MINUTE_MPG} and GP >= ${MIN_SEASON_GP_FOR_ROLE_SIGNAL}`,
      },
    });
  }

  for (const p of packet.returningPlayers) {
    const s = byEntity.get(p.playerEntityId);
    if (!gpOk(s) || s?.mpg == null || s.mpg < HIGH_MINUTE_MPG) continue;
    signals.push({
      type: 'RETURNING_HIGH_MINUTE_PLAYER',
      playerEntityId: p.playerEntityId,
      playerId: p.playerId,
      displayName: p.displayName,
      magnitude: s.mpg,
      evidence: {
        previousSeasonMinutesPerGame: round1(s.mpg),
        gamesPlayed: s.gamesPlayed,
      },
      provenance: {
        method: PRESEASON_SIGNAL_POLICY_ID,
        tables: [
          'analytics.team_roster_current',
          'analytics.player_game_logs',
        ],
        season: priorSeason,
        note: `High-minute when prior MPG >= ${HIGH_MINUTE_MPG}`,
      },
    });
  }

  for (const p of packet.returningPlayers) {
    const s = byEntity.get(p.playerEntityId);
    if (
      s?.usageAvg == null ||
      s.usageGames == null ||
      s.usageTotalMinutes == null ||
      s.usageGames < MIN_USAGE_GAMES ||
      s.usageTotalMinutes < MIN_USAGE_TOTAL_MINUTES ||
      s.usageAvg < HIGH_USAGE_AVG
    ) {
      continue;
    }
    signals.push({
      type: 'HIGH_USAGE_RETURNER',
      playerEntityId: p.playerEntityId,
      playerId: p.playerId,
      displayName: p.displayName,
      magnitude: s.usageAvg,
      evidence: {
        previousSeasonUsageAvg: round3(s.usageAvg),
        usageGames: s.usageGames,
        usageTotalMinutes: round1(s.usageTotalMinutes),
        aggregationMethod: USAGE_AGGREGATION_METHOD,
        gamesPlayed: s.gamesPlayed,
      },
      provenance: {
        method: PRESEASON_SIGNAL_POLICY_ID,
        tables: [
          'analytics.player_game_advanced',
          'analytics.player_game_logs',
        ],
        season: priorSeason,
        note: `${USAGE_AGGREGATION_METHOD}; floor ${HIGH_USAGE_AVG}; minGames ${MIN_USAGE_GAMES}; minTotalMin ${MIN_USAGE_TOTAL_MINUTES}`,
      },
    });
  }

  for (const p of packet.additions) {
    const s = byEntity.get(p.playerEntityId);
    if (!gpOk(s) || s?.mpg == null || s.mpg < HIGH_MINUTE_MPG) continue;
    signals.push({
      type: 'NEW_HIGH_MINUTE_ADDITION',
      playerEntityId: p.playerEntityId,
      playerId: p.playerId,
      displayName: p.displayName,
      magnitude: s.mpg,
      evidence: {
        previousSeasonMinutesPerGame: round1(s.mpg),
        gamesPlayed: s.gamesPlayed,
      },
      provenance: {
        method: PRESEASON_SIGNAL_POLICY_ID,
        tables: [
          'analytics.team_roster_current',
          'analytics.player_game_logs',
        ],
        season: priorSeason,
        note: `Addition with prior-season MPG >= ${HIGH_MINUTE_MPG} (whole-season all teams)`,
      },
    });
  }

  for (const p of [...packet.returningPlayers, ...packet.additions]) {
    const s = byEntity.get(p.playerEntityId);
    const win = s?.recentCompetitive;
    if (
      s == null ||
      s.mpg == null ||
      win == null ||
      win.recentMpg == null ||
      s.gamesPlayed == null ||
      s.gamesPlayed < RECENT_COMPETITIVE_MIN_SEASON_GP ||
      win.gamesIncluded < RECENT_COMPETITIVE_MIN_WINDOW_GP ||
      s.mpg < RECENT_COMPETITIVE_MIN_BASELINE_MPG
    ) {
      continue;
    }
    const ratio = win.recentMpg / s.mpg;
    if (ratio < RECENT_COMPETITIVE_MINUTES_RATIO) continue;
    signals.push({
      type: 'RECENT_COMPETITIVE_MINUTES_INCREASE',
      playerEntityId: p.playerEntityId,
      playerId: p.playerId,
      displayName: p.displayName,
      magnitude: ratio,
      evidence: {
        gamesIncluded: win.gamesIncluded,
        dateRangeStart: win.dateRangeStart,
        dateRangeEnd: win.dateRangeEnd,
        regularSeasonGameCount: win.regularSeasonGameCount,
        postseasonGameCount: win.postseasonGameCount,
        baselineMpg: round1(s.mpg),
        recentMpg: round1(win.recentMpg),
        ratio: round3(ratio),
        includesPostseasonByPolicy: true,
        scopeLabel: 'recent_competitive_not_regular_season_only',
      },
      provenance: {
        method: PRESEASON_SIGNAL_POLICY_ID,
        tables: ['analytics.player_game_logs', 'analytics.games'],
        season: priorSeason,
        note: `recentMpg >= baselineMpg * ${RECENT_COMPETITIVE_MINUTES_RATIO}; window may include postseason`,
      },
    });
  }

  signals.sort((a, b) => {
    const t = a.type.localeCompare(b.type);
    if (t !== 0) return t;
    if (b.magnitude !== a.magnitude) return b.magnitude - a.magnitude;
    return a.displayName.localeCompare(b.displayName, 'en', {
      sensitivity: 'base',
    });
  });

  return signals;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
