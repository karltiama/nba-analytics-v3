/**
 * Keeps the teammate control, pair query, and rendered summary on the same id.
 * Does not change WITH/WITHOUT classification.
 */

export function resolveWowyExplorerSelection(args: {
  requestedTeammateId: string | null | undefined;
  teammateIds: string[];
  contextLoaded: boolean;
}): {
  readyToFetchPair: boolean;
  teammateIdForPair: string | null;
  visibleTeammateId: string | null;
  clearRequested: boolean;
} {
  const requested = args.requestedTeammateId?.trim() || null;
  if (!requested) {
    return {
      readyToFetchPair: true,
      teammateIdForPair: null,
      visibleTeammateId: null,
      clearRequested: false,
    };
  }
  if (!args.contextLoaded) {
    return {
      readyToFetchPair: false,
      teammateIdForPair: requested,
      visibleTeammateId: null,
      clearRequested: false,
    };
  }
  if (!args.teammateIds.includes(requested)) {
    return {
      readyToFetchPair: true,
      teammateIdForPair: null,
      visibleTeammateId: null,
      clearRequested: true,
    };
  }
  return {
    readyToFetchPair: true,
    teammateIdForPair: requested,
    visibleTeammateId: requested,
    clearRequested: false,
  };
}

export function wowySummaryMatchesSelection(
  summary: { query: { teammatePlayerId?: string | null }; mode: string },
  teammateIdForPair: string | null
): boolean {
  const loaded = summary.query.teammatePlayerId ?? null;
  const expected = teammateIdForPair || null;
  if (loaded !== expected) return false;
  if (expected) return summary.mode === 'teammate';
  return summary.mode === 'subject';
}

export function formatWowyTeammatePickerLabel(option: {
  fullName: string;
  togetherPlayedGames: number;
  verifiedDnpGames: number;
}): string {
  return `${option.fullName} · ${option.togetherPlayedGames} with · ${option.verifiedDnpGames} verified DNP`;
}
