import type { Pool } from 'pg';
import { classifyFromSqlRows } from './classify-sql-rows';
import {
  IDENTITY_BRIDGES_SQL,
  IDENTITY_PROJECTIONS_SQL,
  IDENTITY_QUARANTINE_SQL,
} from './identity-sql';

export function filterRowsByServingProviderId<T>(
  rows: T[],
  getId: (row: T) => string | number,
  servingIds: Set<string>
): { keep: T[]; skipped: T[] } {
  const keep: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) {
    if (servingIds.has(String(getId(row)))) keep.push(row);
    else skipped.push(row);
  }
  return { keep, skipped };
}

export async function classifyBdlPropPlayerIds(
  pool: Pool,
  providerPlayerIds: string[],
  sampleGameId: string | null
): Promise<{ servingIds: Set<string>; quarantined: number; resolverQueries: number }> {
  const unique = [...new Set(providerPlayerIds.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { servingIds: new Set(), quarantined: 0, resolverQueries: 0 };
  }
  const bridges = await pool.query<{ provider_player_id: string; player_entity_id: string }>(
    IDENTITY_BRIDGES_SQL,
    ['balldontlie', unique]
  );
  const entityIds = [...new Set(bridges.rows.map((row) => row.player_entity_id))];
  const projections = entityIds.length
    ? await pool.query<{ player_entity_id: string; analytics_player_id: string }>(
        IDENTITY_PROJECTIONS_SQL,
        [entityIds]
      )
    : { rows: [] as Array<{ player_entity_id: string; analytics_player_id: string }> };
  const identity = classifyFromSqlRows(unique, bridges.rows, projections.rows);
  const observedAt = new Date().toISOString();
  for (const row of identity.quarantine) {
    await pool.query(IDENTITY_QUARANTINE_SQL, [
      'balldontlie',
      row.providerPlayerId,
      'PLAYER_PROP',
      row.status,
      observedAt,
      sampleGameId,
      null,
    ]);
  }
  return {
    servingIds: identity.servingIds,
    quarantined: identity.quarantine.length,
    resolverQueries: entityIds.length ? 2 : 1,
  };
}
