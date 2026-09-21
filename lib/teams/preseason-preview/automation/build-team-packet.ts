/**
 * Deterministic factual preseason team packet (V1.1).
 * No prose. No OpenAI. Reuses continuity + prior baseline helpers.
 */

import {
  getTeamById,
  resolveAnalyticsTeamId,
} from '@/lib/teams/analytics-queries';
import { getTeamRosterContinuity } from '@/lib/teams/team-roster-continuity-queries';
import { previousAnalyticsSeason } from '@/lib/teams/team-roster-continuity';
import { getPreviousSeasonBaseline } from '@/lib/teams/team-previous-season-baseline-queries';
import { getTeamCanonicalRoster } from '@/lib/teams/team-roster-queries';
import { assertAnalyticsSeason } from '@/lib/teams/team-roster-presentation';
import { loadPlayerSeasonRoleStats } from './player-stats-queries';
import { loadRegularSeasonTeamSnapshot } from './regular-season-snapshot';
import type {
  FactProvenance,
  PacketAllGamesSnapshot,
  PacketPlayer,
  PreseasonTeamPacket,
} from './types';

export const PRESEASON_PACKET_VERSION = 'preseason-team-packet-v1.1';

export async function buildPreseasonTeamPacket(
  teamIdOrAbbr: string,
  season: string
): Promise<PreseasonTeamPacket> {
  assertAnalyticsSeason(season);
  const seasonNorm = season;
  const previousSeason = previousAnalyticsSeason(seasonNorm);
  const generatedAt = new Date().toISOString();
  const warnings: string[] = [];

  const teamId = await resolveAnalyticsTeamId(teamIdOrAbbr);
  if (!teamId) {
    throw new Error(`Unknown team: ${teamIdOrAbbr}`);
  }

  const team = await getTeamById(teamId);
  if (!team) {
    throw new Error(`Team not found: ${teamId}`);
  }

  const continuityProv: FactProvenance = {
    method: 'roster_entity_set_diff_v1',
    tables: ['analytics.team_roster_current'],
    season: seasonNorm,
    note: 'Identity = player_entity_id only; membership add/depart/return',
  };

  const allGamesProv: FactProvenance = {
    method: 'previous_season_baseline_v1',
    tables: ['analytics.team_season_averages'],
    season: previousSeason,
    note: 'INTERNAL all-games aggregate — do not label as regular-season Record',
  };

  const scheduleProv: FactProvenance = {
    method: 'preseason_schedule_unavailable_v1',
    tables: ['analytics.games'],
    season: seasonNorm,
    note: 'No preseason tipoffs in analytics.games for this product season',
  };

  const [
    continuity,
    baseline,
    regularSeason,
    currentRosterRows,
    previousRosterRows,
  ] = await Promise.all([
    getTeamRosterContinuity(teamId, seasonNorm),
    getPreviousSeasonBaseline(teamId, seasonNorm),
    loadRegularSeasonTeamSnapshot({ teamId, season: previousSeason }),
    getTeamCanonicalRoster(teamId, seasonNorm),
    getTeamCanonicalRoster(teamId, previousSeason).catch(() => []),
  ]);

  if (!continuity.available) {
    warnings.push(
      continuity.unavailableReason ?? 'Roster continuity unavailable'
    );
  }
  if (!regularSeason.available) {
    warnings.push(
      regularSeason.unavailableReason ??
        'Regular-season snapshot unavailable'
    );
  }

  const positionByEntity = new Map<string, string | null>();
  for (const r of [...currentRosterRows, ...previousRosterRows]) {
    if (!positionByEntity.has(r.playerEntityId)) {
      positionByEntity.set(r.playerEntityId, r.position ?? null);
    }
  }

  const toPacketPlayer = (p: {
    playerEntityId: string;
    displayName: string;
    playerId: string | null;
  }): PacketPlayer => ({
    playerEntityId: p.playerEntityId,
    displayName: p.displayName,
    playerId: p.playerId,
    position: positionByEntity.get(p.playerEntityId) ?? null,
  });

  const currentRoster = continuity.available
    ? [...continuity.returning, ...continuity.added].map(toPacketPlayer)
    : currentRosterRows.map((r) => ({
        playerEntityId: r.playerEntityId,
        displayName: r.displayName,
        playerId: r.playerId,
        position: r.position ?? null,
      }));

  const previousRoster = continuity.available
    ? [...continuity.returning, ...continuity.departed].map(toPacketPlayer)
    : previousRosterRows.map((r) => ({
        playerEntityId: r.playerEntityId,
        displayName: r.displayName,
        playerId: r.playerId,
        position: r.position ?? null,
      }));

  const additions = continuity.available
    ? continuity.added.map(toPacketPlayer)
    : [];
  const departures = continuity.available
    ? continuity.departed.map(toPacketPlayer)
    : [];
  const returningPlayers = continuity.available
    ? continuity.returning.map(toPacketPlayer)
    : [];

  const uniqueForStats = dedupeByEntity([
    ...additions,
    ...departures,
    ...returningPlayers,
  ]);

  const { stats: playerSeasonStats, warnings: statsWarnings } =
    await loadPlayerSeasonRoleStats({
      priorSeason: previousSeason,
      players: uniqueForStats,
    });
  warnings.push(...statsWarnings);

  const previousSeasonAllGames = mapAllGamesSnapshot(baseline, allGamesProv);

  const provenanceSummary: FactProvenance[] = [
    continuityProv,
    allGamesProv,
    regularSeason.provenance,
    scheduleProv,
    {
      method: 'prior_season_role_stats_v1.1',
      tables: [
        'analytics.player_game_logs',
        'analytics.player_season_averages',
        'analytics.player_game_advanced',
      ],
      season: previousSeason,
    },
  ];

  return {
    version: PRESEASON_PACKET_VERSION,
    generatedAt,
    season: seasonNorm,
    previousSeason,
    team: {
      teamId: team.team_id,
      slug: team.abbreviation.toUpperCase(),
      name: team.full_name,
      abbreviation: team.abbreviation.toUpperCase(),
      conference: team.conference,
    },
    previousSeasonRegular: regularSeason,
    previousSeasonAllGames,
    currentRoster: sortPlayers(currentRoster),
    previousRoster: sortPlayers(previousRoster),
    additions: sortPlayers(additions),
    departures: sortPlayers(departures),
    returningPlayers: sortPlayers(returningPlayers),
    playerSeasonStats: playerSeasonStats.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' })
    ),
    schedule: {
      games: [],
      unavailableReason:
        'Preseason schedule not available in analytics.games for this season.',
      provenance: scheduleProv,
    },
    availableWowySummaries: [],
    warnings,
    provenanceSummary,
  };
}

