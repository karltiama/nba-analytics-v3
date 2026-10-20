/**
 * Temporary dashboard presentation for the 2026–27 opening night.
 * Reads schedule facts only. Does not interpret analytics.games.status,
 * does not invent scores, and does not change the scoreboard contract.
 */

import type { Game } from '@/components/betting/GameCard';

export const OPENING_NIGHT_ET = '2026-10-20';
export const OPENING_NIGHT_PREVIEW_DATES = ['2026-10-18', '2026-10-19', '2026-10-20'] as const;
export const OPENING_NIGHT_HEADING = 'Opening Night Games';
export const OPENING_NIGHT_DATE_LABEL = 'Tuesday, October 20';
export const OPENING_NIGHT_SECTION_NOTICE = 'Schedule preview. Live scores are not available.';
export const OPENING_NIGHT_EMPTY_COPY = 'No opening-night games are available to preview.';
export const OPENING_NIGHT_ERROR_COPY = 'The opening-night schedule could not be loaded.';

/** Read-only. No status column and no score columns. */
export const OPENING_NIGHT_GAMES_SQL = `
SELECT
  g.game_id::text AS game_id,
  g.season::text AS season,
  g.season_phase,
  g.start_time,
  ht.team_id::text AS home_id,
  ht.full_name AS home_name,
  ht.abbreviation AS home_abbr,
  at.team_id::text AS away_id,
  at.full_name AS away_name,
  at.abbreviation AS away_abbr
FROM analytics.games g
JOIN analytics.teams ht ON ht.team_id = g.home_team_id
JOIN analytics.teams at ON at.team_id = g.away_team_id
WHERE g.season::text = '2026'
  AND g.season_phase = 'REGULAR'
  AND (g.start_time AT TIME ZONE 'America/New_York')::date = DATE '2026-10-20'
ORDER BY g.start_time ASC, g.game_id ASC
`;

/** Verified opening-night identities. A row that disagrees is omitted. */
export const VERIFIED_OPENING_NIGHT = [
  { awayAbbr: 'BOS', homeAbbr: 'DET', tip: '2026-10-20T19:00:00.000Z' },
  { awayAbbr: 'PHI', homeAbbr: 'NYK', tip: '2026-10-20T23:00:00.000Z' },
  { awayAbbr: 'OKC', homeAbbr: 'SAS', tip: '2026-10-21T01:30:00.000Z' },
] as const;

const VERIFIED_TIP_MS = VERIFIED_OPENING_NIGHT.map((slot) => Date.parse(slot.tip));

export type OpeningNightSourceRow = {
  game_id: string;
  season: string;
  season_phase: string;
  start_time: string | Date;
  home_id: string;
  home_name: string;
  home_abbr: string;
  away_id: string;
  away_name: string;
  away_abbr: string;
};

export type OpeningNightAvailability = 'loading' | 'ready' | 'disabled' | 'error';

export type OpeningNightDecision =
  | { kind: 'defer' }
  | { kind: 'scoreboard' }
  | { kind: 'preview' };

const EMPTY_ODDS = { moneyline: null, spread: null, spreadOdds: null };

function instantMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function etCalendarDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Eastern clock time with an explicit ET suffix. Independent of the host zone. */
export function formatOpeningNightTip(value: string | Date): string {
  const ms = instantMs(value);
  if (ms == null) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
    timeZone: 'America/New_York',
  }).formatToParts(new Date(ms));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  const dayPeriod = (parts.find((part) => part.type === 'dayPeriod')?.value ?? '').toUpperCase();
  if (!hour || !minute || (dayPeriod !== 'AM' && dayPeriod !== 'PM')) return '';
  return `${hour}:${minute} ${dayPeriod} ET`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function slotIndex(row: OpeningNightSourceRow): number {
  if (text(row.season) !== '2026' || text(row.season_phase) !== 'REGULAR') return -1;
  const ms = instantMs(row.start_time);
  if (ms == null || etCalendarDate(ms) !== OPENING_NIGHT_ET) return -1;
  const away = text(row.away_abbr);
  const home = text(row.home_abbr);
  return VERIFIED_OPENING_NIGHT.findIndex(
    (slot, index) => slot.awayAbbr === away && slot.homeAbbr === home && VERIFIED_TIP_MS[index] === ms
  );
}

