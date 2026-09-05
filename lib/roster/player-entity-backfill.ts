/**
 * Phase 2.T.2D.1cB — Deterministic backfill planner for player_entities.
 *
 * One entity per analytics.players (BDL) row. Attach balldontlie provider id.
 * Attach nba provider id only when uniquely/safely evidenced via provider_id_map.
 * Never merge multi-BDL conflicts. Never create NBA-only entities.
 */

import { createHash } from 'node:crypto';
import {
  PIPPEN_BDL_ID,
  PIPPEN_NBA_ID,
  WILSON_BDL_ID,
  WILSON_NBA_ID,
} from './identity-integrity';

export const ENTITY_BACKFILL_SOURCE = 'phase2_t2d_1cb_entity_backfill';
export const ENTITY_BACKFILL_WRITES_STINTS = false as const;

/** Fixed namespace for deterministic entity UUIDs from BDL analytics player ids. */
export const PLAYER_ENTITY_NAMESPACE =
  'a7c3e9f1-2b4d-4e6a-8c0d-1f3a5b7c9d0e';

export type AnalyticsPlayerRow = {
  playerId: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  playerEntityId: string | null;
};

export type LegacyProviderMapRow = {
  provider: 'nba' | 'balldontlie';
  providerId: string;
  internalId: string;
};

export type ExistingEntityProviderRow = {
  playerEntityId: string;
  provider: string;
  providerPlayerId: string;
};

export type NbaAttachDecision =
  | { kind: 'attach'; nbaPlayerId: string }
  | { kind: 'skip_none' }
  | { kind: 'conflict'; nbaPlayerIds: string[]; reason: string };

export type EntityBackfillItem = {
  analyticsPlayerId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  /** Deterministic UUID derived from BDL id (or reused existing). */
  playerEntityId: string;
  reuseExistingEntity: boolean;
  createEntity: boolean;
  createBdlMapping: boolean;
  createNbaMapping: boolean;
  nbaPlayerId: string | null;
  nbaDecision: NbaAttachDecision['kind'];
  nbaConflictReason: string | null;
};

export type EntityBackfillConflict = {
  kind:
    | 'multi_bdl_same_nba_internal'
    | 'nba_maps_to_multiple_bdl'
    | 'nba_already_bound_other_entity'
    | 'bdl_already_bound_other_entity';
  analyticsPlayerId?: string;
  nbaPlayerId?: string;
  bdlPlayerIds?: string[];
  detail: string;
};

export type EntityBackfillPlan = {
  items: EntityBackfillItem[];
  conflicts: EntityBackfillConflict[];
  stats: {
    analyticsPlayersScanned: number;
    entitiesProposed: number;
    entitiesReused: number;
    bdlMappingsProposed: number;
    nbaMappingsProposed: number;
    noSafeNbaMapping: number;
    nbaConflicts: number;
  };
};

/**
 * RFC 4122 UUID v5 from namespace UUID + name (deterministic).
 */
export function uuidV5(namespaceUuid: string, name: string): string {
  const ns = uuidToBytes(namespaceUuid);
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant
  return bytesToUuid(bytes);
}

export function entityIdForBdlPlayer(bdlPlayerId: string): string {
  return uuidV5(PLAYER_ENTITY_NAMESPACE, `bdl:${bdlPlayerId}`);
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`Invalid UUID: ${uuid}`);
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * For one BDL analytics id, find a unique safe NBA id from legacy provider_id_map.
 *
 * Safe path: exactly one balldontlie row with provider_id=BDL, then that internal_id
 * must have exactly one nba row with provider_id=internal_id, and that NBA id must
 * not bridge to any other BDL provider_id.
 */