function mapAllGamesSnapshot(
  baseline: Awaited<ReturnType<typeof getPreviousSeasonBaseline>>,
  provenance: FactProvenance
): PacketAllGamesSnapshot {
  const snap = baseline.snapshot;
  if (!baseline.available || !snap.hasData) {
    return {
      season: baseline.baselineSeason,
      available: false,
      unavailableReason:
        baseline.unavailableReason ?? 'Previous season baseline unavailable',
      wins: null,
      losses: null,
      record: null,
      offensiveRating: null,
      defensiveRating: null,
      pace: null,
      gamesPlayed: 0,
      includesPostseason: false,
      metricsScope: 'all_games',
      scopeNote: null,
      provenance,
    };
  }

  const record =
    snap.wins != null && snap.losses != null
      ? `${snap.wins}–${snap.losses}`
      : null;

  return {
    season: snap.season,
    available: true,
    unavailableReason: null,
    wins: snap.wins,
    losses: snap.losses,
    record,
    offensiveRating: snap.ortg,
    defensiveRating: snap.drtg,
    pace: snap.pace,
    gamesPlayed: snap.gamesPlayed,
    includesPostseason: snap.includesPostseason,
    metricsScope: 'all_games',
    scopeNote: snap.scopeNote,
    provenance,
  };
}

function dedupeByEntity(players: PacketPlayer[]): PacketPlayer[] {
  const map = new Map<string, PacketPlayer>();
  for (const p of players) {
    if (!map.has(p.playerEntityId)) map.set(p.playerEntityId, p);
  }
  return [...map.values()];
}

function sortPlayers(players: PacketPlayer[]): PacketPlayer[] {
  return [...players].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' })
  );
}
