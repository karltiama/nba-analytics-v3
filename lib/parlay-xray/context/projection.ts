import type { CanonicalPropType } from '@/lib/betting/market-movement';
import { isStrictlyBeforeCutoff } from './cutoff';
import { finiteOrNull, round1 } from './stats';
import type { XRayProjectionContext, XrayArchivedProjection } from './types';

function projectedValue(
  predictions: Record<string, unknown> | null,
  market: CanonicalPropType | null
): number | null {
  if (!predictions || !market) return null;
  const keys =
    market === 'points'
      ? ['pts', 'points', 'pred_pts']
      : market === 'rebounds'
        ? ['reb', 'rebounds', 'pred_reb']
        : [];
  for (const key of keys) {
    const value = finiteOrNull(typeof predictions[key] === 'number' ? (predictions[key] as number) : Number(predictions[key]));
    if (value != null) return round1(value);
  }
  return null;
}

export function assembleProjection(args: {
  snapshots: XrayArchivedProjection[];
  playerId: string | null;
  gameId: string | null;
  cutoffAt: string | null;
  market: CanonicalPropType | null;
  requestedLine: number | null;
}): XRayProjectionContext {
  const empty: XRayProjectionContext = {
    status: 'UNAVAILABLE',
    reason: 'NO_ARCHIVED_PREGAME_PROJECTION',
    modelVersion: null,
    generatedAt: null,
    intendedCutoffAt: null,
    projectedStat: null,
    requestedLine: args.requestedLine,
    difference: null,
  };
  if (!args.cutoffAt) return { ...empty, reason: 'MISSING_CONTEXT_CUTOFF' };
  if (!args.playerId || !args.gameId) return empty;
  if (args.market !== 'points' && args.market !== 'rebounds') {
    return { ...empty, reason: 'MARKET_NOT_IN_ARCHIVED_PROJECTION' };
  }

  const eligible = args.snapshots.filter(
    (row) =>
      row.playerId === args.playerId &&
      row.gameId === args.gameId &&
      row.modelVersion.trim().length > 0 &&
      isStrictlyBeforeCutoff(row.generatedAt, args.cutoffAt!) &&
      isStrictlyBeforeCutoff(row.intendedCutoffAt, args.cutoffAt!)
  );
  eligible.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  const snapshot = eligible[0];
  if (!snapshot) return empty;
  const projectedStat = projectedValue(snapshot.predictions, args.market);
  if (projectedStat == null) return { ...empty, reason: 'ARCHIVED_PROJECTION_MISSING_STAT' };

  const difference =
    args.requestedLine != null && Number.isFinite(args.requestedLine)
      ? round1(projectedStat - args.requestedLine)
      : null;

  return {
    status: 'AVAILABLE',
    reason: null,
    modelVersion: snapshot.modelVersion,
    generatedAt: snapshot.generatedAt,
    intendedCutoffAt: snapshot.intendedCutoffAt,
    projectedStat,
    requestedLine: args.requestedLine,
    difference,
  };
}
