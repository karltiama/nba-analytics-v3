import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAcqArchiveStore } from '@/lib/acquisition/archive';
import { createMemoryAcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { createMemoryScoreboardStore } from '@/lib/scoreboard/store';

const root = path.resolve(__dirname, '../../..');
// Built into a temp dir: lambda/scoreboard/.package is what a reviewed Terraform plan would hash.
const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scoreboard-artifact-'));
const packageDir = path.join(outRoot, 'scoreboard/.package');
const artifactPath = path.join(packageDir, 'dist/index.js');
const require = createRequire(import.meta.url);

type Artifact = { runLambdaScoreboard: (deps?: Record<string, unknown>) => Promise<Record<string, any>> };
const loadArtifact = (): Artifact => require(artifactPath);

const FROZEN = { DATA_MODE: 'replay', OFFSEASON_MODE: '1', CRON_DRY_RUN: '1', LIVE_INGESTION_ENABLED: '0' };
const LIVE = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: '1',
  SCOREBOARD_COLLECT_PRESEASON: '1',
  SCOREBOARD_TARGET_SEASON: '2026',
  BALLDONTLIE_API_KEY: 'test-not-a-real-key',
  NBA_RAW_PREFIX: 'raw',
  BDL_RATE_LIMIT_BACKEND: 'memory',
  BDL_RATE_LIMIT_BURST: '5',
  BDL_RATE_LIMIT_INTERVAL_MS: '500',
  BDL_RATE_LIMIT_WORKER: 'scoreboard-collector',
};

afterEach(() => vi.unstubAllGlobals());

describe('scoreboard built artifact', () => {
  it('builds into an isolated dir and never writes lambda/scoreboard/.package', () => {
    const real = path.join(root, 'lambda/scoreboard/.package/dist/index.js');
    const before = fs.existsSync(real) ? fs.statSync(real).mtimeMs : null;
    const result = spawnSync(process.execPath, ['lambda/scoreboard/build.mjs', `--out-root=${outRoot}`], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.existsSync(artifactPath)).toBe(true);
    expect(fs.existsSync(real) ? fs.statSync(real).mtimeMs : null).toBe(before);
  });

  it('bundle writes display storage and acquisition archives only; no analytics, raw game tables or ESPN', () => {
    const src = fs.readFileSync(artifactPath, 'utf8');
    expect(src).toContain('display.scoreboard_games');
    expect(src).toContain('display.scoreboard_player_lines');
    expect(src).toContain('insert into raw.acquisition_requests');
    expect(src).toContain('acq_envelope.v1');
    expect(src).toContain('IfNoneMatch');
    expect(src).toContain('fetchBdlLive');
    expect(src).not.toMatch(/\banalytics\.[a-z_]+/i);
    expect(src).not.toMatch(/\braw\.(games|players|teams|player_\w+)\b/i);
    expect(src).not.toMatch(/player_game_logs|projection_ledger|player_injur/i);
    expect(src).not.toMatch(/espn/i);
    expect(src).not.toMatch(/require\(["']@\//);
    expect(src).not.toMatch(/AKIA[0-9A-Z]{16}/);
    const names = fs.readdirSync(packageDir, { recursive: true }).map(String);
    for (const n of names) expect(n).not.toMatch(/(^|[\\/])\.env|tfvars|credentials/i);
  });

  it('frozen or non-preseason configuration makes zero provider calls', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { runLambdaScoreboard } = loadArtifact();
    const frozen = await runLambdaScoreboard({ env: { ...FROZEN, SCOREBOARD_COLLECT_PRESEASON: '1' } });
    expect(frozen).toMatchObject({ status: 'skipped', bdlRequests: 0 });
    const regular = await runLambdaScoreboard({
      env: { ...LIVE, SCOREBOARD_COLLECT_PRESEASON: undefined, SCOREBOARD_COLLECT_REGULAR: '1' },
    });
    expect(regular.status).toBe('skipped');
    expect(regular.refused).toEqual([{ seasonType: 'regular', reason: 'regular live acquisition requires separate approval' }]);
    const missingBucket = await runLambdaScoreboard({ env: { ...LIVE, SUPABASE_DB_URL: 'postgresql://unused.example/db' } });
    expect(missingBucket.reason).toMatch(/NBA_DATA_BUCKET/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('live preseason tick archives under the two scoreboard S3 prefixes the IAM policy allows', async () => {
    const tip = '2026-10-10T00:00:00.000Z';
    const game = {
      id: 5001, date: '2026-10-09', datetime: tip, season: 2026, status: '1st Qtr', status_state: 'in_progress',
      period: 1, time: '6:00', postseason: false, home_team_score: 12, visitor_team_score: 10,
      home_team: { id: 5, abbreviation: 'CHI' }, visitor_team: { id: 15, abbreviation: 'MEM' },
    };
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      const data = String(url).includes('/box_scores/live') ? [] : [game];
      return new Response(JSON.stringify({ data, meta: { next_cursor: null } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const archiveStore = new InMemoryAcqArchiveStore();
    const ledger = createMemoryAcqLedgerWriter();
    const store = createMemoryScoreboardStore();
    const { runLambdaScoreboard } = loadArtifact();
    const r = await runLambdaScoreboard({ env: LIVE, now: new Date('2026-10-10T00:06:00.000Z'), store, archiveStore, ledger });
    expect(r).toMatchObject({ status: 'success', bdlRequests: 2 });
    expect(urls.every((u) => u.startsWith('https://api.balldontlie.io/v1/') && u.includes('season_type=preseason'))).toBe(true);
    const keys = [...archiveStore.objects.keys()];
    expect(keys).toHaveLength(2);
    expect(keys.some((k) => k.startsWith('raw/source=balldontlie/league=nba/season=2026/entity=acq_scoreboard_games/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('raw/source=balldontlie/league=nba/season=2026/entity=acq_box_scores_live/'))).toBe(true);
    expect(ledger.rows.size).toBe(2);
    expect(store.games.get('5001')).toMatchObject({ seasonType: 'preseason', lifecycle: 'live' });
  });
});
