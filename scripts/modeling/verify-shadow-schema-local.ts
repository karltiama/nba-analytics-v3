/**
 * Disposable Postgres verification for collection schema + shadow writes.
 * Does not apply SQL to production. Does not enable live collection.
 *
 *   npx tsx scripts/modeling/verify-shadow-schema-local.ts
 *   SHADOW_TEST_DATABASE_URL=postgres://... npx tsx scripts/modeling/verify-shadow-schema-local.ts
 */
import 'dotenv/config';
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { persistInjuryCollectorExtras, planInjuryCollectorExtras } from '../../lib/injuries/collector-persist';
import {
  CollectionSchemaPreflightError,
  inspectInjuryCollectionSchema,
  inspectShadowWriteSchema,
  withSavepoint,
} from '../../lib/db/schema-capability';
import { insertPredictionSnapshot, insertShadowRunRecord } from '../../lib/betting/player-projection-shadow-store';
import { SHADOW_FEATURE_ORDER, SHADOW_FEATURE_SPEC_VERSION, SHADOW_MODEL_VERSION } from '../../lib/betting/player-projection-shadow-protocol';

function intendedCutoff(tip: string): string {
  return new Date(Date.parse(tip) - 60 * 60 * 1000).toISOString();
}

const ROOT = process.cwd();
const RESULTS = join(ROOT, 'reports/modeling/shadow-pts-reb-c-r1/local-schema-verification.json');

type Step = { name: string; ok: boolean; detail: string };

async function startDocker(): Promise<{ url: string; containerId: string | null; started: boolean; note: string }> {
  if (process.env.SHADOW_TEST_DATABASE_URL) {
    return { url: process.env.SHADOW_TEST_DATABASE_URL, containerId: null, started: false, note: 'SHADOW_TEST_DATABASE_URL' };
  }
  const docker = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  if (docker.status !== 0) {
    return { url: '', containerId: null, started: false, note: 'docker unavailable' };
  }
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--rm',
      '-e',
      'POSTGRES_PASSWORD=shadowtest',
      '-e',
      'POSTGRES_DB=shadowtest',
      '-p',
      '55432:5432',
      'postgres:16-alpine',
    ],
    { encoding: 'utf8' }
  );
  if (run.status !== 0) {
    return { url: '', containerId: null, started: false, note: run.stderr || run.stdout || 'docker run failed' };
  }
  const id = run.stdout.trim();
  await new Promise((r) => setTimeout(r, 4000));
  return {
    url: 'postgres://postgres:shadowtest@127.0.0.1:55432/shadowtest',
    containerId: id,
    started: true,
    note: 'docker postgres:16-alpine',
  };
}

