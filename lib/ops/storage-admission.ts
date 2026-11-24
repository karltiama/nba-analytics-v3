/**
 * Shared PostgreSQL admission. A fresh measurement is not a reservation.
 * Callers pass a positive physical growth bound and an atomic reservation store.
 * A JSON payload length is not that bound.
 */

import {
  CLUSTER_HALT_BYTES,
  CLUSTER_RESTRICT_BYTES,
  RECLAMATION_ABORT_BYTES,
  STORAGE_MEASUREMENT_MAX_AGE_MS,
  decideLabeledStorageWrite,
  type StorageMeasurement,
  type StorageOperationKind,
  type StoragePayloadEstimate,
  type StoragePressure,
  type StorageWriteCategory,
  type StorageWriteDecision,
} from '@/lib/ops/storage-budget';

export { RECLAMATION_ABORT_BYTES };

export type StorageAlert = 'none' | 'warning' | 'critical';

export type AdmissionMeasurement = {
  clusterBytes: number | null;
  measuredAt: string | null;
  source: string | null;
  valid: boolean | null;
  complete: boolean | null;
  /**
   * PostgreSQL clock from the same snapshot as clusterBytes.
   * Reconciliation ignores Lambda clocks when this is present.
   */
  databaseObservedAt?: string | null;
};

/**
 * Legacy settled holds record only the pre-write admission clock.
 * A later database observation can replace one only after a full scoreboard
 * invocation (55s) plus one minute, so an observation taken during the write
 * cannot. New holds use observedThrough instead and do not use this grace.
 */
export const LEGACY_SETTLED_RECONCILE_GRACE_MS = 55_000 + 60_000;

export type ReservationHold = {
  boundBytes: number;
  writerId: string;
  operation: string;
  settledAt?: string;
  /**
   * Database clock of the post-write measurement. Reconciliation cannot use
   * an observation at or before this instant.
   */
  observedThrough?: string;
  /** Last admit or write-intent time. Recovery must be strictly after it. */
  intentAt?: string;
  /** True while this invocation may still be inside a database call. */
  inWrite?: boolean;
};

export type ReservationLedger = {
  protectedBytes: number;
  active: Record<string, ReservationHold>;
  settled: Record<string, ReservationHold>;
};

export type ReservationAction =
  | { type: 'reconcile'; measurementAt: string; databaseObservedAt?: string | null }
  | {
      type: 'reserve';
      invocationId: string;
      writerId: string;
      operation: string;
      boundBytes: number;
      roomBytes: number;
      intentAt: string;
    }
  | {
      type: 'settle';
      invocationId: string;
      writerId: string;
      boundBytes: number;
      settledAt: string;
      observedThrough?: string;
    }
  | { type: 'intent'; invocationId: string; writerId: string; boundBytes: number; intentAt: string; inWrite: boolean }
  | {
      type: 'release';
      invocationId: string;
      writerId: string;
      boundBytes: number;
      inactiveAt: string;
      measurementAt: string;
      confirmSessionEnded: boolean;
      databaseSnapshotAt?: string | null;
    };

export type ReservationTransition =
  | { ok: true; ledger: ReservationLedger; changed: boolean; idempotent: boolean; settled?: boolean }
  | { ok: false; reason: string };

export function emptyReservationLedger(): ReservationLedger {
  return { protectedBytes: 0, active: {}, settled: {} };
}

function cloneLedger(ledger: ReservationLedger): ReservationLedger {
  return {
    protectedBytes: ledger.protectedBytes,
    active: { ...ledger.active },
    settled: { ...ledger.settled },
  };
}

function sameHold(held: ReservationHold, writerId: string, boundBytes: number): boolean {
  return held.writerId === writerId && held.boundBytes === boundBytes;
}

function finiteMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A database observation can drop a settled hold only when it is strictly after
 * that hold's post-write snapshot. Active holds are never dropped here.
 * Callers that do not pass a database clock keep the previous admission-clock rule.
 */
