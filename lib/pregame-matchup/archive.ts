/**
 * Past-season Final games. The scoreboard holds only the current season, so a game that is not there is read
 * from analytics.games. Pure: the loader runs ARCHIVE_GAME_SQL and passes the row here.
 */

import { POSTSEASON_START_ET } from "@/lib/games/season-eligibility";
import { seasonSpan } from "./compose";

/** One Final game from analytics.games. Teams are joined for abbreviations and names. */
export const ARCHIVE_GAME_SQL = `
  SELECT g.game_id, g.season, g.start_time, g.status, g.season_phase,
         (g.start_time AT TIME ZONE 'America/New_York')::date::text AS et_date,
         g.home_team_id, g.away_team_id, g.home_score, g.away_score,
         ht.abbreviation AS home_abbr, ht.full_name AS home_name,
         at.abbreviation AS away_abbr, at.full_name AS away_name
  FROM analytics.games g
  LEFT JOIN analytics.teams ht ON ht.team_id = g.home_team_id
  LEFT JOIN analytics.teams at ON at.team_id = g.away_team_id
  WHERE g.game_id = $1 AND g.status = 'Final'
    AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL`;

export type ArchiveGame = {
  gameId: string;
  season: string;
  etDate: string;
  scheduledTip: string | null;
  seasonPhase: string | null;
  homeTeamId: string;
  homeAbbr: string | null;
  homeName: string | null;
  homeScore: number;
  visitorTeamId: string;
  visitorAbbr: string | null;
  visitorName: string | null;
  visitorScore: number;
  /** analytics.games does not store periods, and minutes in the logs are whole, so overtime is not shown. */
  overtimePeriods: number;
};

const text = (v: unknown): string | null =>
  v == null || String(v).trim() === "" ? null : String(v).trim();
const int = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

export function archiveGameFromRow(
  row: Record<string, unknown> | undefined,
): ArchiveGame | null {
  if (!row) return null;
  const gameId = text(row.game_id);
  const season = text(row.season);
  const etDate = text(row.et_date);
  const homeTeamId = text(row.home_team_id);
  const visitorTeamId = text(row.away_team_id);
  const homeScore = int(row.home_score);
  const visitorScore = int(row.away_score);
  if (
    !gameId ||
    !season ||
    !etDate ||
    !homeTeamId ||
    !visitorTeamId ||
    homeScore == null ||
    visitorScore == null
  )
    return null;
  const start =
    row.start_time instanceof Date
      ? row.start_time.toISOString()
      : text(row.start_time);
  return {
    gameId,
    season,
    etDate,
    scheduledTip: start,
    seasonPhase: text(row.season_phase),
    homeTeamId,
    homeAbbr: text(row.home_abbr),
    homeName: text(row.home_name),
    homeScore,
    visitorTeamId,
    visitorAbbr: text(row.away_abbr),
    visitorName: text(row.away_name),
    visitorScore,
    overtimePeriods: 0,
  };
}

/**
 * "2025–26 Regular season" or "2025–26 Postseason". Past seasons store season_phase UNCLASSIFIED, so the
 * postseason start date decides. Play-in counts as postseason, as in POSTSEASON_START_ET.
 */
export function archiveSeasonLabel(
  game: Pick<ArchiveGame, "season" | "etDate" | "seasonPhase">,
): string {
  const span = seasonSpan(game.season);
  const phase = (game.seasonPhase ?? "").toUpperCase();
  if (phase === "PLAYIN" || phase === "PLAYOFFS") return `${span} Postseason`;
  if (phase === "REGULAR" || phase === "IST") return `${span} Regular season`;
  const postseason = POSTSEASON_START_ET[game.season];
  if (postseason && game.etDate >= postseason) return `${span} Postseason`;
  return `${span} Regular season`;
}

/** The date matters on a past game, so it leads: "Sat, Jun 13, 2026 · 8:30 PM EDT". A midnight ET start is a date only. */
export function archiveWhenLabel(
  game: Pick<ArchiveGame, "etDate" | "scheduledTip">,
): string {
  const [y, m, d] = game.etDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const tip = game.scheduledTip ? new Date(game.scheduledTip) : null;
  if (!tip || Number.isNaN(tip.getTime())) return date;
  const time = tip.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
  if (time.startsWith("12:00 AM")) return date;
  return `${date} · ${time}`;
}
