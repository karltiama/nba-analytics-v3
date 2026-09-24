/**
 * Safe handoff resolver.
 * Hierarchy: betslip → selection → market → event → sportsbook.
 * Phase 3: deeper builders return null → always lands on verified homepage.
 */

import { assertHandoffDestinationUrl } from './allowlist';
import { getSportsbookHandoffAdapter } from './adapters';
import type {
  ResolveSportsbookHandoffInput,
  ResolveSportsbookHandoffResult,
  SportsbookHandoffLevel,
} from './types';

const DEPTH_ORDER: SportsbookHandoffLevel[] = [
  'betslip',
  'selection',
  'market',
  'event',
  'sportsbook',
];

function preferredRequestedLevel(input: ResolveSportsbookHandoffInput): SportsbookHandoffLevel {
  if (input.slip) return 'betslip';
  if (input.selection) return 'selection';
  if (input.event) return 'event';
  return 'sportsbook';
}

export function resolveSportsbookHandoff(
  input: ResolveSportsbookHandoffInput
): ResolveSportsbookHandoffResult {
  const adapter = getSportsbookHandoffAdapter(input.sportsbook);
  const requestedLevel = preferredRequestedLevel(input);

  for (const level of DEPTH_ORDER) {
    let candidate = null as ReturnType<typeof adapter.buildSportsbookDestination> | null;

    if (level === 'betslip' && input.slip && adapter.buildSlipDestination) {
      candidate = adapter.buildSlipDestination(input.slip);
    } else if (level === 'selection' && input.selection && adapter.buildSelectionDestination) {
      candidate = adapter.buildSelectionDestination(input.selection);
    } else if (level === 'event' && input.event && adapter.buildEventDestination) {
      candidate = adapter.buildEventDestination(input.event);
    } else if (level === 'sportsbook') {
      candidate = adapter.buildSportsbookDestination();
    }

    if (!candidate) continue;

    const asserted = assertHandoffDestinationUrl(candidate.url);
    if (!asserted.ok) {
      throw new Error(
        `Handoff destination rejected for ${input.sportsbook}: ${asserted.reason}`
      );
    }

    // Phase 3: adapters must not claim deeper levels than sportsbook.
    if (candidate.level !== 'sportsbook') {
      throw new Error(
        `Unsupported handoff level "${candidate.level}" for ${input.sportsbook} in Phase 3`
      );
    }

    return {
      ...candidate,
      url: asserted.url.toString(),
      requestedLevel,
    };
  }

  throw new Error(`No handoff destination available for ${input.sportsbook}`);
}

export function openSportsbookLabel(sportsbook: ResolveSportsbookHandoffInput['sportsbook']): string {
  const labels = {
    draftkings: 'Open DraftKings',
    fanduel: 'Open FanDuel',
    caesars: 'Open Caesars',
    fanatics: 'Open Fanatics',
    betmgm: 'Open BetMGM',
  } as const;
  return labels[sportsbook];
}
