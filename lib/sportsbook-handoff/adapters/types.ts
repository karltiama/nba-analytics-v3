import type { CanonicalBetSlip } from '@/lib/bet-slip/types';
import type {
  SportsbookEventHandoffInput,
  SportsbookHandoffCapability,
  SportsbookHandoffDestination,
  SportsbookHandoffProvider,
  SportsbookSelectionHandoffInput,
} from '../types';

export type SportsbookHandoffAdapter = {
  sportsbook: SportsbookHandoffProvider;
  capabilities: SportsbookHandoffCapability;
  buildSportsbookDestination: () => SportsbookHandoffDestination;
  buildEventDestination?: (
    input: SportsbookEventHandoffInput
  ) => SportsbookHandoffDestination | null;
  buildSelectionDestination?: (
    input: SportsbookSelectionHandoffInput
  ) => SportsbookHandoffDestination | null;
  buildSlipDestination?: (input: CanonicalBetSlip) => SportsbookHandoffDestination | null;
};
