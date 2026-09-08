/**
 * Fail-closed gates for WP7 historical serving backfill.
 * Analytics materialization requires complete S3 archives for both games and player_stats.
 */

export type BdlEntityManifest = {
  schemaVersion: 1;
  source: string;
  season: number;
  entity: string;
  endpoint: string;
  pageCount: number;
  recordCount: number;
  status: string;
};

export type ArchiveVerification = {
  ok: boolean;
  reason?: string;
  games?: { pages: number; records: number; status: string };
  playerStats?: { pages: number; records: number; status: string };
};

export function isSuccessfulBdlManifest(m: BdlEntityManifest | null | undefined): m is BdlEntityManifest {
  if (!m) return false;
  if (m.status !== 'success' && m.status !== 'skipped') return false;
  if (!Number.isFinite(m.pageCount) || m.pageCount <= 0) return false;
  if (!Number.isFinite(m.recordCount) || m.recordCount <= 0) return false;
  return true;
}

export function assertCompleteHistoricalArchive(args: {
  season: number;
  gamesManifest: BdlEntityManifest | null;
  statsManifest: BdlEntityManifest | null;
  gamesPageKeys: string[];
  statsPageKeys: string[];
}): ArchiveVerification {
  if (!isSuccessfulBdlManifest(args.gamesManifest)) {
    return { ok: false, reason: 'games archive missing or incomplete' };
  }
  if (!isSuccessfulBdlManifest(args.statsManifest)) {
    return { ok: false, reason: 'player_stats archive missing or incomplete' };
  }
  if (args.gamesManifest.season !== args.season || args.statsManifest.season !== args.season) {
    return { ok: false, reason: 'archive season does not match requested season' };
  }
  if (args.gamesPageKeys.length !== args.gamesManifest.pageCount) {
    return {
      ok: false,
      reason: `games page objects ${args.gamesPageKeys.length} != manifest pageCount ${args.gamesManifest.pageCount}`,
    };
  }
  if (args.statsPageKeys.length !== args.statsManifest.pageCount) {
    return {
      ok: false,
      reason: `player_stats page objects ${args.statsPageKeys.length} != manifest pageCount ${args.statsManifest.pageCount}`,
    };
  }
  return {
    ok: true,
    games: {
      pages: args.gamesManifest.pageCount,
      records: args.gamesManifest.recordCount,
      status: args.gamesManifest.status,
    },
    playerStats: {
      pages: args.statsManifest.pageCount,
      records: args.statsManifest.recordCount,
      status: args.statsManifest.status,
    },
  };
}

export function canMaterializeAnalytics(verification: ArchiveVerification): boolean {
  return verification.ok === true;
}

export type ProviderAccessProbe = {
  gamesOk: boolean;
  statsOk: boolean;
  gamesError?: string;
  statsError?: string;
};

export function providerAccessBlocksBackfill(probe: ProviderAccessProbe): string | null {
  if (probe.gamesOk && probe.statsOk) return null;
  if (!probe.statsOk) {
    return (
      'BDL GET /v1/stats is unauthorized for the configured key (401). ' +
      'Game Player Stats requires ALL-STAR or GOAT. Do not partially populate analytics. ' +
      (probe.statsError ?? '')
    ).trim();
  }
  if (!probe.gamesOk) {
    return (`BDL GET /v1/games failed. ${probe.gamesError ?? ''}`).trim();
  }
  return null;
}
