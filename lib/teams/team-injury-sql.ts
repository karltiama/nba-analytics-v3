/** Pure SQL/constants for team injury queries (no DB import). */

export const TEAM_INJURIES_BY_PLAYER_IDS_SQL = `
  SELECT
    player_id,
    team_id,
    status,
    description,
    return_date_raw,
    snapshot_at::text,
    updated_at::text
  FROM analytics.player_injury_status_current
  WHERE player_id = ANY($1::text[])
`;
