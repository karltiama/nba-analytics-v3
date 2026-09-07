/**
 * User-scoped saved-research queries. Always filter by auth user_id.
 * LEFT JOIN games so a missing/final/current-empty market does not drop the bookmark.
 */

import { query, queryOne } from '@/lib/db';
import {
  etCalendarDate,
  etCalendarDateFromInstant,
} from '@/lib/betting/props-market-context';
import {
  isSavedPaperAllowed,
  resolveSavedMarketContext,
  savedBookmarkLabel,
  SAVED_RESEARCH_DEFAULT_LIMIT,
  SAVED_RESEARCH_MAX_LIMIT,
} from '@/lib/betting/saved-research';

export const SAVED_RESEARCH_LIST_SQL = `
SELECT
  s.id, s.user_id, s.game_id, s.player_id, s.player_name, s.sportsbook, s.prop_type, s.market_type,
  s.side, s.line_value, s.odds_american, s.implied_probability, s.snapshot_at, s.note,
  s.created_at, s.updated_at,
  s.market_context,
  COALESCE(
    to_char(s.date_et, 'YYYY-MM-DD'),
    to_char((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD'),
    to_char((s.snapshot_at AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD')
  ) AS date_et,
  g.start_time AS game_start_time,
  g.status AS game_status,
  t_away.abbreviation AS away_abbr,
  t_home.abbreviation AS home_abbr
FROM public.user_saved_props s
LEFT JOIN analytics.games g ON g.game_id::text = s.game_id::text
LEFT JOIN analytics.teams t_home ON t_home.team_id = g.home_team_id
LEFT JOIN analytics.teams t_away ON t_away.team_id = g.away_team_id
WHERE s.user_id = $1::uuid
ORDER BY s.created_at DESC
LIMIT $2
`;

export const SAVED_RESEARCH_INSERT_SQL = `
INSERT INTO public.user_saved_props (
  user_id, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
  line_value, odds_american, implied_probability, snapshot_at, note, market_context, date_et
) VALUES (
  $1::uuid, $2, $3::bigint, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13, $14, $15::date
)
ON CONFLICT (
  user_id,
  game_id,
  player_id,
  coalesce(sportsbook, ''),
  coalesce(prop_type, ''),
  coalesce(side, ''),
  coalesce(line_value, -999999.999),
  coalesce(snapshot_at, '1970-01-01 00:00:00+00'::timestamptz)
)
DO UPDATE SET
  note = COALESCE(EXCLUDED.note, public.user_saved_props.note),
  market_context = COALESCE(EXCLUDED.market_context, public.user_saved_props.market_context),
  date_et = COALESCE(EXCLUDED.date_et, public.user_saved_props.date_et)
RETURNING id, user_id, game_id, player_id, player_name, sportsbook, prop_type, market_type, side,
          line_value, odds_american, implied_probability, snapshot_at, note, created_at, updated_at,
          market_context, date_et
`;

export const SAVED_RESEARCH_DELETE_SQL = `
DELETE FROM public.user_saved_props
WHERE id = $1::uuid AND user_id = $2::uuid
RETURNING id
`;

export type SavedPropDbRow = {
  id: string;
  user_id: string;
  game_id: string;
  player_id: string | number;
  player_name: string | null;
  sportsbook: string | null;
  prop_type: string | null;
  market_type: string | null;
  side: string | null;
  line_value: string | number | null;
  odds_american: number | null;
  implied_probability: string | number | null;
  snapshot_at: string | Date | null;
  note: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  market_context?: string | null;
  date_et?: string | null;
  game_start_time?: string | Date | null;
  game_status?: string | null;
  away_abbr?: string | null;
  home_abbr?: string | null;
};

export type SavedResearchItem = {
  id: string;
  userId: string;
  gameId: string;
  playerId: number;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  marketType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  snapshotAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  dateEt: string | null;
  marketContext: 'live' | 'historical';
  lineLabel: string;
  paperBetAllowed: boolean;
  matchup: string | null;
  gameStatus: string | null;
};

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  return s.trim() ? s : null;
}

