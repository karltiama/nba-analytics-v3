/**
 * Identity integrity gate — repair Wilson/Pippen BDL bridge collision.
 *
 * Usage:
 *   npx tsx scripts/roster/repair-wilson-pippen-identity.ts --dry-run
 *   npx tsx scripts/roster/repair-wilson-pippen-identity.ts --apply
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import {
  planWilsonPippenBridgeRepair,
  PIPPEN_BDL_ID,
  PIPPEN_NBA_ID,
  WILSON_BDL_ID,
  WILSON_NBA_ID,
  type BridgeRow,
} from '../../lib/roster/identity-integrity';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DRY = args.has('--dry-run') || !APPLY;

async function main() {
  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });
  const client = await pool.connect();

  try {
    const rows = await client.query<{
      provider: string;
      provider_id: string;
      internal_id: string;
    }>(
      `
      SELECT provider, provider_id, internal_id
      FROM provider_id_map
      WHERE entity_type = 'player'
        AND provider IN ('nba', 'balldontlie')
        AND (
          provider_id IN ($1,$2,$3,$4)
          OR internal_id IN ($1,$2,$3,$4)
        )
      `,
      [WILSON_NBA_ID, WILSON_BDL_ID, PIPPEN_NBA_ID, PIPPEN_BDL_ID]
    );

    const existing: BridgeRow[] = rows.rows.map((r) => ({
      provider: r.provider as 'nba' | 'balldontlie',
      providerId: r.provider_id,
      internalId: r.internal_id,
    }));

    const plan = planWilsonPippenBridgeRepair(existing);
    const report = {
      dry_run: DRY,
      existing,
      plan,
      applied: [] as unknown[],
    };

    if (plan.some((a) => a.action === 'conflict')) {
      console.error('Fail-closed: conflict in repair plan');
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = 2;
      return;
    }

    if (!DRY) {
      await client.query('BEGIN');
      try {
        for (const step of plan) {
          if (step.action === 'noop') continue;
          if (step.action === 'update_bdl_internal') {
            const res = await client.query(
              `
              UPDATE provider_id_map
              SET internal_id = $1,
                  metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                  updated_at = now(),
                  fetched_at = now()
              WHERE entity_type = 'player'
                AND provider = 'balldontlie'
                AND provider_id = $3
                AND internal_id = $4
              RETURNING provider_id, internal_id
              `,
              [
                step.toInternalId,
                JSON.stringify({
                  repair: 'identity_integrity_gate_wilson_pippen',
                  reason: step.reason,
                  previous_internal_id: step.fromInternalId,
                  repaired_at: new Date().toISOString(),
                }),
                step.providerId,
                step.fromInternalId,
              ]
            );
            if (res.rowCount !== 1) {
              throw new Error(
                `Expected 1 row updated for ${step.providerId}, got ${res.rowCount}`
              );
            }
            report.applied.push({ step, result: res.rows[0] });
          }
          if (step.action === 'insert_bdl_bridge') {
            // Fail-closed: refuse if provider_id already exists with different internal
            const existingProv = await client.query(
              `
              SELECT internal_id FROM provider_id_map
              WHERE entity_type='player' AND provider='balldontlie' AND provider_id=$1
              `,
              [step.providerId]
            );
            if (existingProv.rows.length) {
              if (existingProv.rows[0].internal_id !== step.internalId) {
                throw new Error(
                  `Conflict: BDL ${step.providerId} already → ${existingProv.rows[0].internal_id}`
                );
              }
              report.applied.push({ step, result: 'already_present' });
              continue;
            }
            const existingInternal = await client.query(
              `
              SELECT provider_id FROM provider_id_map
              WHERE entity_type='player' AND provider='balldontlie' AND internal_id=$1
              `,
              [step.internalId]
            );
            if (existingInternal.rows.length) {
              throw new Error(
                `Conflict: internal ${step.internalId} already bridged to ${existingInternal.rows[0].provider_id}`
              );
            }
            const res = await client.query(
              `
              INSERT INTO provider_id_map (
                entity_type, internal_id, provider, provider_id, metadata, fetched_at, created_at, updated_at
              ) VALUES (
                'player', $1, 'balldontlie', $2, $3::jsonb, now(), now(), now()
              )
              RETURNING provider_id, internal_id
              `,
              [
                step.internalId,
                step.providerId,
                JSON.stringify({
                  source: 'identity_integrity_gate_wilson_pippen',
                  reason: step.reason,
                  inserted_at: new Date().toISOString(),
                }),
              ]
            );
            report.applied.push({ step, result: res.rows[0] });
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    const outPath = path.join(
      process.cwd(),
      'reports',
      'roster',
      'identity-gate-wilson-pippen-repair.json'
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    console.log(`Wrote ${outPath}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
