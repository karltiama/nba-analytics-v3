/**
 * SQL-row classifier for Lambda adapters that cannot import lib/.
 * Equivalent serving/quarantine split to gateIngestIdentities for one provider.
 */

export type SqlBridgeRow = {
  provider_player_id: string;
  player_entity_id: string;
};

export type SqlProjectionRow = {
  player_entity_id: string;
  analytics_player_id: string;
};

export type SqlIdentityClassification = {
  servingIds: Set<string>;
  quarantine: Array<{
    providerPlayerId: string;
    status: 'UNRESOLVED' | 'CONFLICT';
  }>;
};

export function classifyFromSqlRows(
  requestedIds: string[],
  bridges: SqlBridgeRow[],
  projections: SqlProjectionRow[]
): SqlIdentityClassification {
  const unique = [...new Set(requestedIds.map((id) => id.trim()).filter(Boolean))];
  const entitiesByPid = new Map<string, string[]>();
  for (const row of bridges) {
    const pid = row.provider_player_id.trim();
    const list = entitiesByPid.get(pid) ?? [];
    if (!list.includes(row.player_entity_id)) list.push(row.player_entity_id);
    entitiesByPid.set(pid, list);
  }
  const analyticsByEntity = new Map(
    projections.map((p) => [p.player_entity_id, p.analytics_player_id])
  );
  const servingIds = new Set<string>();
  const quarantine: SqlIdentityClassification['quarantine'] = [];
  for (const id of unique) {
    const ents = entitiesByPid.get(id) ?? [];
    if (ents.length > 1) {
      quarantine.push({ providerPlayerId: id, status: 'CONFLICT' });
      continue;
    }
    if (ents.length === 0) {
      quarantine.push({ providerPlayerId: id, status: 'UNRESOLVED' });
      continue;
    }
    const analyticsId = analyticsByEntity.get(ents[0]!);
    if (analyticsId) servingIds.add(id);
    else quarantine.push({ providerPlayerId: id, status: 'UNRESOLVED' });
  }
  return { servingIds, quarantine };
}
