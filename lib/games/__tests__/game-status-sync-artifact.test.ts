import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFixtureFetchPage,
  createMemoryGameStore,
  type LocalGameRow,
  type ProviderGame,
} from '@/lib/games/status-sync';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';

const root = path.resolve(__dirname, '../../..');
const artifactPath = path.join(root, 'lambda/game-status-sync/.package/dist/index.js');
const packageDir = path.join(root, 'lambda/game-status-sync/.package');
const require = createRequire(import.meta.url);

const freezeEnv = {
  DATA_MODE: 'replay',
  OFFSEASON_MODE: '1',
  CRON_DRY_RUN: '1',
  LIVE_INGESTION_ENABLED: 'false',
  STATUS_SYNC_TARGET_SEASON: '2026',
};

const liveEnv = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: 'true',
  STATUS_SYNC_TARGET_SEASON: '2026',
  BALLDONTLIE_API_KEY: 'test-not-a-real-key',
  SUPABASE_DB_URL: 'postgresql://unused.example/postgres',
};

const now = new Date('2026-10-22T03:15:00.000Z');

function local(partial: Partial<LocalGameRow> & Pick<LocalGameRow, 'gameId'>): LocalGameRow {
  return {
    season: '2026',
    status: 'Scheduled',
    startTime: '2026-10-22T23:30:00.000Z',
    homeTeamId: '13',
    awayTeamId: '14',
    homeScore: 0,
    awayScore: 0,
    venue: null,
    ...partial,
  };
}

function provider(partial: Partial<ProviderGame> & Pick<ProviderGame, 'id'>): ProviderGame {
  return {
    season: 2026,
    status: 'Scheduled',
    datetime: '2026-10-22T23:30:00.000Z',
    date: '2026-10-22',
    home_team_score: 0,
    visitor_team_score: 0,
    home_team: { id: 13 },
    visitor_team: { id: 14 },
    ...partial,
  };
}

