import { runCanonicalX3fReplay } from '@/lib/parlay-xray/e2e/preview';

const result = runCanonicalX3fReplay();
const observed = {
  identityLayers: result.identityLayers,
  matches: result.matches.map((m) => ({
    player: m.input.playerDisplayName,
    market: m.input.market,
    line: m.requestedLine,
    status: m.status,
    reason: m.reason,
    lineQuality: m.lineQuality,
    book: m.matchedVendor,
    threeHour: m.reference.line,
    close: m.comparison.line,
  })),
  interpretationStates: result.interpretations.map((row) => ({
    player: row.identity.playerDisplayName,
    market: row.identity.market,
    line: row.identity.line,
    summaryState: row.summaryState,
    why: row.whyItCouldFail.map((item) => item.detail),
    uncertainties: row.uncertainties.map((item) => item.code),
  })),
  parlay: {
    summaryState: result.parlayInterpretation.summaryState,
    summarySentence: result.parlayInterpretation.summarySentence,
    groups: result.parlayInterpretation.dependencyGroups.map((g) => ({
      kind: g.kind,
      detail: g.detail,
      legs: g.legIndexes,
    })),
    whyFail: result.parlayInterpretation.whyThisParlayCouldFail.map((row) => ({
      code: row.code,
      detail: row.detail,
    })),
    reviewNeeded: result.parlayInterpretation.reviewNeeded,
  },
};
process.stdout.write(`${JSON.stringify(observed, null, 2)}\n`);
