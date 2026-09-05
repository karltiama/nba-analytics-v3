/**
 * Classify 2026-27 manual review queue into repair classes A/B/C/D.
 * Read-only.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { normalizePersonName } from '../../lib/roster/normalize-player-name';

const OUT = path.join(process.cwd(), 'reports', 'roster');
const queue = JSON.parse(
  fs.readFileSync(path.join(OUT, '2026-27-manual-review-queue.json'), 'utf8')
).rows as Array<{
  nba_player_id: string;
  name: string;
  team: string;
  jersey: string | null;
  position: string | null;
  status: string;
  gap_cause: string | null;
}>;

const fetch = JSON.parse(
  fs.readFileSync(path.join(OUT, '2026-27-nba-fetch.json'), 'utf8')
).players as Array<{
  nba_player_id: string;
  how_acquired?: string | null;
  supplemental_status?: string | null;
  experience?: string | number | null;
  school?: string | null;
  raw?: Record<string, unknown>;
}>;

async function main() {
  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const byNba = new Map(fetch.map((p) => [String(p.nba_player_id), p]));

  const maps = await pool.query<{
    provider: string;
    provider_id: string;
    internal_id: string;
  }>(
    `SELECT provider, provider_id, internal_id
     FROM provider_id_map
     WHERE entity_type = 'player' AND provider IN ('nba', 'balldontlie')`
  );
  const analytics = await pool.query<{
    player_id: string;
    full_name: string;
    position: string | null;
  }>(`SELECT player_id, full_name, position FROM analytics.players`);
  const raw = await pool.query<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
  }>(
    `SELECT id::text AS id, first_name, last_name, position FROM raw.players`
  );
  const publicHits = await pool.query<{ player_id: string; full_name: string }>(
    `SELECT player_id, full_name FROM players WHERE player_id = ANY($1::text[])`,
    [queue.map((q) => q.nba_player_id)]
  );

  const nbaMap = new Map<string, { provider_id: string; internal_id: string }>();
  const bdlByInternal = new Map<string, Array<{ provider_id: string; internal_id: string }>>();
  for (const m of maps.rows) {
    if (m.provider === 'nba') nbaMap.set(m.provider_id, m);
    else {
      const list = bdlByInternal.get(m.internal_id) ?? [];
      list.push(m);
      bdlByInternal.set(m.internal_id, list);
    }
  }
  const analyticsById = new Map(analytics.rows.map((r) => [r.player_id, r]));
  const analyticsByName = new Map<string, typeof analytics.rows>();
  for (const r of analytics.rows) {
    const k = normalizePersonName(r.full_name);
    if (!k) continue;
    const list = analyticsByName.get(k) ?? [];
    list.push(r);
    analyticsByName.set(k, list);
  }
  const rawByName = new Map<
    string,
    Array<{ id: string; full_name: string; position: string | null }>
  >();
  for (const r of raw.rows) {
    const full = [r.first_name, r.last_name].filter(Boolean).join(' ');
    const k = normalizePersonName(full);
    if (!k) continue;
    const list = rawByName.get(k) ?? [];
    list.push({ id: r.id, full_name: full, position: r.position });
    rawByName.set(k, list);
  }

  type Row = Record<string, unknown>;
  const classes: Record<'A' | 'B' | 'C' | 'D', Row[]> = {
    A: [],
    B: [],
    C: [],
    D: [],
  };
  const detail: Row[] = [];

  for (const q of queue) {
    const nbaId = q.nba_player_id;
    const key = normalizePersonName(q.name);
    const nbaRow = nbaMap.get(nbaId);
    const bdlList = nbaRow ? bdlByInternal.get(nbaRow.internal_id) ?? [] : [];
    const nameAnalytics = key ? analyticsByName.get(key) ?? [] : [];
    const nameRaw = key ? rawByName.get(key) ?? [] : [];
    const analyticsExists =
      nameAnalytics.length > 0 ||
      bdlList.some((b) => analyticsById.has(b.provider_id));
    const rawExists = nameRaw.length > 0;
    const nbaMapExists = !!nbaRow;
    const bdlMapExists = bdlList.length > 0;
    const uniqueRaw = nameRaw.length === 1;
    const uniqueAnalytics = nameAnalytics.length === 1;
    const publicHit = publicHits.rows.find((p) => p.player_id === nbaId);

    let cls: 'A' | 'B' | 'C' | 'D' = 'C';
    let taxonomy = 'rookie_new_nba_absent_local';
    let proposed:
      | 'bridge_existing_player'
      | 'promote_raw_player_to_analytics'
      | 'create_canonical_from_nba'
      | 'manual_review'
      | 'blocked_by_schema' = 'blocked_by_schema';

    if (
      q.status === 'ambiguous' ||
      q.gap_cause === 'conflicting_identities' ||
      q.gap_cause === 'duplicate_name_ambiguity'
    ) {
      cls = 'D';
      taxonomy =
        q.gap_cause === 'duplicate_name_ambiguity'
          ? 'duplicate_name_ambiguity'
          : 'conflicting_provider_identity';
      proposed = 'manual_review';
    } else if (uniqueAnalytics && !bdlMapExists) {
      cls = 'A';
      taxonomy = nbaMapExists
        ? 'bdl_provider_mapping_missing'
        : 'nba_and_bdl_mapping_missing_analytics_exists';
      proposed = 'bridge_existing_player';
    } else if (uniqueAnalytics && bdlMapExists) {
      // Analytics exists and some bridge exists but still unresolved — odd; manual
      cls = 'D';
      taxonomy = 'other';
      proposed = 'manual_review';
    } else if (!analyticsExists && uniqueRaw) {
      cls = 'B';
      taxonomy = 'raw_bdl_exists_analytics_missing';
      proposed = 'promote_raw_player_to_analytics';
    } else if (!analyticsExists && nameRaw.length > 1) {
      cls = 'D';
      taxonomy = 'duplicate_name_ambiguity';
      proposed = 'manual_review';
    } else if (!analyticsExists && !rawExists) {
      cls = 'C';
      taxonomy = publicHit
        ? 'public_nba_player_exists_no_analytics_bdl'
        : 'rookie_new_nba_absent_local';
      // Cannot invent BDL id — blocked unless we redesign IDs
      proposed = 'blocked_by_schema';
    } else if (analyticsExists && nameAnalytics.length > 1) {
      cls = 'D';
      taxonomy = 'duplicate_name_ambiguity';
      proposed = 'manual_review';
    } else {
      cls = 'D';
      taxonomy = 'other';
      proposed = 'manual_review';
    }

    const fp = byNba.get(nbaId);
    const row: Row = {
      nba_player_id: nbaId,
      name: q.name,
      team: q.team,
      jersey: q.jersey,
      position: q.position,
      status: q.status,
      gap_cause: q.gap_cause,
      class: cls,
      taxonomy,
      how_acquired:
        fp?.how_acquired ??
        (fp?.raw?.HOW_ACQUIRED as string | undefined) ??
        null,
      supplemental_status:
        fp?.supplemental_status ??
        (fp?.raw?.SUPPLEMENTAL_STATUS as string | undefined) ??
        null,
      experience: fp?.experience ?? null,
      school: fp?.school ?? null,
      raw_bdl_exists: rawExists,
      raw_bdl_ids: nameRaw.map((r) => r.id),
      analytics_exists: analyticsExists,
      analytics_ids: nameAnalytics.map((r) => r.player_id),
      nba_provider_map_exists: nbaMapExists,
      bdl_provider_map_exists: bdlMapExists,
      bdl_provider_ids: bdlList.map((b) => b.provider_id),
      public_players_row_exists: !!publicHit,
      proposed_action: proposed,
    };
    classes[cls].push(row);
    detail.push(row);
  }

  const taxonomy_counts: Record<string, number> = {};
  for (const d of detail) {
    const t = String(d.taxonomy);
    taxonomy_counts[t] = (taxonomy_counts[t] ?? 0) + 1;
  }

  const idCoupling = await pool.query<{
    analytics_players: string;
    raw_players: string;
    analytics_eq_bdl_map: string;
    analytics_eq_nba_id: string;
  }>(
    `
    SELECT
      (SELECT count(*)::text FROM analytics.players) AS analytics_players,
      (SELECT count(*)::text FROM raw.players) AS raw_players,
      (SELECT count(*)::text FROM analytics.players ap
        JOIN provider_id_map m
          ON m.entity_type='player' AND m.provider='balldontlie'
         AND m.provider_id = ap.player_id) AS analytics_eq_bdl_map,
      (SELECT count(*)::text FROM analytics.players ap
        WHERE EXISTS (
          SELECT 1 FROM provider_id_map m
          WHERE m.entity_type='player' AND m.provider='nba'
            AND m.provider_id = ap.player_id
        )) AS analytics_eq_nba_id
    `
  );

  const summary = {
    total: queue.length,
    class_counts: {
      A: classes.A.length,
      B: classes.B.length,
      C: classes.C.length,
      D: classes.D.length,
    },
    taxonomy_counts,
    examples: {
      A: classes.A.slice(0, 5),
      B: classes.B.slice(0, 5),
      C: classes.C.slice(0, 5),
      D: classes.D.slice(0, 5),
    },
    public_players_hits: publicHits.rows.length,
    canonical_id_assumption: {
      conclusion:
        'analytics.players.player_id is structurally BDL-coupled (copied from raw.players.id). Do not invent fake BDL IDs or use bare NBA IDs as analytics.player_id for rookies.',
      stats: idCoupling.rows[0],
      smallest_architecture_fix_if_needed:
        'Introduce provider-agnostic canonical player_id (or namespaced nba:{id}) + dual provider maps; or wait for BDL localization before roster seed for Class C.',
    },
  };

  fs.writeFileSync(
    path.join(OUT, '2026-27-gap-classification.json'),
    JSON.stringify({ summary, rows: detail }, null, 2)
  );
  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
