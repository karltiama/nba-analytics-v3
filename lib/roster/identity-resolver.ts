/**
 * NBA.com roster row → analytics.players.player_id identity resolver.
 *
 * Level 1: provider_id_map NBA → shared internal → balldontlie → analytics
 * Level 2: unique normalized-name + optional team/PGL evidence
 * Level 3: unresolved / ambiguous (never silent guess)
 */

import { normalizePersonName } from './normalize-player-name';

export type RosterObservation = {
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  teamInternalId: string;
  jersey: string | null;
  position: string | null;
  season: string; // e.g. '2025-26'
};

export type ResolveStatus =
  | 'provider_match'
  | 'safe_fallback_match'
  | 'unresolved'
  | 'ambiguous';

export type GapCause =
  | 'nba_provider_row_missing'
  | 'nba_to_shared_mapping_missing'
  | 'shared_to_bdl_mapping_missing'
  | 'analytics_player_exists_bridge_missing'
  | 'analytics_player_absent'
  | 'rookie_or_new_player'
  | 'diacritic_mismatch'
  | 'suffix_mismatch'
  | 'duplicate_name_ambiguity'
  | 'conflicting_identities'
  | 'other';

export type AnalyticsPlayerCandidate = {
  playerId: string;
  fullName: string;
  position: string | null;
  /** Team abbreviations this player logged for in the analytics season (start-year). */
  pglTeamAbbrevs: string[];
};

export type ProviderMapRow = {
  provider: 'nba' | 'balldontlie';
  providerId: string;
  internalId: string;
};

export type ResolverIndex = {
  /** provider='nba', keyed by provider_id (NBA PLAYER_ID) */
  nbaByProviderId: Map<string, ProviderMapRow>;
  /** provider='balldontlie', keyed by internal_id (usually NBA id) */
  bdlByInternalId: Map<string, ProviderMapRow[]>;
  /** provider='balldontlie', keyed by provider_id (BDL/analytics id) */
  bdlByProviderId: Map<string, ProviderMapRow>;
  /** analytics.players by id */
  analyticsById: Map<string, AnalyticsPlayerCandidate>;
  /** normalized name → analytics candidates */
  analyticsByNormalizedName: Map<string, AnalyticsPlayerCandidate[]>;
};

export type ResolveResult = {
  status: ResolveStatus;
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  jersey: string | null;
  position: string | null;
  analyticsPlayerId: string | null;
  method: string | null;
  gapCause: GapCause | null;
  reason: string | null;
  candidates: Array<{ playerId: string; fullName: string }>;
};

export function buildResolverIndex(args: {
  providerMaps: ProviderMapRow[];
  analyticsPlayers: AnalyticsPlayerCandidate[];
}): ResolverIndex {
  const nbaByProviderId = new Map<string, ProviderMapRow>();
  const bdlByInternalId = new Map<string, ProviderMapRow[]>();
  const bdlByProviderId = new Map<string, ProviderMapRow>();

  for (const row of args.providerMaps) {
    if (row.provider === 'nba') {
      nbaByProviderId.set(row.providerId, row);
    } else if (row.provider === 'balldontlie') {
      bdlByProviderId.set(row.providerId, row);
      const list = bdlByInternalId.get(row.internalId) ?? [];
      list.push(row);
      bdlByInternalId.set(row.internalId, list);
    }
  }

  const analyticsById = new Map<string, AnalyticsPlayerCandidate>();
  const analyticsByNormalizedName = new Map<string, AnalyticsPlayerCandidate[]>();
  for (const p of args.analyticsPlayers) {
    analyticsById.set(p.playerId, p);
    const key = normalizePersonName(p.fullName);
    if (!key) continue;
    const list = analyticsByNormalizedName.get(key) ?? [];
    list.push(p);
    analyticsByNormalizedName.set(key, list);
  }

  return {
    nbaByProviderId,
    bdlByInternalId,
    bdlByProviderId,
    analyticsById,
    analyticsByNormalizedName,
  };
}

