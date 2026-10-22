/** URL update that drops only the game filter. Date and other filters stay. */
export function clearSelectedGameUpdates(): { game_id: null; offset: '0' } {
  return { game_id: null, offset: '0' };
}

export function selectedGameDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
