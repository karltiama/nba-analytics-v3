import {
  OWLS_ENTITY_PLAYER_PROPS,
  OWLS_FIXTURE_SOURCE_PREFIX,
  OWLS_LEAGUE,
  OWLS_SOURCE_PREFIX,
  TARGET_CC_SEASONS,
} from './contract';
import { isProtectedOwlsKey, normalizeRawPrefix, owlsSourcePrefix } from './archive';
import { assertExecuteAllowed, capHistoryConcurrency, readOwlsApiKey } from './client';
import type { CourtContextGame, OwlsMode } from './types';

export const OWLS_VALUE_FLAGS = [
  '--season',
  '--from',
  '--to',
  '--game-id',
  '--run-id',
  '--phase',
  '--history-concurrency',
  '--out',
] as const;

export const OWLS_BOOLEAN_FLAGS = ['--execute', '--yes', '--fixture', '--no-resume', '--resume'] as const;

const ALLOWED_SEASONS = new Set<string>([...TARGET_CC_SEASONS, '2022']);

export type OwlsCliArgs = {
  mode: OwlsMode;
  execute: boolean;
  yes: boolean;
  resume: boolean;
  fixture: boolean;
  season?: string;
  from?: string;
  to?: string;
  gameId?: string;
  runId?: string;
  phase: number;
  historyConcurrency?: number;
  out?: string;
  seasonExplicit: boolean;
};

type FlagRead = { present: boolean; value: string | undefined; missingValue: boolean };

export function readFlag(argv: string[], name: string): FlagRead {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    const value = eq.slice(name.length + 1).trim();
    return { present: true, value: value || undefined, missingValue: value.length === 0 };
  }
  const i = argv.indexOf(name);
  if (i < 0) return { present: false, value: undefined, missingValue: false };
  const next = argv[i + 1];
  if (next == null || next.startsWith('--')) {
    return { present: true, value: undefined, missingValue: true };
  }
  return { present: true, value: next, missingValue: false };
}

function npmConfigKey(flag: string): string {
  return `npm_config_${flag.slice(2).replace(/-/g, '_')}`;
}

function readNpmConfigValue(flag: string, env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[npmConfigKey(flag)]?.trim();
  if (!raw || raw === 'true') return undefined;
  return raw;
}

function requireValue(flag: string, read: FlagRead, envFallback?: string): string | undefined {
  if (read.present && read.missingValue) {
    throw new Error(`Missing value for ${flag}. Use ${flag}=2024 or ${flag} 2024.`);
  }
  if (read.value) return read.value;
  return envFallback;
}

function leftoverSeasonToken(argv: string[]): string | undefined {
  const consumed = new Set<number>();
  for (const flag of OWLS_BOOLEAN_FLAGS) {
    const i = argv.indexOf(flag);
    if (i >= 0) consumed.add(i);
  }
  for (const flag of OWLS_VALUE_FLAGS) {
    const eqIdx = argv.findIndex((a) => a.startsWith(`${flag}=`));
    if (eqIdx >= 0) consumed.add(eqIdx);
    const i = argv.indexOf(flag);
    if (i >= 0) {
      consumed.add(i);
      if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) consumed.add(i + 1);
    }
  }
  const leftovers = argv.filter((_, i) => !consumed.has(i)).filter((a) => !a.startsWith('--'));
  const years = leftovers.filter((a) => ALLOWED_SEASONS.has(a));
  if (years.length === 1) return years[0];
  return undefined;
}

export function parseOwlsCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): OwlsCliArgs {
  const execute = argv.includes('--execute');
  const fixture = argv.includes('--fixture');
  const yes = argv.includes('--yes');
  const resume = !argv.includes('--no-resume');

  const seasonRead = readFlag(argv, '--season');
  const fromRead = readFlag(argv, '--from');
  const toRead = readFlag(argv, '--to');
  const gameIdRead = readFlag(argv, '--game-id');
  const runIdRead = readFlag(argv, '--run-id');
  const phaseRead = readFlag(argv, '--phase');
  const concRead = readFlag(argv, '--history-concurrency');
  const outRead = readFlag(argv, '--out');

  const season =
    requireValue('--season', seasonRead, readNpmConfigValue('--season', env)) ?? leftoverSeasonToken(argv);
  const from = requireValue('--from', fromRead, readNpmConfigValue('--from', env));
  const to = requireValue('--to', toRead, readNpmConfigValue('--to', env));
  const gameId = requireValue('--game-id', gameIdRead, readNpmConfigValue('--game-id', env));
  const runId = requireValue('--run-id', runIdRead, readNpmConfigValue('--run-id', env));
  const out = requireValue('--out', outRead, readNpmConfigValue('--out', env));
  const phaseRaw = requireValue('--phase', phaseRead, readNpmConfigValue('--phase', env));
  const concRaw = requireValue(
    '--history-concurrency',
    concRead,
    readNpmConfigValue('--history-concurrency', env)
  );

  const seasonExplicit = Boolean(seasonRead.present || season);
  if (season && !ALLOWED_SEASONS.has(season)) {
    throw new Error(`Invalid --season ${season}. Use 2023, 2024, or 2025.`);
  }
  if (execute && fixture) {
    throw new Error('Pass either --fixture or --execute, not both.');
  }

  const phase = phaseRaw != null ? Number(phaseRaw) : execute ? 1 : 0;
  const historyConcurrency = concRaw != null ? Number(concRaw) : undefined;
  if (concRaw != null && (!Number.isFinite(historyConcurrency) || historyConcurrency! < 1)) {
    throw new Error('Invalid --history-concurrency. Provide a positive integer.');
  }
  if (phaseRaw != null && !Number.isFinite(phase)) {
    throw new Error('Invalid --phase. Provide an integer 0-5.');
  }

  const mode: OwlsMode = execute ? 'execute' : fixture ? 'fixture' : 'dry-run';
  return {
    mode,
    execute,
    yes,
    resume,
    fixture,
    season,
    from,
    to,
    gameId,
    runId,
    phase: Number.isFinite(phase) ? phase : 0,
    historyConcurrency: historyConcurrency != null ? capHistoryConcurrency(historyConcurrency) : undefined,
    out,
    seasonExplicit,
  };
}