function settledHoldEnds(hold: ReservationHold, action: Extract<ReservationAction, { type: 'reconcile' }>): boolean {
  const databaseMs = finiteMs(action.databaseObservedAt);
  if (databaseMs != null) {
    const throughMs = finiteMs(hold.observedThrough);
    if (throughMs != null) return throughMs < databaseMs;
    const settledMs = finiteMs(hold.settledAt);
    if (settledMs == null) return false;
    return databaseMs > settledMs + LEGACY_SETTLED_RECONCILE_GRACE_MS;
  }
  const measurementMs = finiteMs(action.measurementAt);
  const settledMs = finiteMs(hold.settledAt);
  return measurementMs != null && settledMs != null && settledMs < measurementMs;
}

/** Pure ledger step. Active holds stay until settle. A newer measurement drops only settled holds. */
export function transitionReservation(ledger: ReservationLedger, action: ReservationAction): ReservationTransition {
  if (action.type === 'reconcile') {
    const measurementMs = finiteMs(action.measurementAt);
    if (measurementMs == null) return { ok: false, reason: 'measurement timestamp is unusable' };
    if (action.databaseObservedAt != null && finiteMs(action.databaseObservedAt) == null) {
      return { ok: false, reason: 'measurement timestamp is unusable' };
    }
    let drop = 0;
    const settled: Record<string, ReservationHold> = {};
    for (const [id, hold] of Object.entries(ledger.settled)) {
      if (settledHoldEnds(hold, action)) {
        drop += hold.boundBytes;
      } else {
        settled[id] = hold;
      }
    }
    if (drop === 0) return { ok: true, ledger, changed: false, idempotent: true };
    if (drop > ledger.protectedBytes) return { ok: false, reason: 'settled reservations exceed protected bytes' };
    return {
      ok: true,
      changed: true,
      idempotent: false,
      ledger: { protectedBytes: ledger.protectedBytes - drop, active: { ...ledger.active }, settled },
    };
  }

  if (action.type === 'reserve') {
    const existing = ledger.active[action.invocationId] ?? ledger.settled[action.invocationId];
    if (existing) {
      if (!sameHold(existing, action.writerId, action.boundBytes)) {
        return { ok: false, reason: 'invocation already holds a different reservation' };
      }
      return {
        ok: true,
        ledger,
        changed: false,
        idempotent: true,
        settled: ledger.settled[action.invocationId] != null,
      };
    }
    if (ledger.protectedBytes >= action.roomBytes) {
      return { ok: false, reason: 'reserved capacity leaves no room for this write' };
    }
    const next = cloneLedger(ledger);
    next.protectedBytes += action.boundBytes;
    next.active[action.invocationId] = {
      boundBytes: action.boundBytes,
      writerId: action.writerId,
      operation: action.operation,
      intentAt: action.intentAt,
      inWrite: false,
    };
    return { ok: true, ledger: next, changed: true, idempotent: false };
  }

  if (action.type === 'intent') {
    const active = ledger.active[action.invocationId];
    if (!active) return { ok: false, reason: 'reservation is not active for this invocation' };
    if (!sameHold(active, action.writerId, action.boundBytes)) {
      return { ok: false, reason: 'reservation identity does not match the active hold' };
    }
    if (!Number.isFinite(Date.parse(action.intentAt))) return { ok: false, reason: 'write intent timestamp is unusable' };
    const next = cloneLedger(ledger);
    next.active[action.invocationId] = { ...active, intentAt: action.intentAt, inWrite: action.inWrite };
    return { ok: true, ledger: next, changed: true, idempotent: false };
  }

  if (action.type === 'release') {
    const active = ledger.active[action.invocationId];
    if (!active) return { ok: false, reason: 'reservation is not an active hold for this invocation' };
    if (!sameHold(active, action.writerId, action.boundBytes)) {
      return { ok: false, reason: 'reservation identity does not match the active hold' };
    }
    if (action.confirmSessionEnded !== true) {
      return { ok: false, reason: 'invocation has no stop evidence; a timeout is not proof writes have stopped' };
    }
    const intentMs = Date.parse(active.intentAt ?? '');
    const inactiveMs = Date.parse(action.inactiveAt);
    if (!Number.isFinite(intentMs) || !Number.isFinite(inactiveMs) || inactiveMs <= intentMs) {
      return { ok: false, reason: 'claimed stop is not after the last write intent' };
    }
    const measurementMs = Date.parse(action.measurementAt);
    if (!Number.isFinite(measurementMs) || measurementMs <= inactiveMs) {
      return { ok: false, reason: 'measurement was not taken after the invocation became inactive' };
    }
    if (action.databaseSnapshotAt != null) {
      const snapshotMs = Date.parse(action.databaseSnapshotAt);
      if (!Number.isFinite(snapshotMs) || measurementMs <= snapshotMs) {
        return { ok: false, reason: 'measurement does not cover the database snapshot' };
      }
    }
    if (active.boundBytes > ledger.protectedBytes) {
      return { ok: false, reason: 'active reservation exceeds protected bytes' };
    }
    const next = cloneLedger(ledger);
    delete next.active[action.invocationId];
    next.protectedBytes -= active.boundBytes;
    return { ok: true, ledger: next, changed: true, idempotent: false };
  }

  const active = ledger.active[action.invocationId];
  if (!active) {
    const settled = ledger.settled[action.invocationId];
    if (settled && sameHold(settled, action.writerId, action.boundBytes)) {
      return { ok: true, ledger, changed: false, idempotent: true };
    }
    return { ok: false, reason: 'reservation is not active for this invocation' };
  }
  if (!sameHold(active, action.writerId, action.boundBytes)) {
    return { ok: false, reason: 'reservation identity does not match the active hold' };
  }
  if (action.observedThrough != null && finiteMs(action.observedThrough) == null) {
    return { ok: false, reason: 'post-write measurement timestamp is unusable' };
  }
  const next = cloneLedger(ledger);
  delete next.active[action.invocationId];
  next.settled[action.invocationId] = {
    ...active,
    settledAt: action.settledAt,
    ...(action.observedThrough ? { observedThrough: action.observedThrough } : {}),
  };
  return { ok: true, ledger: next, changed: true, idempotent: false };
}

