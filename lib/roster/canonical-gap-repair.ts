/**
 * Narrow canonical-identity gap repair for NBA.com-rostered players.
 *
 * Does NOT invent BDL IDs. analytics.players.player_id is BDL-coupled.
 * Class C NBA-only rookies → blocked_by_schema unless architecture changes.
 */

import { decideBdlBridgeBackfill, type ExistingMap } from './provider-map-backfill';
import { normalizePersonName } from './normalize-player-name';

export type GapQueueRow = {
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  jersey: string | null;
  position: string | null;
  status: 'unresolved' | 'ambiguous' | string;
  gapCause: string | null;
  howAcquired?: string | null;
  supplementalStatus?: string | number | null;
  experience?: string | number | null;
  school?: string | null;
};

export type LocalPlayer = {
  playerId: string;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  position?: string | null;
  height?: string | null;
  weight?: string | null;
  source: 'analytics' | 'raw';
};

export type RepairClass = 'A' | 'B' | 'C' | 'D';

export type ProposedRepairAction =
  | 'bridge_existing_player'
  | 'promote_raw_player_to_analytics'
  | 'create_canonical_from_nba'
  | 'manual_review'
  | 'blocked_by_schema';

export type RepairPlanItem = {
  nbaPlayerId: string;
  fullName: string;
  teamAbbr: string;
  jersey: string | null;
  position: string | null;
  howAcquired: string | null;
  supplementalStatus: string | number | null;
  repairClass: RepairClass;
  taxonomy: string;
  rawBdlExists: boolean;
  analyticsExists: boolean;
  nbaProviderMapExists: boolean;
  bdlProviderMapExists: boolean;
  candidateAnalyticsIds: string[];
  candidateRawIds: string[];
  action: ProposedRepairAction;
  /** When bridging/promoting */
  targetAnalyticsPlayerId: string | null;
  /** Insert nba provider row? */
  insertNbaMap: boolean;
  /** Insert bdl bridge? */
  insertBdlBridge: boolean;
  /** Promote raw → analytics? */
  promoteRaw: boolean;
  reason: string;
};

/** High-confidence nickname / legal-name aliases (normalized keys). */
export const HIGH_CONFIDENCE_NAME_ALIASES: Record<string, string> = {
  'nic claxton': 'nicolas claxton',
  'bones hyland': 'nahshon hyland',
  'bub carrington': 'carlton carrington',
  'alex sarr': 'alexandre sarr',
  'ace bailey': 'airious bailey',
  'yang hansen': 'hansen yang',
};

/**
 * analytics.players.player_id is structurally equal to BDL/raw.players.id.
 * Never fabricate numeric BDL-like ids for NBA-only rookies.
 */
export const ANALYTICS_PLAYER_ID_IS_BDL_COUPLED = true as const;

export function resolveAliasNormalizedName(fullName: string): string {
  const key = normalizePersonName(fullName);
  return HIGH_CONFIDENCE_NAME_ALIASES[key] ?? key;
}

