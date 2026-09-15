import { classifyWowyGames } from './eligibility';
import { summarizeWowyPair } from './aggregate';
import type {
  WowyLoadedGame,
  WowyModelPairResult,
  WowyPairQuery,
  WowyScenarioSelection,
} from './types';

export const WOWY_SCENARIO_UNKNOWN: WowyScenarioSelection = {
  status: 'unknown',
  source: 'pregame_availability_unknown',
};

/**
 * Historically safe model interface.
 *
 * Computes pair summaries from games strictly before the requested cutoff
 * using ET basketball-date exclusion. It never reads target-game production
 * or target-game teammate participation to choose a predictive scenario.
 *
 * Do not add pairwise effects across multiple absent teammates.
 * Do not feed this into frozen PTS C / REB C models in this slice.
 */
export function summarizeWowyBeforeCutoff(args: {
  games: WowyLoadedGame[];
  query: WowyPairQuery;
  subjectName: string;
  teammateName: string;
  identityOk?: boolean;
  /**
   * Optional caller-supplied scenario. If omitted, availability is unknown
   * and no absence adjustment should be applied.
   */
  scenario?: WowyScenarioSelection;
}): WowyModelPairResult {
  if (!args.query.cutoffStartTime) {
    throw new Error('summarizeWowyBeforeCutoff requires query.cutoffStartTime');
  }

  const classified = classifyWowyGames(args.games, args.query, { identityOk: args.identityOk });
  const history = summarizeWowyPair({
    query: args.query,
    classified,
    subjectName: args.subjectName,
    teammateName: args.teammateName,
  });

  const cutoffExcluded = classified.filter((g) => g.excludeReason === 'on_or_after_cutoff').length;
  const leakSafe = classified.every(
    (g) => g.bucket === 'excluded' || (g.startTime && g.startTime < args.query.cutoffStartTime!)
  );

  return {
    history,
    reliability: {
      supportTier: history.support.tier,
      withGames: history.with.gameCount,
      withoutGames: history.without.gameCount,
      unknownParticipationCount: history.unknownParticipationCount,
      unknownMembershipCount: history.unknownMembershipCount,
      cutoffApplied: true,
      cutoffStartTime: args.query.cutoffStartTime,
      leakSafe,
      notes: [
        'History uses games strictly before cutoff on an earlier America/New_York basketball date.',
        'Target-game box score and target-game teammate participation are not inputs.',
        cutoffExcluded > 0
          ? `${cutoffExcluded} game(s) dropped by cutoff (including same-ET-date).`
          : 'No post-cutoff games were present in the loaded set.',
        'If pregame teammate availability is unknown, leave scenario.status = unknown — do not auto-apply an absence adjustment.',
        'Do not sum WOWY diffs across multiple absent teammates.',
      ],
    },
    scenario: args.scenario ?? WOWY_SCENARIO_UNKNOWN,
  };
}
