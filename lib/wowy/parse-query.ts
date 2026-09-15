import type { WowyPairQuery, WowySeasonType } from './types';

const SEASON_TYPES = new Set(['regular', 'playoffs', 'all']);

export function parseWowyPairQuery(sp: URLSearchParams): { ok: true; query: WowyPairQuery } | { ok: false; error: string } {
  const subjectPlayerId = sp.get('subjectPlayerId')?.trim() || '';
  const teammatePlayerId = sp.get('teammatePlayerId')?.trim() || '';
  const season = sp.get('season')?.trim() || '';
  const teamId = sp.get('teamId')?.trim() || '';
  const seasonTypeRaw = (sp.get('seasonType')?.trim() || 'regular') as WowySeasonType | 'all';

  if (!subjectPlayerId || !teammatePlayerId || !season || !teamId) {
    return {
      ok: false,
      error: 'subjectPlayerId, teammatePlayerId, season, and teamId are required.',
    };
  }
  if (!/^\d{4}$/.test(season)) {
    return { ok: false, error: 'season must be an analytics start-year such as 2024.' };
  }
  if (!SEASON_TYPES.has(seasonTypeRaw)) {
    return { ok: false, error: 'seasonType must be regular, playoffs, or all.' };
  }

  const dateFrom = sp.get('dateFrom')?.trim() || null;
  const dateTo = sp.get('dateTo')?.trim() || null;
  const cutoffStartTime = sp.get('cutoffStartTime')?.trim() || null;
  if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    return { ok: false, error: 'dateFrom must be YYYY-MM-DD.' };
  }
  if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return { ok: false, error: 'dateTo must be YYYY-MM-DD.' };
  }

  return {
    ok: true,
    query: {
      subjectPlayerId,
      teammatePlayerId,
      season,
      teamId,
      seasonType: seasonTypeRaw,
      dateFrom,
      dateTo,
      cutoffStartTime,
    },
  };
}
