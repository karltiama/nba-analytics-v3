/**
 * Server-only loader. Reads one scoreboard game and the 2025–26 regular-season window.
 * Does not write, and does not call a provider.
 */

import { STORED_ODDS_SQL, draftKingsPatch, type StoredOddsSourceRow } from '@/lib/dashboard/stored-odds';
import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';
import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { isScoreboardMarketServingEnabled } from '@/lib/scoreboard/flags';
import { formatObservedAt, lifecycleLabel, seasonLabel } from '@/lib/scoreboard/present';
import { createPgScoreboardStore, type ScoreboardStore } from '@/lib/scoreboard/store';
import type { PlayerSumRow, TeamSumRow } from './aggregate';
import { buildPregameMatchup, type PregameMatchupModel } from './compose';
import { playerRow, teamRow } from './rows';
import { dashboardReturnHref, parseSlateDate } from './href';
import { historicalPlayerQuery, historicalTeamQuery, teamIdentityQuery } from './queries';
import { matchupQuoteFromStoredPatch, resolveMatchupQuote } from './quote';
import { presentRoster } from './roster';
import { loadRosterContinuity } from './roster-load';
import { historicalWindow } from './window';

type Sql = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

async function defaultPool() {
  const { default: pool } = await import('@/lib/db');
  return pool;
}

function sameAbbr(scoreboard: string | null, analytics: string | null | undefined): boolean {
  if (!scoreboard || !analytics) return false;
  return scoreboard.trim().toUpperCase() === analytics.trim().toUpperCase();
}

export async function loadPregameMatchup(input: {
  gameId: string;
  slateDate?: string | null;
  now?: Date;
  env?: Record<string, string | undefined>;
  store?: ScoreboardStore;
  query?: Sql;
  /** Dashboard stored odds stay off this public page unless the visitor is signed in. */
  includeStoredOdds?: boolean;
}): Promise<PregameMatchupModel | null> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const store = input.store ?? createPgScoreboardStore(await defaultPool());
  const run = input.query ?? (async (text, params) => {
    const result = await (await defaultPool()).query(text, params);
    return result.rows as Record<string, unknown>[];
  });
  const game: StoredScoreboardGame | null = await store.loadGameById(input.gameId);
  if (!game) return null;

  const awayAbbr = game.visitorAbbr?.trim() || 'Away';
  const homeAbbr = game.homeAbbr?.trim() || 'Home';
  let quotes: Awaited<ReturnType<ScoreboardStore['loadCurrentOdds']>> = [];
  if (isScoreboardMarketServingEnabled(env)) {
    try {
      quotes = await store.loadCurrentOdds([game.gameId]);
    } catch {
      quotes = [];
    }
  }
  let quote = resolveMatchupQuote({ game, quotes, now, env, awayAbbr, homeAbbr });
  const tipMs = Date.parse(game.scheduledTip ?? '');
  const stillPregame = game.lifecycle === 'scheduled' && (!Number.isFinite(tipMs) || tipMs > now.getTime());
  if (!quote.quote && stillPregame && input.includeStoredOdds) {
    try {
      const storedRows = await run(STORED_ODDS_SQL, [[game.gameId], now.toISOString()]);
      const patch = storedRows[0] ? draftKingsPatch(storedRows[0] as StoredOddsSourceRow, now) : null;
      if (patch) quote = { quote: matchupQuoteFromStoredPatch(patch, awayAbbr, homeAbbr), note: null };
    } catch {
      // Keep the sentence from the scoreboard quote. Do not invent a price.
    }
  }

  const window = historicalWindow();
  const teamQuery = historicalTeamQuery(window);
  const teamIds: [string, string] = [game.visitorTeamId, game.homeTeamId];
  const playerQuery = historicalPlayerQuery(window, teamIds);
  const identity = teamIdentityQuery(teamIds);
  const [teamResult, playerResult, identityResult] = await Promise.all([
    run(teamQuery.text, teamQuery.params),
    run(playerQuery.text, playerQuery.params),
    run(identity.text, identity.params),
  ]);
  const identities = new Map(
    identityResult.map((row) => [String(row.team_id), { abbreviation: row.abbreviation == null ? null : String(row.abbreviation), fullName: row.full_name == null ? null : String(row.full_name) }])
  );
  const awayIdentity = identities.get(game.visitorTeamId);
  const homeIdentity = identities.get(game.homeTeamId);
  const identityConfirmed = sameAbbr(game.visitorAbbr, awayIdentity?.abbreviation) && sameAbbr(game.homeAbbr, homeIdentity?.abbreviation);
  let roster = presentRoster({ gameDate: game.etDate, day: null, teams: [] });
  try {
    roster = await loadRosterContinuity(run, {
      gameDate: game.etDate,
      tipoffAt: game.scheduledTip,
      teamIds,
      awayAbbr,
      homeAbbr,
      window,
    });
  } catch {
    roster = presentRoster({ gameDate: game.etDate, day: null, teams: [] });
  }

  return buildPregameMatchup({
    gameId: game.gameId,
    awayTeamId: game.visitorTeamId,
    homeTeamId: game.homeTeamId,
    awayAbbr,
    homeAbbr,
    awayName: game.visitorName?.trim() || awayIdentity?.fullName || awayAbbr,
    homeName: game.homeName?.trim() || homeIdentity?.fullName || homeAbbr,
    tipLabel: formatTipoffEt(game.scheduledTip) || 'Tip time unavailable',
    seasonLabel: seasonLabel(game.seasonType),
    statusLabel: lifecycleLabel(game.lifecycle),
    updatedLabel: `Scoreboard ${formatObservedAt(game.lastObservedAt)}`,
    returnHref: dashboardReturnHref(parseSlateDate(input.slateDate) ?? game.etDate),
    identityConfirmed,
    teamRows: teamResult.map(teamRow).filter((row): row is TeamSumRow => row != null),
    playerRows: playerResult.map(playerRow).filter((row): row is PlayerSumRow => row != null),
    roster,
    quote,
  });
}