function loadArtifact(): {
  handler: (event?: unknown) => Promise<Record<string, unknown>>;
  runLambdaGameStatusSync: (deps?: Record<string, unknown>) => Promise<Record<string, unknown>>;
} {
  delete require.cache[require.resolve(artifactPath)];
  return require(artifactPath);
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

describe('game-status-sync built artifact (13C.3)', () => {
  it('builds a Lambda-safe bundle without AWS/BDL/Postgres secrets', () => {
    const result = spawnSync(process.execPath, ['lambda/game-status-sync/build.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.existsSync(artifactPath)).toBe(true);
  });

  it('handler entrypoint and status-sync domain are present', () => {
    const src = fs.readFileSync(artifactPath, 'utf8');
    expect(src).toMatch(/exports\.handler|module\.exports/);
    expect(src).toContain('game_status_sync_started');
    expect(src).toContain('game_status_changed');
    expect(src).toContain('game_became_final');
    expect(src).toContain('game_final_preserved');
    expect(src).toContain('game_status_sync_completed');
    expect(src).toContain('game_status_sync_failed');
    expect(src).toContain('fetchBdlLive');
    expect(src).toContain('insert into analytics.games');
    expect(src).toContain('final-preserve-guard');
    expect(src).toContain('/v1/games');
    expect(src).toContain('STATUS_SYNC_MANUAL_CANARY');
    expect(src).not.toMatch(/require\(["']@\//);
    expect(src).not.toContain('CODE_ONLY_NOT_BUNDLED');
    expect(src).not.toContain('postgame_game_stages');
    expect(src).not.toContain('@aws-sdk/client-sqs');
    expect(src).not.toContain('@aws-sdk/client-s3');
    const bytes = fs.statSync(artifactPath).size;
    expect(bytes).toBeGreaterThan(10_000);
    expect(bytes).toBeLessThan(8 * 1024 * 1024);
  });

  it('package contains no secret files or obvious credential literals', () => {
    const files = walkFiles(packageDir);
    const names = files.map((f) => path.relative(packageDir, f).replace(/\\/g, '/'));
    expect(names.some((n) => n === 'dist/index.js' || n.endsWith('/dist/index.js') || n === 'dist\\index.js')).toBe(
      true
    );
    for (const name of names) {
      expect(name, name).not.toMatch(/(^|\/)\.env(\.|$)/);
      expect(name, name).not.toMatch(/terraform\.tfvars/);
      expect(name, name).not.toMatch(/credentials/i);
    }
    const src = fs.readFileSync(artifactPath, 'utf8');
    expect(src).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(src).not.toMatch(/BEGIN (RSA |OPENSSH )?PRIVATE KEY/);
    expect(src).not.toMatch(/postgres(?:ql)?:\/\/[^\s:]+:[^@\s]+@/);
  });

  it('loads and freeze-skips with 0 BDL and 0 DB', async () => {
    const prev = { ...process.env };
    Object.assign(process.env, freezeEnv);
    delete process.env.BALLDONTLIE_API_KEY;
    delete process.env.BALDONTLIE_API_KEY;
    delete process.env.SUPABASE_DB_URL;
    try {
      const mod = loadArtifact();
      const result = await mod.handler();
      expect(result.status).toBe('skipped');
      expect(result.skipped).toBe(true);
      expect(result.bdlHttp).toBe(0);
      expect(result.wroteDb).toBe(false);
      expect(result.job).toBe('game_status_sync');
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in prev)) delete process.env[key];
      }
      Object.assign(process.env, prev);
    }
  });

  it('mocked Scheduled → Final reaches domain with no HTTP', async () => {
    const mod = loadArtifact();
    const store = createMemoryGameStore([local({ gameId: '18446744', status: 'Scheduled' })]);
    const seen: string[] = [];
    const result = await mod.runLambdaGameStatusSync({
      env: liveEnv,
      now,
      dryRun: true,
      store,
      fetchPage: async (url: string) => {
        seen.push(url);
        return createFixtureFetchPage([
          provider({ id: 18446744, status: 'Final', home_team_score: 110, visitor_team_score: 98 }),
        ])(url);
      },
    });
    expect(result.status).toBe('success');
    expect(result.becameFinal).toBe(1);
    expect(result.bdlHttp).toBe(1);
    expect(result.wroteDb).toBe(false);
    expect(result.productPin).toBe(PINNED_ANALYTICS_SEASON);
    expect(seen[0]).toContain('/v1/games');
    expect(seen[0]).toContain('seasons%5B%5D=2026');
    expect(seen[0]).toContain('start_date=');
    expect(result.events.map((e: { event: string }) => e.event)).toContain('game_became_final');
    expect(result.events.map((e: { event: string }) => e.event)).not.toContain('game_final_preserved');
  });

  it('Final-preserve on packaged runtime: local Final + provider Scheduled', async () => {
    const mod = loadArtifact();
    const store = createMemoryGameStore([
      local({ gameId: '1', status: 'Final', homeScore: 100, awayScore: 90 }),
    ]);
    const result = await mod.runLambdaGameStatusSync({
      env: liveEnv,
      now,
      dryRun: true,
      store,
      fetchPage: createFixtureFetchPage([provider({ id: 1, status: 'Scheduled' })]),
    });
    expect(result.finalPreserved).toBe(1);
    expect(result.becameFinal).toBe(0);
    expect(result.events.map((e: { event: string }) => e.event)).toContain('game_final_preserved');
    expect(result.events.map((e: { event: string }) => e.event)).not.toContain('game_became_final');
    expect(store.rows.get('1')?.status).toBe('Final');
  });

  it('allows Final → Final score correction', async () => {
    const mod = loadArtifact();
    const store = createMemoryGameStore([
      local({ gameId: '2', status: 'Final', homeScore: 100, awayScore: 90 }),
    ]);
    const result = await mod.runLambdaGameStatusSync({
      env: liveEnv,
      now,
      dryRun: false,
      store,
      fetchPage: createFixtureFetchPage([
        provider({ id: 2, status: 'Final', home_team_score: 101, visitor_team_score: 90 }),
      ]),
    });
    expect(result.updated).toBe(1);
    expect(result.finalPreserved).toBe(0);
    expect(store.rows.get('2')?.homeScore).toBe(101);
    expect(result.wroteDb).toBe(true);
  });

  it('inserts a legitimate new 2026 provider game (fixture, memory store)', async () => {
    const mod = loadArtifact();
    const store = createMemoryGameStore();
    const result = await mod.runLambdaGameStatusSync({
      env: liveEnv,
      now,
      dryRun: false,
      store,
      fetchPage: createFixtureFetchPage([provider({ id: 999001 })]),
    });
    expect(result.inserted).toBe(1);
    expect(store.rows.get('999001')?.homeTeamId).toBe('13');
    expect(store.rows.get('999001')?.awayTeamId).toBe('14');
    expect(store.rows.get('999001')?.season).toBe('2026');
  });

  it('rejects insert without team IDs', async () => {
    const mod = loadArtifact();
    const store = createMemoryGameStore();
    const result = await mod.runLambdaGameStatusSync({
      env: liveEnv,
      now,
      dryRun: false,
      store,
      fetchPage: createFixtureFetchPage([
        provider({ id: 999002, home_team: { id: null }, visitor_team: { id: 14 } }),
      ]),
    });
    expect(result.inserted).toBe(0);
    expect(result.rejected).toBe(1);
    expect(store.rows.size).toBe(0);
  });

  it('fail-closed malformed target season without BDL/DB', async () => {
    const mod = loadArtifact();
    const missing = { ...liveEnv };
    delete (missing as { STATUS_SYNC_TARGET_SEASON?: string }).STATUS_SYNC_TARGET_SEASON;
    const reasons: string[] = [];
    for (const env of [
      missing,
      { ...liveEnv, STATUS_SYNC_TARGET_SEASON: 'nope' },
      { ...liveEnv, STATUS_SYNC_TARGET_SEASON: '2025' },
    ]) {
      const result = await mod.runLambdaGameStatusSync({
        env,
        now,
        fetchPage: async () => {
          throw new Error('fetch must not run');
        },
        store: {
          getById: async () => {
            throw new Error('db must not run');
          },
          upsert: async () => {
            throw new Error('db must not run');
          },
        },
      });
      expect(result.status).toBe('failed');
      expect(result.bdlHttp).toBe(0);
      expect(result.wroteDb).toBe(false);
      reasons.push(String(result.reason));
    }
    expect(reasons[0]).toMatch(/missing STATUS_SYNC_TARGET_SEASON/);
    expect(reasons[1]).toMatch(/invalid STATUS_SYNC_TARGET_SEASON/);
    expect(reasons[2]).toMatch(/protected historical season 2025/);
  });

  it('provider failures are bounded (no retry loop)', async () => {
    const mod = loadArtifact();
    const failures = [
      { status: 401, ok: false },
      { status: 403, ok: false },
      { status: 429, ok: false },
      { status: 503, ok: false },
      { status: 0, ok: false, timeout: true },
    ];
    for (const page of failures) {
      let calls = 0;
      const result = await mod.runLambdaGameStatusSync({
        env: liveEnv,
        now,
        dryRun: true,
        store: createMemoryGameStore(),
        fetchPage: async () => {
          calls += 1;
          return page;
        },
      });
      expect(result.status).toBe('failed');
      expect(calls).toBe(1);
      expect(result.bdlHttp).toBe(1);
      expect(result.events.map((e: { event: string }) => e.event)).toContain('game_status_sync_failed');
    }
  });
});