/**
 * Keep one row per verified game. Two different ids for the same matchup are
 * dropped instead of merged. Extra or mismatched rows are ignored.
 */
export function selectVerifiedOpeningNightRows(rows: readonly OpeningNightSourceRow[]): OpeningNightSourceRow[] {
  const grouped = new Map<number, OpeningNightSourceRow[]>();
  for (const row of rows) {
    const index = slotIndex(row);
    if (index < 0) continue;
    if (!text(row.game_id) || !text(row.away_name) || !text(row.home_name)) continue;
    const list = grouped.get(index) ?? [];
    list.push(row);
    grouped.set(index, list);
  }
  const selected: OpeningNightSourceRow[] = [];
  for (const index of grouped.keys()) {
    const list = grouped.get(index) ?? [];
    const ids = new Set(list.map((row) => text(row.game_id)));
    if (ids.size !== 1) continue;
    selected.push(list[0]);
  }
  selected.sort((a, b) => slotIndex(a) - slotIndex(b));
  return selected;
}

export function toOpeningNightGame(row: OpeningNightSourceRow, now: Date): Game | null {
  const index = slotIndex(row);
  if (index < 0) return null;
  const tipMs = VERIFIED_TIP_MS[index];
  if (tipMs == null) return null;
  const awayName = text(row.away_name);
  const homeName = text(row.home_name);
  if (!awayName || !homeName) return null;
  return {
    id: text(row.game_id),
    gameDate: OPENING_NIGHT_ET,
    homeTeam: {
      id: text(row.home_id),
      name: homeName,
      abbreviation: VERIFIED_OPENING_NIGHT[index].homeAbbr,
      record: null,
    },
    awayTeam: {
      id: text(row.away_id),
      name: awayName,
      abbreviation: VERIFIED_OPENING_NIGHT[index].awayAbbr,
      record: null,
    },
    startTime: formatOpeningNightTip(VERIFIED_OPENING_NIGHT[index].tip),
    homeOdds: EMPTY_ODDS,
    awayOdds: EMPTY_ODDS,
    overUnder: null,
    overOdds: null,
    underOdds: null,
    homeImpliedProb: null,
    awayImpliedProb: null,
    isFavorite: null,
    isClose: false,
    hasOdds: false,
    researchAvailable: false,
    schedulePreview: { tipPassed: now.getTime() >= tipMs },
  };
}

export function presentOpeningNightGames(rows: readonly OpeningNightSourceRow[], now: Date): Game[] {
  return selectVerifiedOpeningNightRows(rows)
    .map((row) => toOpeningNightGame(row, now))
    .filter((game): game is Game => game != null);
}

/** Reject a payload that smuggles a score, a status, or an unlabeled market onto a preview card. */
export function isRenderableOpeningNightCard(game: Game): boolean {
  if (!game || typeof game !== 'object' || !game.schedulePreview) return false;
  if (game.homeScore != null || game.awayScore != null) return false;
  if (game.status) return false;
  if (game.hasOdds) {
    if (game.schedulePreview.tipPassed) return false;
    if (!game.marketCaption?.startsWith('DraftKings · observed ')) return false;
  }
  if (game.scoreboard) return false;
  if (!game.startTime || !game.awayTeam?.abbreviation || !game.homeTeam?.abbreviation) return false;
  if (!game.awayTeam.name || !game.homeTeam.name) return false;
  return true;
}

/**
 * Default slate only: today is Oct 18, 19, or 20 ET, the user did not pick
 * another date, and the scoreboard has no presentable games. Errors stay on
 * the scoreboard path. Oct 21 and later return to that path.
 */
export function decideOpeningNightPreview(input: {
  todayEt: string;
  selectedDate: string;
  availability: OpeningNightAvailability;
  presentableScoreboardGames: number;
}): OpeningNightDecision {
  if (!(OPENING_NIGHT_PREVIEW_DATES as readonly string[]).includes(input.todayEt)) {
    return { kind: 'scoreboard' };
  }
  if (input.selectedDate !== input.todayEt) return { kind: 'scoreboard' };
  if (input.availability === 'loading') return { kind: 'defer' };
  if (input.availability === 'disabled' || input.availability === 'error') return { kind: 'scoreboard' };
  if (input.presentableScoreboardGames > 0) return { kind: 'scoreboard' };
  return { kind: 'preview' };
}