async function main() {
  const steps: Step[] = [];
  const docker = await startDocker();
  if (!docker.url) {
    const payload = {
      generated_at: new Date().toISOString(),
      status: 'skipped',
      reason: docker.note,
      steps,
    };
    mkdirSync(join(ROOT, 'reports/modeling/shadow-pts-reb-c-r1'), { recursive: true });
    writeFileSync(RESULTS, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const pool = new Pool({ connectionString: docker.url, connectionTimeoutMillis: 8000 });
  try {
    const client = await pool.connect();
    try {
      const base = readFileSync(join(ROOT, 'scripts/modeling/fixtures/shadow-local-base.sql'), 'utf8');
      await client.query(base);
      steps.push({ name: 'base_schema', ok: true, detail: 'raw + analytics parents created' });

      const injuryBefore = await inspectInjuryCollectionSchema(client);
      const shadowBefore = await inspectShadowWriteSchema(client);
      steps.push({
        name: 'pre_migration_inspect',
        ok: !injuryBefore.ready && !shadowBefore.ready,
        detail: `injury missing=${injuryBefore.missing.join(',')} shadow missing=${shadowBefore.missing.join(',')}`,
      });

      await client.query('INSERT INTO raw.injury_pull_runs (status) VALUES ($1) RETURNING pull_run_id', ['success']);
      const pullIdRes = await client.query('SELECT max(pull_run_id)::int AS id FROM raw.injury_pull_runs');
      const pullRunId = Number(pullIdRes.rows[0].id);
      const extras = planInjuryCollectorExtras({
        pullRunId,
        observedAt: new Date().toISOString(),
        pullStatus: 'success',
        completed: true,
        rowsStored: 1,
        rowsReturned: 1,
        previousCompleteRowCount: 1,
        inReportPlayerIds: ['1'],
      });
      const optional = await persistInjuryCollectorExtras(client, extras, { schemaMode: 'optional' });
      steps.push({
        name: 'optional_missing_schema',
        ok: optional.schemaEnrichment === 'unavailable' && !optional.membershipPersisted,
        detail: JSON.stringify(optional),
      });

      let requiredFailed = false;
      try {
        await persistInjuryCollectorExtras(client, extras, { schemaMode: 'required' });
      } catch (err) {
        requiredFailed = err instanceof CollectionSchemaPreflightError;
      }
      steps.push({
        name: 'required_missing_schema_preflight',
        ok: requiredFailed,
        detail: 'required mode threw CollectionSchemaPreflightError',
      });

      await client.query('BEGIN');
      const recovered = await withSavepoint(client, 'opt_fail', async () => {
        await client.query('SELECT * FROM analytics.prediction_snapshots LIMIT 1');
      });
      const stillOpen = await client.query('SELECT 1 AS ok');
      await client.query('ROLLBACK');
      steps.push({
        name: 'savepoint_recovers_aborted_subtransaction',
        ok: recovered.ok === false && Number(stillOpen.rows[0].ok) === 1,
        detail: recovered.ok ? 'savepoint unexpectedly succeeded' : 'ROLLBACK TO SAVEPOINT left transaction usable',
      });

      const migration = readFileSync(join(ROOT, 'db/schemas/MIGRATION_context_collection_snapshots.sql'), 'utf8');
      await client.query(migration);
      const injuryAfter = await inspectInjuryCollectionSchema(client);
      const shadowAfter = await inspectShadowWriteSchema(client);
      steps.push({
        name: 'apply_migration',
        ok: injuryAfter.ready && shadowAfter.ready,
        detail: `injury ready=${injuryAfter.ready} shadow ready=${shadowAfter.ready}`,
      });

      await client.query(`INSERT INTO analytics.teams (team_id) VALUES ('t1'), ('t2') ON CONFLICT DO NOTHING`);
      await client.query(`INSERT INTO analytics.players (player_id) VALUES ('p1') ON CONFLICT DO NOTHING`);
      await client.query(
        `INSERT INTO analytics.games (game_id, season, start_time, home_team_id, away_team_id, status)
         VALUES ('g1', '2026', '2026-10-21T00:00:00Z', 't1', 't2', 'Scheduled')
         ON CONFLICT DO NOTHING`
      );
      const tip = '2026-10-21T00:00:00.000Z';
      const record = {
        logicalKey: `p1|g1|${SHADOW_MODEL_VERSION}|${intendedCutoff(tip)}`,
        playerId: 'p1',
        gameId: 'g1',
        scheduledTipoff: tip,
        intendedCutoffAt: intendedCutoff(tip),
        generatedAt: '2026-10-20T22:59:00.000Z',
        late: false,
        delivery: 'on_time' as const,
        modelVersion: SHADOW_MODEL_VERSION,
        featureSpecVersion: SHADOW_FEATURE_SPEC_VERSION,
        featureOrder: SHADOW_FEATURE_ORDER,
        featureValues: { pts_l10: 20 },
        featureChecksum: 'abc',
        modelChecksums: { points: 'p', rebounds: 'r' },
        predA: { points: 20, rebounds: 7 },
        predB: { points: 20, rebounds: 7 },
        predC: { points: 19, rebounds: 6 },
        eligibility: 'ok' as const,
        sourceFreshness: {},
        tipoffRevision: 0,
      };
      const first = await insertPredictionSnapshot(client, record);
      const retry = await insertPredictionSnapshot(client, record);
      steps.push({
        name: 'snapshot_unique_retry',
        ok: first.accepted && !retry.accepted,
        detail: `first=${String(first.accepted)} retry=${String(retry.accepted)}`,
      });

      const requiredOk = await persistInjuryCollectorExtras(client, extras, { schemaMode: 'required' });
      steps.push({
        name: 'required_after_migration',
        ok: requiredOk.schemaEnrichment === 'available' && requiredOk.membershipPersisted,
        detail: JSON.stringify(requiredOk),
      });

      const runId = await insertShadowRunRecord(client, {
        runAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        action: 'score',
        status: 'success',
        dueCount: 1,
        onTimeCount: 1,
        lateCount: 0,
        failedCount: 0,
        missingCount: 0,
        ineligibleCount: 0,
        settledCount: 0,
        settlementBacklog: 0,
        schemaMode: 'required',
        schemaEnrichment: 'available',
        featureInputAgeHours: 1,
        details: { incomplete_pull: false },
      });
      steps.push({
        name: 'shadow_run_record',
        ok: runId != null,
        detail: `run_id=${String(runId)}`,
      });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
    if (docker.containerId) {
      spawnSync('docker', ['stop', docker.containerId], { encoding: 'utf8' });
    }
  }

  const payload = {
    generated_at: new Date().toISOString(),
    status: steps.every((s) => s.ok) ? 'passed' : 'failed',
    database: docker.note,
    steps,
  };
  mkdirSync(join(ROOT, 'reports/modeling/shadow-pts-reb-c-r1'), { recursive: true });
  writeFileSync(RESULTS, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  if (payload.status !== 'passed') process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
