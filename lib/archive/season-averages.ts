/**
 * GOAT Season Averages characterization plan (Step 9B).
 * Player: GET /nba/v1/season_averages/{category}
 * Team:   GET /nba/v1/team_season_averages/{category}
 *
 * Distinct from legacy /v1/season_averages?player_id=&season= (box-score averages).
 * Characterization prefixes only. No canonical archive. No Postgres table.
 */

export const PLAYER_SEASON_AVERAGES_PATH = '/nba/v1/season_averages';
export const TEAM_SEASON_AVERAGES_PATH = '/nba/v1/team_season_averages';

export const SEASON_AVERAGES_CHAR_PREFIX =
  'raw/source=balldontlie/league=nba/entity=season_averages/_characterization';
export const TEAM_SEASON_AVERAGES_CHAR_PREFIX =
  'raw/source=balldontlie/league=nba/entity=team_season_averages/_characterization';

export const SEASON_AVERAGES_MAX_PAGES_PER_PROBE = 2;
export const SEASON_AVERAGES_MAX_PROBES = 18;
export const SEASON_AVERAGES_MAX_MS = 10 * 60 * 1000;

/** Known 2025 players already in logs / Advanced / lineups / props research. */
export const SAMPLE_PLAYERS = [
  { playerId: '175', name: 'Shai Gilgeous-Alexander', role: 'high-usage primary creator' },
  { playerId: '246', name: 'Nikola Jokic', role: 'big / roll man' },
  { playerId: '73', name: 'Jalen Brunson', role: 'guard with drive/passing volume' },
  { playerId: '140', name: 'Kevin Durant', role: 'wing / spot-up / isolation scorer' },
  { playerId: '3547249', name: 'Precious Achiuwa', role: 'bench / low-usage forward' },
] as const;

export const SAMPLE_TEAMS = [
  { teamId: '21', abbr: 'OKC', profile: 'elite defense / high win% ' },
  { teamId: '8', abbr: 'DEN', profile: 'top offensive rating' },
  { teamId: '29', abbr: 'UTA', profile: 'poor defense / high pace' },
  { teamId: '3', abbr: 'BKN', profile: 'lowest offensive rating' },
] as const;

export type SeasonAveragesKind = 'player' | 'team';

export type SeasonAveragesProbe = {
  id: string;
  kind: SeasonAveragesKind;
  season: 2024 | 2025;
  seasonType: 'regular';
  category: string;
  type: string | null;
  purpose: string;
};

/**
 * Frozen 16-probe list. Do not expand after results.
 * 16 × 13s ≈ 3.5 minutes (under 10 minutes).
 */
export const FROZEN_SEASON_AVERAGES_PROBES: SeasonAveragesProbe[] = [
  {
    id: 'P01',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'playtype',
    type: 'isolation',
    purpose: 'role / offensive style',
  },
  {
    id: 'P02',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'playtype',
    type: 'prballhandler',
    purpose: 'role / offensive style (P&R ballhandler)',
  },
  {
    id: 'P03',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'playtype',
    type: 'prrollman',
    purpose: 'role / offensive style (P&R roll man)',
  },
  {
    id: 'P04',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'tracking',
    type: 'drives',
    purpose: 'tracking drives',
  },
  {
    id: 'P05',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'tracking',
    type: 'passing',
    purpose: 'tracking passing',
  },
  {
    id: 'P06',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'shooting',
    type: 'by_zone',
    purpose: 'shot-zone profile',
  },
  {
    id: 'P07',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'shotdashboard',
    type: 'overall',
    purpose: 'shot dashboard baseline',
  },
  {
    id: 'P08',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'hustle',
    type: null,
    purpose: 'hustle (no type)',
  },
  {
    id: 'P09',
    kind: 'player',
    season: 2025,
    seasonType: 'regular',
    category: 'general',
    type: 'advanced',
    purpose: 'overlap baseline vs Advanced Stats',
  },
  {
    id: 'P10',
    kind: 'player',
    season: 2024,
    seasonType: 'regular',
    category: 'playtype',
    type: 'isolation',
    purpose: 'historical consistency vs 2025 playtype',
  },
  {
    id: 'P11',
    kind: 'player',
    season: 2024,
    seasonType: 'regular',
    category: 'tracking',
    type: 'drives',
    purpose: 'historical consistency vs 2025 tracking',
  },
  {
    id: 'P12',
    kind: 'player',
    season: 2024,
    seasonType: 'regular',
    category: 'shooting',
    type: 'by_zone',
    purpose: 'historical consistency vs 2025 shooting',
  },
  {
    id: 'T01',
    kind: 'team',
    season: 2025,
    seasonType: 'regular',
    category: 'playtype',
    type: 'isolation',
    purpose: 'team play style',
  },
  {
    id: 'T02',
    kind: 'team',
    season: 2025,
    seasonType: 'regular',
    category: 'tracking',
    type: 'possessions',
    purpose: 'team tracking / pace-style',
  },
  {
    id: 'T03',
    kind: 'team',
    season: 2025,
    seasonType: 'regular',
    category: 'shooting',
    type: 'by_zone_opponent',
    purpose: 'matchup opponent zone profile',
  },
  {
    id: 'T04',
    kind: 'team',
    season: 2025,
    seasonType: 'regular',
    category: 'general',
    type: 'advanced',
    purpose: 'team advanced overlap vs existing team averages',
  },
];

