/**
 * SQL for the canonical identity ingest boundary.
 * Callers pass a query function — this module does not open a pool (tests stay DB-free).
 */

import {
  isPlayerIdentityProvider,
  type PlayerIdentityBridgeRow,
  type PlayerIdentityProjectionRow,
  type PlayerIdentityProvider,
} from './player-identity';
import {
  buildPlayerIdentityIndex,
  resolvePlayerIdentities,
  type PlayerIdentityIndex,
} from './player-identity-resolve';

export const LOAD_BRIDGES_SQL = `
  SELECT player_entity_id::text AS player_entity_id,
         provider,
         provider_player_id
  FROM analytics.player_provider_ids
  WHERE provider = $1
    AND provider_player_id = ANY($2::text[])
`;

export const LOAD_PROJECTIONS_SQL = `
  SELECT player_entity_id::text AS player_entity_id,
         player_id AS analytics_player_id
  FROM analytics.players
  WHERE player_entity_id = ANY($1::uuid[])
`;

export const LOAD_FULL_INDEX_BRIDGES_SQL = `
  SELECT player_entity_id::text AS player_entity_id,
         provider,
         provider_player_id
  FROM analytics.player_provider_ids
`;

export const LOAD_FULL_INDEX_PROJECTIONS_SQL = `
  SELECT player_entity_id::text AS player_entity_id,
         player_id AS analytics_player_id
  FROM analytics.players
  WHERE player_entity_id IS NOT NULL
`;

export const UPSERT_QUARANTINE_SQL = `
  INSERT INTO analytics.player_identity_unresolved (
    provider, provider_player_id, source_context, status,
    first_seen_at, last_seen_at, occurrence_count,
    sample_game_id, sample_team_id
  ) VALUES (
    $1, $2, $3, $4, $5::timestamptz, $5::timestamptz, 1, $6, $7
  )
  ON CONFLICT (provider, provider_player_id, source_context)
  DO UPDATE SET
    last_seen_at = excluded.last_seen_at,
    occurrence_count = analytics.player_identity_unresolved.occurrence_count + 1,
    sample_game_id = coalesce(excluded.sample_game_id, analytics.player_identity_unresolved.sample_game_id),
    sample_team_id = coalesce(excluded.sample_team_id, analytics.player_identity_unresolved.sample_team_id),
    status = CASE
      WHEN analytics.player_identity_unresolved.status = 'RESOLVED' THEN 'RESOLVED'
      WHEN excluded.status = 'CONFLICT'
        OR analytics.player_identity_unresolved.status = 'CONFLICT' THEN 'CONFLICT'
      ELSE analytics.player_identity_unresolved.status
    END,
    updated_at = now()
`;

export const MARK_QUARANTINE_RESOLVED_SQL = `
  UPDATE analytics.player_identity_unresolved
  SET status = 'RESOLVED',
      resolved_player_entity_id = $4::uuid,
      last_seen_at = $5::timestamptz,
      updated_at = now()
  WHERE provider = $1
    AND provider_player_id = $2
    AND source_context = $3
`;

export const QUARANTINE_REPORT_SQL = `
  SELECT
    provider,
    source_context,
    status,
    count(*)::int AS n,
    max(last_seen_at)::text AS last_seen_at
  FROM analytics.player_identity_unresolved
  GROUP BY 1, 2, 3
  ORDER BY 1, 2, 3
`;

export type SqlQuery = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<{ rows: T[] }>;

export function parseBridgeRows(
  rows: Array<{
    player_entity_id: string;
    provider: string;
    provider_player_id: string;
  }>
): PlayerIdentityBridgeRow[] {
  const out: PlayerIdentityBridgeRow[] = [];
  for (const r of rows) {
    if (!isPlayerIdentityProvider(r.provider)) continue;
    out.push({
      playerEntityId: r.player_entity_id,
      provider: r.provider,
      providerPlayerId: r.provider_player_id,
    });
  }
  return out;
}

export async function loadPlayerIdentityIndex(
  query: SqlQuery
): Promise<PlayerIdentityIndex> {
  const bridges = await query<{
    player_entity_id: string;
    provider: string;
    provider_player_id: string;
  }>(LOAD_FULL_INDEX_BRIDGES_SQL);
  const projections = await query<{
    player_entity_id: string;
    analytics_player_id: string;
  }>(LOAD_FULL_INDEX_PROJECTIONS_SQL);
  return buildPlayerIdentityIndex({
    bridges: parseBridgeRows(bridges.rows),
    projections: projections.rows.map((p) => ({
      playerEntityId: p.player_entity_id,
      analyticsPlayerId: p.analytics_player_id,
    })),
  });
}

export async function resolvePlayerIdentitiesFromDb(
  query: SqlQuery,
  provider: PlayerIdentityProvider,
  providerPlayerIds: string[]
) {
  const ids = [...new Set(providerPlayerIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const bridges = await query<{
    player_entity_id: string;
    provider: string;
    provider_player_id: string;
  }>(LOAD_BRIDGES_SQL, [provider, ids]);
  const parsed = parseBridgeRows(bridges.rows);
  const entityIds = [...new Set(parsed.map((b) => b.playerEntityId))];
  let projections: PlayerIdentityProjectionRow[] = [];
  if (entityIds.length > 0) {
    const proj = await query<{
      player_entity_id: string;
      analytics_player_id: string;
    }>(LOAD_PROJECTIONS_SQL, [entityIds]);
    projections = proj.rows.map((p) => ({
      playerEntityId: p.player_entity_id,
      analyticsPlayerId: p.analytics_player_id,
    }));
  }
  const index = buildPlayerIdentityIndex({ bridges: parsed, projections });
  return resolvePlayerIdentities(provider, ids, index);
}
