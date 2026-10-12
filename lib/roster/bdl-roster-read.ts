/**
 * Read model for stored BallDontLie roster observations.
 * The scoreboard Matchup loader reads this module. It does not replace historical formulas.
 * Pregame eligibility uses collected_at < tipoff.
 * The existing NBA.com reader still uses UTC snapshot_date <= the game's Eastern date.
 * That coarser rule can accept an observation collected after tipoff on the same UTC date.
 * This adapter does not replace that reader.
 */

import { historicalWindow } from '@/lib/pregame-matchup/window';
import {
  FRESH_MAX_DAYS,
  INFORMATIVE_MAX_DAYS,
  type RosterFreshness,
} from '@/lib/pregame-matchup/roster';
import { BDL_ROSTER_BATCH_TABLE, BDL_ROSTER_MEMBER_TABLE } from '@/lib/roster/bdl-roster-persist';
import { BDL_ROSTER_COMPLETENESS, BDL_ROSTER_PROVIDER } from '@/lib/roster/bdl-active-roster';

export type BdlIdentityResolution =
  | 'RESOLVED_WITH_HISTORY'
  | 'RESOLVED_NO_OBSERVED_PRIOR_SEASON_PRODUCTION'
  | 'UNRESOLVED'
  | 'AMBIGUOUS';

export type ObservedRosterMember = {
  provider: typeof BDL_ROSTER_PROVIDER;
  providerPlayerId: string;
  providerTeamId: string;
  historicalPlayerId: string | null;
  teamId: string;
  observedAt: string;
  resolution: BdlIdentityResolution;
  evidenceCompleteness: typeof BDL_ROSTER_COMPLETENESS;
};

export type StoredRosterBatch = {
  batchId: string;
  provider: typeof BDL_ROSTER_PROVIDER;
  seasonLabel: string;
  collectedAt: string;
  status: 'complete' | 'incomplete';
  teamCount: number;
  playerCount: number;
};

const ET = 'America/New_York';

export function rosterObservationEtDate(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(parsed));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function etDayNumber(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const value = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(value) ? Math.round(value / 86_400_000) : null;
}

export function classifyBdlRosterIdentity(input: {
  providerPlayerId: string;
  lookup: 'missing_player_row' | 'matched' | 'conflict' | 'unavailable';
  playerId?: string | null;
  hasPriorSeasonProduction?: boolean;
}): { resolution: BdlIdentityResolution; historicalPlayerId: string | null } {
  if (input.lookup === 'unavailable') return { resolution: 'UNRESOLVED', historicalPlayerId: null };
  if (input.lookup === 'conflict') return { resolution: 'AMBIGUOUS', historicalPlayerId: null };
  if (input.lookup === 'missing_player_row') {
    return { resolution: 'RESOLVED_NO_OBSERVED_PRIOR_SEASON_PRODUCTION', historicalPlayerId: null };
  }
  if (!input.playerId || input.playerId !== input.providerPlayerId) {
    return { resolution: 'AMBIGUOUS', historicalPlayerId: null };
  }
  if (input.hasPriorSeasonProduction) {
    return { resolution: 'RESOLVED_WITH_HISTORY', historicalPlayerId: input.playerId };
  }
  return { resolution: 'RESOLVED_NO_OBSERVED_PRIOR_SEASON_PRODUCTION', historicalPlayerId: input.playerId };
}

export type RosterTeamMapRow = {
  providerTeamId: string;
  abbreviation: string;
  analyticsTeamId: string;
};

/**
 * Current-franchise map. Join abbreviation, and keep only East/West rows on both sides.
 * Do not equate raw.teams.id with analytics.teams.team_id. Historical rows such as
 * BallDontLie 42 (Washington Capitols) share an abbreviation with a current franchise.
 */
export function bdlCurrentFranchiseTeamMapQuery(): { text: string; params: [] } {
  return {
    text: `SELECT r.id::text AS provider_team_id,
            upper(trim(r.abbreviation)) AS abbreviation,
            t.team_id AS analytics_team_id
     FROM raw.teams r
     JOIN analytics.teams t
       ON upper(trim(r.abbreviation)) = upper(trim(t.abbreviation))
      AND t.conference IN ('East', 'West')
      AND btrim(r.conference) IN ('East', 'West')`,
    params: [],
  };
}

export function resolveRosterTeam(
  input: { providerTeamId: string; teamAbbreviation: string },
  rows: readonly RosterTeamMapRow[]
): { ok: true; analyticsTeamId: string } | { ok: false; reason: 'missing' | 'ambiguous' } {
  const abbreviation = input.teamAbbreviation.trim().toUpperCase();
  const analyticsIds = new Set<string>();
  for (const row of rows) {
    if (row.providerTeamId !== input.providerTeamId) continue;
    if (row.abbreviation.trim().toUpperCase() !== abbreviation) continue;
    if (row.analyticsTeamId) analyticsIds.add(row.analyticsTeamId);
  }
  if (analyticsIds.size === 1) {
    const analyticsTeamId = [...analyticsIds][0];
    if (analyticsTeamId) return { ok: true, analyticsTeamId };
  }
  if (analyticsIds.size === 0) return { ok: false, reason: 'missing' };
  return { ok: false, reason: 'ambiguous' };
}

