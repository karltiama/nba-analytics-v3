/**
 * CLI report for analytics.player_identity_unresolved.
 * Read-only. Does not call BDL. Does not write quarantine rows.
 *
 *   npx tsx scripts/ops/2026-player-identity-quarantine-report.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL?.trim();
if (!connectionString) {
  throw new Error('Missing SUPABASE_DB_URL');
}

async function main() {
  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes('supabase.co') ||
      connectionString.includes('pooler.supabase.com')
        ? { rejectUnauthorized: false }
        : undefined,
    max: 1,
  });
  try {
    const byStatus = await pool.query<{
      provider: string;
      source_context: string;
      status: string;
      n: number;
      last_seen_at: string | null;
    }>(
      `SELECT provider, source_context, status, count(*)::int AS n,
              max(last_seen_at)::text AS last_seen_at
       FROM analytics.player_identity_unresolved
       GROUP BY 1, 2, 3
       ORDER BY 1, 2, 3`
    );
    const recentFirst = await pool.query<{
      provider: string;
      provider_player_id: string;
      source_context: string;
      status: string;
      first_seen_at: string;
    }>(
      `SELECT provider, provider_player_id, source_context, status, first_seen_at::text
       FROM analytics.player_identity_unresolved
       ORDER BY first_seen_at DESC
       LIMIT 20`
    );
    const recentResolved = await pool.query<{
      provider: string;
      provider_player_id: string;
      source_context: string;
      resolved_player_entity_id: string | null;
      last_seen_at: string;
    }>(
      `SELECT provider, provider_player_id, source_context,
              resolved_player_entity_id::text, last_seen_at::text
       FROM analytics.player_identity_unresolved
       WHERE status = 'RESOLVED'
       ORDER BY last_seen_at DESC
       LIMIT 20`
    );
    const classC = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM analytics.player_entities e
       WHERE EXISTS (
         SELECT 1 FROM analytics.player_provider_ids n
         WHERE n.player_entity_id = e.player_entity_id AND n.provider = 'nba'
       )
       AND NOT EXISTS (
         SELECT 1 FROM analytics.player_provider_ids b
         WHERE b.player_entity_id = e.player_entity_id AND b.provider = 'balldontlie'
       )`
    );
    const totals = {
      unresolved: byStatus.rows
        .filter((r) => r.status === 'UNRESOLVED')
        .reduce((a, r) => a + r.n, 0),
      conflict: byStatus.rows
        .filter((r) => r.status === 'CONFLICT')
        .reduce((a, r) => a + r.n, 0),
      resolved: byStatus.rows
        .filter((r) => r.status === 'RESOLVED')
        .reduce((a, r) => a + r.n, 0),
    };
    const report = {
      generatedAt: new Date().toISOString(),
      printsSecrets: false,
      classCNbaOnlyEntities: classC.rows[0]?.n ?? 0,
      totals,
      byProviderSourceStatus: byStatus.rows,
      recentlyFirstSeen: recentFirst.rows,
      recentlyResolved: recentResolved.rows,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

void main();
