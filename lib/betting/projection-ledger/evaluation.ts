/**
 * Pure evaluation math for the Performance Check view.
 * Missing market or closing data stays null. It is never coerced to zero.
 * Market comparison is not marked official: stale-line policy is undecided.
 */

export interface EvaluationInput {
  projectionValue: number;
  actual: number | null;
  resolution: string;
  publishLine: number | null;
  closeLine: number | null;
  side: 'over' | 'under' | null;
  publishSportsbook: string | null;
  closeSportsbook: string | null;
}

export interface EvaluationMetrics {
  absoluteError: number | null;
  signedError: number | null;
  projectionMinusPublishLine: number | null;
  lineMovement: number | null;
  movementDirection: 'toward_projection' | 'away_from_projection' | 'unchanged' | null;
  sideResult: 'beat' | 'miss' | 'push' | null;
  clvLineDelta: number | null;
  officialMarketComparison: false;
}

/** Mirrors analytics.v_projection_performance. A moved tip drops the row. */
export function passesAuthoritativeEvaluation(args: {
  provenanceType: string;
  timingStatus: string;
  snapshotRevision: number;
  generatedAt: string;
  storedGameTipTime: string;
  currentGameStartTime: string;
  captureEligibleAtWrite: boolean;
}): boolean {
  const generated = Date.parse(args.generatedAt);
  const storedTip = Date.parse(args.storedGameTipTime);
  const currentTip = Date.parse(args.currentGameStartTime);
  if (![generated, storedTip, currentTip].every(Number.isFinite)) return false;
  return (
    args.provenanceType === 'PROSPECTIVE_LIVE' &&
    args.timingStatus === 'ON_TIME' &&
    args.snapshotRevision === 1 &&
    args.captureEligibleAtWrite &&
    generated < storedTip &&
    generated < currentTip &&
    storedTip === currentTip
  );
}

export function evaluateProjectionRow(input: EvaluationInput): EvaluationMetrics {
  const played = input.resolution === 'PLAYED' && input.actual != null && Number.isFinite(input.actual);
  const absoluteError = played ? Math.abs(input.actual! - input.projectionValue) : null;
  const signedError = played ? input.actual! - input.projectionValue : null;

  const sameBook =
    input.publishSportsbook != null &&
    input.closeSportsbook != null &&
    input.publishSportsbook === input.closeSportsbook;
  const hasPublish = input.publishLine != null && Number.isFinite(input.publishLine);
  const hasClose = sameBook && input.closeLine != null && Number.isFinite(input.closeLine);

  const projectionMinusPublishLine = hasPublish ? input.projectionValue - input.publishLine! : null;
  const lineMovement = hasPublish && hasClose ? input.closeLine! - input.publishLine! : null;
  const clvLineDelta = hasPublish && hasClose ? input.publishLine! - input.closeLine! : null;

  let movementDirection: EvaluationMetrics['movementDirection'] = null;
  if (lineMovement != null && projectionMinusPublishLine != null) {
    if (lineMovement === 0) movementDirection = 'unchanged';
    else if (Math.sign(lineMovement) === Math.sign(projectionMinusPublishLine) && projectionMinusPublishLine !== 0) {
      movementDirection = 'toward_projection';
    } else if (projectionMinusPublishLine === 0) movementDirection = null;
    else movementDirection = 'away_from_projection';
  }

  let sideResult: EvaluationMetrics['sideResult'] = null;
  if (played && hasPublish && input.side) {
    if (input.actual === input.publishLine) sideResult = 'push';
    else if (input.side === 'over') sideResult = input.actual! > input.publishLine! ? 'beat' : 'miss';
    else sideResult = input.actual! < input.publishLine! ? 'beat' : 'miss';
  }

  return {
    absoluteError,
    signedError,
    projectionMinusPublishLine,
    lineMovement,
    movementDirection,
    sideResult,
    clvLineDelta,
    officialMarketComparison: false,
  };
}
