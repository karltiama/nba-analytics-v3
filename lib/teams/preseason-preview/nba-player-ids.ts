/**
 * Resolve NBA.com player ids for headshots / CDN links.
 * Analytics `player_id` is BDL — never use it as nbaPlayerId.
 */

import { query } from '@/lib/db';

export async function loadNbaPlayerIdsByEntityIds(
  entityIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(entityIds.filter(Boolean))];
  if (unique.length === 0) return map;

  const rows = await query<{
    player_entity_id: string;
    provider_player_id: string;
  }>(
    `SELECT player_entity_id::text AS player_entity_id,
            provider_player_id::text AS provider_player_id
     FROM analytics.player_provider_ids
     WHERE provider = 'nba'
       AND player_entity_id = ANY($1::uuid[])
       AND provider_player_id IS NOT NULL
       AND trim(provider_player_id::text) <> ''`,
    [unique]
  );

  for (const r of rows) {
    map.set(String(r.player_entity_id), String(r.provider_player_id));
  }
  return map;
}

/** Collect every player_entity_id that can appear on a draft headshot. */
export function collectResearchEntityIds(research: {
  roster: {
    additions: Array<{ playerEntityId: string }>;
    departures: Array<{ playerEntityId: string }>;
  };
  playersToWatchCandidates: Array<{ playerEntityId: string }>;
  roleUsageShiftCandidates: Array<{ playerEntityId: string }>;
}): string[] {
  const ids: string[] = [];
  for (const p of research.roster.additions) ids.push(p.playerEntityId);
  for (const p of research.roster.departures) ids.push(p.playerEntityId);
  for (const p of research.playersToWatchCandidates) ids.push(p.playerEntityId);
  for (const p of research.roleUsageShiftCandidates) ids.push(p.playerEntityId);
  return ids;
}
