/**
 * Pre-GOAT operator status. Read-only. Never activates the trial.
 */

import fs from 'node:fs';
import path from 'node:path';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { isBdlTrialMode, resolveBdlRequestDelayMs } from '@/lib/balldontlie/trial-limiter';
import { goatStatsRepairCount } from '@/lib/ingestion/goat-stats-repair-queue';
import { assertLegacyRawStatsPathAllowed } from '@/lib/ingestion/legacy-raw-guard';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';
import type { StorageCheckpointLike } from './trial-storage-gate';
import { GLOBAL_HARD_STOP_MB } from './trial-storage-gate';

export type StatusTraffic = 'GREEN' | 'YELLOW' | 'RED' | 'FROZEN_EXPECTED';

export type PreGoatStatus = {
  storage: { grade: StatusTraffic; dbMb: number | null; remainingTo450Mb: number | null; latestCheckpoint: string | null };
  season2025: { grade: StatusTraffic; providerFinals: number | null; completeStatsGames: number | null; remainingGoatRepairs: number };
  historical: {
    archive2024: StatusTraffic;
    serving2024: StatusTraffic;
    archive2023: StatusTraffic;
    serving2023: StatusTraffic;
  };
  acquisition: {
    advanced: StatusTraffic;
    openingProps: StatusTraffic;
    openingOdds: StatusTraffic;
    lineups: StatusTraffic;
  };
  safety: {
    production: StatusTraffic;
    trialLimiter: StatusTraffic;
    trialLimiterDetail: string;
    acquisitionLock: StatusTraffic;
    historicalRawGuard: StatusTraffic;
    seasonPin: string;
  };
  overall: 'READY' | 'NOT READY';
  lines: string[];
};

function checkpointMb(file: string | null): { mb: number | null; file: string | null } {
  if (!file || !fs.existsSync(file)) return { mb: null, file };
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as StorageCheckpointLike;
    const mb = doc.postgres?.mb ?? (doc.postgres?.bytes != null ? doc.postgres.bytes / (1024 * 1024) : null);
    return { mb: mb == null ? null : Math.round(mb * 100) / 100, file };
  } catch {
    return { mb: null, file };
  }
}