function looksLikeRookieNameAbsent(obs: RosterObservation, rawCandidates: number): boolean {
  // Heuristic only for gap taxonomy — not used to auto-resolve.
  return rawCandidates === 0 && /^\d{7,}$/.test(obs.nbaPlayerId);
}

/**
 * Resolve one NBA.com roster observation to an analytics player id.
 */
export function resolveRosterIdentity(
  obs: RosterObservation,
  index: ResolverIndex
): ResolveResult {
  const base = {
    nbaPlayerId: obs.nbaPlayerId,
    fullName: obs.fullName,
    teamAbbr: obs.teamAbbr,
    jersey: obs.jersey,
    position: obs.position,
  };

  // --- Level 1: provider chain ---
  const nbaMap = index.nbaByProviderId.get(obs.nbaPlayerId);
  if (!nbaMap) {
    // Fall through to Level 2, but remember gap if that also fails.
    const fallback = trySafeFallback(obs, index, 'nba_provider_row_missing');
    return fallback;
  }

  const bdlMaps = index.bdlByInternalId.get(nbaMap.internalId) ?? [];
  if (bdlMaps.length === 0) {
    const fallback = trySafeFallback(obs, index, 'shared_to_bdl_mapping_missing');
    return fallback;
  }

  if (bdlMaps.length > 1) {
    const distinct = [...new Set(bdlMaps.map((m) => m.providerId))];
    if (distinct.length > 1) {
      return {
        ...base,
        status: 'ambiguous',
        analyticsPlayerId: null,
        method: null,
        gapCause: 'conflicting_identities',
        reason: `Multiple balldontlie provider_ids for internal_id=${nbaMap.internalId}: ${distinct.join(',')}`,
        candidates: distinct.map((id) => ({
          playerId: id,
          fullName: index.analyticsById.get(id)?.fullName ?? '(unknown)',
        })),
      };
    }
  }

  const bdlId = bdlMaps[0].providerId;
  const analytics = index.analyticsById.get(bdlId);
  if (!analytics) {
    // Bridge points at missing analytics row — try fallback, else unresolved.
    const fallback = trySafeFallback(obs, index, 'analytics_player_absent');
    if (fallback.status !== 'unresolved' && fallback.status !== 'ambiguous') {
      return fallback;
    }
    return {
      ...base,
      status: 'unresolved',
      analyticsPlayerId: null,
      method: null,
      gapCause: 'analytics_player_absent',
      reason: `balldontlie provider_id=${bdlId} not found in analytics.players`,
      candidates: [{ playerId: bdlId, fullName: '(missing analytics row)' }],
    };
  }

  return {
    ...base,
    status: 'provider_match',
    analyticsPlayerId: analytics.playerId,
    method: 'provider_id_map:nba→internal→balldontlie',
    gapCause: null,
    reason: null,
    candidates: [],
  };
}

