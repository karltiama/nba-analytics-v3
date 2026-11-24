/**
 * Closing-line selection from verified S3 archives.
 * This is selectClosingLinesFromArchives. It does not insert decision rows.
 */
import {
  decisionInstant,
  selectLatestPreTipObservations,
  type PreTipObservation,
} from '../../../lib/prune/closing-lines';
import { publicationEvidenceProblem, type PublicationManifest } from './f39b/manifest';
import { manifestKeyFor } from './f39b/publish';
import type { CurrentPropsObjectStore } from './f39b/store';
import {
  verifyStoredArchive,
  type PlayerPropArchiveRow,
} from './player-prop-snapshot-archive';

export type ArchivedPullReference = {
  pullRunId: number;
  archiveKey: string;
  startedAt: string;
};

export type DecisionCloseGame = {
  gameId: string;
  gameDate: string;
  status: string;
  startTime: string | null;
};

export type DecisionCloseRow = {
  gameId: string;
  playerId: string;
  playerName: string | null;
  teamId: number | null;
  sportsbook: string;
  propType: string;
  marketType: string;
  side: string;
  lineValue: number | null;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  oddsDecimal: number | null;
  decisionAt: string;
  gameStartTime: string;
  decisionClock: 'RESPONSE_RECEIVED';
};

type ObservedRow = PreTipObservation & { source: PlayerPropArchiveRow };

function integerTeam(value: string | null): number | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function qualifyingRow(row: PlayerPropArchiveRow, pullRunId: number, observedAt: string, controllerAt: string): ObservedRow | null {
  if ((row.market_type ?? '').toLowerCase() !== 'over_under') return null;
  const side = (row.side ?? '').toLowerCase();
  if (side !== 'over' && side !== 'under') return null;
  return {
    gameId: row.game_id,
    playerId: row.player_id,
    sportsbook: row.sportsbook,
    propType: row.prop_type,
    side: row.side,
    lineValue: row.line_value ?? 0,
    oddsAmerican: row.odds_american ?? 0,
    fetchedAt: new Date(controllerAt),
    pullRunId,
    observedAt: new Date(observedAt),
    observationClock: 'RESPONSE_RECEIVED',
    source: row,
  };
}

/**
 * Last pre-tip over/under row per (game, player, book, prop, side).
 * A market missing from a later archive stays at its previous verified observation.
 * Incomplete, unreadable, post-tip, and conflicting archives contribute nothing.
 */
export async function selectClosingLinesFromArchives(args: {
  store: CurrentPropsObjectStore;
  game: DecisionCloseGame;
  pulls: readonly ArchivedPullReference[];
}): Promise<DecisionCloseRow[]> {
  if (args.game.status !== 'Final' || args.game.startTime == null) return [];
  const tip = new Date(args.game.startTime);
  const observed: ObservedRow[] = [];
  for (const pull of args.pulls) {
    let verified: Awaited<ReturnType<typeof verifyStoredArchive>>;
    try {
      verified = await verifyStoredArchive({
        store: args.store,
        key: pull.archiveKey,
        expected: {
          gameId: args.game.gameId,
          pullRunId: pull.pullRunId,
          gameDate: args.game.gameDate,
          controllerEnqueuedAt: pull.startedAt,
        },
      });
    } catch {
      continue;
    }
    if (!verified.ok || !verified.envelope.observed_at) continue;
    let manifest: PublicationManifest;
    try {
      const object = await args.store.get(manifestKeyFor(pull.archiveKey));
      if (!object) continue;
      manifest = JSON.parse(object.body.toString('utf8')) as PublicationManifest;
    } catch {
      continue;
    }
    if (publicationEvidenceProblem(manifest, verified.envelope)) continue;
    for (const row of verified.envelope.rows) {
      const candidate = qualifyingRow(row, pull.pullRunId, verified.envelope.observed_at, pull.startedAt);
      if (candidate && candidate.gameId === args.game.gameId) observed.push(candidate);
    }
  }
  return selectLatestPreTipObservations(observed, tip)
    .flatMap((row) => {
      const decision = decisionInstant(row);
      if (!decision || decision.clock !== 'RESPONSE_RECEIVED') return [];
      return [{
        gameId: args.game.gameId,
        playerId: row.playerId,
        playerName: row.source.player_name,
        teamId: integerTeam(row.source.team_id),
        sportsbook: row.sportsbook,
        propType: row.propType,
        marketType: row.source.market_type,
        side: row.side,
        lineValue: row.source.line_value,
        oddsAmerican: row.source.odds_american,
        oddsDecimal: row.source.odds_decimal,
        impliedProbability: row.source.implied_probability,
        decisionAt: decision.at.toISOString(),
        gameStartTime: tip.toISOString(),
        decisionClock: 'RESPONSE_RECEIVED' as const,
      }];
    })
    .sort((left, right) => (
      left.playerId.localeCompare(right.playerId)
      || left.sportsbook.localeCompare(right.sportsbook)
      || left.propType.localeCompare(right.propType)
      || left.side.localeCompare(right.side)
    ));
}