export function planCanonicalGapRepairs(args: {
  queue: GapQueueRow[];
  existingMaps: ExistingMap[];
  analyticsPlayers: LocalPlayer[];
  rawPlayers: LocalPlayer[];
}): RepairPlanItem[] {
  const nbaByProvider = new Map(
    args.existingMaps
      .filter((m) => m.provider === 'nba')
      .map((m) => [m.providerId, m])
  );
  const bdlByInternal = new Map<string, ExistingMap[]>();
  for (const m of args.existingMaps.filter((m) => m.provider === 'balldontlie')) {
    const list = bdlByInternal.get(m.internalId) ?? [];
    list.push(m);
    bdlByInternal.set(m.internalId, list);
  }

  const analyticsByNorm = new Map<string, LocalPlayer[]>();
  for (const p of args.analyticsPlayers) {
    const k = normalizePersonName(p.fullName);
    if (!k) continue;
    const list = analyticsByNorm.get(k) ?? [];
    list.push(p);
    analyticsByNorm.set(k, list);
  }
  const rawByNorm = new Map<string, LocalPlayer[]>();
  for (const p of args.rawPlayers) {
    const k = normalizePersonName(p.fullName);
    if (!k) continue;
    const list = rawByNorm.get(k) ?? [];
    list.push(p);
    rawByNorm.set(k, list);
  }

  const plans: RepairPlanItem[] = [];

  for (const q of args.queue) {
    const nbaMap = nbaByProvider.get(q.nbaPlayerId);
    const bdlList = nbaMap ? bdlByInternal.get(nbaMap.internalId) ?? [] : [];
    const norm = normalizePersonName(q.fullName);
    const aliasNorm = resolveAliasNormalizedName(q.fullName);
    const analyticsHits = uniqueById([
      ...(analyticsByNorm.get(norm) ?? []),
      ...(aliasNorm !== norm ? analyticsByNorm.get(aliasNorm) ?? [] : []),
    ]);
    const rawHits = uniqueById([
      ...(rawByNorm.get(norm) ?? []),
      ...(aliasNorm !== norm ? rawByNorm.get(aliasNorm) ?? [] : []),
    ]);

    const base = {
      nbaPlayerId: q.nbaPlayerId,
      fullName: q.fullName,
      teamAbbr: q.teamAbbr,
      jersey: q.jersey,
      position: q.position,
      howAcquired: q.howAcquired ?? null,
      supplementalStatus: q.supplementalStatus ?? null,
      rawBdlExists: rawHits.length > 0,
      analyticsExists: analyticsHits.length > 0,
      nbaProviderMapExists: !!nbaMap,
      bdlProviderMapExists: bdlList.length > 0,
      candidateAnalyticsIds: analyticsHits.map((p) => p.playerId),
      candidateRawIds: rawHits.map((p) => p.playerId),
      insertNbaMap: false,
      insertBdlBridge: false,
      promoteRaw: false,
      targetAnalyticsPlayerId: null as string | null,
    };

    // Class D — ambiguous / conflicting
    if (
      q.status === 'ambiguous' ||
      q.gapCause === 'conflicting_identities' ||
      q.gapCause === 'duplicate_name_ambiguity' ||
      analyticsHits.length > 1 ||
      rawHits.length > 1
    ) {
      plans.push({
        ...base,
        repairClass: 'D',
        taxonomy:
          q.gapCause === 'duplicate_name_ambiguity' || analyticsHits.length > 1
            ? 'duplicate_name_ambiguity'
            : q.gapCause === 'conflicting_identities'
              ? 'conflicting_provider_identity'
              : 'manual_other',
        action: 'manual_review',
        reason: 'Ambiguous or conflicting identity — fail closed',
      });
      continue;
    }

    // Class A — unique analytics exists, missing/incomplete bridge
    if (analyticsHits.length === 1) {
      const target = analyticsHits[0]!;
      const decision = decideBdlBridgeBackfill({
        nbaPlayerId: q.nbaPlayerId,
        fullName: q.fullName,
        analyticsPlayerId: target.playerId,
        resolutionMethod: aliasNorm !== norm
          ? 'high_confidence_alias_unique_analytics'
          : 'unique_normalized_name_analytics',
        existingMaps: args.existingMaps,
      });

      if (decision.action === 'insert' || decision.action === 'skip_already_present') {
        plans.push({
          ...base,
          repairClass: 'A',
          taxonomy: 'bdl_provider_mapping_missing',
          action: 'bridge_existing_player',
          targetAnalyticsPlayerId: target.playerId,
          insertNbaMap: !nbaMap,
          insertBdlBridge: decision.action === 'insert',
          reason:
            decision.action === 'insert'
              ? `Bridge NBA ${q.nbaPlayerId} → analytics/BDL ${target.playerId} (${target.fullName})`
              : `Bridge already present for ${target.playerId}`,
        });
        continue;
      }

      if (!nbaMap) {
        // decideBdlBridgeBackfill rejects without nba map; insert both safely.
        const bdlOnTarget = args.existingMaps.filter(
          (m) =>
            m.provider === 'balldontlie' && m.providerId === target.playerId
        );
        if (
          bdlOnTarget.length === 1 &&
          bdlOnTarget[0]!.internalId !== q.nbaPlayerId
        ) {
          plans.push({
            ...base,
            repairClass: 'D',
            taxonomy: 'conflicting_provider_identity',
            action: 'manual_review',
            reason: `Analytics ${target.playerId} already bridged to ${bdlOnTarget[0]!.internalId}`,
          });
          continue;
        }
        const bridgeAlreadyOk =
          bdlOnTarget.length === 1 &&
          bdlOnTarget[0]!.internalId === q.nbaPlayerId;
        plans.push({
          ...base,
          repairClass: 'A',
          taxonomy: 'nba_and_bdl_mapping_missing_analytics_exists',
          action: 'bridge_existing_player',
          targetAnalyticsPlayerId: target.playerId,
          insertNbaMap: true,
          insertBdlBridge: !bridgeAlreadyOk && bdlOnTarget.length === 0,
          reason: bridgeAlreadyOk
            ? `NBA map missing but BDL bridge already correct for ${target.playerId}`
            : `Insert nba+bdl maps for unique analytics ${target.playerId}`,
        });
        continue;
      }

      plans.push({
        ...base,
        repairClass: 'D',
        taxonomy: 'conflicting_provider_identity',
        action: 'manual_review',
        reason: `Bridge conflict: ${'detail' in decision ? decision.detail : 'reject'}`,
      });
      continue;
    }

    // Class B — unique raw, analytics missing
    if (analyticsHits.length === 0 && rawHits.length === 1) {
      const raw = rawHits[0]!;
      plans.push({
        ...base,
        repairClass: 'B',
        taxonomy: 'raw_bdl_exists_analytics_missing',
        action: 'promote_raw_player_to_analytics',
        targetAnalyticsPlayerId: raw.playerId,
        insertNbaMap: !nbaMap,
        insertBdlBridge: true,
        promoteRaw: true,
        reason: `Promote raw.players id=${raw.playerId} (${raw.fullName}) → analytics.players`,
      });
      continue;
    }

    // Class C — no local BDL/analytics identity
    if (ANALYTICS_PLAYER_ID_IS_BDL_COUPLED) {
      plans.push({
        ...base,
        repairClass: 'C',
        taxonomy: 'rookie_new_nba_absent_local',
        action: 'blocked_by_schema',
        reason:
          'No BDL/raw identity; analytics.player_id is BDL-coupled — refuse fake BDL ids / bare NBA ids',
      });
      continue;
    }

    plans.push({
      ...base,
      repairClass: 'C',
      taxonomy: 'rookie_new_nba_absent_local',
      action: 'create_canonical_from_nba',
      reason: 'Schema allows NBA-backed canonical id',
    });
  }

  return plans;
}

function uniqueById(players: LocalPlayer[]): LocalPlayer[] {
  const seen = new Set<string>();
  const out: LocalPlayer[] = [];
  for (const p of players) {
    if (seen.has(p.playerId)) continue;
    seen.add(p.playerId);
    out.push(p);
  }
  return out;
}

/** Guard: never emit fabricated numeric ids that are not from raw/analytics. */
export function assertNoFabricatedBdlIds(
  plans: RepairPlanItem[],
  knownBdlIds: Set<string>
): void {
  for (const p of plans) {
    if (
      p.targetAnalyticsPlayerId &&
      (p.insertBdlBridge || p.promoteRaw) &&
      !knownBdlIds.has(p.targetAnalyticsPlayerId)
    ) {
      throw new Error(
        `Refusing fabricated analytics/BDL id ${p.targetAnalyticsPlayerId} for ${p.fullName}`
      );
    }
    if (p.action === 'create_canonical_from_nba') {
      throw new Error(
        `create_canonical_from_nba not allowed while ANALYTICS_PLAYER_ID_IS_BDL_COUPLED (${p.fullName})`
      );
    }
  }
}

export const GAP_REPAIR_WRITES_STINTS = false as const;
