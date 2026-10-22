/** True only when the app explicitly marks collection paused. A missing DATA_MODE is not this flag. */
export function isPropsCollectionPaused(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.OFFSEASON_MODE === '1';
}

export function propsExplorerEmptyCopy(input: {
  collectorPaused?: boolean;
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
  if (input.collectorPaused) {
    return {
      title,
      detail: 'Player-props collection is paused by the offseason freeze.',
    };
  }
  return {
    title,
    detail: `No stored prop observations were found for ${input.dateLabel} yet.`,
  };
}
