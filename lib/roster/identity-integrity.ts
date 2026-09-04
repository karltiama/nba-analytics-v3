/**
 * Detect when multiple roster observations in one snapshot resolve to the same
 * analytics player_id (identity collision). Fail-closed for stint population.
 */

export type ResolvedAssignment = {
  nbaPlayerId: string;
  analyticsPlayerId: string;
  fullName: string;
  teamAbbr: string;
};

export type DuplicateCanonicalAssignment = {
  analyticsPlayerId: string;
  assignments: ResolvedAssignment[];
};

export function findDuplicateCanonicalAssignments(
  assignments: ResolvedAssignment[]
): DuplicateCanonicalAssignment[] {
  const byCanonical = new Map<string, ResolvedAssignment[]>();
  for (const a of assignments) {
    const list = byCanonical.get(a.analyticsPlayerId) ?? [];
    list.push(a);
    byCanonical.set(a.analyticsPlayerId, list);
  }
  return [...byCanonical.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([analyticsPlayerId, list]) => ({
      analyticsPlayerId,
      assignments: list,
    }));
}

/**
 * Known bad bridge: Scotty Pippen Jr. NBA id incorrectly pointed at Jalen Wilson BDL id.
 * Repair plan is pure / testable.
 */
export type BridgeRow = {
  provider: 'nba' | 'balldontlie';
  providerId: string;
  internalId: string;
};

export type BridgeRepairAction =
  | {
      action: 'update_bdl_internal';
      providerId: string;
      fromInternalId: string;
      toInternalId: string;
      reason: string;
    }
  | {
      action: 'insert_bdl_bridge';
      providerId: string;
      internalId: string;
      reason: string;
    }
  | { action: 'noop'; reason: string }
  | { action: 'conflict'; detail: string };

export const WILSON_NBA_ID = '1630592';
export const WILSON_BDL_ID = '56677722';
export const PIPPEN_NBA_ID = '1630590';
export const PIPPEN_BDL_ID = '38017656';

export function planWilsonPippenBridgeRepair(existing: BridgeRow[]): BridgeRepairAction[] {
  const actions: BridgeRepairAction[] = [];
  const bdlByProvider = existing.filter((r) => r.provider === 'balldontlie');

  const wilsonBdl = bdlByProvider.find((r) => r.providerId === WILSON_BDL_ID);
  if (!wilsonBdl) {
    actions.push({
      action: 'insert_bdl_bridge',
      providerId: WILSON_BDL_ID,
      internalId: WILSON_NBA_ID,
      reason: 'Missing Wilson BDL bridge; insert nba→bdl',
    });
  } else if (wilsonBdl.internalId === WILSON_NBA_ID) {
    actions.push({
      action: 'noop',
      reason: 'Wilson BDL bridge already correct',
    });
  } else if (wilsonBdl.internalId === PIPPEN_NBA_ID) {
    actions.push({
      action: 'update_bdl_internal',
      providerId: WILSON_BDL_ID,
      fromInternalId: PIPPEN_NBA_ID,
      toInternalId: WILSON_NBA_ID,
      reason:
        'Wrong bridge: Pippen NBA id (1630590) pointed at Wilson BDL id (56677722); re-point to Wilson NBA id',
    });
  } else {
    actions.push({
      action: 'conflict',
      detail: `Wilson BDL id ${WILSON_BDL_ID} maps to unexpected internal_id=${wilsonBdl.internalId}`,
    });
  }

  const pippenBdl = bdlByProvider.find((r) => r.providerId === PIPPEN_BDL_ID);
  const pippenByInternal = bdlByProvider.filter((r) => r.internalId === PIPPEN_NBA_ID);

  if (pippenBdl) {
    if (pippenBdl.internalId === PIPPEN_NBA_ID) {
      actions.push({ action: 'noop', reason: 'Pippen BDL bridge already correct' });
    } else {
      actions.push({
        action: 'conflict',
        detail: `Pippen BDL id ${PIPPEN_BDL_ID} already maps to internal_id=${pippenBdl.internalId}`,
      });
    }
  } else if (
    pippenByInternal.some((r) => r.providerId !== WILSON_BDL_ID && r.providerId !== PIPPEN_BDL_ID)
  ) {
    actions.push({
      action: 'conflict',
      detail: `Pippen NBA id already has other BDL bridge(s): ${pippenByInternal
        .map((r) => r.providerId)
        .join(',')}`,
    });
  } else {
    // After Wilson update, Pippen internal should have no remaining BDL row (or only the bad one being moved).
    actions.push({
      action: 'insert_bdl_bridge',
      providerId: PIPPEN_BDL_ID,
      internalId: PIPPEN_NBA_ID,
      reason: 'Insert correct Pippen NBA→BDL bridge (38017656)',
    });
  }

  return actions;
}

export function assertDistinctCanonicalPlayers(
  wilsonAnalyticsId: string | null,
  pippenAnalyticsId: string | null
): void {
  if (!wilsonAnalyticsId || !pippenAnalyticsId) {
    throw new Error('Both players must resolve to an analytics id');
  }
  if (wilsonAnalyticsId === pippenAnalyticsId) {
    throw new Error(
      `Wilson and Pippen must not share analytics id (got ${wilsonAnalyticsId})`
    );
  }
}
