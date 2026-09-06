export function propsExplorerEmptyCopy(input: {
  frozen: boolean;
  dateLabel: string;
}): { title: string; detail: string } {
  const title = `No prop data is available for ${input.dateLabel}.`;
  const detail = input.frozen
    ? 'Live markets are not currently being refreshed during the offseason freeze. Filters and EV controls do not imply that rows exist for this date.'
    : 'There are no player-prop rows for this date. Adjust the date if you are looking for a different slate.';
  return { title, detail };
}
