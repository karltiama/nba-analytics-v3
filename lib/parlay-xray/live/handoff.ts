/**
 * Live (current-slate) XRay → Workspace handoff.
 *
 * The historical replay path resolves against a fixed fixture catalog. Live
 * slips resolve against the product catalog: players, teams, and games in a
 * window around now. Identity always comes from the catalog, never from the
 * client, so a confirmed leg cannot inject a player or game id.
 *
 * When the player's current team is known, that team decides the game. A
 * vision misread of the matchup line (for example a leg printed under the
 * wrong game) is corrected to the player's own game on that date, and a slip
 * whose date has no game for the player's team fails instead of attaching to
 * some other game.
 */
import { handoffConfirmedXrayParlay, type HandoffConfirmedXrayParlayResult } from '@/lib/parlay/adapt-xray-confirmed';
import { formatEtYmd } from '@/lib/providers/owls-insight/mapping';
import { resolveGameIdentity } from '@/lib/parlay-xray/resolution/game';
import { resolvePlayerIdentityFromName } from '@/lib/parlay-xray/resolution/player';
import { resolveCanonicalParlayLegs } from '@/lib/parlay-xray/resolution/resolve-leg';
import type { XrayGameRecord, XrayResolutionCatalog } from '@/lib/parlay-xray/resolution/types';
import type { ExtractedParlayLeg } from '@/lib/parlay-xray/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Games loaded for live resolution: two weeks back (slip dates) to two weeks ahead. */
export function liveGamesWindow(now: Date): { fromIso: string; toIso: string } {
  return {
    fromIso: new Date(now.getTime() - 14 * DAY_MS).toISOString(),
    toIso: new Date(now.getTime() + 14 * DAY_MS).toISOString(),
  };
}

/**
 * Date candidates for one leg. A date read from the slip is the only candidate,
 * so a stale slip never attaches to tonight's rematch. Without a slip date,
 * try today then tomorrow (ET).
 */
export function liveDateCandidates(leg: ExtractedParlayLeg, now: Date): string[] {
  const slipDate = leg.gameDate.status === 'known' ? leg.gameDate.value : null;
  if (slipDate) {
    const trimmed = slipDate.trim();
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : formatEtYmd(trimmed);
    if (ymd) return [ymd];
  }
  const today = formatEtYmd(now.toISOString());
  const tomorrow = formatEtYmd(new Date(now.getTime() + DAY_MS).toISOString());
  return [today, tomorrow].filter((d): d is string => Boolean(d));
}

/** playerId → current team abbreviation. */
export type LiveRosterTeams = ReadonlyMap<string, string>;

export type LiveHandoffFailure = {
  playerName: string | null;
  reason: string | null;
};

type PreparedLeg = { ok: true; leg: ExtractedParlayLeg } | { ok: false; failure: LiveHandoffFailure };

function gameYmd(game: XrayGameRecord): string | null {
  return formatEtYmd(game.startTime);
}

function teamGamesOn(games: XrayGameRecord[], team: string, date: string): XrayGameRecord[] {
  const t = team.toUpperCase();
  return games.filter(
    (g) => gameYmd(g) === date && (g.homeTeamAbbr.toUpperCase() === t || g.awayTeamAbbr.toUpperCase() === t)
  );
}

function prepareLeg(
  leg: ExtractedParlayLeg,
  catalog: XrayResolutionCatalog,
  rosterTeams: LiveRosterTeams,
  now: Date
): PreparedLeg {
  const dates = liveDateCandidates(leg, now);
  const player = resolvePlayerIdentityFromName(leg.playerDisplayName.value, catalog.players);
  const rosterTeam = player.value ? rosterTeams.get(player.value.playerId) : undefined;

  if (rosterTeam) {
    for (const date of dates) {
      const hits = teamGamesOn(catalog.games, rosterTeam, date);
      if (hits.length !== 1) continue;
      const game = hits[0]!;
      const opponent =
        game.homeTeamAbbr.toUpperCase() === rosterTeam.toUpperCase() ? game.awayTeamAbbr : game.homeTeamAbbr;
      return {
        ok: true,
        leg: {
          ...leg,
          teamAbbr: { value: rosterTeam, status: 'known' },
          opponentAbbr: { value: opponent, status: 'known' },
          matchupLabel: { value: `${game.awayTeamAbbr} @ ${game.homeTeamAbbr}`, status: 'known' },
          gameDate: { value: date, status: 'known' },
        },
      };
    }
    return {
      ok: false,
      failure: { playerName: leg.playerDisplayName.value ?? null, reason: 'NO_TEAM_GAME' },
    };
  }

  for (const date of dates) {
    const game = resolveGameIdentity({
      games: catalog.games,
      teams: catalog.teams,
      context: { eventDate: date },
      gameDate: leg.gameDate.value,
      teamAbbr: leg.teamAbbr.value,
      opponentAbbr: leg.opponentAbbr.value,
      matchupLabel: leg.matchupLabel.value,
    });
    if (game.status === 'RESOLVED') {
      return { ok: true, leg: { ...leg, gameDate: { value: date, status: 'known' } } };
    }
  }
  return { ok: true, leg };
}

export type LiveHandoffResult =
  | Extract<HandoffConfirmedXrayParlayResult, { ok: true }>
  | { ok: false; code: string; failure: LiveHandoffFailure | null };

export function handoffLiveXrayParlay(
  legs: ExtractedParlayLeg[],
  catalog: XrayResolutionCatalog,
  now: Date = new Date(),
  rosterTeams: LiveRosterTeams = new Map()
): LiveHandoffResult {
  const prepared: ExtractedParlayLeg[] = [];
  for (const leg of legs) {
    const next = prepareLeg(leg, catalog, rosterTeams, now);
    if (!next.ok) return { ok: false, code: 'UNRESOLVED', failure: next.failure };
    prepared.push(next.leg);
  }

  const result = handoffConfirmedXrayParlay({
    confirmed: true,
    legs: prepared,
    catalog,
    historicalReplay: null,
  });
  if (result.ok) return result;

  const firstMiss = resolveCanonicalParlayLegs(prepared, catalog).find((r) => !r.fullyResolved);
  if (!firstMiss) return { ok: false, code: result.code, failure: null };
  const reason =
    [
      firstMiss.playerResolution,
      firstMiss.gameResolution,
      firstMiss.marketResolution,
      firstMiss.sideResolution,
      firstMiss.lineResolution,
      firstMiss.sportsbookResolution,
    ].find((f) => f.status !== 'RESOLVED')?.reason ?? null;
  return {
    ok: false,
    code: result.code,
    failure: { playerName: firstMiss.originalLeg.playerDisplayName.value ?? null, reason },
  };
}
