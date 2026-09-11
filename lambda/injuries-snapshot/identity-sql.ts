/** Keep in sync with lib/identity/player-identity-store.ts */

export const IDENTITY_BRIDGES_SQL = `
  SELECT player_entity_id::text AS player_entity_id,
         provider,
         provider_player_id
  FROM analytics.player_provider_ids
  WHERE provider = $1
    AND provider_player_id = ANY($2::text[])
`;

export const IDENTITY_PROJECTIONS_SQL = `
  SELECT player_entity_id::text AS player_entity_id,
         player_id AS analytics_player_id
  FROM analytics.players
  WHERE player_entity_id = ANY($1::uuid[])
`;

export const IDENTITY_QUARANTINE_SQL = `
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