export type StorageReservationStore = {
  reserve(input: {
    invocationId: string;
    writerId: string;
    operation: string;
    boundBytes: number;
    roomBytes: number;
    measurementAt: string;
    databaseObservedAt?: string | null;
  }): Promise<
    | { ok: true; protectedBytes: number; idempotent: boolean; settled?: boolean }
    | { ok: false; reason: string; protectedBytes: number }
  >;
  settle(input: {
    invocationId: string;
    writerId: string;
    boundBytes: number;
    settledAt: string;
    measurementAt: string;
    observedThrough?: string;
  }): Promise<void>;
  noteWriteIntent(input: {
    invocationId: string;
    writerId: string;
    boundBytes: number;
    intentAt: string;
    inWrite: boolean;
  }): Promise<{ ok: true; version: number } | { ok: false; reason: string }>;
  releaseStranded(input: StrandedReleaseInput): Promise<
    { ok: true; version: number; protectedBytes: number } | { ok: false; reason: string; protectedBytes: number }
  >;
};

export type StrandedReleaseInput = {
  now: string;
  invocationId: string;
  writerId: string;
  boundBytes: number;
  expectedVersion: number;
  inactiveAt: string;
  confirmSessionEnded: boolean;
  processTimedOut?: boolean;
  measurement: AdmissionMeasurement;
  databaseSnapshotAt?: string | null;
};

