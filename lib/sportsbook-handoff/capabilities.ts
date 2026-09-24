/**
 * Static capability matrix for sportsbook handoff.
 * Deeper levels remain unavailable / partner_only until verified integrations exist.
 */

import type {
  SportsbookHandoffCapability,
  SportsbookHandoffProvider,
} from './types';
import { SPORTSBOOK_HANDOFF_PROVIDERS } from './types';

const HOMEPAGE_ONLY_NOTES = [
  'Phase 3 ships verified sportsbook homepage only.',
  'Do not claim selections are loaded into the sportsbook.',
] as const;

function homepageOnlyCapability(
  sportsbook: SportsbookHandoffProvider,
  extras?: Partial<SportsbookHandoffCapability>
): SportsbookHandoffCapability {
  return {
    sportsbook,
    openSportsbook: 'confirmed',
    openEvent: 'unavailable',
    openMarket: 'unavailable',
    preloadSingleSelection: 'unavailable',
    preloadMultipleSelections: 'unavailable',
    preloadSameGameParlay: 'unavailable',
    requiresAffiliateRelationship: false,
    notes: HOMEPAGE_ONLY_NOTES,
    ...extras,
  };
}

export const SPORTSBOOK_HANDOFF_CAPABILITIES: Record<
  SportsbookHandoffProvider,
  SportsbookHandoffCapability
> = {
  draftkings: homepageOnlyCapability('draftkings'),
  fanduel: homepageOnlyCapability('fanduel'),
  caesars: homepageOnlyCapability('caesars', {
    notes: [
      ...HOMEPAGE_ONLY_NOTES,
      'Observed selectionId URL patterns are undocumented for Court Context — not implemented.',
    ],
  }),
  fanatics: homepageOnlyCapability('fanatics', {
    notes: [
      ...HOMEPAGE_ONLY_NOTES,
      'Fanatics Copy Bet is first-party only; Court Context has no verified third-party format.',
    ],
  }),
  betmgm: homepageOnlyCapability('betmgm', {
    openEvent: 'partner_only',
    openMarket: 'partner_only',
    preloadSingleSelection: 'partner_only',
    preloadMultipleSelections: 'partner_only',
    preloadSameGameParlay: 'partner_only',
    requiresAffiliateRelationship: true,
    notes: [
      ...HOMEPAGE_ONLY_NOTES,
      'BetMGM deep links require partner Sports API IDs and affiliate wm — not activated.',
    ],
  }),
};

export function listHandoffProviders(): readonly SportsbookHandoffProvider[] {
  return SPORTSBOOK_HANDOFF_PROVIDERS;
}

export function getHandoffCapability(
  sportsbook: SportsbookHandoffProvider
): SportsbookHandoffCapability {
  return SPORTSBOOK_HANDOFF_CAPABILITIES[sportsbook];
}

export function isSportsbookHandoffProvider(
  value: string
): value is SportsbookHandoffProvider {
  return (SPORTSBOOK_HANDOFF_PROVIDERS as readonly string[]).includes(value);
}
