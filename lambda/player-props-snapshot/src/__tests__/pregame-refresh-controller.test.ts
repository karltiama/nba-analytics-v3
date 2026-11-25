import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PregameRunSnapshot } from '../pregame-refresh';

const mocks = vi.hoisted(() => {
  process.env.PLAYER_PROPS_QUEUE_URL = 'https://sqs.invalid/000000000000/nba-player-props-game-queue';
  return {
    targets: [] as Array<{ gameId: string; bdlGameId: number; startTime: string }>,
    inputs: {
      runs: [] as PregameRunSnapshot[],
      consumedAttempts: 0,
      inFlight: [] as Array<{ gameId: string; attemptsReserved: number }>,
      closingGames: 0,
      nearTipGames: 0,
    },
    sent: [] as Array<{ input: { Entries: Array<{ MessageBody: string }> } }>,
    pool: null as unknown,
    schemaReady: true,
    evidence: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    send(cmd: { input: { Entries: Array<{ MessageBody: string }> } }) {
      mocks.sent.push(cmd);
      return Promise.resolve({ Successful: cmd.input.Entries.map((_entry, index) => ({ Id: String(index) })), Failed: [] });
    }
  },
  SendMessageBatchCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock('../../src/db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('../../src/metrics', () => ({ emitCoverageMetric: () => undefined }));
vi.mock('../../src/game-discovery', async (importActual) => ({
  ...(await importActual<typeof import('../../src/game-discovery')>()),
  getGameTargets: async () => mocks.targets,
}));
vi.mock('../../src/pregame-refresh-load', () => ({
  loadPregamePlanningInputs: async () => mocks.inputs,
  clusterBytesFromEnv: (raw: string | undefined) => (raw == null || raw.trim() === '' ? null : Number(raw)),
  pregameRefreshSchemaReady: async () => mocks.schemaReady,
}));

type GameRun = { game_id: string; universe: string; status: string; error_message: string | null; started_at: number };

function fakePool() {
  const runs: GameRun[] = [];
  let nextId = 40;
  const nowSec = Math.floor(Date.now() / 1000);
  const query = async (sql: string, values: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim()) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (/SAVEPOINT/.test(sql)) return { rows: [] };
    if (sql.includes("status = 'started'") && !sql.includes('universe = $1')) return { rows: [] };
    if (sql.includes('SELECT DISTINCT game_id')) {
      const [universe, ids, windowSec, marker] = values as [string, string[], number, string];
      return {
        rows: runs
          .filter(
            (run) =>
              run.universe === universe &&
              ids.includes(run.game_id) &&
              run.started_at > nowSec - windowSec &&
              !(run.status === 'error' && run.error_message === marker)
          )
          .map((run) => ({ game_id: run.game_id })),
      };
    }
    if (sql.includes('INSERT INTO raw.player_prop_pull_runs')) return { rows: [{ pull_run_id: nextId++ }] };
    if (sql.includes('INSERT INTO raw.player_prop_game_runs')) {
      const [pullRunId, gameId, universe] = values as [number, string, string];
      runs.push({ game_id: gameId, universe, status: 'started', error_message: null, started_at: nowSec, pull_run_id: pullRunId } as GameRun);
      return { rows: [] };
    }
    if (sql.includes('UPDATE raw.player_prop_pull_runs')) return { rows: [] };
    if (sql.includes('broad_baseline_evidence')) return { rows: mocks.evidence };
    throw new Error(`unexpected SQL: ${sql.slice(0, 100)}`);
  };
  return { query, connect: async () => ({ query, release: () => undefined }) };
}

describe('pregame refresh controller', () => {
  beforeEach(() => {
    vi.stubEnv('DATA_MODE', 'live_api');
    vi.stubEnv('OFFSEASON_MODE', '0');
    vi.stubEnv('CRON_DRY_RUN', '0');
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://nobody@127.0.0.1:1/none');
    vi.stubEnv('BALLDONTLIE_API_KEY', 'test-key');
    vi.stubEnv('PLAYER_PROPS_WAVE_MAX_GAMES', '');
    vi.stubEnv('PLAYER_PROPS_PLANNING_PAGES', '1');
    vi.stubEnv('PLAYER_PROPS_PROTECTION_PAGES', '');
    vi.stubEnv('PROPS_CLUSTER_BYTES', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.sent = [];
    mocks.schemaReady = true;
    mocks.pool = fakePool();
    mocks.inputs = { runs: [], consumedAttempts: 0, inFlight: [], closingGames: 0, nearTipGames: 0 };
    mocks.evidence = [];
    mocks.targets = [{
      gameId: '101',
      bdlGameId: 101,
      startTime: new Date(Date.now() + 40 * 60_000).toISOString(),
    }];
  });

  it('queues one refresh and does not send when storage admission refuses', async () => {
    const { handler } = await import('../../controller');
    const queued = JSON.parse((await handler({ universe: 'pregame_refresh' })).body);
    expect(queued.universe).toBe('pregame_refresh');
    expect(queued.queuedGames).toBe(1);
    expect(JSON.parse(mocks.sent[0].input.Entries[0].MessageBody).universe).toBe('pregame_refresh');

    mocks.sent = [];
    vi.stubEnv('PROPS_CLUSTER_BYTES', '450000000');
    const refused = JSON.parse((await handler({ universe: 'pregame_refresh' })).body);
    expect(refused.skipped).toBe(true);
    expect(refused.reason).toBe('storage_admission');
    expect(mocks.sent).toEqual([]);
  });

  it('skips a broad fallback that already has a usable baseline and does not insert a control row', async () => {
    mocks.targets = [{
      gameId: '101',
      bdlGameId: 101,
      startTime: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
    }];
    mocks.evidence = [{
      game_id: '101',
      status: 'success',
      archive_status: 'archived',
      rows_fetched: 10,
      rows_archived: 10,
      rows_stored: 0,
      stamp: { books: 1, dkMarkets: 2, dkTwoSided: 1 },
    }];
    const { handler } = await import('../../controller');
    const skipped = JSON.parse((await handler({ universe: 'broad' })).body);
    expect(skipped.skipped).toBe(true);
    expect(skipped.reason).toBe('usable_baseline');
    expect(mocks.sent).toEqual([]);
  });

  it('leaves a game inside the pregame window to refresh', async () => {
    mocks.targets = [{
      gameId: '101',
      bdlGameId: 101,
      startTime: new Date(Date.now() + 90 * 60_000).toISOString(),
    }];
    const { handler } = await import('../../controller');
    const skipped = JSON.parse((await handler({ universe: 'broad' })).body);
    expect(skipped.skipped).toBe(true);
    expect(skipped.reason).toBe('pregame_window');
    expect(mocks.sent).toEqual([]);
  });

  it('does not enqueue pregame_refresh before the universe check allows it', async () => {
    mocks.schemaReady = false;
    const { handler } = await import('../../controller');
    const blocked = JSON.parse((await handler({ universe: 'pregame_refresh' })).body);
    expect(blocked).toMatchObject({ skipped: true, reason: 'universe_not_migrated', queuedGames: 0 });
    expect(mocks.sent).toEqual([]);
  });
});
