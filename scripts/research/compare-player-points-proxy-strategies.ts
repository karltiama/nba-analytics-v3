import 'dotenv/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '@/lib/aws/s3';
import {
  buildProxyStrategyComparison,
  renderProxyStrategyComparisonMarkdownReport,
  type SeasonSweepResultsPayload,
} from '@/lib/research/proxy-strategy-comparison';

type CliArgs = {
  seasons: number[];
  dryRun: boolean;
};

function fatal(msg: string): never {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) fatal(`Missing required env var: ${name}`);
  return v;
}

function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) flags[raw.slice(2)] = true;
    else flags[raw.slice(2, eq)] = raw.slice(eq + 1);
  }

  const defaultSeasons = [2023, 2024, 2025];
  const seasonsRaw =
    typeof flags.seasons === 'string'
      ? flags.seasons
      : typeof process.env.npm_config_seasons === 'string'
        ? process.env.npm_config_seasons
        : defaultSeasons.join(',');
  let seasons = [...new Set(seasonsRaw.split(',').map((s) => Number(s.trim())))]
    .filter((n) => Number.isFinite(n) && n >= 1900 && n <= 3000)
    .sort((a, b) => a - b);
  if (seasons.length === 0) {
    seasons = defaultSeasons;
    console.warn(
      `[warn] Could not parse --seasons argument from npm forwarding; defaulting to ${defaultSeasons.join(',')}.`
    );
  }
  const dryRunFromNpmConfig =
    process.env.npm_config_dry_run === 'true' || process.env.npm_config_dryrun === 'true';
  return {
    seasons,
    dryRun: flags['dry-run'] === true || dryRunFromNpmConfig,
  };
}

function seasonInputKey(season: number): string {
  return `research/strategy-sweeps/league=nba/target=score_above_season_avg/season=${season}/results.json`;
}

function outputPrefix(seasons: number[]): string {
  const tag = seasons.join('-');
  return `research/strategy-sweeps/league=nba/target=score_above_season_avg/comparison/seasons=${tag}`;
}

function parseSeasonPayload(raw: unknown): SeasonSweepResultsPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (
    typeof rec.season !== 'number' ||
    typeof rec.target_definition !== 'string' ||
    typeof rec.generated_at !== 'string' ||
    !Array.isArray(rec.strategies)
  ) {
    return null;
  }
  return rec as SeasonSweepResultsPayload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3 = new S3Storage({ bucket, client: new S3Client({ region }) });

  const outPrefix = outputPrefix(args.seasons);
  const outJson = `${outPrefix}/results.json`;
  const outMd = `${outPrefix}/report.md`;

  console.log(`seasons=${args.seasons.join(',')}`);
  console.log(`output_json=s3://${bucket}/${outJson}`);
  console.log(`output_md=s3://${bucket}/${outMd}`);

  const availablePayloads: SeasonSweepResultsPayload[] = [];
  const missingSeasons: number[] = [];
  const inputPaths: string[] = [];

  for (const season of args.seasons) {
    const key = seasonInputKey(season);
    inputPaths.push(`s3://${bucket}/${key}`);
    const text = await s3.getText(key);
    if (text == null) {
      missingSeasons.push(season);
      continue;
    }
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(text) as unknown;
    } catch {
      console.warn(`[warn] invalid JSON for season=${season}: s3://${bucket}/${key}`);
      missingSeasons.push(season);
      continue;
    }
    const payload = parseSeasonPayload(parsedRaw);
    if (!payload) {
      console.warn(`[warn] malformed payload for season=${season}: s3://${bucket}/${key}`);
      missingSeasons.push(season);
      continue;
    }
    availablePayloads.push(payload);
  }

  if (availablePayloads.length === 0) {
    fatal(
      `No valid season results found for requested seasons (${args.seasons.join(', ')}). ` +
        'Run research:points-proxy-sweep for at least one season first.'
    );
  }

  if (missingSeasons.length > 0) {
    console.warn(
      `[warn] missing season outputs: ${missingSeasons.join(', ')}. ` +
        'Comparison will use available seasons only.'
    );
  }

  const built = buildProxyStrategyComparison({
    requestedSeasons: args.seasons,
    availablePayloads,
  });

  const generatedAt = new Date().toISOString();
  const payload = {
    seasons: built.requested_seasons,
    included_seasons: built.included_seasons,
    missing_seasons: built.missing_seasons,
    target_definition: 'actual_points > points_season_avg_before_game',
    generated_at: generatedAt,
    input_paths: inputPaths,
    output_path: `s3://${bucket}/${outPrefix}/`,
    strategy_summary: built.strategy_summary,
    per_season_rows: built.per_season_rows,
  };
  const markdown = renderProxyStrategyComparisonMarkdownReport({
    seasons: built.requested_seasons,
    targetDefinition: payload.target_definition,
    generatedAt,
    inputPaths: inputPaths,
    outputPath: payload.output_path,
    missingSeasons: built.missing_seasons,
    strategySummary: built.strategy_summary,
    perSeasonRows: built.per_season_rows,
  });

  if (args.dryRun) {
    console.log('[dry-run] no files were written.');
    console.log(
      JSON.stringify(
        {
          seasons: built.requested_seasons,
          included_seasons: built.included_seasons,
          missing_seasons: built.missing_seasons,
          output_json: `s3://${bucket}/${outJson}`,
          output_md: `s3://${bucket}/${outMd}`,
          strategies_compared: built.strategy_summary.length,
        },
        null,
        2
      )
    );
    return;
  }

  await s3.putText(outJson, JSON.stringify(payload, null, 2) + '\n', {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  await s3.putText(outMd, markdown, {
    overwrite: true,
    contentType: 'text/markdown; charset=utf-8',
  });
  console.log(`[ok] wrote s3://${bucket}/${outJson}`);
  console.log(`[ok] wrote s3://${bucket}/${outMd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
