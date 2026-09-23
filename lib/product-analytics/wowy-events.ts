/**
 * WOWY control changes. Closed filter values only.
 * Never send player names, player ids, team ids, or the search box text.
 *
 * Opening /wowy is an automatic Umami pageview. There is no separate wowy_opened event.
 */

import {
  PRODUCT_EVENTS,
  type WowyFilterChangedProperties,
} from '@/lib/product-analytics/track-event';

export const WOWY_FILTER_CHANGED = PRODUCT_EVENTS.WOWY_FILTER_CHANGED;

const WOWY_SEASONS = ['2023', '2024', '2025'] as const;

export function wowySeasonFilterProperties(season: string): WowyFilterChangedProperties | null {
  if (!(WOWY_SEASONS as readonly string[]).includes(season)) return null;
  return { surface: 'wowy', filter: 'season', value: season as '2023' | '2024' | '2025' };
}

export function wowyTeamStintFilterProperties(): WowyFilterChangedProperties {
  return { surface: 'wowy', filter: 'team_stint' };
}

export function wowySeasonTypeFilterProperties(
  seasonType: string
): WowyFilterChangedProperties | null {
  if (seasonType !== 'regular' && seasonType !== 'playoffs') return null;
  return { surface: 'wowy', filter: 'season_type', value: seasonType };
}

export function wowyTeammateFilterProperties(selected: boolean): WowyFilterChangedProperties {
  return { surface: 'wowy', filter: 'teammate', value: selected ? 'selected' : 'cleared' };
}

export function wowyStatViewFilterProperties(
  view: 'perGame' | 'perMinute'
): WowyFilterChangedProperties {
  return {
    surface: 'wowy',
    filter: 'stat_view',
    value: view === 'perMinute' ? 'per_minute' : 'per_game',
  };
}

export function wowyResultSplitFilterProperties(
  split: 'with' | 'without'
): WowyFilterChangedProperties {
  return { surface: 'wowy', filter: 'result_split', value: split };
}