export function toObservedRosterMember(input: {
  providerPlayerId: string;
  providerTeamId: string;
  teamAbbreviation: string;
  teamMap: readonly RosterTeamMapRow[];
  observedAt: string;
  lookup: 'missing_player_row' | 'matched' | 'conflict' | 'unavailable';
  playerId?: string | null;
  hasPriorSeasonProduction?: boolean;
}): ObservedRosterMember | null {
  const team = resolveRosterTeam(input, input.teamMap);
  if (!team.ok) return null;
  const identity = classifyBdlRosterIdentity(input);
  return {
    provider: BDL_ROSTER_PROVIDER,
    providerPlayerId: input.providerPlayerId,
    providerTeamId: input.providerTeamId,
    historicalPlayerId: identity.historicalPlayerId,
    teamId: team.analyticsTeamId,
    observedAt: input.observedAt,
    resolution: identity.resolution,
    evidenceCompleteness: BDL_ROSTER_COMPLETENESS,
  };
}

export function explainRosterEligibility(input: {
  batches: StoredRosterBatch[];
  tipoffAt: string;
  gameEtDate: string;
}): {
  batch: StoredRosterBatch | null;
  reason: 'eligible' | 'missing' | 'incomplete' | 'after_tipoff' | 'invalid_time';
  freshness: RosterFreshness | null;
  sharesAllowed: boolean;
} {
  const tipoff = Date.parse(input.tipoffAt);
  if (!Number.isFinite(tipoff)) {
    return { batch: null, reason: 'invalid_time', freshness: null, sharesAllowed: false };
  }
  const complete = input.batches.filter((batch) => batch.status === 'complete' && batch.provider === BDL_ROSTER_PROVIDER);
  if (input.batches.length === 0) {
    return { batch: null, reason: 'missing', freshness: null, sharesAllowed: false };
  }
  if (complete.length === 0) {
    return { batch: null, reason: 'incomplete', freshness: null, sharesAllowed: false };
  }
  const eligible = complete
    .filter((batch) => {
      const collected = Date.parse(batch.collectedAt);
      return Number.isFinite(collected) && collected < tipoff;
    })
    .sort((left, right) => Date.parse(right.collectedAt) - Date.parse(left.collectedAt));
  if (eligible.length === 0) {
    return { batch: null, reason: 'after_tipoff', freshness: null, sharesAllowed: false };
  }
  const batch = eligible[0]!;
  const observedEt = rosterObservationEtDate(batch.collectedAt);
  const observedDay = observedEt ? etDayNumber(observedEt) : null;
  const gameDay = etDayNumber(input.gameEtDate);
  if (observedDay == null || gameDay == null || observedDay > gameDay) {
    return { batch: null, reason: 'after_tipoff', freshness: null, sharesAllowed: false };
  }
  const age = gameDay - observedDay;
  const freshness: RosterFreshness = age <= FRESH_MAX_DAYS ? 'fresh' : age <= INFORMATIVE_MAX_DAYS ? 'informative' : 'stale';
  return {
    batch,
    reason: 'eligible',
    freshness,
    sharesAllowed: freshness !== 'stale',
  };
}

const PLAYED_MINUTES = `CASE
         WHEN l.minutes ~ '^[0-9]+(\\.[0-9]+)?$' AND l.minutes::numeric > 0 THEN l.minutes::numeric
         ELSE NULL
       END`;

/** Latest complete batch collected strictly before tipoff. */
export function bdlEligibleBatchQuery(seasonLabel: string, tipoffAt: string): { text: string; params: unknown[] } {
  return {
    text: `SELECT batch_id::text AS batch_id,
            provider,
            season_label,
            collected_at,
            status,
            team_count,
            player_count,
            completeness_scope
     FROM ${BDL_ROSTER_BATCH_TABLE}
     WHERE provider = $1
       AND season_label = $2
       AND status = 'complete'
       AND gate_ok
       AND collected_at < $3::timestamptz
     ORDER BY collected_at DESC
     LIMIT 1`,
    params: [BDL_ROSTER_PROVIDER, seasonLabel, tipoffAt],
  };
}

/**
 * Membership for one stored batch and one abbreviation.
 * Joins analytics.players on the BallDontLie id. Does not read nba_player_id.
 */
export function bdlTeamMembershipQuery(batchId: string, teamAbbreviation: string): { text: string; params: unknown[] } {
  const window = historicalWindow();
  return {
    text: `SELECT m.provider,
            m.provider_player_id,
            m.provider_team_id,
            m.team_abbreviation,
            p.player_id AS historical_player_id,
            p.full_name AS player_name,
            count(p.player_id)::int AS player_rows,
            exists (
              SELECT 1
              FROM analytics.player_game_logs l
              WHERE l.player_id = m.provider_player_id
                AND l.season = $3
                AND l.game_date >= $4::date
                AND l.game_date < $5::date
                AND l.game_date <> $6::date
                AND (${PLAYED_MINUTES}) IS NOT NULL
            ) AS has_prior_season_production
     FROM ${BDL_ROSTER_MEMBER_TABLE} m
     LEFT JOIN analytics.players p
       ON p.player_id = m.provider_player_id
     WHERE m.batch_id = $1::uuid
       AND m.provider = 'balldontlie'
       AND m.team_abbreviation = $2
     GROUP BY m.provider, m.provider_player_id, m.provider_team_id, m.team_abbreviation, p.player_id, p.full_name`,
    params: [batchId, teamAbbreviation, window.season, window.startInclusive, window.endExclusive, window.excludeDate],
  };
}

/** Newest stored batch, including incomplete rows, so a miss can be explained without scanning members. */
export function bdlLatestBatchQuery(seasonLabel: string): { text: string; params: unknown[] } {
  return {
    text: `SELECT batch_id::text AS batch_id,
            provider,
            season_label,
            collected_at,
            status,
            gate_ok,
            team_count,
            player_count
     FROM ${BDL_ROSTER_BATCH_TABLE}
     WHERE provider = $1
       AND season_label = $2
     ORDER BY collected_at DESC
     LIMIT 1`,
    params: [BDL_ROSTER_PROVIDER, seasonLabel],
  };
}
