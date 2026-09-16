import {
  WOWY_CALCULATION_VERSION,
  WOWY_DATA_VERSION,
  WOWY_RATE_STAT_KEYS,
  WOWY_STAT_KEYS,
  isSelfWowyQuery,
  type WowyClassifiedGame,
  type WowyDiffSummary,
  type WowyExclusionTally,
  type WowyExcludeReason,
  type WowyGroupSummary,
  type WowyPairQuery,
  type WowyPairSummary,
  type WowyRateMap,
  type WowyRateStatKey,
  type WowyStatMap,
  type WowyStatKey,
} from './types';
import {
  WOWY_PERCENT_DIFF_MIN_ABS,
  WOWY_SUPPORT_POLICY_ID,
  wowySupportLabel,
  wowySupportTier,
} from './policy';

const COVERAGE = {
  dnpSemantics:
    'analytics.player_game_logs.minutes = "00" is the verified DNP/inactive roster row; not an injury label' as const,
  missingRowSemantics: 'A missing teammate row is unknown, never inferred absence' as const,
  membershipSemantics:
    'Same-team membership for a game requires both players to have a game-log row on the same team_id' as const,
  stintSemantics:
    'analytics.player_team_stints observed_from/to are roster observations, not verified trade timestamps. inferred_pgl stints are game-derived and must not be treated as trade dates.' as const,
  possessionDisclaimer: 'Game-level WOWY does not establish shared-court possessions' as const,
  seasonsWithBoxLogs: ['2023', '2024', '2025'] as const,
};

function emptyStatMap(): WowyStatMap {
  return {
    minutes: null,
    pts: null,
    oppPts: null,
    reb: null,
    ast: null,
    tpm: null,
    fga: null,
    tpa: null,
    fta: null,
  };
}

function emptyRateMap(): WowyRateMap {
  return {
    pts: null,
    reb: null,
    ast: null,
    tpm: null,
    fga: null,
    tpa: null,
    fta: null,
  };
}

function meanOrNull(sum: number, count: number): number | null {
  if (count <= 0) return null;
  return sum / count;
}

function rateOrNull(statSum: number, minutesSum: number): number | null {
  if (!(minutesSum > 0)) return null;
  return statSum / minutesSum;
}

export function aggregateWowyGroup(games: WowyClassifiedGame[]): WowyGroupSummary {
  const totals: Record<WowyStatKey, number> = {
    minutes: 0,
    pts: 0,
    oppPts: 0,
    reb: 0,
    ast: 0,
    tpm: 0,
    fga: 0,
    tpa: 0,
    fta: 0,
  };
  const counts: Record<WowyStatKey, number> = {
    minutes: 0,
    pts: 0,
    oppPts: 0,
    reb: 0,
    ast: 0,
    tpm: 0,
    fga: 0,
    tpa: 0,
    fta: 0,
  };
  let validMinutesForRates = 0;
  const dates: string[] = [];
  const gameIds: string[] = [];

  for (const game of games) {
    gameIds.push(game.gameId);
    if (game.basketballDateEt) dates.push(game.basketballDateEt);
    const parsedMinutes = game.subject.minutes;
    if (parsedMinutes != null && Number.isFinite(parsedMinutes)) {
      totals.minutes += parsedMinutes;
      counts.minutes += 1;
      if (parsedMinutes > 0) validMinutesForRates += parsedMinutes;
    }
    for (const key of WOWY_STAT_KEYS) {
      if (key === 'minutes') continue;
      const value = game.subject.stats[key];
      if (value != null && Number.isFinite(value)) {
        totals[key] += value;
        counts[key] += 1;
      }
    }
  }

  const perGame = emptyStatMap();
  for (const key of WOWY_STAT_KEYS) {
    perGame[key] = meanOrNull(totals[key], counts[key]);
  }

  const perMinute = emptyRateMap();
  const perMinuteEligible = validMinutesForRates > 0;
  if (perMinuteEligible) {
    for (const key of WOWY_RATE_STAT_KEYS) {
      perMinute[key] = rateOrNull(totals[key], validMinutesForRates);
    }
  }

  dates.sort();
  return {
    gameCount: games.length,
    totalMinutes: totals.minutes,
    validMinutesForRates,
    dateCoverage: {
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
    },
    perGame,
    perMinute,
    perMinuteEligible,
    countingRetainedDespiteIneligibleRates: games.length > 0 && !perMinuteEligible,
    gameIds,
  };
}

