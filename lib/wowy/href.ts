/** Link into the WOWY explorer: subject's stats with and without one teammate. Client-safe (no db). */
export function wowyHref(args: { subjectId: string; teammateId: string; season: string; teamId: string }): string {
  const sp = new URLSearchParams({ subject: args.subjectId, teammate: args.teammateId, season: args.season, teamId: args.teamId });
  return `/wowy?${sp.toString()}`;
}
