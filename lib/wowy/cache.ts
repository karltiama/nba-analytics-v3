import {
  WOWY_CALCULATION_VERSION,
  WOWY_DATA_VERSION,
  type WowyPairQuery,
} from './types';

export function wowyCacheKey(query: WowyPairQuery): string {
  return [
    'wowy',
    WOWY_CALCULATION_VERSION,
    WOWY_DATA_VERSION,
    query.subjectPlayerId,
    query.teammatePlayerId,
    query.teamId,
    query.season,
    query.seasonType,
    query.dateFrom ?? '',
    query.dateTo ?? '',
    query.cutoffStartTime ?? '',
  ].join('|');
}

export const WOWY_CACHE_REVALIDATE_SECONDS = 3600;