export function decideNbaAttach(args: {
  bdlPlayerId: string;
  legacyMaps: LegacyProviderMapRow[];
}): NbaAttachDecision {
  const bdlRows = args.legacyMaps.filter(
    (m) => m.provider === 'balldontlie' && m.providerId === args.bdlPlayerId
  );
  if (bdlRows.length === 0) return { kind: 'skip_none' };
  if (bdlRows.length > 1) {
    return {
      kind: 'conflict',
      nbaPlayerIds: [],
      reason: `Multiple balldontlie rows for provider_id=${args.bdlPlayerId}`,
    };
  }

  const internalId = bdlRows[0]!.internalId;
  const siblings = args.legacyMaps.filter(
    (m) => m.provider === 'balldontlie' && m.internalId === internalId
  );
  if (siblings.length > 1) {
    const ids = siblings.map((s) => s.providerId).sort();
    return {
      kind: 'conflict',
      nbaPlayerIds: [internalId],
      reason: `internal_id=${internalId} has multiple BDL ids: ${ids.join(',')}`,
    };
  }

  const nbaRows = args.legacyMaps.filter(
    (m) => m.provider === 'nba' && m.providerId === internalId
  );
  // Also accept nba rows where internal_id matches and provider_id is the nba id
  // (standard shape: provider_id === internal_id === nba id)
  const nbaByInternal = args.legacyMaps.filter(
    (m) => m.provider === 'nba' && m.internalId === internalId
  );
  const nbaCandidates = [
    ...new Set([
      ...nbaRows.map((r) => r.providerId),
      ...nbaByInternal.map((r) => r.providerId),
    ]),
  ].sort();

  if (nbaCandidates.length === 0) return { kind: 'skip_none' };
  if (nbaCandidates.length > 1) {
    return {
      kind: 'conflict',
      nbaPlayerIds: nbaCandidates,
      reason: `Multiple NBA provider ids for internal_id=${internalId}`,
    };
  }

  return { kind: 'attach', nbaPlayerId: nbaCandidates[0]! };
}

export function planPlayerEntityBackfill(args: {
  analyticsPlayers: AnalyticsPlayerRow[];
  legacyMaps: LegacyProviderMapRow[];
  existingProviderRows: ExistingEntityProviderRow[];
}): EntityBackfillPlan {
  const existingBdlToEntity = new Map<string, string>();
  const existingNbaToEntity = new Map<string, string>();

  for (const row of args.existingProviderRows) {
    if (row.provider === 'balldontlie') {
      existingBdlToEntity.set(row.providerPlayerId, row.playerEntityId);
    }
    if (row.provider === 'nba') {
      existingNbaToEntity.set(row.providerPlayerId, row.playerEntityId);
    }
  }

  // Precompute multi-BDL internals for conflict reporting
  const bdlByInternal = new Map<string, string[]>();
  for (const m of args.legacyMaps) {
    if (m.provider !== 'balldontlie') continue;
    const list = bdlByInternal.get(m.internalId) ?? [];
    list.push(m.providerId);
    bdlByInternal.set(m.internalId, list);
  }
  const conflicts: EntityBackfillConflict[] = [];
  for (const [internalId, bdlIds] of bdlByInternal) {
    const uniq = [...new Set(bdlIds)].sort();
    if (uniq.length > 1) {
      conflicts.push({
        kind: 'multi_bdl_same_nba_internal',
        nbaPlayerId: internalId,
        bdlPlayerIds: uniq,
        detail: `Legacy provider_id_map internal_id=${internalId} maps to multiple BDL ids; will not merge entities`,
      });
    }
  }

  const items: EntityBackfillItem[] = [];
  let entitiesReused = 0;
  let bdlMappingsProposed = 0;
  let nbaMappingsProposed = 0;
  let noSafeNbaMapping = 0;
  let nbaConflicts = 0;

  // Stable order for determinism
  const players = [...args.analyticsPlayers].sort((a, b) =>
    a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
  );

  for (const p of players) {
    const existingEntity =
      p.playerEntityId ?? existingBdlToEntity.get(p.playerId) ?? null;
    const playerEntityId = existingEntity ?? entityIdForBdlPlayer(p.playerId);
    const reuseExistingEntity = existingEntity != null;
    if (reuseExistingEntity) entitiesReused += 1;

    // If BDL already bound to a different entity than deterministic/existing, conflict
    const bound = existingBdlToEntity.get(p.playerId);
    if (bound && bound !== playerEntityId) {
      conflicts.push({
        kind: 'bdl_already_bound_other_entity',
        analyticsPlayerId: p.playerId,
        detail: `BDL ${p.playerId} already bound to entity ${bound}, expected ${playerEntityId}`,
      });
      continue;
    }

    const createEntity = !reuseExistingEntity;
    const createBdlMapping = !existingBdlToEntity.has(p.playerId);
    if (createBdlMapping) bdlMappingsProposed += 1;

    const nbaDecision = decideNbaAttach({
      bdlPlayerId: p.playerId,
      legacyMaps: args.legacyMaps,
    });

    let createNbaMapping = false;
    let nbaPlayerId: string | null = null;
    let nbaConflictReason: string | null = null;

    if (nbaDecision.kind === 'attach') {
      nbaPlayerId = nbaDecision.nbaPlayerId;
      const nbaBound = existingNbaToEntity.get(nbaPlayerId);
      if (nbaBound && nbaBound !== playerEntityId) {
        conflicts.push({
          kind: 'nba_already_bound_other_entity',
          analyticsPlayerId: p.playerId,
          nbaPlayerId,
          detail: `NBA ${nbaPlayerId} already bound to entity ${nbaBound}`,
        });
        nbaConflicts += 1;
        nbaConflictReason = conflicts[conflicts.length - 1]!.detail;
        nbaPlayerId = null;
      } else if (!nbaBound) {
        createNbaMapping = true;
        nbaMappingsProposed += 1;
      }
    } else if (nbaDecision.kind === 'conflict') {
      nbaConflicts += 1;
      nbaConflictReason = nbaDecision.reason;
      conflicts.push({
        kind: 'nba_maps_to_multiple_bdl',
        analyticsPlayerId: p.playerId,
        nbaPlayerId: nbaDecision.nbaPlayerIds[0],
        detail: nbaDecision.reason,
      });
    } else {
      noSafeNbaMapping += 1;
    }

    items.push({
      analyticsPlayerId: p.playerId,
      displayName: p.fullName,
      firstName: p.firstName,
      lastName: p.lastName,
      position: p.position,
      playerEntityId,
      reuseExistingEntity,
      createEntity,
      createBdlMapping,
      createNbaMapping,
      nbaPlayerId,
      nbaDecision: nbaDecision.kind,
      nbaConflictReason,
    });
  }

  return {
    items,
    conflicts: dedupeConflicts(conflicts),
    stats: {
      analyticsPlayersScanned: players.length,
      entitiesProposed: items.filter((i) => i.createEntity).length,
      entitiesReused,
      bdlMappingsProposed,
      nbaMappingsProposed,
      noSafeNbaMapping,
      nbaConflicts,
    },
  };
}