export function mapSavedResearchRow(row: SavedPropDbRow, todayEt: string): SavedResearchItem {
  const snapshotAt = iso(row.snapshot_at);
  const dateEt =
    (row.date_et && /^\d{4}-\d{2}-\d{2}/.test(String(row.date_et))
      ? String(row.date_et).slice(0, 10)
      : null) ||
    etCalendarDateFromInstant(row.game_start_time) ||
    etCalendarDateFromInstant(row.snapshot_at);
  const marketContext = resolveSavedMarketContext({
    stored: row.market_context,
    dateEt,
    snapshotAt,
    gameStartTime: row.game_start_time,
    todayEt,
  });
  const away = row.away_abbr?.trim() || null;
  const home = row.home_abbr?.trim() || null;
  const lineValue =
    row.line_value == null || row.line_value === '' ? null : Number(row.line_value);
  return {
    id: row.id,
    userId: row.user_id,
    gameId: row.game_id,
    playerId: Number(row.player_id),
    playerName: row.player_name,
    sportsbook: row.sportsbook,
    propType: row.prop_type,
    marketType: row.market_type,
    side: row.side,
    lineValue: lineValue != null && Number.isFinite(lineValue) ? lineValue : null,
    oddsAmerican: row.odds_american,
    impliedProbability:
      row.implied_probability != null && row.implied_probability !== ''
        ? Number(row.implied_probability)
        : null,
    snapshotAt,
    note: row.note,
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
    dateEt,
    marketContext,
    lineLabel: savedBookmarkLabel(marketContext),
    paperBetAllowed: isSavedPaperAllowed(marketContext),
    matchup: away && home ? `${away} @ ${home}` : null,
    gameStatus: row.game_status ?? null,
  };
}

export function clampSavedResearchLimit(raw: string | null): number {
  const n = parseInt(raw || String(SAVED_RESEARCH_DEFAULT_LIMIT), 10);
  if (!Number.isFinite(n)) return SAVED_RESEARCH_DEFAULT_LIMIT;
  return Math.min(SAVED_RESEARCH_MAX_LIMIT, Math.max(1, n));
}

export async function listSavedResearchForUser(input: {
  userId: string;
  limit?: number;
  todayEt?: string;
}): Promise<SavedResearchItem[]> {
  const limit = Math.min(
    SAVED_RESEARCH_MAX_LIMIT,
    Math.max(1, input.limit ?? SAVED_RESEARCH_DEFAULT_LIMIT)
  );
  const rows = await query<SavedPropDbRow>(SAVED_RESEARCH_LIST_SQL, [input.userId, limit]);
  const todayEt = input.todayEt ?? etCalendarDate();
  return rows.map((row) => mapSavedResearchRow(row, todayEt));
}

export async function insertSavedResearchForUser(input: {
  userId: string;
  gameId: string;
  playerId: string;
  playerName?: string | null;
  sportsbook?: string | null;
  propType?: string | null;
  marketType?: string | null;
  side?: string | null;
  lineValue?: number | null;
  oddsAmerican?: number | null;
  impliedProbability?: number | null;
  snapshotAt?: string | null;
  note?: string | null;
  marketContext?: 'live' | 'historical' | null;
  dateEt?: string | null;
}): Promise<SavedPropDbRow | null> {
  return queryOne<SavedPropDbRow>(SAVED_RESEARCH_INSERT_SQL, [
    input.userId,
    input.gameId,
    input.playerId,
    input.playerName ?? null,
    input.sportsbook ?? null,
    input.propType ?? null,
    input.marketType ?? null,
    input.side ?? null,
    input.lineValue ?? null,
    input.oddsAmerican ?? null,
    input.impliedProbability ?? null,
    input.snapshotAt ?? null,
    input.note ?? null,
    input.marketContext ?? null,
    input.dateEt ?? null,
  ]);
}

export async function deleteSavedResearchForUser(input: {
  userId: string;
  id: string;
}): Promise<string | null> {
  const row = await queryOne<{ id: string }>(SAVED_RESEARCH_DELETE_SQL, [input.id, input.userId]);
  return row?.id ?? null;
}
