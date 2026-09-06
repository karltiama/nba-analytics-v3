/**
 * Shared injury serving-freshness policy.
 *
 * Live: snapshot_at within INJURY_FRESHNESS_HOURS (default 36) is authoritative.
 * Frozen/offseason/replay: current rows stay in Postgres but are not authoritative.
 * Missing/invalid freshness env resolves to 36. Invalid snapshot_at is non-authoritative.
 */

import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';
import { isActiveReportedInjuryStatus } from './leave-report';

export const INJURY_FRESHNESS_HOURS_ENV = 'INJURY_FRESHNESS_HOURS';
export const DEFAULT_INJURY_FRESHNESS_HOURS = 36;

export function resolveInjuryFreshnessHours(
  raw: string | undefined,
  fallback: number = DEFAULT_INJURY_FRESHNESS_HOURS
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function isFrozenInjuryServing(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return shouldSkipLiveMutations(env);
}

export function parseInjurySnapshotAt(
  snapshotAt: string | Date | null | undefined
): Date | null {
  if (snapshotAt == null) return null;
  if (snapshotAt instanceof Date) {
    return Number.isNaN(snapshotAt.getTime()) ? null : snapshotAt;
  }
  const trimmed = String(snapshotAt).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isInjurySnapshotFresh(
  snapshotAt: string | Date | null | undefined,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  now: Date = new Date()
): boolean {
  const at = parseInjurySnapshotAt(snapshotAt);
  if (!at) return false;
  const hours = resolveInjuryFreshnessHours(env[INJURY_FRESHNESS_HOURS_ENV]);
  const ageMs = now.getTime() - at.getTime();
  if (ageMs <= hours * 60 * 60 * 1000) return true;
  return false;
}

export type InjuryServingRow = {
  snapshotAt: string | Date | null | undefined;
  status?: string | null;
};

/**
 * Whether a current-table row may be treated as a live injury fact.
 * Stale, frozen, invalid, or leave-report statuses are omitted from active context.
 */
export function isInjuryAuthoritativeForServing(
  row: InjuryServingRow,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  now: Date = new Date()
): boolean {
  if (row.status !== undefined && !isActiveReportedInjuryStatus(row.status)) {
    return false;
  }
  if (isFrozenInjuryServing(env)) return false;
  return isInjurySnapshotFresh(row.snapshotAt, env, now);
}

export function filterAuthoritativeInjuries<T extends InjuryServingRow>(
  rows: T[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  now: Date = new Date()
): T[] {
  return rows.filter((row) => isInjuryAuthoritativeForServing(row, env, now));
}
