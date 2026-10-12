/**
 * Read one stored BallDontLie roster observation and 2025–26 production for two teams.
 * A failed read becomes an unavailable section. It does not fetch a provider.
 * NBA.com snapshots are not mixed into these percentages.
 */

import {
  bdlCurrentFranchiseTeamMapQuery,
  bdlEligibleBatchQuery,
  bdlLatestBatchQuery,
  bdlTeamMembershipQuery,
  classifyBdlRosterIdentity,
  explainRosterEligibility,
  resolveRosterTeam,
  rosterObservationEtDate,
  type RosterTeamMapRow,
  type StoredRosterBatch,
} from '@/lib/roster/bdl-roster-read';
import { BDL_ROSTER_SEASON_LABEL } from '@/lib/roster/bdl-active-roster';
import type { HistoricalWindow } from './window';
import {
  rosterOtherTeamQuery,
  rosterTeamProductionQuery,
} from './queries';
import {
  hiddenRosterForUnconfirmedTeam,
  presentBdlRoster,
  teamContinuity,
  type ProductionRow,
  type RosterMember,
  type RosterPresentation,
} from './roster';

type Sql = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function productionRow(row: Record<string, unknown>): ProductionRow | null {
  const teamId = row.team_id == null ? '' : String(row.team_id);
  const playerId = row.player_id == null ? '' : String(row.player_id);
  const minutes = num(row.minutes);
  const fga = num(row.fga);
  const fta = num(row.fta);
  const usageMass = num(row.usage_mass);
  const usagePossessions = num(row.usage_possessions);
  if (!teamId || !playerId || minutes == null || fga == null || fta == null) return null;
  return {
    teamId,
    playerId,
    minutes,
    fga,
    fta,
    usageMass: usageMass ?? 0,
    usagePossessions: usagePossessions ?? 0,
  };
}

function storedBatch(row: Record<string, unknown>): StoredRosterBatch | null {
  const batchId = row.batch_id == null ? '' : String(row.batch_id);
  const collectedAt = isoTimestamp(row.collected_at);
  const teamCount = num(row.team_count);
  const playerCount = num(row.player_count);
  if (!batchId || !collectedAt || Number.isNaN(Date.parse(collectedAt)) || teamCount == null || playerCount == null) return null;
  const complete = String(row.status) === 'complete' && row.gate_ok !== false;
  return {
    batchId,
    provider: 'balldontlie',
    seasonLabel: row.season_label == null ? BDL_ROSTER_SEASON_LABEL : String(row.season_label),
    collectedAt,
    status: complete ? 'complete' : 'incomplete',
    teamCount,
    playerCount,
  };
}

function memberFromRow(
  row: Record<string, unknown>,
  teamMap: readonly RosterTeamMapRow[],
  analyticsTeamId: string
): RosterMember | null {
  const providerPlayerId = row.provider_player_id == null ? '' : String(row.provider_player_id);
  const providerTeamId = row.provider_team_id == null ? '' : String(row.provider_team_id);
  const teamAbbreviation = row.team_abbreviation == null ? '' : String(row.team_abbreviation);
  if (!providerPlayerId || !providerTeamId || !teamAbbreviation) return null;
  const team = resolveRosterTeam({ providerTeamId, teamAbbreviation }, teamMap);
  if (!team.ok || team.analyticsTeamId !== analyticsTeamId) {
    return {
      teamId: analyticsTeamId,
      nbaPlayerId: providerPlayerId,
      analyticsPlayerId: null,
      identityStatus: 'unresolved_ambiguous',
      name: null,
    };
  }
  const playerRows = num(row.player_rows) ?? 0;
  const historicalPlayerId = row.historical_player_id == null || String(row.historical_player_id) === ''
    ? null
    : String(row.historical_player_id);
  const identity = classifyBdlRosterIdentity({
    providerPlayerId,
    lookup: playerRows === 0 ? 'missing_player_row' : playerRows === 1 ? 'matched' : 'conflict',
    playerId: historicalPlayerId,
    hasPriorSeasonProduction: row.has_prior_season_production === true,
  });
  if (identity.resolution === 'UNRESOLVED') {
    return {
      teamId: analyticsTeamId,
      nbaPlayerId: providerPlayerId,
      analyticsPlayerId: null,
      identityStatus: 'unresolved_no_bridge',
      name: null,
    };
  }
  if (identity.resolution === 'AMBIGUOUS') {
    return {
      teamId: analyticsTeamId,
      nbaPlayerId: providerPlayerId,
      analyticsPlayerId: null,
      identityStatus: 'unresolved_ambiguous',
      name: null,
    };
  }
  return {
    teamId: analyticsTeamId,
    nbaPlayerId: providerPlayerId,
    analyticsPlayerId: identity.historicalPlayerId,
    identityStatus: 'resolved',
    name: row.player_name == null || String(row.player_name).trim() === '' ? null : String(row.player_name),
  };
}