function percentDiff(withVal: number | null, withoutVal: number | null, minAbs: number): number | null {
  if (withVal == null || withoutVal == null) return null;
  if (!Number.isFinite(withVal) || !Number.isFinite(withoutVal)) return null;
  if (Math.abs(withoutVal) < minAbs) return null;
  return (withVal - withoutVal) / Math.abs(withoutVal);
}

export function diffWowyGroups(withGroup: WowyGroupSummary, withoutGroup: WowyGroupSummary): WowyDiffSummary {
  const absolutePerGame = emptyStatMap();
  const percentPerGame = emptyStatMap();
  for (const key of WOWY_STAT_KEYS) {
    const a = withGroup.perGame[key];
    const b = withoutGroup.perGame[key];
    absolutePerGame[key] = a != null && b != null ? a - b : null;
    const minAbs = key === 'minutes' ? WOWY_PERCENT_DIFF_MIN_ABS.minutesPerGame : WOWY_PERCENT_DIFF_MIN_ABS.countingPerGame;
    percentPerGame[key] = percentDiff(a, b, minAbs);
  }

  const absolutePerMinute = emptyRateMap();
  const percentPerMinute = emptyRateMap();
  const ratesOk = withGroup.perMinuteEligible && withoutGroup.perMinuteEligible;
  if (ratesOk) {
    for (const key of WOWY_RATE_STAT_KEYS) {
      const a = withGroup.perMinute[key];
      const b = withoutGroup.perMinute[key];
      absolutePerMinute[key] = a != null && b != null ? a - b : null;
      percentPerMinute[key] = percentDiff(a, b, WOWY_PERCENT_DIFF_MIN_ABS.perMinuteRate);
    }
  }

  return { absolutePerGame, percentPerGame, absolutePerMinute, percentPerMinute };
}

export function tallyExclusions(games: WowyClassifiedGame[]): WowyExclusionTally[] {
  const counts = new Map<WowyExcludeReason, number>();
  for (const game of games) {
    if (game.bucket !== 'excluded' || !game.excludeReason) continue;
    counts.set(game.excludeReason, (counts.get(game.excludeReason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function summarizeWowyPair(args: {
  query: WowyPairQuery;
  classified: WowyClassifiedGame[];
  subjectName: string;
  teammateName: string | null;
  teamAbbreviation?: string;
  teamFullName?: string;
}): WowyPairSummary {
  const withGames = args.classified.filter((g) => g.bucket === 'with');
  const withoutGames = args.classified.filter((g) => g.bucket === 'without');
  const excluded = args.classified.filter((g) => g.bucket === 'excluded');
  const withGroup = aggregateWowyGroup(withGames);
  const withoutGroup = aggregateWowyGroup(withoutGames);
  const supportTier = wowySupportTier(withGroup.gameCount, withoutGroup.gameCount);
  const self = isSelfWowyQuery(args.query);

  return {
    calculationVersion: WOWY_CALCULATION_VERSION,
    dataVersion: WOWY_DATA_VERSION,
    query: args.query,
    mode: self ? 'subject' : 'teammate',
    subject: { playerId: args.query.subjectPlayerId, fullName: args.subjectName },
    teammate:
      self || !args.query.teammatePlayerId || !args.teammateName
        ? null
        : { playerId: args.query.teammatePlayerId, fullName: args.teammateName },
    team: {
      teamId: args.query.teamId,
      abbreviation: args.teamAbbreviation ?? args.query.teamId,
      fullName: args.teamFullName ?? args.teamAbbreviation ?? args.query.teamId,
    },
    with: withGroup,
    without: withoutGroup,
    diff: diffWowyGroups(withGroup, withoutGroup),
    excludedCount: excluded.length,
    unknownParticipationCount: excluded.filter((g) => g.excludeReason === 'malformed_teammate_minutes').length,
    unknownMembershipCount: excluded.filter(
      (g) => g.excludeReason === 'teammate_unknown_membership' || g.excludeReason === 'ambiguous_team_membership'
    ).length,
    exclusions: tallyExclusions(args.classified),
    support: {
      tier: supportTier,
      policyId: WOWY_SUPPORT_POLICY_ID,
      withGames: withGroup.gameCount,
      withoutGames: withoutGroup.gameCount,
      label: wowySupportLabel(supportTier),
    },
    coverage: COVERAGE,
    classifiedGames: args.classified,
  };
}

export type { WowyRateStatKey };
