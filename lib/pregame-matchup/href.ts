const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar YYYY-MM-DD, or null when the query value is missing or not a real date. */
export function parseSlateDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const m = YMD.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Provider game ids on the scoreboard are numeric BDL ids. */
export function isScoreboardGameId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{1,12}$/.test(value);
}

export function scoreboardMatchupHref(gameId: string, slateDate?: string | null): string {
  const id = encodeURIComponent(gameId.trim());
  const date = parseSlateDate(slateDate);
  return date ? `/scoreboard/games/${id}?date=${date}` : `/scoreboard/games/${id}`;
}

export function dashboardReturnHref(slateDate?: string | null): string {
  const date = parseSlateDate(slateDate);
  return date ? `/dashboard?date=${date}` : '/dashboard';
}
