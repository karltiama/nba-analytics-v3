/**
 * Compare repeated observations of the same conceptual selection for SID/link stability.
 */

import { maskUrlShape } from './link-validity';
import type { SidStabilityPair } from './types';
import type { SportsbookHandoffProvider } from '@/lib/sportsbook-handoff/types';
import type { CertMarketKey } from './types';

export type StabilitySample = {
  eventSid: string | null;
  marketSid: string | null;
  selectionSid: string | null;
  oddsAmerican: number;
  line: number;
  deeplink: string | null;
  at: string;
};

export function buildSidStabilityPair(input: {
  sportsbook: SportsbookHandoffProvider;
  marketKey: CertMarketKey;
  playerName: string;
  side: 'over' | 'under';
  line: number;
  sampleA: StabilitySample;
  sampleB: StabilitySample;
}): SidStabilityPair {
  const shapeA = input.sampleA.deeplink
    ? maskUrlShape(input.sampleA.deeplink) ?? input.sampleA.deeplink
    : null;
  const shapeB = input.sampleB.deeplink
    ? maskUrlShape(input.sampleB.deeplink) ?? input.sampleB.deeplink
    : null;

  return {
    sportsbook: input.sportsbook,
    marketKey: input.marketKey,
    playerName: input.playerName,
    side: input.side,
    line: input.line,
    sampleA: {
      eventSid: input.sampleA.eventSid,
      marketSid: input.sampleA.marketSid,
      selectionSid: input.sampleA.selectionSid,
      oddsAmerican: input.sampleA.oddsAmerican,
      deeplinkShape: shapeA,
      at: input.sampleA.at,
    },
    sampleB: {
      eventSid: input.sampleB.eventSid,
      marketSid: input.sampleB.marketSid,
      selectionSid: input.sampleB.selectionSid,
      oddsAmerican: input.sampleB.oddsAmerican,
      deeplinkShape: shapeB,
      at: input.sampleB.at,
    },
    sameSelectionSid: input.sampleA.selectionSid === input.sampleB.selectionSid,
    sameEventSid: input.sampleA.eventSid === input.sampleB.eventSid,
    sameMarketSid: input.sampleA.marketSid === input.sampleB.marketSid,
    sameDeeplinkShape: shapeA === shapeB,
    oddsChanged: input.sampleA.oddsAmerican !== input.sampleB.oddsAmerican,
    lineChanged: input.sampleA.line !== input.sampleB.line,
  };
}
