/**
 * Write-time gate for props serving tables.
 * Columns verified on analytics.games: game_id text, start_time timestamptz, status text.
 * The same two columns are what props discovery already reads.
 * Eligibility uses clock_timestamp() inside the write statement, so a fetch that
 * started before tip and finishes after tip cannot promote current markets.
 * A missing row, a null tip, a live status, or a final status is not eligible.
 */

export function pregamePropsMarketEligibleSql(alias = 'g'): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`invalid games alias ${alias}`);
  }
  const status = `lower(regexp_replace(btrim(coalesce(${alias}.status, '')), '[[:space:]]+', ' ', 'g'))`;
  return `${alias}.start_time IS NOT NULL
    AND ${alias}.start_time > clock_timestamp()
    AND CASE
      WHEN ${status} = 'final' THEN false
      WHEN ${status} IN ('inprogress', 'in progress', 'live', 'halftime', 'in_progress') THEN false
      WHEN ${status} ~ '^(end of )?(1st|2nd|3rd|4th) qtr($|[^a-z0-9])' THEN false
      WHEN ${status} ~ '^q[1-4]($|[^a-z0-9])' THEN false
      WHEN ${status} ~ '^end of (1st|2nd|3rd|4th|q[1-4])($|[^a-z0-9])' THEN false
      WHEN ${status} ~ '^(end of )?[0-9]?ot[0-9]?($|[^a-z0-9])' THEN false
      WHEN ${status} = 'overtime' THEN false
      WHEN ${status} = 'postponed' THEN false
      WHEN ${status} IN ('cancelled', 'canceled') THEN false
      WHEN ${status} = 'scheduled' THEN true
      WHEN btrim(${alias}.status) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN true
      WHEN btrim(${alias}.status) ~* '[0-9]{1,2}:[0-9]{2}[[:space:]]*(am|pm)' THEN true
      WHEN btrim(${alias}.status) ~* '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?([.][0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})?$' THEN true
      ELSE false
    END`;
}
