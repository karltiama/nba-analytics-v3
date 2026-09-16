/**
 * Pregame injury → game join. Ambiguous or missing slate stays unknown.
 * Does not infer Available or rewrite provider status.
 */
import {
  uniqueGameForTeamEtDate,
  type TeamGameRef,
} from '@/lib/wowy/known-out-association';

export const GAME_LINK_PROVENANCE = [
  'none',
  'scheduled_slate_join',
  'provider_game_id',
  'inferred_team_date',
] as const;

export type GameLinkProvenance = (typeof GAME_LINK_PROVENANCE)[number];

export type InjuryGameAssociation = {
  gameId: string | null;
  provenance: GameLinkProvenance;
  unknownReason: string | null;
};

export function associateInjuryToGame(args: {
  teamId: string | null;
  observedAt: string;
  slate: TeamGameRef[];
  providerGameId?: string | null;
}): InjuryGameAssociation {
  if (args.providerGameId) {
    return {
      gameId: args.providerGameId,
      provenance: 'provider_game_id',
      unknownReason: null,
    };
  }
  if (!args.teamId) {
    return { gameId: null, provenance: 'none', unknownReason: 'missing_team_id' };
  }
  const uniq = uniqueGameForTeamEtDate(args.slate, args.teamId, args.observedAt);
  if ('gameId' in uniq) {
    return { gameId: uniq.gameId, provenance: 'scheduled_slate_join', unknownReason: null };
  }
  if ('ambiguous' in uniq && uniq.ambiguous) {
    return {
      gameId: null,
      provenance: 'none',
      unknownReason: `ambiguous_team_et_date:${uniq.count}`,
    };
  }
  return { gameId: null, provenance: 'none', unknownReason: 'no_matching_team_et_date' };
}