export function assertRequestedSeasonScope(
  suppliedSeason: string | undefined,
  games: CourtContextGame[]
): void {
  if (!suppliedSeason) return;
  const seasons = [...new Set(games.map((g) => g.season))].sort();
  if (seasons.length === 0) {
    throw new Error(`Season scope mismatch: --season ${suppliedSeason} resolved to 0 games.`);
  }
  if (seasons.length !== 1 || seasons[0] !== suppliedSeason) {
    throw new Error(
      `Season scope mismatch: --season ${suppliedSeason} unexpectedly resolved to [${seasons.join(', ')}]. Fail closed.`
    );
  }
}

export type ExecuteSummary = {
  provider: 'Owls Insight';
  phase: number;
  seasons: string[];
  dateRange: string;
  courtContextGames: number;
  expectedRequestScope: string;
  s3Bucket: string;
  s3Prefix: string;
  concurrency: number;
  resume: 'enabled' | 'disabled';
};

export function buildExecuteSummary(args: {
  cli: OwlsCliArgs;
  games: CourtContextGame[];
  bucket: string;
  rawPrefix?: string;
  estimatedHistoryRequests?: number | string;
}): ExecuteSummary {
  const seasons = [...new Set(args.games.map((g) => g.season))].sort();
  const dates = args.games.map((g) => g.startTime.slice(0, 10)).sort();
  const prefix =
    `${normalizeRawPrefix(args.rawPrefix)}/source=${owlsSourcePrefix(false)}` +
    `/league=${OWLS_LEAGUE}/season=${seasons[0] ?? '*'}/entity=${OWLS_ENTITY_PLAYER_PROPS}/`;
  return {
    provider: 'Owls Insight',
    phase: args.cli.phase,
    seasons,
    dateRange:
      args.cli.from || args.cli.to
        ? `${args.cli.from ?? '...'} → ${args.cli.to ?? '...'}`
        : dates.length
          ? `${dates[0]} → ${dates[dates.length - 1]}`
          : 'n/a',
    courtContextGames: args.games.length,
    expectedRequestScope: String(args.estimatedHistoryRequests ?? 'unknown until live probe'),
    s3Bucket: args.bucket,
    s3Prefix: prefix,
    concurrency: capHistoryConcurrency(args.cli.historyConcurrency),
    resume: args.cli.resume ? 'enabled' : 'disabled',
  };
}

export function formatExecuteSummary(summary: ExecuteSummary): string {
  return [
    `Provider: ${summary.provider}`,
    `Phase: ${summary.phase}`,
    `Seasons: [${summary.seasons.join(', ')}]`,
    `Date range: ${summary.dateRange}`,
    `Court Context games: ${summary.courtContextGames}`,
    `Expected request scope: ${summary.expectedRequestScope}`,
    `S3 bucket: ${summary.s3Bucket}`,
    `S3 prefix: ${summary.s3Prefix}`,
    `Concurrency: ${summary.concurrency}`,
    `Resume: ${summary.resume}`,
  ].join('\n');
}

export function assertExecuteArchiveTarget(args: { fixture: boolean; rawPrefix?: string; sampleKey?: string }): void {
  if (args.fixture) {
    throw new Error('Refusing --execute with fixture mode/prefix.');
  }
  const sample =
    args.sampleKey ??
    `${normalizeRawPrefix(args.rawPrefix)}/source=${OWLS_SOURCE_PREFIX}/league=${OWLS_LEAGUE}/probe.json.gz`;
  if (sample.includes(`/source=${OWLS_FIXTURE_SOURCE_PREFIX}/`)) {
    throw new Error('Refusing --execute against the fixture S3 prefix.');
  }
  if (isProtectedOwlsKey(sample)) {
    throw new Error(`Refusing --execute against a protected prefix: ${sample}`);
  }
}

export function requireExecutePreconditions(
  args: OwlsCliArgs,
  env: NodeJS.ProcessEnv = process.env
): { apiKey: string; bucket: string } {
  const key = readOwlsApiKey(env);
  assertExecuteAllowed('execute', key);
  if (!args.yes) {
    throw new Error('Refusing to start live Owls requests without --yes.');
  }
  const bucket = env.NBA_DATA_BUCKET?.trim() ?? '';
  if (!bucket) {
    throw new Error('NBA_DATA_BUCKET is required for --execute.');
  }
  assertExecuteArchiveTarget({ fixture: args.fixture, rawPrefix: env.NBA_RAW_PREFIX });
  return { apiKey: key!, bucket };
}

export function defaultRunId(args: OwlsCliArgs, now = new Date()): string {
  if (args.runId) return args.runId;
  const day = now.toISOString().slice(0, 10);
  if (args.phase === 1) return `owls-${day}-probe`;
  if (args.season) return `owls-${day}-season-${args.season}`;
  return `owls-${day}-plan`;
}
