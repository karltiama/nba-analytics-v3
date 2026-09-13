/** NBA.com CDN headshot used by dashboard strip and player research. */
export function nbaCdnHeadshotUrl(nbaPlayerId: string): string {
  return `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`;
}
