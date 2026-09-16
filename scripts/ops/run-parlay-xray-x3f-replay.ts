/**
 * Path A ($0) historical replay timings. No provider calls. No writes.
 *
 *   npx tsx scripts/ops/run-parlay-xray-x3f-replay.ts
 */
import { runHistoricalXrayReplay } from '@/lib/parlay-xray/e2e/run';
import { buildX3fConfirmedLegs, buildX3fReplayContext, buildX3fReplayDeps } from '@/lib/parlay-xray/e2e/fixture';

function main() {
  const nowMs = () => performance.now();
  const result = runHistoricalXrayReplay(buildX3fConfirmedLegs(), buildX3fReplayContext(), {
    ...buildX3fReplayDeps(),
    nowMs,
  });
  const payload = {
    path: 'A',
    providerCalls: 0,
    gameId: result.historicalReplay.gameId,
    dateLabel: result.historicalReplay.dateLabel,
    matchStatuses: result.matches.map((row) => row.status),
    reviewNeeded: result.parlayInterpretation.reviewNeeded.map((row) => row.flags),
    dataGaps: {
      wowy: result.parlayInterpretation.dataQuality.wowy.have,
      projection: result.parlayInterpretation.dataQuality.projection.have,
      availability: result.parlayInterpretation.dataQuality.availability.have,
    },
    timingsMs: {
      resolve: Number(result.timings.resolveMs.toFixed(2)),
      match: Number(result.timings.matchMs.toFixed(2)),
      context: Number(result.timings.contextMs.toFixed(2)),
      interpret: Number(result.timings.interpretMs.toFixed(2)),
      total: Number(result.timings.totalMs.toFixed(2)),
    },
    whyFailCount: result.parlayInterpretation.whyThisParlayCouldFail.length,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main();
