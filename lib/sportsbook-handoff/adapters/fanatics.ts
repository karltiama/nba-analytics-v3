import { getHandoffCapability } from '../capabilities';
import { getVerifiedSportsbookHomeUrl } from '../allowlist';
import type { SportsbookHandoffDestination } from '../types';
import type { SportsbookHandoffAdapter } from './types';

function homepageAdapter(
  sportsbook: SportsbookHandoffAdapter['sportsbook']
): SportsbookHandoffAdapter {
  return {
    sportsbook,
    capabilities: getHandoffCapability(sportsbook),
    buildSportsbookDestination(): SportsbookHandoffDestination {
      return {
        sportsbook,
        url: getVerifiedSportsbookHomeUrl(sportsbook),
        level: 'sportsbook',
        verified: true,
      };
    },
    buildEventDestination: () => null,
    buildSelectionDestination: () => null,
    buildSlipDestination: () => null,
  };
}

export const fanaticsHandoffAdapter = homepageAdapter('fanatics');
