export function propsExplorerEmptyCopy(input: {
  frozen: boolean;
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
      title: 'No stored prop observations for this game.',
      detail:
        input.marketContext === 'historical'
          ? 'No archived closing lines were materialized for this game. This is not a live sportsbook board.'
          : 'Props Explorer only shows lines already collected for this game. It does not request a new price.',
    };
  }
  const title = `No prop data is available for ${input.dateLabel}.`;
  if (input.marketContext === 'historical') {
    return {
      title,
      detail:
        'No archived closing lines were materialized for this date. This is not a live sportsbook board, and filters do not pull lines from another date.',
    };
  }
  const detail = input.frozen
    ? 'Live markets are not currently being refreshed during the offseason freeze. Filters and EV controls do not imply that rows exist for this date.'
    : 'There are no player-prop rows for this date. Adjust the date if you are looking for a different slate.';
  return { title, detail };
}