export async function loadRosterContinuity(
  run: Sql,
  input: {
    gameDate: string;
    tipoffAt: string | null;
    teamIds: [string, string];
    awayAbbr: string;
    homeAbbr: string;
    window: HistoricalWindow;
  }
): Promise<RosterPresentation> {
  if (!input.tipoffAt) {
    return presentBdlRoster({
      observationEtDate: null,
      collectedAt: null,
      reason: 'invalid_time',
      freshness: null,
      teams: [],
    });
  }

  const eligibleQuery = bdlEligibleBatchQuery(BDL_ROSTER_SEASON_LABEL, input.tipoffAt);
  const eligibleRows = await run(eligibleQuery.text, eligibleQuery.params);
  let batch = eligibleRows.map(storedBatch).find((row): row is StoredRosterBatch => row != null) ?? null;
  if (!batch) {
    const latestQuery = bdlLatestBatchQuery(BDL_ROSTER_SEASON_LABEL);
    const latestRows = await run(latestQuery.text, latestQuery.params);
    batch = latestRows.map(storedBatch).find((row): row is StoredRosterBatch => row != null) ?? null;
  }
  const eligibility = explainRosterEligibility({
    batches: batch ? [batch] : [],
    tipoffAt: input.tipoffAt,
    gameEtDate: input.gameDate,
  });
  const observationEtDate = eligibility.batch ? rosterObservationEtDate(eligibility.batch.collectedAt) : null;
  if (!eligibility.batch || !eligibility.sharesAllowed || eligibility.reason !== 'eligible') {
    return presentBdlRoster({
      observationEtDate,
      collectedAt: eligibility.batch?.collectedAt ?? null,
      reason: eligibility.reason,
      freshness: eligibility.freshness,
      teams: [],
    });
  }

  const mapQuery = bdlCurrentFranchiseTeamMapQuery();
  const awayMembership = bdlTeamMembershipQuery(eligibility.batch.batchId, input.awayAbbr);
  const homeMembership = bdlTeamMembershipQuery(eligibility.batch.batchId, input.homeAbbr);
  const productionQuery = rosterTeamProductionQuery(input.window, input.teamIds);
  const [mapResult, awayResult, homeResult, productionResult] = await Promise.all([
    run(mapQuery.text, mapQuery.params),
    run(awayMembership.text, awayMembership.params),
    run(homeMembership.text, homeMembership.params),
    run(productionQuery.text, productionQuery.params),
  ]);
  const teamMap: RosterTeamMapRow[] = mapResult.map((row) => ({
    providerTeamId: String(row.provider_team_id),
    abbreviation: String(row.abbreviation),
    analyticsTeamId: String(row.analytics_team_id),
  }));
  const members = [
    ...awayResult.map((row) => memberFromRow(row, teamMap, input.teamIds[0])).filter((row): row is RosterMember => row != null),
    ...homeResult.map((row) => memberFromRow(row, teamMap, input.teamIds[1])).filter((row): row is RosterMember => row != null),
  ];
  const production = productionResult.map(productionRow).filter((row): row is ProductionRow => row != null);
  const resolvedIds = [...new Set(members.map((member) => member.analyticsPlayerId).filter((id): id is string => id != null))];
  let other: ProductionRow[] = [];
  if (resolvedIds.length > 0) {
    const otherQuery = rosterOtherTeamQuery(input.window, input.teamIds, resolvedIds);
    other = (await run(otherQuery.text, otherQuery.params)).map(productionRow).filter((row): row is ProductionRow => row != null);
  }
  const allProduction = [...production, ...other];
  const sides = [
    { teamId: input.teamIds[0], abbr: input.awayAbbr },
    { teamId: input.teamIds[1], abbr: input.homeAbbr },
  ];
  return presentBdlRoster({
    observationEtDate,
    collectedAt: eligibility.batch.collectedAt,
    reason: eligibility.reason,
    freshness: eligibility.freshness,
    teams: sides.map((side) =>
      teamContinuity({
        teamId: side.teamId,
        abbr: side.abbr,
        observationDate: observationEtDate ?? '',
        members,
        production: allProduction,
      })
    ),
  });
}

export { hiddenRosterForUnconfirmedTeam };