/** Operator recovery evidence. A timeout flag alone never passes. */
export function assessStrandedRecovery(input: StrandedReleaseInput): { ok: true } | { ok: false; reason: string } {
  if (input.confirmSessionEnded !== true) {
    return {
      ok: false,
      reason: input.processTimedOut
        ? 'a process timeout is not proof that database writes have stopped'
        : 'invocation has no stop evidence; a timeout is not proof writes have stopped',
    };
  }
  const measurement = input.measurement;
  const source = measurement.source?.trim() ?? '';
  if (source === '' || measurement.valid !== true || measurement.complete !== true) {
    return { ok: false, reason: 'recovery measurement is missing, incomplete, or untrusted' };
  }
  if (typeof measurement.clusterBytes !== 'number' || !Number.isSafeInteger(measurement.clusterBytes) || measurement.clusterBytes < 0) {
    return { ok: false, reason: 'recovery measurement has no cluster size' };
  }
  if (typeof measurement.measuredAt !== 'string') {
    return { ok: false, reason: 'recovery measurement has no timestamp' };
  }
  const measuredMs = Date.parse(measurement.measuredAt);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(measuredMs) || !Number.isFinite(nowMs)) {
    return { ok: false, reason: 'recovery clock or measurement timestamp is unusable' };
  }
  const age = nowMs - measuredMs;
  if (age < 0) return { ok: false, reason: 'recovery measurement is future-dated' };
  if (age > STORAGE_MEASUREMENT_MAX_AGE_MS) {
    return { ok: false, reason: 'recovery measurement is older than 60 minutes' };
  }
  const inactiveMs = Date.parse(input.inactiveAt);
  if (!Number.isFinite(inactiveMs) || measuredMs <= inactiveMs) {
    return { ok: false, reason: 'measurement was not taken after the invocation became inactive' };
  }
  if (input.databaseSnapshotAt != null) {
    const snapshotMs = Date.parse(input.databaseSnapshotAt);
    if (!Number.isFinite(snapshotMs) || measuredMs <= snapshotMs) {
      return { ok: false, reason: 'measurement does not cover the database snapshot' };
    }
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    return { ok: false, reason: 'ledger version is not a usable integer' };
  }
  return { ok: true };
}

export class MemoryStorageReservationStore implements StorageReservationStore {
  private ledger = emptyReservationLedger();
  private version = 0;
  private tail: Promise<void> = Promise.resolve();

  ledgerVersion(): number {
    return this.version;
  }

