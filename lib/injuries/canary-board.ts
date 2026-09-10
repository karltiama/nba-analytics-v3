/**
 * Dry-run helpers for the injuries current-board canary.
 * Identity is BDL player id → analytics.players.player_id only (no name matching).
 * snapshot_at is Court Context observed/fetch time — BDL has no injury updated_at.
 */

import { planInjuryIngest, type InjuryFieldSnapshot, type InjuryPullRow } from '@/lib/injuries/ingest-plan';
import { normalizeAvailabilityStatus } from '@/lib/teams/roster-availability';

export type BdlInjuryCanaryRow = {
  player?: {
    id?: number | null;
    first_name?: string | null;
    last_name?: string | null;
    team_id?: number | null;
    team?: { id?: number | null; abbreviation?: string | null } | null;
  } | null;
  status?: string | null;
  description?: string | null;
  return_date?: string | null;
};

export const INJURY_FRESHNESS_FIELD = {
  persisted: 'snapshot_at',
  semantics: 'court_context_observed',
  providerTimestamp: null as string | null,
  uiLabel: 'Updated N minutes ago uses snapshot_at (fetch time), not a provider injury-changed-at',
} as const;

export function providerPlayerIdFromInjuryRow(row: BdlInjuryCanaryRow): string | null {
  const id = row.player?.id;
  if (id == null || !Number.isFinite(Number(id))) return null;
  return String(id);
}

export function partitionInjuryIdentity(
  rows: BdlInjuryCanaryRow[],
  knownPlayerIds: Set<string>
): {
  mapped: BdlInjuryCanaryRow[];
  unmapped: BdlInjuryCanaryRow[];
  duplicates: string[];
  missingPlayerId: number;
} {
  const mapped: BdlInjuryCanaryRow[] = [];
  const unmapped: BdlInjuryCanaryRow[] = [];
  const seen = new Map<string, number>();
  let missingPlayerId = 0;

  for (const row of rows) {
    const id = providerPlayerIdFromInjuryRow(row);
    if (!id) {
      missingPlayerId += 1;
      unmapped.push(row);
      continue;
    }
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (knownPlayerIds.has(id)) mapped.push(row);
    else unmapped.push(row);
  }

  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  return { mapped, unmapped, duplicates, missingPlayerId };
}

export function inventoryInjuryStatuses(rows: BdlInjuryCanaryRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const raw = row.status == null || !String(row.status).trim() ? '(null)' : String(row.status).trim();
    counts[raw] = (counts[raw] ?? 0) + 1;
  }
  return counts;
}

export function preservedProviderStatus(status: string | null | undefined): string | null {
  if (status == null) return null;
  const trimmed = String(status).trim();
  return trimmed ? trimmed : null;
}

/** UI helper only. Ingest stores provider text; this must not invent statuses. */
export function displayInjuryStatus(status: string | null | undefined): string | null {
  return normalizeAvailabilityStatus(preservedProviderStatus(status));
}

export function toInjuryPullRows(
  mapped: BdlInjuryCanaryRow[],
  snapshotAt: string,
  teamIdByProvider: Map<number, string | null>
): InjuryPullRow[] {
  const out: InjuryPullRow[] = [];
  const seen = new Set<string>();
  for (const row of mapped) {
    const playerId = providerPlayerIdFromInjuryRow(row);
    if (!playerId || seen.has(playerId)) continue;
    seen.add(playerId);
    const providerTeamId = row.player?.team_id ?? row.player?.team?.id ?? null;
    out.push({
      playerId,
      teamId:
        providerTeamId == null ? null : (teamIdByProvider.get(Number(providerTeamId)) ?? null),
      status: preservedProviderStatus(row.status),
      description: row.description == null ? null : String(row.description),
      returnDateRaw: row.return_date == null ? null : String(row.return_date),
      snapshotAt,
    });
  }
  return out;
}

export function dryRunInjuryBoard(args: {
  pullRunId: number;
  observedAt: string;
  mappedRows: BdlInjuryCanaryRow[];
  unmappedCount: number;
  previousCurrent: Map<string, InjuryFieldSnapshot>;
  previousCompleteRowCount: number | null;
  teamIdByProvider?: Map<number, string | null>;
}) {
  const pullRows = toInjuryPullRows(
    args.mappedRows,
    args.observedAt,
    args.teamIdByProvider ?? new Map()
  );
  const plan = planInjuryIngest({
    pullRunId: args.pullRunId,
    pullStatus: 'success',
    completed: true,
    rowsStored: pullRows.length,
    rowsReturned: pullRows.length + args.unmappedCount,
    previousCompleteRowCount: args.previousCompleteRowCount,
    observedAt: args.observedAt,
    pullRows,
    previousCurrent: args.previousCurrent,
  });

  const prevIds = new Set(args.previousCurrent.keys());
  let inserts = 0;
  let updates = 0;
  let unchanged = 0;
  for (const row of plan.currentUpserts) {
    if (!prevIds.has(row.playerId)) inserts += 1;
    else if (plan.historyInserts.some((h) => h.playerId === row.playerId && h.kind === 'change')) {
      updates += 1;
    } else unchanged += 1;
  }

  return {
    ...plan,
    proposed: {
      inserts,
      updates,
      unchanged,
      skippedUnmapped: args.unmappedCount,
      conflicts: 0,
      deletes: plan.currentDeletes.length,
    },
    injuryAsOf: false,
  };
}
