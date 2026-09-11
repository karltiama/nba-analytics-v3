/**
 * Plays / Timeline identity (13R.3).
 *
 * Timeline chronology is independent of a serving analytics.players link.
 * Unresolved participant identity must not fabricate a player_id and must
 * not automatically invalidate the Plays object.
 */

export const TIMELINE_IDENTITY_FALLBACK = {
  chronologyValidWithoutServingLink: true,
  servingLink: 'omit' as const,
  displayName: 'provider_or_omitted' as const,
  publicPlayerHref: null,
  note:
    'UI may show the event clock/order/score without a player page link. Do not substitute a canonical entity id in /players/... URLs.',
};

export { playParticipantServingLink } from './ingest-identity-gate';
