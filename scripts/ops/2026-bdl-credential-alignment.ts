/**
 * Step 13D.2 credential alignment diagnostic.
 * Fingerprints BALLDONTLIE_API_KEY sources. Never prints secret values.
 *
 *   npx tsx scripts/ops/2026-bdl-credential-alignment.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  assignFingerprintClusters,
  bdlAuthorizationHeader,
  inspectBdlApiKey,
  type BdlKeyInspection,
} from '../../lib/balldontlie/credential-fingerprint';
import { fetchBdlLive } from '../../lib/balldontlie/live-rate-limit';

const ROOT = process.cwd();
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

type SourceRow = {
  label: string;
  origin: string;
  inspection: BdlKeyInspection;
};

function parseDotEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function firstBdl(env: Record<string, string | undefined>): string | undefined {
  const a = env.BALLDONTLIE_API_KEY;
  const b = env.BALDONTLIE_API_KEY;
  if (a != null && a !== '') return a;
  if (b != null && b !== '') return b;
  return undefined;
}

function readFileIfExists(rel: string): string | null {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function tfvarsBdlByBlock(contents: string): Array<{ label: string; value: string }> {
  const blocks = [
    'lambda_env',
    'odds_lambda_env',
    'injuries_lambda_env',
    'player_props_lambda_env',
    'player_props_controller_env',
  ];
  const found: Array<{ label: string; value: string }> = [];
  for (const block of blocks) {
    const blockRe = new RegExp(`${block}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
    const m = contents.match(blockRe);
    if (!m) continue;
    const keyM = m[1].match(/BALLDONTLIE_API_KEY\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    if (!keyM) continue;
    found.push({ label: `tfvars:${block}`, value: keyM[1] ?? keyM[2] ?? '' });
  }
  return found;
}

function awsLambdaEnvValue(functionName: string, name: string): string | null {
  try {
    const out = execFileSync(
      'aws',
      [
        'lambda',
        'get-function-configuration',
        '--function-name',
        functionName,
        '--region',
        AWS_REGION,
        '--query',
        `Environment.Variables.${name}`,
        '--output',
        'text',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const v = out.replace(/\r?\n$/, '');
    if (!v || v === 'None' || v === 'null') return null;
    return v;
  } catch {
    return null;
  }
}

function terraformStateBdlFingerprints(): {
  present: boolean;
  uniqueClusterCount: number | null;
  note: string;
} {
  try {
    const json = execFileSync('terraform', ['show', '-json'], {
      cwd: path.join(ROOT, 'infra'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const fps = new Set<string>();
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      const rec = node as Record<string, unknown>;
      if (typeof rec.BALLDONTLIE_API_KEY === 'string') {
        const fp = inspectBdlApiKey(rec.BALLDONTLIE_API_KEY).fingerprint;
        if (fp) fps.add(fp);
      }
      for (const value of Object.values(rec)) walk(value);
    };
    walk(JSON.parse(json) as unknown);
    return {
      present: fps.size > 0,
      uniqueClusterCount: fps.size,
      note: fps.size
        ? 'BALLDONTLIE_API_KEY values exist in terraform state (sensitive maps still stored in state)'
        : 'no BALLDONTLIE_API_KEY strings found in terraform show -json',
    };
  } catch {
    return {
      present: false,
      uniqueClusterCount: null,
      note: 'terraform show -json unavailable (not treated as a credential value leak)',
    };
  }
}

function publicInspection(row: SourceRow, cluster: string) {
  return {
    label: row.label,
    origin: row.origin,
    cluster,
    present: row.inspection.present,
    emptyAfterTrim: row.inspection.emptyAfterTrim,
    hadSurroundingWhitespace: row.inspection.hadSurroundingWhitespace,
    hadInternalNewline: row.inspection.hadInternalNewline,
    bearerPrefix: row.inspection.bearerPrefix,
  };
}

function canonicalizeDotenvName(): { wrote: boolean; reason: string } {
  const abs = path.join(ROOT, '.env');
  if (!fs.existsSync(abs)) return { wrote: false, reason: 'missing .env' };
  const contents = fs.readFileSync(abs, 'utf8');
  const parsed = parseDotEnv(contents);
  if (parsed.BALLDONTLIE_API_KEY) return { wrote: false, reason: 'canonical BALLDONTLIE_API_KEY already present' };
  if (!parsed.BALDONTLIE_API_KEY) return { wrote: false, reason: 'no BALDONTLIE_API_KEY typo alias either' };
  const quoted = JSON.stringify(parsed.BALDONTLIE_API_KEY);
  fs.appendFileSync(
    abs,
    `\n# Canonical spelling (13D.2). Same credential as BALDONTLIE_API_KEY.\nBALLDONTLIE_API_KEY=${quoted}\n`
  );
  return { wrote: true, reason: 'appended canonical BALLDONTLIE_API_KEY from typo alias (value not printed)' };
}

function deprecateTypoAlias(): { wrote: boolean; reason: string } {
  const abs = path.join(ROOT, '.env');
  if (!fs.existsSync(abs)) return { wrote: false, reason: 'missing .env' };
  const contents = fs.readFileSync(abs, 'utf8');
  const parsed = parseDotEnv(contents);
  if (!parsed.BALLDONTLIE_API_KEY) {
    return { wrote: false, reason: 'refused: canonical BALLDONTLIE_API_KEY missing' };
  }
  if (!parsed.BALDONTLIE_API_KEY) {
    return { wrote: false, reason: 'typo alias already absent' };
  }
  const next = contents
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*#/.test(line)) return line;
      if (/^\s*BALDONTLIE_API_KEY\s*=/.test(line)) {
        return `# Deprecated typo alias (13D.3). Use BALLDONTLIE_API_KEY.\n# ${line}`;
      }
      return line;
    })
    .join('\n');
  if (next === contents) return { wrote: false, reason: 'no typo alias line to comment out' };
  fs.writeFileSync(abs, next);
  return { wrote: true, reason: 'commented out BALDONTLIE_API_KEY typo alias (value not printed)' };
}

function upsertDotenvCanonical(canonical: string): { wrote: boolean; reason: string } {
  const abs = path.join(ROOT, '.env');
  if (!fs.existsSync(abs)) return { wrote: false, reason: 'missing .env' };
  const contents = fs.readFileSync(abs, 'utf8');
  const quoted = JSON.stringify(canonical);
  const line = `BALLDONTLIE_API_KEY=${quoted}`;
  const lines = contents.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((row) => {
    if (/^\s*#/.test(row)) return row;
    if (/^\s*BALLDONTLIE_API_KEY\s*=/.test(row)) {
      replaced = true;
      return line;
    }
    return row;
  });
  if (!replaced) {
    next.push('# Canonical BALLDONTLIE_API_KEY (13D.3). Synced from terraform.tfvars; value not logged.');
    next.push(line);
  }
  fs.writeFileSync(abs, next.join('\n').replace(/\n*$/, '\n'));
  return {
    wrote: true,
    reason: replaced
      ? 'replaced canonical BALLDONTLIE_API_KEY from tfvars cluster (value not printed)'
      : 'appended canonical BALLDONTLIE_API_KEY from tfvars cluster (value not printed)',
  };
}

function syncDotenvFromTfvars(): { wrote: boolean; reason: string } {
  const tfvars = readFileIfExists('infra/terraform.tfvars');
  if (tfvars == null) return { wrote: false, reason: 'missing infra/terraform.tfvars' };
  const blocks = tfvarsBdlByBlock(tfvars);
  if (blocks.length === 0) return { wrote: false, reason: 'no tfvars BALLDONTLIE_API_KEY blocks' };
  const fingerprints = new Set(
    blocks.map((b) => inspectBdlApiKey(b.value).fingerprint).filter((fp): fp is string => Boolean(fp))
  );
  if (fingerprints.size !== 1) {
    return { wrote: false, reason: `refused: tfvars BDL keys span ${fingerprints.size} clusters` };
  }
  const source = blocks.find((b) => b.label === 'tfvars:injuries_lambda_env') ?? blocks[0];
  return upsertDotenvCanonical(source.value);
}

function syncTfvarsFromDotenv(): { wrote: boolean; reason: string } {
  const parsed = parseDotEnv(readFileIfExists('.env') ?? '');
  const canonical = parsed.BALLDONTLIE_API_KEY;
  if (!canonical) return { wrote: false, reason: 'canonical BALLDONTLIE_API_KEY missing in .env' };
  const localFp = inspectBdlApiKey(canonical).fingerprint;
  const deployed = awsLambdaEnvValue('injuries-snapshot', 'BALLDONTLIE_API_KEY');
  const deployedFp = inspectBdlApiKey(deployed ?? undefined).fingerprint;
  if (localFp && deployedFp && localFp === deployedFp) {
    return {
      wrote: false,
      reason:
        'refused: .env still matches deployed injuries Lambda cluster (would reintroduce the current cluster)',
    };
  }
  const tfPath = path.join(ROOT, 'infra/terraform.tfvars');
  if (!fs.existsSync(tfPath)) return { wrote: false, reason: 'missing infra/terraform.tfvars' };
  const contents = fs.readFileSync(tfPath, 'utf8');
  const next = contents.replace(
    /BALLDONTLIE_API_KEY\s*=\s*(?:"[^"]*"|'[^']*')/g,
    `BALLDONTLIE_API_KEY = ${JSON.stringify(canonical)}`
  );
  if (next === contents) return { wrote: false, reason: 'no BALLDONTLIE_API_KEY assignments found in tfvars' };
  fs.writeFileSync(tfPath, next);
  return {
    wrote: true,
    reason: 'replaced all tfvars BALLDONTLIE_API_KEY assignments from canonical .env (value not printed)',
  };
}

function liveLimiterEnv(worker: string): Record<string, string | undefined> {
  return {
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    BDL_RATE_LIMIT_BACKEND: 'dynamodb',
    BDL_RATE_LIMIT_TABLE: process.env.BDL_RATE_LIMIT_TABLE || 'nba-bdl-rate-limit',
    BDL_RATE_LIMIT_INTERVAL_MS: process.env.BDL_RATE_LIMIT_INTERVAL_MS || '13000',
    BDL_RATE_LIMIT_MAX_REQUESTS: '1',
    BDL_RATE_LIMIT_BURST: '1',
    BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS: process.env.BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS || '90000',
    BDL_RATE_LIMIT_WORKER: worker,
    MAX_RETRIES: '3',
  };
}

async function smokeGames(): Promise<{ status: number; ok: boolean; worker: string }> {
  const parsed = parseDotEnv(readFileIfExists('.env') ?? '');
  const raw = firstBdl(parsed);
  const headers = bdlAuthorizationHeader(raw ?? '');
  const url = 'https://api.balldontlie.io/nba/v1/games?seasons[]=2026&per_page=1';
  const worker = 'credential-alignment-games-smoke';
  const res = await fetchBdlLive(url, { headers }, { env: liveLimiterEnv(worker), worker });
  return { status: res.status, ok: res.ok, worker };
}

async function main() {
  const canonicalize = process.argv.includes('--canonicalize-dotenv-name')
    ? canonicalizeDotenvName()
    : { wrote: false, reason: 'not requested' };
  const syncedTfvars = process.argv.includes('--sync-tfvars-from-dotenv')
    ? syncTfvarsFromDotenv()
    : { wrote: false, reason: 'not requested' };
  const syncedDotenv = process.argv.includes('--sync-dotenv-from-tfvars')
    ? syncDotenvFromTfvars()
    : { wrote: false, reason: 'not requested' };
  const typoDeprecated = process.argv.includes('--deprecate-typo-alias')
    ? deprecateTypoAlias()
    : { wrote: false, reason: 'not requested' };

  const rows: SourceRow[] = [];
  const shellBall = process.env.BALLDONTLIE_API_KEY;
  const shellTypo = process.env.BALDONTLIE_API_KEY;
  rows.push({
    label: 'shell:BALLDONTLIE_API_KEY',
    origin: 'process.env before dotenv',
    inspection: inspectBdlApiKey(shellBall),
  });
  rows.push({
    label: 'shell:BALDONTLIE_API_KEY',
    origin: 'process.env before dotenv',
    inspection: inspectBdlApiKey(shellTypo),
  });

  for (const file of ['.env', '.env.local', '.env.development.local']) {
    const contents = readFileIfExists(file);
    if (contents == null) {
      rows.push({
        label: `file:${file}`,
        origin: file,
        inspection: inspectBdlApiKey(undefined),
      });
      continue;
    }
    const parsed = parseDotEnv(contents);
    rows.push({
      label: `file:${file}:BALLDONTLIE_API_KEY`,
      origin: file,
      inspection: inspectBdlApiKey(parsed.BALLDONTLIE_API_KEY),
    });
    rows.push({
      label: `file:${file}:BALDONTLIE_API_KEY`,
      origin: file,
      inspection: inspectBdlApiKey(parsed.BALDONTLIE_API_KEY),
    });
  }

  const tfvars = readFileIfExists('infra/terraform.tfvars');
  if (tfvars == null) {
    rows.push({
      label: 'tfvars:missing',
      origin: 'infra/terraform.tfvars',
      inspection: inspectBdlApiKey(undefined),
    });
  } else {
    for (const block of tfvarsBdlByBlock(tfvars)) {
      rows.push({
        label: block.label,
        origin: 'infra/terraform.tfvars',
        inspection: inspectBdlApiKey(block.value),
      });
    }
  }

  const lambdas: Array<[string, string]> = [
    ['lambda:nightly-bdl-updater', 'nightly-bdl-updater'],
    ['lambda:injuries-snapshot', 'injuries-snapshot'],
    ['lambda:odds-pre-game-snapshot', 'odds-pre-game-snapshot'],
    ['lambda:nba-player-props-ingestion', 'nba-player-props-ingestion-lambda'],
    ['lambda:nba-player-props-controller', 'nba-player-props-controller-lambda'],
  ];
  for (const [label, fn] of lambdas) {
    const value = awsLambdaEnvValue(fn, 'BALLDONTLIE_API_KEY');
    const typo = value ? null : awsLambdaEnvValue(fn, 'BALDONTLIE_API_KEY');
    rows.push({
      label,
      origin: `aws lambda ${fn} env`,
      inspection: inspectBdlApiKey(value ?? typo ?? undefined),
    });
  }

  const clusters = assignFingerprintClusters(
    rows.map((row) => ({ label: row.label, fingerprint: row.inspection.fingerprint }))
  );
  const presentClusters = [
    ...new Set(Object.values(clusters).filter((c) => c !== 'ABSENT')),
  ];

  const dotenvCanary = firstBdl({
    BALLDONTLIE_API_KEY: parseDotEnv(readFileIfExists('.env') ?? '').BALLDONTLIE_API_KEY,
    BALDONTLIE_API_KEY: parseDotEnv(readFileIfExists('.env') ?? '').BALDONTLIE_API_KEY,
  });
  const dotenvInspect = inspectBdlApiKey(dotenvCanary);
  const dotenvOverride =
    inspectBdlApiKey(shellBall).present &&
    dotenvInspect.fingerprint != null &&
    inspectBdlApiKey(shellBall).fingerprint !== dotenvInspect.fingerprint;

  const gamesSmoke = process.argv.includes('--smoke-games') ? await smokeGames() : null;

  const report = {
    generatedAt: new Date().toISOString(),
    printsSecrets: false,
    printsFingerprints: false,
    dotenvCanonicalize: canonicalize,
    tfvarsSyncFromDotenv: syncedTfvars,
    dotenvSyncFromTfvars: syncedDotenv,
    typoAliasDeprecated: typoDeprecated,
    dotenvDoesNotOverrideShell: true,
    canaryLoads: '.env only (not .env.local); shell env wins if already set',
    secretsManager: 'none',
    ssm: 'none',
    vercel: 'audit-only; Next.js app routes do not read BALLDONTLIE_API_KEY',
    terraformState: terraformStateBdlFingerprints(),
    uniquePresentClusters: presentClusters,
    clusterCount: presentClusters.length,
    shellOverridesDotenv: dotenvOverride,
    headerConvention: 'Authorization: <raw key>; strip Bearer/whitespace before send',
    gamesSmoke,
    sources: rows.map((row) => publicInspection(row, clusters[row.label] ?? 'ABSENT')),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'alignment failed');
  process.exit(1);
});