function trySafeFallback(
  obs: RosterObservation,
  index: ResolverIndex,
  primaryGap: GapCause
): ResolveResult {
  const base = {
    nbaPlayerId: obs.nbaPlayerId,
    fullName: obs.fullName,
    teamAbbr: obs.teamAbbr,
    jersey: obs.jersey,
    position: obs.position,
  };

  const key = normalizePersonName(obs.fullName);
  const raw = key ? index.analyticsByNormalizedName.get(key) ?? [] : [];

  if (raw.length === 0) {
    // Detect diacritic/suffix-only misses: any analytics name equal after norm already empty.
    // Check if raw name (without strip) would have matched differently — taxonomy only.
    let gapCause: GapCause = primaryGap;
    if (looksLikeRookieNameAbsent(obs, 0)) {
      gapCause = primaryGap === 'nba_provider_row_missing'
        ? 'rookie_or_new_player'
        : primaryGap === 'shared_to_bdl_mapping_missing'
          ? 'analytics_player_exists_bridge_missing'
          : 'analytics_player_absent';
      // Prefer clearer labels:
      if (primaryGap === 'shared_to_bdl_mapping_missing') {
        // Name absent → more likely analytics absent / rookie than bridge-only.
        gapCause = 'analytics_player_absent';
      } else if (primaryGap === 'nba_provider_row_missing') {
        gapCause = 'rookie_or_new_player';
      }
    } else if (primaryGap === 'shared_to_bdl_mapping_missing') {
      gapCause = 'analytics_player_exists_bridge_missing';
      // But name not found — override:
      gapCause = 'analytics_player_absent';
    } else if (primaryGap === 'nba_provider_row_missing') {
      gapCause = 'analytics_player_absent';
    }

    // Refine diacritic/suffix: if stripping only diacritics from obs finds nothing,
    // but a looser check against unnormalized... we already normalized both sides.
    // Compare suffix: if fullName with suffix removed equals something we already tried.
    const withoutSuffixPass = normalizePersonName(obs.fullName);
    if (!withoutSuffixPass) {
      gapCause = 'other';
    }

    return {
      ...base,
      status: 'unresolved',
      analyticsPlayerId: null,
      method: null,
      gapCause,
      reason: `No analytics player with normalized name "${key}" (primary=${primaryGap})`,
      candidates: [],
    };
  }

  if (raw.length === 1) {
    // Unique normalized name — allowed as safe fallback.
    // Prefer additional team evidence when available, but do not reject unique name solely for team mismatch
    // (trades mid-season). Record method with team evidence when present.
    const only = raw[0];
    const teamHit = only.pglTeamAbbrevs.includes(obs.teamAbbr.toUpperCase());
    return {
      ...base,
      status: 'safe_fallback_match',
      analyticsPlayerId: only.playerId,
      method: teamHit
        ? 'normalized_name_unique+pgl_team'
        : 'normalized_name_unique',
      gapCause: null,
      reason: null,
      candidates: [],
    };
  }

  // Multiple name hits — require team filter to uniquely resolve; else ambiguous.
  const teamFiltered = raw.filter((p) =>
    p.pglTeamAbbrevs.includes(obs.teamAbbr.toUpperCase())
  );

  if (teamFiltered.length === 1) {
    return {
      ...base,
      status: 'safe_fallback_match',
      analyticsPlayerId: teamFiltered[0].playerId,
      method: 'normalized_name+pgl_team_disambiguation',
      gapCause: null,
      reason: null,
      candidates: [],
    };
  }

  if (teamFiltered.length === 0) {
    // Never resolve on name(+position) alone when multiple people share the name.
    return {
      ...base,
      status: 'ambiguous',
      analyticsPlayerId: null,
      method: null,
      gapCause: 'duplicate_name_ambiguity',
      reason: `${raw.length} analytics players share normalized name "${key}"; none match team ${obs.teamAbbr}`,
      candidates: raw.map((p) => ({ playerId: p.playerId, fullName: p.fullName })),
    };
  }

  // Multiple candidates on the same team — try position only to break the tie.
  const pos = (obs.position ?? '').trim().toUpperCase();
  const posFiltered = pos
    ? teamFiltered.filter((p) => (p.position ?? '').toUpperCase() === pos)
    : [];
  if (posFiltered.length === 1) {
    return {
      ...base,
      status: 'safe_fallback_match',
      analyticsPlayerId: posFiltered[0].playerId,
      method: 'normalized_name+pgl_team+position_disambiguation',
      gapCause: null,
      reason: null,
      candidates: [],
    };
  }

  return {
    ...base,
    status: 'ambiguous',
    analyticsPlayerId: null,
    method: null,
    gapCause: 'duplicate_name_ambiguity',
    reason: `${teamFiltered.length} analytics players share name+team ${obs.teamAbbr}`,
    candidates: teamFiltered.map((p) => ({ playerId: p.playerId, fullName: p.fullName })),
  };
}

export function classifyGapCounts(results: ResolveResult[]): Record<GapCause | 'none', number> {
  const counts: Record<string, number> = { none: 0 };
  for (const r of results) {
    if (!r.gapCause) {
      counts.none = (counts.none ?? 0) + 1;
    } else {
      counts[r.gapCause] = (counts[r.gapCause] ?? 0) + 1;
    }
  }
  return counts as Record<GapCause | 'none', number>;
}
