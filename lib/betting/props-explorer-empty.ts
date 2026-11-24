export function propsExplorerEmptyCopy(input: {
  dateLabel: string;
  marketContext?: 'live' | 'historical';
  gameSelected?: boolean;
  gameUnknown?: boolean;
}): { title: string; detail: string } {
  if (input.gameUnknown) {
    return {
      title: 'This game was not found.',
      detail: 'That game id is not on the schedule. Props from other games are not shown.',
    };
  }
  if (input.gameSelected) {
    return {
      title: 'No stored prop observations for this game yet.',
      detail:
        input.marketContext === 'historical'
          ? 'No stored prop observations were found for this game. This is not a live sportsbook board.'
          : 'Props Explorer only shows lines already collected for this game. It does not request a new price.',
    };
  }
  const title = 'No stored prop observations for this date yet.';
  if (input.marketContext === 'historical') {
    return {
      title,
      detail: `No stored prop observations were found for ${input.dateLabel}. This is not a live sportsbook board.`,
    };
  }
  return {
    title,
    detail: `No stored prop observations were found for ${input.dateLabel} yet.`,
  };
}

export type HistoricalUnavailableInput = {
  gameId: string;
  reason: string;
};

export type HistoricalAvailabilityNotice = {
  title: string;
  games: Array<{ gameId: string; label: string; text: string }>;
};

export type HistoricalAvailabilityView =
  | { kind: 'rows'; notice: HistoricalAvailabilityNotice | null; countLabel: null }
  | {
      kind: 'unavailable';
      title: string;
      detail: string;
      notice: HistoricalAvailabilityNotice;
      countLabel: string;
    }
  | {
      kind: 'empty';
      title: string;
      detail: string;
      notice: HistoricalAvailabilityNotice | null;
      countLabel: null;
    };

const REASON_COPY: Record<string, string> = {
  missing: 'Its closing record is not available yet. That is not a finding that no props were offered.',
  invalid_checksum: 'Its closing record could not be verified. That is not a finding that no props were offered.',
  incomplete: 'Its closing coverage is incomplete, so its props are withheld.',
  missing_archive: 'Part of its closing evidence is not available, so its props are withheld.',
  unverifiable: 'Its closing evidence could not be fully checked, so its props are withheld.',
  not_final: 'It is not final, so a closing line is not available.',
  duplicate: 'Its closing record is inconsistent, so its props are withheld.',
  identity: 'Its closing record does not match this game, so its props are withheld.',
  invalid_game: 'This game could not be identified, so its props are withheld.',
  unconfigured: 'Closing records are not available from this server, so its props are withheld.',
};

export function historicalUnavailableText(reason: string): string {
  return REASON_COPY[reason] ?? 'Its closing evidence could not be verified, so its props are withheld.';
}

function noticeFor(
  games: readonly HistoricalUnavailableInput[],
  gameLabel: (gameId: string) => string
): HistoricalAvailabilityNotice {
  return {
    title: 'Some games do not have verified closing evidence.',
    games: games.map((game) => ({
      gameId: game.gameId,
      label: gameLabel(game.gameId),
      text: historicalUnavailableText(game.reason),
    })),
  };
}

/**
 * Past-date presentation. Unavailable evidence stays separate from a real empty filter.
 * Live dates and responses without unavailableGames keep the existing empty copy.
 */
export function historicalAvailabilityView(input: {
  marketContext: 'live' | 'historical';
  rowCount: number;
  totalMatching: number;
  unavailableGames?: readonly HistoricalUnavailableInput[] | null;
  filtersActive: boolean;
  dateLabel: string;
  gameSelected: boolean;
  gameUnknown: boolean;
  gameLabel?: (gameId: string) => string;
}): HistoricalAvailabilityView {
  const label = input.gameLabel ?? ((gameId: string) => `Game ${gameId}`);
  const unavailable = input.marketContext === 'historical' ? (input.unavailableGames ?? []) : [];
  const empty = propsExplorerEmptyCopy({
    dateLabel: input.dateLabel,
    marketContext: input.marketContext,
    gameSelected: input.gameSelected,
    gameUnknown: input.gameUnknown,
  });
  if (input.gameUnknown || input.marketContext !== 'historical' || unavailable.length === 0) {
    if (input.rowCount > 0) return { kind: 'rows', notice: null, countLabel: null };
    return { kind: 'empty', title: empty.title, detail: empty.detail, notice: null, countLabel: null };
  }
  const notice = noticeFor(unavailable, label);
  if (input.rowCount > 0) {
    return { kind: 'rows', notice, countLabel: null };
  }
  if (input.totalMatching > 0) {
    return { kind: 'empty', title: empty.title, detail: empty.detail, notice, countLabel: null };
  }
  return {
    kind: 'unavailable',
    title: 'Historical closing evidence is unavailable.',
    detail: 'These games are withheld because their closing records could not be verified. This is not a finding that no props were offered.',
    notice: { ...notice, title: 'These games were withheld.' },
    countLabel: 'Historical data unavailable',
  };
}