  private exclusive<T>(body: () => T): Promise<T> {
    const run = this.tail.then(() => body());
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  reserve(input: {
    invocationId: string;
    writerId: string;
    operation: string;
    boundBytes: number;
    roomBytes: number;
    measurementAt: string;
    databaseObservedAt?: string | null;
  }): Promise<{ ok: true; protectedBytes: number; idempotent: boolean } | { ok: false; reason: string; protectedBytes: number }> {
    return this.exclusive(() => {
      const reconciled = transitionReservation(this.ledger, {
        type: 'reconcile',
        measurementAt: input.measurementAt,
        databaseObservedAt: input.databaseObservedAt,
      });
      if (!reconciled.ok) return { ok: false as const, reason: reconciled.reason, protectedBytes: this.ledger.protectedBytes };
      if (reconciled.changed) {
        this.ledger = reconciled.ledger;
        this.version += 1;
      }
      const reserved = transitionReservation(this.ledger, {
        type: 'reserve',
        invocationId: input.invocationId,
        writerId: input.writerId,
        operation: input.operation,
        boundBytes: input.boundBytes,
        roomBytes: input.roomBytes,
        intentAt: input.measurementAt,
      });
      if (!reserved.ok) return { ok: false as const, reason: reserved.reason, protectedBytes: this.ledger.protectedBytes };
      if (reserved.changed) {
        this.ledger = reserved.ledger;
        this.version += 1;
      }
      return {
        ok: true as const,
        protectedBytes: this.ledger.protectedBytes,
        idempotent: reserved.idempotent,
        settled: reserved.settled === true,
      };
    });
  }

  settle(input: {
    invocationId: string;
    writerId: string;
    boundBytes: number;
    settledAt: string;
    measurementAt: string;
    observedThrough?: string;
  }): Promise<void> {
    return this.exclusive(() => {
      const settled = transitionReservation(this.ledger, { type: 'settle', ...input });
      if (!settled.ok) throw new Error(settled.reason);
      if (settled.changed) {
        this.ledger = settled.ledger;
        this.version += 1;
      }
    });
  }

  noteWriteIntent(input: {
    invocationId: string;
    writerId: string;
    boundBytes: number;
    intentAt: string;
    inWrite: boolean;
  }): Promise<{ ok: true; version: number } | { ok: false; reason: string }> {
    return this.exclusive(() => {
      const noted = transitionReservation(this.ledger, { type: 'intent', ...input });
      if (!noted.ok) return { ok: false as const, reason: noted.reason };
      if (noted.changed) {
        this.ledger = noted.ledger;
        this.version += 1;
      }
      return { ok: true as const, version: this.version };
    });
  }

  releaseStranded(
    input: StrandedReleaseInput
  ): Promise<{ ok: true; version: number; protectedBytes: number } | { ok: false; reason: string; protectedBytes: number }> {
    const assessed = assessStrandedRecovery(input);
    if (!assessed.ok) {
      return Promise.resolve({ ok: false as const, reason: assessed.reason, protectedBytes: this.ledger.protectedBytes });
    }
    return this.exclusive(() => {
      if (this.version !== input.expectedVersion) {
        return {
          ok: false as const,
          reason: 'ledger version does not match this reservation',
          protectedBytes: this.ledger.protectedBytes,
        };
      }
      const released = transitionReservation(this.ledger, {
        type: 'release',
        invocationId: input.invocationId,
        writerId: input.writerId,
        boundBytes: input.boundBytes,
        inactiveAt: input.inactiveAt,
        measurementAt: input.measurement.measuredAt ?? '',
        confirmSessionEnded: input.confirmSessionEnded,
        databaseSnapshotAt: input.databaseSnapshotAt,
      });
      if (!released.ok) {
        return { ok: false as const, reason: released.reason, protectedBytes: this.ledger.protectedBytes };
      }
      if (released.changed) {
        this.ledger = released.ledger;
        this.version += 1;
      }
      return { ok: true as const, version: this.version, protectedBytes: this.ledger.protectedBytes };
    });
  }

  /** Test inspection. Production callers use reserve and settle. */
  snapshot(): ReservationLedger {
    return cloneLedger(this.ledger);
  }
}

export type StorageAdmissionConfig = {
  now: string;
  invocationId: string;
  measurement: AdmissionMeasurement;
  physicalGrowthBoundBytes: number | null;
  reservations: StorageReservationStore;
  /** Post-write cluster sizes. When set, growth above the envelope does not settle. */
  observedDatabaseGrowth?: { beforeBytes: number; afterBytes: number } | null;
};

export type StorageAdmissionDecision = StorageWriteDecision & {
  alert: StorageAlert;
  writerId: string;
  invocationId: string;
  clusterBytes: number | null;
  reservedBytes: number;
  proposedBytes: number | null;
  projectedBytes: number | null;
  ceilingBytes: number | null;
  tables: readonly string[];
  /** Same invocation already finished its post-write measurement. Do not write again. */
  alreadySettled?: boolean;
  settle: (evidence?: { databaseObservedAt: string }) => Promise<void>;
};

const RESTRICTED = new Set<StorageWriteCategory>(['historical_raw_props', 'historical_raw_odds', 'optional_backfill']);

/** Lowest byte total at which this category is denied. Reclamation abort is intentionally absent. */
export function storageWriteCeiling(category: StorageWriteCategory): number | null {
  if (category === 's3_archive') return null;
  if (RESTRICTED.has(category)) return CLUSTER_RESTRICT_BYTES;
  return CLUSTER_HALT_BYTES;
}

function alertFor(allowed: boolean, pressure: StoragePressure): StorageAlert {
  if (!allowed || pressure === 'halt' || pressure === 'quota') return 'critical';
  if (pressure === 'warning' || pressure === 'restrict') return 'warning';
  return 'none';
}

function refusal(input: {
  writerId: string;
  invocationId: string;
  tables: readonly string[];
  policy: StorageWriteDecision;
  clusterBytes: number | null;
  reservedBytes: number;
  proposedBytes: number | null;
  projectedBytes: number | null;
  ceilingBytes: number | null;
}): StorageAdmissionDecision {
  return {
    ...input.policy,
    alert: alertFor(input.policy.allowed, input.policy.pressure),
    writerId: input.writerId,
    invocationId: input.invocationId,
    clusterBytes: input.clusterBytes,
    reservedBytes: input.reservedBytes,
    proposedBytes: input.proposedBytes,
    projectedBytes: input.projectedBytes,
    ceilingBytes: input.ceilingBytes,
    tables: input.tables,
    settle: async () => undefined,
  };
}

function denied(
  writerId: string,
  invocationId: string,
  tables: readonly string[],
  reason: string,
  pressure: StoragePressure = 'unmeasured'
): StorageAdmissionDecision {
  return refusal({
    writerId,
    invocationId,
    tables,
    policy: { category: null, allowed: false, pressure, reason },
    clusterBytes: null,
    reservedBytes: 0,
    proposedBytes: null,
    projectedBytes: null,
    ceilingBytes: null,
  });
}

export async function admitPersistentWrite(input: {
  writerId: string;
  kind: StorageOperationKind;
  invocationId: string;
  now: string;
  measurement: AdmissionMeasurement;
  physicalGrowthBoundBytes: number | null;
  tables: readonly string[];
  reservations: StorageReservationStore;
  /** Passed through for kinds whose category still requires a payload estimate. Not a physical bound. */
  payload?: StoragePayloadEstimate;
}): Promise<StorageAdmissionDecision> {
  const writerId = input.writerId.trim();
  const invocationId = input.invocationId.trim();
  const tables = input.tables.map((table) => table.trim()).filter((table) => table !== '');
  if (writerId === '' || invocationId === '') {
    return denied(writerId, invocationId, tables, 'writer identity or invocation id is missing');
  }
  if (tables.length === 0) {
    return denied(writerId, invocationId, tables, 'operation does not name the tables it writes');
  }

  const source = input.measurement.source?.trim() ?? '';
  if (source === '') {
    return denied(writerId, invocationId, tables, 'cluster measurement source is missing or untrusted');
  }
  if (input.measurement.complete !== true) {
    return denied(writerId, invocationId, tables, 'cluster measurement is incomplete');
  }

  const measurement: StorageMeasurement = {
    valid: input.measurement.valid,
    clusterBytes: input.measurement.clusterBytes,
    measuredAt: input.measurement.measuredAt,
  };
  const policy = decideLabeledStorageWrite({ kind: input.kind }, measurement, input.now, input.payload);
  if (!policy.allowed || policy.category == null) {
    return refusal({
      writerId,
      invocationId,
      tables,
      policy,
      clusterBytes: typeof input.measurement.clusterBytes === 'number' ? input.measurement.clusterBytes : null,
      reservedBytes: 0,
      proposedBytes: input.physicalGrowthBoundBytes,
      projectedBytes: null,
      ceilingBytes: policy.category == null ? null : storageWriteCeiling(policy.category),
    });
  }

  const bound = input.physicalGrowthBoundBytes;
  if (typeof bound !== 'number' || !Number.isSafeInteger(bound) || bound < 1) {
    return refusal({
      writerId,
      invocationId,
      tables,
      policy: {
        category: policy.category,
        allowed: false,
        pressure: policy.pressure,
        reason: 'physical PostgreSQL growth bound is unknown or not a positive integer',
      },
      clusterBytes: input.measurement.clusterBytes,
      reservedBytes: 0,
      proposedBytes: bound,
      projectedBytes: null,
      ceilingBytes: storageWriteCeiling(policy.category),
    });
  }

  const ceiling = storageWriteCeiling(policy.category);
  const clusterBytes = input.measurement.clusterBytes;
  if (ceiling == null || typeof clusterBytes !== 'number' || !Number.isSafeInteger(clusterBytes)) {
    return denied(writerId, invocationId, tables, 'storage ceiling is not defined for this write', policy.pressure);
  }
  if (!Number.isSafeInteger(clusterBytes + bound)) {
    return refusal({
      writerId,
      invocationId,
      tables,
      policy: {
        category: policy.category,
        allowed: false,
        pressure: policy.pressure,
        reason: 'physical growth bound overflows the storage ceiling',
      },
      clusterBytes,
      reservedBytes: 0,
      proposedBytes: bound,
      projectedBytes: null,
      ceilingBytes: ceiling,
    });
  }
  const roomBytes = clusterBytes + bound < ceiling ? ceiling - clusterBytes - bound : 0;
  const measuredAt = input.measurement.measuredAt;
  if (typeof measuredAt !== 'string') {
    return denied(writerId, invocationId, tables, 'cluster size measurement has no timestamp');
  }

  let reserved: Awaited<ReturnType<StorageReservationStore['reserve']>>;
  try {
    reserved = await input.reservations.reserve({
      invocationId,
      writerId,
      operation: input.kind,
      boundBytes: bound,
      roomBytes,
      measurementAt: measuredAt,
      databaseObservedAt: input.measurement.databaseObservedAt,
    });
  } catch {
    return refusal({
      writerId,
      invocationId,
      tables,
      policy: {
        category: policy.category,
        allowed: false,
        pressure: 'unmeasured',
        reason: 'reservation service failed; refusing the write',
      },
      clusterBytes,
      reservedBytes: 0,
      proposedBytes: bound,
      projectedBytes: null,
      ceilingBytes: ceiling,
    });
  }

  if (!reserved.ok) {
    const projected = Number.isSafeInteger(clusterBytes + reserved.protectedBytes + bound)
      ? clusterBytes + reserved.protectedBytes + bound
      : null;
    return refusal({
      writerId,
      invocationId,
      tables,
      policy: { category: policy.category, allowed: false, pressure: policy.pressure, reason: reserved.reason },
      clusterBytes,
      reservedBytes: reserved.protectedBytes,
      proposedBytes: bound,
      projectedBytes: projected,
      ceilingBytes: ceiling,
    });
  }

  const projectedBytes = clusterBytes + reserved.protectedBytes;
  return {
    category: policy.category,
    allowed: true,
    pressure: policy.pressure,
    reason: reserved.idempotent
      ? 'invocation already holds this reservation'
      : 'measurement is fresh and the reserved physical bound stays below the category ceiling',
    alreadySettled: reserved.settled === true,
    alert: alertFor(true, policy.pressure),
    writerId,
    invocationId,
    clusterBytes,
    reservedBytes: reserved.protectedBytes,
    proposedBytes: bound,
    projectedBytes,
    ceilingBytes: ceiling,
    tables,
    settle: async (evidence?: { databaseObservedAt: string }) => {
      await input.reservations.settle({
        invocationId,
        writerId,
        boundBytes: bound,
        settledAt: input.now,
        measurementAt: measuredAt,
        observedThrough: evidence?.databaseObservedAt,
      });
    },
  };
}

/** Local tests inject this. Production handlers omit it and fail closed. */
export function localFreshAdmission(invocationId: string, boundBytes = 1_000): StorageAdmissionConfig {
  return {
    now: '2026-11-19T16:00:00.000Z',
    invocationId,
    measurement: {
      clusterBytes: 1_000_000,
      measuredAt: '2026-11-19T15:30:00.000Z',
      source: 'local-test',
      valid: true,
      complete: true,
    },
    physicalGrowthBoundBytes: boundBytes,
    reservations: new MemoryStorageReservationStore(),
  };
}