export function seasonAveragesPath(probe: SeasonAveragesProbe): string {
  const base = probe.kind === 'player' ? PLAYER_SEASON_AVERAGES_PATH : TEAM_SEASON_AVERAGES_PATH;
  return `${base}/${probe.category}`;
}

export function seasonAveragesCharKey(probe: SeasonAveragesProbe): string {
  const prefix = probe.kind === 'player' ? SEASON_AVERAGES_CHAR_PREFIX : TEAM_SEASON_AVERAGES_CHAR_PREFIX;
  const typePart = probe.type ?? 'none';
  return `${prefix}/season=${probe.season}/season_type=${probe.seasonType}/category=${probe.category}/type=${typePart}.json`;
}

/** Step 9C targeted canonical archive. Separate from `_characterization`. */
export const SEASON_AVERAGES_TARGET_SEASONS = [2023, 2024, 2025] as const;
export const SEASON_AVERAGES_SEASON_TYPE = 'regular' as const;
export const SEASON_AVERAGES_PLAYER_BATCH_SIZE = 100;
export const SEASON_AVERAGES_MAX_PAGES_PER_BATCH = 3;
export const SEASON_AVERAGES_MAX_PROVIDER_MS = 90 * 60 * 1000;

export const PLAYER_SEASON_AVERAGES_CANONICAL_PREFIX =
  'raw/source=balldontlie/league=nba/entity=season_averages';
export const TEAM_SEASON_AVERAGES_CANONICAL_PREFIX =
  'raw/source=balldontlie/league=nba/entity=team_season_averages';

/**
 * Allowlist = Step 9B combinations that were actually characterized and rated
 * unique. Untested estimate types (spotup, transition, catchshoot, pullupshot,
 * player possessions, team by_zone_base, extra team playtypes) are excluded.
 */
export const TARGETED_PLAYER_ALLOWLIST = [
  { category: 'playtype', type: 'isolation' },
  { category: 'playtype', type: 'prballhandler' },
  { category: 'playtype', type: 'prrollman' },
  { category: 'tracking', type: 'drives' },
  { category: 'tracking', type: 'passing' },
  { category: 'shooting', type: 'by_zone' },
] as const;

export const TARGETED_TEAM_ALLOWLIST = [
  { category: 'playtype', type: 'isolation' },
  { category: 'tracking', type: 'possessions' },
  { category: 'shooting', type: 'by_zone_opponent' },
] as const;

export const TARGETED_SEASON_AVERAGES_EXCLUSIONS = [
  'general/advanced',
  'shotdashboard/overall and untested pullups/catch_and_shoot',
  'hustle',
  'clutch',
  'defense',
  'player playtype spotup/transition (estimate only, not characterized)',
  'player tracking possessions/catchshoot/pullupshot (not characterized)',
  'team playtype spotup/prballhandler (not characterized)',
  'team shooting by_zone_base (not characterized)',
  'season 2022',
] as const;

export type TargetedSeason = (typeof SEASON_AVERAGES_TARGET_SEASONS)[number];
export type TargetedCombo = { category: string; type: string };

export function seasonAveragesCanonicalPrefix(kind: SeasonAveragesKind): string {
  return kind === 'player' ? PLAYER_SEASON_AVERAGES_CANONICAL_PREFIX : TEAM_SEASON_AVERAGES_CANONICAL_PREFIX;
}

export function seasonAveragesComboPrefix(args: {
  kind: SeasonAveragesKind;
  season: number;
  seasonType?: string;
  category: string;
  type: string;
}): string {
  const seasonType = args.seasonType ?? SEASON_AVERAGES_SEASON_TYPE;
  return `${seasonAveragesCanonicalPrefix(args.kind)}/season=${args.season}/season_type=${seasonType}/category=${args.category}/type=${args.type}`;
}

export function seasonAveragesCanonicalPageKey(args: {
  kind: SeasonAveragesKind;
  season: number;
  seasonType?: string;
  category: string;
  type: string;
  batchIndex: number;
  pageIndex: number;
}): string {
  const batch = String(args.batchIndex).padStart(2, '0');
  return `${seasonAveragesComboPrefix(args)}/batch=${batch}/page=${args.pageIndex}.json`;
}

export function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function sortProviderIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

/** Advanced Stats V2 fields observed in the 2025 S3 archive (game grain). */
export const ADVANCED_STATS_KNOWN_FIELDS = [
  'pie',
  'assist_percentage',
  'assist_ratio',
  'assist_to_turnover',
  'defensive_rating',
  'defensive_rebound_percentage',
  'effective_field_goal_percentage',
  'estimated_defensive_rating',
  'estimated_net_rating',
  'estimated_offensive_rating',
  'estimated_pace',
  'estimated_usage_percentage',
  'net_rating',
  'offensive_rating',
  'offensive_rebound_percentage',
  'pace',
  'pace_per_40',
  'possessions',
  'rebound_percentage',
  'true_shooting_percentage',
  'turnover_ratio',
  'usage_percentage',
] as const;
