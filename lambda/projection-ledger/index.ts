/**
 * Prospective projection ledger. Fail-closed.
 * The EventBridge schedule is deployed DISABLED.
 * This handler writes nothing unless PROJECTION_LEDGER_WRITES is exactly "1"
 * and the packaged git SHA matches PROJECTION_LEDGER_GIT_SHA.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { PROJECTION_LEDGER_GIT_SHA_ENV, PROJECTION_LEDGER_WRITES_ENV } from '@/lib/betting/projection-ledger/protocol';
import { revisionsAgree } from '@/lib/betting/projection-ledger/revision';

function packagedGitSha(): string {
  try {
    const raw = readFileSync(path.join(__dirname, '..', 'revision.json'), 'utf8');
    const parsed = JSON.parse(raw) as { gitSha?: unknown };
    return typeof parsed.gitSha === 'string' ? parsed.gitSha.trim() : '';
  } catch {
    return '';
  }
}

export async function handler(): Promise<{ statusCode: number; body: string }> {
  if (process.env[PROJECTION_LEDGER_WRITES_ENV] !== '1') {
    console.log(JSON.stringify({ event: 'projection_ledger_skipped', reason: 'writes_disabled', inserted: 0 }));
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: 'writes_disabled', inserted: 0 }),
    };
  }

  const packaged = packagedGitSha();
  const envSha = process.env[PROJECTION_LEDGER_GIT_SHA_ENV] ?? '';
  if (!revisionsAgree(packaged, envSha)) {
    console.log(JSON.stringify({ event: 'projection_ledger_skipped', reason: 'revision_rejected', inserted: 0 }));
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: 'revision_rejected', inserted: 0 }),
    };
  }

  if (!process.env.SUPABASE_DB_URL?.trim()) {
    console.log(JSON.stringify({ event: 'projection_ledger_skipped', reason: 'missing_database_url', inserted: 0 }));
    return { statusCode: 500, body: JSON.stringify({ error: 'missing SUPABASE_DB_URL', inserted: 0 }) };
  }

  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL.trim(),
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    max: 1,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const { runProjectionLedgerCycle } = await import('@/lib/betting/projection-ledger/cycle');
    const summary = await runProjectionLedgerCycle(pool, new Date());
    return { statusCode: 200, body: JSON.stringify(summary) };
  } finally {
    await pool.end();
  }
}