function latestCheckpoint(root: string): string | null {
  const dir = path.join(root, 'reports', 'storage');
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

function scriptReady(root: string, rel: string): StatusTraffic {
  return fs.existsSync(path.join(root, rel)) ? 'GREEN' : 'RED';
}

export function buildPreGoatStatus(args?: {
  root?: string;
  env?: NodeJS.ProcessEnv;
  completeness?: { providerFinalGames?: number; localCompleteGames?: number } | null;
}): PreGoatStatus {
  const root = args?.root ?? process.cwd();
  const env = args?.env ?? process.env;
  const mode = readIngestionMode(env);
  const pin = getAnalyticsSeason(env);
  const cp = checkpointMb(latestCheckpoint(root));
  const remaining = cp.mb == null ? null : Math.round((GLOBAL_HARD_STOP_MB - cp.mb) * 100) / 100;
  const storageGrade: StatusTraffic =
    cp.mb == null ? 'YELLOW' : cp.mb >= GLOBAL_HARD_STOP_MB ? 'RED' : 'GREEN';

  const completenessPath = path.join(root, 'reports', 'trial', 'pre-goat-completeness.json');
  let providerFinals: number | null = args?.completeness?.providerFinalGames ?? null;
  let completeStats: number | null = args?.completeness?.localCompleteGames ?? null;
  if ((providerFinals == null || completeStats == null) && fs.existsSync(completenessPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(completenessPath, 'utf8')) as {
        providerFinalGames?: number;
        localCompleteGames?: number;
      };
      providerFinals = providerFinals ?? c.providerFinalGames ?? null;
      completeStats = completeStats ?? c.localCompleteGames ?? null;
    } catch {
      // ignore
    }
  }

  const goatLeft = goatStatsRepairCount();
  const season2025Grade: StatusTraffic = goatLeft > 0 ? 'YELLOW' : 'GREEN';

  let limiterGrade: StatusTraffic = 'YELLOW';
  let limiterDetail = 'BDL_TRIAL_MODE unset (ok until execute)';
  try {
    const delay = resolveBdlRequestDelayMs({ env });
    if (delay.trialMode && delay.delayMs >= 12_000 && delay.concurrency === 1) {
      limiterGrade = 'GREEN';
      limiterDetail = `5 req/min delayMs=${delay.delayMs}`;
    } else if (!delay.trialMode) {
      limiterGrade = 'GREEN';
      limiterDetail = `idle (enable BDL_TRIAL_MODE=1 before execute) default ${delay.delayMs}ms`;
    }
  } catch (e) {
    limiterGrade = 'RED';
    limiterDetail = e instanceof Error ? e.message : String(e);
  }
  if (isBdlTrialMode(env)) {
    try {
      resolveBdlRequestDelayMs({ env });
      limiterGrade = 'GREEN';
    } catch {
      limiterGrade = 'RED';
    }
  }

  let guard: StatusTraffic = 'GREEN';
  try {
    assertLegacyRawStatsPathAllowed({ season: 2024, withStats: true, allowHistoricalRawStats: false }, env);
    guard = 'RED';
  } catch {
    guard = 'GREEN';
  }

  const lock = bdlAcquisitionLockStatus();
  const lockGrade: StatusTraffic = lock.active ? 'YELLOW' : 'GREEN';
  const production: StatusTraffic = mode.shouldSkipMutations ? 'FROZEN_EXPECTED' : 'RED';

  const histArchive = (): StatusTraffic =>
    scriptReady(root, 'scripts/archive/backfill-balldontlie-season.ts') === 'GREEN' &&
    fs.existsSync(path.join(root, 'scripts/ingestion/backfill-historical-season-serving.ts'))
      ? 'GREEN'
      : 'RED';

  const servingReady = scriptReady(root, 'lib/ingestion/historical-serving/orchestrate.ts');
  const acquisition = {
    advanced: scriptReady(root, 'scripts/archive/backfill-advanced-stats-v2.ts'),
    openingProps: scriptReady(root, 'scripts/archive/backfill-opening-player-props.ts'),
    openingOdds: scriptReady(root, 'scripts/archive/backfill-opening-game-odds.ts'),
    lineups: scriptReady(root, 'scripts/archive/backfill-lineups-2025.ts'),
  };

  const overall: 'READY' | 'NOT READY' =
    storageGrade !== 'RED' &&
    servingReady === 'GREEN' &&
    guard === 'GREEN' &&
    production === 'FROZEN_EXPECTED' &&
    limiterGrade !== 'RED' &&
    acquisition.advanced === 'GREEN' &&
    acquisition.openingProps === 'GREEN' &&
    acquisition.openingOdds === 'GREEN' &&
    acquisition.lineups === 'GREEN'
      ? 'READY'
      : 'NOT READY';

  const lines = [
    'PRE-GOAT STATUS',
    '',
    `Storage                 ${storageGrade} ${cp.mb != null ? `${Math.round(cp.mb)} MB` : 'no checkpoint'}`,
    `2025 games              ${season2025Grade} ${goatLeft} stats repairs queued`,
    `2024 S3                 ${histArchive()}`,
    `2024 serving            ${servingReady}`,
    `2023 S3                 ${histArchive()}`,
    `2023 serving            ${servingReady}`,
    `Trial limiter           ${limiterGrade} ${limiterDetail}`,
    `Historical raw guard    ${guard}`,
    `Advanced archive        ${acquisition.advanced}`,
    `Opening props archive   ${acquisition.openingProps}`,
    `Opening odds archive    ${acquisition.openingOdds}`,
    `Lineups archive         ${acquisition.lineups}`,
    `Production              ${production}`,
    `Season pin              ${pin}`,
    `Acquisition lock        ${lockGrade}${lock.active ? ` pid=${lock.pid}` : ''}`,
    '',
    `Overall:`,
    overall,
  ];

  return {
    storage: {
      grade: storageGrade,
      dbMb: cp.mb,
      remainingTo450Mb: remaining,
      latestCheckpoint: cp.file,
    },
    season2025: {
      grade: season2025Grade,
      providerFinals,
      completeStatsGames: completeStats,
      remainingGoatRepairs: goatLeft,
    },
    historical: {
      archive2024: histArchive(),
      serving2024: servingReady,
      archive2023: histArchive(),
      serving2023: servingReady,
    },
    acquisition,
    safety: {
      production,
      trialLimiter: limiterGrade,
      trialLimiterDetail: limiterDetail,
      acquisitionLock: lockGrade,
      historicalRawGuard: guard,
      seasonPin: pin,
    },
    overall,
    lines,
  };
}
