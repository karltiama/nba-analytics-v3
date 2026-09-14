import {
  CC_SEASON_TO_OWLS,
  FROZEN_GAME_UNIVERSE,
  OWLS_DEFAULT_HISTORY_CONCURRENCY,
  OWLS_PAGE_LIMITS,
  TARGET_CC_SEASONS,
} from './contract';
import { assertRequestedSeasonScope } from './cli';
import { filterGames, summarizeUniverse, toManifestRow } from './universe';
import type { CourtContextGame } from './types';

export type PlannerArgs = {
  season?: string;
  from?: string;
  to?: string;
  gameId?: string;
  games: CourtContextGame[];
  existingArchivedObjects?: number;
  requestsThatCanBeSkipped?: number;
  observedPagesPerGame?: number | null;
  observedSecondsPerGame?: number | null;
};

export type PlannerResult = {
  season: string | 'mixed';
  courtContextGames: number;
  estimatedOwlsGameLookups: number;
  estimatedHistoryRequests: number | 'unknown_until_live_probe';
  estimatedPages: number | 'unknown_until_live_probe';
  estimatedS3Objects: number | 'unknown_until_live_probe';
  existingArchivedObjects: number;
  requestsThatCanBeSkipped: number;
  estimatedRuntime: string;
  defaultHistoryConcurrency: number;
  owlsSeasonLabel: string | null;
  universe: ReturnType<typeof summarizeUniverse>;
  manifest: ReturnType<typeof toManifestRow>[];
  notes: string[];
};

export function planOwlsPropBackfill(args: PlannerArgs): PlannerResult {
  const games = filterGames(args.games, {
    season: args.season,
    from: args.from,
    to: args.to,
    gameId: args.gameId,
  });
  assertRequestedSeasonScope(args.season, games);
  const seasons = [...new Set(games.map((g) => g.season))].sort();
  const season = seasons.length === 1 ? seasons[0]! : 'mixed';
  const lookups = Math.ceil(games.length / OWLS_PAGE_LIMITS.historyGames.max) || 0;
  const pagesPerGame = args.observedPagesPerGame;
  const estimatedPages =
    pagesPerGame != null && pagesPerGame > 0
      ? games.length * pagesPerGame
      : ('unknown_until_live_probe' as const);
  const estimatedHistoryRequests =
    typeof estimatedPages === 'number'
      ? lookups + estimatedPages
      : ('unknown_until_live_probe' as const);
  const runtime =
    args.observedSecondsPerGame != null && games.length > 0
      ? formatHms(games.length * args.observedSecondsPerGame * 1000)
      : 'unknown until live probe';

  return {
    season,
    courtContextGames: games.length,
    estimatedOwlsGameLookups: lookups,
    estimatedHistoryRequests,
    estimatedPages,
    estimatedS3Objects: estimatedPages,
    existingArchivedObjects: args.existingArchivedObjects ?? 0,
    requestsThatCanBeSkipped: args.requestsThatCanBeSkipped ?? 0,
    estimatedRuntime: runtime,
    defaultHistoryConcurrency: OWLS_DEFAULT_HISTORY_CONCURRENCY,
    owlsSeasonLabel: season === 'mixed' ? null : CC_SEASON_TO_OWLS[season] ?? null,
    universe: summarizeUniverse(games),
    manifest: games.map(toManifestRow),
    notes: [
      'No Owls API calls are made by this planner.',
      'History pagination is limit/offset; stop when a page is shorter than limit.',
      'Default history concurrency is 2 (documented MVP cap 3, HoF cap 4).',
      '/history/player-props max page size is 100; /history/games max page size is 100.',
      'Do not fan out one event across books in parallel.',
      pagesPerGame == null
        ? 'Pages/game and runtime remain unknown until the live probe observes real payload sizes.'
        : `Using observed pages/game=${pagesPerGame}.`,
    ],
  };
}

export function formatPlannerStdout(plan: PlannerResult): string {
  const lines = [
    `Season: ${plan.season}`,
    `Final games: ${plan.courtContextGames}`,
    `Court Context games: ${plan.courtContextGames}`,
    `Estimated Owls game lookups: ${plan.estimatedOwlsGameLookups}`,
    `Estimated history requests: ${plan.estimatedHistoryRequests}`,
    `Estimated pages: ${plan.estimatedPages}`,
    `Estimated S3 objects: ${plan.estimatedS3Objects}`,
    `Existing archived objects: ${plan.existingArchivedObjects}`,
    `Requests that can be skipped: ${plan.requestsThatCanBeSkipped}`,
    `Estimated runtime: ${plan.estimatedRuntime}`,
    `Owls season label: ${plan.owlsSeasonLabel ?? 'n/a'}`,
    `Default history concurrency: ${plan.defaultHistoryConcurrency}`,
  ];
  for (const [season, u] of Object.entries(plan.universe)) {
    lines.push(
      `Universe ${season}: regular=${u.regularFinal} play-in=${u.playInFinal} playoff=${u.playoffFinal} total=${u.totalFinal} earliest=${u.earliestStartTime} latest=${u.latestStartTime}`
    );
  }
  lines.push('Notes:');
  for (const n of plan.notes) lines.push(`- ${n}`);
  return lines.join('\n');
}

export function frozenUniverseGames(): never[] {
  void TARGET_CC_SEASONS;
  void FROZEN_GAME_UNIVERSE;
  return [];
}

export function formatHms(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