function dedupeConflicts(
  conflicts: EntityBackfillConflict[]
): EntityBackfillConflict[] {
  const seen = new Set<string>();
  const out: EntityBackfillConflict[] = [];
  for (const c of conflicts) {
    const key = `${c.kind}|${c.nbaPlayerId ?? ''}|${(c.bdlPlayerIds ?? []).join(',')}|${c.analyticsPlayerId ?? ''}|${c.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function assertWilsonPippenDistinct(items: EntityBackfillItem[]): {
  wilson: EntityBackfillItem | undefined;
  pippen: EntityBackfillItem | undefined;
  ok: boolean;
  detail: string;
} {
  const wilson = items.find((i) => i.analyticsPlayerId === WILSON_BDL_ID);
  const pippen = items.find((i) => i.analyticsPlayerId === PIPPEN_BDL_ID);
  if (!wilson || !pippen) {
    return {
      wilson,
      pippen,
      ok: false,
      detail: 'Wilson and/or Pippen missing from backfill plan',
    };
  }
  if (wilson.playerEntityId === pippen.playerEntityId) {
    return {
      wilson,
      pippen,
      ok: false,
      detail: 'Wilson and Pippen share player_entity_id',
    };
  }
  if (wilson.nbaPlayerId && wilson.nbaPlayerId !== WILSON_NBA_ID) {
    return {
      wilson,
      pippen,
      ok: false,
      detail: `Wilson NBA id mismatch: ${wilson.nbaPlayerId}`,
    };
  }
  if (pippen.nbaPlayerId && pippen.nbaPlayerId !== PIPPEN_NBA_ID) {
    return {
      wilson,
      pippen,
      ok: false,
      detail: `Pippen NBA id mismatch: ${pippen.nbaPlayerId}`,
    };
  }
  return {
    wilson,
    pippen,
    ok: true,
    detail: 'Wilson and Pippen map to distinct entities',
  };
}

export function provenanceMetadata(extra?: Record<string, unknown>) {
  return {
    source: ENTITY_BACKFILL_SOURCE,
    ...extra,
  };
}
